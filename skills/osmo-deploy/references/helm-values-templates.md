# Helm Values Templates

Minimal annotated skeletons for all OSMO Helm charts. These cover required fields only.
For optional fields (custom resource limits, advanced gateway config, additional replicas),
fetch `getting_started/deploy_service.md` or `install_backend/deploy_backend.md` from the URL index.

> **Version staleness:** If a field doesn't exist in your chart version, fetch the full values from
> the deploy guide for the current schema.

---

## `osmo_values.yaml` — API Service + Gateway

```yaml
# Global config shared by all OSMO services
global:
  osmoImageLocation: nvcr.io/nvidia/osmo   # REQUIRED
  osmoImageTag: <version>                   # REQUIRED — e.g. "6.0.0"
  serviceAccountName: osmo

services:
  configFile:
    enabled: true

  # External PostgreSQL (set enabled: false to use external DB)
  postgres:
    enabled: false
    serviceName: <your-postgres-host>   # REQUIRED
    port: 5432
    db: osmo                            # REQUIRED — database name created in deploy step 1
    user: postgres

  # External Redis (set enabled: false to use external cache)
  redis:
    enabled: false
    serviceName: <your-redis-host>      # REQUIRED
    port: 6379
    tlsEnabled: true                    # set false if Redis has no TLS

  service:
    hostname: <your-domain>             # REQUIRED — e.g. "osmo.example.com"
    # IdP endpoints — required when using an identity provider
    # Skip this block and enable defaultAdmin below if not using an IdP
    auth:
      enabled: true
      device_endpoint: <idp-device-auth-url>    # for CLI device flow login
      device_client_id: <client-id>
      browser_endpoint: <idp-authorize-url>     # for browser SSO login
      browser_client_id: <client-id>
      token_endpoint: <idp-token-url>
      logout_endpoint: <idp-logout-url>

  # Default admin — enable this INSTEAD of auth above when not using an IdP
  # Password must be exactly 43 characters. Acts as the bootstrap access token.
  defaultAdmin:
    enabled: false                           # set true for no-IdP deployments
    username: "admin"
    passwordSecretName: default-admin-secret # kubectl create secret with 43-char password
    passwordSecretKey: password

gateway:
  envoy:
    hostname: <your-domain>                  # REQUIRED — same as services.service.hostname

    # Hostname of your IdP for JWT JWKS fetching (extracted from jwks_uri below)
    idp:
      host: <idp-hostname>                   # e.g. "login.microsoftonline.com"

    # Internal OSMO JWT cluster (for access-token-based auth)
    internalJwks:
      enabled: true
      cluster: osmo-service-jwks
      host: osmo-service
      port: 80

    # JWT providers — add one entry per token source
    jwt:
      user_header: x-osmo-user
      providers:
        # Your IdP (example: Microsoft Entra ID — adjust issuer/audience/jwks_uri for your provider)
        - issuer: <idp-issuer-url>           # REQUIRED — e.g. "https://login.microsoftonline.com/<tenant-id>/v2.0"
          audience: <client-id>             # REQUIRED
          jwks_uri: <idp-jwks-uri>          # REQUIRED — e.g. "https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys"
          user_claim: preferred_username
          cluster: idp
        # OSMO-issued JWTs (keep this entry for access-token support)
        - issuer: osmo
          audience: osmo
          jwks_uri: http://osmo-service/api/auth/keys
          user_claim: unique_name
          cluster: osmo-service-jwks

  # OAuth2 Proxy — handles browser SSO flow; skip when using defaultAdmin
  oauth2Proxy:
    enabled: true                            # set false for defaultAdmin deployments
    provider: oidc
    oidcIssuerUrl: <idp-issuer-url>          # REQUIRED — same as jwt.providers[0].issuer
    clientId: <client-id>                    # REQUIRED
    cookieDomain: .<your-domain>             # REQUIRED — note leading dot
    scope: "openid email profile"
    useKubernetesSecrets: true
    secretName: oauth2-proxy-secrets         # created in deploy step 2
    clientSecretKey: client_secret
    cookieSecretKey: cookie_secret
```

---

## `router_values.yaml` — Router Service

```yaml
global:
  osmoImageLocation: nvcr.io/nvidia/osmo   # REQUIRED
  osmoImageTag: <version>                   # REQUIRED — match service chart version

services:
  configFile:
    enabled: true

  service:
    hostname: <your-domain>                  # REQUIRED — same as in osmo_values.yaml
    serviceAccountName: router

  postgres:
    serviceName: <your-postgres-host>        # REQUIRED
    port: 5432
    db: osmo                                 # REQUIRED — same database
    user: postgres
```

---

## `ui_values.yaml` — Web UI

```yaml
global:
  osmoImageLocation: nvcr.io/nvidia/osmo   # REQUIRED
  osmoImageTag: <version>                   # REQUIRED

services:
  ui:
    hostname: <your-domain>                  # REQUIRED
    apiHostname: osmo-gateway:80             # internal gateway address — keep as-is
```

---

## `backend_operator_values.yaml` — Backend Operator

```yaml
global:
  osmoImageTag: <version>                    # REQUIRED — match service chart version
  serviceUrl: https://<your-domain>          # REQUIRED — OSMO control plane URL
  agentNamespace: osmo-operator             # namespace created in deploy step 2
  backendNamespace: osmo-workflows          # namespace created in deploy step 2
  backendName: <your-backend-name>          # REQUIRED — e.g. "default" or "gpu-cluster-1"
  accountTokenSecret: osmo-operator-token   # secret created in deploy step 2
  loginMethod: token

  services:
    backendListener:
      resources:
        requests:
          cpu: "1"
          memory: "1Gi"
        limits:
          memory: "1Gi"
    backendWorker:
      resources:
        requests:
          cpu: "1"
          memory: "1Gi"
        limits:
          memory: "1Gi"
      # Uncomment and extend if using group templates that create CRDs or ConfigMaps:
      # extraRBACRules:
      #   - apiGroups: [""]
      #     resources: ["configmaps"]
      #     verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
```

---

## Notes

- All `<your-...>` placeholders must be replaced with real values before deploying
- The `osmoImageTag` must be consistent across all charts deployed in the same release
- For `defaultAdmin` deployments: set `gateway.oauth2Proxy.enabled: false` and `services.service.auth.enabled: false`, and add a `default-admin-secret` K8s secret with a 43-character password
- For IdP provider-specific values (Entra ID, Google, AWS): read `references/auth-guide.md` then fetch `appendix/authentication/identity_provider_setup.md`
