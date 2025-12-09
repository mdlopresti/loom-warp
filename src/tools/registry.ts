/**
 * Registry tools: register_agent
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { hostname } from 'os';
import { randomUUID } from 'crypto';
import type { SessionState, RegistryEntry, ResolvedConfig, InboxMessage, WorkItem } from '../types.js';
import { createLogger } from '../logger.js';
import { createRegistryEntry, isVisibleTo, redactEntry, type Requester } from '../registry.js';
import { initializeRegistry, putRegistryEntry, listRegistryEntries, getRegistryEntry } from '../kv.js';
import { validateHandle } from './handle.js';
import { startHeartbeat, stopHeartbeat } from '../heartbeat.js';
import { createInboxStream, subscribeToInbox, unsubscribeFromInbox, getInboxSubject } from '../inbox.js';
import { getJetStreamClient, getJetStreamManager } from '../nats.js';
import { createWorkQueueStream, publishWorkItem, getWorkQueueSubject, claimWorkItem } from '../workqueue.js';
import { listDeadLetterItems, retryDeadLetterItem, discardDeadLetterItem } from '../dlq.js';

const logger = createLogger('tools:registry');

/** Heartbeat cleanup function for the current session */
let heartbeatCleanup: (() => void) | null = null;

/** Inbox unsubscribe function for the current session */
let inboxUnsubscribe: (() => void) | null = null;

/**
 * Tool definitions for registry management
 */
export const registryTools: Tool[] = [
  {
    name: 'register_agent',
    description:
      'Register this agent in the global registry for discovery by other agents. ' +
      'This enables cross-computer agent communication by publishing your agent details to the shared KV store.',
    inputSchema: {
      type: 'object',
      properties: {
        agentType: {
          type: 'string',
          description: 'Type of agent (e.g., "developer", "reviewer", "tester", "project-manager")',
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of capabilities this agent has (e.g., ["typescript", "testing"])',
        },
        scope: {
          type: 'string',
          enum: ['user', 'project'],
          description: 'Scope of visibility: "user" for user-level, "project" for project-level (default: "project")',
        },
        visibility: {
          type: 'string',
          enum: ['private', 'project-only', 'user-only', 'public'],
          description:
            'Who can discover this agent: "private" (only self), "project-only" (same project), ' +
            '"user-only" (same user), "public" (everyone). Default: "project-only"',
        },
      },
      required: ['agentType'],
    },
  },
  {
    name: 'discover_agents',
    description:
      'Discover other agents in the registry. Search for agents by type, capability, status, or other criteria. ' +
      'Results are filtered based on visibility rules and only include agents you have permission to see.',
    inputSchema: {
      type: 'object',
      properties: {
        agentType: {
          type: 'string',
          description: 'Filter by agent type (e.g., "developer", "reviewer")',
        },
        capability: {
          type: 'string',
          description: 'Filter by capability - agent must have this capability (e.g., "typescript", "testing")',
        },
        hostname: {
          type: 'string',
          description: 'Filter by hostname',
        },
        projectId: {
          type: 'string',
          description: 'Filter by project ID (16-character hex string)',
        },
        status: {
          type: 'string',
          enum: ['online', 'busy', 'offline'],
          description: 'Filter by agent status',
        },
        scope: {
          type: 'string',
          enum: ['user', 'project'],
          description: 'Filter by scope',
        },
        includeOffline: {
          type: 'boolean',
          description: 'Include offline agents in results (default: false)',
        },
      },
    },
  },
  {
    name: 'get_agent_info',
    description:
      'Retrieve detailed information about a specific agent by GUID. ' +
      'Returns information based on visibility rules - you can only view agents that are visible to you.',
    inputSchema: {
      type: 'object',
      properties: {
        guid: {
          type: 'string',
          description: 'GUID of the agent to look up (UUID v4 format)',
        },
      },
      required: ['guid'],
    },
  },
  {
    name: 'update_presence',
    description:
      'Update your agent presence information in the registry. ' +
      'You can update status, current task count, and capabilities. ' +
      'Setting status to "offline" will stop the automated heartbeat.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['online', 'busy', 'offline'],
          description: 'Update agent status',
        },
        currentTaskCount: {
          type: 'number',
          description: 'Update current task count',
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Update capabilities list',
        },
      },
    },
  },
  {
    name: 'deregister_agent',
    description:
      'Deregister this agent from the global registry. ' +
      'Stops heartbeat, unsubscribes from inbox, and marks the agent as offline. ' +
      'The agent entry is preserved in the registry for historical purposes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'send_direct_message',
    description:
      'Send a direct message to another agent via their personal inbox. ' +
      'Messages are delivered reliably via JetStream and queued if the recipient is offline.',
    inputSchema: {
      type: 'object',
      properties: {
        recipientGuid: {
          type: 'string',
          description: 'GUID of the recipient agent (UUID v4 format)',
        },
        message: {
          type: 'string',
          description: 'Message content to send',
        },
        messageType: {
          type: 'string',
          description: 'Type of message (e.g., "text", "work-offer", "work-claim"). Default: "text"',
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata to include with the message',
          additionalProperties: true,
        },
      },
      required: ['recipientGuid', 'message'],
    },
  },
  {
    name: 'read_direct_messages',
    description:
      'Read direct messages from your personal inbox. ' +
      'Messages are retrieved from the inbox stream and can be filtered by type or sender. ' +
      'Retrieved messages are acknowledged and will not be returned in subsequent reads.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of messages to return (default: 10, max: 100)',
          minimum: 1,
          maximum: 100,
        },
        messageType: {
          type: 'string',
          description: 'Filter by message type (e.g., "text", "work-offer", "work-claim")',
        },
        senderGuid: {
          type: 'string',
          description: 'Filter by sender GUID (UUID v4 format)',
        },
      },
    },
  },
  {
    name: 'broadcast_work_offer',
    description:
      'Broadcast a work offer to the global work queue for a specific capability. ' +
      'Capable agents can claim the work from the queue. ' +
      'Work items are published to a capability-specific queue and delivered to competing consumers.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Application-defined task identifier (e.g., "task-123", "bug-456")',
        },
        description: {
          type: 'string',
          description: 'Human-readable description of the task',
        },
        requiredCapability: {
          type: 'string',
          description: 'Required capability for this task (e.g., "typescript", "code-review", "testing")',
        },
        priority: {
          type: 'number',
          description: 'Priority level from 1-10, where 10 is highest (default: 5)',
          minimum: 1,
          maximum: 10,
        },
        deadline: {
          type: 'string',
          description: 'Optional ISO 8601 deadline for task completion (e.g., "2024-12-31T23:59:59Z")',
        },
        contextData: {
          type: 'object',
          description: 'Optional application-specific context data for the task',
          additionalProperties: true,
        },
      },
      required: ['taskId', 'description', 'requiredCapability'],
    },
  },
  {
    name: 'claim_work',
    description:
      'Claim work from a capability-based work queue. ' +
      'Fetches the next available work item for the specified capability. ' +
      'The agent must have the required capability registered. ' +
      'Once claimed, the work item is removed from the queue and the agent is responsible for completing it.',
    inputSchema: {
      type: 'object',
      properties: {
        capability: {
          type: 'string',
          description: 'The capability to claim work for (e.g., "typescript", "code-review", "testing")',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time in milliseconds to wait for work (default: 5000, max: 30000)',
          minimum: 100,
          maximum: 30000,
        },
      },
      required: ['capability'],
    },
  },
  {
    name: 'list_dead_letter_items',
    description:
      'List items in the dead letter queue (DLQ). ' +
      'These are work items that failed after maximum delivery attempts. ' +
      'You can filter by capability and limit the number of results.',
    inputSchema: {
      type: 'object',
      properties: {
        capability: {
          type: 'string',
          description: 'Filter by capability (e.g., "typescript", "code-review")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of items to return (default: 20, max: 100)',
          minimum: 1,
          maximum: 100,
        },
      },
    },
  },
  {
    name: 'retry_dead_letter_item',
    description:
      'Retry a dead letter queue item by moving it back to the work queue. ' +
      'Optionally reset the attempt counter to give it a fresh start.',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: {
          type: 'string',
          description: 'DLQ item ID (UUID format) to retry',
        },
        resetAttempts: {
          type: 'boolean',
          description: 'Reset the attempt counter to 0 (default: false)',
        },
      },
      required: ['itemId'],
    },
  },
  {
    name: 'discard_dead_letter_item',
    description:
      'Permanently delete a dead letter queue item. ' +
      'This action cannot be undone. Use this when a work item is no longer needed.',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: {
          type: 'string',
          description: 'DLQ item ID (UUID format) to discard',
        },
      },
      required: ['itemId'],
    },
  },
];

/**
 * Generate a handle from agent type if no handle is set
 */
function generateHandle(agentType: string): string {
  // Convert to lowercase and replace spaces/underscores with hyphens
  const base = agentType.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
  return base || 'agent';
}

/**
 * Check if an agent with the same handle exists and is offline
 * Returns the existing GUID if we should reuse it, null otherwise
 */
async function findReusableAgent(
  handle: string,
  projectId: string,
  hostnameStr: string
): Promise<string | null> {
  try {
    const entries = await listRegistryEntries((entry) => {
      return (
        entry.handle === handle &&
        entry.projectId === projectId &&
        entry.hostname === hostnameStr &&
        entry.status === 'offline'
      );
    });

    if (entries.length > 0) {
      // Reuse the first matching offline agent
      logger.info('Found offline agent with same handle, reusing GUID', {
        guid: entries[0]!.guid,
        handle,
      });
      return entries[0]!.guid;
    }

    return null;
  } catch (err) {
    const error = err as Error;
    logger.warn('Failed to check for reusable agent', { error: error.message });
    return null;
  }
}

/**
 * Handle register_agent tool
 */
export async function handleRegisterAgent(
  args: Record<string, unknown>,
  state: SessionState,
  config: ResolvedConfig
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const agentType = args['agentType'] as string;
  const capabilities = (args['capabilities'] as string[] | undefined) ?? [];
  const scope = (args['scope'] as 'user' | 'project' | undefined) ?? 'project';
  const visibility = (args['visibility'] as
    | 'private'
    | 'project-only'
    | 'user-only'
    | 'public'
    | undefined) ?? 'project-only';

  // Validate agent type
  if (!agentType || agentType.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: agentType cannot be empty' }],
      isError: true,
    };
  }

  // Auto-set handle if not already set
  let handle = state.handle;
  if (!handle) {
    handle = generateHandle(agentType);
    const validationError = validateHandle(handle);
    if (validationError) {
      return {
        content: [{ type: 'text', text: `Error: Generated handle is invalid: ${validationError}` }],
        isError: true,
      };
    }
    state.handle = handle;
    logger.info('Auto-generated handle from agentType', { handle, agentType });
  }

  // Auto-detect environment details
  const hostnameStr = hostname();
  const username = process.env['USER'] || process.env['USERNAME'];
  const natsUrl = config.natsUrl;
  const projectPath = config.projectPath;

  // Initialize registry if not already done
  try {
    await initializeRegistry();
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to initialize registry', { error: error.message });
    return {
      content: [{ type: 'text', text: `Error: Failed to initialize registry: ${error.message}` }],
      isError: true,
    };
  }

  // Check if we can reuse an existing offline agent
  const projectId = createRegistryEntry({
    agentType,
    handle,
    hostname: hostnameStr,
    projectPath,
    natsUrl,
  }).projectId;

  const reusableGuid = await findReusableAgent(handle, projectId, hostnameStr);

  // Build entry params, conditionally including username
  const entryParams = {
    agentType,
    handle,
    hostname: hostnameStr,
    projectPath,
    natsUrl,
    capabilities,
    scope,
    visibility,
    ...(username ? { username } : {}),
  };

  let entry: RegistryEntry;
  if (reusableGuid) {
    // Reuse existing GUID and create updated entry
    entry = createRegistryEntry(entryParams);
    // Override the GUID with the reusable one
    entry = { ...entry, guid: reusableGuid };
  } else {
    // Create new entry with new GUID
    entry = createRegistryEntry(entryParams);
  }

  // Publish to KV store
  try {
    await putRegistryEntry(entry.guid, entry);
    logger.info('Agent registered', { guid: entry.guid, handle, agentType });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to publish registry entry', { error: error.message });
    return {
      content: [
        { type: 'text', text: `Error: Failed to publish to registry: ${error.message}` },
      ],
      isError: true,
    };
  }

  // Update session state
  state.agentGuid = entry.guid;
  state.registeredEntry = entry;

  // Start automated heartbeat
  // Stop any existing heartbeat first
  if (heartbeatCleanup) {
    heartbeatCleanup();
  }

  heartbeatCleanup = startHeartbeat(entry.guid, {
    intervalMs: 60000, // 60 seconds
    onError: (error) => {
      logger.warn('Heartbeat error', { guid: entry.guid, error: error.message });
    },
  });

  logger.info('Heartbeat started for agent', { guid: entry.guid });

  // Create inbox stream and subscribe
  try {
    // Stop any existing inbox subscription first
    if (inboxUnsubscribe) {
      await inboxUnsubscribe();
      inboxUnsubscribe = null;
    }

    // Create inbox stream
    await createInboxStream(entry.guid);
    logger.info('Inbox stream created for agent', { guid: entry.guid });

    // Subscribe to inbox (for now, just log received messages)
    inboxUnsubscribe = await subscribeToInbox(entry.guid, (message: InboxMessage) => {
      logger.info('Received inbox message', {
        id: message.id,
        senderGuid: message.senderGuid,
        senderHandle: message.senderHandle,
        messageType: message.messageType,
        content: message.content.substring(0, 100), // Log first 100 chars
      });
    });

    logger.info('Subscribed to inbox for agent', { guid: entry.guid });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to setup inbox', { guid: entry.guid, error: error.message });
    // Don't fail registration if inbox setup fails
  }

  // Build response message
  const summary = [
    'Agent registered successfully!',
    '',
    `GUID: ${entry.guid}`,
    `Handle: ${entry.handle}`,
    `Agent Type: ${entry.agentType}`,
    `Hostname: ${entry.hostname}`,
    `Project ID: ${entry.projectId}`,
    `Scope: ${entry.scope}`,
    `Visibility: ${entry.visibility}`,
    `Capabilities: ${entry.capabilities.length > 0 ? entry.capabilities.join(', ') : 'none'}`,
    '',
    reusableGuid
      ? 'Note: Reused GUID from previous offline agent with same handle'
      : 'Note: New GUID generated for this registration',
    '',
    'Heartbeat: Automatic heartbeat started (60 second interval)',
    `Inbox: Personal inbox created at subject global.agent.${entry.guid}`,
  ].join('\n');

  return {
    content: [{ type: 'text', text: summary }],
  };
}

/**
 * Stop the heartbeat (cleanup function)
 * Call this when shutting down the server
 */
export function cleanupHeartbeat(): void {
  if (heartbeatCleanup) {
    heartbeatCleanup();
    heartbeatCleanup = null;
  }
}

/**
 * Handle get_agent_info tool
 */
export async function handleGetAgentInfo(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const guid = args['guid'] as string;

  // Validate GUID format
  const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!guid || !UUID_V4_PATTERN.test(guid)) {
    return {
      content: [{ type: 'text', text: 'Error: Invalid GUID format. Must be a valid UUID v4.' }],
      isError: true,
    };
  }

  // Require caller to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to view agent information. Use register_agent first.',
        },
      ],
      isError: true,
    };
  }

  // Get requester context
  const requester: Requester = {
    guid: state.agentGuid,
    projectId: state.registeredEntry.projectId,
    ...(state.registeredEntry.username ? { username: state.registeredEntry.username } : {}),
  };

  // Retrieve the agent entry
  let entry: RegistryEntry | null;
  try {
    entry = await getRegistryEntry(guid);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to retrieve agent entry', { guid, error: error.message });
    return {
      content: [{ type: 'text', text: `Error: Failed to retrieve agent: ${error.message}` }],
      isError: true,
    };
  }

  // Check if entry exists
  if (!entry) {
    return {
      content: [{ type: 'text', text: 'Error: Agent not found or not visible to you.' }],
      isError: true,
    };
  }

  // Check visibility
  if (!isVisibleTo(entry, requester)) {
    return {
      content: [{ type: 'text', text: 'Error: Agent not found or not visible to you.' }],
      isError: true,
    };
  }

  // Redact sensitive fields
  const redactedEntry = redactEntry(entry, requester);

  // Build markdown response
  const lines = [`## Agent: ${entry.handle}`, '', '| Field | Value |', '|-------|-------|'];

  // Add fields that are present in redacted entry
  if (redactedEntry.guid) {
    lines.push(`| GUID | ${redactedEntry.guid} |`);
  }
  if (redactedEntry.agentType) {
    lines.push(`| Type | ${redactedEntry.agentType} |`);
  }
  if (redactedEntry.status) {
    lines.push(`| Status | ${redactedEntry.status} |`);
  }
  if (redactedEntry.hostname) {
    lines.push(`| Hostname | ${redactedEntry.hostname} |`);
  }
  if (redactedEntry.capabilities && redactedEntry.capabilities.length > 0) {
    lines.push(`| Capabilities | ${redactedEntry.capabilities.join(', ')} |`);
  } else if (redactedEntry.capabilities) {
    lines.push(`| Capabilities | none |`);
  }
  if (redactedEntry.scope) {
    lines.push(`| Scope | ${redactedEntry.scope} |`);
  }
  if (redactedEntry.lastHeartbeat) {
    lines.push(`| Last Heartbeat | ${redactedEntry.lastHeartbeat} |`);
  }
  if (redactedEntry.registeredAt) {
    lines.push(`| Registered At | ${redactedEntry.registeredAt} |`);
  }
  if (redactedEntry.currentTaskCount !== undefined) {
    lines.push(`| Current Tasks | ${redactedEntry.currentTaskCount} |`);
  }
  if (redactedEntry.projectId) {
    lines.push(`| Project ID | ${redactedEntry.projectId} |`);
  }
  if (redactedEntry.natsUrl) {
    lines.push(`| NATS URL | ${redactedEntry.natsUrl} |`);
  }
  if (redactedEntry.username) {
    lines.push(`| Username | ${redactedEntry.username} |`);
  }

  const summary = lines.join('\n');

  logger.debug('Retrieved agent info', { guid, handle: entry.handle });

  return {
    content: [{ type: 'text', text: summary }],
  };
}

/**
 * Handle update_presence tool
 */
export async function handleUpdatePresence(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Require caller to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to update presence. Use register_agent first.',
        },
      ],
      isError: true,
    };
  }

  const status = args['status'] as 'online' | 'busy' | 'offline' | undefined;
  const currentTaskCount = args['currentTaskCount'] as number | undefined;
  const capabilities = args['capabilities'] as string[] | undefined;

  // Validate at least one field is provided
  if (status === undefined && currentTaskCount === undefined && capabilities === undefined) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: At least one field (status, currentTaskCount, or capabilities) must be provided',
        },
      ],
      isError: true,
    };
  }

  const guid = state.agentGuid;

  // Get current entry from KV store
  let currentEntry: RegistryEntry | null;
  try {
    currentEntry = await getRegistryEntry(guid);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to retrieve current registry entry', { guid, error: error.message });
    return {
      content: [
        { type: 'text', text: `Error: Failed to retrieve current entry: ${error.message}` },
      ],
      isError: true,
    };
  }

  if (!currentEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: Registry entry not found. You may need to re-register.',
        },
      ],
      isError: true,
    };
  }

  // Track changes for response
  const changes: string[] = [];

  // Update only provided fields
  const updatedEntry: RegistryEntry = {
    ...currentEntry,
    lastHeartbeat: new Date().toISOString(), // Always update lastHeartbeat
  };

  if (status !== undefined) {
    changes.push(`- Status: ${currentEntry.status} → ${status}`);
    updatedEntry.status = status;
  }

  if (currentTaskCount !== undefined) {
    changes.push(`- Current Tasks: ${currentEntry.currentTaskCount} → ${currentTaskCount}`);
    updatedEntry.currentTaskCount = currentTaskCount;
  }

  if (capabilities !== undefined) {
    const oldCaps = currentEntry.capabilities.join(', ') || 'none';
    const newCaps = capabilities.join(', ') || 'none';
    changes.push(`- Capabilities: [${oldCaps}] → [${newCaps}]`);
    updatedEntry.capabilities = capabilities;
  }

  changes.push(`- Last Heartbeat: ${updatedEntry.lastHeartbeat}`);

  // Put updated entry back to KV store
  try {
    await putRegistryEntry(guid, updatedEntry);
    logger.info('Updated presence', { guid, changes: changes.length });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to update registry entry', { guid, error: error.message });
    return {
      content: [{ type: 'text', text: `Error: Failed to update presence: ${error.message}` }],
      isError: true,
    };
  }

  // Update session state to match
  state.registeredEntry = updatedEntry;

  // If status is set to offline, stop the heartbeat
  if (status === 'offline') {
    if (heartbeatCleanup) {
      heartbeatCleanup();
      heartbeatCleanup = null;
      logger.info('Stopped heartbeat due to offline status', { guid });
    }
    stopHeartbeat();
  }

  // Build response message
  const summary = ['Presence updated:', '', ...changes].join('\n');

  return {
    content: [{ type: 'text', text: summary }],
  };
}

/**
 * Handle discover_agents tool
 */
export async function handleDiscoverAgents(
  args: Record<string, unknown>,
  state: SessionState,
  _config: ResolvedConfig
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Require the caller to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must register first using register_agent before discovering other agents',
        },
      ],
      isError: true,
    };
  }

  const agentType = args['agentType'] as string | undefined;
  const capability = args['capability'] as string | undefined;
  const hostnameFilter = args['hostname'] as string | undefined;
  const projectId = args['projectId'] as string | undefined;
  const status = args['status'] as 'online' | 'busy' | 'offline' | undefined;
  const scope = args['scope'] as 'user' | 'project' | undefined;
  const includeOffline = (args['includeOffline'] as boolean | undefined) ?? false;

  // Initialize registry if not already done
  try {
    await initializeRegistry();
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to initialize registry', { error: error.message });
    return {
      content: [{ type: 'text', text: `Error: Failed to initialize registry: ${error.message}` }],
      isError: true,
    };
  }

  // Get requester context
  const requester: Requester = {
    projectId: state.registeredEntry.projectId,
    guid: state.registeredEntry.guid,
    ...(state.registeredEntry.username ? { username: state.registeredEntry.username } : {}),
  };

  // List all entries
  let entries: RegistryEntry[];
  try {
    entries = await listRegistryEntries();
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to list registry entries', { error: error.message });
    return {
      content: [
        { type: 'text', text: `Error: Failed to list registry entries: ${error.message}` },
      ],
      isError: true,
    };
  }

  // Apply filters
  let filteredEntries = entries;

  // Filter by agentType
  if (agentType) {
    filteredEntries = filteredEntries.filter((entry) => entry.agentType === agentType);
  }

  // Filter by capability
  if (capability) {
    filteredEntries = filteredEntries.filter((entry) =>
      entry.capabilities.includes(capability)
    );
  }

  // Filter by hostname
  if (hostnameFilter) {
    filteredEntries = filteredEntries.filter((entry) => entry.hostname === hostnameFilter);
  }

  // Filter by projectId
  if (projectId) {
    filteredEntries = filteredEntries.filter((entry) => entry.projectId === projectId);
  }

  // Filter by status
  if (status) {
    filteredEntries = filteredEntries.filter((entry) => entry.status === status);
  }

  // Filter by scope
  if (scope) {
    filteredEntries = filteredEntries.filter((entry) => entry.scope === scope);
  }

  // Exclude offline agents by default
  if (!includeOffline) {
    filteredEntries = filteredEntries.filter((entry) => entry.status !== 'offline');
  }

  // Apply visibility filtering and redaction
  const visibleEntries = filteredEntries
    .filter((entry) => isVisibleTo(entry, requester))
    .map((entry) => redactEntry(entry, requester));

  // Sort by lastHeartbeat descending (most recent first)
  visibleEntries.sort((a, b) => {
    const aTime = a.lastHeartbeat ? new Date(a.lastHeartbeat).getTime() : 0;
    const bTime = b.lastHeartbeat ? new Date(b.lastHeartbeat).getTime() : 0;
    return bTime - aTime;
  });

  // Build response
  if (visibleEntries.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No agents found matching the specified criteria.',
        },
      ],
    };
  }

  // Format response as markdown
  const lines = [`Found ${visibleEntries.length} agent${visibleEntries.length === 1 ? '' : 's'}:`, ''];

  for (const entry of visibleEntries) {
    lines.push(`**${entry.handle}** (${entry.agentType})`);
    lines.push(`- GUID: ${entry.guid}`);
    lines.push(`- Status: ${entry.status}`);
    if (entry.capabilities && entry.capabilities.length > 0) {
      lines.push(`- Capabilities: [${entry.capabilities.join(', ')}]`);
    }
    if (entry.lastHeartbeat) {
      lines.push(`- Last seen: ${entry.lastHeartbeat}`);
    }
    if (entry.hostname) {
      lines.push(`- Hostname: ${entry.hostname}`);
    }
    if (entry.projectId) {
      lines.push(`- Project ID: ${entry.projectId}`);
    }
    if (entry.currentTaskCount !== undefined) {
      lines.push(`- Current tasks: ${entry.currentTaskCount}`);
    }
    lines.push('');
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
  };
}

/**
 * Handle deregister_agent tool
 */
export async function handleDeregisterAgent(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Require caller to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to deregister. Use register_agent first.',
        },
      ],
      isError: true,
    };
  }

  const guid = state.agentGuid;
  const handle = state.registeredEntry.handle;

  // Stop heartbeat
  logger.info('Stopping heartbeat for agent', { guid });
  if (heartbeatCleanup) {
    heartbeatCleanup();
    heartbeatCleanup = null;
  }
  stopHeartbeat();

  // Unsubscribe from inbox
  logger.info('Unsubscribing from inbox for agent', { guid });
  try {
    if (inboxUnsubscribe) {
      await inboxUnsubscribe();
      inboxUnsubscribe = null;
    }
    await unsubscribeFromInbox();
  } catch (err) {
    const error = err as Error;
    logger.warn('Error unsubscribing from inbox', { guid, error: error.message });
    // Continue with deregistration even if unsubscribe fails
  }

  // Get current entry from KV store
  let entry: RegistryEntry | null;
  try {
    entry = await getRegistryEntry(guid);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to retrieve agent entry for deregistration', { guid, error: error.message });
    return {
      content: [{ type: 'text', text: `Error: Failed to retrieve agent entry: ${error.message}` }],
      isError: true,
    };
  }

  if (!entry) {
    return {
      content: [{ type: 'text', text: 'Error: Agent entry not found in registry.' }],
      isError: true,
    };
  }

  // Update entry to offline status
  const updatedEntry: RegistryEntry = {
    ...entry,
    status: 'offline',
  };

  // Store updated entry back to KV
  try {
    await putRegistryEntry(guid, updatedEntry);
    logger.info('Agent deregistered', { guid, handle });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to update registry entry to offline', { guid, error: error.message });
    return {
      content: [
        { type: 'text', text: `Error: Failed to update registry entry: ${error.message}` },
      ],
      isError: true,
    };
  }

  // Clear session state
  state.agentGuid = null;
  state.registeredEntry = null;

  // Build response message
  const summary = [
    'Agent deregistered successfully.',
    '',
    `- GUID: ${guid}`,
    `- Handle: ${handle}`,
    `- Status: offline`,
    `- Heartbeat: stopped`,
    `- Inbox: unsubscribed`,
  ].join('\n');

  return {
    content: [{ type: 'text', text: summary }],
  };
}

/**
 * Handle send_direct_message tool
 */
export async function handleSendDirectMessage(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const recipientGuid = args['recipientGuid'] as string;
  const message = args['message'] as string;
  const messageType = (args['messageType'] as string | undefined) ?? 'text';
  const metadata = (args['metadata'] as Record<string, unknown> | undefined) ?? undefined;

  // Validate UUID format
  const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!recipientGuid || !UUID_V4_PATTERN.test(recipientGuid)) {
    return {
      content: [{ type: 'text', text: 'Error: Invalid recipientGuid format. Must be a valid UUID v4.' }],
      isError: true,
    };
  }

  // Require sender to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to send messages. Use register_agent first.',
        },
      ],
      isError: true,
    };
  }

  // Look up recipient in registry
  let recipientEntry: RegistryEntry | null;
  try {
    recipientEntry = await getRegistryEntry(recipientGuid);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to retrieve recipient entry', { recipientGuid, error: error.message });
    return {
      content: [{ type: 'text', text: `Error: Failed to retrieve recipient: ${error.message}` }],
      isError: true,
    };
  }

  // Check if recipient exists
  if (!recipientEntry) {
    return {
      content: [{ type: 'text', text: 'Error: Recipient not found in registry.' }],
      isError: true,
    };
  }

  // Warn if recipient is offline or busy (but don't error)
  const recipientStatus = recipientEntry.status;
  const isRecipientOffline = recipientStatus === 'offline';
  const isRecipientBusy = recipientStatus === 'busy';

  // Construct inbox message payload
  const inboxMessage: InboxMessage = {
    id: randomUUID(),
    senderGuid: state.agentGuid,
    senderHandle: state.registeredEntry.handle,
    recipientGuid: recipientGuid,
    messageType: messageType,
    content: message,
    ...(metadata ? { metadata } : {}),
    timestamp: new Date().toISOString(),
  };

  // Get recipient's inbox subject
  const inboxSubject = getInboxSubject(recipientGuid);

  // Publish message to JetStream
  try {
    const js = getJetStreamClient();
    await js.publish(inboxSubject, JSON.stringify(inboxMessage));

    logger.info('Direct message sent', {
      messageId: inboxMessage.id,
      senderGuid: state.agentGuid,
      recipientGuid: recipientGuid,
      messageType: messageType,
      recipientStatus: recipientStatus,
    });

    // Build response with warning if needed
    let summary: string;
    if (isRecipientOffline) {
      summary = [
        'Message sent (recipient may be offline)',
        '',
        `- Message ID: ${inboxMessage.id}`,
        `- To: ${recipientEntry.handle} (${recipientGuid})`,
        `- Type: ${messageType}`,
        `- Recipient Status: offline`,
        `- Note: Message queued for delivery`,
      ].join('\n');
    } else if (isRecipientBusy) {
      summary = [
        'Message sent (recipient is busy)',
        '',
        `- Message ID: ${inboxMessage.id}`,
        `- To: ${recipientEntry.handle} (${recipientGuid})`,
        `- Type: ${messageType}`,
        `- Recipient Status: busy`,
        `- Note: Message delivered to inbox`,
      ].join('\n');
    } else {
      summary = [
        'Message sent successfully!',
        '',
        `- Message ID: ${inboxMessage.id}`,
        `- To: ${recipientEntry.handle} (${recipientGuid})`,
        `- Type: ${messageType}`,
        `- Status: delivered`,
      ].join('\n');
    }

    return {
      content: [{ type: 'text', text: summary }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to send direct message', {
      recipientGuid,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: Failed to send message: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle read_direct_messages tool
 */
export async function handleReadDirectMessages(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const limit = Math.min((args['limit'] as number | undefined) ?? 10, 100);
  const messageType = args['messageType'] as string | undefined;
  const senderGuid = args['senderGuid'] as string | undefined;

  // Validate senderGuid format if provided
  const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (senderGuid && !UUID_V4_PATTERN.test(senderGuid)) {
    return {
      content: [{ type: 'text', text: 'Error: Invalid senderGuid format. Must be a valid UUID v4.' }],
      isError: true,
    };
  }

  // Require reader to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to read messages. Use register_agent first.',
        },
      ],
      isError: true,
    };
  }

  const readerGuid = state.agentGuid;
  const streamName = `INBOX_${readerGuid.replace(/-/g, '_')}`;

  try {
    const jsm = getJetStreamManager();
    const js = getJetStreamClient();

    // Check if inbox stream exists
    try {
      await jsm.streams.info(streamName);
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: 'No direct messages in your inbox.',
          },
        ],
      };
    }

    // Create a consumer to fetch messages
    const consumer = await js.consumers.get(streamName);

    // Fetch messages
    const messages: InboxMessage[] = [];
    const messagesToAck: Array<{ ack: () => void }> = [];

    try {
      // Fetch up to limit messages
      const fetchLimit = limit * 2; // Fetch extra in case some are filtered out
      const iter = await consumer.fetch({ max_messages: fetchLimit });

      for await (const msg of iter) {
        try {
          // Parse message payload
          const payload = JSON.parse(msg.data.toString()) as InboxMessage;

          // Apply filters
          let matches = true;

          if (messageType && payload.messageType !== messageType) {
            matches = false;
          }

          if (senderGuid && payload.senderGuid !== senderGuid) {
            matches = false;
          }

          if (matches) {
            messages.push(payload);
            messagesToAck.push(msg);

            // Stop if we have enough messages
            if (messages.length >= limit) {
              break;
            }
          } else {
            // Acknowledge filtered messages so they don't appear again
            msg.ack();
          }
        } catch (parseErr) {
          const error = parseErr as Error;
          logger.error('Error parsing inbox message', { error: error.message });
          // Acknowledge bad messages so they don't get stuck
          msg.ack();
        }
      }
    } catch (err) {
      const error = err as Error;
      // Handle "no messages" case gracefully
      if (error.message?.includes('no messages') || error.message?.includes('timeout')) {
        return {
          content: [
            {
              type: 'text',
              text: 'No direct messages in your inbox.',
            },
          ],
        };
      }
      throw err;
    }

    // Acknowledge all matched messages
    for (const msg of messagesToAck) {
      msg.ack();
    }

    // If no messages found
    if (messages.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No direct messages in your inbox.',
          },
        ],
      };
    }

    // Sort messages by timestamp (chronological order)
    messages.sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime();
      const bTime = new Date(b.timestamp).getTime();
      return aTime - bTime;
    });

    // Build markdown response
    const lines = [
      `## Direct Messages (${messages.length} message${messages.length === 1 ? '' : 's'})`,
      '',
    ];

    for (const message of messages) {
      lines.push('---');
      lines.push(`**From:** ${message.senderHandle} (${message.senderGuid})`);
      lines.push(`**Type:** ${message.messageType}`);
      lines.push(`**Time:** ${message.timestamp}`);
      lines.push('');
      lines.push(message.content);
      lines.push('');
    }

    logger.info('Read direct messages', {
      guid: readerGuid,
      count: messages.length,
      messageType,
      senderGuid,
    });

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to read direct messages', {
      guid: readerGuid,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: Failed to read messages: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle broadcast_work_offer tool
 */
export async function handleBroadcastWorkOffer(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const taskId = args['taskId'] as string;
  const description = args['description'] as string;
  const requiredCapability = args['requiredCapability'] as string;
  const priority = (args['priority'] as number | undefined) ?? 5;
  const deadline = args['deadline'] as string | undefined;
  const contextData = args['contextData'] as Record<string, unknown> | undefined;

  // Validate required fields
  if (!taskId || taskId.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: taskId is required and cannot be empty' }],
      isError: true,
    };
  }

  if (!description || description.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: description is required and cannot be empty' }],
      isError: true,
    };
  }

  if (!requiredCapability || requiredCapability.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: requiredCapability is required and cannot be empty' }],
      isError: true,
    };
  }

  // Validate priority range
  if (priority < 1 || priority > 10) {
    return {
      content: [{ type: 'text', text: 'Error: priority must be between 1 and 10' }],
      isError: true,
    };
  }

  // Require sender to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to broadcast work offers. Use register_agent first.',
        },
      ],
      isError: true,
    };
  }

  // Create work item
  const workItem: WorkItem = {
    id: randomUUID(),
    taskId: taskId,
    capability: requiredCapability,
    description: description,
    priority: priority,
    offeredBy: state.agentGuid,
    offeredAt: new Date().toISOString(),
    attempts: 0,
  };

  // Add optional fields
  if (deadline) {
    workItem.deadline = deadline;
  }

  if (contextData) {
    workItem.contextData = contextData;
  }

  // Create work queue stream if it doesn't exist
  try {
    await createWorkQueueStream(requiredCapability);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to create work queue stream', {
      capability: requiredCapability,
      error: error.message,
    });
    return {
      content: [
        { type: 'text', text: `Error: Failed to create work queue: ${error.message}` },
      ],
      isError: true,
    };
  }

  // Publish work item to queue
  try {
    const workItemId = await publishWorkItem(workItem);
    const queueSubject = getWorkQueueSubject(requiredCapability);

    logger.info('Work offer broadcast successfully', {
      workItemId,
      taskId,
      capability: requiredCapability,
      priority,
      offeredBy: state.agentGuid,
    });

    // Build response message
    const summary = [
      'Work offer published successfully!',
      '',
      `- Work Item ID: ${workItemId}`,
      `- Task ID: ${taskId}`,
      `- Capability: ${requiredCapability}`,
      `- Priority: ${priority}`,
      `- Published to: ${queueSubject}`,
      `- Offered by: ${state.registeredEntry.handle} (${state.agentGuid})`,
    ];

    if (deadline) {
      summary.push(`- Deadline: ${deadline}`);
    }

    if (contextData) {
      summary.push(`- Context Data: ${JSON.stringify(contextData)}`);
    }

    return {
      content: [{ type: 'text', text: summary.join('\n') }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to publish work offer', {
      taskId,
      capability: requiredCapability,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: Failed to publish work offer: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle list_dead_letter_items tool
 */
export async function handleListDeadLetterItems(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const capability = args['capability'] as string | undefined;
  const limit = Math.min((args['limit'] as number | undefined) ?? 20, 100);

  try {
    // List DLQ items
    const items = await listDeadLetterItems(
      capability !== undefined ? { capability, limit } : { limit }
    );

    // If no items found
    if (items.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: capability
              ? `No dead letter items found for capability: ${capability}`
              : 'No dead letter items found',
          },
        ],
      };
    }

    // Build markdown response
    const lines = [
      `## Dead Letter Queue (${items.length} item${items.length === 1 ? '' : 's'})`,
      '',
    ];

    for (const item of items) {
      lines.push('---');
      lines.push(`**ID:** ${item.id}`);
      lines.push(`**Task:** ${item.workItem.taskId}`);
      lines.push(`**Capability:** ${item.workItem.capability}`);
      lines.push(`**Reason:** ${item.reason}`);
      lines.push(`**Attempts:** ${item.attempts}`);
      lines.push(`**Failed At:** ${item.failedAt}`);

      if (item.errors && item.errors.length > 0) {
        lines.push('**Errors:**');
        for (const error of item.errors) {
          lines.push(`- ${error}`);
        }
      }
      lines.push('');
    }

    logger.info('Listed dead letter items', {
      count: items.length,
      capability,
      limit,
    });

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to list dead letter items', {
      capability,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: Failed to list DLQ items: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle retry_dead_letter_item tool
 */
export async function handleRetryDeadLetterItem(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const itemId = args['itemId'] as string;
  const resetAttempts = (args['resetAttempts'] as boolean | undefined) ?? false;

  // Validate itemId
  if (!itemId || itemId.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: itemId is required and cannot be empty' }],
      isError: true,
    };
  }

  // Validate UUID format
  const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_V4_PATTERN.test(itemId)) {
    return {
      content: [{ type: 'text', text: 'Error: itemId must be a valid UUID v4 format' }],
      isError: true,
    };
  }

  try {
    // Retry the DLQ item
    await retryDeadLetterItem(itemId, resetAttempts);

    logger.info('Retried DLQ item', { itemId, resetAttempts });

    // Build response message
    const summary = [
      'Dead letter item moved back to work queue successfully!',
      '',
      `- Item ID: ${itemId}`,
      `- Attempts reset: ${resetAttempts ? 'yes' : 'no'}`,
      '',
      'The item has been republished to the work queue and can now be claimed by workers.',
    ].join('\n');

    return {
      content: [{ type: 'text', text: summary }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to retry DLQ item', {
      itemId,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle discard_dead_letter_item tool
 */
export async function handleDiscardDeadLetterItem(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const itemId = args['itemId'] as string;

  // Validate itemId
  if (!itemId || itemId.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: itemId is required and cannot be empty' }],
      isError: true,
    };
  }

  // Validate UUID format
  const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_V4_PATTERN.test(itemId)) {
    return {
      content: [{ type: 'text', text: 'Error: itemId must be a valid UUID v4 format' }],
      isError: true,
    };
  }

  try {
    // Discard the DLQ item
    await discardDeadLetterItem(itemId);

    logger.info('Discarded DLQ item', { itemId });

    // Build response message
    const summary = [
      'Dead letter item permanently deleted.',
      '',
      `- Item ID: ${itemId}`,
      '',
      'This action cannot be undone. The work item has been permanently removed from the dead letter queue.',
    ].join('\n');

    return {
      content: [{ type: 'text', text: summary }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to discard DLQ item', {
      itemId,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Handle claim_work tool
 */
export async function handleClaimWork(
  args: Record<string, unknown>,
  state: SessionState
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const capability = args['capability'] as string;
  const timeout = Math.min((args['timeout'] as number | undefined) ?? 5000, 30000);

  // Validate required fields
  if (!capability || capability.trim() === '') {
    return {
      content: [{ type: 'text', text: 'Error: capability is required and cannot be empty' }],
      isError: true,
    };
  }

  // Require agent to be registered
  if (!state.agentGuid || !state.registeredEntry) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: You must be registered to claim work. Use register_agent first.',
        },
      ],
      isError: true,
    };
  }

  // Check if agent has the required capability
  const agentCapabilities = state.registeredEntry.capabilities || [];
  if (!agentCapabilities.includes(capability)) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: You do not have the "${capability}" capability registered. ` +
            `Your capabilities: [${agentCapabilities.join(', ')}]. ` +
            `Use update_presence to add capabilities, or register with the required capability.`,
        },
      ],
      isError: true,
    };
  }

  try {
    // Try to claim work from the queue
    const workItem = await claimWorkItem(capability, timeout);

    if (!workItem) {
      return {
        content: [
          {
            type: 'text',
            text: `No work available for capability "${capability}". The queue is empty or timed out waiting for work.`,
          },
        ],
      };
    }

    logger.info('Work claimed successfully', {
      workItemId: workItem.id,
      taskId: workItem.taskId,
      capability: workItem.capability,
      claimedBy: state.agentGuid,
    });

    // Build response message with full work item details
    const summary = [
      'Work item claimed successfully!',
      '',
      '## Work Item Details',
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Work Item ID | ${workItem.id} |`,
      `| Task ID | ${workItem.taskId} |`,
      `| Capability | ${workItem.capability} |`,
      `| Priority | ${workItem.priority ?? 5} |`,
      `| Description | ${workItem.description} |`,
      `| Offered By | ${workItem.offeredBy} |`,
      `| Offered At | ${workItem.offeredAt} |`,
      `| Attempts | ${workItem.attempts} |`,
    ];

    if (workItem.deadline) {
      summary.push(`| Deadline | ${workItem.deadline} |`);
    }

    if (workItem.contextData) {
      summary.push('', '## Context Data', '', '```json', JSON.stringify(workItem.contextData, null, 2), '```');
    }

    summary.push(
      '',
      '---',
      '',
      'You are now responsible for completing this work item. ' +
      'If you cannot complete it, the work will not be automatically reassigned (it has been removed from the queue).'
    );

    return {
      content: [{ type: 'text', text: summary.join('\n') }],
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to claim work', {
      capability,
      error: error.message,
    });
    return {
      content: [{ type: 'text', text: `Error: Failed to claim work: ${error.message}` }],
      isError: true,
    };
  }
}
