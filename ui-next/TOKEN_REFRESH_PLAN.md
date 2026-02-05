# Token Refresh Implementation Plan for ui-next

## Executive Summary

This plan proposes a **hybrid proactive-reactive token refresh strategy** that learns from the legacy UI's patterns while leveraging ui-next's modern React Query infrastructure and SSR/PPR architecture. The implementation will be **development-only** (production uses Envoy) and handle 5-minute token expiry across multiple tabs with zero user disruption.

## Context & Requirements

### Current State
- **Production**: Envoy sidecar handles all token refresh transparently (no app changes needed)
- **Development**: Tokens expire every 5 minutes, no refresh mechanism exists
- **Architecture**: Next.js 16 with SSR, PPR, and client-side rendering
- **API Layer**: TanStack Query with smart retry logic (3 attempts, exponential backoff)

### Requirements
1. Support multi-hour sessions without user disruption
2. Coordinate token refresh across multiple browser tabs
3. Continue refreshing in background tabs (with pause when hidden)
4. SSR/PPR safe - no hydration mismatches
5. Zero impact on production builds (tree-shaken completely)

## Key Learnings from Legacy UI

### What Worked Well
✅ **Reactive 401-based refresh** - Simple, effective trigger mechanism
✅ **Separate dev/production modes** - Clear separation of concerns
✅ **localStorage for token persistence** - Survives page reloads
✅ **Manual check_token endpoint** - Explicit validation on app startup

### Pain Points & Limitations
❌ **No request queuing** - In-flight requests fail when token expires
❌ **No multi-tab coordination** - Race conditions, duplicate refresh requests
❌ **No circuit breaker** - Cascading failures during outages
❌ **Manual token passing** - Every API call must explicitly handle auth
❌ **No SSR support** - Would cause hydration mismatches

## Proposed Architecture

### Design Philosophy

**"Lean on React Query, coordinate across tabs, fail gracefully"**

Rather than building a complex proactive refresh system, we'll enhance the existing React Query retry logic with:
1. Automatic token refresh on 401 responses
2. Request queuing during refresh (new requests wait for new token)
3. Multi-tab coordination via localStorage events
4. Proactive refresh at 80% token lifetime (optional enhancement)

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│ UserProvider (React Context)                                │
│ - Initialize TokenRefreshManager on mount                   │
│ - Parse initial token, start background refresh timer       │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────┐
│ TokenRefreshManager (Singleton Service)                     │
│ - Proactive: Refresh at 80% expiry (4 min for 5 min tokens)│
│ - Reactive: Refresh on 401 from customFetch                 │
│ - Multi-tab: Coordinate via tokenStore localStorage events  │
│ - Visibility: Pause when document hidden                    │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────┐
│ tokenStore (Zustand + persist)                              │
│ - accessToken, expiresAt (from JWT exp claim)               │
│ - refreshState: 'idle' | 'refreshing' | 'failed'            │
│ - refreshLockOwner: tab ID for coordination                 │
│ - consecutiveFailures: circuit breaker counter              │
│ - localStorage sync → triggers storage events to other tabs │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────┐
│ customFetch (Enhanced)                                       │
│ - On 401: Check if refresh in progress                      │
│   - Yes: Wait for refresh, retry with new token             │
│   - No: Trigger reactive refresh, retry with new token      │
│ - Integrate with React Query's existing retry logic         │
│ - Transparent to components (auto-retry)                    │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────┐
│ React Query (Existing)                                      │
│ - Retry logic already handles transient failures            │
│ - No query invalidation needed (requests auto-retry)        │
│ - Structural sharing prevents unnecessary re-renders        │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Token Store & State Management

**File**: `src/lib/auth/token-refresh/token-store.ts`

Create Zustand store with localStorage persistence for cross-tab coordination:

```typescript
interface TokenState {
  // Token data
  accessToken: string | null;
  expiresAt: number | null; // Unix timestamp (ms)

  // Refresh coordination
  refreshState: 'idle' | 'refreshing' | 'failed';
  refreshLockOwner: string | null; // Tab ID
  refreshLockAcquiredAt: number | null;

  // Circuit breaker
  consecutiveFailures: number;
  lastRefreshAt: number | null;

  // Tab coordination
  tabId: string; // crypto.randomUUID()
}

interface TokenActions {
  // Token management
  setToken: (token: string, expiresAt: number) => void;
  clearToken: () => void;

  // Refresh lock (cross-tab)
  acquireRefreshLock: () => boolean;
  releaseRefreshLock: () => void;
  isRefreshLockStale: () => boolean; // >30s = stale

  // Refresh state
  setRefreshState: (state: RefreshState) => void;
  markRefreshSuccess: (token: string, expiresAt: number) => void;
  markRefreshFailure: () => void;

  // Computed getters
  isExpired: () => boolean;
  isExpiringSoon: () => boolean; // <60s remaining
  getTimeUntilExpiry: () => number;
}
```

**Key features**:
- Zustand with `persist` middleware → auto-syncs to localStorage
- Storage events notify other tabs of state changes
- Refresh lock prevents duplicate requests across tabs
- Stale lock detection handles crashed tabs
- Circuit breaker after 3 consecutive failures

**Production stub**: `token-store.production.ts` (all no-ops)

### Phase 2: Token Refresh Manager

**File**: `src/lib/auth/token-refresh/token-refresh-manager.ts`

Background service that coordinates token refresh:

```typescript
class TokenRefreshManager {
  private static instance: TokenRefreshManager | null = null;
  private refreshPromise: Promise<void> | null = null;
  private tickInterval: NodeJS.Timeout | null = null;

  static getInstance(): TokenRefreshManager {
    if (!this.instance) {
      this.instance = new TokenRefreshManager();
    }
    return this.instance;
  }

  start(): void {
    // Proactive refresh check every 10 seconds
    this.tickInterval = setInterval(() => {
      if (document.visibilityState === 'hidden') return; // Pause when hidden
      this.checkAndRefresh();
    }, 10000);

    // Listen for visibility changes
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private async checkAndRefresh(): Promise<void> {
    const state = tokenStore.getState();

    // Skip if already refreshing
    if (state.refreshState === 'refreshing') return;

    // Skip if in circuit breaker cooldown
    if (this.isInCooldown(state)) return;

    // Check if proactive refresh needed (<60s remaining)
    if (!state.isExpiringSoon()) return;

    // Try to acquire lock (returns false if another tab owns it)
    if (!tokenStore.acquireRefreshLock()) {
      // Check if lock is stale
      if (tokenStore.isRefreshLockStale()) {
        tokenStore.releaseRefreshLock();
        if (!tokenStore.acquireRefreshLock()) return;
      } else {
        return; // Another tab is handling refresh
      }
    }

    // Perform refresh
    await this.performRefresh();
  }

  async performRefresh(): Promise<void> {
    // Prevent duplicate refresh calls
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this._performRefresh();
    await this.refreshPromise;
    this.refreshPromise = null;
  }

  private async _performRefresh(): Promise<void> {
    tokenStore.setRefreshState('refreshing');

    try {
      const currentToken = tokenStore.getState().accessToken;

      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`,
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Refresh failed: ${response.status}`);
      }

      const data = await response.json();
      const { access_token, expires_in } = data;

      // Calculate expiry (expires_in is seconds from now)
      const expiresAt = Date.now() + (expires_in * 1000);

      // Update store (triggers storage event to other tabs)
      tokenStore.markRefreshSuccess(access_token, expiresAt);

      console.log('✅ Token refreshed successfully');

    } catch (error) {
      console.error('❌ Token refresh failed:', error);
      tokenStore.markRefreshFailure();

      // After 3 failures, force logout
      if (tokenStore.getState().consecutiveFailures >= 3) {
        this.handleRefreshFailure();
      }
    } finally {
      tokenStore.releaseRefreshLock();
    }
  }

  private handleRefreshFailure(): void {
    tokenStore.clearToken();
    window.location.href = '/logout';
  }

  private isInCooldown(state: TokenState): boolean {
    if (state.consecutiveFailures < 3) return false;
    const cooldownMs = 5 * 60 * 1000; // 5 minutes
    const timeSinceFailure = Date.now() - (state.lastRefreshAt || 0);
    return timeSinceFailure < cooldownMs;
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      // Tab became visible, check if refresh needed
      this.checkAndRefresh();
    }
  };
}
```

**Production stub**: `token-refresh-manager.production.ts` (all no-ops)

### Phase 3: Enhance customFetch with Request Queuing

**File**: `src/lib/api/fetcher.ts` (modify existing)

Add request queuing logic for 401 responses:

```typescript
// At the top of the file (module-level)
const refreshWaiters: Array<{
  resolve: (value: void) => void;
  reject: (error: Error) => void;
}> = [];

// New helper: Wait for token refresh to complete
async function waitForRefresh(): Promise<void> {
  const state = tokenStore.getState();

  // Already idle - refresh completed
  if (state.refreshState === 'idle') return;

  // Failed - throw error
  if (state.refreshState === 'failed') {
    throw new Error('Token refresh failed');
  }

  // Refreshing - wait for completion
  return new Promise((resolve, reject) => {
    refreshWaiters.push({ resolve, reject });

    // Timeout after 10 seconds
    setTimeout(() => {
      reject(new Error('Token refresh timeout'));
    }, 10000);
  });
}

// Subscribe to tokenStore changes to notify waiters
tokenStore.subscribe((state) => {
  if (state.refreshState === 'idle' || state.refreshState === 'failed') {
    // Notify all waiting requests
    const waiters = refreshWaiters.splice(0); // Clear array
    waiters.forEach(({ resolve, reject }) => {
      if (state.refreshState === 'idle') {
        resolve();
      } else {
        reject(new Error('Token refresh failed'));
      }
    });
  }
});

// In customFetch, modify the 401/403 error handling:
if (response.status === 401 || response.status === 403) {
  // Development only - handle token refresh
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
    return handleUnauthorized<T>(config, options);
  }

  // Production - throw non-retryable error (Envoy handles)
  throw createApiError(
    `Authentication required (${response.status})`,
    response.status,
    false
  );
}

// New helper function
async function handleUnauthorized<T>(
  config: RequestConfig,
  options?: RequestInit
): Promise<T> {
  const state = tokenStore.getState();

  // Check if refresh already in progress
  if (state.refreshState === 'refreshing') {
    // Wait for refresh to complete
    await waitForRefresh();

    // Retry request with new token
    return customFetch<T>(config, options);
  }

  // Check if token is actually expired
  if (!state.isExpired() && !state.isExpiringSoon()) {
    // Token should be valid - backend issue, fail fast
    throw createApiError('Authentication required (401)', 401, false);
  }

  // Trigger reactive refresh
  const refreshManager = TokenRefreshManager.getInstance();
  await refreshManager.performRefresh();

  // Retry request with new token
  return customFetch<T>(config, options);
}
```

**Key changes**:
- Dev-only: Only handle 401 refresh in development
- Request queuing: Multiple 401s during refresh all wait together
- Automatic retry: After refresh completes, original request retries with new token
- Transparent to React Query: Looks like a slow request, not a failure

### Phase 4: Integrate with UserProvider

**File**: `src/lib/auth/user-context.tsx` (modify existing)

Initialize token refresh manager when app loads:

```typescript
export function UserProvider({ children }: UserProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Existing user fetch logic
  useEffect(() => {
    async function fetchUser() {
      const controller = new AbortController();

      try {
        const response = await fetch(getBasePathUrl("/api/me"), {
          credentials: "include",
          signal: controller.signal,
        });

        if (response.ok) {
          const data = await response.json();
          setUser({
            id: data.id || data.sub || "",
            name: data.name || data.email?.split("@")[0] || "User",
            email: data.email || "",
            isAdmin: hasAdminRole(data.roles || []),
            initials: getInitials(data.name, data.email),
          });

          // NEW: Initialize token store in development
          if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
            const devToken = getDevAuthToken();
            if (devToken) {
              try {
                const claims = jwtDecode<JwtClaims>(devToken);
                const expiresAt = (claims.exp ?? 0) * 1000; // Convert to ms
                tokenStore.getState().setToken(devToken, expiresAt);
              } catch (error) {
                console.error('Failed to decode token:', error);
              }
            }
          }
        } else {
          setUser(null);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        console.error("Failed to fetch user:", error);
        setUser(null);
      } finally {
        setIsLoading(false);
      }

      return controller;
    }

    const fetchPromise = fetchUser();

    return () => {
      fetchPromise.then((controller) => controller?.abort());
    };
  }, []);

  // NEW: Start token refresh manager (dev only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV === 'production') return;

    const refreshManager = TokenRefreshManager.getInstance();
    refreshManager.start();

    return () => {
      refreshManager.stop();
    };
  }, []);

  // ... rest of component unchanged
}
```

### Phase 5: Create Token Refresh API Endpoint

**File**: `src/app/api/auth/refresh/route.ts` (new)

Next.js API route that proxies refresh requests to backend:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { extractToken } from "@/lib/auth/jwt-helper";

export async function POST(request: NextRequest) {
  const currentToken = extractToken(request);

  if (!currentToken) {
    return NextResponse.json(
      { error: "No token provided" },
      { status: 401 }
    );
  }

  try {
    // Get backend hostname from env
    const hostname = process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME || "localhost:8000";
    const protocol = hostname.includes("localhost") ? "http" : "https";
    const backendUrl = `${protocol}://${hostname}`;

    // Call backend refresh endpoint
    const response = await fetch(`${backendUrl}/api/auth/refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${currentToken}`,
        // Legacy UI uses x-refresh-token header - check backend API
        "x-refresh-token": currentToken,
      },
    });

    if (!response.ok) {
      console.error("Backend refresh failed:", response.status);
      return NextResponse.json(
        { error: "Token refresh failed" },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Backend returns { id_token, refresh_token, expires_in }
    return NextResponse.json({
      access_token: data.id_token,
      expires_in: data.expires_in || 300, // Default 5 minutes
    });

  } catch (error) {
    console.error("Token refresh error:", error);
    return NextResponse.json(
      { error: "Token refresh failed" },
      { status: 500 }
    );
  }
}
```

### Phase 6: Production Build Configuration

**File**: `next.config.ts` (modify existing)

Add Turbopack aliases to eliminate token refresh code from production:

```typescript
turbopack: {
  resolveAlias: process.env.NODE_ENV === "production" ? {
    // ... existing mock elimination aliases ...

    // Token refresh system (dev-only)
    "@/lib/auth/token-refresh/token-store":
      "@/lib/auth/token-refresh/token-store.production",
    "@/lib/auth/token-refresh/token-refresh-manager":
      "@/lib/auth/token-refresh/token-refresh-manager.production",
  } : {},
}
```

## File Structure

```
src/lib/auth/token-refresh/
├── README.md                       # Documentation
├── token-store.ts                  # Zustand store with persistence
├── token-store.production.ts       # No-op stub for production
├── token-refresh-manager.ts        # Background refresh service
├── token-refresh-manager.production.ts  # No-op stub
└── types.ts                        # Shared TypeScript types

src/lib/auth/
├── user-context.tsx                # MODIFIED: Initialize refresh manager
└── jwt-helper.ts                   # UNCHANGED: Existing JWT parsing

src/lib/api/
└── fetcher.ts                      # MODIFIED: Add 401 handling + request queuing

src/app/api/auth/refresh/
└── route.ts                        # NEW: Token refresh proxy endpoint

next.config.ts                      # MODIFIED: Add production aliases
```

## Testing Strategy

### Unit Tests (Vitest)

**`token-store.test.ts`**:
- ✅ Lock acquisition (only one tab wins)
- ✅ Stale lock detection (>30s = stale)
- ✅ Circuit breaker logic (3 failures → cooldown)
- ✅ Token expiry calculations

**`token-refresh-manager.test.ts`**:
- ✅ Proactive refresh at 80% expiry
- ✅ Reactive refresh on 401
- ✅ Refresh failure handling
- ✅ Visibility change handling

### Integration Tests (Playwright)

**`e2e/auth/token-refresh.spec.ts`**:

**Test: Proactive refresh before expiry**
```typescript
test('proactively refreshes at 4 minutes', async ({ page }) => {
  // Mock 5-minute token
  await page.evaluate(() => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const token = btoa(JSON.stringify({ exp }));
    localStorage.setItem('BearerToken', token);
  });

  // Mock refresh endpoint
  await page.route('**/api/auth/refresh', (route) => {
    route.fulfill({ json: { access_token: 'new-token', expires_in: 300 } });
  });

  // Advance time to 4 minutes
  await page.clock.fastForward('04:00');

  // Wait for refresh
  await page.waitForRequest('**/api/auth/refresh');

  // Verify new token
  const token = await page.evaluate(() => localStorage.getItem('BearerToken'));
  expect(token).toBe('new-token');
});
```

**Test: Multi-tab coordination**
```typescript
test('only one tab refreshes', async ({ context }) => {
  const page1 = await context.newPage();
  const page2 = await context.newPage();

  // Track refresh requests
  const refreshRequests: string[] = [];
  page1.on('request', (req) => {
    if (req.url().includes('/auth/refresh')) {
      refreshRequests.push('tab1');
    }
  });
  page2.on('request', (req) => {
    if (req.url().includes('/auth/refresh')) {
      refreshRequests.push('tab2');
    }
  });

  // Both tabs detect expiry
  await Promise.all([
    page1.goto('/pools'),
    page2.goto('/workflows'),
  ]);

  await page1.clock.fastForward('04:00');
  await page2.clock.fastForward('04:00');

  await page1.waitForTimeout(2000);

  // Only one refresh
  expect(refreshRequests).toHaveLength(1);
});
```

**Test: Request queuing during refresh**
```typescript
test('queues requests during refresh', async ({ page }) => {
  await page.goto('/pools');

  // Slow down refresh endpoint
  await page.route('**/api/auth/refresh', async (route) => {
    await new Promise(resolve => setTimeout(resolve, 2000));
    route.fulfill({ json: { access_token: 'new-token', expires_in: 300 } });
  });

  // Trigger refresh
  await page.clock.fastForward('04:00');

  // Make API request while refreshing
  const poolsPromise = page.waitForResponse('**/api/pool/quota**');
  await page.click('[data-testid="refresh-pools"]');

  // Request should wait and succeed
  const response = await poolsPromise;
  expect(response.ok()).toBe(true);
});
```

### Manual Testing Scenarios

**Scenario 1: Multi-hour session**
1. Log in with 5-minute token
2. Leave browser open for 1 hour
3. Verify: Token refreshed every ~4 minutes (check console)
4. Verify: No 401 errors in network tab
5. Verify: API requests continue working

**Scenario 2: Multi-tab coordination**
1. Open 3 tabs to different pages
2. Wait for 4 minutes (token should refresh)
3. Check network tab in each - only ONE refresh request total
4. Verify all tabs have new token (check localStorage)

**Scenario 3: Background tab behavior**
1. Open tab, go to another window/app
2. Wait 10 minutes
3. Return to browser tab
4. Verify: Refresh happened when tab became visible
5. Verify: No wasted refreshes while hidden

**Scenario 4: Refresh failure recovery**
1. Mock refresh endpoint to fail (503)
2. Wait for 3 failed refresh attempts
3. Verify: Circuit breaker activates (5-min cooldown)
4. Verify: User redirected to logout after 3 failures

## Edge Cases & Solutions

### 1. Race Conditions
**Problem**: Multiple tabs detect expiry simultaneously
**Solution**: Refresh lock with atomic acquisition + stale detection

### 2. Request Queuing
**Problem**: API request arrives while refresh in progress
**Solution**: Wait-and-retry pattern (max 10s timeout)

### 3. Expiry Detection
**Problem**: How to detect when token is expiring?
**Solution**: Parse JWT `exp` claim + react to 401 responses (dual detection)

### 4. Background Tab Behavior
**Problem**: Should background tabs refresh independently?
**Solution**: All tabs run manager, but only visible tab actively checks

### 5. Network Failures
**Problem**: What if refresh request fails?
**Solution**: Circuit breaker (3 failures → 5-min cooldown → force logout)

### 6. React Query Integration
**Problem**: After token refresh, invalidate queries?
**Solution**: No invalidation needed - requests auto-retry with new token

## Design Trade-offs

### Decision 1: Proactive + Reactive (Hybrid)
**Rationale**: Proactive prevents user-visible 401s, reactive provides fallback
**Alternative**: Pure reactive (simpler but shows loading states)

### Decision 2: Request Queuing (Wait-and-Retry)
**Rationale**: Zero user disruption, seamless with React Query
**Alternative**: Fail fast (simpler but poor UX)

### Decision 3: Zustand + localStorage
**Rationale**: Leverages existing patterns, universal browser support
**Alternative**: BroadcastChannel (faster but not supported in Safari <15.4)

### Decision 4: 80% Refresh Timing
**Rationale**: Industry standard (AWS 75%, Auth0 80%), 1-min buffer
**Alternative**: Fixed offset (doesn't scale to different token lifetimes)

### Decision 5: Circuit Breaker → Logout
**Rationale**: Security first, prevents expired session persistence
**Alternative**: Keep retrying (security risk, backend load)

## Verification Checklist

Before declaring done:

- [ ] Run `pnpm type-check && pnpm lint && pnpm test --run` - all pass
- [ ] Production build has ZERO token refresh code (check bundle size)
- [ ] Multi-tab test: Only one refresh request across 3 tabs
- [ ] Background tab test: Refresh happens when tab becomes visible
- [ ] Request queueing test: API calls succeed during refresh
- [ ] Circuit breaker test: 3 failures → logout
- [ ] Long session test: 1-hour session with no interruptions
- [ ] SSR test: No hydration mismatches on initial load
- [ ] All files have NVIDIA copyright headers

## Critical Files Summary

| File | Purpose | Lines |
|------|---------|-------|
| `src/lib/auth/token-refresh/token-store.ts` | Core state management | ~200 |
| `src/lib/auth/token-refresh/token-refresh-manager.ts` | Background refresh service | ~150 |
| `src/lib/api/fetcher.ts` | Request queuing (MODIFIED) | +80 |
| `src/lib/auth/user-context.tsx` | Initialization (MODIFIED) | +20 |
| `src/app/api/auth/refresh/route.ts` | Refresh endpoint proxy | ~50 |
| `next.config.ts` | Production tree-shaking (MODIFIED) | +4 |

**Total new code**: ~500 lines (excluding tests and stubs)
