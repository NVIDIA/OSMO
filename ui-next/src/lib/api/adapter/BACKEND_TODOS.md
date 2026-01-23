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
**Status:** Active workaround in `transforms.ts` and `hooks.ts`

Several API endpoints have incorrect response types in the OpenAPI schema. They're typed as returning `string` but actually return structured JSON objects.

**Root cause:** The backend's OpenAPI spec generation is missing proper response type annotations. In `openapi.json`, these endpoints have:
```json
"responses": {
  "200": {
    "content": {
      "application/json": {
        "schema": { "type": "string" }  // ← Wrong: should be "$ref": "#/components/schemas/..."
      }
    }
  }
}
```

**Affected endpoints:**
| Endpoint | OpenAPI Says | Actually Returns |
|----------|--------------|------------------|
| `GET /api/pool_quota` | `string` | `PoolResponse` |
| `GET /api/resources` | `string` | `ResourcesResponse` |
| `GET /api/resources/{name}` | `string` | `ResourcesResponse` |
| `GET /api/configs/service` | `string` | Config object |
| `GET /api/configs/workflow` | `string` | Config object |
| `GET /api/configs/dataset` | `string` | Config object |

**Generated code consequence:**
```typescript
// generated.ts (orval correctly follows the spec, but spec is wrong)
return customFetch<string>({ url: `/api/resources`, ... });
//                 ^^^^^^ Should be ResourcesResponse
```

**Workarounds:**
```typescript
// transforms.ts - Cast unknown to actual type
export function transformPoolsResponse(rawResponse: unknown): PoolsResponse {
  const response = rawResponse as PoolResponse | undefined;
  // ...
}

// hooks.ts:257 - Cast to unknown to satisfy function signature
getResourcesApiResourcesGet({ all_pools: true }).then((res) => res as unknown)
```

**Fix (backend):** Add explicit response models to FastAPI endpoints:
```python
# Python/FastAPI - Add response_model annotation
@router.get("/api/resources", response_model=ResourcesResponse)
def get_resources(...) -> ResourcesResponse:
    ...
```

This will cause the OpenAPI spec to correctly reference the schema:
```json
"schema": { "$ref": "#/components/schemas/ResourcesResponse" }
```

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

### 12. Summary Aggregates Need Server-Side Calculation

**Priority:** High
**Status:** Anti-pattern in UI (aggregates loaded data only)

The `AdaptiveSummary` component displays aggregated totals (GPU, CPU, Memory, Storage) for resources. Currently, it reduces over whatever resources are loaded client-side:

```typescript
// resource-summary-card.tsx - CURRENT (anti-pattern)
const totals = useMemo(() => {
  return resources.reduce((acc, r) => ({
    gpu: { used: acc.gpu.used + r.gpu.used, total: acc.gpu.total + r.gpu.total },
    // ...
  }), initialTotals);
}, [resources]);
```

**Problem:** With pagination, `resources` only contains loaded pages. Summary shows "32 GPU / 64 total" when user has scrolled through 2 pages, but cluster actually has "256 GPU / 512 total".

**Ideal API behavior:**

Option A: Include summary in paginated response (recommended)
```json
GET /api/resources?limit=50&cursor=abc&pools=prod

{
  "resources": [...50 items...],
  "pagination": { "cursor": "xyz", "has_more": true, "total": 500 },
  "summary": {
    "gpu": { "used": 128, "total": 256 },
    "cpu": { "used": 1024, "total": 2048 },
    "memory_gib": { "used": 512, "total": 1024 },
    "storage_gib": { "used": 2048, "total": 4096 }
  }
}
```

Option B: Separate summary endpoint
```json
GET /api/resources/summary?pools=prod

{
  "gpu": { "used": 128, "total": 256 },
  "cpu": { "used": 1024, "total": 2048 },
  "memory_gib": { "used": 512, "total": 1024 },
  "storage_gib": { "used": 2048, "total": 4096 },
  "resource_count": 500
}
```

**Why backend should do this:**

1. **Accuracy**: Server sees ALL data, can calculate exact totals
2. **Performance**: Database can aggregate with `SUM()` much faster than client
3. **Consistency**: Same filters applied to both list and summary
4. **Scalability**: Works regardless of dataset size

**Required summary fields:**

| Field | Type | Description |
|-------|------|-------------|
| `gpu.used` | number | Total GPUs currently in use |
| `gpu.total` | number | Total GPUs allocatable |
| `cpu.used` | number | Total CPUs currently in use |
| `cpu.total` | number | Total CPUs allocatable |
| `memory_gib.used` | number | Total memory in use (GiB) |
| `memory_gib.total` | number | Total memory allocatable (GiB) |
| `storage_gib.used` | number | Total storage in use (GiB) |
| `storage_gib.total` | number | Total storage allocatable (GiB) |
| `resource_count` | number | Total resources matching filters |

**Current UI workaround:**

The summary only aggregates loaded data. This is documented as a known limitation until backend provides server-side aggregates.

```typescript
// SHIM: Use server-provided summary when available, fall back to client aggregation
const summary = serverSummary ?? aggregateLoadedResources(resources);
```

**When fixed:**

1. Update `fetchResources()` to extract `summary` from response
2. Pass server summary to `AdaptiveSummary` component
3. Remove client-side aggregation fallback
4. Summary will be accurate regardless of pagination state

**Benefits:**
- **Accurate totals**: Users see real cluster capacity, not just loaded pages
- **Instant display**: Summary shows immediately, no need to load all pages
- **Filter-aware**: Summary updates when filters change (server recalculates)

---

### 13. Pools API Needs Server-Side Filtering

**Priority:** Medium
**Status:** Active workaround in `pools-shim.ts`

The `/api/pools` endpoint currently returns all pools at once with no filtering. While pool counts are typically smaller than resources (10-100 vs 1000+), server-side filtering would improve consistency and prepare for scale.

**Current behavior:**
```
GET /api/pool_quota?all_pools=true
→ Returns ALL pools
→ UI filters client-side (works but not ideal)
```

**Ideal API behavior:**
```
GET /api/pools?status=online,maintenance&platform=dgx&search=ml-team
→ Returns filtered response:
{
  "pools": [...filtered pools...],
  "metadata": {
    "status_counts": { "online": 15, "maintenance": 3, "offline": 2 },
    "platforms": ["dgx", "base", "cpu"],
    "backends": ["slurm", "kubernetes"]
  },
  "sharing_groups": [["pool-a", "pool-b"], ["pool-c", "pool-d"]],
  "total": 20,
  "filtered_total": 18
}
```

**Required API changes:**

1. **Filtering parameters:**
   - `status`: Filter by pool status (comma-separated: online,maintenance,offline)
   - `platform`: Filter by platform (comma-separated)
   - `backend`: Filter by backend (comma-separated)
   - `search`: Text search across pool name and description
   - `shared_with`: Filter to pools sharing capacity with given pool name

2. **Response fields:**
   - `metadata.status_counts`: Count of pools per status (for section headers in UI)
   - `metadata.platforms`: Available platforms (for filter dropdown)
   - `metadata.backends`: Available backends (for filter dropdown)
   - `sharing_groups`: Groups of pool names that share physical capacity
   - `total`: Total pools before filtering
   - `filtered_total`: Total pools after filtering

**Current UI workarounds:**

| Workaround | Location | Description |
|------------|----------|-------------|
| Client-side filtering | `pools-shim.ts` | Fetches all pools, filters in browser |
| Client-side metadata | `pools-shim.ts` | Computes status counts, platforms, backends from loaded data |
| Chip-to-params mapping | `use-pools-data.ts` | Converts SmartSearch chips to filter params |

**When fixed:**

1. Delete `pools-shim.ts` entirely
2. Update `useFilteredPools()` in `hooks.ts` to pass filters directly to API
3. Remove client-side filtering logic
4. Use `metadata` from response for filter dropdowns
5. Regenerate types with `pnpm generate-api`
6. UI components and `usePoolsData` hook work unchanged

**Benefits of backend fix:**
- **Consistency**: Same filtering approach as resources API
- **Performance**: Less data transferred when filters are active
- **Accuracy**: Server returns exact status counts for section headers
- **Scalability**: Ready for clusters with many pools

---

### 14. Workflow List API `more_entries` Always Returns False

**Priority:** High
**Status:** Active workaround in `workflows-shim.ts`

The `/api/workflow` list endpoint has a bug where `more_entries` is always `false`, preventing infinite scroll pagination from working.

**Root cause:** In `workflow_service.py` lines 569-577:

```python
# Fetch limit+1 to check if there are more
rows = helpers.get_workflows(..., limit+1, ...)

# Slice to limit rows
if order == connectors.ListOrder.DESC:
    rows = rows[:limit]
elif len(rows) > limit:
    rows = rows[1:]

# BUG: Check AFTER slicing - always returns False!
return objects.ListResponse.from_db_rows(rows, service_url,
                                         more_entries=len(rows) > limit)
```

After slicing, `len(rows)` is at most `limit`, so `len(rows) > limit` is always `False`.

**Fix required:**
```python
has_more = len(rows) > limit  # Check BEFORE slicing
if order == connectors.ListOrder.DESC:
    rows = rows[:limit]
elif has_more:
    rows = rows[1:]
return objects.ListResponse.from_db_rows(rows, service_url, more_entries=has_more)
```

**Current UI workaround:**
```typescript
// workflows-shim.ts - Infer hasMore from item count
const hasMore = workflows.length === limit;
```

If we received exactly `limit` items, assume there are more. Only set `hasMore: false` when we receive fewer than `limit` items.

**Impact:** Without workaround, UI only makes one API request and never fetches additional pages.

**When fixed:**
1. Remove workaround in `workflows-shim.ts`
2. Use `more_entries` from API response directly

---

### 15. Workflow List Response Missing Tags Field

**Priority:** Low
**Status:** Filter available, column not possible

The `/api/workflow` list endpoint accepts `tags` as a filter parameter, but the response (`SrcServiceCoreWorkflowObjectsListEntry`) does not include tags in each workflow entry.

**Current response fields:**
```typescript
interface SrcServiceCoreWorkflowObjectsListEntry {
  user: string;
  name: string;
  workflow_uuid: string;
  submit_time: string;
  start_time?: string;
  end_time?: string;
  queued_time: number;
  duration?: number;
  status: WorkflowStatus;
  pool?: string;
  priority: string;
  app_name?: string;
  // ... other fields
  // tags: string[];  // ← MISSING
}
```

**Impact:**
- Users can filter workflows by tag (backend filters correctly)
- Users cannot see which tags a workflow has in the table (no column possible)
- This creates a confusing UX: "I filtered by tag:foo but can't see which workflows have that tag"

**Current UI workaround:**
- Tag filter is available in SmartSearch
- No tag column in the workflows table (data not available)
- Search field notes: "Tags aren't in the list response, so no suggestions from data"

**Ideal response:**
```typescript
interface WorkflowListEntry {
  // ... existing fields ...
  tags?: string[];  // Add tags array
}
```

**When fixed:**
1. Add `tags` column to `workflow-columns.ts`
2. Add `tags` column renderer in `workflow-column-defs.tsx`
3. Update `getValues` in tag search field to extract from loaded workflows

---

### 16. Timestamps Missing Explicit Timezone

**Priority:** Medium
**Status:** Active workaround in `utils.ts`

Backend timestamps may be returned without explicit timezone information, causing inconsistent parsing across different user timezones.

**Current behavior (problematic):**
```json
{
  "start_time": "2024-01-15T10:30:00",      // No timezone - ambiguous!
  "end_time": "2024-01-15T10:35:00"         // Is this UTC? Local? Unknown.
}
```

When JavaScript parses `new Date("2024-01-15T10:30:00")` without a timezone suffix:
- Chrome/Safari: Treats as **local time**
- Some environments: Treats as **UTC**
- Result: Duration calculations can be off by hours depending on user's timezone

**Ideal behavior (explicit UTC):**
```json
{
  "start_time": "2024-01-15T10:30:00Z",      // Explicit UTC with 'Z' suffix
  "end_time": "2024-01-15T10:35:00Z"         // Unambiguous
}
```

Or with offset:
```json
{
  "start_time": "2024-01-15T10:30:00+00:00", // Explicit UTC offset
  "end_time": "2024-01-15T10:35:00+00:00"
}
```

**Affected fields (all timestamp strings in API responses):**
- `submit_time`, `start_time`, `end_time` (workflows, tasks, groups)
- `scheduling_start_time`, `initializing_start_time`, `processing_start_time`
- `input_download_start_time`, `input_download_end_time`
- `output_upload_start_time`
- Any other `*_time` fields

**Current adapter workaround:**
```typescript
// hooks.ts - useWorkflow adapter hook normalizes timestamps
export function useWorkflow({ name, verbose }: UseWorkflowParams): UseWorkflowReturn {
  const { data, ... } = useGetWorkflowApiWorkflowNameGet(name, { verbose });

  const workflow = useMemo(() => {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    // Normalize timestamps at the API boundary
    return normalizeWorkflowTimestamps(parsed) as WorkflowQueryResponse;
  }, [data]);

  return { workflow, ... };
}

// utils.ts - Timestamp normalization utility
export function normalizeWorkflowTimestamps<T>(workflow: T): T {
  // Recursively normalizes all timestamp fields in workflow/group/task data
  // Appends 'Z' suffix to timestamps without timezone info
}

// Feature hooks just use the adapter hook - no workarounds
import { useWorkflow } from "@/lib/api/adapter";

// UI components receive clean data, use new Date(str) directly
```

**Fix (backend):**

In Python/FastAPI, ensure all datetime fields are timezone-aware UTC:
```python
from datetime import datetime, timezone

# When creating timestamps
timestamp = datetime.now(timezone.utc)

# When serializing (Pydantic)
class MyModel(BaseModel):
    start_time: datetime

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat() if v else None
        }
```

For timezone-aware datetimes, Python's `isoformat()` will include the offset (e.g., `+00:00`).
Alternatively, explicitly format with 'Z':
```python
timestamp.strftime("%Y-%m-%dT%H:%M:%SZ")
```

**When fixed:**
1. Remove `parseTimestamp()` workaround from `utils.ts`
2. Use `new Date(timeStr)` directly throughout codebase
3. All duration/timeline calculations work correctly regardless of user timezone

---

### 17. Workflow List `order` Parameter Ignored for Pagination

**Priority:** High
**Status:** UI shows wrong sort order (ASC shows newest first)

The `/api/workflow` list endpoint ignores the `order` parameter for pagination purposes. The inner SQL query hardcodes `ORDER BY submit_time DESC`, making the `order` parameter only re-sort the already-paginated results.

**Root cause:** In `helpers.py` lines 105-113:

```python
# Line 105: Inner query ALWAYS uses DESC for pagination
fetch_cmd += ' ORDER BY submit_time DESC LIMIT %s OFFSET %s'
fetch_input.extend([limit, offset])

# Lines 108-113: Outer query re-sorts the paginated slice
fetch_cmd = f'SELECT * FROM ({fetch_cmd}) as wf'
if order == connectors.ListOrder.ASC:
    fetch_cmd += ' ORDER BY submit_time ASC'
else:
    fetch_cmd += ' ORDER BY submit_time DESC'
```

**What happens:**

```sql
-- User requests: order=ASC, limit=50, offset=0
-- Expected: oldest 50 workflows

-- Actual SQL generated:
SELECT * FROM (
    SELECT ... FROM workflows
    ORDER BY submit_time DESC  -- ❌ Always fetches NEWEST first
    LIMIT 51 OFFSET 0
) as wf
ORDER BY submit_time ASC;      -- ✓ Re-sorts, but wrong data fetched
```

**Impact:**

| Request | Expected | Actual (Bug) |
|---------|----------|--------------|
| `order=ASC, limit=50` | Oldest 50 workflows | Newest 50, re-sorted oldest-first |
| `order=DESC, limit=50` | Newest 50 workflows | Newest 50 ✓ (works by accident) |

Users clicking to sort "oldest first" see newest workflows re-sorted, not actual oldest workflows.

**Fix required:**

```python
# In helpers.py, line 105 should respect the order parameter:

# BEFORE (broken):
fetch_cmd += ' ORDER BY submit_time DESC LIMIT %s OFFSET %s'

# AFTER (fixed):
order_direction = 'ASC' if order == connectors.ListOrder.ASC else 'DESC'
fetch_cmd += f' ORDER BY submit_time {order_direction} LIMIT %s OFFSET %s'

# The outer re-sort (lines 108-113) can then be removed as redundant
```

**Also fix pagination slicing in `workflow_service.py` lines 572-575:**

```python
# BEFORE (broken - asymmetric slicing):
if order == connectors.ListOrder.DESC:
    rows = rows[:limit]
elif len(rows) > limit:
    rows = rows[1:]  # ❌ Why skip first row for ASC?

# AFTER (fixed - consistent slicing):
if len(rows) > limit:
    rows = rows[:limit]  # Always take first `limit` rows
```

**Current UI impact:**
- No workaround possible in frontend
- UI correctly sends `order=ASC` but backend returns wrong data
- Sort indicator shows ↑ (ASC) but data appears DESC

**When fixed:**
1. No UI changes needed (already sends correct parameter)
2. Sorting will work correctly for both directions

---

### 18. Status Labels Should Be Generated from Backend

**Priority:** Low
**Status:** Hardcoded in UI, could be generated

The UI defines human-readable labels for statuses in multiple files:
- `status-utils.ts` → `STATUS_LABELS` for TaskGroupStatus
- `workflow-constants.ts` → `STATUS_LABELS` for WorkflowStatus
- `pools/constants.ts` → `STATUS_DISPLAYS` for PoolStatus

These are currently hardcoded and need to be updated manually when backend adds new statuses.

**Current UI workaround:**
- Labels are hardcoded in TypeScript files
- TypeScript catches missing labels at compile time (good), but labels must be added manually (bad)

**Ideal solution:**

Add a `label()` method to Python enums:

```python
class TaskGroupStatus(enum.Enum):
    COMPLETED = 'COMPLETED'
    FAILED = 'FAILED'
    FAILED_CANCELED = 'FAILED_CANCELED'
    # ...

    def label(self) -> str:
        """Human-readable label for UI display."""
        labels = {
            'COMPLETED': 'Completed',
            'FAILED': 'Failed',
            'FAILED_CANCELED': 'Canceled',
            # ...
        }
        return labels.get(self.name, self.name.replace('_', ' ').title())
```

Then update `export_status_metadata.py` to include labels:

```python
task_metadata[status.value] = {
    "category": category,
    "isTerminal": status.finished(),
    "isFailed": status.failed(),
    "isInQueue": status.in_queue(),
    "label": status.label(),  # NEW
}
```

**When fixed:**
1. Update `export_status_metadata.py` to include `label` in generated metadata
2. Remove hardcoded `STATUS_LABELS` from UI files
3. Use generated labels: `TASK_STATUS_METADATA[status].label`

---

### 19. Status Sort Order Should Be Generated from Backend

**Priority:** Low
**Status:** Hardcoded in UI

The UI defines sort order for statuses in `status-utils.ts`:

```typescript
export const STATUS_SORT_ORDER: Record<string, number> = {
  FAILED: 0,
  FAILED_CANCELED: 1,
  // ... failures first, then running, then completed
  COMPLETED: 19,
};
```

**Ideal solution:**

Add `sortOrder` to generated metadata, derived from enum definition order:

```python
# In export_status_metadata.py
for i, status in enumerate(TaskGroupStatus):
    task_metadata[status.value] = {
        # ... existing fields ...
        "sortOrder": i,
    }
```

Or use category-based sorting (failures first, then running, then completed):

```python
CATEGORY_SORT_ORDER = {"failed": 0, "running": 1, "waiting": 2, "completed": 3}
task_metadata[status.value] = {
    "sortOrder": CATEGORY_SORT_ORDER[category] * 100 + i,
}
```

**When fixed:**
1. Add `sortOrder` to generated metadata
2. Remove hardcoded `STATUS_SORT_ORDER` from UI
3. Use generated order for table sorting

---

### 20. Fuzzy Search Indexes Should Be Derived from Labels

**Priority:** Low
**Status:** Hardcoded in UI

The UI defines fuzzy search indexes in `workflow-constants.ts`:
- `LABEL_TO_STATUS` - label string → status enum
- `TOKEN_TO_STATUSES` - search token → matching statuses
- `STATUS_TOKENS` - status → its search tokens

These are derived from labels, so if labels were generated (Issue #18), these could be derived automatically.

**When fixed:**
1. Generate labels from backend (see Issue #18)
2. Derive fuzzy search indexes from generated labels at build time
3. Remove hardcoded search index maps from UI

---

### 21. PoolStatus Should Have Generated Metadata

**Priority:** Low
**Status:** Not currently generated

PoolStatus is a simple enum (ONLINE, OFFLINE, MAINTENANCE) but has no generated metadata like TaskGroupStatus and WorkflowStatus.

**Current UI workaround:**
- `pools/constants.ts` hardcodes `STATUS_DISPLAYS` with category, label, sortOrder

**Ideal solution:**

Add PoolStatus to `export_status_metadata.py`:

```python
from src.utils.connectors.postgres import PoolStatus

pool_metadata = {}
for status in PoolStatus:
    pool_metadata[status.value] = {
        "category": "online" if status == PoolStatus.ONLINE else
                   "maintenance" if status == PoolStatus.MAINTENANCE else
                   "offline",
        "label": status.value.title(),
        "sortOrder": list(PoolStatus).index(status),
    }
```

**When fixed:**
1. Add PoolStatus to generation script
2. Remove hardcoded `STATUS_DISPLAYS` from `pools/constants.ts`
3. Use generated metadata

---

### 22. WebSocket Shell Resize Messages Corrupt User Input Buffer

**Priority:** Critical
**Status:** Partial workaround in UI (`use-websocket-shell.ts`) - **does not fix input corruption**

The WebSocket shell implementation sends terminal resize messages as JSON strings (`{"Rows":39,"Cols":132}`) over the same WebSocket channel as user input and shell output. These resize messages are being echoed back to the client and appear in the terminal buffer.

**Root cause:** In `external/src/runtime/cmd/user/user.go`, the `userExec` function:

1. **Line 103-112**: Reads the INITIAL resize message on connection:
   ```go
   var initSize struct {
       Rows uint16 `json:"rows"`
       Cols uint16 `json:"cols"`
   }
   if err := dec.Decode(&initSize); err != nil {
       // ...
   }
   ```

2. **Line 147**: Sets initial PTY size:
   ```go
   if err := pty.Setsize(terminal, &pty.Winsize{Rows: initSize.Rows, Cols: initSize.Cols}); err != nil {
   ```

3. **Line 155-160**: Blindly copies ALL subsequent WebSocket data to PTY:
   ```go
   go func() {
       _, err = io.Copy(terminal, conn)  // ← Problem: includes resize messages!
       // ...
   }()
   ```

4. **Line 162-168**: Copies PTY output back to WebSocket:
   ```go
   go func() {
       _, err = io.Copy(conn, terminal)  // ← Echoes resize messages back
       // ...
   }()
   ```

**What happens:**
- User resizes terminal → Client sends `{"Rows":39,"Cols":132}` via WebSocket
- `io.Copy(terminal, conn)` writes this JSON string to the PTY input stream
- The JSON enters bash's **input buffer** (not visible yet - no echo)
- User types a command and presses Enter
- Bash attempts to execute the buffered content: `Rows:39Rows:39` (JSON mangled by bash parsing) + user's command
- Result: `bash: Rows:39Rows:39: command not found`

**This is worse than visual pollution - it actively corrupts user input!**

**Additional issues:**
- **Duplicate resize events**: UI was sending duplicate resize events when dimensions hadn't changed (fixed in UI with deduplication)
- **No separation of control vs data**: Resize messages and user input share the same channel

**Ideal solution (backend fix):**

The proper architectural solution is to **multiplex control frames and user data** so they don't interfere with each other. There are several approaches:

**Option 1: Framed message protocol (RECOMMENDED)**

Wrap all WebSocket messages in a frame envelope that distinguishes message types:

```go
type MessageType string

const (
    MessageTypeData   MessageType = "data"    // User keyboard input / shell output
    MessageTypeResize MessageType = "resize"  // Terminal resize
    MessageTypePing   MessageType = "ping"    // Keepalive
    MessageTypePong   MessageType = "pong"    // Keepalive response
)

type Frame struct {
    Type    MessageType     `json:"type"`
    Payload json.RawMessage `json:"payload"`
}

type ResizePayload struct {
    Rows uint16 `json:"rows"`
    Cols uint16 `json:"cols"`
}

type DataPayload struct {
    Data []byte `json:"data"`  // base64 encoded
}

// WebSocket message handler
go func() {
    decoder := json.NewDecoder(conn)
    for {
        var frame Frame
        if err := decoder.Decode(&frame); err != nil {
            break
        }

        switch frame.Type {
        case MessageTypeResize:
            var resize ResizePayload
            json.Unmarshal(frame.Payload, &resize)
            pty.Setsize(terminal, &pty.Winsize{Rows: resize.Rows, Cols: resize.Cols})

        case MessageTypeData:
            var data DataPayload
            json.Unmarshal(frame.Payload, &data)
            terminal.Write(data.Data)

        case MessageTypePing:
            // Respond with pong
            sendFrame(conn, Frame{Type: MessageTypePong, Payload: nil})
        }
    }
}()
```

Client sends:
```json
{"type":"resize","payload":{"rows":39,"cols":132}}
{"type":"data","payload":{"data":"bHMgLWxhCg=="}}
```

**Benefits:**
- Clean separation of control vs data
- Extensible: Easy to add new message types (ping/pong, session control, file transfer)
- Self-documenting: Message type is explicit
- No ambiguity: Cannot accidentally interpret control message as user input

**Option 2: Binary framing with length prefix**

Use WebSocket binary frames with a simple protocol:
```
[1 byte: message type][4 bytes: length][N bytes: payload]
```

- `type=0x00`: User data (raw bytes)
- `type=0x01`: Resize (4 bytes: rows, cols as uint16)
- `type=0x02`: Ping
- `type=0x03`: Pong

**Benefits:**
- Efficient: No JSON parsing overhead for user data
- Fast: Binary protocol is faster than JSON
- Clear: Type byte makes intent explicit

**Drawbacks:**
- Less human-readable (harder to debug)
- More complex parsing logic

**Option 3: Separate WebSocket connections**

Use two WebSocket connections:
- `ws://host/api/router/exec/{workflow}/client/{key}/data` - User I/O stream
- `ws://host/api/router/exec/{workflow}/client/{key}/control` - Control messages

**Benefits:**
- Complete separation
- Can use different protocols for each (binary for data, JSON for control)

**Drawbacks:**
- Two connections = more resources
- Harder to keep in sync
- Complicates client-side state management

**Recommended approach:**

**Option 1 (Framed message protocol)** is the best balance of:
- Clean separation of concerns (no mixing control/data)
- Extensibility (easy to add new message types)
- Debuggability (JSON is human-readable)
- Industry standard (similar to JSON-RPC, LSP, DAP protocols)

This is how most modern terminal protocols work:
- VS Code Remote: Uses framed JSON messages over WebSocket
- Docker exec API: Uses HTTP/2 with separate streams for stdin/stdout/stderr
- Kubernetes exec: Uses SPDY/WebSocket with subprotocol headers

**Current UI workarounds (PARTIAL - doesn't fix input corruption):**

1. **Resize message filtering** (`use-websocket-shell.ts` lines 179-207):
   ```typescript
   ws.onmessage = (event) => {
       // Filter out resize messages that might be echoed back
       // NOTE: This only prevents echoes in output, NOT input buffer corruption!
       const text = new TextDecoder().decode(data);
       if (text.match(/^\{"Rows":\d+,"Cols":\d+\}$/)) {
           console.debug("[Shell] Filtered resize message:", text);
           return;  // Don't write to terminal
       }
       onDataRef.current?.(data);
   };
   ```
   **Limitation:** This only filters messages coming FROM the server. It cannot prevent the backend from writing resize JSON to the PTY input buffer.

2. **Duplicate event prevention** (`use-shell.ts` lines 250-273):
   ```typescript
   // Track last resize dimensions to prevent duplicate events
   const lastDimensionsRef = useRef<{ cols: number; rows: number } | null>(null);

   if (onResize) {
       const last = lastDimensionsRef.current;
       if (!last || last.cols !== proposed.cols || last.rows !== proposed.rows) {
           lastDimensionsRef.current = { cols: proposed.cols, rows: proposed.rows };
           onResize(proposed.cols, proposed.rows);
       }
   }
   ```
   **Limitation:** Reduces frequency but doesn't solve the fundamental problem - any resize still corrupts input.

**Impact:**
- **Data corruption**: Resize messages corrupt the shell's input buffer, causing "command not found" errors
- **Unpredictable behavior**: JSON gets mangled by bash parsing (`{"Rows":39}` → `Rows:39Rows:39`)
- **User commands fail**: Any command entered after a resize has garbage prepended to it
- **Confusing UX**: Users see cryptic "command not found" errors for commands they didn't type
- **Client-side filtering insufficient**: Our filter only catches echoes from server, can't prevent PTY input corruption
- **Extra client complexity**: UI must filter control messages from data stream (only helps with echoes, not input corruption)
- **Race conditions**: If resize message is split across packets, filter might miss it
- **Not extensible**: Adding new control messages (ping/pong, file transfer) requires more brittle filtering
- **Violates separation of concerns**: Control plane and data plane are mixed

**Note:** The client-side workaround in `use-websocket-shell.ts` only prevents resize message **echoes** from appearing in the output. It cannot prevent the resize JSON from corrupting the PTY input buffer on the backend. This is a **critical backend issue** that requires the framed protocol fix.

**When fixed (with framed protocol):**
1. Remove resize message filtering from `use-websocket-shell.ts`
2. Update client to send/receive framed messages:
   ```typescript
   // Send resize
   ws.send(JSON.stringify({ type: "resize", payload: { rows: 39, cols: 132 } }));

   // Send user input
   ws.send(JSON.stringify({ type: "data", payload: { data: base64(input) } }));

   // Receive messages
   ws.onmessage = (event) => {
       const frame = JSON.parse(event.data);
       if (frame.type === "data") {
           terminal.write(atob(frame.payload.data));
       }
   };
   ```
3. Protocol is now extensible for future features (ping/pong, file transfer, etc.)
4. No ambiguity or filtering needed

**Migration path:**
1. Backend implements framed protocol with backward compatibility (detect old vs new clients)
2. Update UI to use framed protocol
3. Deprecate old protocol after transition period
4. Remove backward compatibility code

---

## Summary

| Issue | Priority | Workaround Location | When Fixed |
|-------|----------|---------------------|------------|
| #1 Incorrect response types | High | transforms.ts, hooks.ts | Remove casts |
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
| #12 Server-side summary aggregates | **High** | resource-summary-card.tsx | Use server summary |
| #13 Pools server-side filtering | Medium | pools-shim.ts | Delete shim, pass filters to API |
| #14 Workflow more_entries bug | **High** | workflows-shim.ts | Use more_entries directly |
| #15 Workflow list missing tags | Low | workflow-search-fields.ts | Add tags column |
| #16 Timestamps missing timezone | Medium | hooks.ts (useWorkflow), utils.ts | Remove normalizeWorkflowTimestamps |
| #17 Workflow order param ignored | **High** | N/A (no workaround) | Sorting will work correctly |
| #18 Status labels not generated | Low | status-utils.ts, workflow-constants.ts | Use generated labels |
| #19 Status sort order not generated | Low | status-utils.ts | Use generated sortOrder |
| #20 Fuzzy search indexes hardcoded | Low | workflow-constants.ts | Derive from generated labels |
| #21 PoolStatus needs metadata | Low | pools/constants.ts | Use generated pool metadata |
| #22 Shell resize corrupts input | **CRITICAL** | use-websocket-shell.ts, use-shell.ts | Backend framed protocol required |

### Priority Guide

- **CRITICAL**: Breaks core functionality, data corruption, or security issue
- **High**: Affects performance/scalability for large clusters or incorrect behavior
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
