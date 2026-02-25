# Authentication with Envoy + OAuth2 Proxy

Authentication is handled by **Envoy sidecar** + **OAuth2 Proxy sidecar** in the Kubernetes pod. The Next.js application does not implement OAuth flows.

## How It Works

1. **User accesses the app** -- Envoy's ext_authz filter consults OAuth2 Proxy
2. **No valid session?** -- OAuth2 Proxy redirects to the IDP (Keycloak, Microsoft, etc.)
3. **User logs in** -- IDP redirects to `/oauth2/callback`, OAuth2 Proxy sets `_osmo_session` cookie
4. **Subsequent requests** -- OAuth2 Proxy validates the session cookie and returns `Authorization: Bearer <id_token>`
5. **Envoy JWT filter** validates the token and sets `x-osmo-user` header
6. **Request reaches Next.js** with `Authorization`, `x-osmo-user`, `x-osmo-roles` headers

Token refresh is handled transparently by OAuth2 Proxy during the ext_authz check.

## Getting User Information

### Client-Side (UserProvider)

```typescript
import { useUser } from '@/lib/auth/user-context';

function MyComponent() {
  const { user, isLoading, logout } = useUser();
  // user is fetched from /api/me on mount
}
```

### Server Components

```typescript
import { getServerUsername, hasServerAdminRole } from '@/lib/auth/server';

export default async function Page() {
  const username = await getServerUsername();  // reads x-osmo-user header
  const isAdmin = await hasServerAdminRole(); // reads x-osmo-roles header
}
```

### API Routes (decode JWT)

```typescript
import { extractToken } from '@/lib/auth/jwt-utils';
import { decodeUserFromToken } from '@/lib/auth/decode-user';

export async function GET(request: Request) {
  const token = extractToken(request); // reads Authorization header
  const user = decodeUserFromToken(token);
}
```

## Logout

Redirect to `/oauth2/sign_out` which clears the session cookie and redirects to IDP logout.

## Local Development

For local dev against a production backend:

1. Open the production app, go to DevTools > Application > Cookies
2. Copy the `_osmo_session` cookie value
3. In localhost console: `document.cookie = "_osmo_session=<value>; path=/; max-age=604800"`
4. Set `NEXT_PUBLIC_OSMO_API_HOSTNAME` to the production hostname (e.g., `dev.osmo.nvidia.com`)
5. API requests proxy through Next.js, forwarding the cookie to prod Envoy

For UI-only development, use mock mode: `pnpm dev:mock`
