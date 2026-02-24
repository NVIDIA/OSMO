<!--
SPDX-FileCopyrightText: Copyright (c) 2024-2026 NVIDIA CORPORATION. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
-->

# OSMO UI (Next.js)

Modern React-based UI for OSMO resource management. Built with Next.js 16, React 19, and Tailwind CSS 4.

**Requirements:** Node.js >= 22 (see `.nvmrc`), pnpm 10+ (see `packageManager` in `package.json`)

## Quick Start

```bash
pnpm install
pnpm dev                    # Start dev server → http://localhost:3000
```

For mock mode (no backend needed): `pnpm dev:mock`

---

## Commands

### Development

```bash
pnpm dev                    # Dev server (Turbopack)
pnpm dev:local              # Dev server → localhost:8000
pnpm dev:mock               # Dev with mock data (no backend needed)
pnpm dev:mock-ws            # Mock WebSocket server
pnpm build                  # Production build (Turbopack + compression)
pnpm start                  # Run production build
pnpm clean                  # Remove .next and .turbo caches
```

### Code Quality

```bash
pnpm lint                   # ESLint
pnpm type-check             # TypeScript check
pnpm format                 # Prettier format
pnpm format:check           # Check formatting
```

### Testing

```bash
pnpm test                   # Unit tests (Vitest, run once)
pnpm test:watch             # Unit tests in watch mode
pnpm test:coverage          # Unit tests with coverage
pnpm test:e2e               # E2E tests (Playwright, headless)
pnpm test:e2e:headed        # E2E with visible browser
pnpm test:e2e:ui            # E2E interactive UI (recommended for dev)
pnpm test:all               # Unit + E2E tests
```

### API Generation

```bash
pnpm generate-api           # Regenerate API client + status metadata from backend
pnpm generate-mocks         # Regenerate mock handlers from OpenAPI
```

This runs Bazel to export the OpenAPI spec and status metadata, then orval to generate TypeScript types and React Query hooks.

### Full Validation (Before Commit)

```bash
pnpm validate               # licenses + type-check + lint + format:check + build + test:all
```

Or run checks individually:

```bash
pnpm type-check && pnpm lint && pnpm test && pnpm build
```

### Licenses

```bash
pnpm licenses:check         # Verify all dependencies use permissive licenses
pnpm licenses:generate      # Regenerate THIRD_PARTY_LICENSES.md
```

---

## Architecture

### Project Structure

```
src/
├── app/                        # Next.js App Router (pages + API routes)
│   ├── (dashboard)/            # Authenticated pages (route group)
│   │   ├── datasets/           #   Dataset list + bucket + detail
│   │   ├── experimental/       #   Experimental features
│   │   ├── log-viewer/         #   Log viewer
│   │   ├── pools/              #   Pool management
│   │   ├── profile/            #   User profile
│   │   ├── resources/          #   Resource management
│   │   └── workflows/          #   Workflow list + detail
│   ├── api/                    # API route handlers
│   │   ├── [...path]/          #   Catch-all zero-copy proxy to backend
│   │   ├── auth/refresh/       #   Token refresh
│   │   ├── datasets/           #   Dataset file proxy + location files
│   │   ├── health/             #   Health check
│   │   └── me/                 #   Current user info (JWT decode)
│   └── health/                 # Health check page
├── features/                   # Feature modules (domain logic + components)
│   ├── datasets/               #   list/ + detail/
│   ├── log-viewer/
│   ├── pools/                  #   components/ + hooks/ + lib/ + stores/ + styles/
│   ├── profile/                #   components/ + hooks/
│   ├── resources/              #   components/ + hooks/ + lib/ + stores/
│   └── workflows/              #   list/ + detail/
├── components/                 # Shared, reusable UI components
│   ├── shadcn/                 #   Radix-based primitives (Button, Dialog, etc.)
│   ├── chrome/                 #   App shell (navigation, header, sidebar)
│   ├── data-table/             #   Virtualized data table
│   ├── dag/                    #   DAG visualization (workflow graphs)
│   ├── code-viewer/            #   CodeMirror-based code/YAML viewer
│   ├── log-viewer/             #   Terminal log viewer (xterm.js)
│   ├── shell/                  #   Interactive terminal shell
│   ├── event-viewer/           #   Event timeline
│   ├── filter-bar/             #   Search + filter chips
│   ├── panel/                  #   Side panel
│   ├── error/                  #   Error boundaries
│   ├── refresh/                #   Refresh controls
│   └── providers.tsx           #   React Query + Theme + Auth providers
├── hooks/                      # Shared React hooks
├── stores/                     # Zustand state stores
├── contexts/                   # React contexts (config, runtime env, services)
├── lib/                        # Core libraries
│   ├── api/
│   │   ├── adapter/            #   Backend → UI type transforms + hooks
│   │   ├── server/             #   Server-side API client
│   │   ├── log-adapter/        #   Log streaming adapter
│   │   ├── pagination/         #   Pagination utilities
│   │   ├── generated.ts        #   Auto-generated from OpenAPI (DO NOT EDIT)
│   │   └── fetcher.ts          #   Auth-aware fetch wrapper
│   ├── auth/                   #   Authentication (Envoy + JWT)
│   ├── config/                 #   OAuth + app configuration
│   ├── hotkeys/                #   Keyboard shortcut definitions
│   ├── navigation/             #   Navigation utilities
│   ├── workflows/              #   Workflow status helpers
│   └── format-date.ts          #   SSR-safe date formatting
├── mocks/                      # Mock data (MSW handlers + generators)
└── styles/                     # Additional CSS
```

### Layer Pattern

```
Page  →  Feature Module  →  Adapter Hook  →  Generated API  →  Backend
              │
              ├── hooks/        (data fetching, business logic)
              ├── components/   (presentation, receive data as props)
              ├── lib/          (constants, column defs, transforms)
              └── stores/       (table UI state via Zustand)
```

- **Pages** (`src/app/`): Thin routing layer. Compose feature modules.
- **Feature modules** (`src/features/`): Co-locate hooks, components, stores, and constants per domain.
- **Adapter hooks** (`src/lib/api/adapter/`): Transform backend responses to clean UI types. Isolate backend quirks.
- **Generated API** (`src/lib/api/generated.ts`): Auto-generated React Query hooks and types from the OpenAPI spec. Never import types from here directly -- use the adapter layer for types and only import enums from generated.
- **Shared components** (`src/components/`): Presentation-only. Receive data as props, never fetch internally.

---

## Feature Modules

Each feature follows a co-located structure under `src/features/`:

```
features/pools/
├── components/
│   ├── pools-page-content.tsx
│   ├── pools-toolbar.tsx
│   ├── pools-with-data.tsx
│   ├── panel/
│   └── table/
├── hooks/
│   └── use-pools-data.ts
├── lib/
│   ├── constants.ts
│   ├── pools-columns.ts
│   └── transforms.ts
├── stores/
│   └── pools-table-store.ts
└── styles/
```

**Conventions:**
- Feature components import from the adapter layer, never from `generated.ts` (except enums).
- Tests are co-located: `transforms.ts` has `transforms.test.ts` alongside it.
- All exports use absolute `@/` paths. Relative imports are forbidden.

---

## API Layer

### Adapter Pattern

The adapter layer (`src/lib/api/adapter/`) decouples the UI from backend quirks:

| Issue in Backend | Adapter Transform |
|---|---|
| Numeric values as strings | Parse to numbers |
| Missing fields | Provide defaults |
| Untyped dictionaries | Extract typed values |
| Unit conversions (KiB to GiB) | Convert units |
| Response typed as `unknown` | Cast to actual type |

```typescript
// Types and hooks from adapter (transformed, clean)
import { usePools, type Pool } from "@/lib/api/adapter/hooks";

// Enums directly from generated (values are correct as-is)
import { PoolStatus, WorkflowStatus } from "@/lib/api/generated";
```

Backend issues and their workarounds are documented in `src/lib/api/adapter/BACKEND_TODOS.md`.

### API Generation

The API client is generated from the backend OpenAPI spec:

```bash
pnpm generate-api
```

This runs:
1. `bazel run //src/service:export_openapi` -- exports `openapi.json`
2. `bazel run //src/service:export_status_metadata` -- exports status metadata TypeScript
3. `orval` -- generates `src/lib/api/generated.ts` with React Query hooks

### API Proxy

All `/api/*` requests are proxied to the backend via a catch-all Route Handler (`src/app/api/[...path]/route.ts`). This uses zero-copy streaming (returns `response.body` directly) for minimal latency and memory. The backend hostname is configurable at runtime, making the Docker image portable across environments.

---

## Authentication

### Production (Envoy Sidecar)

In production, authentication is handled entirely by the Envoy sidecar:

1. User accesses a protected route -- Envoy intercepts the request
2. No valid session -- Envoy redirects to OAuth provider (Keycloak)
3. User logs in -- Keycloak redirects back to Envoy callback
4. Envoy sets secure cookies and injects headers (`x-osmo-user`, `Authorization: Bearer <token>`)
5. Request is forwarded to Next.js with auth headers already set

The Next.js app never implements OAuth flows directly. It reads `x-osmo-user` for the username and decodes the JWT for full claims (email, roles).

See `src/lib/auth/README.md` for details.

### Local Development

For local development without Envoy:

1. Create `.env.local` with `NEXT_PUBLIC_OSMO_API_HOSTNAME` pointing to a deployed environment
2. Run `pnpm dev`
3. Follow the login prompt to transfer your session

Or use mock mode (`pnpm dev:mock`) for fully offline development with no backend or auth required.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_OSMO_API_HOSTNAME` | Yes | `localhost:8080` | Backend API hostname |
| `NEXT_PUBLIC_OSMO_SSL_ENABLED` | No | Auto (false for localhost) | Enable HTTPS for backend connection |
| `NEXT_PUBLIC_MOCK_API` | No | `false` | Enable mock API mode |
| `NEXT_PUBLIC_BASE_PATH` | No | `""` | Base path for subpath deployment (e.g., `/v2`) |
| `DOCS_BASE_URL` | No | - | Documentation site URL |
| `CLI_INSTALL_SCRIPT_URL` | No | - | CLI install script URL |
| `ANALYZE` | No | `false` | Enable webpack bundle analyzer |
| `ENABLE_SOURCE_MAPS` | No | `false` | Enable source maps in production builds |

OAuth-related variables (injected via Kubernetes secrets in production):

| Variable | Description |
|---|---|
| `OAUTH_CLIENT_ID` | OAuth client ID |
| `OAUTH_CLIENT_SECRET` / `OAUTH_CLIENT_SECRET_FILE` | OAuth client secret (value or file path) |
| `OAUTH_HMAC_SECRET` / `OAUTH_HMAC_SECRET_FILE` | HMAC secret for token encryption |
| `OAUTH_TOKEN_ENDPOINT` | OAuth token endpoint URL |
| `OAUTH_HOSTNAME` | OAuth provider hostname |
| `OAUTH_SCOPE` | OAuth scopes (default: `openid`) |

---

## Mock Mode (Hermetic Development)

Develop the UI without any backend connection using deterministic synthetic data.

### Quick Start

```bash
pnpm dev:mock
```

The app runs with realistic mock data for all entities (workflows, pools, resources, datasets, buckets, profiles).

### How It Works

```
UI Component → TanStack Query → MSW Intercept → Generators
                                                   ↓
                                  Deterministic synthetic data
                                  (same index = same data)
```

- **MSW (Mock Service Worker)** intercepts all API requests in the browser
- **Generators** produce data on-demand using seeded faker (`faker.seed(baseSeed + index)`)
- Works fully offline -- no network required
- Memory efficient -- items regenerated per request, not stored in memory

### Enable / Disable

```bash
# Via npm script
pnpm dev:mock

# Via environment variable
NEXT_PUBLIC_MOCK_API=true pnpm dev

# Via localStorage (toggle at runtime in browser console)
localStorage.setItem("mockApi", "true"); location.reload()
localStorage.removeItem("mockApi"); location.reload()
```

### Configure Data Volume

Use the browser console to stress-test with large datasets:

```javascript
__mockConfig.help()                          // Show help
__mockConfig.setWorkflowTotal(100000)        // 100k workflows
__mockConfig.setPoolTotal(1000)              // 1k pools
__mockConfig.setResourcePerPool(10000)       // 10k resources per pool
__mockConfig.getVolumes()                    // Check current volumes
```

### Mock Files

```
src/mocks/
├── handlers.ts              # MSW request handlers for all endpoints
├── mock-provider.tsx        # React provider for mock mode
├── global-config.ts         # Runtime volume configuration
├── generators/              # Deterministic data generators
│   ├── workflow-generator.ts
│   ├── pool-generator.ts
│   ├── resource-generator.ts
│   ├── bucket-generator.ts
│   ├── dataset-generator.ts
│   ├── log-generator.ts
│   ├── event-generator.ts
│   ├── profile-generator.ts
│   ├── spec-generator.ts
│   ├── portforward-generator.ts
│   └── pty-simulator.ts     # Interactive terminal simulation
├── handlers.production.ts   # No-op stub (aliased in production builds)
├── mock-provider.production.tsx
└── server.production.ts
```

Production builds alias mock modules to no-op stubs via Turbopack `resolveAlias`, completely eliminating MSW, faker, and all generators from the bundle.

---

## Testing

### Philosophy

Tests are designed for **speed** and **robustness** -- they should survive major UI refactors. Unit tests cover pure functions. E2E tests verify user outcomes, not implementation details.

### Unit Tests (Vitest)

Focus on high-value, low-brittleness areas:

| Module | What We Test |
|---|---|
| `transforms.ts` | Backend-to-UI type conversion, unit conversions |
| `utils.ts`, `format-date.ts` | Formatting functions, pure utilities |

Tests are co-located with source files:

```
lib/
├── transforms.ts
└── transforms.test.ts
```

```bash
pnpm test                         # Run once
pnpm test:watch                   # Watch mode
pnpm test transforms              # Run tests matching "transforms"
```

### E2E Tests (Playwright)

Tests use semantic selectors and verify user journeys:

```typescript
// Robust: tests outcome, not implementation
await expect(page.getByRole("button", { name: /submit/i })).toBeVisible();
```

All E2E tests run offline using Playwright's route mocking. No backend required.

```bash
pnpm test:e2e                     # Headless (CI mode)
pnpm test:e2e:ui                  # Interactive UI (recommended for dev)
pnpm test:e2e:headed              # Visible browser
```

### E2E Test Structure

```
e2e/
├── fixtures.ts                   # Playwright config with API mocking + withData/withAuth
├── journeys/
│   ├── auth.spec.ts              # Authentication flows
│   ├── navigation.spec.ts        # App navigation
│   ├── pools.spec.ts             # Pool browsing
│   ├── resources.spec.ts         # Resource browsing
│   ├── errors.spec.ts            # Error handling
│   └── infinite-scroll.spec.ts   # Virtualization / pagination
└── mocks/
    ├── data.ts                   # Default mock data
    └── factories.ts              # Type-safe mock data factories
```

E2E tests use **typed factories** with data defined inline alongside assertions:

```typescript
import { test, expect, createPoolResponse } from "../fixtures";

test("shows pool details", async ({ page, withData }) => {
  await withData({
    pools: createPoolResponse([
      { name: "gpu-pool", status: "ONLINE", resource_usage: { quota_used: "0" } },
    ]),
  });

  await page.goto("/pools/gpu-pool");
  await expect(page.getByRole("heading")).toContainText("gpu-pool");
});
```

---

## Tech Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack, Partial Prerendering) |
| UI | React 19, Tailwind CSS 4 |
| Components | shadcn/ui (Radix UI primitives) |
| Server State | TanStack Query 5 |
| Client State | Zustand 5 |
| URL State | nuqs |
| Tables | TanStack Table |
| Virtualization | TanStack Virtual |
| DAG Visualization | @xyflow/react + dagre |
| Code Editor | CodeMirror (@uiw/react-codemirror) |
| Terminal | xterm.js |
| Drag and Drop | @dnd-kit |
| Toasts | sonner |
| Drawer | vaul |
| Command Palette | cmdk |
| Keyboard Shortcuts | react-hotkeys-hook |
| Icons | Lucide React |
| API Codegen | orval (from OpenAPI) |
| Unit Testing | Vitest |
| E2E Testing | Playwright |
| Dev Mocking | MSW (Mock Service Worker) |

---

## Performance

### Build-Time Optimizations

| Optimization | Purpose |
|---|---|
| Turbopack | Fast bundling for dev and production |
| `optimizeCss` | Extracts and inlines critical CSS |
| `optimizePackageImports` | Tree-shakes Radix, Lucide, CodeMirror, @xyflow/react, etc. |
| Console stripping | Removes `console.log` in production |
| Standalone output | Containerized deployment with minimal footprint |
| Mock code elimination | Turbopack aliases replace mock modules with no-op stubs |
| Partial Prerendering | Static shell + streamed dynamic content via Suspense |

### Runtime Optimizations

| Technique | Where Used |
|---|---|
| Virtualization | Resource/workflow tables (TanStack Virtual) |
| CSS Containment | `contain: strict` on scroll containers |
| GPU Transforms | `translate3d()` for virtualized item positioning |
| Deferred Values | `useDeferredValue` for search filters |
| URL State | nuqs for shareable, URL-synced filters |
| Transitions | `startTransition` for non-blocking heavy state updates |
| Structural Sharing | React Query only updates changed refs |

### React Query Configuration

| Setting | Value | Purpose |
|---|---|---|
| `staleTime` | 1 min | Data freshness window |
| `gcTime` | 5 min | Cache retention for unused queries |
| `structuralSharing` | `true` | Only update refs if data changed |
| `refetchOnWindowFocus` | `"always"` | Fresh data when user returns |

---

## Debugging

### React Query Devtools

Toggle in browser console:

```javascript
window.toggleDevtools(true)   // Enable
window.toggleDevtools(false)  // Disable
window.toggleDevtools()       // Toggle
```

Features: view cached queries, inspect data, manually invalidate/refetch, see fetch timing. Zero production bundle impact (tree-shaken).

### Troubleshooting

| Issue | Fix |
|---|---|
| Types out of sync | `pnpm generate-api && pnpm type-check` |
| Backend quirks | See `src/lib/api/adapter/BACKEND_TODOS.md` |
| shadcn/ui issues | Check `components.json` config |
| Hydration mismatch | Check for localStorage, `Date.now()`, or locale-dependent formatting in render |
| Auth not working locally | Ensure `.env.local` has correct hostname, or use `pnpm dev:mock` |

### Adding shadcn/ui Components

```bash
npx shadcn@latest add button        # Add a component
npx shadcn@latest add dialog input  # Add multiple
```

Components are added to `src/components/shadcn/`.

---

## Licenses

All dependencies use permissive licenses (MIT, Apache-2.0, ISC, BSD) compatible with commercial use. No GPL, LGPL, AGPL, or copyleft licenses.

See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for the full list.

To verify:

```bash
pnpm licenses:check      # Verify all deps against allowlist
pnpm licenses:generate   # Regenerate THIRD_PARTY_LICENSES.md
```
