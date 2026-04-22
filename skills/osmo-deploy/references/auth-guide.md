# Authentication Guide

OSMO authentication operates in two modes. Choose based on your environment.

---

## Which path are you on?

**No IdP (defaultAdmin)**
Best for: development, testing, environments without a corporate SSO system.
- A single admin user is created at startup with a configured password
- That password is the access token — use it with `osmo login` or `Authorization: Bearer <password>`
- Users and roles are managed entirely through OSMO's API/CLI

**With IdP (OAuth2/OIDC)**
Best for: production with Microsoft Entra ID, Google Workspace, Okta, AWS IAM Identity Center, etc.
- Users log in via browser SSO or CLI device flow; your IdP issues JWTs
- Envoy validates JWTs and forwards identity to OSMO
- Roles can come from OSMO's database, your IdP groups (via role mapping), or both

---

## No-IdP Setup (defaultAdmin)

**1. Create the password secret** (must be exactly 43 characters):
```bash
kubectl create secret generic default-admin-secret \
  --namespace osmo \
  --from-literal=password='<your-43-char-password>'
```

**2. Enable in `osmo_values.yaml`:**
```yaml
services:
  defaultAdmin:
    enabled: true
    username: "admin"
    passwordSecretName: default-admin-secret
    passwordSecretKey: password
  service:
    auth:
      enabled: false   # disable IdP auth

gateway:
  oauth2Proxy:
    enabled: false     # disable OAuth2 Proxy
```

**3. Log in:**
```bash
osmo login https://osmo.example.com
# When prompted for token, enter the 43-char password
```

After login, create additional users, assign roles, and create access tokens via CLI or UI.

---

## With-IdP Setup

**What you need from your IdP:**

| Value | Used in |
|-------|---------|
| Client ID | `services.service.auth.device_client_id`, `browser_client_id`; `gateway.oauth2Proxy.clientId`; `gateway.envoy.jwt.providers[].audience` |
| Client secret | `oauth2-proxy-secrets` K8s secret (`client_secret` key) |
| Issuer URL | `gateway.envoy.jwt.providers[].issuer`; `gateway.oauth2Proxy.oidcIssuerUrl` |
| JWKS URI | `gateway.envoy.jwt.providers[].jwks_uri` |
| Token endpoint | `services.service.auth.token_endpoint` |
| Authorize URL | `services.service.auth.browser_endpoint` |
| Device auth URL | `services.service.auth.device_endpoint` |
| Logout URL | `services.service.auth.logout_endpoint` |

Register OSMO as an OAuth2/OIDC application in your IdP and use the redirect URI:
`https://<your-domain>/oauth2/callback`

For provider-specific registration steps, fetch the URL from `references/url-index.md`:
- Microsoft Entra ID, Google, AWS IAM: `appendix/authentication/identity_provider_setup.md`
- Keycloak (self-hosted broker): `appendix/keycloak_setup.md`

---

## Built-in Roles

| Role | Description |
|------|-------------|
| `osmo-admin` | Full platform management (users, roles, pools, backends, configs) |
| `osmo-user` | Submit workflows, manage own datasets and access tokens |
| `osmo-backend` | Backend operator authentication (used by the backend operator service account) |
| `osmo-ctrl` | Internal use by osmo-ctrl container (do not assign to human users) |
| `osmo-default` | Read-only access; assigned to users who log in before being granted a role |

For the full role/policy reference, fetch `appendix/authentication/roles_policies.md`.

---

## Service Account Pattern (Backend Operator)

The backend operator authenticates as an OSMO user with the `osmo-backend` role:

```bash
# 1. Create user
osmo user create backend-operator --roles osmo-backend

# 2. Create access token
export OSMO_SERVICE_TOKEN=$(osmo token set backend-token \
  --user backend-operator \
  --expires-at <YYYY-MM-DD> \
  --roles osmo-backend \
  -t json | jq -r '.token')

# 3. Store in K8s secret on the backend cluster
kubectl create secret generic osmo-operator-token -n osmo-operator \
  --from-literal=token=$OSMO_SERVICE_TOKEN
```

For other service accounts (CI/CD, automation): same pattern, different user/role.
Full details: fetch `appendix/authentication/service_accounts.md`.

---

## Token Rotation

```bash
# Check current token expiry
osmo token list --user backend-operator

# Create a new token (same as Step 2 above)
export OSMO_SERVICE_TOKEN=$(osmo token set backend-token \
  --user backend-operator \
  --expires-at <YYYY-MM-DD> \
  --roles osmo-backend \
  -t json | jq -r '.token')

# Update the K8s secret
kubectl delete secret osmo-operator-token -n osmo-operator
kubectl create secret generic osmo-operator-token -n osmo-operator \
  --from-literal=token=$OSMO_SERVICE_TOKEN

# Restart the backend operator to pick up the new secret
kubectl rollout restart deployment -n osmo-operator
```

---

## Managing Users and Roles (no-IdP or supplemental)

```bash
# Create user with role
osmo user create <username> --roles osmo-user

# List users
osmo user list

# Create access token for a user
osmo token set <token-name> --user <username> --expires-at <YYYY-MM-DD> --roles osmo-user

# List tokens for a user
osmo token list --user <username>
```

For IdP group → OSMO role mapping: fetch `appendix/authentication/idp_role_mapping.md`.
For managing users via API/UI: fetch `appendix/authentication/managing_users.md`.
