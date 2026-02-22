# Folder Structure Standards — ui-next

Synthesized from:
- [Bulletproof React project structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
- [Next.js App Router project structure](https://nextjs.org/docs/app/getting-started/project-structure)

---

## Quick Reference — Ownership Decisions

**One rule:** `app/` = routing only. Everything else → `features/` (single-feature) or `shared/` (2+ features).

| Source path | Where it belongs |
|---|---|
| `app/(dashboard)/[route]/page.tsx` etc. | Stay in `app/` — routing file |
| `app/(dashboard)/[route]/anything-else` | `features/[route]/[subdir]/` |
| `app/(dashboard)/[route]/[name]/...` | `features/[route]/detail/[subdir]/` (workflows, datasets) |
| `components/[name]/` used by 1 feature | `features/[that-feature]/components/[name]/` |
| `components/[name]/` used by 2+ features | Stay in `components/` |
| `hooks/use-*.ts` used by 1 feature | `features/[that-feature]/hooks/` |
| `hooks/use-*.ts` used by 2+ features | Stay in `hooks/` |

**File type → subdir within a feature:**
| Pattern | Subdir |
|---|---|
| `use-*.ts` | `hooks/` |
| `*-store.ts` | `stores/` |
| `*.tsx` | `components/` |
| `actions.ts`, other `.ts` | `lib/` |

---

## 1. Core Principle: Routing vs. Business Logic Are Separate

> "`app/` is a routing shell. `features/` is where the product lives."

The single structural rule: **`app/(dashboard)/[route]/` contains only Next.js routing files. All feature code lives in `src/features/`.**

This is the **Bulletproof React + Next.js App Router hybrid**:
- `app/` handles routing, layouts, metadata, Server Component boundaries
- `features/` owns components, hooks, stores, and lib for each product domain
- `components/`, `hooks/`, `lib/`, `stores/` hold code shared by 2+ features

---

## 2. Target Directory Structure

```
src/
├── app/                           # Routing ONLY — Next.js reserved files
│   └── (dashboard)/
│       ├── layout.tsx             # Dashboard shell
│       ├── page.tsx               # Root redirect / home
│       ├── error.tsx
│       ├── loading.tsx
│       ├── pools/
│       │   ├── page.tsx           # import PoolsPageContent from "@/features/pools/components/pools-page-content"
│       │   ├── error.tsx
│       │   └── loading.tsx
│       ├── workflows/
│       │   ├── page.tsx
│       │   └── [name]/
│       │       ├── page.tsx
│       │       └── error.tsx
│       ├── datasets/
│       │   ├── page.tsx
│       │   └── [bucket]/
│       │       └── [name]/
│       │           └── page.tsx
│       ├── resources/
│       │   └── page.tsx
│       ├── log-viewer/
│       │   └── page.tsx
│       └── profile/
│           └── page.tsx
│
├── features/                      # Feature business logic
│   ├── pools/
│   │   ├── components/            # Pools-only UI components
│   │   ├── hooks/                 # Pools-only hooks
│   │   ├── stores/                # Pools-only state
│   │   └── lib/                   # Pools column defs, constants, helpers
│   ├── workflows/
│   │   ├── list/                  # Workflow list sub-feature
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── stores/
│   │   ├── detail/                # Workflow detail sub-feature
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── stores/
│   │   └── lib/                   # Shared within workflows
│   ├── datasets/
│   │   ├── list/
│   │   ├── detail/
│   │   └── lib/
│   ├── resources/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── stores/
│   │   └── lib/
│   ├── log-viewer/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── lib/
│   └── profile/
│       └── components/
│
├── components/                    # Shared UI (used by 2+ features)
│   ├── shadcn/                    # DO NOT TOUCH — shadcn primitives
│   ├── data-table/
│   ├── panel/
│   ├── filter-bar/
│   ├── event-viewer/
│   ├── code-viewer/
│   ├── chrome/                    # Navigation shell
│   ├── shell/                     # App shell
│   ├── error/                     # Shared error boundary
│   ├── refresh/
│   └── [primitives]/              # boolean-indicator, progress-bar, etc.
│
├── hooks/                         # Shared hooks (used by 2+ unrelated features)
├── lib/                           # Shared utilities, API layer, auth, config
├── stores/                        # Truly global state (shared-preferences-store)
├── contexts/                      # React contexts
├── styles/                        # Global CSS
├── mocks/                         # MSW mock handlers (dev only)
└── test-utils/                    # Vitest test helpers
```

**Why keep `(dashboard)` route group?**
Routes outside the dashboard (e.g., `app/login/`, `app/(public)/`) use a different layout. The route group ensures the dashboard shell layout applies only to dashboard routes without affecting the URL path.

---

## 3. Dependency Flow (Unidirectional)

```
shared (components/, hooks/, lib/, stores/)
    ↑
features/[feature]/
    ↑
app/(dashboard)/[route]/page.tsx
```

- `app/` imports from `features/` and `shared/`
- `features/[A]/` **NEVER** imports from `features/[B]/` — cross-feature coupling is forbidden
- `features/` imports from `shared/`
- `shared/` imports only from other `shared/` directories

---

## 4. Page Files Are Thin Wrappers

Every `app/(dashboard)/[route]/page.tsx` is a one-line import + render. Nothing else.

```tsx
// app/(dashboard)/pools/page.tsx ✅ CORRECT
import { PoolsPageContent } from "@/features/pools/components/pools-page-content";
export default function PoolsPage() {
  return <PoolsPageContent />;
}
```

```tsx
// app/(dashboard)/pools/page.tsx ❌ WRONG — contains feature logic
import { useState } from "react";
export default function PoolsPage() {
  const [filter, setFilter] = useState("");
  return <div>...</div>;
}
```

If a page does more than import + render, the business logic belongs in `features/`.

---

## 5. Admission Criteria Per Directory

| Directory | Admits | Refuses |
|-----------|--------|---------|
| `app/(dashboard)/[route]/` | `page.tsx`, `layout.tsx`, `error.tsx`, `loading.tsx`, `not-found.tsx`, `route.ts`, `default.tsx` | **Any** component, hook, store, lib file |
| `features/[f]/components/` | Components used only by feature `f` | Components used by 2+ features → `components/` |
| `features/[f]/hooks/` | Hooks used only by feature `f` | Hooks used by 2+ features → `hooks/` |
| `features/[f]/stores/` | State scoped to feature `f` | Truly global state (preferences, shell) → `stores/` |
| `features/[f]/lib/` | Column defs, search fields, constants, helpers for feature `f` | Pure generic utilities → `lib/` |
| `components/` | Shared UI abstractions used by 2+ features | Single-feature components → `features/[f]/components/` |
| `hooks/` | Generic hooks with no feature coupling, used by 2+ features | Feature-coupled hooks → `features/[f]/hooks/` |
| `lib/` | Pure utilities, API layer, auth, config, formatters | Feature-specific logic |
| `stores/` | Cross-feature global state (preferences, shell state) | Feature-specific state → `features/[f]/stores/` |

---

## 6. Decision Framework: Where Does a File Belong?

Apply this decision tree for every hook, component, store, or utility:

```
1. Does this file contain Next.js routing metadata (page, layout, error, loading)?
   └─ YES → it belongs in app/(dashboard)/[route]/ ONLY
   └─ NO  → continue ↓

2. Is it used exclusively by ONE feature?
   └─ YES → it belongs in features/[feature]/[components|hooks|stores|lib]/
   └─ NO  → continue ↓

3. Is it used by 2+ unrelated features?
   └─ YES → it belongs in the shared directory (components/, hooks/, lib/, stores/)
   └─ NO  → investigate — it may be dead code or a utility for a specific component
```

**"One feature" definition**: all callers live under `features/[same-feature]/` or `app/(dashboard)/[same-route]/`.

---

## 7. Complex Features: Sub-Feature Directories

Features with **two distinct routes** (list + detail) use sub-feature directories:

```
features/workflows/
├── list/           ← all code for /workflows (list view)
│   ├── components/
│   ├── hooks/
│   └── stores/
├── detail/         ← all code for /workflows/[name] (detail view)
│   ├── components/
│   ├── hooks/
│   └── stores/
└── lib/            ← shared within workflows (column defs, types, helpers)
```

Features with **one route** stay flat (no list/detail split):

```
features/pools/
├── components/
├── hooks/
├── stores/
└── lib/
```

Apply sub-feature split to: **workflows** (`list/`, `detail/`) and **datasets** (`list/`, `detail/`).
Keep flat for: **pools**, **resources**, **log-viewer**, **profile**.

---

## 8. Special Cases

### `components/dag/`
DAG visualization is currently in `components/` but used only by the workflows feature. It should move to `features/workflows/`. Flag this as a violation.

### `components/log-viewer/`
Log viewer is currently in `components/` but used only by the log-viewer feature. It should move to `features/log-viewer/`. Flag this as a violation.

### `components/shadcn/`
**DO NOT TOUCH.** These are shadcn/ui primitives — external library, left as-is.

### `components/data-table/`
Used by pools, workflows, datasets, and resources — correctly stays in `components/`.

### `components/panel/`
Used by pools, workflows, and datasets — correctly stays in `components/`.

---

## 9. Move Procedure

**Golden rule: ONE step, directly to `features/`.**
Files move from their current location (`app/(dashboard)/[route]/`, `hooks/`, `components/`, or elsewhere) in a single operation to `features/[feature]/[subdir]/`. Never stage through `app/(dashboard)/[route]/` as an intermediate stop.

When moving a file to `features/pools/components/` (source may be `app/(dashboard)/pools/`, `hooks/`, `components/`, etc.):

1. Read the source file
2. Write it to the new `features/` path (same content, verbatim)
3. Grep all files importing from the old path
4. Update each importer to use the new `@/features/...` path
5. Delete the old file with `rm`
6. Run `pnpm type-check && pnpm lint`
7. Fix any remaining broken imports

All imports use absolute `@/` paths — this makes moves safe to automate.

---

## 10. Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Feature component or hook in `app/(dashboard)/[route]/` | Couples business logic to routing layer | Move to `features/[f]/components/` or `features/[f]/hooks/` |
| Feature logic in `page.tsx` beyond import + render | Business logic leaks into routing | Extract to `features/[f]/components/[feature]-page-content.tsx` |
| Cross-feature import: `features/A` imports from `features/B` | Tight coupling; breaks feature isolation | Move shared code to `components/` or `lib/` |
| Single-feature component in `components/` | Wrong abstraction level | Move to `features/[f]/components/` |
| Feature hook in `hooks/` only used by one feature | Feature logic leaks into shared layer | Move to `features/[f]/hooks/` |
| `components/dag/` or `components/log-viewer/` for single-feature use | Not actually shared | Move to the owning feature |
| Sub-feature split (`list/`, `detail/`) on simple single-route features | Premature organization | Keep flat for pools, resources, profile |
| Moving files into `app/(dashboard)/[route]/` as an intermediate step | Creates violations that need a second pass | Move directly to `features/[f]/[subdir]/` in one step |
