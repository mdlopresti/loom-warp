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

### NPM

```bash
npm install -g @loom/warp
```

## Configuration

### Claude Code MCP Configuration

Add to your Claude Code settings (`~/.claude/settings.json`):

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

## MCP Tools

Warp provides 17 MCP tools organized into categories:

| Category | Tools | Purpose |
|----------|-------|---------|
| **Identity** | `set_handle`, `get_my_handle` | Set/get your agent name for messages |
| **Channels** | `list_channels`, `send_message`, `read_messages` | Topic-based pub/sub messaging |
| **Registry** | `register_agent`, `discover_agents`, `get_agent_info`, `update_presence`, `deregister_agent` | Agent discovery and presence |
| **Direct Messages** | `send_direct_message`, `read_direct_messages` | Agent-to-agent communication |
| **Work Queues** | `broadcast_work_offer`, `claim_work` | Capability-based work distribution |
| **Dead Letter** | `list_dead_letter_items`, `retry_dead_letter_item`, `discard_dead_letter_item` | Handle failed work items |

Each tool includes detailed descriptions visible in your MCP client. Common usage:

```
# Register and discover
register_agent({ agentType: "developer", capabilities: ["typescript"] })
discover_agents({ capability: "code-review" })

# Communicate
send_message({ channel: "planning", message: "Starting sprint 5" })
send_direct_message({ recipientGuid: "...", message: "Please review PR #42" })

# Work distribution
broadcast_work_offer({ taskId: "task-1", description: "Fix bug", requiredCapability: "typescript" })
claim_work({ capability: "typescript" })
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

### WebSocket Transport

Warp supports WebSocket connections for environments where raw TCP is not available (e.g., through CDN proxies like Cloudflare):

```bash
# WebSocket (for proxied connections)
NATS_URL=wss://myuser:mypassword@nats.example.com

# WebSocket without TLS (local testing only)
NATS_URL=ws://localhost:8080
```

The transport is auto-detected from the URL scheme:
- `nats://` or `tls://` → TCP connection
- `ws://` or `wss://` → WebSocket connection

## GitHub Actions

Warp can connect to NATS from GitHub Actions runners using WebSocket transport. This enables spinning up ephemeral agents that can claim work from the queue.

### Setup

1. **Add repository secret** `NATS_URL` with your WebSocket URL:
   ```
   wss://github-agent:password@nats.example.com
   ```

2. **Use the agent workflow** (`.github/workflows/agent.yml`):
   - Manually trigger via "Actions" → "Loom Agent" → "Run workflow"
   - The workflow validates NATS connectivity through Cloudflare/proxy

### Example: Full Agent Workflow

To run a complete Claude Code agent in GitHub Actions:

```yaml
- name: Install Claude Code
  run: npm install -g @anthropic-ai/claude-code

- name: Configure MCP
  run: |
    mkdir -p ~/.claude
    cat > ~/.claude/mcp.json << 'EOF'
    {
      "mcpServers": {
        "loom-warp": {
          "type": "stdio",
          "command": "docker",
          "args": ["run", "-i", "--rm", "-e", "NATS_URL", "ghcr.io/mdlopresti/loom-warp:latest"]
        }
      }
    }
    EOF

- name: Run Agent
  env:
    NATS_URL: ${{ secrets.NATS_URL }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    claude-code --print "Register as github-runner, claim typescript work, and execute it"
```

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

## Related

- [Loom](https://github.com/mdlopresti/loom) — Multi-agent infrastructure
- [Weft](https://github.com/mdlopresti/loom-weft) — Work coordinator
- [Pattern](https://github.com/mdlopresti/loom-pattern) — Agent memory
- [Shuttle](https://github.com/mdlopresti/loom-shuttle) — Fleet management CLI

## License

MIT
