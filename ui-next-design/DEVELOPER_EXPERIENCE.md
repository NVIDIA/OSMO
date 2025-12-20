# OSMO UI Developer Experience

> How to set up the project and the day-to-day development workflow

---

## Prerequisites

Before setting up the project, ensure you have:

| Tool | Version | Check Command | Install |
|------|---------|---------------|---------|
| **Node.js** | ≥22.0.0 | `node --version` | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| **pnpm** | ≥9.0.0 | `pnpm --version` | `npm install -g pnpm` |
| **Git** | Any | `git --version` | Pre-installed on most systems |

---

## Quick Setup (TL;DR)

If the project is already set up, just run:

```bash
cd external/ui-next
pnpm install      # Install dependencies
pnpm dev          # Start dev server at http://localhost:3000
```

If starting from scratch, run all commands below or follow the detailed steps:

```bash
cd external/ui-next

# Create project (if empty directory)
pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --yes

# Install dependencies
pnpm add @tanstack/react-query @tanstack/react-table @tanstack/react-virtual react-hook-form @hookform/resolvers zod next-themes lucide-react clsx tailwind-merge class-variance-authority
pnpm add -D orval eslint-plugin-jsx-a11y

# Setup shadcn/ui
pnpm dlx shadcn@latest init --defaults --force
pnpm dlx shadcn@latest add button dialog dropdown-menu input label select tabs sonner tooltip command --yes

# Create .env.local (copy from ui/.env.local or ask team)
cp ../ui/.env.local .env.local

# Start development
pnpm dev
```

---

## What's Installed

| Category | Package | Version | Purpose |
|----------|---------|---------|---------|
| **Framework** | next | 16.1.0 | React framework with App Router, Turbopack |
| **UI Library** | react | 19.2.3 | React 19 with new features |
| **Styling** | tailwindcss | 4.1.x | Utility-first CSS |
| **Components** | shadcn/ui | Latest | Accessible component library (via Radix) |
| **State** | @tanstack/react-query | 5.x | Server state management |
| **Tables** | @tanstack/react-table | 8.x | Headless table utilities |
| **Virtualization** | @tanstack/react-virtual | 3.x | Virtual scrolling for large lists |
| **Forms** | react-hook-form + zod | 7.x + 4.x | Form state + validation |
| **Theming** | next-themes | 0.4.x | Dark/light mode |
| **Icons** | lucide-react | 0.5x | Icon library |
| **API Codegen** | orval | 7.x | Generate TypeScript from OpenAPI |
| **Toasts** | sonner | 2.x | Toast notifications |

---

## Project Structure

```
external/ui-next/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── layout.tsx          # Root layout
│   │   ├── page.tsx            # Home page
│   │   └── globals.css         # Global styles + CSS variables
│   ├── components/
│   │   └── ui/                 # shadcn/ui components
│   │       ├── button.tsx
│   │       ├── command.tsx     # Command palette (⌘K)
│   │       ├── dialog.tsx
│   │       ├── dropdown-menu.tsx
│   │       ├── input.tsx
│   │       ├── label.tsx
│   │       ├── select.tsx
│   │       ├── sonner.tsx      # Toast notifications
│   │       ├── tabs.tsx
│   │       └── tooltip.tsx
│   └── lib/
│       ├── api/
│       │   ├── fetcher.ts      # Custom fetch wrapper for orval
│       │   └── generated.ts    # Generated API client (after running orval)
│       └── utils.ts            # Utility functions (cn, etc.)
├── public/                     # Static assets
├── .cursorrules                # AI assistant rules
├── .env.local                  # Environment variables (not committed)
├── components.json             # shadcn/ui configuration
├── orval.config.ts             # API code generation config
├── next.config.ts              # Next.js configuration
├── package.json                # Dependencies and scripts
├── tailwind.config.ts          # Tailwind configuration (auto-generated)
├── tsconfig.json               # TypeScript configuration
├── DEVELOPER_EXPERIENCE.md     # This file
├── INFORMATION_ARCHITECTURE.md # UI structure planning
└── REDESIGN_PLAN.md            # Overall design decisions
```

---

## Project Setup (Detailed Steps)

### Step 1: Navigate to the UI directory

```bash
cd external/ui-next
```

### Step 2: Create the Next.js project

```bash
# Create Next.js project with TypeScript, Tailwind, ESLint, App Router
# As of Dec 2024: installs Next.js 16 with React 19
pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --yes
```

### Step 3: Install additional dependencies

```bash
# Core dependencies
pnpm add @tanstack/react-query @tanstack/react-table @tanstack/react-virtual
pnpm add react-hook-form @hookform/resolvers zod
pnpm add next-themes lucide-react
pnpm add clsx tailwind-merge class-variance-authority

# Development dependencies
pnpm add -D orval @types/node
pnpm add -D eslint-plugin-jsx-a11y
```

### Step 4: Initialize shadcn/ui

```bash
# Initialize shadcn/ui (creates components.json, updates tailwind config)
pnpm dlx shadcn@latest init --defaults --force
```

### Step 5: Add base shadcn/ui components

```bash
# Add essential components (sonner is the modern toast replacement)
pnpm dlx shadcn@latest add button dialog dropdown-menu input label select tabs sonner tooltip command --yes
```

### Step 6: Create environment file

```bash
# Create .env.local for local development
cat > .env.local << 'EOF'
# Backend connection
NEXT_PUBLIC_OSMO_API_HOSTNAME=fernandol-dev.osmo.nvidia.com
NEXT_PUBLIC_OSMO_SSL_ENABLED=true

# Auth (get from existing ui/.env.local or team)
AUTH_CLIENT_SECRET="your-client-secret-here"
EOF
```

### Step 7: Update package.json scripts

The following scripts should be in your `package.json`:

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "dev:local": "NEXT_PUBLIC_OSMO_API_HOSTNAME=localhost:8000 NEXT_PUBLIC_OSMO_SSL_ENABLED=false next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "lint:a11y": "eslint --plugin jsx-a11y src/",
    "type-check": "tsc --noEmit",
    "generate-api": "orval",
    "generate-api:remote": "curl https://$NEXT_PUBLIC_OSMO_API_HOSTNAME/api/openapi.json -o openapi.json && orval"
  }
}
```

### Step 8: Create orval config

```bash
# Create orval.config.ts for API code generation
cat > orval.config.ts << 'EOF'
import { defineConfig } from 'orval';

export default defineConfig({
  osmo: {
    input: {
      target: './openapi.json',
    },
    output: {
      target: './src/lib/api/generated.ts',
      client: 'react-query',
      mode: 'single',
      override: {
        mutator: {
          path: './src/lib/api/fetcher.ts',
          name: 'customFetch',
        },
      },
    },
  },
});
EOF
```

### Step 9: Create the custom fetcher

```bash
mkdir -p src/lib/api

cat > src/lib/api/fetcher.ts << 'EOF'
export const customFetch = async <T>(
  url: string,
  options?: RequestInit
): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
};
EOF
```

### Step 10: Create .cursorrules

```bash
cat > .cursorrules << 'EOF'
# OSMO UI Development Rules

## Tech Stack
- Next.js 16+ with App Router and Turbopack
- TypeScript strict mode
- Tailwind CSS 4 with CSS variables
- shadcn/ui components (in src/components/ui/)
- TanStack Query for server state
- API client generated by orval (in src/lib/api/)

## Patterns
- React Server Components by default
- 'use client' only when needed (interactivity, hooks)
- Composition over inheritance
- All components must be accessible (ARIA)

## API Usage
- Import hooks from @/lib/api/generated
- Never write manual fetch calls for OSMO API
- Error handling is automatic via QueryClient config
- Use Suspense for loading states where appropriate

## Styling
- Tailwind classes only (no CSS modules)
- Use CSS variables from globals.css for theming
- Mobile-first responsive design

## File Structure
- src/app/ - Next.js App Router pages
- src/components/ui/ - shadcn/ui base components
- src/components/ - app-specific components
- src/lib/ - utilities and configurations
- src/lib/api/ - generated API client
EOF
```

### Step 11: Start development server

```bash
pnpm dev
```

Open http://localhost:3000 in your browser.

---

## Quick Start Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (http://localhost:3000) |
| `pnpm build` | Production build |
| `pnpm lint` | Run ESLint |
| `pnpm type-check` | Check TypeScript errors |
| `pnpm generate-api` | Regenerate API client from local openapi.json |
| `pnpm generate-api:remote` | Fetch latest spec and regenerate |

---

## Overview

With OpenAPI code generation (using a tool called orval), the FastAPI backend is the **single source of truth** for API types. TypeScript becomes your compatibility checker - breaking changes surface as compile errors, not runtime surprises.

### Key Terms

| Term | Meaning |
|------|---------|
| **OpenAPI** | Standard format for describing REST APIs. FastAPI generates this automatically at `/api/openapi.json` |
| **orval** | Tool that reads the OpenAPI spec and generates TypeScript code |
| **Generated client** | TypeScript functions and types created by orval - you don't write these manually |
| **TanStack Query hooks** | React functions like `useGetWorkflows()` that handle fetching, caching, and error states |

---

## Developer Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                       Daily Workflow                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Start dev server                                            │
│     $ pnpm dev                                                  │
│                                                                 │
│  2. Work on UI features                                         │
│     - Import hooks from @/lib/api                               │
│     - Full autocomplete and type safety                         │
│                                                                 │
│  3. Backend team ships API changes                              │
│     - "Hey, we updated the workflow endpoint"                   │
│                                                                 │
│  4. Regenerate client                                           │
│     $ pnpm generate-api                                         │
│                                                                 │
│  5. TypeScript shows any breaking changes                       │
│     $ pnpm tsc --noEmit                                         │
│     - Fix errors OR use new features                            │
│                                                                 │
│  6. Commit: code changes + openapi.json + generated client      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Common Scenarios

### Scenario 1: Backend Adds a New Field (Non-Breaking)

```python
# Backend adds 'priority' field to Workflow
class Workflow(BaseModel):
    name: str
    status: str
    priority: str  # NEW
```

**What you do:**

```bash
pnpm generate-api
```

**Result:**

```typescript
// New field is immediately available and typed
const { data } = useGetWorkflow(name);
data.priority  // ✅ Works, fully typed
```

**Code changes needed:** Zero (unless you want to use the new field)

---

### Scenario 2: Backend Removes a Field (Breaking)

```python
# Backend removes 'legacy_id' field
class Workflow(BaseModel):
    name: str
    status: str
    # legacy_id: str  # REMOVED
```

**What you do:**

```bash
pnpm generate-api
pnpm tsc --noEmit  # Check for errors
```

**Result:**

```typescript
function WorkflowCard({ workflow }: { workflow: Workflow }) {
  return <div>{workflow.legacy_id}</div>;  
  //                      ^^^^^^^^^^
  // ❌ TS Error: Property 'legacy_id' does not exist on type 'Workflow'
}
```

**Code changes needed:** Fix all TypeScript errors (compiler tells you exactly where)

---

### Scenario 3: Backend Changes Field Type (Breaking)

```python
# Backend changes 'submitted_at' from string to datetime
class Workflow(BaseModel):
    submitted_at: datetime  # Was: str
```

**What you do:**

```bash
pnpm generate-api
```

**Result:**

```typescript
// Before
const dateStr: string = workflow.submitted_at;  // ✅ Worked

// After regeneration
const dateStr: string = workflow.submitted_at;  
// ❌ TS Error: Type 'Date' is not assignable to type 'string'
```

**Code changes needed:** Update type usages where compiler indicates

---

### Scenario 4: Backend Adds New Endpoint

```python
# Backend adds new endpoint
@router.get("/api/workflow/{name}/metrics")
def get_workflow_metrics(name: str) -> WorkflowMetrics:
    ...
```

**What you do:**

```bash
pnpm generate-api
```

**Result:**

```typescript
// New hook is automatically available
import { useGetWorkflowMetrics } from '@/lib/api';

const { data } = useGetWorkflowMetrics(workflowName);
// Fully typed, ready to use
```

**Code changes needed:** Zero (new functionality just becomes available)

---

### Scenario 5: Backend Removes Endpoint (Breaking)

**What you do:**

```bash
pnpm generate-api
```

**Result:**

```typescript
import { useGetLegacyData } from '@/lib/api';
//       ^^^^^^^^^^^^^^^^^
// ❌ TS Error: Module has no exported member 'useGetLegacyData'
```

**Code changes needed:** Remove usage of deleted endpoint

---

## How Much Code Do You Write?

| Task | Lines of Code |
|------|---------------|
| Use existing endpoint | 1 line (import + use hook) |
| Use new endpoint | 1 line + `pnpm generate-api` |
| Handle breaking change | Only the places that used changed/removed fields |
| Add new API wrapper | 0 (it's generated) |

### Example: Using an Endpoint

```typescript
// That's it. Full type safety, error handling, caching.
const { data, isLoading, error } = useGetWorkflows({ limit: 50 });
```

---

## Before vs After Comparison

| Task | Before (tRPC) | After (OpenAPI codegen) |
|------|---------------|------------------------|
| Add new endpoint | Write router + Zod schema (~50 lines) | `pnpm generate-api` |
| Use new field | Manually update Zod schema | `pnpm generate-api` |
| Detect breaking change | Runtime error in prod 💥 | TypeScript error at build ✅ |
| Keep types in sync | Manual, error-prone | Automatic |
| Total wrapper code | ~1500 lines in routers | ~0 lines |

---

## CI/CD Integration

### Detecting API Drift in PRs

```yaml
# .github/workflows/ui-api-check.yml
name: API Compatibility Check

on:
  pull_request:
    paths:
      - 'external/src/service/**'  # Backend changes

jobs:
  check-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup
        run: |
          cd external/ui-next
          pnpm install
          
      - name: Generate fresh client from backend
        run: |
          # Start backend or use deployed dev instance
          cd external/ui-next
          curl $API_URL/api/openapi.json -o openapi.json
          pnpm generate-api
          
      - name: Check for uncommitted changes
        run: |
          if [[ -n $(git status --porcelain external/ui-next/src/lib/api) ]]; then
            echo "❌ API client is out of sync!"
            echo "Run 'pnpm generate-api' and commit the changes"
            git diff external/ui-next/src/lib/api
            exit 1
          fi
          
      - name: Type check UI
        run: |
          cd external/ui-next
          pnpm tsc --noEmit
```

**Result:** Backend PRs that break the UI will fail CI before merge.

---

## OpenAPI.json Versioning

### Should you commit `openapi.json`?

**Yes.** Benefits:

- **Reproducible builds** - CI doesn't need running backend
- **Clear diffs** - Git shows exactly what API changed
- **Documentation** - Spec is always in sync with code

### What PR diffs look like

```diff
# API spec changed
modified:   external/ui-next/openapi.json

# Generated code updated
modified:   external/ui-next/src/lib/api/workflows.ts
modified:   external/ui-next/src/lib/api/types.ts

# Your fixes for any breaking changes
modified:   external/ui-next/src/app/workflows/page.tsx
```

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server with hot reload (changes appear instantly in browser) |
| `pnpm generate-api` | Regenerate TypeScript client from local `openapi.json` |
| `pnpm generate-api:remote` | Fetch latest API spec from remote backend and regenerate client |
| `pnpm tsc --noEmit` | Check for TypeScript errors without building |
| `pnpm build` | Production build (includes type checking) |

---

## Troubleshooting

### "Types don't match what I see in the API"

```bash
# Regenerate from the running backend
pnpm generate-api:remote
```

### "New endpoint isn't showing up"

1. Check backend has the endpoint deployed
2. Check OpenAPI spec includes it: `curl $API_URL/api/openapi.json | grep "endpoint-name"`
3. Regenerate: `pnpm generate-api:remote`

### "Getting runtime errors but types look correct"

The OpenAPI spec might be incomplete. Check:
1. Backend has proper response models defined
2. Error responses are documented in spec
3. Regenerate after backend fixes

---

## Summary

| Question | Answer |
|----------|--------|
| How do I detect breaking changes? | TypeScript compiler errors after regenerating |
| How much code to add for new endpoint? | Zero - regenerate and use |
| How much code to fix breaking change? | Only places that used changed/removed fields |
| Can CI catch API drift? | Yes - compare generated code, fail if different |
| Is it automatic? | Semi-automatic - one command, fix any TS errors |

**Key insight:** TypeScript is your compatibility checker. Breaking changes become compile errors, not runtime surprises.
