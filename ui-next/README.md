# OSMO UI (Next.js)

Modern React-based UI for OSMO resource management.

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
pnpm build                  # Production build
pnpm start                  # Run production build
```

### Code Quality
```bash
pnpm lint                   # ESLint
pnpm lint:a11y              # Accessibility linting
pnpm type-check             # TypeScript check
pnpm format                 # Prettier format
pnpm format:check           # Check formatting
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
│   └── auth/               # Auth API routes
├── components/
│   ├── ui/                 # shadcn/ui primitives (Button, Input, etc.)
│   ├── shell/              # Layout (Header, Sidebar)
│   └── features/           # Feature-specific themed components
├── headless/               # Business logic hooks (usePoolsList, usePoolDetail)
└── lib/
    ├── api/
    │   ├── adapter/        # Transforms backend → clean types
    │   ├── generated.ts    # Auto-generated from OpenAPI (don't edit)
    │   └── fetcher.ts      # Auth-aware fetch wrapper
    ├── auth/               # Authentication logic
    ├── constants/          # Roles, headers, storage keys
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

## Local Dev Against Production Backend

1. Get cookies from production (DevTools → Application → Cookies)
2. Create `.env.local`:
   ```
   NEXT_PUBLIC_OSMO_API_HOSTNAME=osmo.nvidia.com
   NEXT_PUBLIC_OSMO_SSL_ENABLED=true
   AUTH_CLIENT_SECRET=<from-keycloak>
   ```
3. Run `pnpm dev`, paste cookies when prompted

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_OSMO_API_HOSTNAME` | Backend API host |
| `NEXT_PUBLIC_OSMO_SSL_ENABLED` | Use HTTPS for API |
| `AUTH_CLIENT_SECRET` | OAuth client secret (for token refresh) |

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
| 401 / Token refresh fails | Set `AUTH_CLIENT_SECRET`, re-paste cookies |
| CORS errors | Check `next.config.ts` rewrites |
| Types out of sync | `pnpm generate-api && pnpm type-check` |
| Backend quirks | See `src/lib/api/adapter/backend_todo.md` |
| shadcn/ui issues | Check `components.json` config |

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
| Forms | React Hook Form + Zod |
| Icons | Lucide React |
| API Codegen | orval (from OpenAPI) |
| Unit Testing | Vitest |
| E2E Testing | Playwright (with route mocking) |

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
