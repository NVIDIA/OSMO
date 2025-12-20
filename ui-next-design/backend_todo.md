# Backend TODOs

Issues identified during UI development that require backend fixes.

All workarounds are quarantined in the **Backend Adapter Layer** (`src/lib/api/adapter/`).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI COMPONENTS                             │
│  (Clean code - no workarounds, uses ideal types)                │
│  import { usePools, usePool, Node, Pool } from "@/lib/api/adapter"
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND ADAPTER LAYER                         │
│  src/lib/api/adapter/                                           │
│  ├── types.ts      - Ideal types the UI expects                 │
│  ├── transforms.ts - All workarounds quarantined here           │
│  ├── hooks.ts      - Clean hooks with automatic transformation  │
│  └── index.ts      - Public exports                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      GENERATED TYPES                             │
│  src/lib/api/generated.ts (auto-generated from OpenAPI)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## OpenAPI Schema Issues

### 1. Incorrect Response Types for Pool/Resource APIs

**Priority:** High  
**Impact:** Adapter has to cast API responses

Several API endpoints have incorrect response types in the OpenAPI schema. They're typed as returning `string` but actually return structured JSON objects.

**Affected endpoints:**
- `GET /api/pool_quota` - Returns `PoolResponse`, not `string`
- `GET /api/resources` - Returns `ResourcesResponse`, not `string`

**Location in adapter:**
```typescript
// transforms.ts
export function transformPoolsResponse(rawResponse: unknown): PoolsResponse {
  // Cast to actual type (backend returns this, but OpenAPI types it wrong)
  const response = rawResponse as PoolResponse | undefined;
  ...
}
```

**Fix:** Update the FastAPI endpoint return type annotations to properly reflect the response schema.

---

### 2. ResourceUsage Fields Are Strings Instead of Numbers

**Priority:** Medium  
**Impact:** Adapter has to parse strings to numbers

The `ResourceUsage` interface has all numeric fields typed as `string`:
```typescript
export interface ResourceUsage {
  quota_used: string;   // Should be number
  quota_free: string;   // Should be number
  quota_limit: string;  // Should be number
  total_usage: string;  // Should be number
  total_capacity: string; // Should be number
  total_free: string;   // Should be number
}
```

**Location in adapter:**
```typescript
// transforms.ts
function parseNumber(value: string | number | undefined | null): number {
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}
```

**Fix:** Update the Pydantic model to use proper numeric types.

---

### 3. Auth Configuration Embedded in OpenAPI Schema

**Priority:** Low  
**Impact:** Schema hygiene, not a security issue

The `service_auth` field in `ServiceConfigs` has a default value that calls `AuthenticationConfig.generate_default()`, which embeds RSA keys into the OpenAPI schema.

**Location:** `external/src/utils/connectors/postgres.py:2531`

**Fix options:**
1. Use `Field(exclude=True)` to hide from schema
2. Don't set default at model level
3. Use `schema_extra` to exclude sensitive defaults

---

### 4. Version Endpoint Returns `unknown` Type

**Priority:** Low  
**Impact:** Adapter has to define version type manually

The `GET /api/version` endpoint has no response type defined in the OpenAPI schema, so orval generates `unknown`.

**Location in adapter:**
```typescript
// types.ts
export interface Version {
  major: string;
  minor: string;
  revision: string;
  hash?: string;
}

// transforms.ts
export function transformVersionResponse(rawResponse: unknown): Version | null {
  // Manual parsing because no type exists
}
```

**Fix:** Add a proper Pydantic response model to the version endpoint.

---

### 5. Resource Fields Use Untyped Dictionaries

**Priority:** Medium  
**Impact:** Adapter cannot type-check resource field access

The `ResourcesEntry` type has `allocatable_fields` and `usage_fields` typed as `{ [key: string]: unknown }`.

**Location in adapter:**
```typescript
// transforms.ts
function getFieldValue(
  fields: Record<string, unknown> | undefined,
  key: string
): number {
  // Must handle unknown types
}
```

**Fix options:**
1. Define a typed schema for known resource fields (gpu, cpu, memory, storage)
2. Or use `Dict[str, Union[int, float]]` to at least type the values as numeric

---

## Summary

| Issue | Priority | Adapter Workaround | When Fixed |
|-------|----------|-------------------|------------|
| #1 Incorrect response types | High | `as PoolResponse` casts | Remove cast in transforms.ts |
| #2 String numbers | Medium | parseNumber() | Remove parseNumber calls |
| #3 Auth in schema | Low | N/A | N/A |
| #4 Version unknown | Low | Manual type definition | Use generated type |
| #5 Untyped dictionaries | Medium | getFieldValue() | Access fields directly |

---

## How to Fix

When a backend fix is applied:

1. Run `pnpm generate-api` to regenerate types
2. Update/simplify the corresponding transform in `adapter/transforms.ts`
3. If the generated type now matches the ideal type, consider removing the transform

**Ultimate goal:** When all backend issues are fixed, the adapter layer can be completely removed and UI can import directly from `generated.ts`.

---

## Notes

- All workarounds are quarantined in `src/lib/api/adapter/`
- UI code is clean and has no knowledge of backend quirks
- TypeScript will catch any interface mismatches at compile time
- The private key in issue #3 is properly redacted, so it's not a security vulnerability
