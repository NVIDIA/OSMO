# File Rename Standards — ui-next

Conventions synthesized from:
- [Next.js official project structure docs](https://nextjs.org/docs/app/getting-started/project-structure)
- [Bulletproof React project structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
- [Shipixen Next.js file naming best practices](https://shipixen.com/blog/nextjs-file-naming-best-practices)
- Actual established codebase convention (observed from existing files)

---

## 1. File Naming — The Single Rule

**All source files use `kebab-case`.**

This applies to: component files, hook files, utility files, store files, type files, lib files.

```
✅ boolean-indicator.tsx
✅ use-copy.ts
✅ format-date.ts
✅ create-table-store.ts
✅ pools-page-content.tsx

❌ BooleanIndicator.tsx   → boolean-indicator.tsx
❌ useCopy.ts             → use-copy.ts
❌ formatDate.ts          → format-date.ts
❌ CreateTableStore.ts    → create-table-store.ts
```

---

## 2. Exceptions (never rename these)

### Next.js reserved route files
These are lowercase by Next.js convention — correct as-is:
```
page.tsx, layout.tsx, error.tsx, loading.tsx, not-found.tsx,
template.tsx, default.tsx, route.ts, global-error.tsx
```

### External library
```
src/components/shadcn/**   — intentionally kebab-case (shadcn/ui convention)
```

### Auto-generated files
```
src/lib/api/generated.ts   — never touch
```

### Config files at project root
```
next.config.ts, tailwind.config.ts, postcss.config.*, eslint.config.*, tsconfig.json
```

### Test and mock files
```
*.test.ts, *.test.tsx, *.spec.ts, *.spec.tsx
src/mocks/**
```

### Idiomatic single-word names
These common filenames are already conventional and need no renaming:
```
config.ts, utils.ts, types.ts, logger.ts, query-client.ts
```

---

## 3. Exports Are PascalCase — Files Are Not

The file name is kebab-case; the exported symbol follows JavaScript conventions:

```typescript
// File: boolean-indicator.tsx
export function BooleanIndicator() { ... }          // component → PascalCase export

// File: use-copy.ts
export function useCopy() { ... }                    // hook → camelCase export

// File: format-date.ts
export function formatDateTimeFull() { ... }         // util → camelCase export

// File: create-table-store.ts
export function createTableStore() { ... }           // store factory → camelCase export
```

---

## 4. Hook File Naming

Hook files MUST use `use-` prefix in kebab-case:

```
✅ use-copy.ts
✅ use-panel-state.ts
✅ use-mounted.ts
✅ use-hydrated-store.ts

❌ copy-hook.ts
❌ panelState.ts
```

---

## 5. Rename Procedure

When renaming a file:
1. Identify the old path and new kebab-case path
2. Read the file at the old path
3. Write it to the new kebab-case path (same content)
4. Find all files that import from the old path (Grep for the old path without extension)
5. Update every importing file to use the new path
6. Delete the old file
7. Run `pnpm type-check && pnpm lint` to verify no broken imports

**Critical**: Never rename without updating ALL imports. A broken import = a type-check failure.

---

## 6. Priority Order

| Priority | Violation | Action |
|----------|-----------|--------|
| HIGH | Component file uses PascalCase | Rename + update all imports |
| MEDIUM | Utility/lib/store file uses camelCase | Rename + update all imports |
| SKIP | Next.js reserved file | Never touch |
| SKIP | `src/components/shadcn/` | Never touch |
| SKIP | Generated files | Never touch |
