# Backend API Issues and Workarounds

This document tracks backend API issues that require workarounds in the adapter layer.
When these issues are fixed in the backend, the corresponding workarounds can be removed.

---

## 1. Incorrect Response Types for Pool/Resource APIs

**Status**: Active workaround in `transforms.ts`

The OpenAPI spec types some endpoints as returning `string` when they actually return JSON objects.

**Workaround**: Cast responses to `unknown` then to the expected type.

---

## 2. ResourceUsage Fields Are Strings Instead of Numbers

**Status**: Active workaround in `transforms.ts`

Quota and usage values are returned as strings (e.g., `"100"`) instead of numbers.

**Workaround**: Parse all numeric fields with `parseNumber()`.

---

## 3. (Reserved for future use)

---

## 4. Version Endpoint Returns Unknown Type

**Status**: Active workaround in `transforms.ts`

The `/api/version` endpoint has no typed response in the OpenAPI spec.

**Workaround**: Manually type the response in `transformVersionResponse()`.

---

## 5. Resource Fields Use Untyped Dictionaries

**Status**: Active workaround in `transforms.ts`

`allocatable_fields` and `usage_fields` are typed as `{ [key: string]: unknown }` instead of having proper field types for gpu, cpu, memory, storage.

**Workaround**: Use `getFieldValue()` helper to safely extract values.

---

## 6. Memory and Storage Values Need Unit Conversion

**Status**: Active workaround in `transforms.ts`

- Memory values are in KiB (need conversion to GiB)
- Storage values are in bytes (need conversion to GiB)

**Workaround**: Apply `kibToGiB()` and `bytesToGiB()` conversions in `extractCapacity()`.

---

## 7. pool_platform_labels Filtered by Query Parameters

**Status**: Active workaround in `hooks.ts` (`useResourceInfo`)

When querying `/api/resources` with specific pools (e.g., `pools=isaac-hil`), the `pool_platform_labels` field only contains memberships for the queried pools, not ALL pools the resource belongs to.

**Example**:
- Node `a1u1g-rome-0105` belongs to pools: `isaac-hil`, `isaac-nightly`
- Query with `pools=isaac-hil` returns: `{"isaac-hil": ["x86-l20"]}`
- Query with `all_pools=true` returns: `{"isaac-hil": ["x86-l20"], "isaac-nightly": ["x86-l20"]}`

**Workaround**: `useResourceInfo()` hook queries with `all_pools=true` and caches result for 5 minutes.

**Note**: Do NOT use `concise=true` with `all_pools=true` - it returns aggregated pool statistics instead of individual resource entries.

---

## 8. Resources API `concise` Parameter Changes Response Structure

**Status**: Documented, no workaround needed (just don't use it)

When `concise=true` is passed to `/api/resources`, the response structure changes from:
```json
{ "resources": [...] }
```
to:
```json
{ "pools": [...] }  // aggregated statistics, not individual resources
```

This is unexpected and undocumented behavior.

**Workaround**: Don't use `concise=true` when you need individual resource data.
