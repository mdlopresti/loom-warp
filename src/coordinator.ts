/**
 * Optional Coordinator Agent
 *
 * Provides a centralized work coordination pattern using NATS MCP primitives.
 * This is an OPTIONAL component - agents can also use the decentralized
 * work queue pattern directly.
 *
 * The coordinator:
 * - Receives work requests from agents
 * - Discovers capable workers
 * - Assigns work and tracks progress
 * - Handles failures and retries
 */

import { randomUUID } from 'crypto';
import { createLogger } from './logger.js';
import { listRegistryEntries } from './kv.js';
import { isVisibleTo, type Requester } from './registry.js';
import type { RegistryEntry, WorkItem } from './types.js';
import { publishWorkItem, createWorkQueueStream } from './workqueue.js';
import { moveToDeadLetter } from './dlq.js';

const logger = createLogger('coordinator');

/**
 * Work assignment tracking
 */
interface WorkAssignment {
  workItemId: string;
  taskId: string;
  capability: string;
  assignedTo: string | null;  // Worker GUID
  assignedAt: string | null;
  status: 'pending' | 'assigned' | 'in-progress' | 'completed' | 'failed';
  progress: number;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  completedAt: string | null;
  result?: Record<string, unknown>;
  error?: string;
}

/**
 * Coordinator configuration
 */
export interface CoordinatorConfig {
  /** Maximum assignment attempts before moving to DLQ (default: 3) */
  maxAttempts?: number;
  /** Assignment timeout in ms (default: 300000 = 5 min) */
  assignmentTimeoutMs?: number;
  /** Whether to auto-retry failed assignments (default: true) */
  autoRetry?: boolean;
  /** Coordinator's agent GUID (required) */
  coordinatorGuid: string;
  /** Coordinator's project ID (required) */
  projectId: string;
  /** Coordinator's username (optional) */
  username?: string;
}

/**
 * Work request from an agent
 */
export interface WorkRequest {
  taskId: string;
  capability: string;
  description: string;
  priority?: number;
  deadline?: string;
  contextData?: Record<string, unknown>;
  preferredWorker?: string;  // Preferred worker GUID
}

/**
 * Coordinator class for centralized work management
 */
export class Coordinator {
  private config: Required<Omit<CoordinatorConfig, 'username'>> & { username?: string };
  private assignments: Map<string, WorkAssignment> = new Map();
  private timeoutCheckers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: CoordinatorConfig) {
    const baseConfig = {
      maxAttempts: config.maxAttempts ?? 3,
      assignmentTimeoutMs: config.assignmentTimeoutMs ?? 300000,
      autoRetry: config.autoRetry ?? true,
      coordinatorGuid: config.coordinatorGuid,
      projectId: config.projectId,
    };

    this.config = config.username
      ? { ...baseConfig, username: config.username }
      : baseConfig;

    logger.info('Coordinator initialized', {
      maxAttempts: this.config.maxAttempts,
      assignmentTimeoutMs: this.config.assignmentTimeoutMs,
    });
  }

  /**
   * Get requester context for visibility checks
   */
  private getRequester(): Requester {
    const requester: Requester = {
      guid: this.config.coordinatorGuid,
      projectId: this.config.projectId,
    };
    if (this.config.username) {
      requester.username = this.config.username;
    }
    return requester;
  }

  /**
   * Find available workers for a capability
   */
  async findWorkers(capability: string): Promise<RegistryEntry[]> {
    const requester = this.getRequester();
    const allEntries = await listRegistryEntries();

    const workers = allEntries.filter(entry => {
      // Must have the required capability
      if (!entry.capabilities.includes(capability)) {
        return false;
      }

      // Must be online or busy (not offline)
      if (entry.status === 'offline') {
        return false;
      }

      // Must be visible to coordinator
      if (!isVisibleTo(entry, requester)) {
        return false;
      }

      // Don't assign to self
      if (entry.guid === this.config.coordinatorGuid) {
        return false;
      }

      return true;
    });

    // Sort by: online first, then by current task count (ascending)
    workers.sort((a, b) => {
      if (a.status === 'online' && b.status !== 'online') return -1;
      if (b.status === 'online' && a.status !== 'online') return 1;
      return a.currentTaskCount - b.currentTaskCount;
    });

    logger.debug('Found workers for capability', {
      capability,
      count: workers.length,
    });

    return workers;
  }

  /**
   * Submit a work request and get a work item ID
   */
  async submitWork(request: WorkRequest): Promise<string> {
    const workItemId = randomUUID();
    const now = new Date().toISOString();

    // Create assignment tracking
    const assignment: WorkAssignment = {
      workItemId,
      taskId: request.taskId,
      capability: request.capability,
      assignedTo: null,
      assignedAt: null,
      status: 'pending',
      progress: 0,
      attempts: 0,
      maxAttempts: this.config.maxAttempts,
      createdAt: now,
      completedAt: null,
    };

    this.assignments.set(workItemId, assignment);

    // Create work item
    const workItem: WorkItem = {
      id: workItemId,
      taskId: request.taskId,
      capability: request.capability,
      description: request.description,
      priority: request.priority ?? 5,
      offeredBy: this.config.coordinatorGuid,
      offeredAt: now,
      attempts: 0,
    };
    if (request.deadline) {
      workItem.deadline = request.deadline;
    }
    if (request.contextData) {
      workItem.contextData = request.contextData;
    }

    // Ensure work queue stream exists
    await createWorkQueueStream(request.capability);

    // Publish to work queue
    await publishWorkItem(workItem);

    logger.info('Work submitted', {
      workItemId,
      taskId: request.taskId,
      capability: request.capability,
      priority: request.priority,
    });

    // Start timeout checker
    this.startTimeoutChecker(workItemId);

    return workItemId;
  }

  /**
   * Record that a worker has claimed the work
   */
  async recordClaim(workItemId: string, workerGuid: string): Promise<boolean> {
    const assignment = this.assignments.get(workItemId);
    if (!assignment) {
      logger.warn('Claim for unknown work item', { workItemId, workerGuid });
      return false;
    }

    if (assignment.status !== 'pending') {
      logger.warn('Claim for non-pending work', {
        workItemId,
        status: assignment.status,
        workerGuid,
      });
      return false;
    }

    assignment.assignedTo = workerGuid;
    assignment.assignedAt = new Date().toISOString();
    assignment.status = 'assigned';
    assignment.attempts += 1;

    logger.info('Work claimed', {
      workItemId,
      workerGuid,
      attempt: assignment.attempts,
    });

    // Reset timeout checker
    this.resetTimeoutChecker(workItemId);

    return true;
  }

  /**
   * Record progress update from worker
   */
  recordProgress(workItemId: string, progress: number, message?: string): boolean {
    const assignment = this.assignments.get(workItemId);
    if (!assignment) {
      logger.warn('Progress for unknown work item', { workItemId });
      return false;
    }

    if (assignment.status !== 'assigned' && assignment.status !== 'in-progress') {
      logger.warn('Progress for non-active work', {
        workItemId,
        status: assignment.status,
      });
      return false;
    }

    assignment.status = 'in-progress';
    assignment.progress = Math.min(100, Math.max(0, progress));

    logger.debug('Progress updated', {
      workItemId,
      progress: assignment.progress,
      message,
    });

    // Reset timeout checker on progress
    this.resetTimeoutChecker(workItemId);

    return true;
  }

  /**
   * Record work completion
   */
  recordCompletion(
    workItemId: string,
    result?: Record<string, unknown>,
    summary?: string
  ): boolean {
    const assignment = this.assignments.get(workItemId);
    if (!assignment) {
      logger.warn('Completion for unknown work item', { workItemId });
      return false;
    }

    assignment.status = 'completed';
    assignment.progress = 100;
    assignment.completedAt = new Date().toISOString();
    if (result) {
      assignment.result = result;
    }

    // Clear timeout checker
    this.clearTimeoutChecker(workItemId);

    logger.info('Work completed', {
      workItemId,
      taskId: assignment.taskId,
      worker: assignment.assignedTo,
      summary,
    });

    return true;
  }

  /**
   * Record work error
   */
  async recordError(
    workItemId: string,
    error: string,
    recoverable: boolean
  ): Promise<boolean> {
    const assignment = this.assignments.get(workItemId);
    if (!assignment) {
      logger.warn('Error for unknown work item', { workItemId });
      return false;
    }

    assignment.error = error;

    logger.warn('Work error', {
      workItemId,
      error,
      recoverable,
      attempts: assignment.attempts,
    });

    if (recoverable && this.config.autoRetry && assignment.attempts < assignment.maxAttempts) {
      // Retry by resetting to pending
      assignment.status = 'pending';
      assignment.assignedTo = null;
      assignment.assignedAt = null;
      assignment.progress = 0;

      // Republish to work queue
      const workItem: WorkItem = {
        id: workItemId,
        taskId: assignment.taskId,
        capability: assignment.capability,
        description: `Retry attempt ${assignment.attempts + 1}`,
        priority: 7, // Higher priority for retries
        offeredBy: this.config.coordinatorGuid,
        offeredAt: new Date().toISOString(),
        attempts: assignment.attempts,
      };

      await publishWorkItem(workItem);
      this.startTimeoutChecker(workItemId);

      logger.info('Work requeued for retry', {
        workItemId,
        attempt: assignment.attempts,
      });
    } else {
      // Move to failed
      assignment.status = 'failed';
      this.clearTimeoutChecker(workItemId);

      // Move to DLQ
      const workItem: WorkItem = {
        id: workItemId,
        taskId: assignment.taskId,
        capability: assignment.capability,
        description: 'Failed work item',
        offeredBy: this.config.coordinatorGuid,
        offeredAt: assignment.createdAt,
        attempts: assignment.attempts,
      };

      await moveToDeadLetter(workItem, error, [error]);

      logger.warn('Work moved to dead letter queue', {
        workItemId,
        attempts: assignment.attempts,
        error,
      });
    }

    return true;
  }

  /**
   * Get assignment status
   */
  getAssignment(workItemId: string): WorkAssignment | undefined {
    return this.assignments.get(workItemId);
  }

  /**
   * Get all assignments with optional filter
   */
  getAssignments(filter?: {
    status?: WorkAssignment['status'];
    capability?: string;
  }): WorkAssignment[] {
    let result = Array.from(this.assignments.values());

    if (filter?.status) {
      result = result.filter(a => a.status === filter.status);
    }

    if (filter?.capability) {
      result = result.filter(a => a.capability === filter.capability);
    }

    return result;
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    pending: number;
    assigned: number;
    inProgress: number;
    completed: number;
    failed: number;
  } {
    const assignments = Array.from(this.assignments.values());
    return {
      total: assignments.length,
      pending: assignments.filter(a => a.status === 'pending').length,
      assigned: assignments.filter(a => a.status === 'assigned').length,
      inProgress: assignments.filter(a => a.status === 'in-progress').length,
      completed: assignments.filter(a => a.status === 'completed').length,
      failed: assignments.filter(a => a.status === 'failed').length,
    };
  }

  /**
   * Start timeout checker for an assignment
   */
  private startTimeoutChecker(workItemId: string): void {
    this.clearTimeoutChecker(workItemId);

    const timeout = setTimeout(async () => {
      const assignment = this.assignments.get(workItemId);
      if (assignment && (assignment.status === 'pending' || assignment.status === 'assigned')) {
        logger.warn('Work assignment timed out', {
          workItemId,
          status: assignment.status,
        });

        await this.recordError(workItemId, 'Assignment timed out', true);
      }
    }, this.config.assignmentTimeoutMs);

    this.timeoutCheckers.set(workItemId, timeout);
  }

  /**
   * Reset timeout checker
   */
  private resetTimeoutChecker(workItemId: string): void {
    this.startTimeoutChecker(workItemId);
  }

  /**
   * Clear timeout checker
   */
  private clearTimeoutChecker(workItemId: string): void {
    const timeout = this.timeoutCheckers.get(workItemId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeoutCheckers.delete(workItemId);
    }
  }

  /**
   * Clean up all resources
   */
  shutdown(): void {
    for (const timeout of this.timeoutCheckers.values()) {
      clearTimeout(timeout);
    }
    this.timeoutCheckers.clear();

    logger.info('Coordinator shutdown', {
      pendingAssignments: this.getStats().pending,
    });
  }
}

/**
 * Create a coordinator instance
 */
export function createCoordinator(config: CoordinatorConfig): Coordinator {
  return new Coordinator(config);
}
