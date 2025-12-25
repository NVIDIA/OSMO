# Backend API Issues and Workarounds

Issues identified during UI development that require backend fixes.
All workarounds are quarantined in this **Backend Adapter Layer** (`src/lib/api/adapter/`).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     HEADLESS HOOKS                              │
│  src/headless/use-resources.ts, use-pools.ts, etc.              │
│  Written for IDEAL backend. Shims clearly marked.               │
│  When backend is fixed, just remove shim code blocks.           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND ADAPTER LAYER                        │
│  src/lib/api/adapter/                                           │
│  ├── types.ts       - Ideal types the UI expects                │
│  ├── transforms.ts  - Data shape workarounds                    │
│  ├── pagination.ts  - Pagination shim (fetch all → paginate)    │
│  ├── hooks.ts       - API functions with transformation         │
│  └── index.ts       - Public exports                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      GENERATED TYPES                            │
│  src/lib/api/generated.ts (auto-generated from OpenAPI)         │
└─────────────────────────────────────────────────────────────────┘

MIGRATION PATH:
1. Backend adds pagination/filtering support
2. Update adapter to pass params directly (remove shims)
3. Regenerate types: pnpm generate-api
4. Remove shim blocks in hooks (marked with "SHIM:" comments)
5. UI components work unchanged
```

---

## Issues

### 1. Incorrect Response Types for Pool/Resource APIs

**Priority:** High  
**Status:** Active workaround in `transforms.ts`

Several API endpoints have incorrect response types in the OpenAPI schema. They're typed as returning `string` but actually return structured JSON objects.

**Affected endpoints:**
- `GET /api/pool_quota` - Returns `PoolResponse`, not `string`
- `GET /api/resources` - Returns `ResourcesResponse`, not `string`

**Workaround:**
```typescript
// transforms.ts
export function transformPoolsResponse(rawResponse: unknown): PoolsResponse {
  const response = rawResponse as PoolResponse | undefined;
  // ...
}
```

**Fix:** Update FastAPI endpoint return type annotations.

---

### 2. ResourceUsage Fields Are Strings Instead of Numbers

**Priority:** Medium  
**Status:** Active workaround in `transforms.ts`

The `ResourceUsage` interface has all numeric fields typed as `string`:
```typescript
export interface ResourceUsage {
  quota_used: string;   // Should be number
  quota_free: string;   // Should be number
  quota_limit: string;  // Should be number
  // ...
}
```

**Workaround:**
```typescript
function parseNumber(value: string | number | undefined | null): number {
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}
```

**Fix:** Update Pydantic model to use proper numeric types.

---

### 3. Auth Configuration Embedded in OpenAPI Schema

**Priority:** Low  
**Status:** No workaround needed (schema hygiene issue)

The `service_auth` field in `ServiceConfigs` has a default value that embeds RSA keys into the OpenAPI schema.

**Fix options:**
1. Use `Field(exclude=True)` to hide from schema
2. Don't set default at model level
3. Use `schema_extra` to exclude sensitive defaults

---

### 4. Version Endpoint Returns Unknown Type

**Priority:** Low  
**Status:** Active workaround in `transforms.ts`

The `GET /api/version` endpoint has no response type defined in the OpenAPI schema.

**Workaround:**
```typescript
// types.ts - manually defined
export interface Version {
  major: string;
  minor: string;
  revision: string;
  hash?: string;
}
```

**Fix:** Add proper Pydantic response model to version endpoint.

---

### 5. Resource Fields Use Untyped Dictionaries

**Priority:** Medium  
**Status:** Active workaround in `transforms.ts`

`allocatable_fields` and `usage_fields` are typed as `{ [key: string]: unknown }`.

**Workaround:**
```typescript
function getFieldValue(fields: Record<string, unknown> | undefined, key: string): number {
  // Must handle unknown types
}
```

**Fix options:**
1. Define typed schema for known fields (gpu, cpu, memory, storage)
2. Or use `Dict[str, Union[int, float]]` for numeric values

---

### 6. Memory and Storage Values Need Unit Conversion

**Priority:** Medium  
**Status:** Active workaround in `transforms.ts`

Values returned in different units:
- **Memory**: KiB (Kubernetes stores memory in Ki)
- **Storage**: Bytes (Kubernetes stores ephemeral-storage in B)

**Workaround:**
```typescript
const KIB_PER_GIB = 1024 * 1024;
const BYTES_PER_GIB = 1024 ** 3;

memory: extractCapacity(resource, "memory", "kibToGiB"),
storage: extractCapacity(resource, "storage", "bytesToGiB"),
```

**Fix options:**
1. Return values in GiB consistently
2. Or include unit metadata in response

---

### 7. pool_platform_labels Filtered by Query Parameters

**Priority:** Medium  
**Status:** Active workaround in `hooks.ts` (`useResourceInfo`)

When querying `/api/resources` with specific pools, `pool_platform_labels` only contains memberships for queried pools, not ALL pools the resource belongs to.

**Example:**
- Resource belongs to: `isaac-hil`, `isaac-nightly`
- Query with `pools=isaac-hil` returns: `{"isaac-hil": ["x86-l20"]}`
- Query with `all_pools=true` returns: `{"isaac-hil": ["x86-l20"], "isaac-nightly": ["x86-l20"]}`

**Workaround:** `useResourceInfo()` queries with `all_pools=true` and caches for 5 minutes.

**Fix:** Always include all pool memberships in `pool_platform_labels`.

---

### 8. Resources API `concise` Parameter Changes Response Structure

**Priority:** Low  
**Status:** Documented (avoid usage)

When `concise=true` is passed to `/api/resources`, response structure changes:
```json
// Normal: { "resources": [...] }
// Concise: { "pools": [...] }  // aggregated, not individual resources
```

**Workaround:** Don't use `concise=true` when individual resource data is needed.

**Fix:** Document this behavior or use a separate endpoint.

---

### 9. No Single-Resource Endpoint with Full Details

**Priority:** Medium  
**Status:** Active workaround in `hooks.ts` (`useResourceInfo`)

To display full resource details (including all pool memberships and task configs), the UI currently needs:
1. Query `/api/resources?pools=X` for resource capacity (filtered to one pool)
2. Query `/api/resources?all_pools=true` to get ALL pool memberships (expensive)
3. Query `/api/pool_quota?pools=X` to get platform task configurations

**Ideal behavior:** A single endpoint `GET /api/resources/{name}` that returns:
```typescript
interface ResourceDetail {
  hostname: string;
  name: string;  // Resource name
  resourceType: "SHARED" | "RESERVED" | "UNUSED";
  poolMemberships: Array<{ pool: string; platform: string }>;
  capacity: { gpu, cpu, memory, storage };
  usage: { gpu, cpu, memory, storage };
  taskConfig: {  // from current pool's platform config
    hostNetworkAllowed: boolean;
    privilegedAllowed: boolean;
    allowedMounts: string[];
    defaultMounts: string[];
  };
  conditions: string[];
}
```

**Current workaround:** 
- `useResourceInfo()` queries all resources with `all_pools=true` and filters client-side
- Only fetched for SHARED resources (RESERVED belong to single pool)
- Result cached for 5 minutes to reduce API calls

**Fix:** Add `GET /api/resources/{name}` endpoint returning complete resource info.

---

### 10. Pool Detail Requires Two API Calls

**Priority:** Low  
**Status:** Optimization opportunity

Currently, viewing a pool's detail page requires two separate API calls:
1. `GET /api/pool_quota?pools=X` - Pool metadata, quota, and platform configs
2. `GET /api/resources?pools=X` - Resources in the pool

**Current workaround:**
```typescript
// use-pool-detail.ts
export function usePoolDetail({ poolName }) {
  const { pool } = usePool(poolName);           // API Call 1
  const { resources } = usePoolResources(poolName); // API Call 2
}
```

**Ideal behavior:** Single endpoint `GET /api/pools/{name}` returning:
```json
{
  "pool": {
    "name": "pool-alpha",
    "description": "...",
    "status": "ONLINE",
    "quota": { "used": 10, "limit": 100, ... },
    "platforms": { "dgx": { ... } }
  },
  "resources": [
    { "hostname": "node-001", "gpu": { "total": 8, "used": 4 }, ... }
  ]
}
```

**Benefits:**
- Reduces latency for pool detail pages (1 round-trip instead of 2)
- Atomic response - no risk of pool/resources mismatch during concurrent updates
- Simpler client-side code

**Fix:** Add `GET /api/pools/{name}` endpoint that returns combined pool + resources data.

---

### 11. Resources API Needs Pagination and Server-Side Filtering

**Priority:** High  
**Status:** Active workaround in `pagination.ts` and `use-resources.ts`

The `/api/resources` endpoint currently returns all resources at once with no pagination or server-side filtering. For clusters with 500+ resources, this causes slow initial page loads and high memory usage.

**Current behavior:**
```
GET /api/resources?all_pools=true
→ Returns ALL resources (potentially 1000s) in a single response
→ UI filters/paginates client-side (slow, memory-intensive)
```

**Ideal API behavior:**
```
GET /api/resources?limit=50&cursor=abc&search=dgx&resource_types=SHARED&pools=prod
→ Returns paginated, filtered response:
{
  "resources": [...50 matching items...],
  "pagination": {
    "cursor": "xyz789",
    "has_more": true,
    "total": 1234,
    "filtered_total": 456
  },
  "metadata": {
    "available_pools": ["prod", "dev", "staging"],
    "available_platforms": ["dgx", "base", "cpu"]
  }
}
```

**Required API changes:**

1. **Pagination parameters:**
   - `limit`: Max items per page (default: 50, max: 500)
   - `cursor`: Opaque string for cursor-based pagination
   - `offset`: Alternative for offset-based pagination (fallback)

2. **Filtering parameters:**
   - `search`: Text search across resource name, platform, pool memberships
   - `resource_types`: Filter by `SHARED`, `RESERVED`, `UNUSED` (comma-separated)
   - `pools`: Filter by pool membership (existing, works)
   - `platforms`: Filter by platform (existing, works)

3. **Response fields:**
   - `pagination.cursor`: Next page cursor (base64 encoded)
   - `pagination.has_more`: Boolean if more pages exist
   - `pagination.total`: Total resources (before filters)
   - `pagination.filtered_total`: Total matching current filters
   - `metadata.available_pools`: All pools available for filtering
   - `metadata.available_platforms`: All platforms available for filtering

4. **Optional - Sorting:**
   - `sort_by`: Field to sort by (name, platform, gpu, cpu, memory, storage)
   - `sort_order`: `asc` or `desc`

**Current UI workarounds:**

| Workaround | Location | Description |
|------------|----------|-------------|
| Client-side pagination | `pagination.ts` | Fetches all, caches, returns slices |
| Client-side search filter | `use-resources.ts` | Filters loaded data by search query |
| Client-side type filter | `use-resources.ts` | Filters loaded data by resource type |
| Derive filter options | `use-resources.ts` | Extracts pools/platforms from loaded data |

**When fixed:**

1. Update `fetchResources()` in `hooks.ts` to pass all filter params to API
2. Remove client-side caching shim in `pagination.ts`
3. Remove client-side filtering in `use-resources.ts`
4. Use `metadata` from response for filter options
5. Regenerate types with `pnpm generate-api`
6. UI components work unchanged (already coded for ideal API)

**Benefits of backend fix:**
- **Performance**: 50 items per request instead of 1000+
- **Scalability**: Works with arbitrarily large clusters
- **Accuracy**: Server returns exact filtered counts
- **UX**: Instant filtering instead of loading everything first
- **Memory**: No client-side cache needed

---

## Summary

| Issue | Priority | Workaround Location | When Fixed |
|-------|----------|---------------------|------------|
| #1 Incorrect response types | High | transforms.ts | Remove casts |
| #2 String numbers | Medium | transforms.ts | Remove parseNumber |
| #3 Auth in schema | Low | N/A | N/A |
| #4 Version unknown | Low | transforms.ts | Use generated type |
| #5 Untyped dictionaries | Medium | transforms.ts | Access fields directly |
| #6 Unit conversion | Medium | transforms.ts | Remove conversion |
| #7 Filtered pool_platform_labels | Medium | hooks.ts | Remove all_pools query |
| #8 Concise changes structure | Low | N/A | N/A |
| #9 No single-resource endpoint | Medium | hooks.ts | Use new endpoint directly |
| #10 Pool detail requires 2 calls | Low | use-pool-detail.ts | Use new endpoint directly |
| #11 Pagination + server filtering | **High** | pagination.ts, use-resources.ts | Remove shims, pass params |

### Priority Guide

- **High**: Affects performance/scalability for large clusters
- **Medium**: Requires extra API calls or complex client-side logic
- **Low**: Minor inconvenience or code cleanliness issue

---

## How to Fix

When a backend fix is applied:

1. Run `pnpm generate-api` to regenerate types
2. Update/simplify the corresponding transform
3. If generated type matches ideal type, remove the transform
4. Update this document

**Ultimate goal:** When all issues are fixed, the adapter layer can be removed and UI imports directly from `generated.ts`.
