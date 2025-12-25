# DRY Violations & Over-Engineering Audit

**Generated:** December 25, 2025  
**Status:** ✅ All immediate and short-term fixes completed

This document identifies code duplication, DRY violations, and over-engineering opportunities in the `ui-next` codebase, along with recommendations for SOTA open-source library replacements.

---

## Executive Summary

| Category | Issues Found | Fixed | Remaining |
|----------|--------------|-------|-----------|
| **Code Duplication** | 5 patterns | ✅ 5 | 0 |
| **Over-Engineering** | 3 areas | N/A | 0 (all appropriate) |
| **Library Opportunities** | 2 candidates | N/A | Consider later |

---

## 1. Code Duplication (DRY Violations)

### 1.1 `isBackendResourceType` Type Guard (DUPLICATE)

**Files:**
- `src/headless/use-pool-detail.ts` (line 76)
- `src/headless/use-resources.ts` (line 118)

**Current Code (identical in both files):**
```typescript
function isBackendResourceType(value: string): value is BackendResourceType {
  return (ALL_RESOURCE_TYPES as readonly string[]).includes(value);
}
```

**Recommendation:** Extract to `src/lib/constants/ui.ts` next to `ALL_RESOURCE_TYPES`:
```typescript
// In src/lib/constants/ui.ts
export function isBackendResourceType(value: string): value is BackendResourceType {
  return (ALL_RESOURCE_TYPES as readonly string[]).includes(value);
}
```

**Effort:** Low (5 min)

---

### 1.2 Set Toggle Pattern (DUPLICATE)

**Files:**
- `src/headless/use-pool-detail.ts` (lines 136-145, 153-161)
- `src/headless/use-pools-list.ts` (similar pattern)

**Current Code:**
```typescript
const togglePlatform = useCallback((platform: string) => {
  setSelectedPlatforms((prev) => {
    const next = new Set(prev);
    if (next.has(platform)) {
      next.delete(platform);
    } else {
      next.add(platform);
    }
    return next;
  });
}, []);
```

**Note:** `src/lib/filters/use-set-filter.ts` already provides this exact pattern!

**Recommendation:** Refactor `use-pool-detail.ts` to use `useSetFilter`:
```typescript
// Before (35+ lines)
const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
const togglePlatform = useCallback(...);
const clearPlatformFilter = useCallback(...);

// After (3 lines)
const platformFilter = useSetFilter<string>();
// Use: platformFilter.selected, platformFilter.toggle, platformFilter.clear
```

**Effort:** Medium (30 min) - Requires updating return interface

---

### 1.3 Search Filtering Logic (DUPLICATE)

**Files:**
- `src/headless/use-pool-detail.ts` (lines 122-130)
- `src/lib/api/adapter/pagination.ts` (lines 161-167)
- `src/headless/use-pools-list.ts` (lines 100-103)

**Pattern:** `toLowerCase().includes(query)` search filtering

**Current Code (use-pool-detail.ts):**
```typescript
if (search.trim()) {
  const query = search.toLowerCase();
  result = result.filter(
    (resource) =>
      resource.name.toLowerCase().includes(query) ||
      resource.platform.toLowerCase().includes(query) ||
      resource.resourceType.toLowerCase().includes(query),
  );
}
```

**Recommendation:** Create a generic search utility:
```typescript
// src/lib/utils.ts
export function matchesSearch<T>(
  item: T,
  query: string,
  fields: (keyof T)[]
): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  return fields.some(field => 
    String(item[field]).toLowerCase().includes(q)
  );
}
```

**Effort:** Low (15 min)

---

### 1.4 Resource Types Derivation (DUPLICATE)

**Files:**
- `src/headless/use-pool-detail.ts` (lines 101-105)
- `src/headless/use-resources.ts` (lines 253-257)

**Identical Code:**
```typescript
const resourceTypes = useMemo(() => {
  const types = new Set<BackendResourceType>();
  resources.forEach((resource) => types.add(resource.resourceType));
  return ALL_RESOURCE_TYPES.filter((t) => types.has(t));
}, [resources]);
```

**Recommendation:** Extract to a utility function:
```typescript
// src/lib/api/adapter/utils.ts
export function deriveResourceTypes(resources: Resource[]): BackendResourceType[] {
  const types = new Set<BackendResourceType>();
  resources.forEach((r) => types.add(r.resourceType));
  return ALL_RESOURCE_TYPES.filter((t) => types.has(t));
}
```

**Effort:** Low (10 min)

---

### 1.5 Active Filters Building (NEAR-DUPLICATE)

**Files:**
- `src/headless/use-pool-detail.ts` (lines 172-215) - Manual implementation
- `src/headless/use-resources.ts` (lines 263-294) - Uses `useActiveFilters`

**Issue:** `use-pool-detail.ts` manually builds active filters instead of using the existing `useActiveFilters` hook.

**Recommendation:** Refactor `use-pool-detail.ts` to use `useActiveFilters` like `use-resources.ts` does.

**Effort:** Medium (20 min)

---

## 2. Over-Engineering Analysis

### 2.1 Custom Filter System vs URL State

**Current State:**
- 3 custom filter hooks: `useSetFilter`, `useDeferredSearch`, `useActiveFilters`
- Filter state is ephemeral (lost on page refresh)
- ~300 lines of custom code

**SOTA Alternative:** [nuqs](https://nuqs.47ng.com/) - Type-safe URL search params for Next.js

**Benefits:**
- Filter state persists in URL (shareable, bookmarkable)
- Built-in serialization for Sets, arrays, numbers
- Next.js App Router native support
- ~10 lines to replace each filter

**Example Migration:**
```typescript
// Before (custom hooks)
const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
const togglePlatform = useCallback(...);

// After (nuqs)
import { parseAsArrayOf, parseAsString, useQueryStates } from 'nuqs';

const [filters, setFilters] = useQueryStates({
  platforms: parseAsArrayOf(parseAsString).withDefault([]),
  search: parseAsString.withDefault(''),
});
```

**Recommendation:** 
- **Keep current system** for now (it works, URL state is a feature change)
- **Consider nuqs** if URL-persisted filters become a requirement

**Effort:** High (2-3 hours for full migration)

---

### 2.2 Headless Hooks Layer

**Current State:**
- `src/headless/` contains 5 hooks
- Abstraction between API and components
- Well-documented, provides clean interfaces

**Assessment:** **NOT over-engineered** ✅

The headless layer provides genuine value:
- Decouples data fetching from presentation
- Enables consistent behavior across themed components
- Makes testing easier

**Recommendation:** Keep as-is.

---

### 2.3 Adapter/Transform Layer

**Current State:**
- `src/lib/api/adapter/` contains transforms, hooks, pagination
- Converts backend types to "ideal" frontend types
- ~500 lines of transform code

**Assessment:** **Appropriate engineering** ✅

This layer exists because:
- Backend API returns strings where numbers are expected
- Backend field names differ from frontend conventions
- Backend pagination/filtering is incomplete

**Recommendation:** Keep until backend API improves (see BACKEND_TODOS.md).

---

## 3. Library Replacement Opportunities

### 3.1 SSR Guard Pattern

**Current State:** 19 occurrences of `typeof window === "undefined"` / `!== "undefined"`

**No library needed** - This is idiomatic Next.js. The pattern is:
- Centralized in storage hooks (`use-persisted-state.ts`, `use-display-mode.ts`, `token-storage.ts`)
- Remaining occurrences are in auth/mock code

**Recommendation:** No action needed.

---

### 3.2 Copy to Clipboard

**Current State:** 2 occurrences of `navigator.clipboard.writeText()`
- `src/components/shared/error-details.tsx`
- `src/lib/auth/auth-local-dev.tsx`

**SOTA Alternative:** None needed - native API is fine for 2 usages.

**If it grows:** Consider [usehooks-ts's useCopyToClipboard](https://usehooks-ts.com/react-hook/use-copy-to-clipboard)

**Recommendation:** No action needed.

---

## 4. Tailwind Class Duplication

### 4.1 Zinc Color Palette

**Current State:** 
- 222 occurrences of `text-zinc-500` or `text-zinc-400`
- 160 occurrences of `dark:bg-zinc-*` patterns

**Assessment:** This is normal Tailwind usage, not duplication.

**Recommendation:** 
- Already have `src/lib/styles.ts` with reusable patterns
- Consider expanding `styles.ts` if specific combinations repeat frequently

---

## 5. Action Plan

### Immediate (< 1 hour total) — ✅ COMPLETED

| Task | Status | Impact |
|------|--------|--------|
| Extract `isBackendResourceType` to ui.ts | ✅ Done | Removed 2 duplicates |
| Extract `deriveResourceTypes` utility | ✅ Done | Removed 2 duplicates |
| Create `matchesSearch` utility | ✅ Done | Standardized 3 search patterns |

### Short-term (1-2 hours) — ✅ COMPLETED

| Task | Status | Impact |
|------|--------|--------|
| Refactor `use-pool-detail.ts` to use `useSetFilter` | ✅ Done | Removed ~50 lines |
| Refactor `use-pool-detail.ts` to use `useActiveFilters` | ✅ Done | Removed ~40 lines |

### Consider Later

| Task | Effort | Impact |
|------|--------|--------|
| Migrate filters to nuqs (URL state) | 3 hours | Feature enhancement (shareable URLs) |

---

## 6. Summary

### What Was Fixed

1. ✅ **Extracted `isBackendResourceType`** to `lib/constants/ui.ts` — single source of truth
2. ✅ **Extracted `deriveResourceTypes`** to `lib/api/adapter/utils.ts` — reusable utility
3. ✅ **Created `matchesSearch`** in `lib/utils.ts` — standardized search filtering
4. ✅ **Refactored `use-pool-detail.ts`** to use `useSetFilter` and `useActiveFilters`

### Code Reduction

| File | Before | After | Saved |
|------|--------|-------|-------|
| `use-pool-detail.ts` | 279 lines | 208 lines | **71 lines (25%)** |
| `use-resources.ts` | ~340 lines | ~330 lines | ~10 lines |
| Total duplicated code removed | — | — | **~80 lines** |

### Files Created/Modified

**New files:**
- `src/lib/api/adapter/utils.ts` — `deriveResourceTypes` utility

**Modified files:**
- `src/lib/constants/ui.ts` — added `isBackendResourceType`
- `src/lib/utils.ts` — added `matchesSearch`
- `src/lib/api/adapter/pagination.ts` — uses `matchesSearch`
- `src/headless/use-pool-detail.ts` — uses shared filter hooks
- `src/headless/use-resources.ts` — uses shared utilities

### Remaining Considerations

- **URL-persisted filter state** — Consider [nuqs](https://nuqs.47ng.com/) if shareable filter URLs become a requirement

There is **no significant over-engineering** — the adapter layer, headless hooks, and filter system all provide genuine value.
