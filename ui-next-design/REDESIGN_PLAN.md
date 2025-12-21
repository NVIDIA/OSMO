# OSMO UI Radical Redesign Plan

> **Status**: Planning Phase
> **Last Updated**: December 2025

## Overview

Rebuilding OSMO's UI from scratch with new information architecture, modern tooling optimized for fast iteration with Cursor AI.

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Repository** | Monorepo (`external/ui-next/`) | Mixed team, tightly coupled API, shared Helm deployment |
| **Build System** | pnpm + Docker (no Bazel) | Fast iteration (~2s vs 30s+), instant hot reload |
| **Framework** | Next.js 16 (App Router) | Required for auth, Turbopack default, Cache Components, excellent ecosystem |
| **API Layer** | OpenAPI codegen + orval | Single source of truth, typed client, no tRPC |
| **Components** | shadcn/ui + Radix | Ownable, accessible, customizable |
| **Styling** | Tailwind CSS 4 | CSS variables for theming |
| **State** | TanStack Query | Caching, mutations, error handling |
| **Tables** | TanStack Table + Virtual | Headless primitives, virtualization for large lists |
| **Forms** | React Hook Form + Zod | Mature, type-safe, well-documented |
| **Extensibility** | Layered (core → headless → themed) | External teams build on headless, we ship complete theme |
| **Package Strategy** | Single repo, clear boundaries | Don't over-engineer; can extract packages later if needed |
| **Accessibility** | WCAG 2.1 AA + eslint-plugin-jsx-a11y | Radix handles most a11y; CI linting catches regressions |

---

## Open Decisions

### 1. Theme Aesthetic (Experiment Later)

**Audience**: ML engineers, AI researchers - technical users who spend long hours viewing logs, metrics, terminals.

**Inspirations to reference**:
| Tool | What to Borrow |
|------|----------------|
| [Linear](https://linear.app) | Dark mode default, command palette (Cmd+K), subtle gradients |
| [Vercel](https://vercel.com/dashboard) | Build/deploy as first-class, timeline logs, real-time status |
| [Grafana](https://grafana.com) | Data-dense dashboards, color-coded severity |
| [GitHub Actions](https://github.com/features/actions) | DAG visualization, expandable log groups |
| [Weights & Biases](https://wandb.ai) | ML-native, experiment comparison, artifact browsing |
| [Railway](https://railway.app) | Playful but professional, terminal-inspired |

**Color palette options**:

| Option | Accent Color | Vibe | Consideration |
|--------|-------------|------|---------------|
| **A: NVIDIA Brand** | `#76b900` (NVIDIA Green) | Corporate, professional | Green may conflict with "success" semantics |
| **B: Terminal** | `#58a6ff` (GitHub blue) | Developer-native | Less distinctive |
| **C: Modern Minimal** | `#7c3aed` (Purple) | Linear/Vercel style | Less NVIDIA-branded |
| **D: Warm Technical** | `#f97316` (Orange) | Energetic, easier on eyes | May conflict with "warning" |

**Typography candidates**:
- UI: Geist, Inter, or SF Pro
- Code/Logs: JetBrains Mono, Fira Code, or Berkeley Mono

**Decisions to make after seeing prototypes**:
- [ ] NVIDIA branding prominence (subtle vs. prominent)
- [ ] Information density (dense vs. spacious)
- [ ] Terminal integration (embedded vs. pop-out)
- [ ] Default theme (dark vs. system preference)

---

## Extensibility Architecture

OSMO is open source. External companies will want to build custom UIs on top of it.

### Design Philosophy

```
┌─────────────────────────────────────────────────────────────────┐
│  "Do you want to invest in custom UI?"                          │
│                                                                 │
│     NO ───────────►  Use OSMO Default Theme (deploy as-is)      │
│                                                                 │
│     YES ──────────►  Build on Core + Headless (your design)     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**No middle ground.** We don't support "just change the logo" customization. Either:
- Deploy our complete, opinionated UI
- Use our foundation layers to build your own

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Default Theme (src/components/, src/app/)                      │
│  - Complete, styled, ready-to-deploy                            │
│  - What OSMO ships and uses internally                          │
│  - Built on top of headless layer                               │
└─────────────────────────────────────────────────────────────────┘
                          │ uses
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Headless Layer (src/headless/)                                 │
│  - Behavior without styling                                     │
│  - useWorkflowList, useDatasetBrowser, useTaskMonitor           │
│  - Accessibility, keyboard navigation, state management         │
│  - External teams use this to build custom themes               │
└─────────────────────────────────────────────────────────────────┘
                          │ uses
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Core Layer (src/core/)                                         │
│  - Generated API client (orval)                                 │
│  - Auth utilities                                               │
│  - Types, hooks, utilities                                      │
│  - Always used by everyone                                      │
└─────────────────────────────────────────────────────────────────┘
```

### Package Strategy

**Single repo with clear boundaries** (not separate npm packages):

- Simpler development and iteration
- Boundaries enforced via directory structure and exports
- Can extract to packages later if external demand warrants it
- Don't over-engineer for users that don't exist yet

```typescript
// Path aliases allow future extraction without breaking imports
// tsconfig.json
{
  "paths": {
    "@osmo/core": ["./src/core"],
    "@osmo/headless": ["./src/headless"]
  }
}
```

### What External Teams Get

**If they deploy OSMO as-is:** A complete, working UI.

**If they build their own theme:**

```typescript
// Import our behavior, bring their own styling
import { useWorkflowList } from '@osmo/headless';

function AcmeWorkflowList() {
  const { workflows, getItemProps, pagination } = useWorkflowList({ ... });

  return (
    <AcmeCard>
      {workflows.map(w => (
        <AcmeListItem {...getItemProps(w)}>
          {/* Their design, our logic */}
        </AcmeListItem>
      ))}
    </AcmeCard>
  );
}
```

---

## API Layer Architecture

### Overview

```
┌─────────────┐    same origin    ┌─────────────┐   server-to-server   ┌─────────────┐
│   Browser   │ ────────────────▶ │   Next.js   │ ──────────────────▶  │   FastAPI   │
│   (React)   │   /api/workflow   │   (proxy)   │   rewrite to API     │   (Python)  │
└─────────────┘                   └─────────────┘                      └─────────────┘
       │                                                                      │
       │                                                                      ▼
       ▼                                                            /api/openapi.json
  Generated Client  ◀──────────────────────────────────────────────────────────┘
  (orval + TanStack Query hooks)
```

### How It Works

1. **FastAPI** exposes OpenAPI spec at `/api/openapi.json`
2. **orval** generates TypeScript types + TanStack Query hooks
3. **Next.js rewrites** proxy `/api/*` to FastAPI (avoids CORS)
4. **Browser** only talks to Next.js (same origin) - no CORS headers needed
5. **No tRPC** - delete all `src/server/api/` routers (~1500 lines gone)

### Next.js Proxy Config

```javascript
// next.config.mjs
const API_URL = `${scheme}://${env.NEXT_PUBLIC_OSMO_API_HOSTNAME}`;

export default {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
    ];
  },
};
```

### Generated Client Usage

```typescript
// Auto-generated by orval
export function useGetWorkflows(params?: GetWorkflowsParams) {
  return useQuery({
    queryKey: ['workflows', params],
    queryFn: () => getWorkflows(params),
  });
}

// Usage in component - that's it
const { data, error, isLoading } = useGetWorkflows({ limit: 50 });
```

### Error Handling Strategy

**Layer 1: Generated Client** - Throws typed errors on non-2xx responses

```typescript
// Auto-generated error type from OpenAPI
interface ApiError {
  message: string;
  error_code?: string;
}
```

**Layer 2: Global Query Config** - Handles errors once, applies everywhere

```typescript
// src/lib/query-client.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 3;
      },
    },
    mutations: {
      onError: (error) => {
        if (error instanceof ApiError) {
          toast.error(error.message);
        }
      },
    },
  },
});
```

**Layer 3: Error Boundaries** - Catch unexpected crashes

```tsx
// Wrap app/layout once
<QueryErrorBoundary>
  {children}
</QueryErrorBoundary>
```

**Result:** Zero manual error wrapping per endpoint. Errors handled automatically.

---

## Component Library Architecture

### Decision: shadcn/ui + Radix

| Component | Meaning |
|-----------|---------|
| **Radix UI** | Unstyled, accessible "headless" primitives (the engine) - handles ARIA, keyboard nav, focus trapping |
| **shadcn/ui** | CLI that copies Tailwind-styled components using Radix into your project (the body kit) |

**Key insight:** shadcn/ui is NOT a package you `npm install`. It copies component source code directly into your project, giving you full ownership:

```bash
npx shadcn-ui@latest add button dialog select switch
# Creates files like components/ui/button.tsx that you own and can modify
```

### Why This Wins

| Benefit | Details |
|---------|---------|
| **Full code ownership** | No black-box dependencies - modify anything |
| **Excellent accessibility** | Radix handles ARIA, keyboard nav, focus trapping automatically |
| **Tailwind-native** | Matches existing styling approach |
| **Composable** | Mix and match, extend components freely |
| **AI-friendly** | Well-documented patterns that Cursor AI understands |
| **Popular & maintained** | Powers Vercel, Linear, Supabase - huge ecosystem |

### Current State Comparison

The existing `external/ui/` has **no component library** - every component is hand-rolled:

| Current Code | Lines | Issues | With shadcn/ui |
|--------------|-------|--------|----------------|
| `FullPageModal.tsx` + focus-trap-react | 67 | Manual focus trapping | `Dialog` - 15 lines, automatic |
| `Select.tsx` (native select) | 75 | No search, limited styling | `Select` - searchable, keyboard nav |
| `Switch.tsx` (manual ARIA) | 81 | Manual state/accessibility | `Switch` - 5 lines, perfect a11y |
| `Multiselect.tsx` | 155 | Custom implementation | `Combobox` with multi-select mode |
| No dropdown menus | - | - | `DropdownMenu` with keyboard nav |
| No toast/notifications | - | - | `Toast` - stackable notifications |
| No tooltips | - | - | `Tooltip` - accessible hover tips |
| No command palette | - | - | `Command` (cmdk) - spotlight search |

**Current dependencies:**
- `focus-trap-react` - manual focus trapping (Radix includes this)
- `material-icons` - icon library (can keep or switch to Lucide)
- No headless UI library

### Bundle Impact

Radix adds ~50-80KB to the bundle, but this is offset by:
- Removing `focus-trap-react`
- Not building complex primitives from scratch
- Consistent behavior across all components
- Reduced maintenance burden

---

## Accessibility & WCAG 2.1 Compliance

OSMO has committed to WCAG 2.1 compliance. The previous UI required significant manual effort to achieve this (see [PR #73](https://github.com/NVIDIA/OSMO/commit/82004ac9f57268026105605559c68d9fe099b9b3)). The redesign makes accessibility easier to maintain.

### How shadcn/ui + Radix Helps

| WCAG Requirement | Previous (Manual) | With Radix (Automatic) |
|-----------------|-------------------|----------------------|
| **Focus management** | `focus-trap-react` + manual code | Built into Dialog, Popover, etc. |
| **Keyboard navigation** | Manual `onKeyDown` handlers | Built into all components |
| **ARIA attributes** | Manual `aria-label`, `aria-expanded`, etc. | Automatically managed |
| **Focus indicators** | Manual `:focus-visible` styling | Consistent via Tailwind |
| **Screen reader announcements** | Manual `aria-live` regions | Built into Toast, etc. |
| **Role attributes** | Manual `role="list"`, `role="dialog"` | Automatically applied |

### Lessons from Previous Accessibility Work

The [WCAG 2.1 compliance PR](https://github.com/NVIDIA/OSMO/commit/82004ac9f57268026105605559c68d9fe099b9b3) addressed:

| Issue | Fix Applied | How to Avoid in Redesign |
|-------|-------------|-------------------------|
| 400% zoom breakage | Responsive layout fixes | Use Tailwind responsive classes consistently |
| Missing `aria-label` on SlideOut | Added aria props | Radix provides these automatically |
| Missing `role="list"` on gauges | Added role attributes | Use semantic HTML + Radix primitives |
| Checkbox outline issues | Fixed focus styles | shadcn/ui has consistent focus rings |
| Loading state not announced | Added screen reader text | Use `aria-live` regions, Radix Spinner |
| Disabled state confusion | Use `aria-disabled` | Radix handles disabled states correctly |

### Accessibility Checklist for New Components

When building custom components (not from shadcn/ui):

```markdown
## Before Shipping Any Component

- [ ] Keyboard navigable (Tab, Enter, Escape, Arrow keys where appropriate)
- [ ] Focus visible (`:focus-visible` ring)
- [ ] Screen reader tested (VoiceOver on Mac, NVDA on Windows)
- [ ] Color contrast ratio ≥ 4.5:1 for text, ≥ 3:1 for UI elements
- [ ] Works at 400% zoom without horizontal scrolling
- [ ] Interactive elements have accessible names (`aria-label` or visible text)
- [ ] Loading states announced to screen readers
- [ ] Error messages associated with form fields (`aria-describedby`)
- [ ] No content conveyed by color alone
```

### Testing Strategy

| Method | When | Tool |
|--------|------|------|
| **Automated scanning** | Every PR (CI) | axe-core, eslint-plugin-jsx-a11y |
| **Manual keyboard testing** | During development | Tab through all flows |
| **Screen reader testing** | Before major releases | VoiceOver, NVDA |
| **Contrast checking** | Theme changes | Chrome DevTools, Contrast Checker |
| **Zoom testing** | Layout changes | Browser zoom to 400% |

### CI Integration

```bash
# Add to package.json scripts
"lint:a11y": "eslint --plugin jsx-a11y src/"

# Add to CI pipeline
pnpm lint:a11y
```

### Radix Components with Built-in Accessibility

These components from shadcn/ui handle complex accessibility automatically:

| Component | What It Handles |
|-----------|----------------|
| `Dialog` | Focus trap, Escape to close, aria-modal |
| `DropdownMenu` | Arrow key navigation, typeahead, focus management |
| `Select` | Keyboard navigation, screen reader announcements |
| `Tabs` | Arrow key switching, proper tab panel associations |
| `Toast` | aria-live announcements, auto-dismiss timing |
| `Tooltip` | Accessible descriptions, keyboard trigger |
| `Accordion` | Proper expand/collapse semantics |
| `AlertDialog` | Forced focus, confirmation patterns |

### Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Radix Accessibility Docs](https://www.radix-ui.com/primitives/docs/overview/accessibility)
- [axe DevTools Extension](https://www.deque.com/axe/devtools/)

### orval Config

```typescript
// orval.config.ts
export default {
  osmo: {
    input: {
      target: './openapi.json', // or fetch from remote
    },
    output: {
      target: './src/lib/api/client.ts',
      client: 'react-query',
      mode: 'tags-split', // separate files per tag
    },
  },
};
```

### Regenerating Client

```bash
# Fetch latest spec and regenerate
curl https://fernandol-dev.osmo.nvidia.com/api/openapi.json > openapi.json
pnpm generate-api
```

<details>
<summary>Alternatives Considered</summary>

- **tRPC as Backend-for-Frontend (current)**: Duplicates type definitions, extra network hop adds latency, ~1500 lines of wrapper code
- **Direct fetch + manual types**: Types drift from backend, no validation
- **GraphQL**: Overkill, requires building gateway layer
- **gRPC-Web**: Would require backend rewrite, complex proxy setup

</details>

---

## Why Next.js is Required

The UI **cannot be a purely static single-page application** due to the OAuth authentication flow.

### The Auth Flow Requires Server-Side Secrets

```
┌─────────────────────────────────────────────────────────────────┐
│                       OAuth Flow                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User clicks "Login"                                         │
│  2. Browser → /auth/initiate → Returns OAuth URL                │
│  3. Browser → OAuth Provider → User authenticates               │
│  4. OAuth → Browser → /auth/callback?code=xxx                   │
│  5. Server exchanges code for tokens using CLIENT_SECRET        │
│     ↑ This step REQUIRES a server - secret can't be in browser  │
│  6. Server sets cookies, redirects to app                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The `AUTH_CLIENT_SECRET` is used in `/auth/callback` to exchange the OAuth code for tokens. This secret **cannot be exposed in a static JavaScript bundle** - it must stay server-side.

### What Next.js 16 Provides

| Capability | Used For |
|------------|----------|
| API Routes (`/auth/*`) | OAuth token exchange with `CLIENT_SECRET` |
| Rewrites / `proxy.ts` | Proxy `/api/*` to FastAPI (avoids CORS). In Next.js 16, `middleware.ts` is renamed to `proxy.ts` |
| Static/Client React | Most pages are client-side rendered |
| React Server Components | Optional - can render on server for faster initial load if beneficial |
| Turbopack (default) | 2-5x faster builds, 10x faster hot reload - no config needed |
| Cache Components | New opt-in caching model for fine-grained control |

### Why Not Move Auth to FastAPI?

Moving auth to FastAPI would make the UI fully static, but:
- Requires writing ~100+ lines of Python auth code
- More coordination between UI and backend teams
- Minimal benefit since we already run containers
- Local dev becomes harder (need FastAPI running for auth)

**Verdict:** Keep auth in Next.js. The complexity is already there and works.

---

## Tech Stack

| Layer | Tool | Notes |
|-------|------|-------|
| Package Manager | pnpm | Faster installs, better monorepo support |
| Framework | Next.js 16 | App Router, Turbopack (default), React 19.2 |
| Language | TypeScript (strict) | |
| Styling | Tailwind CSS 4 | CSS variables for theming |
| Components | shadcn/ui | Built on Radix, copy-paste ownership |
| API Codegen | orval | Generates TanStack Query hooks from OpenAPI |
| Data Fetching | TanStack Query | Caching, mutations, optimistic updates |
| Forms | React Hook Form + Zod | Mature, well-documented, type-safe validation |
| Tables | TanStack Table | Headless table primitives |
| Virtualization | TanStack Virtual | For long lists (workflows, tasks) |
| Charts | TBD | Add later if needed |
| Animations | Framer Motion | Polish and micro-interactions |

---

## Project Structure

```
external/ui-next/
├── src/
│   ├── core/                    # Layer 1: Foundation (always used)
│   │   ├── api/                 # Generated API client (orval)
│   │   ├── auth/                # Auth provider, hooks, utilities
│   │   ├── hooks/               # Shared React hooks
│   │   ├── utils/               # Utilities
│   │   └── index.ts             # Public exports
│   │
│   ├── headless/                # Layer 2: Behavior without styling
│   │   ├── use-workflow-list.ts
│   │   ├── use-workflow-detail.ts
│   │   ├── use-dataset-browser.ts
│   │   ├── use-task-monitor.ts
│   │   ├── use-resource-pools.ts
│   │   └── index.ts             # Public exports
│   │
│   ├── components/              # Layer 3: Default themed components
│   │   ├── ui/                  # Base components (shadcn/ui)
│   │   └── features/            # Feature components (uses headless)
│   │
│   ├── app/                     # Next.js App Router pages
│   └── styles/                  # Global styles
│
├── public/                      # Static assets
├── openapi.json                 # Cached OpenAPI spec
├── orval.config.ts              # Code generation config
├── .cursorrules                 # Cursor AI instructions
├── .env.example                 # Environment template
├── Dockerfile                   # Production build
├── package.json
└── tsconfig.json                # Includes path aliases for @osmo/core, @osmo/headless
```

---

## Local Development Setup

### Environment Configuration

```bash
# .env.local - Connect to remote dev instance
NEXT_PUBLIC_OSMO_API_HOSTNAME=fernandol-dev.osmo.nvidia.com
NEXT_PUBLIC_OSMO_SSL_ENABLED=true
AUTH_CLIENT_SECRET="<your-client-secret>"
```

### Scripts

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "dev:local": "NEXT_PUBLIC_OSMO_API_HOSTNAME=localhost:8000 NEXT_PUBLIC_OSMO_SSL_ENABLED=false next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "generate-api": "orval",
    "generate-api:remote": "curl $NEXT_PUBLIC_OSMO_API_HOSTNAME/api/openapi.json -o openapi.json && orval"
  }
}
```

---

## Cursor AI Optimization

### .cursorrules

```markdown
# OSMO UI Development Rules

## Tech Stack
- Next.js 16 with App Router and Turbopack
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
- Import hooks from src/lib/api/
- Never write manual fetch calls for OSMO API
- Error handling is automatic via QueryClient config
- Use Suspense for loading states where appropriate

## Styling
- Tailwind classes only (no CSS modules)
- Use CSS variables from globals.css for theming
- Mobile-first responsive design
```

---

## Implementation Phases

### Phase 1: Bootstrap (1-2 days)

| Task | Status |
|------|--------|
| Initialize Next.js 16 + pnpm | ✅ Done |
| Configure Tailwind CSS 4 | ✅ Done |
| Add shadcn/ui with base components | ✅ Done |
| Set up environment switching | ✅ Done |
| Create .cursorrules | ✅ Done |
| Set up orval + generate API client | ✅ Done |
| Configure QueryClient with error handling | ✅ Done |
| Set up eslint-plugin-jsx-a11y for accessibility linting | ✅ Done |
| Create Dockerfile | Pending |

### Phase 2: Core Shell (2-3 days)

| Task | Status |
|------|--------|
| Layout system (header, sidebar, main) | ✅ Done |
| Navigation and routing | ✅ Done |
| Authentication flow | ✅ Done |
| Theme system (light/dark) | ✅ Done |
| Error boundaries and loading states | Pending |

### Phase 3: Feature Migration (iterative)

| Feature | Status |
|---------|--------|
| Workflows (list, detail, submit) | In Progress |
| Datasets (browse, preview) | Pending |
| Resources/Pools | ✅ Done |
| Tasks | Pending |
| Profile/Settings | Pending |

### Phase 4: Polish

| Task | Status |
|------|--------|
| Animations and transitions | Pending |
| Performance optimization | Pending |
| Accessibility audit | Pending |
| Documentation | Pending |

---

## Alternatives Considered

<details>
<summary>Build System</summary>

- **Bazel**: Rejected due to slow iteration loop (~30s+ rebuilds), complex workarounds for node_modules symlinks, poor Cursor AI integration
- **Hybrid Bazel/npm**: Added complexity without sufficient benefit for UI-only work

</details>

<details>
<summary>Framework</summary>

- **Vite + Static Single-Page App**: Faster dev server (~1s vs ~3s), simpler architecture. However, **cannot handle auth** - the OAuth flow requires `AUTH_CLIENT_SECRET` which must stay server-side. Would require moving auth to FastAPI (~100+ lines of Python) or a separate auth service.
- **Vite + TanStack Router**: Same as above, plus type-safe routing. Still blocked by auth requirement.
- **Remix**: Great data loading patterns but smaller ecosystem, less Cursor AI training data.

**Why Next.js won:** Auth requires server-side code. Since we need a server anyway, Next.js provides the best developer experience with Turbopack (fast bundler), App Router, and excellent ecosystem.

</details>

<details>
<summary>Components</summary>

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **shadcn/ui + Radix** (chosen) | Full code ownership, excellent a11y, Tailwind-native, AI-friendly | More files in repo (~50-80KB bundle) | ✅ Best balance |
| **Headless UI** (Tailwind Labs) | Official Tailwind companion, lightweight (~20KB) | Limited component set (missing Accordion, Toast, Tooltip, Slider), no copy-paste pattern | ❌ Too limited |
| **React Aria** (Adobe) | Maximum flexibility (hooks), best-in-class a11y, smallest bundle | Steep learning curve, more boilerplate, not Tailwind-focused | ❌ Too complex |
| **Ariakit** | Good coverage, composable API | Smaller ecosystem, less documentation | ❌ Less mature |
| **MUI / Chakra / Mantine** | Mature, comprehensive, easy to start | Hard to customize deeply, bundle bloat (~100-300KB), style conflicts with Tailwind, design lock-in | ❌ Too opinionated |
| **Hand-rolled (current)** | Full control, no dependencies | High maintenance, inconsistent a11y, reinventing solved problems | ❌ Too expensive |

</details>

---

## Information Architecture

See **[INFORMATION_ARCHITECTURE.md](./INFORMATION_ARCHITECTURE.md)** for complete entity catalog.

### Primary User Flows to Optimize

- Workflow submission and monitoring
- Resource/pool management
- Dataset browsing and preview
- Task debugging

### Navigation Options to Explore

- Command palette (Cmd+K) as primary navigation
- Workspace-based organization (like VS Code)
- Dashboard-first with drill-down

### Features Missing from Current UI

| Feature | Priority |
|---------|----------|
| Apps (workflow templates) | High - enables reuse |
| Config/Role Management (admin) | High - admin needs |
| Dataset Query/Labels | Medium - power users |
| Workflow Restart | Medium - convenience |
| Service Tokens with Roles | Medium - CI/CD users |

---

## Glossary

| Term | Meaning |
|------|---------|
| **Hot Reload** | Code changes appear instantly in browser without full page refresh |
| **Turbopack** | Next.js 16's default bundler - 2-5x faster builds, 10x faster hot reload |
| **CORS** | Cross-Origin Resource Sharing - browser security that blocks requests to different domains. Avoided via proxy. |
| **Proxy/Rewrites** | Next.js forwards `/api/*` requests to FastAPI, so browser thinks it's same-origin |
| **React Server Components** | React components that render on the server, reducing JavaScript sent to browser |
| **TanStack Query** | Library for fetching, caching, and syncing server data in React |
| **orval** | Tool that generates TypeScript API client from OpenAPI spec |
| **OpenAPI** | Standard format for describing REST APIs (FastAPI generates this automatically) |
| **shadcn/ui** | CLI that copies React components (built on Radix + Tailwind) into your project - you own the code |
| **Radix UI** | Unstyled, accessible React primitives - handles ARIA attributes, keyboard navigation, focus management |
| **Headless UI** | Similar to Radix but from Tailwind Labs - fewer components, no copy-paste pattern |
| **Accessibility (a11y)** | Making UIs usable for everyone, including keyboard and screen reader users |
| **ARIA** | Accessibility attributes (`aria-label`, `aria-expanded`, etc.) that help screen readers understand UI |
| **WCAG 2.1** | Web Content Accessibility Guidelines - international standard for web accessibility. Level AA is the typical compliance target. |
| **axe-core** | Automated accessibility testing engine - can be integrated into CI to catch common issues |
| **Focus trap** | Keeps keyboard focus inside a modal/dialog until it's closed - prevents users from tabbing to hidden content |

---

## Related Documentation

- [Information Architecture](./INFORMATION_ARCHITECTURE.md) - Complete catalog of backend entities, actions, and user personas
- [Developer Experience](./DEVELOPER_EXPERIENCE.md) - Day-to-day workflow, handling API changes, CI integration
- [Resources Cross-Pool UX](./RESOURCES_CROSS_POOL_UX.md) - Design exploration for cross-pool resource experiences
- [Resources Interaction Flows](./RESOURCES_INTERACTION_FLOWS.md) - Detailed user flows and wireframes for resources

---

## Notes & Ideas

_Brainstorming space for the redesign._

---

## Decision Log

| Date | Decision | Details |
|------|----------|---------|
| Dec 2025 | Monorepo | Stay in `external/ui-next/`, add to `.bazelignore` |
| Dec 2025 | Fresh directory | Clean slate, old `ui/` for reference |
| Dec 2025 | No Bazel | pnpm + Docker only |
| Dec 2025 | Next.js 16 | Required for auth (CLIENT_SECRET), Turbopack now default, `proxy.ts` replaces middleware. Static SPA rejected. |
| Dec 2025 | shadcn/ui | Radix-based, Tailwind-styled |
| Dec 2025 | OpenAPI + orval | Generate client from FastAPI spec, no tRPC |
| Dec 2025 | Next.js proxy | Rewrites / `proxy.ts` for CORS-free API access |
| Dec 2025 | Global error handling | QueryClient config + Error Boundaries |
| Dec 2025 | Layered architecture | Core → Headless → Themed. External teams use headless to build custom themes. |
| Dec 2025 | Single repo | No separate npm packages yet. Clear directory boundaries, path aliases for future extraction. |
| Dec 2025 | No simple customization | Either deploy our UI as-is, or build your own on headless. No "just change logo" support. |
| Dec 2025 | shadcn/ui + Radix | Code ownership, built-in a11y, Tailwind-native. Replaces hand-rolled components + focus-trap-react. |
| Dec 2025 | WCAG 2.1 compliance | Radix handles most a11y automatically. Add eslint-plugin-jsx-a11y to CI. Manual testing for screen readers. |
| Dec 2025 | Theme aesthetic | Deferred - will experiment with prototypes. Options documented in Open Decisions. |
