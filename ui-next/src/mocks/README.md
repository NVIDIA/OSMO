# Mock System

Development mocking system for the OSMO UI. Includes API mocking (MSW) and auth injection utilities.

**⚠️ Production Safety:** All mock code is automatically removed from production builds via Turbopack aliasing (see `next.config.ts`). Zero production impact.

## Components

### 1. API Mocking (MSW)
Mock API responses for local development and testing.

### 2. Auth Injection
Utilities for injecting auth tokens when testing against real or mock backends.

**Usage in browser console:**
```javascript
devAuth.testUsers.admin()  // Inject admin user
devAuth.testUsers.user()   // Inject regular user
devAuth.skip()             // Skip auth entirely
devAuth.status()           // Check current auth
devAuth.clear()            // Clear auth cookies
```

## Design Principle

**Mocks should be high-fidelity representations of the backend API.** The UI layer should not be able to distinguish between mock and real responses. This ensures:

1. UI code doesn't accidentally depend on mock-only features
2. Testing accurately reflects production behavior
3. Backend changes are immediately visible as mock/UI mismatches

## Verified Endpoints (Match Backend)

These endpoints have been verified against `generated.ts` and match the backend API:

| Endpoint | Response Type | Notes |
|----------|---------------|-------|
| `GET /api/workflow` | `SrcServiceCoreWorkflowObjectsListResponse` | Paginated workflow list |
| `GET /api/workflow/:name` | `WorkflowQueryResponse` | Single workflow with groups/tasks |
| `GET /api/workflow/:name/logs` | `text/plain` | Supports streaming via Transfer-Encoding |
| `GET /api/workflow/:name/events` | `{ events: [...] }` | Workflow events |
| `GET /api/workflow/:name/spec` | `text/plain` | YAML workflow spec |
| `GET /api/pool_quota` | `PoolResponse` | Pool quotas with node_sets structure |
| `GET /api/pool` | `text/plain` | Pool names (not detailed info) |
| `GET /api/resources` | `ResourcesResponse` | Resource entries |
| `GET /api/bucket` | `BucketInfoResponse` | Bucket list |
| `GET /api/bucket/:bucket/query` | artifacts | Query bucket contents |
| `GET /api/bucket/list_dataset` | datasets | Dataset list |
| `GET /api/bucket/:bucket/dataset/:name/info` | `DataInfoResponse` | Dataset details |
| `POST /api/workflow/:name/exec/task/:taskName` | `RouterResponse` | Create exec session |
| `POST /api/workflow/:name/webserver/:taskName` | port forward info | Create port forward |
| `GET /api/profile/settings` | settings object | User settings |
| `POST /api/profile/settings` | settings object | Update settings |
| `GET /api/version` | version info | API version |

## Intentional Shims (Development Only)

These are mock-only features that help with development but don't exist in the backend:

### Log Scenarios

The mock log endpoint supports a `log_scenario` query parameter for testing different log patterns:
- `normal` - Standard mixed logs
- `error-heavy` - Many error messages
- `high-volume` - Large volume of logs
- `streaming` - Simulated real-time streaming

**Usage:** `GET /api/workflow/:name/logs?log_scenario=error-heavy`

This is transparent to the UI - it uses the standard endpoint path.

### PTY Simulator

The `POST /api/workflow/:name/exec/task/:taskName` mock returns a session ID and simulates PTY behavior for development. The mock WebSocket server (`pnpm dev:mock-ws`) provides interactive shell simulation.

## Adding New Mock Handlers

When adding new mock handlers:

1. ✅ Verify the endpoint exists in `generated.ts`
2. ✅ Match the exact response type from generated types
3. ✅ Use enums from `generated.ts` (never string literals)
4. ✅ Add the endpoint to "Verified Endpoints" table above
5. ✅ Document any intentional deviations in "Intentional Shims"
6. ✅ If endpoint doesn't exist in backend, create a backend issue first

## Troubleshooting

### Hot Reload Not Working in Mock Mode

**Symptom:** UI code changes don't appear after saving, even with hard refresh (Cmd+Shift+R). Changes only appear in incognito mode.

**Root Cause:** The MSW service worker is registered with a **limited scope** to only intercept API requests (`/api/*` or `/v2/api/*` with basePath). This prevents it from caching static assets. However, if you had an older version of the service worker registered with root scope `/`, it may still be active and interfering with hot reload.

**Quick Fix:**
```javascript
// In browser console
__dev.clearServiceWorker()
```

This will:
1. Unregister all service workers
2. Clear all caches
3. Reload the page

The new service worker will register with the correct scope automatically.

**Check Service Worker Status:**
```javascript
__dev.serviceWorkerStatus()
```

**Expected scope:**
- Without basePath: `/api/` (only intercepts `/api/*`)
- With basePath `/v2`: `/v2/api/` (only intercepts `/v2/api/*`)

**What the scoped service worker does:**
- ✅ Intercepts API requests for mocking
- ❌ Does NOT intercept static assets (`/_next/static/*`)
- ❌ Does NOT interfere with hot reload

**Manual cleanup (if __dev is not available):**
1. Open DevTools → Application → Service Workers
2. Click "Unregister" for all service workers
3. Clear site data (Application → Storage → Clear site data)
4. Hard refresh (Cmd+Shift+R)

**Why incognito mode works:**
Incognito mode starts with a fresh browser profile, so no service worker is registered.

### Service Worker Scope

The MSW service worker is configured with a **basePath-aware scope** to only intercept API requests:

```typescript
// From src/mocks/MockProvider.tsx
const basePath = getBasePath();
const scope = basePath ? `${basePath}/api/` : "/api/";

worker.start({
  serviceWorker: {
    url: getServiceWorkerUrl(),
    options: { scope }, // Limits interception to API routes only
  },
});
```

This ensures:
- MSW only sees API requests (`/api/*` or `/v2/api/*`)
- Static assets are handled by browser's normal caching (respects Next.js cache headers)
- Hot reload works correctly with Turbopack

## Updating This Document

After running `pnpm generate-api` to update `generated.ts`, review this document to ensure:
- New endpoints are added to "Verified Endpoints"
- Response types still match
- Any deprecated endpoints are removed from mocks
