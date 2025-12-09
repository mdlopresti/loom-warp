# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Documentation improvements for production deployments
- Extended examples for agent discovery and work queue patterns
- Performance tuning guides for high-throughput scenarios
- Troubleshooting guide for common deployment issues
- Community contribution guidelines

### Changed
- Improved error messages for better debugging
- Enhanced logging output with structured logging support
- Optimized message serialization for better performance
- Updated dependencies to latest stable versions

### Fixed
- Connection stability improvements under high load
- Memory leak fixes in long-running agents
- DLQ processing improvements for failed work items

### Security
- Additional input validation for message handling
- Rate limiting for API endpoints
- Enhanced audit logging capabilities

## [1.0.0] - 2025-12-08

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

[Unreleased]: https://github.com/mlopresti/nats-mcp-server/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mlopresti/nats-mcp-server/releases/tag/v1.0.0
