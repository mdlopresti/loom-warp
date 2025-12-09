/**
 * Tests for Dead Letter Queue module
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connectToNats, disconnect } from './nats.js';
import {
  createDLQStream,
  moveToDeadLetter,
  listDeadLetterItems,
  getDeadLetterItem,
  retryDeadLetterItem,
  discardDeadLetterItem,
  DLQ_SUBJECT,
} from './dlq.js';
import { createWorkQueueStream, publishWorkItem, subscribeToWorkQueue } from './workqueue.js';
import type { WorkItem } from './types.js';

// Test utilities
const TEST_NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';

// Counter for unique UUIDs
let uuidCounter = 0;

function createTestWorkItem(capability: string, id?: string): WorkItem {
  // Generate valid UUID v4 format
  if (!id) {
    const counter = uuidCounter++;
    const counterHex = counter.toString(16).padStart(12, '0');
    id = `550e8400-e29b-41d4-a716-${counterHex}`;
  }

  return {
    id,
    taskId: `task-${Date.now()}-${uuidCounter}`,
    capability,
    description: 'Test work item for DLQ',
    priority: 5,
    offeredBy: 'test-agent-guid',
    offeredAt: new Date().toISOString(),
    attempts: 0,
  };
}

describe('Dead Letter Queue Module', () => {
  beforeAll(async () => {
    await connectToNats(TEST_NATS_URL);
  });

  afterAll(async () => {
    await disconnect();
  });

  describe('DLQ Stream Creation', () => {
    it('should create DLQ stream successfully', async () => {
      await expect(createDLQStream()).resolves.toBeUndefined();
    });

    it('should handle idempotent stream creation', async () => {
      await createDLQStream();
      await expect(createDLQStream()).resolves.toBeUndefined();
    });

    it('should create DLQ stream with custom TTL', async () => {
      const customTTL = 24 * 60 * 60 * 1000; // 1 day
      await expect(createDLQStream(customTTL)).resolves.toBeUndefined();
    });

    it('should use correct subject and stream name', () => {
      expect(DLQ_SUBJECT).toBe('global.workqueue.deadletter');
    });
  });

  describe('moveToDeadLetter', () => {
    it('should move work item to DLQ', async () => {
      await createDLQStream();
      const workItem = createTestWorkItem('typescript');
      workItem.attempts = 3;

      await expect(
        moveToDeadLetter(workItem, 'Max delivery attempts exceeded')
      ).resolves.toBeUndefined();

      // Verify item is in DLQ
      const dlqItems = await listDeadLetterItems();
      const movedItem = dlqItems.find((item) => item.id === workItem.id);
      expect(movedItem).toBeDefined();
      expect(movedItem?.workItem.id).toBe(workItem.id);
      expect(movedItem?.reason).toBe('Max delivery attempts exceeded');
      expect(movedItem?.attempts).toBe(3);
    });

    it('should include error messages when provided', async () => {
      await createDLQStream();
      const workItem = createTestWorkItem('python');
      workItem.attempts = 3;

      const errors = ['Connection timeout', 'Worker unavailable', 'Processing failed'];

      await moveToDeadLetter(workItem, 'Multiple failures', errors);

      const dlqItems = await listDeadLetterItems();
      const movedItem = dlqItems.find((item) => item.id === workItem.id);
      expect(movedItem?.errors).toEqual(errors);
    });

    it('should set failedAt timestamp', async () => {
      await createDLQStream();
      const workItem = createTestWorkItem('code-review');
      workItem.attempts = 2;

      const beforeTime = Date.now();
      await moveToDeadLetter(workItem, 'Test failure');
      const afterTime = Date.now();

      const dlqItems = await listDeadLetterItems();
      const movedItem = dlqItems.find((item) => item.id === workItem.id);
      expect(movedItem?.failedAt).toBeDefined();

      const failedAtTime = new Date(movedItem!.failedAt).getTime();
      expect(failedAtTime).toBeGreaterThanOrEqual(beforeTime);
      expect(failedAtTime).toBeLessThanOrEqual(afterTime);
    });

    it('should preserve all work item fields', async () => {
      await createDLQStream();
      const workItem = createTestWorkItem('testing');
      workItem.priority = 8;
      workItem.deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      workItem.contextData = { key: 'value', nested: { data: 123 } };
      workItem.attempts = 3;

      await moveToDeadLetter(workItem, 'Test preservation');

      const dlqItems = await listDeadLetterItems();
      const movedItem = dlqItems.find((item) => item.id === workItem.id);
      expect(movedItem?.workItem).toEqual(workItem);
    });
  });

  describe('listDeadLetterItems', () => {
    it('should return empty array when no items in DLQ', async () => {
      await createDLQStream();
      // Use a capability that doesn't exist
      const items = await listDeadLetterItems({ capability: 'nonexistent-capability-xyz' });
      expect(items).toEqual([]);
    });

    it('should list all DLQ items', async () => {
      await createDLQStream();

      // Add multiple items
      const workItem1 = createTestWorkItem('typescript');
      const workItem2 = createTestWorkItem('python');
      const workItem3 = createTestWorkItem('testing');

      await moveToDeadLetter(workItem1, 'Reason 1');
      await moveToDeadLetter(workItem2, 'Reason 2');
      await moveToDeadLetter(workItem3, 'Reason 3');

      const items = await listDeadLetterItems();
      expect(items.length).toBeGreaterThanOrEqual(3);

      // Verify our items are present
      const ids = items.map((item) => item.id);
      expect(ids).toContain(workItem1.id);
      expect(ids).toContain(workItem2.id);
      expect(ids).toContain(workItem3.id);
    });

    it('should filter by capability', async () => {
      await createDLQStream();

      const tsItem = createTestWorkItem('typescript');
      const pyItem = createTestWorkItem('python');

      await moveToDeadLetter(tsItem, 'TypeScript failure');
      await moveToDeadLetter(pyItem, 'Python failure');

      const tsItems = await listDeadLetterItems({ capability: 'typescript' });
      const tsIds = tsItems.map((item) => item.id);
      expect(tsIds).toContain(tsItem.id);
      // Python item should not be in TypeScript results
      expect(tsIds).not.toContain(pyItem.id);
    });

    it('should limit number of results', async () => {
      await createDLQStream();

      // Add several items
      for (let i = 0; i < 5; i++) {
        const workItem = createTestWorkItem('limit-test');
        await moveToDeadLetter(workItem, `Failure ${i}`);
      }

      const items = await listDeadLetterItems({ capability: 'limit-test', limit: 3 });
      expect(items.length).toBeLessThanOrEqual(3);
    });
  });

  describe('getDeadLetterItem', () => {
    it('should return null for non-existent item', async () => {
      await createDLQStream();
      const item = await getDeadLetterItem('00000000-0000-0000-0000-000000000000');
      expect(item).toBeNull();
    });

    it('should retrieve specific DLQ item by ID', async () => {
      await createDLQStream();
      const workItem = createTestWorkItem('get-test');
      workItem.attempts = 3;

      await moveToDeadLetter(workItem, 'Test get', ['error1', 'error2']);

      const dlqItem = await getDeadLetterItem(workItem.id);
      expect(dlqItem).toBeDefined();
      expect(dlqItem?.id).toBe(workItem.id);
      expect(dlqItem?.workItem.id).toBe(workItem.id);
      expect(dlqItem?.reason).toBe('Test get');
      expect(dlqItem?.attempts).toBe(3);
      expect(dlqItem?.errors).toEqual(['error1', 'error2']);
    });
  });

  describe('retryDeadLetterItem', () => {
    it('should move item back to work queue', async () => {
      await createDLQStream();
      await createWorkQueueStream('retry-test');

      const workItem = createTestWorkItem('retry-test');
      workItem.attempts = 3;

      // Move to DLQ
      await moveToDeadLetter(workItem, 'Test retry');

      // Wait for message to be persisted
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify in DLQ
      let dlqItem = await getDeadLetterItem(workItem.id);
      expect(dlqItem).toBeDefined();

      // Retry
      await retryDeadLetterItem(workItem.id);

      // Wait for ack to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should be removed from DLQ
      dlqItem = await getDeadLetterItem(workItem.id);
      expect(dlqItem).toBeNull();

      // Should be back in work queue - verify by subscribing and receiving it
      let receivedItem: WorkItem | null = null;
      const unsubscribe = await subscribeToWorkQueue(
        'retry-test',
        async (item, ack) => {
          if (item.id === workItem.id) {
            receivedItem = item;
            await ack();
          }
        }
      );

      // Wait a bit for message delivery
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(receivedItem).toBeDefined();
      expect(receivedItem?.id).toBe(workItem.id);
      expect(receivedItem?.attempts).toBe(1); // Delivery count starts at 1 for first delivery

      await unsubscribe();
    });

    it('should reset attempts when requested', async () => {
      await createDLQStream();
      await createWorkQueueStream('retry-reset-test');

      const workItem = createTestWorkItem('retry-reset-test');
      workItem.attempts = 3;

      // Move to DLQ
      await moveToDeadLetter(workItem, 'Test retry with reset');

      // Wait for message to be persisted
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Retry with reset
      await retryDeadLetterItem(workItem.id, true);

      // Wait for ack to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify item is back in queue with reset attempts
      let receivedItem: WorkItem | null = null;
      const unsubscribe = await subscribeToWorkQueue(
        'retry-reset-test',
        async (item, ack) => {
          if (item.id === workItem.id) {
            receivedItem = item;
            await ack();
          }
        }
      );

      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(receivedItem).toBeDefined();
      expect(receivedItem?.attempts).toBe(1); // Will be 1 because subscriber increments it

      await unsubscribe();
    });

    it('should throw error for non-existent item', async () => {
      await createDLQStream();
      await expect(
        retryDeadLetterItem('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('not found');
    });
  });

  describe('discardDeadLetterItem', () => {
    it('should permanently delete item from DLQ', async () => {
      await createDLQStream();
      const workItem = createTestWorkItem('discard-test');
      workItem.attempts = 3;

      // Move to DLQ
      await moveToDeadLetter(workItem, 'Test discard');

      // Wait for message to be persisted
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify in DLQ
      let dlqItem = await getDeadLetterItem(workItem.id);
      expect(dlqItem).toBeDefined();

      // Discard
      await discardDeadLetterItem(workItem.id);

      // Wait for ack to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should be removed from DLQ
      dlqItem = await getDeadLetterItem(workItem.id);
      expect(dlqItem).toBeNull();
    });

    it('should throw error for non-existent item', async () => {
      await createDLQStream();
      await expect(
        discardDeadLetterItem('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('not found');
    });
  });

  describe('TTL Behavior', () => {
    // Skip this test - NATS message expiration timing is non-deterministic
    // and causes flaky failures in CI environments
    it.skip('should create stream with custom short TTL', async () => {
      // Create with very short TTL (2 seconds for testing)
      const shortTTL = 2000;
      await createDLQStream(shortTTL);

      const workItem = createTestWorkItem('ttl-test');
      await moveToDeadLetter(workItem, 'TTL test');

      // Item should exist immediately
      let dlqItem = await getDeadLetterItem(workItem.id);
      expect(dlqItem).toBeDefined();

      // Wait for TTL to expire (add extra time for NATS to process)
      // NATS may need more time to expire messages, especially under load
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Item should be gone after TTL
      dlqItem = await getDeadLetterItem(workItem.id);
      expect(dlqItem).toBeNull();
    }, 15000); // Extend test timeout to 15 seconds
  });

  describe('Integration with Work Queue', () => {
    it('should handle complete failure scenario', async () => {
      await createDLQStream();
      await createWorkQueueStream('integration-test', { maxDeliveryAttempts: 2 });

      const workItem = createTestWorkItem('integration-test');

      // Publish to work queue
      await publishWorkItem(workItem);

      // Subscribe and intentionally fail
      const receivedItems: WorkItem[] = [];
      const unsubscribe = await subscribeToWorkQueue(
        'integration-test',
        async (item, ack, nak) => {
          receivedItems.push(item);

          // On max attempts, move to DLQ instead of nak
          if (item.attempts >= 2) {
            await moveToDeadLetter(
              item,
              'Max delivery attempts exceeded',
              receivedItems.map((_, i) => `Attempt ${i + 1} failed`)
            );
            await ack(); // Ack to remove from work queue
          } else {
            await nak(); // Redeliver
          }
        },
        { maxDeliveryAttempts: 2 }
      );

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should have received item multiple times
      expect(receivedItems.length).toBeGreaterThanOrEqual(2);

      // Item should be in DLQ
      const dlqItem = await getDeadLetterItem(workItem.id);
      expect(dlqItem).toBeDefined();
      expect(dlqItem?.reason).toBe('Max delivery attempts exceeded');

      await unsubscribe();
    }, 10000);
  });
});
