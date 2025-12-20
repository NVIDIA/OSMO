# OSMO UI Developer Experience

## Prerequisites

| Tool | Version | Check | Install |
|------|---------|-------|---------|
| Node.js | ≥22 | `node -v` | `nvm install 22` |
| pnpm | ≥9 | `pnpm -v` | `npm install -g pnpm` |
| Bazel | 8.x | `bazel --version` | Required for API codegen |

---

## Quick Start

```bash
cd external/ui-next
pnpm install
pnpm dev          # http://localhost:3000
```

---

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (Turbopack, hot reload) |
| `pnpm dev:local` | Dev server pointing to localhost:8000 |
| `pnpm build` | Production build |
| `pnpm type-check` | TypeScript check |
| `pnpm lint` | ESLint |
| `pnpm generate-api` | Regenerate API client from source |

---

## API Client Generation

The TypeScript API client is generated from the FastAPI backend source code via Bazel.

```bash
pnpm generate-api
```

This runs:
1. `bazel run //src/service:export_openapi` → `openapi.json`
2. `orval` → `src/lib/api/generated.ts`

**Benefits:**
- API client is always in sync with the same git commit
- No need for a running backend
- TypeScript errors surface breaking changes at compile time

---

## Using the API Client

```typescript
import { useGetVersionApiVersionGet } from "@/lib/api/generated";

function MyComponent() {
  const { data, isLoading, error } = useGetVersionApiVersionGet();
  // Fully typed, cached, error handling included
}
```

---

## Project Structure

```
external/ui-next/
├── src/
│   ├── app/                  # Next.js pages
│   ├── components/
│   │   ├── ui/               # shadcn/ui components
│   │   └── providers.tsx     # QueryClient provider
│   └── lib/
│       ├── api/
│       │   ├── fetcher.ts    # Custom fetch for orval
│       │   └── generated.ts  # Generated API client
│       └── utils.ts
├── openapi.json              # Generated from backend source
├── orval.config.ts           # orval configuration
├── next.config.ts            # API proxy configuration
└── package.json
```

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19 |
| Styling | Tailwind CSS 4 |
| Components | shadcn/ui + Radix |
| State | TanStack Query 5 |
| Forms | React Hook Form + Zod |
| Tables | TanStack Table |
| API Codegen | orval (from OpenAPI) |

---

## Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_OSMO_API_HOSTNAME=fernandol-dev.osmo.nvidia.com
NEXT_PUBLIC_OSMO_SSL_ENABLED=true
```

The Next.js proxy (`next.config.ts`) forwards `/api/*` to this host.

---

## When Backend API Changes

```bash
# Regenerate client from source
pnpm generate-api

# Check for breaking changes
pnpm type-check

# Fix any TypeScript errors, then commit:
# - openapi.json
# - src/lib/api/generated.ts
# - Your fixes
```

---

## Troubleshooting

**API client out of sync:**
```bash
pnpm generate-api
```

**TypeScript errors after regeneration:**
The API changed. Fix the errors where the compiler indicates.

**Bazel build fails:**
```bash
cd .. && bazel build //src/service:export_openapi
```
