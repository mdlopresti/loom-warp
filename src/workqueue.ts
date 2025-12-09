/**
 * Work queue pattern for distributing work among competing consumers
 */

import type { StreamConfig } from 'nats';
import { RetentionPolicy, StorageType, AckPolicy, DeliverPolicy } from 'nats';
import { getJetStreamManager, getJetStreamClient } from './nats.js';
import type { WorkItem } from './types.js';
import { createLogger } from './logger.js';

const logger = createLogger('workqueue');

/** Subject pattern for work queues */
const WORKQUEUE_SUBJECT_PREFIX = 'global.workqueue';

/** Work queue options */
export interface WorkQueueOptions {
  /** Ack timeout in milliseconds (default: 300000 = 5 min) */
  ackTimeoutMs?: number;
  /** Maximum delivery attempts (default: 3) */
  maxDeliveryAttempts?: number;
}

/** Default options */
const DEFAULT_OPTIONS: Required<WorkQueueOptions> = {
  ackTimeoutMs: 300000, // 5 minutes
  maxDeliveryAttempts: 3,
};

/**
 * Sanitize capability name for use in stream/consumer names
 * Replace non-alphanumeric characters with underscores
 */
function sanitizeCapability(capability: string): string {
  return capability.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
}

/**
 * Get work queue subject for a capability
 * Returns: "global.workqueue.{capability}"
 */
export function getWorkQueueSubject(capability: string): string {
  return `${WORKQUEUE_SUBJECT_PREFIX}.${capability}`;
}

/**
 * Validate UUID v4 format
 */
function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate work item
 */
function validateWorkItem(item: WorkItem): void {
  if (!isValidUUID(item.id)) {
    throw new Error(`Invalid work item ID: ${item.id} (must be UUID v4)`);
  }

  if (!item.capability || item.capability.trim() === '') {
    throw new Error('Work item capability cannot be empty');
  }

  if (item.priority !== undefined) {
    if (item.priority < 1 || item.priority > 10) {
      throw new Error(`Invalid priority: ${item.priority} (must be 1-10)`);
    }
  }
}

/**
 * Create work queue stream for a capability
 * Stream name: WORKQUEUE_{capability} (sanitized)
 * Subject: global.workqueue.{capability}
 * Retention: WorkQueue (messages removed after ack)
 * Storage: File
 */
export async function createWorkQueueStream(
  capability: string,
  options?: WorkQueueOptions
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const jsm = getJetStreamManager();
  const streamName = `WORKQUEUE_${sanitizeCapability(capability)}`;
  const subject = getWorkQueueSubject(capability);

  const streamConfig: Partial<StreamConfig> = {
    name: streamName,
    subjects: [subject],
    retention: RetentionPolicy.Workqueue,
    storage: StorageType.File,
    num_replicas: 1,
    max_msgs: -1, // Unlimited messages
    max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds (safety limit)
  };

  try {
    // Try to get existing stream
    const existingStream = await jsm.streams.info(streamName).catch(() => null);

    if (existingStream) {
      logger.debug('Work queue stream already exists', { stream: streamName, capability });
      return;
    }

    // Create new stream
    await jsm.streams.add(streamConfig);
    logger.info('Created work queue stream', {
      stream: streamName,
      subject,
      capability,
      ackTimeoutMs: opts.ackTimeoutMs,
      maxDeliveryAttempts: opts.maxDeliveryAttempts,
    });
  } catch (err) {
    const error = err as Error;
    // Handle "already in use" error (race condition)
    if (error.message?.includes('already in use')) {
      logger.debug('Work queue stream already exists (concurrent creation)', {
        stream: streamName,
        capability,
      });
      return;
    }
    throw new Error(`Failed to create work queue stream for ${capability}: ${error.message}`);
  }
}

/**
 * Publish work item to queue
 * Returns work item ID
 */
export async function publishWorkItem(item: WorkItem): Promise<string> {
  validateWorkItem(item);

  const js = getJetStreamClient();
  const subject = getWorkQueueSubject(item.capability);

  try {
    const payload = JSON.stringify(item);
    const ack = await js.publish(subject, Buffer.from(payload));

    logger.info('Published work item to queue', {
      id: item.id,
      taskId: item.taskId,
      capability: item.capability,
      seq: ack.seq,
      stream: ack.stream,
    });

    return item.id;
  } catch (err) {
    const error = err as Error;
    throw new Error(
      `Failed to publish work item ${item.id} to queue ${item.capability}: ${error.message}`
    );
  }
}

/**
 * Subscribe to work queue (competing consumer via queue group)
 * Returns unsubscribe function
 */
export async function subscribeToWorkQueue(
  capability: string,
  handler: (
    item: WorkItem,
    ack: () => Promise<void>,
    nak: () => Promise<void>
  ) => Promise<void>,
  options?: WorkQueueOptions
): Promise<() => void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const js = getJetStreamClient();
  const jsm = getJetStreamManager();
  const streamName = `WORKQUEUE_${sanitizeCapability(capability)}`;
  const consumerName = `worker-${sanitizeCapability(capability)}`;

  try {
    // Ensure consumer exists
    try {
      await jsm.consumers.info(streamName, consumerName);
      logger.debug('Work queue consumer already exists', { consumer: consumerName, capability });
    } catch {
      // Create durable consumer
      const consumerConfig = {
        durable_name: consumerName,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        ack_wait: opts.ackTimeoutMs * 1_000_000, // Convert to nanoseconds
        max_deliver: opts.maxDeliveryAttempts,
      };

      await jsm.consumers.add(streamName, consumerConfig);
      logger.info('Created work queue consumer', {
        consumer: consumerName,
        stream: streamName,
        capability,
        ackTimeoutMs: opts.ackTimeoutMs,
        maxDeliveryAttempts: opts.maxDeliveryAttempts,
      });
    }

    // Get consumer and start consuming
    const consumer = await js.consumers.get(streamName, consumerName);
    const messages = await consumer.consume();

    logger.info('Subscribed to work queue', { capability, consumer: consumerName });

    // Process messages in background
    let isActive = true;
    (async () => {
      try {
        for await (const msg of messages) {
          if (!isActive) break;

          try {
            // Parse work item
            const item = JSON.parse(msg.data.toString()) as WorkItem;

            // Update attempts count from message info
            const msgInfo = msg.info;
            item.attempts = msgInfo?.deliveryCount || 1;

            logger.debug('Received work item', {
              id: item.id,
              taskId: item.taskId,
              capability: item.capability,
              attempts: item.attempts,
            });

            // Create ack/nak functions
            const ackFn = async () => {
              msg.ack();
              logger.debug('Work item acknowledged', { id: item.id });
            };

            const nakFn = async () => {
              msg.nak();
              logger.debug('Work item negatively acknowledged (will redeliver)', { id: item.id });
            };

            // Call handler
            await handler(item, ackFn, nakFn);
          } catch (parseErr) {
            const error = parseErr as Error;
            logger.error('Error processing work item', { error: error.message });
            // Ack bad messages to avoid redelivery
            msg.ack();
          }
        }
      } catch (err) {
        const error = err as Error;
        if (isActive) {
          logger.error('Error in work queue subscription loop', {
            capability,
            error: error.message,
          });
        }
      }
    })().catch((err) => {
      logger.error('Work queue subscription loop failed', {
        capability,
        error: (err as Error).message,
      });
    });

    // Return unsubscribe function
    return async () => {
      logger.info('Unsubscribing from work queue', { capability });
      isActive = false;
      await messages.close();
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to subscribe to work queue', { capability, error: error.message });
    throw new Error(`Failed to subscribe to work queue ${capability}: ${error.message}`);
  }
}

/**
 * Claim a single work item from the queue (one-shot fetch)
 * Returns the work item if available, null if no work is pending
 * The message is acknowledged immediately upon successful claim
 */
export async function claimWorkItem(
  capability: string,
  timeoutMs: number = 5000
): Promise<WorkItem | null> {
  const js = getJetStreamClient();
  const jsm = getJetStreamManager();
  const streamName = `WORKQUEUE_${sanitizeCapability(capability)}`;
  const consumerName = `worker-${sanitizeCapability(capability)}`;

  try {
    // Check if stream exists
    try {
      await jsm.streams.info(streamName);
    } catch {
      logger.debug('Work queue stream does not exist', { capability, stream: streamName });
      return null;
    }

    // Ensure consumer exists
    try {
      await jsm.consumers.info(streamName, consumerName);
    } catch {
      // Create durable consumer with explicit ack
      const consumerConfig = {
        durable_name: consumerName,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        ack_wait: DEFAULT_OPTIONS.ackTimeoutMs * 1_000_000, // nanoseconds
        max_deliver: DEFAULT_OPTIONS.maxDeliveryAttempts,
      };

      await jsm.consumers.add(streamName, consumerConfig);
      logger.info('Created work queue consumer for claim', {
        consumer: consumerName,
        stream: streamName,
        capability,
      });
    }

    // Get consumer and fetch single message
    const consumer = await js.consumers.get(streamName, consumerName);

    // Use fetch with expires to get a single message with timeout
    const messages = await consumer.fetch({
      max_messages: 1,
      expires: timeoutMs,
    });

    // Process the single message
    for await (const msg of messages) {
      try {
        const item = JSON.parse(msg.data.toString()) as WorkItem;

        // Update attempts count from message info
        const msgInfo = msg.info;
        item.attempts = msgInfo?.deliveryCount || 1;

        // Acknowledge the message (claim it)
        msg.ack();

        logger.info('Work item claimed', {
          id: item.id,
          taskId: item.taskId,
          capability: item.capability,
          attempts: item.attempts,
        });

        return item;
      } catch (parseErr) {
        const error = parseErr as Error;
        logger.error('Failed to parse work item during claim', { error: error.message });
        // Ack bad messages to avoid redelivery loops
        msg.ack();
      }
    }

    // No messages available
    logger.debug('No work items available to claim', { capability });
    return null;
  } catch (err) {
    const error = err as Error;
    // Handle timeout gracefully
    if (error.message?.includes('timeout') || error.message?.includes('expired')) {
      logger.debug('Claim timeout, no work available', { capability });
      return null;
    }
    logger.error('Failed to claim work item', { capability, error: error.message });
    throw new Error(`Failed to claim work from ${capability} queue: ${error.message}`);
  }
}

/**
 * Get pending work items count for a capability
 * Returns number of messages waiting in the queue
 */
export async function getPendingWorkCount(capability: string): Promise<number> {
  const jsm = getJetStreamManager();
  const streamName = `WORKQUEUE_${sanitizeCapability(capability)}`;

  try {
    const info = await jsm.streams.info(streamName);
    return info.state.messages;
  } catch (err) {
    const error = err as Error;
    // Stream doesn't exist means no pending work
    if (error.message?.includes('not found')) {
      return 0;
    }
    throw new Error(`Failed to get pending work count for ${capability}: ${error.message}`);
  }
}
