/**
 * Tests for NATS URL parsing and authentication support
 */

import { describe, it, expect } from 'vitest';
import { parseNatsUrl } from './nats.js';

describe('parseNatsUrl', () => {
  describe('URLs without authentication', () => {
    it('should parse simple nats URL', () => {
      const result = parseNatsUrl('nats://localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
      });
    });

    it('should parse URL with hostname', () => {
      const result = parseNatsUrl('nats://nats.example.com:4222');
      expect(result).toEqual({
        server: 'nats://nats.example.com:4222',
      });
    });

    it('should parse URL without port', () => {
      const result = parseNatsUrl('nats://localhost');
      expect(result).toEqual({
        server: 'nats://localhost',
      });
    });

    it('should handle IP address', () => {
      const result = parseNatsUrl('nats://192.168.1.100:4222');
      expect(result).toEqual({
        server: 'nats://192.168.1.100:4222',
      });
    });
  });

  describe('URLs with authentication', () => {
    it('should parse URL with user and password', () => {
      const result = parseNatsUrl('nats://myuser:mypass@localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        user: 'myuser',
        pass: 'mypass',
      });
    });

    it('should parse URL with user only', () => {
      const result = parseNatsUrl('nats://myuser@localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        user: 'myuser',
      });
    });

    it('should handle URL-encoded credentials', () => {
      const result = parseNatsUrl('nats://user%40domain:p%40ss%2Fword@localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        user: 'user@domain',
        pass: 'p@ss/word',
      });
    });

    it('should handle password with special characters', () => {
      const result = parseNatsUrl('nats://agent:FxZWmPIV6rzDC4i6xuk9AEJ9Kd5sMpFi58%2FOAtr7INQ%3D@nats.example.com:4222');
      expect(result).toEqual({
        server: 'nats://nats.example.com:4222',
        user: 'agent',
        pass: 'FxZWmPIV6rzDC4i6xuk9AEJ9Kd5sMpFi58/OAtr7INQ=',
      });
    });

    it('should handle base64-like passwords without encoding', () => {
      // Base64 passwords that don't contain special URL characters
      const result = parseNatsUrl('nats://admin:sxbJZgRH5quUu7weyiX1cF2g30vtZwTuSePL9V70I@localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        user: 'admin',
        pass: 'sxbJZgRH5quUu7weyiX1cF2g30vtZwTuSePL9V70I',
      });
    });

    it('should preserve credentials with plus signs', () => {
      // Plus signs in URLs can be interpreted as spaces, so they should be encoded
      const result = parseNatsUrl('nats://user:pass%2Bword@localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        user: 'user',
        pass: 'pass+word',
      });
    });
  });

  describe('edge cases', () => {
    it('should handle invalid URL gracefully', () => {
      const result = parseNatsUrl('not-a-valid-url');
      expect(result).toEqual({
        server: 'not-a-valid-url',
      });
    });

    it('should handle empty string', () => {
      const result = parseNatsUrl('');
      expect(result).toEqual({
        server: '',
      });
    });

    it('should handle URL with empty password (no pass returned)', () => {
      // Empty password results in no pass property, which is correct
      // behavior - the user may want to use NATS_PASS env var
      const result = parseNatsUrl('nats://user:@localhost:4222');
      expect(result).toEqual({
        server: 'nats://localhost:4222',
        user: 'user',
      });
    });
  });
});
