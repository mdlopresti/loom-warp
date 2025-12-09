/**
 * Tests for configuration module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseDurationToNanos,
  generateNamespace,
  validateChannelName,
  validateChannelConfig,
  toInternalChannel,
  loadConfig,
} from './config.js';
import { DEFAULT_CONFIG } from './types.js';

describe('parseDurationToNanos', () => {
  it('should parse seconds', () => {
    expect(parseDurationToNanos('1s')).toBe(1000000000);
    expect(parseDurationToNanos('60s')).toBe(60000000000);
  });

  it('should parse minutes', () => {
    expect(parseDurationToNanos('1m')).toBe(60 * 1000000000);
    expect(parseDurationToNanos('30m')).toBe(30 * 60 * 1000000000);
  });

  it('should parse hours', () => {
    expect(parseDurationToNanos('1h')).toBe(60 * 60 * 1000000000);
    expect(parseDurationToNanos('24h')).toBe(24 * 60 * 60 * 1000000000);
  });

  it('should parse days', () => {
    expect(parseDurationToNanos('1d')).toBe(24 * 60 * 60 * 1000000000);
    expect(parseDurationToNanos('7d')).toBe(7 * 24 * 60 * 60 * 1000000000);
  });

  it('should throw on invalid format', () => {
    expect(() => parseDurationToNanos('invalid')).toThrow('Invalid duration format');
    expect(() => parseDurationToNanos('24')).toThrow('Invalid duration format');
    expect(() => parseDurationToNanos('h24')).toThrow('Invalid duration format');
  });
});

describe('generateNamespace', () => {
  it('should generate consistent namespace for same path', () => {
    const ns1 = generateNamespace('/home/user/project');
    const ns2 = generateNamespace('/home/user/project');
    expect(ns1).toBe(ns2);
  });

  it('should generate different namespaces for different paths', () => {
    const ns1 = generateNamespace('/home/user/project1');
    const ns2 = generateNamespace('/home/user/project2');
    expect(ns1).not.toBe(ns2);
  });

  it('should generate 16 character namespace', () => {
    const ns = generateNamespace('/any/path');
    expect(ns.length).toBe(16);
  });

  it('should generate lowercase hex namespace', () => {
    const ns = generateNamespace('/any/path');
    expect(ns).toMatch(/^[a-f0-9]+$/);
  });
});

describe('validateChannelName', () => {
  it('should accept valid channel names', () => {
    expect(() => validateChannelName('roadmap')).not.toThrow();
    expect(() => validateChannelName('parallel-work')).not.toThrow();
    expect(() => validateChannelName('sprint-1')).not.toThrow();
    expect(() => validateChannelName('a')).not.toThrow();
  });

  it('should reject invalid channel names', () => {
    expect(() => validateChannelName('UPPERCASE')).toThrow('Invalid channel name');
    expect(() => validateChannelName('with spaces')).toThrow('Invalid channel name');
    expect(() => validateChannelName('with_underscore')).toThrow('Invalid channel name');
    expect(() => validateChannelName('special@chars')).toThrow('Invalid channel name');
  });
});

describe('validateChannelConfig', () => {
  it('should accept valid channel config', () => {
    expect(() =>
      validateChannelConfig({
        name: 'test-channel',
        description: 'A test channel',
      })
    ).not.toThrow();
  });

  it('should accept channel config with all options', () => {
    expect(() =>
      validateChannelConfig({
        name: 'test-channel',
        description: 'A test channel',
        maxMessages: 5000,
        maxBytes: 1048576,
        maxAge: '7d',
      })
    ).not.toThrow();
  });

  it('should reject missing description', () => {
    expect(() =>
      validateChannelConfig({
        name: 'test',
        description: '',
      })
    ).toThrow('must have a description');
  });

  it('should reject invalid maxMessages', () => {
    expect(() =>
      validateChannelConfig({
        name: 'test',
        description: 'Test',
        maxMessages: 0,
      })
    ).toThrow('maxMessages must be at least 1');
  });

  it('should reject invalid maxBytes', () => {
    expect(() =>
      validateChannelConfig({
        name: 'test',
        description: 'Test',
        maxBytes: 100,
      })
    ).toThrow('maxBytes must be at least 1024');
  });

  it('should reject invalid maxAge', () => {
    expect(() =>
      validateChannelConfig({
        name: 'test',
        description: 'Test',
        maxAge: 'invalid',
      })
    ).toThrow('invalid maxAge format');
  });
});

describe('toInternalChannel', () => {
  it('should convert channel config to internal representation', () => {
    const channel = toInternalChannel(
      {
        name: 'test-channel',
        description: 'A test channel',
      },
      'myproject'
    );

    expect(channel.name).toBe('test-channel');
    expect(channel.description).toBe('A test channel');
    expect(channel.streamName).toBe('myproject_TEST_CHANNEL');
    expect(channel.subject).toBe('myproject.test-channel');
    expect(channel.maxMessages).toBe(10000); // default
    expect(channel.maxBytes).toBe(10485760); // default
  });

  it('should use custom values when provided', () => {
    const channel = toInternalChannel(
      {
        name: 'custom',
        description: 'Custom channel',
        maxMessages: 5000,
        maxBytes: 1048576,
        maxAge: '1h',
      },
      'ns'
    );

    expect(channel.maxMessages).toBe(5000);
    expect(channel.maxBytes).toBe(1048576);
    expect(channel.maxAgeNanos).toBe(60 * 60 * 1000000000);
  });
});

describe('Work Queue Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('Default values', () => {
    it('should have correct default ackTimeoutMs', () => {
      expect(DEFAULT_CONFIG.workQueue.ackTimeoutMs).toBe(300000); // 5 minutes
    });

    it('should have correct default maxDeliveryAttempts', () => {
      expect(DEFAULT_CONFIG.workQueue.maxDeliveryAttempts).toBe(3);
    });

    it('should have correct default deadLetterTTLMs', () => {
      expect(DEFAULT_CONFIG.workQueue.deadLetterTTLMs).toBe(604800000); // 7 days
    });
  });

  describe('Environment variable overrides', () => {
    it('should override ackTimeoutMs from WORKQUEUE_ACK_TIMEOUT', async () => {
      process.env['WORKQUEUE_ACK_TIMEOUT'] = '600000'; // 10 minutes
      const config = await loadConfig();
      expect(config.workQueue.ackTimeoutMs).toBe(600000);
    });

    it('should override maxDeliveryAttempts from WORKQUEUE_MAX_ATTEMPTS', async () => {
      process.env['WORKQUEUE_MAX_ATTEMPTS'] = '5';
      const config = await loadConfig();
      expect(config.workQueue.maxDeliveryAttempts).toBe(5);
    });

    it('should override deadLetterTTLMs from WORKQUEUE_DLQ_TTL', async () => {
      process.env['WORKQUEUE_DLQ_TTL'] = '1209600000'; // 14 days
      const config = await loadConfig();
      expect(config.workQueue.deadLetterTTLMs).toBe(1209600000);
    });

    it('should override all work queue settings via env vars', async () => {
      process.env['WORKQUEUE_ACK_TIMEOUT'] = '120000'; // 2 minutes
      process.env['WORKQUEUE_MAX_ATTEMPTS'] = '10';
      process.env['WORKQUEUE_DLQ_TTL'] = '86400000'; // 1 day

      const config = await loadConfig();

      expect(config.workQueue.ackTimeoutMs).toBe(120000);
      expect(config.workQueue.maxDeliveryAttempts).toBe(10);
      expect(config.workQueue.deadLetterTTLMs).toBe(86400000);
    });
  });

  describe('loadConfig integration', () => {
    it('should load work queue defaults when no config exists', async () => {
      const config = await loadConfig();

      expect(config.workQueue).toBeDefined();
      expect(config.workQueue.ackTimeoutMs).toBe(DEFAULT_CONFIG.workQueue.ackTimeoutMs);
      expect(config.workQueue.maxDeliveryAttempts).toBe(
        DEFAULT_CONFIG.workQueue.maxDeliveryAttempts
      );
      expect(config.workQueue.deadLetterTTLMs).toBe(DEFAULT_CONFIG.workQueue.deadLetterTTLMs);
    });

    it('should include work queue config in resolved config', async () => {
      const config = await loadConfig();

      expect(config).toHaveProperty('workQueue');
      expect(config.workQueue).toHaveProperty('ackTimeoutMs');
      expect(config.workQueue).toHaveProperty('maxDeliveryAttempts');
      expect(config.workQueue).toHaveProperty('deadLetterTTLMs');
    });

    it('should parse numeric env vars correctly', async () => {
      process.env['WORKQUEUE_ACK_TIMEOUT'] = '999999';
      const config = await loadConfig();
      expect(typeof config.workQueue.ackTimeoutMs).toBe('number');
      expect(config.workQueue.ackTimeoutMs).toBe(999999);
    });
  });
});
