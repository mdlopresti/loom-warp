#!/usr/bin/env node

/**
 * Loom Warp - Main entry point
 *
 * A generalized MCP server for agent-to-agent communication via NATS JetStream.
 * Supports configurable channels, project namespace isolation, and message persistence.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig, getInternalChannels } from './config.js';
import { connectToNats, setupShutdownHandlers, isConnected } from './nats.js';
import { ensureAllStreams } from './streams.js';
import {
  handleTools,
  handleSetHandle,
  handleGetMyHandle,
  channelTools,
  handleListChannels,
  createMessagingTools,
  handleSendMessage,
  handleReadMessages,
  registryTools,
  handleRegisterAgent,
  handleGetAgentInfo,
  handleDiscoverAgents,
  handleUpdatePresence,
  handleDeregisterAgent,
  handleSendDirectMessage,
  handleReadDirectMessages,
  handleBroadcastWorkOffer,
  handleClaimWork,
  handleListDeadLetterItems,
  handleRetryDeadLetterItem,
  handleDiscardDeadLetterItem,
} from './tools/index.js';
import type { SessionState, InternalChannel, ResolvedConfig } from './types.js';
import { createLogger, configureLogger } from './logger.js';

const logger = createLogger('server');

/** Server state */
let config: ResolvedConfig;
let channels: InternalChannel[];
let allTools: Tool[];

/** Session state (per MCP connection) */
const sessionState: SessionState = {
  handle: null,
  agentGuid: null,
  registeredEntry: null,
};

/**
 * Initialize the server
 */
async function initialize(): Promise<void> {
  // Load configuration
  config = await loadConfig();

  // Configure logger based on config
  configureLogger(config.logging.level, config.logging.format);

  logger.info('Loom Warp initializing', {
    namespace: config.namespace,
    projectPath: config.projectPath,
  });

  // Get internal channel representations
  channels = getInternalChannels(config);

  // Build tool list (messaging tools need channel enum)
  const messagingTools = createMessagingTools(channels);
  allTools = [...handleTools, ...channelTools, ...messagingTools, ...registryTools];

  logger.debug('Tools registered', { count: allTools.length });
}

/**
 * Ensure NATS connection and streams are ready
 */
async function ensureNatsReady(): Promise<void> {
  if (!isConnected()) {
    await connectToNats(config.natsUrl);
    await ensureAllStreams(channels);
  }
}

/**
 * Handle tool calls
 */
async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Ensure NATS is connected (lazy initialization)
  await ensureNatsReady();

  switch (name) {
    case 'set_handle':
      return handleSetHandle(args, sessionState);

    case 'get_my_handle':
      return handleGetMyHandle(args, sessionState);

    case 'list_channels':
      return handleListChannels(args, channels);

    case 'send_message':
      return handleSendMessage(args, sessionState, channels);

    case 'read_messages':
      return handleReadMessages(args, channels);

    case 'register_agent':
      return handleRegisterAgent(args, sessionState, config);

    case 'get_agent_info':
      return handleGetAgentInfo(args, sessionState);

    case 'discover_agents':
      return handleDiscoverAgents(args, sessionState, config);

    case 'update_presence':
      return handleUpdatePresence(args, sessionState);

    case 'deregister_agent':
      return handleDeregisterAgent(args, sessionState);

    case 'send_direct_message':
      return handleSendDirectMessage(args, sessionState);

    case 'read_direct_messages':
      return handleReadDirectMessages(args, sessionState);

    case 'broadcast_work_offer':
      return handleBroadcastWorkOffer(args, sessionState);

    case 'claim_work':
      return handleClaimWork(args, sessionState);

    case 'list_dead_letter_items':
      return handleListDeadLetterItems(args);

    case 'retry_dead_letter_item':
      return handleRetryDeadLetterItem(args);

    case 'discard_dead_letter_item':
      return handleDiscardDeadLetterItem(args);

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}

/**
 * Create and run the MCP server
 */
async function runServer(): Promise<void> {
  // Initialize configuration and channels
  await initialize();

  // Set up graceful shutdown
  setupShutdownHandlers();

  // Create MCP server
  const server = new Server(
    {
      name: 'loom-warp',
      version: '1.2.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      return await handleToolCall(name, args as Record<string, unknown>);
    } catch (error) {
      const err = error as Error;
      logger.error('Tool call failed', { tool: name, error: err.message });
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('NATS MCP Server running on stdio', {
    namespace: config.namespace,
    channels: channels.map((ch) => ch.name),
  });
}

// Run the server
runServer().catch((error) => {
  logger.error('Server failed to start', { error: (error as Error).message });
  process.exit(1);
});
