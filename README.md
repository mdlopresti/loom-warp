# Warp

**The messaging backbone for Loom.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-blue.svg)](https://ghcr.io/mdlopresti/loom-warp) [![Beta](https://img.shields.io/badge/Status-Beta-blue.svg)](https://github.com/mdlopresti/loom-warp)

Warp is the foundational MCP server for [Loom](../README.md). It gives AI agents in Claude Code the ability to communicate across projects and machines via NATS JetStream — persistent, reliable messaging with 17 purpose-built tools.

> **Beta Software**: Core functionality is tested and stable. APIs may still change before v1.0. Suitable for early adopters and non-critical workloads. Feedback welcome!

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

### Docker (Recommended)

Docker is the preferred method for running Warp as an MCP server:

```bash
# Pull the latest image
docker pull ghcr.io/mdlopresti/loom-warp:latest

# Or build locally
docker build -t loom-warp:latest .
```

### NPM (Post-V1)

> **Note**: NPM publishing (`@loom/warp`) is planned for after the V1 release. For now, use Docker.

```bash
# Coming post-V1
npm install -g @loom/warp
```

## Configuration

### Claude Code MCP Configuration

Add to your `~/.claude.json` (or `~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "loom-warp": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "NATS_URL=nats://localhost:4222",
        "ghcr.io/mdlopresti/loom-warp:latest"
      ]
    }
  }
}
```

For remote NATS servers, update the `NATS_URL` value:

```json
{
  "mcpServers": {
    "loom-warp": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "NATS_URL=nats://your-nats-server:4222",
        "ghcr.io/mdlopresti/loom-warp:latest"
      ]
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

#### `claim_work`

Claim work from a capability-based work queue:

```
mcp__loom__claim_work({ capability: "typescript", timeout: 5000 })
→ Work claimed:
  Task ID: feature-123
  Description: Implement user authentication
  Priority: 7
  Offered by: project-manager
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
| `NATS_URL` | `nats://localhost:4222` | NATS server connection URL (supports credentials in URL) |
| `NATS_USER` | (none) | Username for NATS authentication (fallback if not in URL) |
| `NATS_PASS` | (none) | Password for NATS authentication (fallback if not in URL) |
| `MCP_PROJECT_PATH` | Current directory | Override project path for config discovery |
| `LOG_LEVEL` | `INFO` | Logging level (DEBUG, INFO, WARN, ERROR) |
| `WORKQUEUE_ACK_TIMEOUT` | `300000` | Work acknowledgment timeout (ms) |
| `WORKQUEUE_MAX_ATTEMPTS` | `3` | Max delivery attempts before DLQ |
| `WORKQUEUE_DLQ_TTL` | `604800000` | Dead letter queue TTL (ms, default 7 days) |

### NATS Authentication

Authentication is **optional**. For local development, just use `nats://localhost:4222`.

For production NATS servers with authentication enabled:

**Option 1: Credentials in URL (recommended)**
```bash
NATS_URL=nats://myuser:mypassword@nats.example.com:4222
```

**Option 2: Separate environment variables**
```bash
NATS_URL=nats://nats.example.com:4222
NATS_USER=myuser
NATS_PASS=mypassword
```

**Option 3: Mixed (user in URL, password in env)**
```bash
NATS_URL=nats://myuser@nats.example.com:4222
NATS_PASS=mypassword
```

URL credentials take precedence over environment variables. Special characters in passwords should be URL-encoded (e.g., `@` → `%40`, `/` → `%2F`).

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

## Known Limitations

The following limitations are known in the current Beta release:

- **Stale agent detection**: Heartbeat-based offline detection requires the Weft coordinator. Without Weft, agents may appear online indefinitely after disconnect.
- **Work queue backpressure**: Under high load, NATS JetStream may return 503 errors during rapid publish/consume cycles. Implement retry logic for production workloads.
- **Single NATS server**: Clustering and high-availability NATS configurations are not yet tested. Use a single NATS server for now.
- **Message ordering**: Channel messages are ordered by publish time, but rapid concurrent publishes may have slight ordering variations.

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

### NATS Authorization Failed

```
Error: AUTHORIZATION_VIOLATION
```

**Solution**: Check your NATS credentials:
- Verify `NATS_USER` and `NATS_PASS` are correct
- If using URL credentials, ensure special characters are URL-encoded
- Confirm the user exists on the NATS server

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
