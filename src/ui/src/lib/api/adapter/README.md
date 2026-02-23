# Backend Adapter Layer

This module transforms backend responses that the UI cannot use directly.

## Philosophy

**Transform only what needs transforming.**

- If backend returns something correctly → use it directly from `generated.ts`
- If backend returns something broken → transform it here

The adapter decouples UI from backend quirks, allowing UI development with a "perfect" backend in mind. But it should NOT hide things that are already correct.

## What Gets Transformed (adapter)

| Issue | Transform |
|-------|-----------|
| Numeric values as strings | Parse to numbers |
| Missing fields | Provide defaults |
| Untyped dictionaries | Extract typed values |
| Unit conversions (KiB→GiB) | Convert units |
| Response typed as `unknown` | Cast to actual type |

## What Gets Used Directly (generated.ts)

| Thing | Why Direct |
|-------|------------|
| `PoolStatus` enum | Values are correct |
| `BackendResourceType` enum | Values are correct |
| Error types (`HTTPValidationError`) | Shape is correct |

## Usage

```typescript
// Enums - use directly from generated
import { PoolStatus, BackendResourceType } from "@/lib/api/generated";

// Transformed types and hooks - use from adapter
import { usePools, type Pool, type Resource } from "@/lib/api/adapter";
```

## When Backend is Fixed

As backend fixes are applied:

1. Run `pnpm generate-api` to update generated types
2. Remove the corresponding transform from `transforms.ts`
3. Eventually, this directory shrinks as backend improves

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Transformed type shapes (post-transform) |
| `transforms.ts` | Functions to convert backend → clean types |
| `hooks.ts` | React Query hooks with automatic transformation |
| `BACKEND_TODOS.md` | Documents backend issues and workarounds |
