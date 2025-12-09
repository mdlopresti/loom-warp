/**
 * Tests for JetStream stream operations module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureStream,
  ensureAllStreams,
  getOrCreateConsumer,
  publishMessage,
  readMessages,
  getStreamInfo,
} from './streams.js';
import type { InternalChannel } from './types.js';

// Mock the nats module
vi.mock('./nats.js', () => ({
  getJetStreamManager: vi.fn(),
  getJetStreamClient: vi.fn(),
}));

// Mock the logger module
vi.mock('./logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Import mocked modules
import { getJetStreamManager, getJetStreamClient } from './nats.js';

describe('ensureStream', () => {
  let mockJsm: any;
  let mockChannel: InternalChannel;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannel = {
      name: 'test-channel',
      description: 'Test channel',
      streamName: 'TEST_STREAM',
      subject: 'test.subject',
      maxMessages: 10000,
      maxBytes: 10485760,
      maxAgeNanos: 86400000000000,
    };

    mockJsm = {
      streams: {
        info: vi.fn(),
        add: vi.fn(),
        update: vi.fn(),
      },
    };

    vi.mocked(getJetStreamManager).mockReturnValue(mockJsm);
  });

  it('should create a new stream when it does not exist', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));
    mockJsm.streams.add.mockResolvedValue({});

    await ensureStream(mockChannel);

    expect(mockJsm.streams.info).toHaveBeenCalledWith('TEST_STREAM');
    expect(mockJsm.streams.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'TEST_STREAM',
        subjects: ['test.subject'],
        max_msgs: 10000,
        max_bytes: 10485760,
        max_age: 86400000000000,
        num_replicas: 1,
      })
    );
  });

  it('should not create a stream when it already exists', async () => {
    mockJsm.streams.info.mockResolvedValue({
      config: { name: 'TEST_STREAM' },
      state: { messages: 0 },
    });

    await ensureStream(mockChannel);

    expect(mockJsm.streams.info).toHaveBeenCalledWith('TEST_STREAM');
    expect(mockJsm.streams.add).not.toHaveBeenCalled();
  });

  it('should handle "already in use" error gracefully', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));
    mockJsm.streams.add.mockRejectedValue(new Error('stream name already in use'));

    await expect(ensureStream(mockChannel)).resolves.not.toThrow();

    expect(mockJsm.streams.add).toHaveBeenCalled();
  });

  it('should throw error for other stream creation failures', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));
    mockJsm.streams.add.mockRejectedValue(new Error('permission denied'));

    await expect(ensureStream(mockChannel)).rejects.toThrow(
      'Failed to create stream TEST_STREAM: permission denied'
    );
  });

  it('should use correct stream configuration', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));
    mockJsm.streams.add.mockResolvedValue({});

    await ensureStream(mockChannel);

    const addCall = mockJsm.streams.add.mock.calls[0][0];
    expect(addCall.name).toBe('TEST_STREAM');
    expect(addCall.subjects).toEqual(['test.subject']);
    expect(addCall.max_msgs).toBe(10000);
    expect(addCall.max_bytes).toBe(10485760);
    expect(addCall.max_age).toBe(86400000000000);
    expect(addCall.num_replicas).toBe(1);
  });
});

describe('ensureAllStreams', () => {
  let mockJsm: any;
  let mockChannels: InternalChannel[];

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannels = [
      {
        name: 'channel1',
        description: 'Channel 1',
        streamName: 'STREAM1',
        subject: 'test.channel1',
        maxMessages: 5000,
        maxBytes: 5242880,
        maxAgeNanos: 3600000000000,
      },
      {
        name: 'channel2',
        description: 'Channel 2',
        streamName: 'STREAM2',
        subject: 'test.channel2',
        maxMessages: 10000,
        maxBytes: 10485760,
        maxAgeNanos: 7200000000000,
      },
    ];

    mockJsm = {
      streams: {
        info: vi.fn(),
        add: vi.fn(),
      },
    };

    vi.mocked(getJetStreamManager).mockReturnValue(mockJsm);
  });

  it('should create all streams', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));
    mockJsm.streams.add.mockResolvedValue({});

    await ensureAllStreams(mockChannels);

    expect(mockJsm.streams.info).toHaveBeenCalledTimes(2);
    expect(mockJsm.streams.add).toHaveBeenCalledTimes(2);
    expect(mockJsm.streams.info).toHaveBeenCalledWith('STREAM1');
    expect(mockJsm.streams.info).toHaveBeenCalledWith('STREAM2');
  });

  it('should handle empty channel list', async () => {
    await ensureAllStreams([]);

    expect(mockJsm.streams.info).not.toHaveBeenCalled();
    expect(mockJsm.streams.add).not.toHaveBeenCalled();
  });

  it('should process streams sequentially', async () => {
    const callOrder: string[] = [];
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));
    mockJsm.streams.add.mockImplementation(async (config: any) => {
      callOrder.push(config.name);
      return {};
    });

    await ensureAllStreams(mockChannels);

    expect(callOrder).toEqual(['STREAM1', 'STREAM2']);
  });
});

describe('getOrCreateConsumer', () => {
  let mockJsm: any;
  let mockChannel: InternalChannel;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannel = {
      name: 'test-channel',
      description: 'Test channel',
      streamName: 'TEST_STREAM',
      subject: 'test.subject',
      maxMessages: 10000,
      maxBytes: 10485760,
      maxAgeNanos: 86400000000000,
    };

    mockJsm = {
      consumers: {
        info: vi.fn(),
        add: vi.fn(),
      },
    };

    vi.mocked(getJetStreamManager).mockReturnValue(mockJsm);
  });

  it('should return existing consumer name when consumer exists', async () => {
    mockJsm.consumers.info.mockResolvedValue({
      name: 'TEST_STREAM_READER',
      config: {},
    });

    const result = await getOrCreateConsumer(mockChannel);

    expect(result).toBe('TEST_STREAM_READER');
    expect(mockJsm.consumers.info).toHaveBeenCalledWith('TEST_STREAM', 'TEST_STREAM_READER');
    expect(mockJsm.consumers.add).not.toHaveBeenCalled();
  });

  it('should create new consumer when it does not exist', async () => {
    mockJsm.consumers.info.mockRejectedValue(new Error('consumer not found'));
    mockJsm.consumers.add.mockResolvedValue({});

    const result = await getOrCreateConsumer(mockChannel);

    expect(result).toBe('TEST_STREAM_READER');
    expect(mockJsm.consumers.add).toHaveBeenCalledWith('TEST_STREAM',
      expect.objectContaining({
        durable_name: 'TEST_STREAM_READER',
      })
    );
  });

  it('should use correct consumer configuration', async () => {
    mockJsm.consumers.info.mockRejectedValue(new Error('consumer not found'));
    mockJsm.consumers.add.mockResolvedValue({});

    await getOrCreateConsumer(mockChannel);

    const addCall = mockJsm.consumers.add.mock.calls[0][1];
    expect(addCall.durable_name).toBe('TEST_STREAM_READER');
    expect(addCall).toHaveProperty('ack_policy');
    expect(addCall).toHaveProperty('deliver_policy');
    expect(addCall).toHaveProperty('replay_policy');
  });

  it('should generate correct consumer name from stream name', async () => {
    const channel: InternalChannel = {
      ...mockChannel,
      streamName: 'MY_CUSTOM_STREAM',
    };

    mockJsm.consumers.info.mockResolvedValue({});

    const result = await getOrCreateConsumer(channel);

    expect(result).toBe('MY_CUSTOM_STREAM_READER');
  });
});

describe('publishMessage', () => {
  let mockJs: any;
  let mockChannel: InternalChannel;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannel = {
      name: 'test-channel',
      description: 'Test channel',
      streamName: 'TEST_STREAM',
      subject: 'test.subject',
      maxMessages: 10000,
      maxBytes: 10485760,
      maxAgeNanos: 86400000000000,
    };

    mockJs = {
      publish: vi.fn(),
    };

    vi.mocked(getJetStreamClient).mockReturnValue(mockJs);
  });

  it('should publish message to correct subject', async () => {
    mockJs.publish.mockResolvedValue({ seq: 1, stream: 'TEST_STREAM' });

    await publishMessage(mockChannel, 'test payload');

    expect(mockJs.publish).toHaveBeenCalledWith('test.subject', expect.any(Buffer));
    const buffer = mockJs.publish.mock.calls[0][1];
    expect(buffer.toString()).toBe('test payload');
  });

  it('should handle successful publish with acknowledgment', async () => {
    mockJs.publish.mockResolvedValue({ seq: 42, stream: 'TEST_STREAM' });

    await expect(publishMessage(mockChannel, 'test message')).resolves.not.toThrow();

    expect(mockJs.publish).toHaveBeenCalled();
  });

  it('should throw error when publish fails', async () => {
    mockJs.publish.mockRejectedValue(new Error('stream unavailable'));

    await expect(publishMessage(mockChannel, 'test message')).rejects.toThrow(
      'Failed to publish message to test-channel: stream unavailable'
    );
  });

  it('should convert string payload to Buffer', async () => {
    mockJs.publish.mockResolvedValue({ seq: 1, stream: 'TEST_STREAM' });

    await publishMessage(mockChannel, 'Hello, World!');

    const buffer = mockJs.publish.mock.calls[0][1];
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString()).toBe('Hello, World!');
  });

  it('should publish to correct channel subject', async () => {
    const channel: InternalChannel = {
      ...mockChannel,
      subject: 'custom.subject.path',
    };

    mockJs.publish.mockResolvedValue({ seq: 1, stream: 'TEST_STREAM' });

    await publishMessage(channel, 'test');

    expect(mockJs.publish).toHaveBeenCalledWith('custom.subject.path', expect.any(Buffer));
  });
});

describe('readMessages', () => {
  let mockJs: any;
  let mockJsm: any;
  let mockChannel: InternalChannel;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannel = {
      name: 'test-channel',
      description: 'Test channel',
      streamName: 'TEST_STREAM',
      subject: 'test.subject',
      maxMessages: 10000,
      maxBytes: 10485760,
      maxAgeNanos: 86400000000000,
    };

    mockJsm = {
      consumers: {
        info: vi.fn(),
        add: vi.fn(),
      },
    };

    mockJs = {
      consumers: {
        get: vi.fn(),
      },
    };

    vi.mocked(getJetStreamManager).mockReturnValue(mockJsm);
    vi.mocked(getJetStreamClient).mockReturnValue(mockJs);
  });

  it('should read messages from stream', async () => {
    mockJsm.consumers.info.mockResolvedValue({});

    const mockMessages = [
      { data: Buffer.from('message 1'), ack: vi.fn() },
      { data: Buffer.from('message 2'), ack: vi.fn() },
    ];

    const mockIterator = (async function* () {
      for (const msg of mockMessages) {
        yield msg;
      }
    })();

    const mockConsumer = {
      fetch: vi.fn().mockResolvedValue(mockIterator),
    };

    mockJs.consumers.get.mockResolvedValue(mockConsumer);

    const result = await readMessages(mockChannel, 10);

    expect(result).toHaveLength(2);
    expect(result[0].data).toBe('message 1');
    expect(result[1].data).toBe('message 2');
    expect(typeof result[0].ack).toBe('function');
    expect(typeof result[1].ack).toBe('function');
  });

  it('should respect message limit', async () => {
    mockJsm.consumers.info.mockResolvedValue({});

    const mockConsumer = {
      fetch: vi.fn().mockResolvedValue((async function* () {})()),
    };

    mockJs.consumers.get.mockResolvedValue(mockConsumer);

    await readMessages(mockChannel, 5);

    expect(mockConsumer.fetch).toHaveBeenCalledWith({
      max_messages: 5,
      expires: 5000,
    });
  });

  it('should return empty array when no messages available', async () => {
    mockJsm.consumers.info.mockResolvedValue({});

    const mockConsumer = {
      fetch: vi.fn().mockRejectedValue(new Error('no messages')),
    };

    mockJs.consumers.get.mockResolvedValue(mockConsumer);

    const result = await readMessages(mockChannel, 10);

    expect(result).toEqual([]);
  });

  it('should throw error for non-empty queue failures', async () => {
    mockJsm.consumers.info.mockResolvedValue({});

    const mockConsumer = {
      fetch: vi.fn().mockRejectedValue(new Error('permission denied')),
    };

    mockJs.consumers.get.mockResolvedValue(mockConsumer);

    await expect(readMessages(mockChannel, 10)).rejects.toThrow(
      'Failed to read messages from test-channel: permission denied'
    );
  });

  it('should create consumer if it does not exist', async () => {
    mockJsm.consumers.info.mockRejectedValue(new Error('consumer not found'));
    mockJsm.consumers.add.mockResolvedValue({});

    const mockConsumer = {
      fetch: vi.fn().mockResolvedValue((async function* () {})()),
    };

    mockJs.consumers.get.mockResolvedValue(mockConsumer);

    await readMessages(mockChannel, 10);

    expect(mockJsm.consumers.add).toHaveBeenCalled();
    expect(mockJs.consumers.get).toHaveBeenCalledWith('TEST_STREAM', 'TEST_STREAM_READER');
  });

  it('should provide working ack functions for messages', async () => {
    mockJsm.consumers.info.mockResolvedValue({});

    const mockAck1 = vi.fn();
    const mockAck2 = vi.fn();

    const mockMessages = [
      { data: Buffer.from('msg1'), ack: mockAck1 },
      { data: Buffer.from('msg2'), ack: mockAck2 },
    ];

    const mockIterator = (async function* () {
      for (const msg of mockMessages) {
        yield msg;
      }
    })();

    const mockConsumer = {
      fetch: vi.fn().mockResolvedValue(mockIterator),
    };

    mockJs.consumers.get.mockResolvedValue(mockConsumer);

    const result = await readMessages(mockChannel, 10);

    result[0].ack();
    result[1].ack();

    expect(mockAck1).toHaveBeenCalled();
    expect(mockAck2).toHaveBeenCalled();
  });

  it('should convert Buffer data to string', async () => {
    mockJsm.consumers.info.mockResolvedValue({});

    const mockMessages = [
      { data: Buffer.from('Hello'), ack: vi.fn() },
      { data: Buffer.from('World'), ack: vi.fn() },
    ];

    const mockIterator = (async function* () {
      for (const msg of mockMessages) {
        yield msg;
      }
    })();

    const mockConsumer = {
      fetch: vi.fn().mockResolvedValue(mockIterator),
    };

    mockJs.consumers.get.mockResolvedValue(mockConsumer);

    const result = await readMessages(mockChannel, 10);

    expect(result[0].data).toBe('Hello');
    expect(result[1].data).toBe('World');
  });
});

describe('getStreamInfo', () => {
  let mockJsm: any;
  let mockChannel: InternalChannel;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannel = {
      name: 'test-channel',
      description: 'Test channel',
      streamName: 'TEST_STREAM',
      subject: 'test.subject',
      maxMessages: 10000,
      maxBytes: 10485760,
      maxAgeNanos: 86400000000000,
    };

    mockJsm = {
      streams: {
        info: vi.fn(),
      },
    };

    vi.mocked(getJetStreamManager).mockReturnValue(mockJsm);
  });

  it('should return stream info when stream exists', async () => {
    mockJsm.streams.info.mockResolvedValue({
      state: {
        messages: 42,
        bytes: 1024,
        first_seq: 1,
        last_seq: 42,
      },
    });

    const result = await getStreamInfo(mockChannel);

    expect(result).toEqual({
      messages: 42,
      bytes: 1024,
      firstSeq: 1,
      lastSeq: 42,
    });
  });

  it('should return null when stream does not exist', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('stream not found'));

    const result = await getStreamInfo(mockChannel);

    expect(result).toBeNull();
  });

  it('should handle empty stream', async () => {
    mockJsm.streams.info.mockResolvedValue({
      state: {
        messages: 0,
        bytes: 0,
        first_seq: 0,
        last_seq: 0,
      },
    });

    const result = await getStreamInfo(mockChannel);

    expect(result).toEqual({
      messages: 0,
      bytes: 0,
      firstSeq: 0,
      lastSeq: 0,
    });
  });

  it('should handle stream with many messages', async () => {
    mockJsm.streams.info.mockResolvedValue({
      state: {
        messages: 1000000,
        bytes: 524288000,
        first_seq: 1,
        last_seq: 1000000,
      },
    });

    const result = await getStreamInfo(mockChannel);

    expect(result).toEqual({
      messages: 1000000,
      bytes: 524288000,
      firstSeq: 1,
      lastSeq: 1000000,
    });
  });

  it('should call streams.info with correct stream name', async () => {
    const channel: InternalChannel = {
      ...mockChannel,
      streamName: 'CUSTOM_STREAM_NAME',
    };

    mockJsm.streams.info.mockResolvedValue({
      state: {
        messages: 10,
        bytes: 100,
        first_seq: 1,
        last_seq: 10,
      },
    });

    await getStreamInfo(channel);

    expect(mockJsm.streams.info).toHaveBeenCalledWith('CUSTOM_STREAM_NAME');
  });

  it('should return null for any stream error', async () => {
    mockJsm.streams.info.mockRejectedValue(new Error('connection timeout'));

    const result = await getStreamInfo(mockChannel);

    expect(result).toBeNull();
  });
});
