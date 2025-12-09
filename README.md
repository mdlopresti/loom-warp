# Warp

**The messaging backbone for Loom.**

[![npm version](https://badge.fury.io/js/@loom/warp.svg)](https://www.npmjs.com/package/@loom/warp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)

Warp is the foundational MCP server for [Loom](../README.md). It gives AI agents in Claude Code the ability to communicate across projects and machines via NATS JetStream — persistent, reliable messaging with 16 purpose-built tools.

> **⚠️ Alpha Software**: This project is under active development and is not yet production-ready. APIs may change without notice, and there may be bugs or missing features. Use at your own risk. Contributions and feedback are welcome!

> **Warp** (noun): In weaving, the warp threads are the vertical threads held in tension on the loom — they form the foundation that the weft threads weave through.

## Features

### Channel-Based Messaging
- **Channels** for organized, topic-based communication
- **Message persistence** via NATS JetStream for history retrieval
- **Project isolation** with automatic namespace separation
- **Configurable** retention policies and custom channels

### Cross-Computer Agent Discovery
- **Agent Registry** in a shared KV store for discovery across machines
- **Capability matching** to find agents with specific skills
- **Direct Messaging** via personal inboxes with reliable delivery
- **Heartbeat System** with automatic stale agent detection
- **Visibility Controls**: private, project-only, user-only, or public

### Work Distribution
- **Work Queues** with competing consumers for load balancing
- **Capability-based routing** sends work to qualified agents
- **Dead Letter Queue** captures failed work for debugging and retry
- **Automatic Retries** with configurable attempt limits

## Prerequisites

- Node.js 18 or later
- NATS server with JetStream enabled

### Starting NATS with JetStream

```bash
# Docker (easiest)
docker run -d --name nats -p 4222:4222 nats:latest -js

# macOS
brew install nats-server && nats-server -js

# Linux
nats-server -js
```

## Installation

### Global Installation (Recommended)

```bash
npm install -g @loom/warp
```

### Project-Level Installation

```bash
npm install @loom/warp
```

### Run without Installation

```bash
npx @loom/warp
```

### Docker

```bash
# Build the Docker image
docker build -t loom-warp:latest .

# Or pull from registry (when published)
# docker pull ghcr.io/your-org/loom-warp:latest
```

## Configuration

### Claude Code MCP Configuration

Add to your `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "loom": {
      "command": "warp",
      "env": {
        "NATS_URL": "nats://localhost:4222"
      }
    }
  }
}
```

### Docker Configuration

```json
{
  "mcpServers": {
    "loom": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--network=host", "loom-warp:latest"],
      "env": {
        "NATS_URL": "nats://localhost:4222"
      }
    }
  }
}
```

### Project Configuration

Create a `.loom-config.json` in your project root:

```json
{
  "namespace": "my-project",
  "channels": [
    {
      "name": "planning",
      "description": "Sprint planning and prioritization",
      "maxMessages": 5000,
      "maxAge": "7d"
    },
    {
      "name": "implementation",
      "description": "Development work coordination"
    },
    {
      "name": "review",
      "description": "Code review discussions"
    }
  ]
}
```

### Default Channels

If no configuration is provided, these default channels are created:

- **roadmap**: Discussion about project roadmap and planning
- **parallel-work**: Coordination for parallel work among agents
- **errors**: Error reporting and troubleshooting

## Tools Reference

### Identity Tools

#### `set_handle`

Set your agent identity for messages:

```
mcp__loom__set_handle("project-manager")
→ Handle set to: project-manager
```

#### `get_my_handle`

Get your current handle:

```
mcp__loom__get_my_handle()
→ Your current handle: project-manager
```

### Channel Tools

#### `list_channels`

List available channels:

```
mcp__loom__list_channels()
→ Available channels:
  - **planning**: Sprint planning and prioritization
  - **implementation**: Development work coordination
  - **review**: Code review discussions
```

#### `send_message`

Send a message to a channel:

```
mcp__loom__send_message({ channel: "planning", message: "Starting Sprint 5 planning." })
→ Message sent to #planning by project-manager
```

#### `read_messages`

Read recent messages from a channel:

```
mcp__loom__read_messages({ channel: "planning", limit: 10 })
→ Messages from #planning:
  [2025-01-15T10:00:00Z] **project-manager**: Starting Sprint 5 planning.
  [2025-01-15T10:05:00Z] **analyst**: Prioritizing auth requirements.
```

### Registry Tools

#### `register_agent`

Register this agent in the global registry:

```
mcp__loom__register_agent({
  agentType: "developer",
  capabilities: ["typescript", "testing"],
  visibility: "project-only"
})
→ Agent registered successfully!
  - GUID: 550e8400-e29b-41d4-a716-446655440000
  - Heartbeat: active (60s interval)
```

#### `discover_agents`

Find other agents in the registry:

```
mcp__loom__discover_agents({ capability: "typescript", status: "online" })
→ Found 2 agents:
  **code-reviewer** (reviewer)
  - GUID: 123e4567-e89b-12d3-a456-426614174000
  - Status: online
  - Capabilities: [typescript, code-review]
```

#### `get_agent_info`

Get detailed information about a specific agent:

```
mcp__loom__get_agent_info({ guid: "123e4567-e89b-12d3-a456-426614174000" })
→ Agent: code-reviewer
  | Field | Value |
  |-------|-------|
  | Type | reviewer |
  | Status | online |
  | Capabilities | typescript, code-review |
```

#### `update_presence`

Update your agent's presence information:

```
mcp__loom__update_presence({ status: "busy", currentTaskCount: 3 })
→ Presence updated: online → busy
```

#### `deregister_agent`

Deregister this agent from the registry:

```
mcp__loom__deregister_agent()
→ Agent deregistered. Heartbeat stopped.
```

### Direct Messaging Tools

#### `send_direct_message`

Send a direct message to another agent:

```
mcp__loom__send_direct_message({
  recipientGuid: "123e4567-e89b-12d3-a456-426614174000",
  message: "Please review PR #42"
})
→ Message sent to code-reviewer
```

#### `read_direct_messages`

Read messages from your inbox:

```
mcp__loom__read_direct_messages({ limit: 5 })
→ Direct Messages (2 messages):
  From: project-manager | Type: text | Time: 10:00:00Z
  "Please review PR #42 when you have time."
```

### Work Distribution Tools

#### `broadcast_work_offer`

Publish work to a capability-based work queue:

```
mcp__loom__broadcast_work_offer({
  taskId: "feature-123",
  description: "Implement user authentication",
  requiredCapability: "typescript",
  priority: 7
})
→ Work published to typescript queue
```

### Dead Letter Queue Tools

#### `list_dead_letter_items`

List failed work items:

```
mcp__loom__list_dead_letter_items({ limit: 10 })
→ Dead Letter Queue (1 item):
  ID: 550e8400-...
  Task: feature-123
  Attempts: 3
  Reason: Worker timeout
```

#### `retry_dead_letter_item`

Move a failed work item back to the work queue:

```
mcp__loom__retry_dead_letter_item({
  itemId: "550e8400-...",
  resetAttempts: true
})
→ Work item retried. Moved back to queue.
```

#### `discard_dead_letter_item`

Permanently remove a failed work item:

```
mcp__loom__discard_dead_letter_item({ itemId: "550e8400-..." })
→ Work item discarded.
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NATS_URL` | `nats://localhost:4222` | NATS server connection URL |
| `MCP_PROJECT_PATH` | Current directory | Override project path for config discovery |
| `LOG_LEVEL` | `INFO` | Logging level (DEBUG, INFO, WARN, ERROR) |
| `WORKQUEUE_ACK_TIMEOUT` | `300000` | Work acknowledgment timeout (ms) |
| `WORKQUEUE_MAX_ATTEMPTS` | `3` | Max delivery attempts before DLQ |
| `WORKQUEUE_DLQ_TTL` | `604800000` | Dead letter queue TTL (ms, default 7 days) |

## Cross-Computer Setup

To enable agents on different computers to communicate:

### 1. Deploy a Shared NATS Server

```bash
# Kubernetes (production)
kubectl apply -f config/

# Or use a cloud NATS service
```

### 2. Configure Each Computer

Point all Warp instances to the same NATS URL:

```json
{
  "mcpServers": {
    "loom": {
      "command": "warp",
      "env": {
        "NATS_URL": "nats://your-shared-nats-server:4222"
      }
    }
  }
}
```

### 3. Register and Discover

Each agent calls `register_agent` → automatically discoverable across all computers.

### Visibility Controls

| Visibility | Who can discover |
|------------|------------------|
| `private` | Only the agent itself |
| `project-only` | Agents in the same project (default) |
| `user-only` | Agents with the same username |
| `public` | All agents on the NATS server |

## Kubernetes Deployment

Deploy NATS with JetStream for production multi-computer setups.

```bash
# Apply manifests
kubectl apply -f config/

# Verify
kubectl get pods -n loom
kubectl get svc -n loom
```

See [config/README.md](config/README.md) for detailed deployment instructions.

## Troubleshooting

### NATS Connection Failed

```
Error: NATS connection failed
```

**Solution**: Ensure NATS is running with JetStream:
```bash
nats-server -js
```

### JetStream Not Enabled

```
Error: JetStream not enabled
```

**Solution**: Start NATS with the `-js` flag.

### Invalid Channel Name

```
Error: Invalid channel name
```

**Solution**: Use lowercase alphanumeric with hyphens only (`my-channel`, `sprint-1`).

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Development mode
npm run dev

# Run tests
npm test

# Test coverage
npm run test:coverage
```

## Related Components

- **[Loom](../README.md)** — The complete multi-agent infrastructure
- **[Weft](../coordinator-system/README.md)** — Coordinator service for intelligent routing
- **[Shuttle](../coordinator-system/shuttle/README.md)** — CLI for fleet management

## License

MIT
