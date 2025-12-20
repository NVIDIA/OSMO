# Backend Adapter Layer

This module acts as an **anti-corruption layer** between the UI and the current backend API.

## Purpose

The UI is written assuming a "perfect" backend with ideal types and APIs. This adapter layer:

1. **Defines ideal types** (`types.ts`) - What the UI wants
2. **Transforms data** (`transforms.ts`) - Converts backend responses to ideal types
3. **Exposes clean hooks** (`hooks.ts`) - Ready-to-use hooks for UI components

## Why This Exists

The backend API has some quirks (documented in `backend_todo.md`):
- Response types incorrectly typed as `string` in OpenAPI
- Numeric values returned as strings
- Untyped dictionary fields
- Missing response models

Rather than spreading workarounds throughout the UI, they're quarantined here.

## How to Use

**In UI components:**
```typescript
// ✅ Use adapter hooks - clean, ideal types
import { usePools, usePoolDetail } from "@/lib/api/adapter/hooks";

// ❌ Don't use generated hooks directly
import { useGetPoolQuotasApiPoolQuotaGet } from "@/lib/api/generated";
```

## When Backend is Fixed

As backend fixes are applied:

1. Run `pnpm generate-api` to update generated types
2. Remove the corresponding transform/shim from this adapter
3. Eventually, this entire directory can be deleted when backend is "perfect"

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Ideal types the UI expects |
| `transforms.ts` | Functions to convert backend → ideal types |
| `hooks.ts` | React Query hooks with automatic transformation |
| `README.md` | This file |
