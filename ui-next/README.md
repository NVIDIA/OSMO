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

### API Generation
```bash
pnpm generate-api           # Regenerate API client from backend source
```
This runs Bazel to export OpenAPI spec, then orval to generate TypeScript.

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

## Troubleshooting

| Issue | Fix |
|-------|-----|
| 401 / Token refresh fails | Set `AUTH_CLIENT_SECRET`, re-paste cookies |
| CORS errors | Check `next.config.ts` rewrites |
| Types out of sync | `pnpm generate-api && pnpm type-check` |
| Backend quirks | See `src/lib/api/adapter/backend_todo.md` |
| shadcn/ui issues | Check `components.json` config |

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
