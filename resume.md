# Session Resume: loom-warp Development

## Repository Location
`/var/home/mike/source/nats-mcp-requirements/warp`

## NATS Server
`nats://192.168.7.16:4222` (K8s deployment in `nats-mcp` namespace)

## Current State (as of 2025-12-10 00:45 PST)

### Infrastructure
- **Weft K8s**: Deployed to `loom` namespace at `weft.vilo.network`
- **K8s manifests**: https://gitea.vilo.network/ViLoHouse/loom-k8s-deploy.git
- **Docker test image**: `ghcr.io/mdlopresti/loom-warp:test` (REBUILT with additional bug fix)

### MCP Server Configuration
**~/.claude.json** mcpServers section:
```json
"loom-warp": {
  "type": "stdio",
  "command": "docker",
  "args": [
    "run", "-i", "--rm",
    "-e", "NATS_URL=nats://192.168.7.16:4222",
    "-e", "LOOM_PROJECT_ID=0000000000000001",
    "ghcr.io/mdlopresti/loom-warp:test"
  ]
}
```

## Bug Fixes Applied (in Docker image as of ~00:42 PST)

### Bug 1: Agent Registry Discovery - ProjectId (from previous session)
**Problem:** Agents couldn't discover each other - `projectId` was derived from container's working directory (always `/app`), so all agents had the same hash but visibility filtering still failed.

**Fix:** Added `LOOM_PROJECT_ID` env var support:
- `src/types.ts` - Added `projectId` to `ResolvedConfig`
- `src/config.ts` - Parse `LOOM_PROJECT_ID` env var (line 274)
- `src/registry.ts` - Accept explicit `projectId` in `createRegistryEntry()`
- `src/tools/registry.ts` - Use `config.projectId` (line 427)

### Bug 2: DM Redelivery (from previous session)
**Problem:** Direct messages kept redelivering - no durable consumer for inbox streams.

**Fix:** Create durable consumer per inbox:
- `src/inbox.ts` - Added `getInboxConsumerName()`, create durable consumer in `createInboxStream()`
- `src/tools/registry.ts` - Use durable consumer in `handleReadDirectMessages()`

### Bug 3: KV Bucket Keys Iterator (NEW - this session)
**Problem:** `discover_agents` returned empty even though agents were registered. Root cause: cached `bucketInstance` in `kv.ts` returned stale/incomplete results from `bucket.keys()` - only 1 key instead of all 13.

**Evidence:**
- Fresh KV view (via `js.views.kv()`) returns all keys correctly
- Cached bucket instance returns only 1 key
- This appears to be a NATS.js library issue where KV view instances become stale for key iteration

**Fix:** Modified `listRegistryEntries()` in `src/kv.ts` (lines 164-167) to get a fresh bucket view on each call:
```typescript
// Get a FRESH bucket view each time to avoid stale keys iteration
const js = getConnection().jetstream();
const bucket = await js.views.kv(currentBucketName || DEFAULT_BUCKET_NAME);
```

## Uncommitted Changes in warp/
```
src/types.ts
src/config.ts
src/registry.ts
src/inbox.ts
src/kv.ts           <- NEW: fresh bucket fix
src/tools/registry.ts
src/tools/registry.test.ts
README.md
resume.md
```

## What To Do After Restart

### 1. Re-register as Coordinator
```
set_handle with handle="coordinator"
register_agent with agentType="coordinator", capabilities=["testing", "coordination"]
```

### 2. Test Agent Discovery (should now work!)
```
discover_agents
```
Should now see Jarvis (if running) because:
1. Both agents share `LOOM_PROJECT_ID=0000000000000001`
2. Fresh bucket view returns all keys properly

### 3. Test DM Without Redelivery
```
send_direct_message to Jarvis's GUID
read_direct_messages  # Should show each message only once
```

### 4. If Tests Pass
- Commit changes: `git add -A && git commit -m "Fix agent discovery: fresh KV bucket view for keys iteration"`
- Push to GitHub
- Rebuild `:latest` image: `docker build -t ghcr.io/mdlopresti/loom-warp:latest . && docker push ghcr.io/mdlopresti/loom-warp:latest`
- Update `~/.claude.json` back to `:latest`

## Jarvis Test Agent
Location: `/var/home/mike/source/jarvis`
- Has CLAUDE.md with test instructions
- Logs to `jarvis.log`
- Uses same MCP config (shares `LOOM_PROJECT_ID=0000000000000001`)
- Current GUID: `2e46e8e5-c376-42e3-a334-6a6c4b5bcd18` (may change after restart)

## Test Results Summary
| Feature | Previous Status | Current Status |
|---------|-----------------|----------------|
| Direct Messaging | PASS | PASS (needs retest) |
| Channel Messaging | PASS | PASS |
| Work Queue Broadcast | PASS | PASS |
| Work Claim | PASS | PASS |
| Agent Discovery | FAIL | FIXED (needs retest) |
| Message ACK | FAIL | FIXED (needs retest) |

## Debug Images (can be cleaned up)
- `ghcr.io/mdlopresti/loom-warp:debug`
- `ghcr.io/mdlopresti/loom-warp:debug2`
- `ghcr.io/mdlopresti/loom-warp:debug3`
