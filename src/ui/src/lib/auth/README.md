# Authentication with Envoy + OAuth2 Proxy

Authentication is handled by **Envoy sidecar** + **OAuth2 Proxy sidecar** in the Kubernetes pod. The Next.js application does not implement OAuth flows or decode JWTs.

## How It Works

1. **User accesses the app** -- Envoy's ext_authz filter consults OAuth2 Proxy
2. **No valid session?** -- OAuth2 Proxy redirects to the IDP (Keycloak, Microsoft, etc.)
3. **User logs in** -- IDP redirects to `/oauth2/callback`, OAuth2 Proxy sets `_osmo_session` cookie
4. **Subsequent requests** -- OAuth2 Proxy validates the session cookie, Envoy validates the JWT
5. **Envoy enriches headers** on the request to Next.js:
   - `x-osmo-user` -- username (from JWT claim)
   - `x-osmo-roles` -- comma-separated roles
   - `x-osmo-name` -- display name
   - `x-auth-request-email` -- email (from OAuth2 Proxy)

Token refresh is handled transparently by OAuth2 Proxy.

## Getting User Information

### Client-Side (useUser hook)

User info is resolved server-side from Envoy headers and passed to the client via React context. No client-side fetch needed.

```typescript
import { useUser } from '@/lib/auth/user-context';

function MyComponent() {
  const { user, logout } = useUser();
  // user.name, user.email, user.username, user.isAdmin, user.initials
}
```

### Server Components

```typescript
import { getServerUsername, hasServerAdminRole, getServerUser } from '@/lib/auth/server';

export default async function Page() {
  const username = await getServerUsername();
  const isAdmin = await hasServerAdminRole();
  const user = await getServerUser(); // full User object from headers
}
```

## Logout

Redirect to `/oauth2/sign_out` which clears the session and redirects to IDP logout.

## Local Development

For local dev against a production backend:

1. Open the production app, go to DevTools > Application > Cookies
2. Copy the `_osmo_session` cookie value
3. In localhost console: `document.cookie = "_osmo_session=<value>; path=/; max-age=604800"`
4. Set `NEXT_PUBLIC_OSMO_API_HOSTNAME` to the production hostname
5. API requests proxy through Next.js, forwarding the cookie to prod Envoy

For UI-only development, use mock mode: `pnpm dev:mock`
