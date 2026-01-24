# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Daily Workflow
```bash
pnpm dev                    # Start dev server (default backend from .env.local)
pnpm dev:local              # Dev server → localhost:8000
pnpm dev:mock               # Dev with mock data (no backend needed!)
```

### Code Quality
```bash
pnpm lint                   # ESLint (includes React Compiler checks)
pnpm type-check             # TypeScript check
pnpm format                 # Prettier format

# Before commit
pnpm type-check && pnpm lint && pnpm test && pnpm build
```

### Testing
```bash
# Unit tests (Vitest)
pnpm test                   # Run once
pnpm test:watch             # Watch mode
pnpm test -- transforms     # Filter by name

# E2E tests (Playwright)
pnpm test:e2e               # Headless
pnpm test:e2e:ui            # Interactive UI (best for debugging)
pnpm test:e2e -- auth       # Filter by file name

# Run all tests
pnpm test:all
```

### API Generation
```bash
pnpm generate-api           # Regenerate API client from backend OpenAPI spec
```

This runs from the parent directory (`external/`):
1. `bazel run //src/service:export_openapi` → exports `openapi.json`
2. `bazel run //src/service:export_status_metadata` → generates status metadata
3. `orval` → generates TypeScript client in `src/lib/api/generated.ts`

## Architecture Overview

### Layer Pattern

```
Page → Headless Hook → Adapter Hook → Generated API → Backend
            ↓
     Themed Components
```

**Critical concept**: The UI is designed for an **ideal backend** that doesn't fully exist yet. The adapter layer bridges the gap.

### Directory Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (dashboard)/        # Authenticated pages (pools, resources, workflows)
│   ├── auth/               # Auth API routes (handled by Envoy in production)
│   └── api/                # Proxy routes to backend
│
├── components/
│   ├── shadcn/             # shadcn/ui primitives (Button, Input, etc.)
│   ├── shell/              # Layout (Header, Sidebar)
│   ├── data-table/         # Reusable data table with virtualization
│   ├── filter-bar/         # SmartSearch component
│   ├── log-viewer/         # Terminal/log viewer (xterm.js)
│   └── dag/                # Workflow DAG visualization
│
├── lib/
│   ├── api/
│   │   ├── adapter/        # **THE CRITICAL LAYER** - transforms backend → ideal types
│   │   ├── generated.ts    # Auto-generated from OpenAPI (NEVER EDIT)
│   │   └── fetcher.ts      # Auth-aware fetch wrapper
│   ├── auth/               # Authentication logic (Envoy in prod, local dev mode)
│   ├── hooks/              # Shared React hooks
│   └── [utils...]          # Utility functions
│
├── mocks/                  # MSW mock handlers for hermetic dev mode
│   ├── generators/         # Deterministic data generators
│   └── seed/               # Mock configuration
│
└── stores/                 # Zustand stores (minimal global state)
```

### The Adapter Layer (Critical!)

Location: `src/lib/api/adapter/`

**Purpose**: Transforms backend responses that don't match UI expectations.

```typescript
// ❌ DON'T import generated types directly in pages/components
import { usePools } from '@/lib/api/generated';

// ✅ DO use adapter hooks
import { usePools } from '@/lib/api/adapter';
```

**Why it exists**: The backend has quirks (numeric fields as strings, missing pagination, etc.). The adapter transforms responses to what the UI expects. When backend is fixed, remove the transform.

**Key files**:
- `types.ts` - Clean types the UI expects
- `transforms.ts` - Transform functions (**all backend workarounds quarantined here**)
- `hooks.ts` - React Query hooks with automatic transformation
- `BACKEND_TODOS.md` - Documents 22 backend issues and workarounds

**Important**: When adding new API usage, add a transform in `adapter/transforms.ts` if needed, then export a hook from `adapter/hooks.ts`.

### Authentication

**Production**: Handled by Envoy sidecar. Next.js receives `x-osmo-user` header and `Authorization: Bearer <token>`.

**Local Development**: Use `pnpm dev` with `.env.local`:
```bash
NEXT_PUBLIC_OSMO_API_HOSTNAME=staging.example.com
AUTH_CLIENT_SECRET=your-keycloak-secret
```

Open http://localhost:3000 and follow the login prompt to transfer your session.

**See**: `src/lib/auth/README.md` for details.

### Feature Modules

Each feature (`pools`, `resources`, `workflows`) follows this structure:

```
app/(dashboard)/pools/
├── page.tsx                # Next.js page (composition only)
├── hooks/
│   └── use-pools-data.ts   # Business logic, filtering, state (no UI)
├── components/
│   └── pools-table.tsx     # Themed components (presentation only)
├── lib/
│   └── [feature utils]     # Feature-specific utilities
└── index.ts                # Public API exports
```

**Import rule**: Features should import from each other's `index.ts`, not internals. ESLint warns on deep imports.

```typescript
// ✅ Good
import { usePoolsData } from '@/app/(dashboard)/pools';

// ❌ Bad (couples modules too tightly)
import { usePoolsData } from '@/app/(dashboard)/pools/hooks/use-pools-data';
```

## Common Development Tasks

### Adding a New API Endpoint

1. Update backend API
2. Run `pnpm generate-api` to regenerate types
3. Add transform in `src/lib/api/adapter/transforms.ts` (if needed)
4. Add hook in `src/lib/api/adapter/hooks.ts`
5. Export from `src/lib/api/adapter/index.ts`
6. Use in your feature hook or component

### Adding a New Feature Page

1. Create `src/app/(dashboard)/your-feature/page.tsx`
2. Create `src/app/(dashboard)/your-feature/hooks/use-your-feature.ts`
3. Create `src/app/(dashboard)/your-feature/components/`
4. Export from `src/app/(dashboard)/your-feature/index.ts`

### Using Filters with SmartSearch

The `SmartSearch` component provides URL-synced filtering with auto-suggest:

```typescript
import { SmartSearch } from '@/components/filter-bar';

// Define search fields
const searchFields = [
  {
    key: 'pool',
    label: 'Pool',
    type: 'select' as const,
    values: pools.map(p => ({ value: p.name, label: p.name })),
  },
  {
    key: 'status',
    label: 'Status',
    type: 'select' as const,
    values: statusOptions,
  },
];

<SmartSearch
  searchFields={searchFields}
  onChipsChange={(chips) => {
    // Convert chips to filter params
  }}
/>
```

Filters are synced to URL via `nuqs`, making them shareable via link.

### Adding UI Components

```bash
npx shadcn@latest add dialog   # Add from shadcn/ui
```

Components are added to `src/components/shadcn/`. For custom components, add to `src/components/[feature]/`.

## Backend Integration Notes

### Critical: Backend Has Known Issues

See `src/lib/api/adapter/BACKEND_TODOS.md` for the complete list of 22 backend issues and workarounds.

**High-priority issues**:

1. **Resources API needs pagination** - Currently returns all resources at once. UI shims with client-side pagination. See BACKEND_TODOS.md #11.

2. **Workflow list `more_entries` always false** - Bug in backend pagination logic. UI infers `hasMore` from item count. See BACKEND_TODOS.md #14.

3. **Workflow list `order` parameter ignored** - Backend always fetches DESC then re-sorts. UI shows wrong sort order. See BACKEND_TODOS.md #17.

4. **Response types are wrong** - Several endpoints typed as `string` but return objects. UI casts to `unknown`. See BACKEND_TODOS.md #1.

5. **Shell resize corrupts input** - WebSocket resize messages corrupt PTY input buffer. Partial client-side filter doesn't fix root cause. See BACKEND_TODOS.md #22.

**When backend is fixed**: Run `pnpm generate-api`, remove corresponding transform, update BACKEND_TODOS.md.

### Production vs Development Behavior

| Feature | Development | Production |
|---------|-------------|------------|
| **Backend routing** | `next.config.ts` proxy to configured hostname | Same (runtime config) |
| **Login screen** | Shows cookie paste UI (`LocalDevLogin`) | SSO button only (Envoy handles auth) |
| **Auth client secret** | Uses `.env.local` | Uses environment variable |
| **Mock mode** | `pnpm dev:mock` for offline dev | N/A (not bundled) |

**Production-first design**: Dev features have zero impact on production builds. Dev components use `next/dynamic` for code splitting.

### Base Path for Deployment

This UI can be deployed at a subpath (e.g., `/v2`) alongside legacy UI:

```bash
NEXT_PUBLIC_BASE_PATH=/v2 pnpm build
```

All routes become `/v2/*`. API rewrites still forward to backend `/api/*` (no prefix).

## Testing Philosophy

### Unit Tests (Vitest)

**Only test high-value, low-brittleness areas:**
- `transforms.ts` - Backend data transformations (catches API changes)
- `utils.ts` - Pure functions (easy to test, unlikely to break)

**Don't test**: UI components, generated code, shadcn/ui primitives.

**Location**: `src/**/*.test.ts`

### E2E Tests (Playwright)

**Focus**: Verify user outcomes, not implementation details.

**Structure**:
```
e2e/
├── fixtures.ts             # Playwright test + withData/withAuth
├── journeys/               # User journey tests
│   ├── auth.spec.ts
│   ├── pools.spec.ts
│   └── resources.spec.ts
└── mocks/                  # Type-safe mock data factories
```

**Key principles**:
- Use semantic selectors (`getByRole`, `getByLabel`)
- Tests run offline (Playwright route mocking)
- Tests should survive virtualization, pagination, filter UI changes
- Co-locate mock data with assertions (not in separate fixtures)

**Example**:
```typescript
import { test, expect, createPoolResponse } from "../fixtures";

test("shows pool list", async ({ page, withData }) => {
  // ARRANGE: Data co-located with test
  await withData({
    pools: createPoolResponse([
      { name: "pool-alpha", status: "ONLINE" },
    ]),
  });

  // ACT
  await page.goto("/pools");

  // ASSERT
  await expect(page.getByRole("heading")).toContainText("pool-alpha");
});
```

## Performance Optimizations

### Build-Time
- `optimizeCss` - Extracts and inlines critical CSS
- `optimizePackageImports` - Tree-shakes lucide-react, Radix UI
- Console stripping - Removes `console.log` in production
- Turbopack - Default bundler (fast builds)

### Runtime
- **Virtualization** - TanStack Virtual for large lists
- **CSS Containment** - `contain: strict` on containers (`.contain-strict` utility)
- **GPU Transforms** - `translate3d()` for positioning (`.gpu-layer` utility)
- **Deferred Values** - `useDeferredValue` for search filters
- **URL State** - `nuqs` for shareable filter URLs
- **React Query** - `staleTime: 60s`, `gcTime: 300s`, structural sharing

### React 19 Features
- `use()` hook for async params/searchParams
- `cacheComponents` (production only - PPR via cache layering)
- Compiler optimizations via React Compiler

**IMPORTANT**: `cacheComponents: false` in development (causes constant re-rendering). Only enabled in production builds.

## Code Style Notes

### ESLint Rules
- Unused vars starting with `_` are allowed
- React Compiler checks enabled
- Production code cannot import from `/experimental`
- Feature modules should use public API imports (warnings)

### File Naming
- `kebab-case` for files
- `PascalCase` for components
- `camelCase` for utilities

### Import Order
```typescript
// 1. External packages
import { useState } from 'react';

// 2. Absolute imports (@/...)
import { usePools } from '@/lib/api/adapter';

// 3. Relative imports
import { PoolCard } from './pool-card';
```

## Hermetic Development (Mock Mode)

Run UI **without any backend** using deterministic synthetic data:

```bash
pnpm dev:mock
```

**How it works**:
- MSW intercepts all API requests in the browser
- Generators produce data on-demand using `faker.seed(baseSeed + index)`
- Same index = same data (deterministic)
- Configurable via browser console: `__mockConfig.setWorkflowTotal(100000)`

**Default volumes**: 10k workflows, 50 pools, 500 resources, 100 datasets

**Supported endpoints**: All API endpoints with infinite pagination

**Use cases**:
- Offline development
- UI testing with large datasets
- Stress testing virtualization/pagination
- Demo mode

**Location**: `src/mocks/`

## Important Files to Know

| File | Purpose |
|------|---------|
| `src/lib/api/adapter/BACKEND_TODOS.md` | **READ THIS FIRST** - 22 backend issues and workarounds |
| `src/lib/api/adapter/README.md` | Adapter layer philosophy |
| `src/lib/api/generated.ts` | Auto-generated API client (NEVER EDIT) |
| `src/lib/auth/README.md` | Authentication setup |
| `src/lib/query-client.ts` | React Query configuration |
| `src/lib/config.ts` | Runtime configuration (base path, API hostname) |
| `next.config.ts` | Next.js configuration (proxy, optimization) |
| `orval.config.ts` | API codegen configuration |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Types out of sync | `pnpm generate-api && pnpm type-check` |
| Backend returns wrong data | Check `src/lib/api/adapter/BACKEND_TODOS.md` for known issues |
| Auth not working | Check `.env.local` has `AUTH_CLIENT_SECRET` and `NEXT_PUBLIC_OSMO_API_HOSTNAME` |
| Tests failing | Run `pnpm test:e2e:ui` for interactive debugging |
| Mock data not showing | Check browser console for MSW worker status |

## Tech Stack Reference

| Layer | Tool |
|-------|------|
| Framework | Next.js 16 (App Router, Turbopack, PPR) |
| UI | React 19, Tailwind CSS 4, shadcn/ui |
| State | TanStack Query 5, Zustand (minimal) |
| Virtualization | TanStack Virtual |
| Forms | React Hook Form + Zod |
| API Codegen | orval (from OpenAPI) |
| Testing | Vitest (unit), Playwright (E2E) |
| Mocking | MSW (dev mode), Playwright route mocking (E2E) |

## Next Steps After Reading This

1. Read `src/lib/api/adapter/BACKEND_TODOS.md` to understand backend limitations
2. Run `pnpm dev` to start local development
3. Try `pnpm dev:mock` to see hermetic development mode
4. Run `pnpm test:e2e:ui` to explore E2E tests interactively
5. Check `src/app/(dashboard)/pools/` as a reference feature module
