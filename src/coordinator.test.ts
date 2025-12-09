/**
 * Tests for Optional Coordinator Agent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Coordinator, createCoordinator, type CoordinatorConfig, type WorkRequest } from './coordinator.js';

// Mock dependencies
vi.mock('./logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('./kv.js', () => ({
  listRegistryEntries: vi.fn(),
}));

vi.mock('./registry.js', () => ({
  isVisibleTo: vi.fn(() => true),
}));

vi.mock('./workqueue.js', () => ({
  createWorkQueueStream: vi.fn(),
  publishWorkItem: vi.fn(),
}));

vi.mock('./dlq.js', () => ({
  moveToDeadLetter: vi.fn(),
}));

import { listRegistryEntries } from './kv.js';
import { isVisibleTo } from './registry.js';
import { createWorkQueueStream, publishWorkItem } from './workqueue.js';
import { moveToDeadLetter } from './dlq.js';
import type { RegistryEntry } from './types.js';

describe('Coordinator', () => {
  let coordinator: Coordinator;
  const defaultConfig: CoordinatorConfig = {
    coordinatorGuid: 'coord-guid-1234',
    projectId: 'project-1234',
    username: 'coordinator',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    coordinator = createCoordinator(defaultConfig);
  });

  afterEach(() => {
    coordinator.shutdown();
    vi.useRealTimers();
  });

  describe('createCoordinator', () => {
    it('should create coordinator with default config', () => {
      const coord = createCoordinator(defaultConfig);
      expect(coord).toBeInstanceOf(Coordinator);
      coord.shutdown();
    });

    it('should accept custom config options', () => {
      const coord = createCoordinator({
        ...defaultConfig,
        maxAttempts: 5,
        assignmentTimeoutMs: 600000,
        autoRetry: false,
      });
      expect(coord).toBeInstanceOf(Coordinator);
      coord.shutdown();
    });
  });

  describe('findWorkers', () => {
    it('should find workers with matching capability', async () => {
      const mockWorkers: RegistryEntry[] = [
        {
          guid: 'worker-1',
          agentType: 'developer',
          handle: 'dev-1',
          hostname: 'host1',
          projectId: 'project-1234',
          natsUrl: 'nats://localhost:4222',
          capabilities: ['typescript', 'testing'],
          scope: 'project',
          visibility: 'project-only',
          status: 'online',
          currentTaskCount: 0,
          registeredAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
        {
          guid: 'worker-2',
          agentType: 'developer',
          handle: 'dev-2',
          hostname: 'host2',
          projectId: 'project-1234',
          natsUrl: 'nats://localhost:4222',
          capabilities: ['typescript'],
          scope: 'project',
          visibility: 'project-only',
          status: 'online',
          currentTaskCount: 2,
          registeredAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
      ];

      vi.mocked(listRegistryEntries).mockResolvedValue(mockWorkers);
      vi.mocked(isVisibleTo).mockReturnValue(true);

      const workers = await coordinator.findWorkers('typescript');
      expect(workers).toHaveLength(2);
      expect(workers[0].guid).toBe('worker-1'); // Lower task count first
    });

    it('should filter out offline workers', async () => {
      const mockWorkers: RegistryEntry[] = [
        {
          guid: 'worker-1',
          agentType: 'developer',
          handle: 'dev-1',
          hostname: 'host1',
          projectId: 'project-1234',
          natsUrl: 'nats://localhost:4222',
          capabilities: ['typescript'],
          scope: 'project',
          visibility: 'project-only',
          status: 'offline',
          currentTaskCount: 0,
          registeredAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
      ];

      vi.mocked(listRegistryEntries).mockResolvedValue(mockWorkers);

      const workers = await coordinator.findWorkers('typescript');
      expect(workers).toHaveLength(0);
    });

    it('should filter out workers without capability', async () => {
      const mockWorkers: RegistryEntry[] = [
        {
          guid: 'worker-1',
          agentType: 'developer',
          handle: 'dev-1',
          hostname: 'host1',
          projectId: 'project-1234',
          natsUrl: 'nats://localhost:4222',
          capabilities: ['python'],
          scope: 'project',
          visibility: 'project-only',
          status: 'online',
          currentTaskCount: 0,
          registeredAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
      ];

      vi.mocked(listRegistryEntries).mockResolvedValue(mockWorkers);

      const workers = await coordinator.findWorkers('typescript');
      expect(workers).toHaveLength(0);
    });

    it('should not include the coordinator itself', async () => {
      const mockWorkers: RegistryEntry[] = [
        {
          guid: 'coord-guid-1234', // Same as coordinator
          agentType: 'coordinator',
          handle: 'coordinator',
          hostname: 'host1',
          projectId: 'project-1234',
          natsUrl: 'nats://localhost:4222',
          capabilities: ['typescript'],
          scope: 'project',
          visibility: 'project-only',
          status: 'online',
          currentTaskCount: 0,
          registeredAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
      ];

      vi.mocked(listRegistryEntries).mockResolvedValue(mockWorkers);
      vi.mocked(isVisibleTo).mockReturnValue(true);

      const workers = await coordinator.findWorkers('typescript');
      expect(workers).toHaveLength(0);
    });

    it('should sort workers by status and task count', async () => {
      const mockWorkers: RegistryEntry[] = [
        {
          guid: 'worker-1',
          agentType: 'developer',
          handle: 'dev-1',
          hostname: 'host1',
          projectId: 'project-1234',
          natsUrl: 'nats://localhost:4222',
          capabilities: ['typescript'],
          scope: 'project',
          visibility: 'project-only',
          status: 'busy',
          currentTaskCount: 1,
          registeredAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
        {
          guid: 'worker-2',
          agentType: 'developer',
          handle: 'dev-2',
          hostname: 'host2',
          projectId: 'project-1234',
          natsUrl: 'nats://localhost:4222',
          capabilities: ['typescript'],
          scope: 'project',
          visibility: 'project-only',
          status: 'online',
          currentTaskCount: 3,
          registeredAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
      ];

      vi.mocked(listRegistryEntries).mockResolvedValue(mockWorkers);
      vi.mocked(isVisibleTo).mockReturnValue(true);

      const workers = await coordinator.findWorkers('typescript');
      expect(workers[0].guid).toBe('worker-2'); // Online first
      expect(workers[1].guid).toBe('worker-1'); // Then busy
    });
  });

  describe('submitWork', () => {
    it('should submit work and return work item ID', async () => {
      const request: WorkRequest = {
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Implement feature X',
        priority: 7,
      };

      const workItemId = await coordinator.submitWork(request);

      expect(workItemId).toMatch(/^[0-9a-f-]{36}$/);
      expect(createWorkQueueStream).toHaveBeenCalledWith('typescript');
      expect(publishWorkItem).toHaveBeenCalled();
    });

    it('should track assignment after submission', async () => {
      const request: WorkRequest = {
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Implement feature X',
      };

      const workItemId = await coordinator.submitWork(request);
      const assignment = coordinator.getAssignment(workItemId);

      expect(assignment).toBeDefined();
      expect(assignment?.status).toBe('pending');
      expect(assignment?.taskId).toBe('task-123');
      expect(assignment?.capability).toBe('typescript');
    });

    it('should use default priority if not specified', async () => {
      const request: WorkRequest = {
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Implement feature X',
      };

      await coordinator.submitWork(request);

      expect(publishWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 5 })
      );
    });
  });

  describe('recordClaim', () => {
    it('should record work claim', async () => {
      const workItemId = await coordinator.submitWork({
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Test task',
      });

      const result = await coordinator.recordClaim(workItemId, 'worker-1');

      expect(result).toBe(true);
      const assignment = coordinator.getAssignment(workItemId);
      expect(assignment?.status).toBe('assigned');
      expect(assignment?.assignedTo).toBe('worker-1');
      expect(assignment?.attempts).toBe(1);
    });

    it('should reject claim for unknown work item', async () => {
      const result = await coordinator.recordClaim('unknown-id', 'worker-1');
      expect(result).toBe(false);
    });

    it('should reject claim for non-pending work', async () => {
      const workItemId = await coordinator.submitWork({
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Test task',
      });

      await coordinator.recordClaim(workItemId, 'worker-1');
      const result = await coordinator.recordClaim(workItemId, 'worker-2');

      expect(result).toBe(false);
    });
  });

  describe('recordProgress', () => {
    it('should record progress update', async () => {
      const workItemId = await coordinator.submitWork({
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Test task',
      });
      await coordinator.recordClaim(workItemId, 'worker-1');

      const result = coordinator.recordProgress(workItemId, 50, 'Halfway done');

      expect(result).toBe(true);
      const assignment = coordinator.getAssignment(workItemId);
      expect(assignment?.status).toBe('in-progress');
      expect(assignment?.progress).toBe(50);
    });

    it('should clamp progress to 0-100', async () => {
      const workItemId = await coordinator.submitWork({
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Test task',
      });
      await coordinator.recordClaim(workItemId, 'worker-1');

      coordinator.recordProgress(workItemId, 150);
      expect(coordinator.getAssignment(workItemId)?.progress).toBe(100);

      coordinator.recordProgress(workItemId, -10);
      expect(coordinator.getAssignment(workItemId)?.progress).toBe(0);
    });
  });

  describe('recordCompletion', () => {
    it('should record completion', async () => {
      const workItemId = await coordinator.submitWork({
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Test task',
      });
      await coordinator.recordClaim(workItemId, 'worker-1');

      const result = coordinator.recordCompletion(workItemId, { output: 'done' }, 'Task completed');

      expect(result).toBe(true);
      const assignment = coordinator.getAssignment(workItemId);
      expect(assignment?.status).toBe('completed');
      expect(assignment?.progress).toBe(100);
      expect(assignment?.result).toEqual({ output: 'done' });
      expect(assignment?.completedAt).toBeTruthy();
    });
  });

  describe('recordError', () => {
    it('should retry recoverable errors', async () => {
      const workItemId = await coordinator.submitWork({
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Test task',
      });
      await coordinator.recordClaim(workItemId, 'worker-1');

      await coordinator.recordError(workItemId, 'Temporary failure', true);

      const assignment = coordinator.getAssignment(workItemId);
      expect(assignment?.status).toBe('pending'); // Requeued
      expect(publishWorkItem).toHaveBeenCalledTimes(2); // Initial + retry
    });

    it('should move to DLQ after max attempts', async () => {
      const coord = createCoordinator({
        ...defaultConfig,
        maxAttempts: 1,
      });

      const workItemId = await coord.submitWork({
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Test task',
      });
      await coord.recordClaim(workItemId, 'worker-1');

      await coord.recordError(workItemId, 'Fatal failure', true);

      expect(moveToDeadLetter).toHaveBeenCalled();
      const assignment = coord.getAssignment(workItemId);
      expect(assignment?.status).toBe('failed');

      coord.shutdown();
    });

    it('should move non-recoverable errors to DLQ immediately', async () => {
      const workItemId = await coordinator.submitWork({
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Test task',
      });
      await coordinator.recordClaim(workItemId, 'worker-1');

      await coordinator.recordError(workItemId, 'Fatal error', false);

      expect(moveToDeadLetter).toHaveBeenCalled();
      const assignment = coordinator.getAssignment(workItemId);
      expect(assignment?.status).toBe('failed');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      // Submit several work items
      const id1 = await coordinator.submitWork({
        taskId: 'task-1',
        capability: 'typescript',
        description: 'Task 1',
      });
      const id2 = await coordinator.submitWork({
        taskId: 'task-2',
        capability: 'typescript',
        description: 'Task 2',
      });
      void (await coordinator.submitWork({
        taskId: 'task-3',
        capability: 'typescript',
        description: 'Task 3',
      }));

      await coordinator.recordClaim(id1, 'worker-1');
      await coordinator.recordClaim(id2, 'worker-2');
      coordinator.recordCompletion(id2);

      const stats = coordinator.getStats();

      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(1);
      expect(stats.assigned).toBe(1);
      expect(stats.completed).toBe(1);
    });
  });

  describe('getAssignments', () => {
    it('should filter by status', async () => {
      const id1 = await coordinator.submitWork({
        taskId: 'task-1',
        capability: 'typescript',
        description: 'Task 1',
      });
      await coordinator.submitWork({
        taskId: 'task-2',
        capability: 'typescript',
        description: 'Task 2',
      });

      await coordinator.recordClaim(id1, 'worker-1');

      const assigned = coordinator.getAssignments({ status: 'assigned' });
      expect(assigned).toHaveLength(1);

      const pending = coordinator.getAssignments({ status: 'pending' });
      expect(pending).toHaveLength(1);
    });

    it('should filter by capability', async () => {
      await coordinator.submitWork({
        taskId: 'task-1',
        capability: 'typescript',
        description: 'Task 1',
      });
      await coordinator.submitWork({
        taskId: 'task-2',
        capability: 'python',
        description: 'Task 2',
      });

      const tsAssignments = coordinator.getAssignments({ capability: 'typescript' });
      expect(tsAssignments).toHaveLength(1);
    });
  });

  describe('timeout handling', () => {
    it('should timeout pending assignments', async () => {
      const coord = createCoordinator({
        ...defaultConfig,
        assignmentTimeoutMs: 1000,
        maxAttempts: 2,
      });

      await coord.submitWork({
        taskId: 'task-123',
        capability: 'typescript',
        description: 'Test task',
      });

      // Fast forward past timeout
      await vi.advanceTimersByTimeAsync(1500);

      // Should have triggered retry
      expect(publishWorkItem).toHaveBeenCalledTimes(2);

      coord.shutdown();
    });
  });
});
