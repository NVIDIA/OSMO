<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
-->

# Upgrading OSMO from 6.0 to 6.2

## What's new in 6.2

- **New authentication architecture** — oauth2Proxy sidecar + authz sidecar replace the old Envoy-native oauth2Filter
- **RBAC system** — new database tables for users, roles, and role mappings managed by the authz sidecar
- **pgroll database migrations** — zero-downtime schema changes via versioned schemas

## Before you start

Depending on your deployment, follow the relevant sections:

| Deployment type | Sections to follow |
|----------------|-------------------|
| With OIDC auth (any IdP) | [Database migrations](#database-migrations) + [Authentication](#authentication-changes) + [Backend operator tokens](#backend-operator-tokens) |
| Without auth | [Database migrations](#database-migrations) + [No-auth deployments](#no-auth-deployments) |
| Switching IdPs (e.g., Keycloak to Entra ID) | [Database migrations](#database-migrations) + [Authentication](#authentication-changes) + [Backend operator tokens](#backend-operator-tokens) (use new IdP values) |
| Keycloak as IdP | All of the above + [Keycloak-specific notes](#keycloak-specific-notes) |

## Database migrations

### How pgroll works

OSMO 6.2 uses [pgroll](https://github.com/xataio/pgroll) for zero-downtime database schema migrations. pgroll applies migrations to the `public` schema and optionally creates a versioned schema (e.g., `public_v6_2_0`) containing views over all tables. Services set their PostgreSQL `search_path` to this versioned schema, allowing old and new versions to coexist during a rolling upgrade.

### Running migrations

Enable the migration job in the service chart values:

```yaml
services:
  migration:
    enabled: true
    targetSchema: public_v6_2_0
```

The migration runs as a Helm pre-upgrade hook before pods are updated. For ArgoCD, add:

```yaml
services:
  migration:
    extraAnnotations:
      argocd.argoproj.io/hook: PreSync
      argocd.argoproj.io/hook-delete-policy: BeforeHookCreation
```

The database password is read from `OSMO_POSTGRES_PASSWORD` env var, or from the `postgres_password:` field in the file at `OSMO_CONFIG_FILE`.

### Choosing your upgrade path

**Direct upgrade (simpler, requires downtime):**
Set `targetSchema: public`. Migrations apply directly to the `public` schema. All services must be on 6.2 after the upgrade.

**Versioned schema (zero-downtime):**
Set `targetSchema: public_v6_2_0`. Both 6.0 and 6.2 services can run simultaneously. The router chart also needs `targetSchema: public_v6_2_0` set at the top level.

The migration script is idempotent — safe to run multiple times.

### Schema changes in 6.2

**New tables:** `users`, `user_roles`, `access_token_roles`, `role_external_mappings`

**New columns:** `access_token.last_seen_at`, `roles.sync_mode`, `pools.common_group_templates`, `pools.parsed_group_templates`, `pools.topology_keys`, `groups.group_template_resource_types`

**Dropped columns:** `access_token.access_type`, `access_token.roles`, `dataset_version.retention_policy`, `pools.action_permissions`

**Data changes:** `users` table backfilled from existing records, old `SERVICE` type access tokens deleted, `access_token` primary key changes to composite `(user_name, token_name)`, `role_external_mappings` backfilled with identity mappings.

## Authentication changes

OSMO 6.2 replaces the Envoy-native `oauth2Filter` with two new sidecars. Both default to `enabled: true`.

| Component | 6.0 | 6.2 |
|-----------|-----|-----|
| Browser OIDC flow | `sidecars.envoy.oauth2Filter` | `sidecars.oauth2Proxy` |
| Authorization/RBAC | OSMO application | `sidecars.authz` |
| Cookie signing | HMAC secret (`oidc_hmac.txt`) | oauth2-proxy `cookie_secret` |
| JWT cluster for IdP | `cluster: oauth` | `cluster: idp` |

### Step 1: Remove deprecated fields

Remove these from `sidecars.envoy` in your values files (all 3 charts):

| Remove | Replaced by |
|--------|-------------|
| `oauth2Filter` (entire block) | `sidecars.oauth2Proxy` |
| `useKubernetesSecrets` | `sidecars.oauth2Proxy.useKubernetesSecrets` |
| `secretPaths.hmacSecret` | No replacement needed |
| `secretPaths.clientSecret` | `sidecars.oauth2Proxy.secretPaths.clientSecret` |

Also remove the `oidc_hmac.txt` secret file if applicable.

### Step 2: Configure the IdP cluster and JWT providers

Add `sidecars.envoy.idp.host` and update your JWT providers to use `cluster: idp` instead of `cluster: oauth`. The values depend on your IdP — see the examples below.

You can look up the correct `issuer` and `jwks_uri` from your IdP's well-known endpoint:

```bash
curl -s https://<your-idp-hostname>/.well-known/openid-configuration | jq '{issuer, jwks_uri}'
```

**Microsoft Entra ID:**

```yaml
sidecars:
  envoy:
    idp:
      host: login.microsoftonline.com
    jwt:
      user_header: x-osmo-user
      providers:
        - issuer: https://sts.windows.net/<tenant-id>/
          audience: <client-id>
          jwks_uri: https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys
          user_claim: unique_name
          cluster: idp
        - issuer: https://login.microsoftonline.com/<tenant-id>/v2.0
          audience: <client-id>
          jwks_uri: https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys
          user_claim: preferred_username
          cluster: idp
        - issuer: osmo
          audience: osmo
          jwks_uri: http://localhost:8000/api/auth/keys
          user_claim: unique_name
          cluster: service
```

Note: Microsoft Entra ID uses two issuers (`sts.windows.net` for v1 tokens, `login.microsoftonline.com` for v2). Include both for compatibility.

**Keycloak:**

```yaml
sidecars:
  envoy:
    idp:
      host: <your-keycloak-hostname>
    jwt:
      user_header: x-osmo-user
      providers:
        - issuer: https://<your-keycloak-hostname>/realms/<realm>
          audience: <device-client-id>
          jwks_uri: https://<your-keycloak-hostname>/realms/<realm>/protocol/openid-connect/certs
          user_claim: preferred_username
          cluster: idp
        - issuer: https://<your-keycloak-hostname>/realms/<realm>
          audience: <browser-client-id>
          jwks_uri: https://<your-keycloak-hostname>/realms/<realm>/protocol/openid-connect/certs
          user_claim: preferred_username
          cluster: idp
        - issuer: osmo
          audience: osmo
          jwks_uri: http://localhost:8000/api/auth/keys
          user_claim: unique_name
          cluster: service
```

**Okta:**

```yaml
sidecars:
  envoy:
    idp:
      host: <your-org>.okta.com
    jwt:
      user_header: x-osmo-user
      providers:
        - issuer: https://<your-org>.okta.com/oauth2/default
          audience: <client-id>
          jwks_uri: https://<your-org>.okta.com/oauth2/default/v1/keys
          user_claim: preferred_username
          cluster: idp
        - issuer: osmo
          audience: osmo
          jwks_uri: http://localhost:8000/api/auth/keys
          user_claim: unique_name
          cluster: service
```

**Other OIDC providers:** Use the `issuer` and `jwks_uri` from your provider's `/.well-known/openid-configuration` endpoint.

### Step 3: Add oauth2Proxy sidecar

> **Keycloak users:** You will also need `--insecure-oidc-allow-unverified-email=true` in `extraArgs`. See [Keycloak-specific notes](#keycloak-specific-notes).

```yaml
sidecars:
  oauth2Proxy:
    enabled: true
    oidcIssuerUrl: <oidc-issuer-url>
    clientId: <client-id>
    cookieDomain: <.your-domain.com>
    cookieSecure: true
```

**Secrets — choose one approach:**

**Kubernetes Secrets:**

```yaml
sidecars:
  oauth2Proxy:
    useKubernetesSecrets: true
    secretName: oauth2-proxy-secrets
```

```bash
kubectl create secret generic oauth2-proxy-secrets \
  --from-literal=client_secret=<your-client-secret> \
  --from-literal=cookie_secret=$(openssl rand 32 | head -c 32)
```

**File-based secrets:**

```yaml
sidecars:
  oauth2Proxy:
    useKubernetesSecrets: false
    secretPaths:
      cookieSecret: /path/to/oauth2-proxy-config.txt
```

The file must contain (plain text, not base64):

```
client_secret = "<value>"
cookie_secret = "<value>"
```

`cookie_secret` must be exactly 16, 24, or 32 raw bytes.

### Step 4: Configure authz sidecar (service and router charts only)

The authz sidecar enforces role-based access control (RBAC) for all OSMO API requests via Envoy's External Authorization API. It validates user roles against policies stored in PostgreSQL and syncs external IdP roles to OSMO roles through role mappings. It is enabled by default and requires no additional configuration for most deployments.

**Optional** tuning parameters:

```yaml
sidecars:
  authz:
    postgres:
      sslMode: prefer       # disable, prefer, require, verify-full
      maxConns: 10
      minConns: 2
      maxConnLifetimeMin: 5
    cache:
      ttl: 300               # role cache TTL in seconds
      maxSize: 1000           # max cached role combinations
```

### Step 5: Update CLI auth endpoints (service chart only)

**Microsoft Entra ID:**

```yaml
services:
  service:
    auth:
      enabled: true
      device_endpoint: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/devicecode
      device_client_id: <client-id>
      browser_endpoint: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/authorize
      browser_client_id: <client-id>
      token_endpoint: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token
      logout_endpoint: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/logout
```

**Keycloak:**

```yaml
services:
  service:
    auth:
      enabled: true
      device_endpoint: https://<keycloak>/realms/<realm>/protocol/openid-connect/auth/device
      device_client_id: <device-client-id>
      browser_endpoint: https://<keycloak>/realms/<realm>/protocol/openid-connect/auth
      browser_client_id: <browser-client-id>
      token_endpoint: https://<keycloak>/realms/<realm>/protocol/openid-connect/token
      logout_endpoint: https://<keycloak>/realms/<realm>/protocol/openid-connect/logout
```

**Okta:**

```yaml
services:
  service:
    auth:
      enabled: true
      device_endpoint: https://<your-org>.okta.com/oauth2/default/v1/device/authorize
      device_client_id: <client-id>
      browser_endpoint: https://<your-org>.okta.com/oauth2/default/v1/authorize
      browser_client_id: <client-id>
      token_endpoint: https://<your-org>.okta.com/oauth2/default/v1/token
      logout_endpoint: https://<your-org>.okta.com/oauth2/default/v1/logout
```

### Step 6: Update redirect URI in your IdP

Register `https://<your-hostname>/oauth2/callback` as a valid redirect URI in your IdP's client configuration. This replaces the old `oauth2Filter` redirect path.

If switching IdPs, also update the `client_secret` in your oauth2-proxy secret to the new IdP's client secret. The `cookie_secret` can remain the same.

## Backend operator tokens

The 6.2 RBAC migration deletes old `SERVICE` type access tokens and changes the `access_token` primary key to a composite `(user_name, token_name)`. After upgrading, you must recreate service account tokens used by backend operators.

Follow [Step 1: Create Service Account for Backend Operator](https://nvidia.github.io/OSMO/main/deployment_guide/install_backend/deploy_backend.html#step-1-create-service-account-for-backend-operator) from the deployment guide:

1. Authenticate to OSMO:

   ```bash
   osmo login https://<your-osmo-hostname>
   ```

2. Create a service account user for backend operations:

   ```bash
   osmo user create backend-operator --roles osmo-backend
   ```

3. Generate an access token:

   ```bash
   export OSMO_SERVICE_TOKEN=$(osmo token set backend-token \
       --user backend-operator \
       --expires-at <YYYY-MM-DD> \
       --description "Backend Operator Token" \
       --roles osmo-backend \
       -t json | jq -r '.token')
   ```

Save the token securely — it will not be shown again. Update any systems that reference the old backend operator token (e.g., Kubernetes secrets, CI/CD pipelines) with the new value.

## No-auth deployments

The 6.2 upgrade adds two new sidecars that default to `enabled: true`. Disable them and remove deprecated fields:

**Service and router charts:**

```yaml
sidecars:
  oauth2Proxy:
    enabled: false
  authz:
    enabled: false
```

**Web-UI chart:**

```yaml
sidecars:
  oauth2Proxy:
    enabled: false
```

Also remove any deprecated `sidecars.envoy` fields listed in [Step 1](#step-1-remove-deprecated-fields).

## Keycloak-specific notes

### email_verified claim

Keycloak id_tokens may not include `email_verified: true` by default. oauth2-proxy requires this and will reject the token with:

```
Error redeeming code during OAuth2 callback: email in id_token (...) isn't verified
```

Microsoft Entra ID and Okta include this claim automatically.

**Quick fix:** Add to oauth2-proxy extraArgs:

```yaml
sidecars:
  oauth2Proxy:
    extraArgs:
    - --insecure-oidc-allow-unverified-email=true
```

**Proper fix:** Add a protocol mapper in Keycloak Admin Console:
1. Clients → your client → Client scopes → dedicated scope → Add mapper
2. Mapper type: **User Attribute**
3. User Attribute: `emailVerified`, Token Claim Name: `email_verified`
4. Claim JSON Type: `boolean`, Add to ID Token: ON

### Redirect URI

Add `https://<your-hostname>/oauth2/callback` to Valid Redirect URIs in Clients → your client → Settings. Remove the old redirect path (e.g., `*/api/auth/getAToken`) once migration is complete.
