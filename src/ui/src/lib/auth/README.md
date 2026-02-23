# Authentication with Envoy Sidecar

In production, authentication is handled by the **Envoy sidecar** configured in your Kubernetes deployment. The Next.js application does not implement OAuth flows directly.

## How It Works

1. **User accesses protected route** → Envoy intercepts the request
2. **No valid session?** → Envoy redirects to OAuth provider (Keycloak)
3. **User logs in** → Keycloak redirects back to Envoy callback (`/v2/getAToken`)
4. **Envoy handles callback** → Sets secure cookies, injects headers
5. **Request forwarded to app** → Next.js receives `x-osmo-user` header and `Authorization: Bearer <token>`

## Getting User Information

### Option 1: Read from Header (Simple)

```typescript
// In API routes or server components
export async function GET(request: Request) {
  const username = request.headers.get('x-osmo-user');
  
  if (!username) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  return Response.json({ username });
}
```

### Option 2: Decode JWT (Full Info)

```typescript
import { getJwtClaims, getUserRoles, hasRole } from '@/lib/auth/jwt-helper';

export async function GET(request: Request) {
  // Get full JWT claims (username, email, roles, etc.)
  const claims = getJwtClaims(request);
  
  if (!claims) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Extract specific info
  const username = claims.preferred_username;
  const email = claims.email;
  const roles = getUserRoles(request);
  
  // Check permissions
  if (!hasRole(request, 'admin')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  
  return Response.json({ username, email, roles });
}
```

## Authentication State

The app checks auth status via `/auth/login_info` which queries the backend:

```typescript
import { getAuthBackend } from '@/lib/auth/auth-backend';

const backend = getAuthBackend();
const config = await backend.getConfig();

if (config.auth_enabled) {
  // Auth is enabled - Envoy will handle login automatically
}
```

## Logout

Logout is handled by Envoy. Redirect users to `/v2/logout` (or use the configured logout path):

```typescript
import { getAuthBackend } from '@/lib/auth/auth-backend';

const backend = getAuthBackend();
const logoutUrl = await backend.getLogoutUrl();

if (logoutUrl) {
  redirect(logoutUrl);
}
```

## Local Development

For local development without Envoy:

1. You may need to mock the `x-osmo-user` header
2. Or implement a simplified auth flow for dev
3. Or use the mock handlers in `src/mocks/handlers.ts`

## Session Sharing

When deployed at `/v2`, this UI shares sessions with the legacy UI deployed at `/`. Both use:
- Same OAuth client (`osmo-browser-flow`)
- Same Envoy configuration
- Same domain-level cookies

Users can navigate between UIs without re-authenticating.
