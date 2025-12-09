/**
 * NATS JetStream KV Store integration for agent registry
 */

import type { KV, KvWatchOptions } from 'nats';
import { StorageType, DiscardPolicy } from 'nats';
import { getJetStreamManager, getConnection } from './nats.js';
import { createLogger } from './logger.js';
import type { RegistryEntry, RegistryEvent } from './types.js';

const logger = createLogger('kv-store');

/** Default bucket configuration */
const DEFAULT_BUCKET_NAME = 'agent-registry';
const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/** In-memory bucket reference */
let bucketInstance: KV | null = null;
let currentBucketName: string | null = null;

/**
 * Initialize KV bucket (idempotent - create if not exists)
 */
export async function initializeRegistry(bucketName: string = DEFAULT_BUCKET_NAME): Promise<void> {
  // If already initialized with same bucket, return early
  if (bucketInstance && currentBucketName === bucketName) {
    logger.debug('Registry already initialized', { bucket: bucketName });
    return;
  }

  const jsm = getJetStreamManager();

  try {
    // Try to get existing bucket
    const js = getConnection().jetstream();
    bucketInstance = await js.views.kv(bucketName);
    currentBucketName = bucketName;
    logger.debug('Using existing KV bucket', { bucket: bucketName });
    return;
  } catch (err) {
    const error = err as Error;
    // Bucket doesn't exist, create it
    if (error.message?.includes('not found') || error.message?.includes('does not exist')) {
      logger.info('Creating new KV bucket', { bucket: bucketName });

      try {
        await jsm.streams.add({
          name: `KV_${bucketName}`,
          subjects: [`$KV.${bucketName}.>`],
          storage: StorageType.File,
          max_age: DEFAULT_TTL_SECONDS * 1_000_000_000, // Convert to nanoseconds
          allow_rollup_hdrs: true,
          deny_delete: true,
          deny_purge: false,
          allow_direct: true,
          discard: DiscardPolicy.Old,
        });

        const js = getConnection().jetstream();
        bucketInstance = await js.views.kv(bucketName);
        currentBucketName = bucketName;
        logger.info('Created KV bucket', { bucket: bucketName });
        return;
      } catch (createErr) {
        const createError = createErr as Error;
        // Handle race condition where bucket was created by another process
        if (createError.message?.includes('already in use') || createError.message?.includes('exists')) {
          const js = getConnection().jetstream();
          bucketInstance = await js.views.kv(bucketName);
          currentBucketName = bucketName;
          logger.debug('KV bucket created by concurrent process', { bucket: bucketName });
          return;
        }
        throw createError;
      }
    }
    throw error;
  }
}

/**
 * Get the KV bucket instance (throws if not initialized)
 */
function getBucket(): KV {
  if (!bucketInstance) {
    throw new Error('KV bucket not initialized. Call initializeRegistry() first.');
  }
  return bucketInstance;
}

/**
 * Get a registry entry by key (GUID)
 */
export async function getRegistryEntry(guid: string): Promise<RegistryEntry | null> {
  const bucket = getBucket();

  try {
    const entry = await bucket.get(guid);

    if (!entry || !entry.value) {
      return null;
    }

    const data = JSON.parse(entry.string()) as RegistryEntry;
    logger.debug('Retrieved registry entry', { guid, handle: data.handle });
    return data;
  } catch (err) {
    const error = err as Error;
    // Key not found is not an error, return null
    if (error.message?.includes('not found') || error.message?.includes('no message found')) {
      logger.debug('Registry entry not found', { guid });
      return null;
    }
    logger.error('Failed to get registry entry', { guid, error: error.message });
    throw new Error(`Failed to get registry entry ${guid}: ${error.message}`);
  }
}

/**
 * Put a registry entry (create or update)
 */
export async function putRegistryEntry(guid: string, entry: RegistryEntry): Promise<void> {
  const bucket = getBucket();

  try {
    const payload = JSON.stringify(entry);
    await bucket.put(guid, payload);
    logger.debug('Stored registry entry', { guid, handle: entry.handle });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to put registry entry', { guid, error: error.message });
    throw new Error(`Failed to put registry entry ${guid}: ${error.message}`);
  }
}

/**
 * Delete a registry entry
 */
export async function deleteRegistryEntry(guid: string): Promise<boolean> {
  const bucket = getBucket();

  try {
    await bucket.delete(guid);
    logger.debug('Deleted registry entry', { guid });
    return true;
  } catch (err) {
    const error = err as Error;
    // Key not found is not an error for delete
    if (error.message?.includes('not found') || error.message?.includes('no message found')) {
      logger.debug('Registry entry not found for deletion', { guid });
      return false;
    }
    logger.error('Failed to delete registry entry', { guid, error: error.message });
    throw new Error(`Failed to delete registry entry ${guid}: ${error.message}`);
  }
}

/**
 * List all registry entries (with optional filter callback)
 */
export async function listRegistryEntries(
  filter?: (entry: RegistryEntry) => boolean
): Promise<RegistryEntry[]> {
  const bucket = getBucket();
  const entries: RegistryEntry[] = [];

  try {
    const keys = await bucket.keys();

    for await (const key of keys) {
      try {
        const entry = await getRegistryEntry(key);
        if (entry) {
          // Apply filter if provided
          if (!filter || filter(entry)) {
            entries.push(entry);
          }
        }
      } catch (err) {
        const error = err as Error;
        logger.warn('Failed to get entry during list', { key, error: error.message });
        // Continue with other entries
      }
    }

    logger.debug('Listed registry entries', { count: entries.length });
    return entries;
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to list registry entries', { error: error.message });
    throw new Error(`Failed to list registry entries: ${error.message}`);
  }
}

/**
 * Watch for changes (for real-time updates)
 * Returns a cleanup function to stop watching
 */
export async function watchRegistry(
  callback: (event: RegistryEvent) => void
): Promise<() => void> {
  const bucket = getBucket();

  try {
    const watchOptions: KvWatchOptions = {
      key: '>',  // Watch all keys
    };

    const watcher = await bucket.watch(watchOptions);
    logger.info('Started watching registry for changes');

    // Process watch events
    (async () => {
      try {
        for await (const entry of watcher) {
          try {
            const key = entry.key;

            // Determine event type
            let eventType: 'put' | 'delete';
            let data: RegistryEntry | null = null;

            if (entry.operation === 'DEL' || entry.operation === 'PURGE') {
              eventType = 'delete';
            } else {
              eventType = 'put';
              if (entry.value) {
                data = JSON.parse(entry.string()) as RegistryEntry;
              }
            }

            const event: RegistryEvent = {
              type: eventType,
              guid: key,
              ...(data ? { entry: data } : {}),
            };

            callback(event);
          } catch (parseErr) {
            const error = parseErr as Error;
            logger.error('Error parsing watch event', { error: error.message });
          }
        }
      } catch (err) {
        const error = err as Error;
        logger.error('Error in watch loop', { error: error.message });
      }
    })().catch((err) => {
      logger.error('Watch loop failed', { error: (err as Error).message });
    });

    // Return cleanup function
    return async () => {
      try {
        await watcher.stop();
        logger.info('Stopped watching registry');
      } catch (err) {
        const error = err as Error;
        logger.error('Error stopping watcher', { error: error.message });
      }
    };
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to start watching registry', { error: error.message });
    throw new Error(`Failed to watch registry: ${error.message}`);
  }
}

/**
 * Clear the bucket instance (for testing)
 */
export function resetBucket(): void {
  bucketInstance = null;
  currentBucketName = null;
}
