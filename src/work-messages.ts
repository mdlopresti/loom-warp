/**
 * Work message validation and creation utilities
 */

import { randomUUID } from 'crypto';
import type {
  InboxMessage,
  WorkMessageType,
  WorkOfferPayload,
  WorkClaimPayload,
  WorkAcceptPayload,
  WorkRejectPayload,
  ProgressUpdatePayload,
  WorkCompletePayload,
  WorkErrorPayload,
} from './types.js';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * UUID v4 validation pattern
 */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * ISO 8601 date validation pattern (basic validation)
 */
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/**
 * Validate UUID v4 format
 */
function validateUUID(uuid: string): boolean {
  return UUID_V4_PATTERN.test(uuid);
}

/**
 * Validate ISO 8601 timestamp
 */
function validateISO8601(timestamp: string): boolean {
  return ISO_8601_PATTERN.test(timestamp);
}

/**
 * Check if value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Check if value is a valid object
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check if value is an array of strings
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Validate work-offer payload
 */
function validateWorkOfferPayload(payload: unknown): ValidationResult {
  if (!isObject(payload)) {
    return { valid: false, error: 'Payload must be an object' };
  }

  const { workItemId, taskId, capability, description, priority, deadline, contextData } = payload;

  if (!isNonEmptyString(workItemId)) {
    return { valid: false, error: 'workItemId must be a non-empty string' };
  }

  if (!validateUUID(workItemId)) {
    return { valid: false, error: 'workItemId must be a valid UUID v4' };
  }

  if (!isNonEmptyString(taskId)) {
    return { valid: false, error: 'taskId must be a non-empty string' };
  }

  if (!isNonEmptyString(capability)) {
    return { valid: false, error: 'capability must be a non-empty string' };
  }

  if (!isNonEmptyString(description)) {
    return { valid: false, error: 'description must be a non-empty string' };
  }

  if (priority !== undefined) {
    if (typeof priority !== 'number' || priority < 1 || priority > 10) {
      return { valid: false, error: 'priority must be a number between 1 and 10' };
    }
  }

  if (deadline !== undefined) {
    if (!isNonEmptyString(deadline)) {
      return { valid: false, error: 'deadline must be a string' };
    }
    if (!validateISO8601(deadline)) {
      return { valid: false, error: 'deadline must be a valid ISO 8601 timestamp' };
    }
  }

  if (contextData !== undefined && !isObject(contextData)) {
    return { valid: false, error: 'contextData must be an object' };
  }

  return { valid: true };
}

/**
 * Validate work-claim payload
 */
function validateWorkClaimPayload(payload: unknown): ValidationResult {
  if (!isObject(payload)) {
    return { valid: false, error: 'Payload must be an object' };
  }

  const { workItemId, claimerCapabilities } = payload;

  if (!isNonEmptyString(workItemId)) {
    return { valid: false, error: 'workItemId must be a non-empty string' };
  }

  if (!validateUUID(workItemId)) {
    return { valid: false, error: 'workItemId must be a valid UUID v4' };
  }

  if (!isStringArray(claimerCapabilities)) {
    return { valid: false, error: 'claimerCapabilities must be an array of strings' };
  }

  if (claimerCapabilities.length === 0) {
    return { valid: false, error: 'claimerCapabilities cannot be empty' };
  }

  return { valid: true };
}

/**
 * Validate work-accept payload
 */
function validateWorkAcceptPayload(payload: unknown): ValidationResult {
  if (!isObject(payload)) {
    return { valid: false, error: 'Payload must be an object' };
  }

  const { workItemId, instructions } = payload;

  if (!isNonEmptyString(workItemId)) {
    return { valid: false, error: 'workItemId must be a non-empty string' };
  }

  if (!validateUUID(workItemId)) {
    return { valid: false, error: 'workItemId must be a valid UUID v4' };
  }

  if (instructions !== undefined && typeof instructions !== 'string') {
    return { valid: false, error: 'instructions must be a string' };
  }

  return { valid: true };
}

/**
 * Validate work-reject payload
 */
function validateWorkRejectPayload(payload: unknown): ValidationResult {
  if (!isObject(payload)) {
    return { valid: false, error: 'Payload must be an object' };
  }

  const { workItemId, reason } = payload;

  if (!isNonEmptyString(workItemId)) {
    return { valid: false, error: 'workItemId must be a non-empty string' };
  }

  if (!validateUUID(workItemId)) {
    return { valid: false, error: 'workItemId must be a valid UUID v4' };
  }

  if (!isNonEmptyString(reason)) {
    return { valid: false, error: 'reason must be a non-empty string' };
  }

  return { valid: true };
}

/**
 * Validate progress-update payload
 */
function validateProgressUpdatePayload(payload: unknown): ValidationResult {
  if (!isObject(payload)) {
    return { valid: false, error: 'Payload must be an object' };
  }

  const { workItemId, progress, message } = payload;

  if (!isNonEmptyString(workItemId)) {
    return { valid: false, error: 'workItemId must be a non-empty string' };
  }

  if (!validateUUID(workItemId)) {
    return { valid: false, error: 'workItemId must be a valid UUID v4' };
  }

  if (typeof progress !== 'number' || progress < 0 || progress > 100) {
    return { valid: false, error: 'progress must be a number between 0 and 100' };
  }

  if (message !== undefined && typeof message !== 'string') {
    return { valid: false, error: 'message must be a string' };
  }

  return { valid: true };
}

/**
 * Validate work-complete payload
 */
function validateWorkCompletePayload(payload: unknown): ValidationResult {
  if (!isObject(payload)) {
    return { valid: false, error: 'Payload must be an object' };
  }

  const { workItemId, result, summary } = payload;

  if (!isNonEmptyString(workItemId)) {
    return { valid: false, error: 'workItemId must be a non-empty string' };
  }

  if (!validateUUID(workItemId)) {
    return { valid: false, error: 'workItemId must be a valid UUID v4' };
  }

  if (result !== undefined && !isObject(result)) {
    return { valid: false, error: 'result must be an object' };
  }

  if (summary !== undefined && typeof summary !== 'string') {
    return { valid: false, error: 'summary must be a string' };
  }

  return { valid: true };
}

/**
 * Validate work-error payload
 */
function validateWorkErrorPayload(payload: unknown): ValidationResult {
  if (!isObject(payload)) {
    return { valid: false, error: 'Payload must be an object' };
  }

  const { workItemId, error, recoverable } = payload;

  if (!isNonEmptyString(workItemId)) {
    return { valid: false, error: 'workItemId must be a non-empty string' };
  }

  if (!validateUUID(workItemId)) {
    return { valid: false, error: 'workItemId must be a valid UUID v4' };
  }

  if (!isNonEmptyString(error)) {
    return { valid: false, error: 'error must be a non-empty string' };
  }

  if (typeof recoverable !== 'boolean') {
    return { valid: false, error: 'recoverable must be a boolean' };
  }

  return { valid: true };
}

/**
 * Validate work message based on message type
 */
export function validateWorkMessage(messageType: string, payload: unknown): ValidationResult {
  switch (messageType) {
    case 'work-offer':
      return validateWorkOfferPayload(payload);
    case 'work-claim':
      return validateWorkClaimPayload(payload);
    case 'work-accept':
      return validateWorkAcceptPayload(payload);
    case 'work-reject':
      return validateWorkRejectPayload(payload);
    case 'progress-update':
      return validateProgressUpdatePayload(payload);
    case 'work-complete':
      return validateWorkCompletePayload(payload);
    case 'work-error':
      return validateWorkErrorPayload(payload);
    default:
      return { valid: false, error: `Unknown work message type: ${messageType}` };
  }
}

/**
 * Create a work-offer InboxMessage
 */
export function createWorkOfferMessage(
  senderGuid: string,
  senderHandle: string,
  recipientGuid: string,
  payload: WorkOfferPayload
): InboxMessage {
  return {
    id: randomUUID(),
    senderGuid,
    senderHandle,
    recipientGuid,
    messageType: 'work-offer',
    content: JSON.stringify(payload),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a work-claim InboxMessage
 */
export function createWorkClaimMessage(
  senderGuid: string,
  senderHandle: string,
  recipientGuid: string,
  payload: WorkClaimPayload
): InboxMessage {
  return {
    id: randomUUID(),
    senderGuid,
    senderHandle,
    recipientGuid,
    messageType: 'work-claim',
    content: JSON.stringify(payload),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a work-accept InboxMessage
 */
export function createWorkAcceptMessage(
  senderGuid: string,
  senderHandle: string,
  recipientGuid: string,
  payload: WorkAcceptPayload
): InboxMessage {
  return {
    id: randomUUID(),
    senderGuid,
    senderHandle,
    recipientGuid,
    messageType: 'work-accept',
    content: JSON.stringify(payload),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a work-reject InboxMessage
 */
export function createWorkRejectMessage(
  senderGuid: string,
  senderHandle: string,
  recipientGuid: string,
  payload: WorkRejectPayload
): InboxMessage {
  return {
    id: randomUUID(),
    senderGuid,
    senderHandle,
    recipientGuid,
    messageType: 'work-reject',
    content: JSON.stringify(payload),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a progress-update InboxMessage
 */
export function createProgressUpdateMessage(
  senderGuid: string,
  senderHandle: string,
  recipientGuid: string,
  payload: ProgressUpdatePayload
): InboxMessage {
  return {
    id: randomUUID(),
    senderGuid,
    senderHandle,
    recipientGuid,
    messageType: 'progress-update',
    content: JSON.stringify(payload),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a work-complete InboxMessage
 */
export function createWorkCompleteMessage(
  senderGuid: string,
  senderHandle: string,
  recipientGuid: string,
  payload: WorkCompletePayload
): InboxMessage {
  return {
    id: randomUUID(),
    senderGuid,
    senderHandle,
    recipientGuid,
    messageType: 'work-complete',
    content: JSON.stringify(payload),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a work-error InboxMessage
 */
export function createWorkErrorMessage(
  senderGuid: string,
  senderHandle: string,
  recipientGuid: string,
  payload: WorkErrorPayload
): InboxMessage {
  return {
    id: randomUUID(),
    senderGuid,
    senderHandle,
    recipientGuid,
    messageType: 'work-error',
    content: JSON.stringify(payload),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Parse work message payload from content string
 */
export function parseWorkMessagePayload<T>(
  messageType: WorkMessageType,
  content: string
): T | null {
  try {
    const payload = JSON.parse(content);
    const validation = validateWorkMessage(messageType, payload);

    if (!validation.valid) {
      return null;
    }

    return payload as T;
  } catch {
    return null;
  }
}
