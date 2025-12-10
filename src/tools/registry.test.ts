/**
 * Tests for register_agent and get_agent_info tools
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hostname } from 'os';
import { handleRegisterAgent, handleGetAgentInfo, handleDiscoverAgents, handleUpdatePresence, handleDeregisterAgent } from './registry.js';
import type { SessionState, ResolvedConfig, RegistryEntry } from '../types.js';
import * as kv from '../kv.js';
import * as heartbeat from '../heartbeat.js';
import * as inbox from '../inbox.js';

// Mock dependencies
vi.mock('../kv.js');
vi.mock('../registry.js', async () => {
  const actual = await vi.importActual<typeof import('../registry.js')>('../registry.js');
  return {
    ...actual,
  };
});
vi.mock('../heartbeat.js');
vi.mock('../inbox.js');
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  configureLogger: vi.fn(),
}));

describe('register_agent tool', () => {
  let sessionState: SessionState;
  let mockConfig: ResolvedConfig;

  beforeEach(() => {
    // Reset session state before each test
    sessionState = {
      handle: null,
      agentGuid: null,
      registeredEntry: null,
    };

    // Mock config
    mockConfig = {
      namespace: 'test-namespace',
      channels: [],
      natsUrl: 'nats://localhost:4222',
      logging: { level: 'INFO', format: 'json' },
      projectPath: '/test/project/path',
      projectId: 'a1b2c3d4e5f67890',
      workQueue: { ackTimeoutMs: 30000, maxDeliveryAttempts: 3, deadLetterTTLMs: 86400000 },
    };

    // Setup default mocks
    vi.mocked(kv.initializeRegistry).mockResolvedValue(undefined);
    vi.mocked(kv.putRegistryEntry).mockResolvedValue(undefined);
    vi.mocked(kv.listRegistryEntries).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Registration', () => {
    it('should register agent with minimal parameters', async () => {
      const args = {
        agentType: 'developer',
      };

      const result = await handleRegisterAgent(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('Agent registered successfully');
      expect(result.content[0]?.text).toContain('GUID:');
      expect(result.content[0]?.text).toContain('Handle: developer');
      expect(result.content[0]?.text).toContain('Agent Type: developer');
    });

    it('should register agent with all parameters', async () => {
      sessionState.handle = 'custom-handle';

      const args = {
        agentType: 'reviewer',
        capabilities: ['typescript', 'testing'],
        scope: 'project',
        visibility: 'public',
      };

      const result = await handleRegisterAgent(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Agent registered successfully');
      expect(result.content[0]?.text).toContain('Handle: custom-handle');
      expect(result.content[0]?.text).toContain('Agent Type: reviewer');
      expect(result.content[0]?.text).toContain('Scope: project');
      expect(result.content[0]?.text).toContain('Visibility: public');
      expect(result.content[0]?.text).toContain('Capabilities: typescript, testing');
    });

    it('should auto-generate handle from agentType if not set', async () => {
      const args = {
        agentType: 'project-manager',
      };

      const result = await handleRegisterAgent(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(sessionState.handle).toBe('project-manager');
      expect(result.content[0]?.text).toContain('Handle: project-manager');
    });

    it('should convert spaces and underscores to hyphens in generated handle', async () => {
      const args = {
        agentType: 'Project Manager',
      };

      const result = await handleRegisterAgent(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(sessionState.handle).toBe('project-manager');
    });

    it('should use existing handle if already set', async () => {
      sessionState.handle = 'existing-handle';

      const args = {
        agentType: 'developer',
      };

      const result = await handleRegisterAgent(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(sessionState.handle).toBe('existing-handle');
      expect(result.content[0]?.text).toContain('Handle: existing-handle');
    });
  });

  describe('Session State Management', () => {
    it('should update session state with GUID and entry', async () => {
      const args = {
        agentType: 'developer',
      };

      await handleRegisterAgent(args, sessionState, mockConfig);

      expect(sessionState.agentGuid).toBeTruthy();
      expect(sessionState.agentGuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(sessionState.registeredEntry).toBeTruthy();
      expect(sessionState.registeredEntry?.agentType).toBe('developer');
    });

    it('should store complete entry in session state', async () => {
      const args = {
        agentType: 'reviewer',
        capabilities: ['code-review'],
        scope: 'user',
        visibility: 'user-only',
      };

      await handleRegisterAgent(args, sessionState, mockConfig);

      expect(sessionState.registeredEntry).toBeTruthy();
      expect(sessionState.registeredEntry?.agentType).toBe('reviewer');
      expect(sessionState.registeredEntry?.capabilities).toEqual(['code-review']);
      expect(sessionState.registeredEntry?.scope).toBe('user');
      expect(sessionState.registeredEntry?.visibility).toBe('user-only');
    });
  });

  describe('KV Store Integration', () => {
    it('should initialize registry before registration', async () => {
      const args = {
        agentType: 'developer',
      };

      await handleRegisterAgent(args, sessionState, mockConfig);

      expect(kv.initializeRegistry).toHaveBeenCalled();
    });

    it('should publish entry to KV store', async () => {
      const args = {
        agentType: 'developer',
      };

      await handleRegisterAgent(args, sessionState, mockConfig);

      expect(kv.putRegistryEntry).toHaveBeenCalled();
      const [[guid, entry]] = vi.mocked(kv.putRegistryEntry).mock.calls;
      expect(guid).toBeTruthy();
      expect(entry.agentType).toBe('developer');
    });

    it('should handle registry initialization failure', async () => {
      vi.mocked(kv.initializeRegistry).mockRejectedValue(new Error('KV init failed'));

      const args = {
        agentType: 'developer',
      };

      const result = await handleRegisterAgent(args, sessionState, mockConfig);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to initialize registry');
      expect(result.content[0]?.text).toContain('KV init failed');
    });

    it('should handle publish failure', async () => {
      vi.mocked(kv.putRegistryEntry).mockRejectedValue(new Error('Publish failed'));

      const args = {
        agentType: 'developer',
      };

      const result = await handleRegisterAgent(args, sessionState, mockConfig);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to publish to registry');
      expect(result.content[0]?.text).toContain('Publish failed');
    });
  });

  describe('GUID Reuse for Offline Agents', () => {
    it('should reuse GUID for offline agent with same handle', async () => {
      const existingGuid = '12345678-1234-4234-8234-123456789012';

      // Use the projectId from config (which is now explicit)
      const expectedProjectId = mockConfig.projectId;

      const mockEntry = {
        guid: existingGuid,
        agentType: 'developer',
        handle: 'test-agent',
        hostname: hostname(),
        projectId: expectedProjectId,  // Use the same projectId from config
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project' as const,
        visibility: 'project-only' as const,
        status: 'offline' as const,
        currentTaskCount: 0,
        registeredAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };

      vi.mocked(kv.listRegistryEntries).mockImplementation(async (filter) => {
        if (filter && filter(mockEntry)) {
          return [mockEntry];
        }
        return [];
      });

      sessionState.handle = 'test-agent';

      const args = {
        agentType: 'developer',
      };

      const result = await handleRegisterAgent(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(sessionState.agentGuid).toBe(existingGuid);
      expect(result.content[0]?.text).toContain('Reused GUID from previous offline agent');
    });

    it('should create new GUID if no offline agent matches', async () => {
      vi.mocked(kv.listRegistryEntries).mockResolvedValue([]);

      const args = {
        agentType: 'developer',
      };

      const result = await handleRegisterAgent(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('New GUID generated');
    });

    it('should create new GUID if existing agent is online', async () => {
      const mockEntry = {
        guid: '12345678-1234-4234-8234-123456789012',
        agentType: 'developer',
        handle: 'test-agent',
        hostname: hostname(),
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project' as const,
        visibility: 'project-only' as const,
        status: 'online' as const, // Online, not offline
        currentTaskCount: 0,
        registeredAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };

      vi.mocked(kv.listRegistryEntries).mockImplementation(async (filter) => {
        // Filter will exclude online agents
        if (filter && filter(mockEntry)) {
          return [mockEntry];
        }
        return [];
      });

      sessionState.handle = 'test-agent';

      const args = {
        agentType: 'developer',
      };

      const result = await handleRegisterAgent(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(sessionState.agentGuid).not.toBe(mockEntry.guid);
      expect(result.content[0]?.text).toContain('New GUID generated');
    });
  });

  describe('Validation', () => {
    it('should reject empty agentType', async () => {
      const args = {
        agentType: '',
      };

      const result = await handleRegisterAgent(args, sessionState, mockConfig);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('agentType cannot be empty');
    });

    it('should reject whitespace-only agentType', async () => {
      const args = {
        agentType: '   ',
      };

      const result = await handleRegisterAgent(args, sessionState, mockConfig);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('agentType cannot be empty');
    });
  });

  describe('Default Values', () => {
    it('should use default empty array for capabilities', async () => {
      const args = {
        agentType: 'developer',
      };

      await handleRegisterAgent(args, sessionState, mockConfig);

      expect(sessionState.registeredEntry?.capabilities).toEqual([]);
    });

    it('should use default "project" scope', async () => {
      const args = {
        agentType: 'developer',
      };

      await handleRegisterAgent(args, sessionState, mockConfig);

      expect(sessionState.registeredEntry?.scope).toBe('project');
    });

    it('should use default "project-only" visibility', async () => {
      const args = {
        agentType: 'developer',
      };

      await handleRegisterAgent(args, sessionState, mockConfig);

      expect(sessionState.registeredEntry?.visibility).toBe('project-only');
    });
  });

  describe('Environment Detection', () => {
    it('should detect hostname from system', async () => {
      const args = {
        agentType: 'developer',
      };

      await handleRegisterAgent(args, sessionState, mockConfig);

      expect(sessionState.registeredEntry?.hostname).toBeTruthy();
      expect(sessionState.registeredEntry?.hostname).toBe(hostname());
    });

    it('should use natsUrl from config', async () => {
      const args = {
        agentType: 'developer',
      };

      await handleRegisterAgent(args, sessionState, mockConfig);

      expect(sessionState.registeredEntry?.natsUrl).toBe('nats://localhost:4222');
    });

    it('should generate projectId from config projectPath', async () => {
      const args = {
        agentType: 'developer',
      };

      await handleRegisterAgent(args, sessionState, mockConfig);

      expect(sessionState.registeredEntry?.projectId).toBeTruthy();
      expect(sessionState.registeredEntry?.projectId).toHaveLength(16);
      expect(sessionState.registeredEntry?.projectId).toMatch(/^[a-f0-9]{16}$/);
    });
  });
});

describe('get_agent_info tool', () => {
  let sessionState: SessionState;
  const testGuid = '12345678-1234-4234-8234-123456789012';
  const requesterGuid = '87654321-4321-4321-8321-210987654321';

  beforeEach(() => {
    // Setup registered session state
    sessionState = {
      handle: 'requester',
      agentGuid: requesterGuid,
      registeredEntry: {
        guid: requesterGuid,
        agentType: 'developer',
        handle: 'requester',
        hostname: 'requester-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: ['typescript'],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      },
    };

    // Setup default mocks
    vi.mocked(kv.getRegistryEntry).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful Lookup', () => {
    it('should retrieve and display agent info for visible agent', async () => {
      const mockEntry: RegistryEntry = {
        guid: testGuid,
        agentType: 'developer',
        handle: 'test-agent',
        hostname: 'test-host',
        projectId: '1234567890abcdef', // Same project
        natsUrl: 'nats://localhost:4222',
        capabilities: ['coding', 'testing'],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 2,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(mockEntry);

      const args = { guid: testGuid };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('## Agent: test-agent');
      expect(result.content[0]?.text).toContain(`| GUID | ${testGuid} |`);
      expect(result.content[0]?.text).toContain('| Type | developer |');
      expect(result.content[0]?.text).toContain('| Status | online |');
      expect(result.content[0]?.text).toContain('| Hostname | test-host |');
      expect(result.content[0]?.text).toContain('| Capabilities | coding, testing |');
      expect(result.content[0]?.text).toContain('| Scope | project |');
      expect(result.content[0]?.text).toContain('| Current Tasks | 2 |');
    });

    it('should show own agent with all fields', async () => {
      const mockEntry: RegistryEntry = {
        guid: requesterGuid,
        agentType: 'developer',
        handle: 'requester',
        hostname: 'requester-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        username: 'testuser',
        capabilities: ['typescript'],
        scope: 'project',
        visibility: 'private',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(mockEntry);

      const args = { guid: requesterGuid };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('| Username | testuser |');
      expect(result.content[0]?.text).toContain('| NATS URL | nats://localhost:4222 |');
      expect(result.content[0]?.text).toContain('| Project ID | 1234567890abcdef |');
    });

    it('should display "none" for empty capabilities', async () => {
      const mockEntry: RegistryEntry = {
        guid: testGuid,
        agentType: 'developer',
        handle: 'test-agent',
        hostname: 'test-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [], // Empty capabilities
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(mockEntry);

      const args = { guid: testGuid };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('| Capabilities | none |');
    });
  });

  describe('Not Found', () => {
    it('should return error when agent does not exist', async () => {
      vi.mocked(kv.getRegistryEntry).mockResolvedValue(null);

      const args = { guid: testGuid };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Agent not found or not visible to you');
    });

    it('should handle retrieval errors', async () => {
      vi.mocked(kv.getRegistryEntry).mockRejectedValue(new Error('Connection failed'));

      const args = { guid: testGuid };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to retrieve agent');
      expect(result.content[0]?.text).toContain('Connection failed');
    });
  });

  describe('Visibility Enforcement', () => {
    it('should deny access to private agent from different agent', async () => {
      const mockEntry: RegistryEntry = {
        guid: testGuid,
        agentType: 'developer',
        handle: 'private-agent',
        hostname: 'test-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'private', // Private visibility
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(mockEntry);

      const args = { guid: testGuid };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Agent not found or not visible to you');
    });

    it('should deny access to agent in different project', async () => {
      const mockEntry: RegistryEntry = {
        guid: testGuid,
        agentType: 'developer',
        handle: 'other-project-agent',
        hostname: 'test-host',
        projectId: 'fedcba0987654321', // Different project
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(mockEntry);

      const args = { guid: testGuid };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Agent not found or not visible to you');
    });

    it('should allow access to public agent', async () => {
      const mockEntry: RegistryEntry = {
        guid: testGuid,
        agentType: 'developer',
        handle: 'public-agent',
        hostname: 'test-host',
        projectId: 'fedcba0987654321', // Different project
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'public', // Public visibility
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(mockEntry);

      const args = { guid: testGuid };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('## Agent: public-agent');
    });

    it('should allow access to user-only agent with same username', async () => {
      sessionState.registeredEntry!.username = 'testuser';

      const mockEntry: RegistryEntry = {
        guid: testGuid,
        agentType: 'developer',
        handle: 'user-agent',
        hostname: 'test-host',
        projectId: 'fedcba0987654321', // Different project
        natsUrl: 'nats://localhost:4222',
        username: 'testuser', // Same username
        capabilities: [],
        scope: 'user',
        visibility: 'user-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(mockEntry);

      const args = { guid: testGuid };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('## Agent: user-agent');
    });
  });

  describe('Redaction', () => {
    it('should redact sensitive fields for non-self agents', async () => {
      const mockEntry: RegistryEntry = {
        guid: testGuid,
        agentType: 'developer',
        handle: 'other-agent',
        hostname: 'test-host',
        projectId: 'fedcba0987654321', // Different project
        natsUrl: 'nats://secret-nats:4222',
        username: 'otheruser',
        capabilities: [],
        scope: 'project',
        visibility: 'public',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(mockEntry);

      const args = { guid: testGuid };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBeUndefined();
      // Should not contain username, natsUrl, or projectId for different project
      expect(result.content[0]?.text).not.toContain('| Username |');
      expect(result.content[0]?.text).not.toContain('| NATS URL |');
      expect(result.content[0]?.text).not.toContain('| Project ID |');
      // Should contain public fields
      expect(result.content[0]?.text).toContain('| GUID |');
      expect(result.content[0]?.text).toContain('| Type |');
      expect(result.content[0]?.text).toContain('| Status |');
    });

    it('should show hostname for same-project agent', async () => {
      const mockEntry: RegistryEntry = {
        guid: testGuid,
        agentType: 'developer',
        handle: 'project-agent',
        hostname: 'project-host',
        projectId: '1234567890abcdef', // Same project
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(mockEntry);

      const args = { guid: testGuid };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('| Hostname | project-host |');
      expect(result.content[0]?.text).toContain('| Project ID | 1234567890abcdef |');
      expect(result.content[0]?.text).toContain('| NATS URL | nats://localhost:4222 |');
    });
  });

  describe('Registration Requirement', () => {
    it('should require caller to be registered', async () => {
      const unregisteredState: SessionState = {
        handle: null,
        agentGuid: null,
        registeredEntry: null,
      };

      const args = { guid: testGuid };
      const result = await handleGetAgentInfo(args, unregisteredState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('You must be registered to view agent information');
      expect(result.content[0]?.text).toContain('Use register_agent first');
    });

    it('should require both agentGuid and registeredEntry', async () => {
      const partialState: SessionState = {
        handle: 'test',
        agentGuid: requesterGuid,
        registeredEntry: null, // Missing entry
      };

      const args = { guid: testGuid };
      const result = await handleGetAgentInfo(args, partialState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('You must be registered');
    });
  });

  describe('GUID Validation', () => {
    it('should reject invalid GUID format', async () => {
      const args = { guid: 'invalid-guid' };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid GUID format');
      expect(result.content[0]?.text).toContain('Must be a valid UUID v4');
    });

    it('should reject empty GUID', async () => {
      const args = { guid: '' };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid GUID format');
    });

    it('should reject UUID v1 format', async () => {
      const args = { guid: '12345678-1234-1234-1234-123456789012' }; // v1, not v4
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid GUID format');
    });

    it('should accept valid UUID v4', async () => {
      const mockEntry: RegistryEntry = {
        guid: testGuid,
        agentType: 'developer',
        handle: 'test-agent',
        hostname: 'test-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: [],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      };

      vi.mocked(kv.getRegistryEntry).mockResolvedValue(mockEntry);

      const args = { guid: testGuid };
      const result = await handleGetAgentInfo(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(kv.getRegistryEntry).toHaveBeenCalledWith(testGuid);
    });
  });
});

describe('discover_agents tool', () => {
  let sessionState: SessionState;
  let mockConfig: ResolvedConfig;

  beforeEach(() => {
    // Setup registered session state
    sessionState = {
      handle: 'requester',
      agentGuid: '11111111-1111-4111-8111-111111111111',
      registeredEntry: {
        guid: '11111111-1111-4111-8111-111111111111',
        agentType: 'developer',
        handle: 'requester',
        hostname: 'requester-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: ['typescript'],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      },
    };

    mockConfig = {
      namespace: 'test-namespace',
      channels: [],
      natsUrl: 'nats://localhost:4222',
      logging: { level: 'INFO', format: 'json' },
      projectPath: '/test/project/path',
      projectId: 'a1b2c3d4e5f67890',
      workQueue: { ackTimeoutMs: 30000, maxDeliveryAttempts: 3, deadLetterTTLMs: 86400000 },
    };

    // Setup default mocks
    vi.mocked(kv.initializeRegistry).mockResolvedValue(undefined);
    vi.mocked(kv.listRegistryEntries).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Registration Requirement', () => {
    it('should require caller to be registered', async () => {
      const unregisteredState: SessionState = {
        handle: null,
        agentGuid: null,
        registeredEntry: null,
      };

      const args = {};
      const result = await handleDiscoverAgents(args, unregisteredState, mockConfig);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('You must register first');
      expect(result.content[0]?.text).toContain('register_agent');
    });

    it('should require both agentGuid and registeredEntry', async () => {
      const partialState: SessionState = {
        handle: 'test',
        agentGuid: '11111111-1111-4111-8111-111111111111',
        registeredEntry: null,
      };

      const args = {};
      const result = await handleDiscoverAgents(args, partialState, mockConfig);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('You must register first');
    });
  });

  describe('Empty Results', () => {
    it('should return message when no agents found', async () => {
      vi.mocked(kv.listRegistryEntries).mockResolvedValue([]);

      const args = {};
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toBe('No agents found matching the specified criteria.');
    });

    it('should return message when all agents are offline and includeOffline is false', async () => {
      const mockAgents: RegistryEntry[] = [
        {
          guid: '22222222-2222-4222-8222-222222222222',
          agentType: 'developer',
          handle: 'offline-agent',
          hostname: 'test-host',
          projectId: '1234567890abcdef',
          natsUrl: 'nats://localhost:4222',
          capabilities: [],
          scope: 'project',
          visibility: 'project-only',
          status: 'offline',
          currentTaskCount: 0,
          registeredAt: '2025-01-15T09:00:00Z',
          lastHeartbeat: '2025-01-15T09:30:00Z',
        },
      ];

      vi.mocked(kv.listRegistryEntries).mockResolvedValue(mockAgents);

      const args = {};
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toBe('No agents found matching the specified criteria.');
    });
  });

  describe('Basic Discovery', () => {
    it('should discover agents in same project', async () => {
      const mockAgents: RegistryEntry[] = [
        {
          guid: '22222222-2222-4222-8222-222222222222',
          agentType: 'developer',
          handle: 'dev-agent',
          hostname: 'dev-host',
          projectId: '1234567890abcdef', // Same project
          natsUrl: 'nats://localhost:4222',
          capabilities: ['coding'],
          scope: 'project',
          visibility: 'project-only',
          status: 'online',
          currentTaskCount: 1,
          registeredAt: '2025-01-15T09:00:00Z',
          lastHeartbeat: '2025-01-15T10:00:00Z',
        },
        {
          guid: '33333333-3333-4333-8333-333333333333',
          agentType: 'reviewer',
          handle: 'review-agent',
          hostname: 'review-host',
          projectId: '1234567890abcdef', // Same project
          natsUrl: 'nats://localhost:4222',
          capabilities: ['review'],
          scope: 'project',
          visibility: 'project-only',
          status: 'busy',
          currentTaskCount: 3,
          registeredAt: '2025-01-15T08:00:00Z',
          lastHeartbeat: '2025-01-15T10:05:00Z',
        },
      ];

      vi.mocked(kv.listRegistryEntries).mockResolvedValue(mockAgents);

      const args = {};
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Found 2 agents:');
      expect(result.content[0]?.text).toContain('**dev-agent** (developer)');
      expect(result.content[0]?.text).toContain('**review-agent** (reviewer)');
      expect(result.content[0]?.text).toContain('- Status: online');
      expect(result.content[0]?.text).toContain('- Status: busy');
    });
  });

  describe('Filtering', () => {
    const mockAgents: RegistryEntry[] = [
      {
        guid: '22222222-2222-4222-8222-222222222222',
        agentType: 'developer',
        handle: 'dev-agent',
        hostname: 'dev-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: ['typescript', 'testing'],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 1,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      },
      {
        guid: '33333333-3333-4333-8333-333333333333',
        agentType: 'reviewer',
        handle: 'review-agent',
        hostname: 'review-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: ['code-review'],
        scope: 'user',
        visibility: 'project-only',
        status: 'busy',
        currentTaskCount: 3,
        registeredAt: '2025-01-15T08:00:00Z',
        lastHeartbeat: '2025-01-15T10:05:00Z',
      },
      {
        guid: '44444444-4444-4444-8444-444444444444',
        agentType: 'developer',
        handle: 'other-dev',
        hostname: 'other-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: ['python'],
        scope: 'project',
        visibility: 'project-only',
        status: 'offline',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T07:00:00Z',
        lastHeartbeat: '2025-01-15T09:00:00Z',
      },
    ];

    beforeEach(() => {
      vi.mocked(kv.listRegistryEntries).mockResolvedValue(mockAgents);
    });

    it('should filter by agentType', async () => {
      const args = { agentType: 'developer' };
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('**dev-agent** (developer)');
      expect(result.content[0]?.text).not.toContain('**review-agent**');
      // Should exclude offline agent by default
      expect(result.content[0]?.text).not.toContain('**other-dev**');
    });

    it('should filter by capability', async () => {
      const args = { capability: 'typescript' };
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Found 1 agent:');
      expect(result.content[0]?.text).toContain('**dev-agent** (developer)');
      expect(result.content[0]?.text).toContain('- Capabilities: [typescript, testing]');
    });

    it('should filter by hostname', async () => {
      const args = { hostname: 'review-host' };
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Found 1 agent:');
      expect(result.content[0]?.text).toContain('**review-agent** (reviewer)');
    });

    it('should filter by projectId', async () => {
      const args = { projectId: '1234567890abcdef' };
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      // Should find 2 (excluding offline)
      expect(result.content[0]?.text).toContain('Found 2 agents:');
    });

    it('should filter by status', async () => {
      const args = { status: 'busy' as const };
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Found 1 agent:');
      expect(result.content[0]?.text).toContain('**review-agent** (reviewer)');
      expect(result.content[0]?.text).toContain('- Status: busy');
    });

    it('should filter by scope', async () => {
      const args = { scope: 'user' as const };
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Found 1 agent:');
      expect(result.content[0]?.text).toContain('**review-agent** (reviewer)');
    });

    it('should include offline agents when includeOffline is true', async () => {
      const args = { includeOffline: true };
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Found 3 agents:');
      expect(result.content[0]?.text).toContain('**other-dev** (developer)');
      expect(result.content[0]?.text).toContain('- Status: offline');
    });

    it('should combine multiple filters', async () => {
      const args = {
        agentType: 'developer',
        capability: 'typescript',
        status: 'online' as const,
      };
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Found 1 agent:');
      expect(result.content[0]?.text).toContain('**dev-agent** (developer)');
    });
  });

  describe('Visibility Filtering', () => {
    it('should exclude private agents from other users', async () => {
      const mockAgents: RegistryEntry[] = [
        {
          guid: '22222222-2222-4222-8222-222222222222',
          agentType: 'developer',
          handle: 'public-agent',
          hostname: 'test-host',
          projectId: '1234567890abcdef',
          natsUrl: 'nats://localhost:4222',
          capabilities: [],
          scope: 'project',
          visibility: 'project-only',
          status: 'online',
          currentTaskCount: 0,
          registeredAt: '2025-01-15T09:00:00Z',
          lastHeartbeat: '2025-01-15T10:00:00Z',
        },
        {
          guid: '33333333-3333-4333-8333-333333333333',
          agentType: 'developer',
          handle: 'private-agent',
          hostname: 'test-host',
          projectId: '1234567890abcdef',
          natsUrl: 'nats://localhost:4222',
          capabilities: [],
          scope: 'project',
          visibility: 'private',
          status: 'online',
          currentTaskCount: 0,
          registeredAt: '2025-01-15T09:00:00Z',
          lastHeartbeat: '2025-01-15T10:00:00Z',
        },
      ];

      vi.mocked(kv.listRegistryEntries).mockResolvedValue(mockAgents);

      const args = {};
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Found 1 agent:');
      expect(result.content[0]?.text).toContain('**public-agent**');
      expect(result.content[0]?.text).not.toContain('**private-agent**');
    });

    it('should exclude agents from different projects when visibility is project-only', async () => {
      const mockAgents: RegistryEntry[] = [
        {
          guid: '22222222-2222-4222-8222-222222222222',
          agentType: 'developer',
          handle: 'same-project',
          hostname: 'test-host',
          projectId: '1234567890abcdef', // Same project
          natsUrl: 'nats://localhost:4222',
          capabilities: [],
          scope: 'project',
          visibility: 'project-only',
          status: 'online',
          currentTaskCount: 0,
          registeredAt: '2025-01-15T09:00:00Z',
          lastHeartbeat: '2025-01-15T10:00:00Z',
        },
        {
          guid: '33333333-3333-4333-8333-333333333333',
          agentType: 'developer',
          handle: 'other-project',
          hostname: 'test-host',
          projectId: 'fedcba0987654321', // Different project
          natsUrl: 'nats://localhost:4222',
          capabilities: [],
          scope: 'project',
          visibility: 'project-only',
          status: 'online',
          currentTaskCount: 0,
          registeredAt: '2025-01-15T09:00:00Z',
          lastHeartbeat: '2025-01-15T10:00:00Z',
        },
      ];

      vi.mocked(kv.listRegistryEntries).mockResolvedValue(mockAgents);

      const args = {};
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Found 1 agent:');
      expect(result.content[0]?.text).toContain('**same-project**');
      expect(result.content[0]?.text).not.toContain('**other-project**');
    });

    it('should show public agents from any project', async () => {
      const mockAgents: RegistryEntry[] = [
        {
          guid: '22222222-2222-4222-8222-222222222222',
          agentType: 'developer',
          handle: 'public-agent',
          hostname: 'test-host',
          projectId: 'fedcba0987654321', // Different project
          natsUrl: 'nats://localhost:4222',
          capabilities: [],
          scope: 'project',
          visibility: 'public',
          status: 'online',
          currentTaskCount: 0,
          registeredAt: '2025-01-15T09:00:00Z',
          lastHeartbeat: '2025-01-15T10:00:00Z',
        },
      ];

      vi.mocked(kv.listRegistryEntries).mockResolvedValue(mockAgents);

      const args = {};
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Found 1 agent:');
      expect(result.content[0]?.text).toContain('**public-agent**');
    });
  });

  describe('Redaction', () => {
    it('should redact sensitive fields for non-self agents', async () => {
      const mockAgents: RegistryEntry[] = [
        {
          guid: '22222222-2222-4222-8222-222222222222',
          agentType: 'developer',
          handle: 'other-agent',
          hostname: 'test-host',
          projectId: 'fedcba0987654321', // Different project
          natsUrl: 'nats://secret:4222',
          username: 'otheruser',
          capabilities: [],
          scope: 'project',
          visibility: 'public',
          status: 'online',
          currentTaskCount: 0,
          registeredAt: '2025-01-15T09:00:00Z',
          lastHeartbeat: '2025-01-15T10:00:00Z',
        },
      ];

      vi.mocked(kv.listRegistryEntries).mockResolvedValue(mockAgents);

      const args = {};
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      // Should not contain sensitive fields for different project
      expect(result.content[0]?.text).not.toContain('otheruser');
      expect(result.content[0]?.text).not.toContain('secret:4222');
      expect(result.content[0]?.text).not.toContain('fedcba0987654321');
      // Should contain public fields
      expect(result.content[0]?.text).toContain('- GUID: 22222222-2222-4222-8222-222222222222');
      expect(result.content[0]?.text).toContain('- Status: online');
    });
  });

  describe('Sorting', () => {
    it('should sort by lastHeartbeat descending (most recent first)', async () => {
      const mockAgents: RegistryEntry[] = [
        {
          guid: '22222222-2222-4222-8222-222222222222',
          agentType: 'developer',
          handle: 'old-agent',
          hostname: 'test-host',
          projectId: '1234567890abcdef',
          natsUrl: 'nats://localhost:4222',
          capabilities: [],
          scope: 'project',
          visibility: 'project-only',
          status: 'online',
          currentTaskCount: 0,
          registeredAt: '2025-01-15T09:00:00Z',
          lastHeartbeat: '2025-01-15T10:00:00Z',
        },
        {
          guid: '33333333-3333-4333-8333-333333333333',
          agentType: 'developer',
          handle: 'recent-agent',
          hostname: 'test-host',
          projectId: '1234567890abcdef',
          natsUrl: 'nats://localhost:4222',
          capabilities: [],
          scope: 'project',
          visibility: 'project-only',
          status: 'online',
          currentTaskCount: 0,
          registeredAt: '2025-01-15T09:00:00Z',
          lastHeartbeat: '2025-01-15T10:30:00Z',
        },
        {
          guid: '44444444-4444-4444-8444-444444444444',
          agentType: 'developer',
          handle: 'middle-agent',
          hostname: 'test-host',
          projectId: '1234567890abcdef',
          natsUrl: 'nats://localhost:4222',
          capabilities: [],
          scope: 'project',
          visibility: 'project-only',
          status: 'online',
          currentTaskCount: 0,
          registeredAt: '2025-01-15T09:00:00Z',
          lastHeartbeat: '2025-01-15T10:15:00Z',
        },
      ];

      vi.mocked(kv.listRegistryEntries).mockResolvedValue(mockAgents);

      const args = {};
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text || '';
      // Recent agent should appear before middle agent
      const recentIndex = text.indexOf('**recent-agent**');
      const middleIndex = text.indexOf('**middle-agent**');
      const oldIndex = text.indexOf('**old-agent**');
      expect(recentIndex).toBeLessThan(middleIndex);
      expect(middleIndex).toBeLessThan(oldIndex);
    });
  });

  describe('Error Handling', () => {
    it('should handle registry initialization errors', async () => {
      vi.mocked(kv.initializeRegistry).mockRejectedValue(new Error('Init failed'));

      const args = {};
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to initialize registry');
      expect(result.content[0]?.text).toContain('Init failed');
    });

    it('should handle list entries errors', async () => {
      vi.mocked(kv.listRegistryEntries).mockRejectedValue(new Error('List failed'));

      const args = {};
      const result = await handleDiscoverAgents(args, sessionState, mockConfig);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to list registry entries');
      expect(result.content[0]?.text).toContain('List failed');
    });
  });
});

describe('deregister_agent tool', () => {
  let sessionState: SessionState;
  const testGuid = '12345678-1234-4234-8234-123456789012';

  beforeEach(() => {
    // Setup registered session state
    sessionState = {
      handle: 'test-agent',
      agentGuid: testGuid,
      registeredEntry: {
        guid: testGuid,
        agentType: 'developer',
        handle: 'test-agent',
        hostname: 'test-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: ['typescript'],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      },
    };

    // Setup default mocks
    vi.mocked(heartbeat.stopHeartbeat).mockReturnValue(undefined);
    vi.mocked(inbox.unsubscribeFromInbox).mockResolvedValue(undefined);
    vi.mocked(kv.getRegistryEntry).mockResolvedValue(sessionState.registeredEntry);
    vi.mocked(kv.putRegistryEntry).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful Deregistration', () => {
    it('should deregister agent successfully', async () => {
      const args = {};
      const result = await handleDeregisterAgent(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toContain('Agent deregistered successfully');
      expect(result.content[0]?.text).toContain(`- GUID: ${testGuid}`);
      expect(result.content[0]?.text).toContain('- Handle: test-agent');
      expect(result.content[0]?.text).toContain('- Status: offline');
      expect(result.content[0]?.text).toContain('- Heartbeat: stopped');
      expect(result.content[0]?.text).toContain('- Inbox: unsubscribed');
    });

    it('should stop heartbeat', async () => {
      const args = {};
      await handleDeregisterAgent(args, sessionState);

      expect(heartbeat.stopHeartbeat).toHaveBeenCalled();
    });

    it('should unsubscribe from inbox', async () => {
      const args = {};
      await handleDeregisterAgent(args, sessionState);

      expect(inbox.unsubscribeFromInbox).toHaveBeenCalled();
    });

    it('should set status to offline', async () => {
      const args = {};
      await handleDeregisterAgent(args, sessionState);

      expect(kv.putRegistryEntry).toHaveBeenCalled();
      const [[guid, entry]] = vi.mocked(kv.putRegistryEntry).mock.calls;
      expect(guid).toBe(testGuid);
      expect(entry.status).toBe('offline');
    });

    it('should preserve all other entry fields', async () => {
      const args = {};
      await handleDeregisterAgent(args, sessionState);

      const [[, entry]] = vi.mocked(kv.putRegistryEntry).mock.calls;
      expect(entry.guid).toBe(testGuid);
      expect(entry.agentType).toBe('developer');
      expect(entry.handle).toBe('test-agent');
      expect(entry.hostname).toBe('test-host');
      expect(entry.projectId).toBe('1234567890abcdef');
      expect(entry.capabilities).toEqual(['typescript']);
      expect(entry.scope).toBe('project');
      expect(entry.visibility).toBe('project-only');
    });

    it('should clear session state', async () => {
      const args = {};
      await handleDeregisterAgent(args, sessionState);

      expect(sessionState.agentGuid).toBeNull();
      expect(sessionState.registeredEntry).toBeNull();
    });

    it('should not delete entry from KV store', async () => {
      const args = {};
      await handleDeregisterAgent(args, sessionState);

      // Should call putRegistryEntry to update, not delete
      expect(kv.putRegistryEntry).toHaveBeenCalled();
      // Should not call any delete method
      expect(vi.mocked(kv.getRegistryEntry).mock.calls).toHaveLength(1);
    });
  });

  describe('Registration Requirement', () => {
    it('should require caller to be registered', async () => {
      const unregisteredState: SessionState = {
        handle: null,
        agentGuid: null,
        registeredEntry: null,
      };

      const args = {};
      const result = await handleDeregisterAgent(args, unregisteredState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('You must be registered to deregister');
      expect(result.content[0]?.text).toContain('Use register_agent first');
    });

    it('should require both agentGuid and registeredEntry', async () => {
      const partialState: SessionState = {
        handle: 'test',
        agentGuid: testGuid,
        registeredEntry: null,
      };

      const args = {};
      const result = await handleDeregisterAgent(args, partialState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('You must be registered to deregister');
    });
  });

  describe('Error Handling', () => {
    it('should handle inbox unsubscribe errors gracefully', async () => {
      vi.mocked(inbox.unsubscribeFromInbox).mockRejectedValue(new Error('Unsubscribe failed'));

      const args = {};
      const result = await handleDeregisterAgent(args, sessionState);

      // Should continue with deregistration despite inbox error
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Agent deregistered successfully');
      expect(kv.putRegistryEntry).toHaveBeenCalled();
    });

    it('should handle entry retrieval errors', async () => {
      vi.mocked(kv.getRegistryEntry).mockRejectedValue(new Error('Retrieval failed'));

      const args = {};
      const result = await handleDeregisterAgent(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to retrieve agent entry');
      expect(result.content[0]?.text).toContain('Retrieval failed');
    });

    it('should handle entry not found', async () => {
      vi.mocked(kv.getRegistryEntry).mockResolvedValue(null);

      const args = {};
      const result = await handleDeregisterAgent(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Agent entry not found in registry');
    });

    it('should handle entry update errors', async () => {
      vi.mocked(kv.putRegistryEntry).mockRejectedValue(new Error('Update failed'));

      const args = {};
      const result = await handleDeregisterAgent(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to update registry entry');
      expect(result.content[0]?.text).toContain('Update failed');
    });
  });

  describe('Integration with Heartbeat and Inbox', () => {
    it('should stop heartbeat before updating registry', async () => {
      const callOrder: string[] = [];

      vi.mocked(heartbeat.stopHeartbeat).mockImplementation(() => {
        callOrder.push('stopHeartbeat');
      });

      vi.mocked(kv.putRegistryEntry).mockImplementation(async () => {
        callOrder.push('putRegistryEntry');
      });

      const args = {};
      await handleDeregisterAgent(args, sessionState);

      expect(callOrder.indexOf('stopHeartbeat')).toBeLessThan(callOrder.indexOf('putRegistryEntry'));
    });

    it('should unsubscribe from inbox before updating registry', async () => {
      const callOrder: string[] = [];

      vi.mocked(inbox.unsubscribeFromInbox).mockImplementation(async () => {
        callOrder.push('unsubscribeFromInbox');
      });

      vi.mocked(kv.putRegistryEntry).mockImplementation(async () => {
        callOrder.push('putRegistryEntry');
      });

      const args = {};
      await handleDeregisterAgent(args, sessionState);

      expect(callOrder.indexOf('unsubscribeFromInbox')).toBeLessThan(callOrder.indexOf('putRegistryEntry'));
    });
  });
});

describe('update_presence tool', () => {
  let sessionState: SessionState;
  const testGuid = '12345678-1234-4234-8234-123456789012';

  beforeEach(() => {
    // Setup registered session state
    sessionState = {
      handle: 'test-agent',
      agentGuid: testGuid,
      registeredEntry: {
        guid: testGuid,
        agentType: 'developer',
        handle: 'test-agent',
        hostname: 'test-host',
        projectId: '1234567890abcdef',
        natsUrl: 'nats://localhost:4222',
        capabilities: ['typescript'],
        scope: 'project',
        visibility: 'project-only',
        status: 'online',
        currentTaskCount: 0,
        registeredAt: '2025-01-15T09:00:00Z',
        lastHeartbeat: '2025-01-15T10:00:00Z',
      },
    };

    // Setup default mocks
    vi.mocked(kv.getRegistryEntry).mockResolvedValue(sessionState.registeredEntry);
    vi.mocked(kv.putRegistryEntry).mockResolvedValue(undefined);
    vi.mocked(heartbeat.stopHeartbeat).mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Status Update', () => {
    it('should update status to busy', async () => {
      const args = { status: 'busy' };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Presence updated:');
      expect(result.content[0]?.text).toContain('- Status: online → busy');
      expect(result.content[0]?.text).toContain('- Last Heartbeat:');
    });

    it('should update status to offline', async () => {
      const args = { status: 'offline' };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('- Status: online → offline');
      expect(heartbeat.stopHeartbeat).toHaveBeenCalled();
    });

    it('should update status to online', async () => {
      sessionState.registeredEntry!.status = 'busy';
      vi.mocked(kv.getRegistryEntry).mockResolvedValue(sessionState.registeredEntry);

      const args = { status: 'online' };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('- Status: busy → online');
    });
  });

  describe('Task Count Update', () => {
    it('should update current task count', async () => {
      const args = { currentTaskCount: 3 };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('- Current Tasks: 0 → 3');
    });

    it('should update task count to zero', async () => {
      sessionState.registeredEntry!.currentTaskCount = 5;
      vi.mocked(kv.getRegistryEntry).mockResolvedValue(sessionState.registeredEntry);

      const args = { currentTaskCount: 0 };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('- Current Tasks: 5 → 0');
    });
  });

  describe('Capabilities Update', () => {
    it('should update capabilities', async () => {
      const args = { capabilities: ['typescript', 'testing', 'code-review'] };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('- Capabilities: [typescript] → [typescript, testing, code-review]');
    });

    it('should update to empty capabilities', async () => {
      const args = { capabilities: [] };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('- Capabilities: [typescript] → [none]');
    });

    it('should update from empty capabilities', async () => {
      sessionState.registeredEntry!.capabilities = [];
      vi.mocked(kv.getRegistryEntry).mockResolvedValue(sessionState.registeredEntry);

      const args = { capabilities: ['python', 'django'] };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('- Capabilities: [none] → [python, django]');
    });
  });

  describe('Multiple Fields Update', () => {
    it('should update status and task count together', async () => {
      const args = { status: 'busy', currentTaskCount: 2 };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('- Status: online → busy');
      expect(result.content[0]?.text).toContain('- Current Tasks: 0 → 2');
    });

    it('should update all three fields', async () => {
      const args = {
        status: 'busy',
        currentTaskCount: 1,
        capabilities: ['typescript', 'react'],
      };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('- Status: online → busy');
      expect(result.content[0]?.text).toContain('- Current Tasks: 0 → 1');
      expect(result.content[0]?.text).toContain('- Capabilities: [typescript] → [typescript, react]');
    });
  });

  describe('Offline Status Stops Heartbeat', () => {
    it('should stop heartbeat when status changes to offline', async () => {
      const args = { status: 'offline' };
      await handleUpdatePresence(args, sessionState);

      expect(heartbeat.stopHeartbeat).toHaveBeenCalled();
    });

    it('should not stop heartbeat for busy status', async () => {
      const args = { status: 'busy' };
      await handleUpdatePresence(args, sessionState);

      expect(heartbeat.stopHeartbeat).not.toHaveBeenCalled();
    });

    it('should not stop heartbeat for online status', async () => {
      const args = { status: 'online' };
      await handleUpdatePresence(args, sessionState);

      expect(heartbeat.stopHeartbeat).not.toHaveBeenCalled();
    });
  });

  describe('Last Heartbeat Always Updated', () => {
    it('should update lastHeartbeat when updating status', async () => {
      const args = { status: 'busy' };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('- Last Heartbeat:');

      const [[, entry]] = vi.mocked(kv.putRegistryEntry).mock.calls;
      expect(entry.lastHeartbeat).toBeTruthy();
      expect(new Date(entry.lastHeartbeat!).getTime()).toBeGreaterThan(
        new Date('2025-01-15T10:00:00Z').getTime()
      );
    });

    it('should update lastHeartbeat when updating task count', async () => {
      const args = { currentTaskCount: 5 };
      await handleUpdatePresence(args, sessionState);

      const [[, entry]] = vi.mocked(kv.putRegistryEntry).mock.calls;
      expect(entry.lastHeartbeat).toBeTruthy();
    });

    it('should update lastHeartbeat when updating capabilities', async () => {
      const args = { capabilities: ['testing'] };
      await handleUpdatePresence(args, sessionState);

      const [[, entry]] = vi.mocked(kv.putRegistryEntry).mock.calls;
      expect(entry.lastHeartbeat).toBeTruthy();
    });
  });

  describe('Session State Update', () => {
    it('should update session state after successful update', async () => {
      const args = { status: 'busy', currentTaskCount: 3 };
      await handleUpdatePresence(args, sessionState);

      expect(sessionState.registeredEntry?.status).toBe('busy');
      expect(sessionState.registeredEntry?.currentTaskCount).toBe(3);
    });

    it('should preserve session state GUID', async () => {
      const args = { status: 'busy' };
      await handleUpdatePresence(args, sessionState);

      expect(sessionState.agentGuid).toBe(testGuid);
      expect(sessionState.registeredEntry?.guid).toBe(testGuid);
    });
  });

  describe('Registration Requirement', () => {
    it('should require caller to be registered', async () => {
      const unregisteredState: SessionState = {
        handle: null,
        agentGuid: null,
        registeredEntry: null,
      };

      const args = { status: 'busy' };
      const result = await handleUpdatePresence(args, unregisteredState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('You must be registered to update presence');
      expect(result.content[0]?.text).toContain('Use register_agent first');
    });

    it('should require both agentGuid and registeredEntry', async () => {
      const partialState: SessionState = {
        handle: 'test',
        agentGuid: testGuid,
        registeredEntry: null,
      };

      const args = { status: 'busy' };
      const result = await handleUpdatePresence(args, partialState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('You must be registered');
    });
  });

  describe('Validation', () => {
    it('should require at least one field to update', async () => {
      const args = {};
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('At least one field (status, currentTaskCount, or capabilities) must be provided');
    });
  });

  describe('Error Handling', () => {
    it('should handle failed entry retrieval', async () => {
      vi.mocked(kv.getRegistryEntry).mockRejectedValue(new Error('Connection failed'));

      const args = { status: 'busy' };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to retrieve current entry');
      expect(result.content[0]?.text).toContain('Connection failed');
    });

    it('should handle missing registry entry', async () => {
      vi.mocked(kv.getRegistryEntry).mockResolvedValue(null);

      const args = { status: 'busy' };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Registry entry not found');
      expect(result.content[0]?.text).toContain('You may need to re-register');
    });

    it('should handle failed entry update', async () => {
      vi.mocked(kv.putRegistryEntry).mockRejectedValue(new Error('Update failed'));

      const args = { status: 'busy' };
      const result = await handleUpdatePresence(args, sessionState);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to update presence');
      expect(result.content[0]?.text).toContain('Update failed');
    });
  });

  describe('KV Store Integration', () => {
    it('should retrieve current entry from KV store', async () => {
      const args = { status: 'busy' };
      await handleUpdatePresence(args, sessionState);

      expect(kv.getRegistryEntry).toHaveBeenCalledWith(testGuid);
    });

    it('should put updated entry to KV store', async () => {
      const args = { status: 'busy', currentTaskCount: 2 };
      await handleUpdatePresence(args, sessionState);

      expect(kv.putRegistryEntry).toHaveBeenCalled();
      const [[guid, entry]] = vi.mocked(kv.putRegistryEntry).mock.calls;
      expect(guid).toBe(testGuid);
      expect(entry.status).toBe('busy');
      expect(entry.currentTaskCount).toBe(2);
    });

    it('should preserve unchanged fields', async () => {
      const args = { status: 'busy' };
      await handleUpdatePresence(args, sessionState);

      const [[, entry]] = vi.mocked(kv.putRegistryEntry).mock.calls;
      expect(entry.agentType).toBe('developer');
      expect(entry.handle).toBe('test-agent');
      expect(entry.hostname).toBe('test-host');
      expect(entry.projectId).toBe('1234567890abcdef');
      expect(entry.capabilities).toEqual(['typescript']);
      expect(entry.currentTaskCount).toBe(0); // unchanged
    });
  });
});
