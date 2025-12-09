/**
 * Dead Letter Queue (DLQ) for failed work items
 */

import type { StreamConfig } from 'nats';
import { RetentionPolicy, StorageType } from 'nats';
import { getJetStreamManager, getJetStreamClient } from './nats.js';
import type { WorkItem, DLQItem } from './types.js';
import { createLogger } from './logger.js';

const logger = createLogger('dlq');

/** DLQ subject */
export const DLQ_SUBJECT = 'global.workqueue.deadletter';

/** DLQ stream name */
const DLQ_STREAM_NAME = 'WORKQUEUE_DEADLETTER';

/** Default TTL for DLQ items (7 days) */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

/**
 * Create DLQ stream with optional TTL
 * Default TTL: 7 days
 */
export async function createDLQStream(ttlMs?: number): Promise<void> {
  const jsm = getJetStreamManager();
  const ttl = ttlMs ?? DEFAULT_TTL_MS;
  const ttlNanos = ttl * 1_000_000; // Convert to nanoseconds

  const streamConfig: Partial<StreamConfig> = {
    name: DLQ_STREAM_NAME,
    subjects: [DLQ_SUBJECT],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    num_replicas: 1,
    max_msgs: -1, // Unlimited messages
    max_age: ttlNanos,
  };

  try {
    // Try to get existing stream
    const existingStream = await jsm.streams.info(DLQ_STREAM_NAME).catch(() => null);

    if (existingStream) {
      logger.debug('DLQ stream already exists', { stream: DLQ_STREAM_NAME });
      return;
    }

    // Create new stream
    await jsm.streams.add(streamConfig);
    logger.info('Created DLQ stream', {
      stream: DLQ_STREAM_NAME,
      subject: DLQ_SUBJECT,
      ttlMs: ttl,
    });
  } catch (err) {
    const error = err as Error;
    // Handle "already in use" error (race condition)
    if (error.message?.includes('already in use')) {
      logger.debug('DLQ stream already exists (concurrent creation)', {
        stream: DLQ_STREAM_NAME,
      });
      return;
    }
    throw new Error(`Failed to create DLQ stream: ${error.message}`);
  }
}

/**
 * Move work item to dead letter queue
 */
export async function moveToDeadLetter(
  item: WorkItem,
  reason: string,
  errors?: string[]
): Promise<void> {
  const js = getJetStreamClient();

  const dlqItem: DLQItem = {
    id: item.id,
    workItem: item,
    reason,
    attempts: item.attempts,
    failedAt: new Date().toISOString(),
    errors: errors || [],
  };

  try {
    const payload = JSON.stringify(dlqItem);
    const ack = await js.publish(DLQ_SUBJECT, Buffer.from(payload), {
      msgID: item.id, // Use work item ID as message ID for deduplication
    });

    logger.warn('Moved work item to dead letter queue', {
      id: item.id,
      taskId: item.taskId,
      capability: item.capability,
      reason,
      attempts: item.attempts,
      seq: ack.seq,
    });
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to move item ${item.id} to DLQ: ${error.message}`);
  }
}

/**
 * List DLQ items with optional filters
 */
export async function listDeadLetterItems(options?: {
  capability?: string;
  limit?: number;
}): Promise<DLQItem[]> {
  const jsm = getJetStreamManager();
  const items: DLQItem[] = [];

  try {
    // Get stream info to check if it exists
    const streamInfo = await jsm.streams.info(DLQ_STREAM_NAME);
    if (streamInfo.state.messages === 0) {
      return items;
    }

    // Fetch messages directly from stream
    const fetchLimit = options?.limit || streamInfo.state.messages;

    for (let seq = 1; seq <= streamInfo.state.last_seq && items.length < fetchLimit; seq++) {
      try {
        const msgInfo = await jsm.streams.getMessage(DLQ_STREAM_NAME, { seq });
        // Extract string from the data field
        const dataStr = new TextDecoder().decode(msgInfo.data);
        const dlqItem = JSON.parse(dataStr) as DLQItem;

        // Apply capability filter if specified
        if (options?.capability && dlqItem.workItem.capability !== options.capability) {
          continue;
        }

        items.push(dlqItem);
      } catch (msgErr) {
        const error = msgErr as Error;
        // Message might have been deleted, skip it
        if (!error.message?.includes('not found') && !error.message?.includes('no message')) {
          logger.error('Failed to get DLQ message', { seq, error: error.message });
        }
      }
    }

    logger.debug('Listed DLQ items', {
      count: items.length,
      capability: options?.capability,
      limit: options?.limit,
    });

    return items;
  } catch (err) {
    const error = err as Error;
    // If stream doesn't exist or has no messages, return empty list
    if (error.message?.includes('not found') || error.message?.includes('invalid json')) {
      return items;
    }
    throw new Error(`Failed to list DLQ items: ${error.message}`);
  }
}

/**
 * Get a single DLQ item by ID
 */
export async function getDeadLetterItem(id: string): Promise<DLQItem | null> {
  const jsm = getJetStreamManager();

  try {
    // Check if stream exists
    const streamInfo = await jsm.streams.info(DLQ_STREAM_NAME);
    if (streamInfo.state.messages === 0) {
      return null;
    }

    // Search through messages directly
    for (let seq = 1; seq <= streamInfo.state.last_seq; seq++) {
      try {
        const msgInfo = await jsm.streams.getMessage(DLQ_STREAM_NAME, { seq });
        const dataStr = new TextDecoder().decode(msgInfo.data);
        const dlqItem = JSON.parse(dataStr) as DLQItem;

        if (dlqItem.id === id) {
          logger.debug('Found DLQ item', { id, seq });
          return dlqItem;
        }
      } catch (msgErr) {
        const error = msgErr as Error;
        // Message might have been deleted, skip it
        if (!error.message?.includes('not found') && !error.message?.includes('no message')) {
          logger.error('Failed to get DLQ message', { seq, error: error.message });
        }
      }
    }

    logger.debug('DLQ item not found', { id });
    return null;
  } catch (err) {
    const error = err as Error;
    // If stream doesn't exist or has no messages, item doesn't exist
    if (error.message?.includes('not found') || error.message?.includes('invalid json')) {
      return null;
    }
    throw new Error(`Failed to get DLQ item ${id}: ${error.message}`);
  }
}

/**
 * Retry a DLQ item by moving it back to the work queue
 * Optionally reset the attempts counter
 */
export async function retryDeadLetterItem(id: string, resetAttempts = false): Promise<void> {
  const jsm = getJetStreamManager();
  const js = getJetStreamClient();

  try {
    // Get stream info
    const streamInfo = await jsm.streams.info(DLQ_STREAM_NAME);
    if (streamInfo.state.messages === 0) {
      throw new Error(`DLQ item ${id} not found`);
    }

    // Search for the item and delete it from stream
    let found = false;
    let dlqItem: DLQItem | null = null;
    let messageSeq: number | null = null;

    for (let seq = 1; seq <= streamInfo.state.last_seq; seq++) {
      try {
        const msgInfo = await jsm.streams.getMessage(DLQ_STREAM_NAME, { seq });
        const dataStr = new TextDecoder().decode(msgInfo.data);
        const item = JSON.parse(dataStr) as DLQItem;

        if (item.id === id) {
          dlqItem = item;
          messageSeq = seq;
          found = true;
          break;
        }
      } catch (msgErr) {
        const error = msgErr as Error;
        // Message might have been deleted, skip it
        if (!error.message?.includes('not found') && !error.message?.includes('no message')) {
          logger.error('Failed to get DLQ message', { seq, error: error.message });
        }
      }
    }

    if (!found || !dlqItem || messageSeq === null) {
      throw new Error(`DLQ item ${id} not found`);
    }

    // Reset attempts if requested
    if (resetAttempts) {
      dlqItem.workItem.attempts = 0;
    }

    // Publish back to work queue
    const workQueueSubject = `global.workqueue.${dlqItem.workItem.capability}`;
    const payload = JSON.stringify(dlqItem.workItem);
    await js.publish(workQueueSubject, Buffer.from(payload));

    // Delete from DLQ stream
    await jsm.streams.deleteMessage(DLQ_STREAM_NAME, messageSeq);

    logger.info('Retried DLQ item', {
      id,
      capability: dlqItem.workItem.capability,
      resetAttempts,
      seq: messageSeq,
    });
  } catch (err) {
    const error = err as Error;
    if (
      error.message?.includes('not found') ||
      error.message?.includes(`DLQ item ${id} not found`) ||
      error.message?.includes('invalid json')
    ) {
      throw new Error(`DLQ item ${id} not found`);
    }
    throw new Error(`Failed to retry DLQ item ${id}: ${error.message}`);
  }
}

/**
 * Discard (permanently delete) a DLQ item
 */
export async function discardDeadLetterItem(id: string): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    // Get stream info
    const streamInfo = await jsm.streams.info(DLQ_STREAM_NAME);
    if (streamInfo.state.messages === 0) {
      throw new Error(`DLQ item ${id} not found`);
    }

    // Search for the item and delete it from stream
    let found = false;
    let capability = '';
    let messageSeq: number | null = null;

    for (let seq = 1; seq <= streamInfo.state.last_seq; seq++) {
      try {
        const msgInfo = await jsm.streams.getMessage(DLQ_STREAM_NAME, { seq });
        const dataStr = new TextDecoder().decode(msgInfo.data);
        const item = JSON.parse(dataStr) as DLQItem;

        if (item.id === id) {
          capability = item.workItem.capability;
          messageSeq = seq;
          found = true;
          break;
        }
      } catch (msgErr) {
        const error = msgErr as Error;
        // Message might have been deleted, skip it
        if (!error.message?.includes('not found') && !error.message?.includes('no message')) {
          logger.error('Failed to get DLQ message', { seq, error: error.message });
        }
      }
    }

    if (!found || messageSeq === null) {
      throw new Error(`DLQ item ${id} not found`);
    }

    // Delete from DLQ stream
    await jsm.streams.deleteMessage(DLQ_STREAM_NAME, messageSeq);

    logger.info('Discarded DLQ item', { id, capability, seq: messageSeq });
  } catch (err) {
    const error = err as Error;
    if (
      error.message?.includes('not found') ||
      error.message?.includes(`DLQ item ${id} not found`) ||
      error.message?.includes('invalid json')
    ) {
      throw new Error(`DLQ item ${id} not found`);
    }
    throw new Error(`Failed to discard DLQ item ${id}: ${error.message}`);
  }
}
