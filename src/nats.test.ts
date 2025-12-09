/**
 * Tests for NATS connection module
 *
 * Note: Full integration tests require a running NATS server.
 * These unit tests focus on testable helper functions and error conditions.
 */

import { describe, it, expect } from 'vitest';

// Test the module exports exist
describe('nats module exports', () => {
  it('should export connectToNats function', async () => {
    const nats = await import('./nats.js');
    expect(typeof nats.connectToNats).toBe('function');
  });

  it('should export getConnection function', async () => {
    const nats = await import('./nats.js');
    expect(typeof nats.getConnection).toBe('function');
  });

  it('should export getJetStreamClient function', async () => {
    const nats = await import('./nats.js');
    expect(typeof nats.getJetStreamClient).toBe('function');
  });

  it('should export getJetStreamManager function', async () => {
    const nats = await import('./nats.js');
    expect(typeof nats.getJetStreamManager).toBe('function');
  });

  it('should export isConnected function', async () => {
    const nats = await import('./nats.js');
    expect(typeof nats.isConnected).toBe('function');
  });

  it('should export disconnect function', async () => {
    const nats = await import('./nats.js');
    expect(typeof nats.disconnect).toBe('function');
  });

  it('should export setupShutdownHandlers function', async () => {
    const nats = await import('./nats.js');
    expect(typeof nats.setupShutdownHandlers).toBe('function');
  });
});

describe('getConnection', () => {
  it('should throw when not connected', async () => {
    const { getConnection } = await import('./nats.js');
    // Since we haven't connected, this should throw
    expect(() => getConnection()).toThrow('Not connected to NATS');
  });
});

describe('getJetStreamClient', () => {
  it('should throw when not connected', async () => {
    const { getJetStreamClient } = await import('./nats.js');
    expect(() => getJetStreamClient()).toThrow('JetStream client not initialized');
  });
});

describe('getJetStreamManager', () => {
  it('should throw when not connected', async () => {
    const { getJetStreamManager } = await import('./nats.js');
    expect(() => getJetStreamManager()).toThrow('JetStream manager not initialized');
  });
});

describe('isConnected', () => {
  it('should return false when not connected', async () => {
    const { isConnected } = await import('./nats.js');
    expect(isConnected()).toBe(false);
  });
});

describe('disconnect', () => {
  it('should not throw when not connected', async () => {
    const { disconnect } = await import('./nats.js');
    // Should complete without throwing
    await expect(disconnect()).resolves.toBeUndefined();
  });
});
