# Router gRPC Migration - README

## Project Overview

This directory contains the implementation of the gRPC migration for OSMO's router service. The migration replaces WebSocket-based communication with gRPC for three core operations:
- **Exec**: Interactive and batch command execution
- **Port-Forward**: TCP and UDP port forwarding
- **Rsync**: File synchronization

## Quick Start

### Build Everything

```bash
# Run the build script
./external/scripts/build-grpc-router.sh
```

This will:
1. Generate proto stubs from `.proto` files
2. Lint proto files
3. Build the router Go server
4. Build the CLI helper binary
5. Run unit tests
6. Build multi-platform binaries

### Deploy to Kubernetes

```bash
# Create TLS certificate (if not using cert-manager)
kubectl create secret tls router-grpc-tls \
  --cert=path/to/tls.crt \
  --key=path/to/tls.key \
  -n osmo

# Install router-grpc
helm install router-grpc charts/router-grpc \
  --namespace osmo \
  --create-namespace

# Verify deployment
kubectl get pods -n osmo -l app=router-grpc
kubectl logs -n osmo -l app=router-grpc
```

### Test Manually

```bash
# Set environment variables
export OSMO_TRANSPORT=grpc
export OSMO_ROUTER_ADDRESS=router-grpc.osmo.svc.cluster.local:50051
export OSMO_WORKFLOW_ID=test-workflow
export OSMO_SESSION_KEY=test-session
export OSMO_COOKIE=test-cookie

# Test exec operation
echo "hello world" | bazel-bin/external/src/cli/net_client/osmo-net-client \
  --operation=exec \
  --router-address=$OSMO_ROUTER_ADDRESS \
  --session-key=$OSMO_SESSION_KEY \
  --workflow-id=$OSMO_WORKFLOW_ID

# Test port-forward
bazel-bin/external/src/cli/net_client/osmo-net-client \
  --operation=portforward \
  --protocol=tcp \
  --remote-port=8080
```

## Directory Structure

```
external/
├── proto/
│   └── router/
│       └── v1/
│           ├── messages.proto      # Message definitions
│           └── service.proto       # Service definitions
├── src/
│   ├── service/
│   │   └── router_go/             # Go router server
│   │       ├── main.go            # Entry point
│   │       └── server/
│   │           ├── server.go      # gRPC handlers
│   │           ├── session_store.go # Session management
│   │           └── metrics.go     # Prometheus metrics
│   ├── runtime/
│   │   └── cmd/
│   │       └── ctrl/
│   │           └── transport/     # Transport abstraction
│   │               ├── interface.go
│   │               └── grpc.go    # gRPC implementation
│   └── cli/
│       └── net_client/            # CLI helper binary
│           └── main.go
├── docs/
│   └── router-grpc-implementation.md  # Implementation guide
└── scripts/
    └── build-grpc-router.sh       # Build script

charts/
└── router-grpc/                   # Helm chart
    ├── Chart.yaml
    ├── values.yaml
    └── templates/
        ├── deployment.yaml
        ├── service.yaml
        └── _helpers.tpl

buf.yaml                           # Proto linting config
buf.gen.yaml                       # Code generation config
```

## Architecture

### Components

1. **Proto Definitions** (`external/proto/router/v1/`)
   - Defines message types and service interfaces
   - Language-agnostic API contract
   - Generated to Go and Python

2. **Router Go Server** (`external/src/service/router_go/`)
   - gRPC server implementing three services
   - Session management with rendezvous pattern
   - Flow control and backpressure handling
   - Prometheus metrics and health endpoints

3. **Transport Layer** (`external/src/runtime/cmd/ctrl/transport/`)
   - Abstraction for WebSocket/gRPC switching
   - Used by osmo-ctrl to communicate with router
   - Retry logic and keepalive handling

4. **CLI Helper** (`external/src/cli/net_client/`)
   - Bridges gRPC streams to stdin/stdout
   - JSON framing for structured output
   - Used by Python CLI when `OSMO_TRANSPORT=grpc`

### Data Flow

```
┌─────────────┐     gRPC      ┌──────────────┐     gRPC      ┌──────────────┐
│             │◄──────────────►│              │◄──────────────►│              │
│  CLI Client │                │  Router Go   │                │  osmo-ctrl   │
│             │   (client)     │   (bridge)   │   (agent)      │   Agent      │
└─────────────┘                └──────────────┘                └──────────────┘
      │                               │                               │
      │                               │                               │
   stdio                         sync.Map                        Unix socket
  (JSON)                       (sessions)                        (to osmo-user)
```

### Session Lifecycle

1. **Init**: Client sends init message with session key, cookie, workflow ID
2. **Rendezvous**: Router waits for both client and agent to connect (60s timeout)
3. **Stream**: Bidirectional data transfer with flow control
4. **Close**: Either party closes, session cleaned up

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OSMO_TRANSPORT` | Transport mode: `ws` or `grpc` | `ws` |
| `OSMO_ROUTER_ADDRESS` | Router gRPC address | - |
| `OSMO_TOKEN` | JWT authentication token | - |
| `OSMO_WORKFLOW_ID` | Workflow identifier | - |
| `OSMO_SESSION_KEY` | Session key | - |
| `OSMO_COOKIE` | Sticky session cookie | - |

### Router Server Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | 50051 | gRPC port |
| `--tls-enabled` | true | Enable TLS |
| `--tls-cert` | /etc/router/tls/tls.crt | TLS certificate |
| `--tls-key` | /etc/router/tls/tls.key | TLS key |
| `--session-ttl` | 30m | Session idle timeout |
| `--rendezvous-timeout` | 60s | Rendezvous wait |
| `--flow-control-buffer` | 16 | Channel buffer size |
| `--flow-control-timeout` | 30s | Write timeout |

### Helm Values

See `charts/router-grpc/values.yaml` for full configuration options.

Key settings:
- `replicaCount`: Number of router pods (default: 2)
- `grpc.tls.enabled`: Enable TLS (default: true)
- `grpc.timeouts.*`: Timeout configuration
- `resources.*`: CPU/memory limits

## Metrics

The router exposes Prometheus metrics on port 8080:

```bash
# View all metrics
curl http://router-grpc:8080/metrics

# Key metrics
router_grpc_sessions_active{operation="exec"}
router_grpc_rendezvous_duration_seconds_bucket{operation="exec"}
router_grpc_bytes_total{operation="exec",direction="client_to_agent"}
router_grpc_errors_total{operation="exec",code="DEADLINE_EXCEEDED"}
router_grpc_flow_control_timeouts_total
router_grpc_sessions_expired_total
```

## Testing

### Unit Tests

```bash
# Run all unit tests
bazel test //external/src/service/router_go/server:server_test

# Run specific test
bazel test //external/src/service/router_go/server:server_test --test_filter=TestSessionStore_CreateSession
```

### Integration Tests

```bash
# Deploy to test cluster
helm install router-grpc charts/router-grpc --namespace osmo-test

# Run integration tests
bazel test //external/src/service/router_go/server:integration_test
```

### Manual Testing

```bash
# Terminal 1: Start router locally
bazel run //external/src/service/router_go:router_go -- --tls-enabled=false

# Terminal 2: Test with net_client
export OSMO_ROUTER_ADDRESS=localhost:50051
export OSMO_SESSION_KEY=test-$(date +%s)
export OSMO_WORKFLOW_ID=test-workflow

echo "test data" | bazel-bin/external/src/cli/net_client/osmo-net-client \
  --operation=exec \
  --tls=false
```

## Troubleshooting

### Common Issues

**Proto generation fails**
```bash
# Check buf installation
buf --version

# Regenerate
buf generate
```

**Build fails**
```bash
# Clean and rebuild
bazel clean
./external/scripts/build-grpc-router.sh
```

**Router fails to start**
```bash
# Check logs
kubectl logs -n osmo -l app=router-grpc

# Common issues:
# - TLS certificate missing
# - Port already in use
# - Insufficient permissions
```

**Connection refused**
```bash
# Verify router is running
kubectl get pods -n osmo -l app=router-grpc

# Check service
kubectl get svc -n osmo router-grpc

# Test connectivity
kubectl run -it --rm debug --image=nicolaka/netshoot --restart=Never -- \
  grpcurl -plaintext router-grpc.osmo.svc.cluster.local:50051 list
```

### Debug Commands

```bash
# View router logs
kubectl logs -n osmo -l app=router-grpc --tail=100 -f

# Check metrics
kubectl port-forward -n osmo svc/router-grpc 8080:8080
curl localhost:8080/metrics | grep router_grpc

# Describe pod
kubectl describe pod -n osmo -l app=router-grpc

# Exec into pod
kubectl exec -it -n osmo $(kubectl get pod -n osmo -l app=router-grpc -o jsonpath='{.items[0].metadata.name}') -- sh
```

## Development

### Adding a New Operation

1. Update `proto/router/v1/messages.proto`:
   ```protobuf
   message NewOpRequest { ... }
   message NewOpResponse { ... }
   ```

2. Update `proto/router/v1/service.proto`:
   ```protobuf
   service RouterClientService {
     rpc NewOp(stream NewOpRequest) returns (stream NewOpResponse);
   }
   ```

3. Regenerate proto:
   ```bash
   buf generate
   ```

4. Implement handler in `server/server.go`:
   ```go
   func (rs *RouterServer) NewOp(stream pb.RouterClientService_NewOpServer) error {
     // Implementation
   }
   ```

5. Update CLI helper in `cli/net_client/main.go`

6. Add unit tests

### Running Proto Linter

```bash
# Lint all proto files
buf lint external/proto

# Check breaking changes
buf breaking external/proto --against '.git#branch=main'
```

### Code Style

```bash
# Format Go code
bazel run @rules_go//go -- fmt ./external/src/service/router_go/...

# Run linters
bazel run //:golangci-lint
```

## Migration Path

### Phase 1: Parallel Deployment
- Deploy router-grpc alongside existing router (WebSocket)
- No traffic routing yet
- Internal testing only

### Phase 2: Canary Rollout
- Route 5% of traffic to gRPC via feature flag
- Monitor metrics (error rate, latency)
- Rollback if issues detected

### Phase 3: Gradual Increase
- Increase to 25%, 50%, 75%, 100% over 2 weeks
- Compare WebSocket vs gRPC metrics
- Gather user feedback

### Phase 4: Deprecation
- Keep WebSocket for webserver proxying (out of scope)
- Remove WebSocket for exec/port-forward/rsync
- Simplify deployment

## References

- **Migration Plan**: `project-hyperloop-grpc-migration.plan.md`
- **Implementation Guide**: `external/docs/router-grpc-implementation.md`
- **gRPC Go Docs**: https://grpc.io/docs/languages/go/
- **Buf Documentation**: https://buf.build/docs/
- **Prometheus Metrics**: https://prometheus.io/docs/

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review logs and metrics
3. Consult the implementation guide
4. Contact @fernandol

---

**Status**: Implementation Complete - Ready for Testing  
**Version**: 1.0.0  
**Last Updated**: 2025-11-23
