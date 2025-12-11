# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-12-11

### Status: Beta Release

This release marks the transition from Alpha to Beta. Core functionality has been thoroughly tested with 492 unit tests passing and 8 integration scenarios validated.

### Added
- `claim_work` tool documentation with examples in README
- Known Limitations section in README documenting current constraints
- Beta status badge in README

### Changed
- Status upgraded from Alpha to Beta
- README messaging updated to reflect Beta stability level
- Tool count updated to 17 (added claim_work documentation)

### Tested
- **Direct Messaging (REQ-DM)**: 5/5 test cases passed
  - Online message delivery
  - Offline message queuing
  - Message filtering by type
  - Message filtering by sender
  - Message ordering verification
- **Dead Letter Queue (REQ-DLQ)**: 5/5 test cases passed
  - Work moves to DLQ after max attempts
  - DLQ listing with correct metadata
  - Retry functionality
  - Attempt counter reset
  - Permanent discard
- **Registry Advanced (REQ-REG)**: 5/6 test cases passed
  - Presence status updates
  - Task count updates
  - Private agent visibility
  - User-only visibility
  - Public cross-project visibility
  - (Heartbeat timeout deferred to Weft coordinator)
- **Configuration (REQ-CFG)**: 3/3 test cases passed
  - Custom channels via config file
  - Custom retention policies
  - Environment variable overrides

### Security
- npm audit: 0 high/critical vulnerabilities
- 6 moderate vulnerabilities in dev dependencies only (vitest/vite/esbuild)
- No production runtime security issues

### Known Limitations
- Stale agent detection requires Weft coordinator
- Work queue may return 503 under extreme load
- NATS clustering not yet tested
- Rapid concurrent publishes may have slight ordering variations

## [0.0.1] - 2025-12-08

### Added
- NATS MCP Server core implementation
  - MCP (Model Context Protocol) server with NATS transport
  - Full MCP resource, tool, and prompt support
- JetStream Integration
  - Persistent message streams for reliable delivery
  - Subject-based message routing
  - Stream consumer management
- Agent Registry
  - Agent discovery and registration system
  - Agent presence tracking and heartbeat mechanism
  - Capability-based agent filtering
  - Agent visibility controls (private, project-only, user-only, public)
  - GUID-based agent identification
  - Agent status tracking (online, busy, offline)
- Work Queue System
  - Work distribution to capable agents
  - Competing consumer pattern for load balancing
  - Priority-based task scheduling (1-10 scale)
  - Deadline support for time-sensitive work
  - Context data passing for work items
  - Dead Letter Queue (DLQ) for failed work items
  - DLQ item retry with attempt counter reset
  - DLQ item permanent discard
- Direct Messaging
  - Agent-to-agent direct messaging via personal inboxes
  - Message type specification (text, work-offer, work-claim)
  - Message metadata support
  - Reliable delivery with offline queuing
  - Inbox stream persistence
- Channel Communication
  - Multi-agent channel subscriptions
  - Broadcast messaging to channels
  - Channel listing and discovery
  - Message history via stream consumers
- Infrastructure
  - Kubernetes deployment configuration
    - StatefulSet for NATS server
    - ConfigMap for server configuration
    - Service definitions (ClusterIP and external access)
  - Docker support
    - Dockerfile for containerized deployment
    - Docker Compose for local development
  - TLS/SSL support for secure communication
  - Authentication support (username/password, token-based)
  - Non-root container execution for security
  - Health check endpoints
  - Readiness probes for orchestration

### Security
- TLS/SSL encryption for data in transit
- Authentication mechanisms (credentials-based and token-based)
- Non-root container execution (UID/GID configuration)
- Role-based visibility controls for agent registry
- Input validation and sanitization
- Secure default configurations

### Documentation
- Comprehensive README with architecture overview
- Installation and setup instructions
- Configuration guide
- API documentation with examples
- Agent development guide
- Work queue usage examples
- Deployment guide for Kubernetes and Docker

[Unreleased]: https://github.com/mdlopresti/loom-warp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mdlopresti/loom-warp/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/mdlopresti/loom-warp/releases/tag/v0.0.1
