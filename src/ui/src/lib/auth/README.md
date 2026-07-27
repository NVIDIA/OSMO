# Authentication with Envoy + OAuth2 Proxy

Authentication is handled by **Envoy sidecar** + **OAuth2 Proxy sidecar** in the Kubernetes pod. The Next.js application does not implement OAuth flows or decode JWTs.

## How It Works

1. **User accesses the app** -- Envoy's ext_authz filter consults OAuth2 Proxy
2. **No valid session?** -- OAuth2 Proxy redirects to the IDP (Keycloak, Microsoft, etc.)
3. **User logs in** -- IDP redirects to `/oauth2/callback`, OAuth2 Proxy sets `_osmo_session` cookie
4. **Subsequent requests** -- OAuth2 Proxy validates the session cookie, Envoy validates the JWT
5. **Headers enriched** on the request to Next.js:
   - `x-auth-request-preferred-username` -- username (from OAuth2 Proxy, `preferred_username` OIDC claim)
   - `x-auth-request-user` -- user ID, typically email (from OAuth2 Proxy)
   - `x-auth-request-email` -- email (from OAuth2 Proxy)
   - `x-auth-request-name` -- display name (from JWT `name` claim, via Envoy Lua filter)
   - `x-osmo-roles` -- comma-separated roles (from JWT `roles` claim, via Envoy Lua filter)

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

Redirect to `/signout`. The gateway redirects that path to OAuth2 Proxy sign out and, when configured, the IDP logout endpoint.

## Local Development

For local development against a remote backend, use a non-production test
environment and credentials provisioned for that environment. Set
`NEXT_PUBLIC_OSMO_API_HOSTNAME` to the test hostname; API requests proxy through
Next.js to the configured backend. Do not copy session cookies from another
environment into localhost.

For UI-only development, use mock mode: `pnpm dev:mock`
