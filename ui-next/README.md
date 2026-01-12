# OSMO UI (Next.js)

Modern React-based UI for OSMO resource management. Built for **blazing-fast performance** with GPU-accelerated rendering, virtualization, and minimal reflow.

## Quick Start

```bash
pnpm install
pnpm dev                    # → http://localhost:3000
```

For local backend: `pnpm dev:local` (points to localhost:8000)

---

## Commands

### Development
```bash
pnpm dev                    # Start dev server (Turbopack)
pnpm dev:local              # Dev server → localhost:8000
pnpm dev:mock               # Dev with mock data (no backend needed!)
pnpm build                  # Production build
pnpm start                  # Run production build
```

### Code Quality
```bash
pnpm lint                   # ESLint (includes React Compiler checks)
pnpm lint:a11y              # Accessibility linting
pnpm type-check             # TypeScript check
pnpm format                 # Prettier format
pnpm format:check           # Check formatting
```

### Full Verification (Before Commit)
```bash
pnpm type-check && pnpm lint && pnpm test && pnpm build
```

### Testing

#### Quick Commands
```bash
pnpm test                   # Run all unit tests once
pnpm test:e2e               # Run all E2E tests (headless)
pnpm test:all               # Run unit + E2E tests
```

#### Unit Tests (Vitest)
```bash
# Run modes
pnpm test                   # Run once and exit
pnpm test:watch             # Watch mode - rerun on file changes
pnpm test:coverage          # Run with coverage report

# Filtered runs
pnpm test transforms        # Run tests matching "transforms"
pnpm test utils             # Run tests matching "utils"
pnpm test -- --grep "quota" # Run tests with "quota" in name

# Interactive
pnpm test:watch             # Watch mode with interactive menu
                            # Press 'p' to filter by filename
                            # Press 't' to filter by test name
                            # Press 'a' to run all tests
                            # Press 'f' to run only failed tests

# Debugging
pnpm test -- --reporter=verbose    # Verbose output
pnpm test -- --bail                # Stop on first failure
pnpm test -- --inspect-brk         # Debug with Node inspector
```

#### E2E Tests (Playwright)
```bash
# Run modes
pnpm test:e2e               # Headless (CI mode)
pnpm test:e2e:headed        # Visible browser
pnpm test:e2e:ui            # Interactive UI (best for debugging)

# Filtered runs
pnpm test:e2e -- auth       # Run tests in files matching "auth"
pnpm test:e2e -- pools      # Run tests in files matching "pools"
pnpm test:e2e -- -g "login" # Run tests with "login" in name

# Single file
pnpm test:e2e -- e2e/journeys/auth.spec.ts
pnpm test:e2e -- e2e/journeys/pools.spec.ts

# Debugging
pnpm test:e2e -- --debug              # Step through with Playwright Inspector
pnpm test:e2e:headed -- --slowmo=500  # Slow down actions (500ms between)
pnpm test:e2e -- --trace on           # Record trace for all tests
pnpm test:e2e -- --update-snapshots   # Update visual snapshots

# Specific browser
pnpm test:e2e -- --project=chromium   # Chrome only (default)
pnpm test:e2e -- --project=firefox    # Firefox only
pnpm test:e2e -- --project=webkit     # Safari only

# Retries and parallelism
pnpm test:e2e -- --retries=2          # Retry failed tests
pnpm test:e2e -- --workers=1          # Run sequentially (debug flaky tests)
pnpm test:e2e -- --workers=4          # Run with 4 parallel workers

# Reports
pnpm test:e2e -- --reporter=html      # Generate HTML report
pnpm test:e2e -- --reporter=list      # Simple list output
```

#### Test by Scenario (E2E)
```bash
# Auth scenarios
pnpm test:e2e -- -g "unauthenticated"     # Login screen tests
pnpm test:e2e -- -g "authenticated"       # Logged-in user tests
pnpm test:e2e -- -g "OAuth"               # OAuth flow tests
pnpm test:e2e -- -g "expired"             # Token refresh tests
pnpm test:e2e -- -g "forbidden"           # 403 error tests
pnpm test:e2e -- -g "unauthorized"        # 401 error tests

# Feature scenarios
pnpm test:e2e -- -g "pools"               # Pool-related tests
pnpm test:e2e -- -g "resources"           # Resource-related tests
pnpm test:e2e -- -g "navigation"          # Navigation tests
pnpm test:e2e -- -g "filter"              # Filter functionality tests
```

#### CI Commands
```bash
# Fast CI run
pnpm test && pnpm test:e2e

# Full verification
pnpm lint && pnpm type-check && pnpm test && pnpm test:e2e
```

#### Playwright UI Mode (Recommended for Development)
```bash
pnpm test:e2e:ui
```
Opens interactive UI with:
- **Test explorer** - Click tests to run individually
- **Watch mode** - Auto-rerun on file changes
- **Time travel** - Step through test actions visually
- **DOM snapshots** - Inspect page state at each step
- **Network tab** - See mocked API requests/responses
- **Pick locator** - Generate selectors by clicking elements

#### Debugging Tips

**1. Run single test in watch mode:**
```bash
pnpm test:e2e:ui -- -g "user can log in"
```

**2. Pause mid-test to inspect:**
```typescript
await page.pause();  // Add to any test
```

**3. See what selectors match:**
```bash
pnpm test:e2e -- --debug
# Then in Playwright Inspector: click "Pick locator"
```

**4. Generate test from actions:**
```bash
pnpm exec playwright codegen localhost:3000
```

### API Generation
```bash
pnpm generate-api           # Regenerate API client from backend source
pnpm generate-mocks         # Regenerate mock handlers from OpenAPI (optional)
```
This runs Bazel to export OpenAPI spec, then orval to generate TypeScript.

### Mock Data (Type-Safe, Co-located)

E2E tests use **typed factories** with data defined **inline with tests**:

```typescript
// e2e/journeys/pools.spec.ts
import { test, expect, createPoolResponse, createResourcesResponse } from "../fixtures";

test("shows empty pool", async ({ page, withData }) => {
  // ARRANGE: Data is co-located with test assertions
  await withData({
    pools: createPoolResponse([
      { name: "empty-pool", status: "ONLINE", resource_usage: { quota_used: "0", ... } },
    ]),
    resources: { resources: [] },
  });

  // ACT
  await page.goto("/pools/empty-pool");

  // ASSERT
  await expect(page.getByRole("heading")).toContainText("empty-pool");
});
```

**Benefits:**
- ✅ Mock data matches actual API contract (typed from OpenAPI)
- ✅ Test intent is clear - data visible right next to assertions
- ✅ TypeScript catches spec changes
- ✅ `pnpm generate-api` → factories show errors if out of sync

**Available fixtures:**
```typescript
import {
  test, expect,
  // Data setup (call BEFORE page.goto)
  withData,                      // Set pools, resources, version
  withAuth,                      // Set auth state, tokens, errors
  // Factories (type-safe)
  createPoolResponse,
  createResourcesResponse,
  createProductionScenario,      // Realistic multi-pool setup
  createEmptyScenario,           // Empty pool, no resources
  createHighUtilizationScenario, // Overloaded resources
  // Generated enums - use instead of string literals!
  PoolStatus,                    // ONLINE, OFFLINE, MAINTENANCE
  BackendResourceType,           // SHARED, RESERVED, UNUSED
} from "../fixtures";

// ✅ Good: Use generated enums
{ status: PoolStatus.ONLINE, resource_type: BackendResourceType.SHARED }

// ❌ Bad: String literals (no type safety)
{ status: "ONLINE", resource_type: "SHARED" }
```

### shadcn/ui Components
```bash
npx shadcn@latest add button        # Add a component
npx shadcn@latest add dialog input  # Add multiple
npx shadcn@latest add --all         # Add all components
```
Components are added to `src/components/ui/`.

---

## Project Setup (From Scratch)

This section documents how this project was created (for reference).

### 1. Create Next.js App
```bash
pnpm create next-app@latest ui-next --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
```

### 2. Initialize shadcn/ui
```bash
npx shadcn@latest init
# Selected: New York style, Neutral base color, CSS variables: yes
```

### 3. Install Dependencies
```bash
pnpm add @tanstack/react-query @tanstack/react-table zod react-hook-form @hookform/resolvers
pnpm add -D orval
```

### 4. Configure orval (API codegen)
Created `orval.config.ts`:
```typescript
export default defineConfig({
  osmo: {
    input: { target: './openapi.json' },
    output: {
      target: './src/lib/api/generated.ts',
      client: 'react-query',
      mode: 'single',
      override: {
        mutator: { path: './src/lib/api/fetcher.ts', name: 'customFetch' },
      },
    },
  },
});
```

### 5. Generate API Client
```bash
# From external/ directory
bazel run //src/service:export_openapi > ui-next/openapi.json
cd ui-next && pnpm exec orval
```

---

## Architecture

```
src/
├── app/                    # Next.js pages (routing)
│   ├── (dashboard)/        # Authenticated pages
│   ├── auth/               # Auth API routes
│   └── globals.css         # Global styles + performance utilities
├── components/
│   ├── ui/                 # shadcn/ui primitives (Button, Input, etc.)
│   ├── shell/              # Layout (Header, Sidebar)
│   ├── features/           # Feature-specific themed components
│   └── providers.tsx       # React Query + Theme + Auth providers
├── headless/               # Business logic hooks (usePoolsList, usePoolDetail)
└── lib/
    ├── api/
    │   ├── adapter/        # Transforms backend → clean types
    │   ├── generated.ts    # Auto-generated from OpenAPI (don't edit)
    │   └── fetcher.ts      # Auth-aware fetch wrapper
    ├── auth/               # Authentication logic
    ├── constants/          # Roles, headers, storage keys
    ├── filters/            # URL-synced filter hooks (nuqs)
    └── styles.ts           # Shared Tailwind patterns
```

### Layer Pattern

```
Page → Headless Hook → Adapter Hook → Generated API
            ↓
     Themed Components
```

- **Pages**: Compose headless hooks + themed components
- **Headless hooks**: Business logic, filtering, state (no UI)
- **Adapter hooks**: Clean types, transform backend quirks
- **Themed components**: Presentation only, receive data as props

---

## Common Workflows

### Adding a New Page
1. Create `src/app/(dashboard)/your-feature/page.tsx`
2. Create `src/headless/use-your-feature.ts`
3. Create `src/components/features/your-feature/`
4. Export from index files

### Using API Data
```typescript
import { usePools, usePoolResources } from "@/lib/api/adapter";

const { pools, isLoading, error } = usePools();
```
**Don't** import from `@/lib/api/generated` directly—use the adapter.

### Adding a New API Endpoint
1. Update backend API
2. `pnpm generate-api`
3. Add transform in `src/lib/api/adapter/transforms.ts`
4. Add hook in `src/lib/api/adapter/hooks.ts`
5. Export from `src/lib/api/adapter/index.ts`

### Adding UI Components
```bash
npx shadcn@latest add dialog
```
For custom components, add to `src/components/features/`.

---

## Production-First Architecture

This codebase follows **production-first principles**: development features have zero impact on production builds.

### Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Zero production overhead** | No middleware, no dev-only code paths |
| **No dev code in prod bundle** | Dev components use `next/dynamic` for code splitting |
| **Clean separation** | Dev login UI isolated to `auth-local-dev.tsx` |
| **Transparent behavior** | Production code paths work without any shims or workarounds |

### Dev vs Production Behavior

| Feature | Development | Production |
|---------|-------------|------------|
| **Backend routing** | `next.config.ts` rewrites to configured hostname | Same |
| **Login screen** | Shows cookie paste UI (`LocalDevLogin`) | Shows SSO button only |
| **Auth client secret** | Uses `AUTH_CLIENT_SECRET` from `.env.local` | Uses `AUTH_CLIENT_SECRET` from env |

### Files with Dev-Only Code

| File | Dev Feature | Production Behavior |
|------|-------------|---------------------|
| `src/lib/auth/auth-local-dev.tsx` | Dev login UI with cookie paste | Not bundled (dynamic import) |

### How to Verify Production Isolation

```bash
# Build and analyze bundle
pnpm build

# Search for dev code in production output
grep -r "LocalDevLogin" .next/static/chunks/ # Should find nothing
```

---

## Local Development

### Setup

```bash
# 1. Create .env.local
cat > .env.local << 'EOF'
NEXT_PUBLIC_OSMO_API_HOSTNAME=staging.example.com
AUTH_CLIENT_SECRET=your-keycloak-secret
EOF

# 2. Start dev server
pnpm dev
```

Open http://localhost:3000 → follow the login prompt to transfer your session.

### Switch Backend

Edit `.env.local` → restart `pnpm dev`

### Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `NEXT_PUBLIC_OSMO_API_HOSTNAME` | Yes | `localhost:8080` |
| `AUTH_CLIENT_SECRET` | Yes | — |
| `NEXT_PUBLIC_OSMO_SSL_ENABLED` | No | Auto (false for localhost) |
| `NEXT_PUBLIC_MOCK_API` | No | `false` |

---

## Hermetic Development (Mock Mode)

Develop the UI **without any backend connection** using deterministic synthetic data.

### Quick Start

```bash
# Start with mock data - no backend needed!
pnpm dev:mock
```

That's it! The app runs with 10,000 workflows, 50 pools, and realistic data for all entities.

### How It Works

```
UI Component → TanStack Query → MSW Intercept → Generators
                                                  ↓
                               Deterministic synthetic data
                               (same index = same data)
```

- **MSW (Mock Service Worker)** intercepts all API requests in the browser
- **Generators** produce data on-demand using `faker.seed(baseSeed + index)`
- **No network required** - works offline (airplane mode!)
- **Memory efficient** - items regenerated per request, not stored

### Enable/Disable Mock Mode

```bash
# Option 1: npm script
pnpm dev:mock

# Option 2: Environment variable
NEXT_PUBLIC_MOCK_API=true pnpm dev

# Option 3: localStorage (toggle at runtime)
# In browser console:
localStorage.setItem("mockApi", "true")
location.reload()

# To disable:
localStorage.removeItem("mockApi")
location.reload()
```

### Configure Data Volume

For stress testing pagination and virtualization, use the browser console:

```javascript
// Show help
__mockConfig.help()

// Configure volumes
__mockConfig.setWorkflowTotal(100000)      // 100k workflows
__mockConfig.setPoolTotal(1000)            // 1k pools  
__mockConfig.setResourcePerPool(10000)     // 10k resources per pool
__mockConfig.setResourceTotalGlobal(1000000) // 1M total resources
__mockConfig.setBucketTotal(10000)         // 10k buckets
__mockConfig.setDatasetTotal(50000)        // 50k datasets

// Check current volumes
__mockConfig.getVolumes()
// → { workflows: 100000, pools: 1000, buckets: 10000, datasets: 50000 }
```

After changing volumes, refresh the page or navigate to see the new data.

### Default Volumes

| Entity | Default | Setter Function |
|--------|---------|-----------------|
| Workflows | 10,000 | `setWorkflowTotal(n)` |
| Pools | 50 | `setPoolTotal(n)` |
| Resources/pool | 50 | `setResourcePerPool(n)` |
| Resources total | 500 | `setResourceTotalGlobal(n)` |
| Buckets | 50 | `setBucketTotal(n)` |
| Datasets | 100 | `setDatasetTotal(n)` |

### Supported Endpoints

All API endpoints are mocked with infinite pagination:

| Endpoint | Generator | Pagination |
|----------|-----------|------------|
| `GET /api/workflow` | WorkflowGenerator | ✅ offset/limit |
| `GET /api/workflow/:name` | WorkflowGenerator | - |
| `GET /api/workflow/:name/logs` | LogGenerator | - |
| `GET /api/workflow/:name/events` | EventGenerator | - |
| `GET /api/workflow/:name/spec` | (inline YAML) | - |
| `GET /api/workflow/:name/task/:task` | TaskGenerator | - |
| `GET /api/workflow/:name/task/:task/logs` | LogGenerator | - |
| `GET /api/workflow/:name/task/:task/events` | EventGenerator | - |
| `POST /api/workflow/:name/exec/task/:task` | TerminalSimulator | - |
| `POST /api/workflow/:name/webserver/:task` | PortForwardGenerator | - |
| `GET /api/pool` | PoolGenerator | ✅ offset/limit |
| `GET /api/pool/:name` | PoolGenerator | - |
| `GET /api/pool/:name/resources` | ResourceGenerator | ✅ offset/limit |
| `GET /api/resources` | ResourceGenerator | ✅ offset/limit |
| `GET /api/bucket` | BucketGenerator | ✅ offset/limit |
| `GET /api/bucket/:name/list` | BucketGenerator | ✅ offset/limit |
| `GET /api/bucket/list_dataset` | DatasetGenerator | ✅ offset/limit |
| `GET /api/bucket/collections` | DatasetGenerator | ✅ offset/limit |
| `GET /api/profile` | ProfileGenerator | - |
| `GET /api/profile/settings` | ProfileGenerator | - |

### Deterministic Generation

Same index always produces identical data:

```typescript
// First request
workflowGenerator.generate(12345);
// → { name: "train-model-abc123", status: "RUNNING", ... }

// Later request (same result!)
workflowGenerator.generate(12345);
// → { name: "train-model-abc123", status: "RUNNING", ... }
```

This means:
- ✅ Consistent pagination (scroll back = same items)
- ✅ Reproducible bugs
- ✅ Stable UI testing

### Interactive Features

Mock mode includes realistic simulations for:

| Feature | Behavior |
|---------|----------|
| **Terminal/Exec** | Simulates shell with `ls`, `nvidia-smi`, `python`, etc. |
| **Port Forward** | Returns mock router addresses and session keys |
| **Logs** | Generates training output with epochs, loss, metrics |
| **Events** | K8s-style events (Scheduled, Started, Completed, Failed) |

### Mock Files

```
src/mocks/
├── browser.ts           # MSW browser setup
├── handlers.ts          # Request handlers for all endpoints
├── index.ts             # Main exports
├── MockProvider.tsx     # React provider
│
├── generators/          # Deterministic data generators
│   ├── workflow-generator.ts   # Workflows (infinite)
│   ├── pool-generator.ts       # Pools (infinite)
│   ├── resource-generator.ts   # Resources (infinite)
│   ├── task-generator.ts       # Tasks
│   ├── log-generator.ts        # Streaming logs
│   ├── event-generator.ts      # K8s-style events
│   ├── bucket-generator.ts     # Buckets (infinite)
│   ├── dataset-generator.ts    # Datasets (infinite)
│   ├── profile-generator.ts    # User profiles
│   ├── portforward-generator.ts # Port forwarding
│   └── terminal-simulator.ts   # Interactive terminal
│
└── seed/                # Configuration patterns
    ├── index.ts
    └── types.ts         # MOCK_CONFIG with distributions
```

### Customize Mock Patterns

Edit `src/mocks/seed/types.ts`:

```typescript
export const MOCK_CONFIG: MockConfig = {
  volume: {
    workflows: 10_000,    // Total workflows
    pools: 50,            // Number of pools
    resourcesPerPool: 50, // Resources per pool
  },
  
  workflows: {
    statusDistribution: {
      RUNNING: 0.25,
      COMPLETED: 0.40,
      FAILED: 0.15,
      WAITING: 0.10,
      // ...
    },
    pools: ["training-pool", "inference-pool", "preemptible"],
    users: ["alice", "bob", "charlie"],
    // ...
  },
  
  // ... more patterns
};
```

### Documentation

For more details, see:
- [HERMETIC_DEV.md](../ui-next-design/docs/HERMETIC_DEV.md) - Full hermetic dev guide
- [MOCK_ENTITY_REFERENCE.md](../ui-next-design/docs/MOCK_ENTITY_REFERENCE.md) - Generator API reference

---

## Debugging

### React Query Devtools

Inspect cached queries, trigger refetches, and debug stale times using the **Chrome extension**:

1. Install: [React Query Devtools Extension](https://chrome.google.com/webstore/detail/react-query-devtools/ooaplkfkopclpbpjgbhfjllmbjdpakoh)
2. Open Chrome DevTools (`F12` or `Cmd+Option+I`)
3. Find the "React Query" tab

**Features:**
- View all cached queries and their status (fresh, stale, fetching)
- Inspect cached data as expandable JSON
- Manually invalidate, refetch, or remove queries
- See fetch counts and timing

This is preferred over the in-app floating devtools to avoid UI conflicts.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Types out of sync | `pnpm generate-api && pnpm type-check` |
| Backend quirks | See `src/lib/api/adapter/backend_todo.md` |
| shadcn/ui issues | Check `components.json` config |

See [Local Development](#local-development) for auth and environment issues.

---

## Testing Philosophy

Tests are designed for **speed** and **robustness**—they should survive major UI refactors.

### Unit Tests (Vitest)

Focus on high-value, low-brittleness areas:

| Module | What We Test | Why |
|--------|--------------|-----|
| `transforms.ts` | Backend → UI type conversion | Catches API changes, unit conversions |
| `utils.ts` | Formatting functions | Pure functions, easy to test |

**Not tested:** UI components, generated code, shadcn/ui primitives.

### E2E Tests (Playwright)

Tests verify **user outcomes**, not implementation details:

```typescript
// ❌ Brittle: tests implementation
expect(page.locator('.btn-primary-active')).toBeVisible();

// ✅ Robust: tests outcome
expect(page.getByRole('button', { name: /submit/i })).toBeVisible();
```

**Key principles:**
- Use semantic selectors (`getByRole`, `getByLabel`)
- Test user journeys, not component states
- Don't assert exact counts or text (data changes)
- Tests should pass after virtualization, pagination, or filter UI changes

### Test Structure

```
src/
├── lib/
│   ├── utils.test.ts           # Utility function tests
│   └── api/adapter/
│       └── transforms.test.ts  # Data transformation tests
e2e/
├── fixtures.ts                 # Playwright test with API mocking + withData/withAuth
├── journeys/
│   ├── auth.spec.ts            # Authentication flows
│   ├── navigation.spec.ts      # App navigation
│   ├── pools.spec.ts           # Pool browsing journey
│   └── resources.spec.ts       # Resource browsing journey
└── mocks/
    ├── data.ts                 # Default mock data
    └── factories.ts            # Type-safe mock data factories
```

### E2E Tests Run Offline

E2E tests use **Playwright's route mocking** to intercept all API requests. No backend connection required:

```typescript
// e2e/fixtures.ts - all tests use mocked API
await page.route("**/api/pool/quota*", async (route) => {
  await route.fulfill({ body: JSON.stringify(mockPools) });
});
```

This means:
- ✅ Tests run offline (no backend required)
- ✅ Consistent data across runs
- ✅ Fast (no network latency)
- ✅ CI doesn't need backend access

### Testing Authentication (Production Code Paths)

Auth tests exercise **real product code**, not local dev shortcuts:

```typescript
import { test, expect, withAuth, mockIdToken, mockRefreshToken } from "../fixtures";

test("authenticated user sees dashboard", async ({ page, withAuth }) => {
  // Configure auth state BEFORE navigation
  await withAuth({
    authEnabled: true,
    tokens: { idToken: mockIdToken, refreshToken: mockRefreshToken },
  });

  await page.goto("/");
  await expect(page.getByRole("navigation")).toBeVisible();
});

test("expired token refreshes automatically", async ({ page, withAuth }) => {
  await withAuth({
    authEnabled: true,
    tokens: { idToken: expiredToken, refreshToken: validRefresh },
    refreshResult: "success",
  });

  await page.goto("/");
  await expect(page.getByRole("navigation")).toBeVisible(); // Refresh worked
});

test("handles 403 forbidden", async ({ page, withAuth }) => {
  await withAuth({
    authEnabled: true,
    tokens: { idToken: mockIdToken, refreshToken: mockRefreshToken },
    apiError: "forbidden",
  });

  await page.goto("/pools");
  // App should handle error gracefully
});
```

**Auth scenarios:**
| Config | Behavior |
|--------|----------|
| `authEnabled: false` | Auth disabled (default) |
| `authEnabled: true` | Auth enabled, user NOT logged in |
| `authEnabled: true` + `tokens` | Auth enabled, user logged in |
| `refreshResult: "success"` | Token refresh succeeds |
| `refreshResult: "failure"` | Token refresh fails → login screen |
| `apiError: "unauthorized"` | API returns 401 |
| `apiError: "forbidden"` | API returns 403 |

**What's mocked:** OAuth IdP endpoints (simulates Keycloak)

**What's real (tested):**
- AuthProvider logic
- Token storage (`/auth/success` page)
- Token refresh flow
- Route protection
- Error handling

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind CSS 4 |
| Components | shadcn/ui (New York style) + Radix |
| State | TanStack Query 5 |
| Virtualization | TanStack Virtual |
| Forms | React Hook Form + Zod |
| Icons | Lucide React |
| API Codegen | orval (from OpenAPI) |
| Unit Testing | Vitest |
| E2E Testing | Playwright (with route mocking) |

---

## Performance Optimizations

This UI is optimized for **blazing-fast rendering** with minimal layout reflow.

### Build-Time Optimizations

| Optimization | Purpose |
|--------------|---------|
| `optimizeCss` | Extracts and inlines critical CSS |
| `optimizePackageImports` | Tree-shakes lucide-react and Radix icons |
| Console stripping | Removes `console.log` in production |
| Font preloading | `display: swap` prevents FOIT |

### Runtime Optimizations

| Technique | Where Used |
|-----------|------------|
| **Virtualization** | Resource tables (TanStack Virtual) |
| **CSS Containment** | `contain: strict` on containers |
| **GPU Transforms** | `translate3d()` for positioning |
| **Deferred Values** | `useDeferredValue` for search filters |
| **URL State** | `nuqs` for shareable filter URLs |
| **Transitions** | `startTransition` for non-blocking updates |
| **Memoization** | `React.memo()` on expensive components |
| **Structural Sharing** | React Query only updates changed refs |

### CSS Utility Classes

Available in `globals.css` for performance-critical components:

```css
.gpu-layer          /* Force GPU compositing */
.contain-strict     /* Full CSS containment */
.scroll-optimized   /* Optimized scrolling */
.virtual-item       /* For virtualized list items */
.skeleton-shimmer   /* GPU-accelerated loading animation */
```

### React Query Configuration

| Setting | Value | Purpose |
|---------|-------|---------|
| `staleTime` | 1 min | Data freshness window |
| `gcTime` | 5 min | Cache retention for unused queries |
| `structuralSharing` | `true` | Only update refs if data changed |
| `refetchOnWindowFocus` | `"always"` | Fresh data when user returns |

---

## Licenses

All dependencies use **permissive licenses** compatible with commercial use.

### Production Dependencies

| License | Count | Key Packages |
|---------|-------|--------------|
| MIT | 21 | React, Next.js, Radix UI, TanStack Query/Table, zod, react-hook-form |
| Apache-2.0 | 1 | class-variance-authority |
| ISC | 1 | lucide-react |

### Dev Dependencies

| License | Count |
|---------|-------|
| MIT | 11 |
| Apache-2.0 | 1 |

### No Restrictive Licenses

- ❌ No GPL (any version)
- ❌ No LGPL
- ❌ No AGPL
- ❌ No copyleft licenses

### shadcn/ui Components

Components copied from [shadcn/ui](https://ui.shadcn.com/) are MIT licensed. Once copied into your project, they are yours to modify freely.

### Verify Licenses

Run the license checker to verify all dependencies:

```bash
# Check production deps
npx license-checker --production --summary

# Verify no restricted licenses
npx license-checker --production --onlyAllow "MIT;Apache-2.0;ISC;BSD-2-Clause;BSD-3-Clause;0BSD;CC0-1.0;UNLICENSED"
```

The `UNLICENSED` entry is this project itself (marked `private: true` in package.json).
