# NATS Kubernetes Deployment

This directory contains Kubernetes manifests for deploying NATS with JetStream for Loom Warp.

## Prerequisites

- Kubernetes cluster (tested on k8s 1.28+)
- kubectl configured for your cluster
- Storage provisioner for PersistentVolumeClaims
- (Optional) ArgoCD for GitOps deployment
- (Optional) cert-manager and nginx-ingress for TLS

## Quick Start

### Manual Deployment

```bash
# Apply all manifests
kubectl apply -f config/

# Verify deployment
kubectl get pods -n loom
kubectl get svc -n loom
```

### ArgoCD Deployment

```bash
# Update the repoURL in nats.argocd.yaml to your repository
kubectl apply -f nats.argocd.yaml
```

## Configuration

### JetStream Settings

Edit `config/main.yml` ConfigMap to adjust JetStream settings:

```yaml
jetstream {
  store_dir: /data/jetstream
  max_memory_store: 1Gi    # In-memory storage limit
  max_file_store: 10Gi     # Disk storage limit
}
```

### Storage

By default, uses a 10Gi PVC. Adjust in `config/main.yml`:

```yaml
spec:
  resources:
    requests:
      storage: 10Gi
  # storageClassName: your-storage-class
```

### External Access

The `nats-external` service is configured as LoadBalancer. Options:

1. **LoadBalancer** (default): Gets external IP from cloud provider
2. **NodePort**: Uncomment `nodePort: 30422` for fixed port access
3. **ClusterIP**: Remove `nats-external` service for internal-only access

## Connecting MCP Servers

Once deployed, configure your MCP servers to connect:

```bash
# Get external IP (LoadBalancer)
kubectl get svc nats-external -n loom

# Example: nats://10.0.0.100:4222
```

Update Claude Code configuration:

```json
{
  "mcpServers": {
    "loom-warp": {
      "command": "warp",
      "env": {
        "NATS_URL": "nats://<EXTERNAL-IP>:4222"
      }
    }
  }
}
```

## Monitoring

Access the NATS monitoring endpoint:

```bash
# Port forward for local access
kubectl port-forward svc/nats 8222:8222 -n loom

# Then open http://localhost:8222
```

Endpoints:
- `/healthz` - Health check
- `/varz` - Server variables
- `/jsz` - JetStream statistics
- `/connz` - Connection info

## Troubleshooting

### Check NATS logs

```bash
kubectl logs -f deployment/nats -n loom
```

### Verify JetStream is enabled

```bash
kubectl exec -it statefulset/nats -n loom -- nats-server --help | grep jetstream
```

### Test connection from inside cluster

```bash
kubectl run nats-test --rm -it --image=natsio/nats-box -- sh
# Inside container:
nats pub test "hello" -s nats://nats.loom:4222
```

## File Structure

```
config/
├── main.yml        # Namespace, ConfigMap, PVC, StatefulSet
├── service.yaml    # Services (internal + external)
└── README.md       # This file

nats.argocd.yaml    # ArgoCD Application manifest
```
