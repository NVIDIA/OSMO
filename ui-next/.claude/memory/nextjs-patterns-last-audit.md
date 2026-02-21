# Next.js Patterns Audit — Last Run
Date: 2026-02-21
Iteration: 1
Fixed this run: 0 files

## Open Violations Queue
None found. All audited patterns confirmed clean.

## Fixed This Run
None.

## Confirmed Clean Files

### Pages
- src/app/(dashboard)/page.tsx — streaming SSR with Suspense, no params
- src/app/(dashboard)/pools/page.tsx — streaming SSR with Suspense, no params
- src/app/(dashboard)/workflows/page.tsx — searchParams: Promise<...> correctly typed, streaming SSR
- src/app/(dashboard)/resources/page.tsx — searchParams: Promise<...> correctly typed, streaming SSR
- src/app/(dashboard)/datasets/page.tsx — searchParams: Promise<...> correctly typed, streaming SSR
- src/app/(dashboard)/datasets/[bucket]/page.tsx — params: Promise<...> awaited correctly (async function)
- src/app/(dashboard)/datasets/[bucket]/[name]/page.tsx — params: Promise<...> awaited, generateMetadata awaits params
- src/app/(dashboard)/workflows/[name]/page.tsx — params/searchParams: Promise<...> correctly typed, streaming SSR
- src/app/(dashboard)/log-viewer/page.tsx — searchParams: Promise<...> awaited correctly
- src/app/(dashboard)/experimental/page.tsx — no params, redirect in server component correct
- src/app/(dashboard)/profile/page.tsx — no params, clean server component

### Layouts
- src/app/layout.tsx — correct root layout, Suspense for PPR, next/font correctly used
- src/app/(dashboard)/layout.tsx — thin server component, no client APIs
- src/app/(dashboard)/pools/layout.tsx — metadata-only layout, correct
- src/app/(dashboard)/resources/layout.tsx — metadata-only layout, correct
- src/app/(dashboard)/workflows/layout.tsx — metadata-only layout, correct
- src/app/(dashboard)/profile/layout.tsx — metadata-only layout, correct

### Error Files
- src/app/(dashboard)/error.tsx — "use client" directive correct, receives error/reset props
- src/app/(dashboard)/pools/error.tsx — "use client" directive correct
- src/app/(dashboard)/resources/error.tsx — "use client" directive correct
- src/app/(dashboard)/workflows/error.tsx — "use client" directive correct
- src/app/(dashboard)/datasets/error.tsx — "use client" directive correct
- src/app/(dashboard)/profile/error.tsx — "use client" directive correct
- src/app/(dashboard)/workflows/[name]/error.tsx — "use client" directive correct
- src/app/(dashboard)/datasets/[bucket]/[name]/error.tsx — "use client" directive correct

### Route Handlers
- src/app/health/route.ts — clean GET handler, server-only, no client APIs
- src/app/api/health/route.ts — clean GET handler, server-only
- src/app/api/me/route.ts — clean GET handler, server-only
- src/app/api/auth/refresh/route.ts — clean POST handler, server-only, no client APIs
- src/app/api/[...path]/route.ts — thin re-export wrapper, correct turbopack aliasing
- src/app/api/datasets/file-proxy/route.ts — clean GET/HEAD handlers
- src/app/api/datasets/location-files/route.ts — clean GET handler

### Server Components (with-data)
- src/app/(dashboard)/datasets/datasets-with-data.tsx — async server component, awaits searchParams, HydrationBoundary correct
- src/app/(dashboard)/workflows/workflows-with-data.tsx — async server component, awaits searchParams, HydrationBoundary correct
- src/app/(dashboard)/resources/resources-with-data.tsx — async server component pattern
- src/app/(dashboard)/pools/pools-with-data.tsx — async server component pattern
- src/app/(dashboard)/dashboard-with-data.tsx — async server component pattern

### Client Components (app-level)
- src/app/(dashboard)/datasets/datasets-page-content.tsx — "use client", no server APIs, correct
- src/app/(dashboard)/workflows/workflows-page-content.tsx — "use client", no server APIs, correct
- src/app/(dashboard)/dashboard-content.tsx — "use client", Date.now() correctly in useEffect with useState(null), SSR-safe
- src/app/(dashboard)/datasets/components/table/datasets-data-table.tsx — "use client", useSearchParams() in useEffect only (SSR-safe), wrapped in Suspense at page level
- src/app/(dashboard)/workflows/components/table/workflows-data-table.tsx — "use client", useSearchParams() in useEffect only (SSR-safe), wrapped in Suspense at page level

### Special Cases
- src/app/(dashboard)/workflows/[name]/components/SnapZoneIndicator.tsx — "use client", document access guarded by useMounted() hook, correct
- src/app/(dashboard)/workflows/[name]/components/shell/ShellNavigationGuard.tsx — "use client", window/document access inside useEffect only, correct
- src/app/(dashboard)/workflows/[name]/components/panel/workflow/spec/SpecToolbar.tsx — "use client", document.createElement inside useCallback event handler, correct
- src/app/(dashboard)/workflows/[name]/components/WorkflowDAGContent.tsx — "use client", window.innerWidth guarded with typeof window !== "undefined", correct
- src/app/(dashboard)/workflows/[name]/lib/status.tsx — "use client", document.documentElement access inside useMemo returns function (not called at render time), acceptable

## Key Patterns Verified

### N1 (RSC Boundary) — CLEAN
- All server components (layouts, pages) free of client-only APIs (useState, useEffect, onClick, window)
- All client component features properly marked "use client"

### N3 (Async Params) — CLEAN
- All dynamic routes use params: Promise<{...}> typing
- All async page components properly await params before use
- generateMetadata also awaits params correctly
- WorkflowDetailPage passes Promise<params> to children (streaming pattern) — correct

### N4 (Async cookies/headers) — CLEAN
- No synchronous cookies() or headers() calls found
- Route handlers use request.cookies.get() (NextRequest API — correct)

### N5 (Hydration Safety - localStorage/window) — CLEAN
- localStorage access uses SSR-safe selectors from @/stores/shared-preferences-store
- window access guarded with typeof window !== "undefined" or useMounted()
- document access inside useEffect or guarded event handlers only

### N6 (Non-deterministic values) — CLEAN
- Date.now() in dashboard-content.tsx correctly in useEffect with useState(null) initialization
- No Math.random() or crypto.randomUUID() in render paths

### Suspense / CSR Bailout — CLEAN
- useSearchParams() usage in datasets-data-table.tsx and workflows-data-table.tsx is:
  1. In "use client" components (correct)
  2. Inside useEffect only (never during render)
  3. Both components rendered within Suspense boundary via page.tsx → DatasetsWithData/WorkflowsWithData → client components
- loading.tsx files present for routes with async data: (dashboard)/loading.tsx, log-viewer/loading.tsx

## Verification
pnpm type-check: ✅ (zero errors)
pnpm lint: ✅ (1 warning in scripts/check-licenses.mjs — build script, out of scope)
