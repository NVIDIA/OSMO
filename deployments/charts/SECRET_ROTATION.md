# Kubernetes Secret and TLS operations

OSMO charts pass Secret names and keys to Kubernetes. They do not render
credential bytes into Helm values, manifests, or release state. Mount paths are
fixed by the charts so a value cannot redirect a credential into an arbitrary
container path.

## OAuth2 Proxy credentials

The identity-provider client secret is always operator-owned. Reference its
Kubernetes Secret and key through `clientSecret.existingSecret` in the service
chart or `secrets.oauthClientSecret` in the OSMO chart.

The session-cookie secret has two modes:

- Production: reference an operator-owned existing Secret.
- Disposable development: set `cookieSecret.generate=true` in the service
  chart or `secrets.oauthCookieSecret.generate=true` in the OSMO chart. A
  one-time, least-privilege bootstrap Job fills a retained placeholder Secret
  inside the cluster. Existing data is never replaced and a missing Secret on
  upgrade is an error.

Cookie-secret rotation invalidates every browser session. It must also avoid a
period where replicas use different cookie keys. The generated development
Secret is intentionally stable and is not rotated by its Job; move the release
to an operator-owned existing Secret when rotation is needed. Perform a
production existing-Secret rotation with no OAuth2 Proxy pod running:

```bash
set -euo pipefail
namespace=<namespace>
release=<release>
selector="app.kubernetes.io/instance=$release,app.kubernetes.io/component=oauth2-proxy"
# service chart default; use <OSMO-fullname>-gateway-oauth2-proxy for the OSMO chart
oauth_deployment=osmo-gateway-oauth2-proxy
oauth_hpa=osmo-gateway-oauth2-proxy

kubectl delete horizontalpodautoscaler -n "$namespace" \
  "$oauth_hpa" --ignore-not-found
kubectl scale deployment -n "$namespace" \
  "$oauth_deployment" --replicas=0
kubectl wait pod -n "$namespace" -l "$selector" \
  --for=delete --timeout=10m
remaining=$(kubectl get pod -n "$namespace" -l "$selector" \
  --field-selector='status.phase!=Succeeded,status.phase!=Failed' -o name)
test -z "$remaining"

# Replace the operator-owned Secret here. For example:
kubectl create secret generic <cookie-secret> -n "$namespace" \
  --from-file=<cookie-key>=<protected-cookie-file> \
  --dry-run=client -o yaml | kubectl apply -f -

# Service chart:
helm upgrade "$release" deployments/charts/service -n "$namespace" \
  --reuse-values --wait \
  --set-string gateway.oauth2Proxy.cookieSecret.rolloutNonce=<new-nonce>
# OSMO chart equivalent:
# helm upgrade "$release" deployments/charts/osmo -n "$namespace" \
#   --reuse-values --wait \
#   --set-string secrets.oauthCookieSecret.rolloutNonce=<new-nonce>
```

The Helm upgrade recreates the HPA and starts all OAuth2 Proxy replicas with the
new Secret. If any command fails, `set -e` stops the procedure before the next
stage.

## MCP OIDC proxy credentials

The service chart can reference four independently managed credentials under
`services.mcp.oidcProxy.credentials`: the OAuth client secret, optional Redis
password, Redis storage-encryption key, and FastMCP JWT-signing key. The two
internal keys must be configured together and each file must contain one
URL-safe base64-encoded 32-byte key. Their fixed keys default to
`storage-encryption-key` and `jwt-signing-key`.

For a fresh installation, generate each internal key independently and store
both in an operator-owned Secret. For an existing installation, do not generate
new values: older OSMO versions derived both keys from the OAuth client secret.
First materialize those exact derived values, deploy them as explicit internal
keys, and only then rotate the OAuth client secret. This preserves encrypted
Redis entries and existing signing behavior during the split:

```bash
set -euo pipefail
temporary_directory=$(mktemp -d)
trap 'rm -rf "$temporary_directory"' EXIT
export CLIENT_SECRET_FILE=<protected-existing-client-secret-file>
export KEY_OUTPUT_DIRECTORY="$temporary_directory"
python3 - <<'PY'
import os
from pathlib import Path
from fastmcp.server.auth.jwt_issuer import derive_jwt_key

os.umask(0o077)
client_secret = Path(os.environ['CLIENT_SECRET_FILE']).read_text().strip()
signing = derive_jwt_key(
    high_entropy_material=client_secret,
    salt='fastmcp-jwt-signing-key',
)
storage = derive_jwt_key(
    high_entropy_material=signing.decode('ascii'),
    salt='fastmcp-storage-encryption-key',
)
output = Path(os.environ['KEY_OUTPUT_DIRECTORY'])
(output / 'jwt-signing-key').write_bytes(signing)
(output / 'storage-encryption-key').write_bytes(storage)
os.chmod(output / 'jwt-signing-key', 0o600)
os.chmod(output / 'storage-encryption-key', 0o600)
PY
kubectl create secret generic osmo-mcp-internal-keys -n <namespace> \
  --from-file="$temporary_directory/jwt-signing-key" \
  --from-file="$temporary_directory/storage-encryption-key"

namespace=<namespace>
release=<release>
mcp_deployment=osmo-mcp # services.mcp.serviceName in the service chart
nonce=mcp-key-split-$(date -u +%Y%m%d%H%M%S)
helm upgrade "$release" deployments/charts/service -n "$namespace" \
  --reuse-values --wait --timeout 15m \
  --set services.mcp.oidcProxy.credentials.storageEncryptionKey.existingSecret.name=osmo-mcp-internal-keys \
  --set services.mcp.oidcProxy.credentials.storageEncryptionKey.existingSecret.key=storage-encryption-key \
  --set services.mcp.oidcProxy.credentials.jwtSigningKey.existingSecret.name=osmo-mcp-internal-keys \
  --set services.mcp.oidcProxy.credentials.jwtSigningKey.existingSecret.key=jwt-signing-key \
  --set-string services.mcp.oidcProxy.credentials.rolloutNonce="$nonce"
kubectl rollout status deployment/"$mcp_deployment" -n "$namespace" \
  --timeout=15m
ready=$(kubectl get deployment "$mcp_deployment" -n "$namespace" \
  -o jsonpath='{.status.readyReplicas}')
desired=$(kubectl get deployment "$mcp_deployment" -n "$namespace" \
  -o jsonpath='{.spec.replicas}')
test "$ready" = "$desired"
```

The derivation command requires the FastMCP package used by OSMO. It reads the
client secret from a protected file, never places it in a process argument, and
writes derived values only to a mode-0600 temporary directory. A secret manager
may materialize the same values instead. If `services.mcp.serviceName` was
overridden, use that exact Deployment name above. Before rotating the OAuth
client secret, use an already registered MCP client to refresh one existing
token and read its existing registration-backed state; also confirm the MCP pod
has no storage-decryption or token-signature errors. Keep the old OAuth client
secret unchanged until those checks pass.

Changing the JWT-signing key invalidates issued FastMCP tokens. Changing the
storage-encryption key without re-encrypting stored records makes existing
encrypted Redis state unreadable. This release deliberately does not automate
either internal-key rotation; treat that as a data migration.

## Internal gateway TLS

This setting covers Envoy-to-control-plane traffic, not public ingress
certificates. Public certificates remain owned by the ingress operator or
cert-manager.

Generated mode is the development default. A pre-install/pre-upgrade Job in the
OSMO service image maintains a retained private CA, trust bundle, and one stable
leaf Secret per upstream. It validates ownership, certificate/key matching,
signatures, DNS identities, and certificate lifetime. It never puts private
keys in Helm state and never silently replaces a missing CA during upgrade.

Production should disable generated mode and provide a CA Secret containing
`ca.crt` plus one `kubernetes.io/tls` Secret containing `tls.crt` and `tls.key`
for every enabled upstream. cert-manager or another Kubernetes Secret
controller may own these Secrets. Rotate a leaf with that controller, then bump
`gateway.tls.rolloutNonce` if the controller does not restart consumers.

Generated leaf certificates can be rotated safely in one upgrade by changing
`gateway.tls.generated.leafRotationNonce`. The bootstrap updates every leaf
before Kubernetes rolls the workloads.

Generated CA rotation uses three explicit upgrades with one unique ID:

1. Freeze each TLS-consumer HPA and complete that exact Deployment rollout.
2. `prepare`: create the next CA and deploy a trust bundle containing both CAs;
   leaf certificates still use the old CA.
3. `activate`: promote the prepared CA, regenerate all leaf certificates, and
   retain both CAs in the trust bundle.
4. `retire`: remove the old CA from the trust bundle only after every live leaf
   is issued by the new CA.
5. Return to `stable` and unfreeze the HPAs.

Each non-stable pre-upgrade Job proves that all exact consumer Deployments have
one fully updated/ready generation, that the active pod count equals the desired
replica count, that every pod carries the preceding rotation phase, and that
every matching HPA has `minReplicas == maxReplicas`. An unexpected mixed cohort
or HPA scale race fails before the CA state changes. If the phase was already
durably applied before Helm was interrupted, a retry accepts only that phase's
exact predecessor/target pod pair so Helm can finish the partial rollout.

For example:

```bash
set -euo pipefail
namespace=<namespace>
release=<release>
rotation=ca-$(date -u +%Y%m%d)
chart_kind=service # exactly one of: service, osmo
case "$chart_kind" in
  service)
    chart=deployments/charts/service
    # Exact service-chart defaults.
    consumers=(
      osmo-service osmo-router osmo-agent osmo-logger osmo-gateway-envoy
    )
    ;;
  osmo)
    chart=deployments/charts/osmo
    # Exact unified-chart defaults. Set osmo_fullname explicitly when using
    # fullnameOverride. Helm otherwise uses the release directly when it
    # contains "osmo", and <release>-osmo otherwise.
    if [[ -z ${osmo_fullname:-} ]]; then
      osmo_fullname="$release-osmo"
      if [[ "$release" == *osmo* ]]; then osmo_fullname="$release"; fi
    fi
    consumers=(
      "$osmo_fullname-api"
      "$osmo_fullname-router"
      "$osmo_fullname-agent"
      "$osmo_fullname-logger"
      "$osmo_fullname-gateway-envoy"
    )
    ;;
  *) echo 'chart_kind must be service or osmo' >&2; exit 2 ;;
esac
# Append the exact MCP Deployment when MCP is enabled. For the service chart it
# defaults to osmo-mcp; for the unified chart it is "$osmo_fullname-mcp".
# Replace any entry whose serviceName/gateway name was overridden.

# Freeze first while the CA is still stable, then prove every exact rollout.
helm upgrade "$release" "$chart" -n "$namespace" --reuse-values --wait \
  --timeout 15m \
  --set gateway.tls.generated.caRotation.freezeHpas=true
for deployment in "${consumers[@]}"; do
  kubectl rollout status deployment/"$deployment" -n "$namespace" \
    --timeout=15m
done

for phase in prepare activate; do
  helm upgrade "$release" "$chart" -n "$namespace" --reuse-values --wait \
    --timeout 15m \
    --set-string gateway.tls.generated.caRotation.id="$rotation" \
    --set gateway.tls.generated.caRotation.phase="$phase" \
    --set gateway.tls.generated.caRotation.freezeHpas=true
  for deployment in "${consumers[@]}"; do
    kubectl rollout status deployment/"$deployment" -n "$namespace" \
      --timeout=15m
  done
done

# Verify the live Secrets and workloads use the promoted CA before retirement.
kubectl get secret -n "$namespace" \
  -l "app.kubernetes.io/managed-by=osmo-internal-tls-bootstrap,app.kubernetes.io/instance=$release"
helm upgrade "$release" "$chart" -n "$namespace" --reuse-values --wait \
  --timeout 15m \
  --set-string gateway.tls.generated.caRotation.id="$rotation" \
  --set gateway.tls.generated.caRotation.phase=retire \
  --set gateway.tls.generated.caRotation.freezeHpas=true
for deployment in "${consumers[@]}"; do
  kubectl rollout status deployment/"$deployment" -n "$namespace" \
    --timeout=15m
done

helm upgrade "$release" "$chart" -n "$namespace" --reuse-values --wait \
  --timeout 15m \
  --set-string gateway.tls.generated.caRotation.id="$rotation" \
  --set gateway.tls.generated.caRotation.phase=stable \
  --set gateway.tls.generated.caRotation.freezeHpas=false
```

Do not skip or combine phases. A mismatched rotation ID, a second pending CA, a
missing retained CA, or a mixture of generated and existing-Secret values fails
before workloads roll.

## Legacy value migration

The service chart maps its legacy OAuth single-Secret fields only when the new
typed references are empty. Move the old Secret name and keys to
`gateway.oauth2Proxy.clientSecret.existingSecret` and
`gateway.oauth2Proxy.cookieSecret.existingSecret`. Custom `secretPaths`, Vault
file paths, inline credentials, and mixed generated/existing modes are rejected
with an actionable Helm error.

Legacy process-local internal TLS certificates have no persistent identity to
preserve. The first upgrade to generated mode creates stable Kubernetes
Secrets. Production installations should instead disable generated mode and
configure all existing CA and leaf Secret names in the same upgrade.
