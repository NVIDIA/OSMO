# Backend API Issues and Workarounds

Issues identified during UI development that require backend fixes.
All workarounds are quarantined in this **Backend Adapter Layer** (`src/lib/api/adapter/`).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI COMPONENTS                            │
│  (Clean code - no workarounds, uses ideal types)                │
│  import { usePools, usePool, Node, Pool } from "@/lib/api/adapter"
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND ADAPTER LAYER                        │
│  src/lib/api/adapter/                                           │
│  ├── types.ts      - Ideal types the UI expects                 │
│  ├── transforms.ts - All workarounds quarantined here           │
│  ├── hooks.ts      - Clean hooks with automatic transformation  │
│  └── index.ts      - Public exports                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      GENERATED TYPES                            │
│  src/lib/api/generated.ts (auto-generated from OpenAPI)         │
└─────────────────────────────────────────────────────────────────┘
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
- Node belongs to: `isaac-hil`, `isaac-nightly`
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
  nodeName: string;
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

---

## How to Fix

When a backend fix is applied:

1. Run `pnpm generate-api` to regenerate types
2. Update/simplify the corresponding transform
3. If generated type matches ideal type, remove the transform
4. Update this document

**Ultimate goal:** When all issues are fixed, the adapter layer can be removed and UI imports directly from `generated.ts`.
