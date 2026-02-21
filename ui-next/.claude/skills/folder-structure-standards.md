# Folder Structure Standards — ui-next

Synthesized from:
- [Next.js official project structure](https://nextjs.org/docs/app/getting-started/project-structure)
- [Bulletproof React project structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
- [Shipixen Next.js best practices](https://shipixen.com/blog/nextjs-file-naming-best-practices)

---

## 1. Core Principle: Proximity = Ownership

> "A file should live as close as possible to the code that uses it."
> — Next.js official colocation docs

This single principle resolves almost every structural question.

### The Ownership Hierarchy

```
src/app/(dashboard)/[feature]/   ← owns feature-specific code
src/components/[component]/      ← owns component-internal code
src/hooks/                       ← owns truly shared hooks (2+ unrelated callers)
src/lib/                         ← owns truly shared utilities
src/stores/                      ← owns global state
```

A file belongs at the MOST SPECIFIC level where it is used.

---

## 2. Decision Framework: Where Does a File Belong?

Apply this decision tree for every hook, utility, or component:

```
1. Is it used by exactly ONE feature route?
   └─ YES → colocate inside that feature: src/app/(dashboard)/[feature]/
   └─ NO  → continue ↓

2. Is it used exclusively by ONE shared component (in src/components/[component]/)?
   └─ YES → colocate inside that component folder
   └─ NO  → continue ↓

3. Is it used by 2+ unrelated callers?
   └─ YES → it belongs in the global directory (src/hooks/, src/lib/, etc.)
```

**"Unrelated callers"** means callers from different features OR different component trees.
If two callers are both in `src/components/panel/`, they count as ONE unit of ownership.

---

## 3. Feature Route Colocation (Next.js App Router pattern)

Feature-specific implementation files live flat inside the feature directory:

```
src/app/(dashboard)/pools/
├── page.tsx                    ← Next.js route (required)
├── layout.tsx                  ← Next.js route (optional)
├── error.tsx                   ← Next.js route (optional)
├── pools-page-content.tsx      ← ✅ feature implementation, colocated
├── pools-page-skeleton.tsx     ← ✅ feature implementation, colocated
├── pools-with-data.tsx         ← ✅ feature implementation, colocated
└── use-pools-data.ts           ← ✅ feature-specific hook, colocated
```

**Rule**: If a hook or component is only imported by files in this feature directory, it belongs here — not in `src/hooks/` or `src/components/`.

**Sub-folders within a feature** are appropriate only when the feature has 8+ non-route files:
```
src/app/(dashboard)/workflows/
├── page.tsx
├── _components/                ← use _ prefix if sub-organizing
│   ├── workflow-table.tsx
│   └── workflow-filters.tsx
└── _hooks/
    └── use-workflow-filters.ts
```

For small features (under 8 non-route files): keep flat.

---

## 4. Component-Internal Colocation

A shared component in `src/components/[name]/` may own its own hooks, types, and utilities:

```
src/components/panel/
├── resizable-panel.tsx
├── side-panel.tsx
├── panel-header.tsx
├── use-resizable-panel.ts      ← ✅ panel-only hook, colocated here
├── hotkeys.ts                  ← ✅ panel-only constants, colocated here
└── types.ts                    ← ✅ panel-only types, colocated here
```

**This is the preferred pattern** over putting component-scoped hooks in `src/hooks/`.

Signals that a hook belongs in its component folder rather than `src/hooks/`:
- Its name contains the component name (e.g., `use-panel-lifecycle`, `use-resizable-panel`)
- All its importers are inside `src/components/[same-component]/`
- It would make no sense outside that component

---

## 5. Global Shared Directories — Strict Admission Criteria

### `src/hooks/` — Shared Utility Hooks
Only hooks that are:
- Generic abstractions (e.g., `use-copy`, `use-mounted`, `use-tick`, `use-intersection-observer`)
- Used by 2+ unrelated parts of the codebase
- Have no implicit coupling to a specific feature or component

Hooks that do NOT belong in `src/hooks/`:
- Anything named after a feature: `use-pools-*`, `use-workflow-*`
- Anything named after a component: `use-panel-*`, `use-refresh-*`

### `src/components/` — Shared UI Components
Only components that are:
- Used by 2+ distinct feature routes OR
- True generic abstractions (DataTable, Panel, FilterBar, ErrorBoundary)

Components that do NOT belong in `src/components/`:
- Components only rendered by one feature's page

### `src/lib/` — Shared Utilities
Pure functions used across multiple features. Sub-folders for complex subsystems (`api/`, `auth/`, `hotkeys/`, `navigation/`).

### `src/stores/` — Global State
Only truly global state. Feature-specific store slices should be colocated with the feature.

---

## 6. Route Groups and Private Folders

### Route groups `(group)` — organize without URL impact
All dashboard routes correctly live in `(dashboard)`. Add new groups when sections need:
- A distinct root layout
- Separate auth/middleware behavior
- A logical namespace

### Private folders `_name` — opt out of routing
Use within `src/app/` when a sub-folder inside a route segment should NOT be treated as a route:
```
src/app/(dashboard)/workflows/_components/   ← non-routable
src/app/(dashboard)/workflows/_hooks/        ← non-routable
```
Plain files colocated directly in the feature folder are also fine (Next.js only routes `page.tsx`/`route.ts`).

---

## 7. Reasoning Checklist Before Moving a File

Before deciding to move `src/hooks/use-X.ts`:

1. **Find all importers**: `grep -r "use-X" src/ --include="*.ts" --include="*.tsx"`
2. **Map callers to features**: Are all callers in the same feature? Same component?
3. **Check the name**: Does the name reveal component/feature ownership?
4. **Assess the move target**: Is the target directory well-established?
5. **Count impact**: How many import paths need updating?
6. **Run type-check after**: Verify zero broken imports

**Only move if steps 1-3 clearly point to a more specific owner.**
When in doubt, leave in the global directory. False positives (wrongly keeping global) are safer than false negatives (breaking colocation that exists for a reason).

---

## 8. Move Procedure

When moving a file from `src/hooks/` to `src/components/panel/`:

1. Read the source file
2. Write it to the new path (same content)
3. Find all files importing from the old path
4. Update each importer to use the new `@/` path
5. Delete the old file
6. Run `pnpm type-check && pnpm lint`
7. Fix any remaining broken imports

All imports use absolute `@/` paths (no relative imports allowed), which makes this safe to automate.

---

## 9. Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Feature hook in `src/hooks/` only used by one feature | Breaks proximity principle | Move to feature directory |
| Component hook in `src/hooks/` only used by one component folder | Breaks proximity principle | Move to component folder |
| Everything flat in `src/hooks/` regardless of ownership | Hides ownership signals | Apply decision framework |
| Sub-folders in features with <8 files | Premature organization | Keep flat |
| `src/components/` contains single-feature-only components | Wrong abstraction level | Move to feature directory |
