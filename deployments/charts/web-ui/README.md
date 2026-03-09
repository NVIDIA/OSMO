<!--
  SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

# NVIDIA OSMO - UI Service Helm Chart

This Helm chart deploys the OSMO UI service along with its required sidecars and configurations.

## Values

### Global Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.osmoImageLocation` | Location of OSMO images | `nvcr.io/nvidia/osmo` |
| `global.osmoImageTag` | Tag of the OSMO images | `latest` |
| `global.imagePullSecret` | Name of the Kubernetes secret containing Docker registry credentials | `null` |
| `global.nodeSelector` | Global node selector | `{}` |

### Global Logging Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.logs.enabled` | Enable centralized logging collection and log volume mounting | `true` |


### UI Service Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.ui.replicas` | Number of UI replicas (when scaling is disabled) | `1` |
| `services.ui.imageName` | Name of UI image | `web-ui` |
| `services.ui.imagePullPolicy` | Image pull policy | `Always` |
| `services.ui.serviceName` | Name of the service | `osmo-ui` |
| `services.ui.hostname` | Hostname for the service | `""` (empty, must be configured) |
| `services.ui.apiHostname` | Hostname on which the API is served | `"osmo-service.osmo.svc.cluster.local:80"` |
| `services.ui.portForwardEnabled` | Enable port-forwarding through Web UI | `false` |
| `service.ui.nextjsSslEnabled` | SSL/TLS encryption for nextjs server to connect to the osmo API server | `false` |
| `services.ui.nodeSelector` | Node selector constraints for UI pod scheduling | `{}` |
| `services.ui.hostAliases` | Host aliases for custom DNS resolution | `[]` |
| `services.ui.tolerations` | Tolerations for pod scheduling on tainted nodes | `[]` |
| `services.ui.resources` | Resource limits and requests for the UI container | `{}` |
| `services.ui.docsBaseUrl` | Documentation base URL users will see from the UI | `"https://nvidia.github.io/OSMO/main/user_guide/"` |
| `services.ui.cliInstallScriptUrl` | CLI Installation Script URL displayed in the UI | `"https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh"` |
| `services.ui.maxHttpHeaderSizeKb` | Maximum HTTP header size in KB for Node.js server (should match Envoy's limit to prevent 431 errors) | `128` |

### UI Scaling Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.ui.scaling.enabled` | Enable HorizontalPodAutoscaler | `false` |
| `services.ui.scaling.minReplicas` | Minimum number of replicas | `1` |
| `services.ui.scaling.maxReplicas` | Maximum number of replicas | `3` |
| `services.ui.scaling.hpaTarget` | Target Memory Utilization Percentage | `85` |

### Ingress Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.service.ingress.enabled` | Enable ingress for external access | `true`|
| `services.ui.ingress.prefix` | URL path prefix | `/` |
| `services.ui.ingress.ingressClass` | Ingress controller class | `nginx` |
| `services.ui.ingress.sslEnabled` | Enable SSL | `true` |
| `services.ui.ingress.sslSecret` | Name of SSL secret | `osmo-tls` |

#### ALB Annotations Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.ui.ingress.albAnnotations.enabled` | Enable ALB annotations | `false` |
| `services.ui.ingress.albAnnotations.sslCertArn` | ARN of SSL certificate | `arn:aws:acm:us-west-2:XXXXXXXXX:certificate/YYYYYYYY` |

### Sidecar Container Settings

#### Envoy Proxy Sidecar

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.envoy.enabled` | Enable Envoy proxy sidecar | `true` |
| `sidecars.envoy.image.repository` | Envoy image repository | `envoyproxy/envoy:v1.29.0` |
| `sidecars.envoy.image.pullPolicy` | Envoy image pull policy | `IfNotPresent` |
| `sidecars.envoy.service.address` | Backend service address | `127.0.0.1` |
| `sidecars.envoy.service.port` | Backend service port | `8000` |
| `sidecars.envoy.service.hostname` | Service hostname | `""` (empty, must be configured) |
| `sidecars.envoy.listenerPort` | Envoy listener port | `80` |
| `sidecars.envoy.maxHeadersSizeKb` | Maximum HTTP headers size in KB | `128` |
| `sidecars.envoy.skipAuthPaths` | Paths to skip authentication | `[]` |

#### JWT Authentication Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.envoy.jwt.user_header` | JWT user header name | `x-osmo-user` |
| `sidecars.envoy.jwt.providers[].issuer` | JWT token issuer | `""` (empty, must be configured) |
| `sidecars.envoy.jwt.providers[].audience` | JWT token audience | `""` (empty, must be configured) |
| `sidecars.envoy.jwt.providers[].jwks_uri` | JWT JWKS URI | `""` (empty, must be configured) |
| `sidecars.envoy.jwt.providers[].user_claim` | JWT user claim field | `preferred_username` |
| `sidecars.envoy.jwt.providers[].cluster` | Target cluster name | `idp` |

### Redis Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `services.redis.serviceName` | Kubernetes service name for Redis (used for OAuth2-Proxy session store) | `redis` |
| `services.redis.port` | Redis service port | `6379` |
| `services.redis.dbNumber` | Redis database number to use (0–15) | `0` |
| `services.redis.tlsEnabled` | Enable TLS encryption for Redis connections | `true` |

#### OAuth2 Proxy Sidecar

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sidecars.oauth2Proxy.enabled` | Enable OAuth2 Proxy sidecar | `true` |
| `sidecars.oauth2Proxy.image` | OAuth2 Proxy container image | `quay.io/oauth2-proxy/oauth2-proxy:v7.14.2` |
| `sidecars.oauth2Proxy.httpPort` | HTTP port for OAuth2 Proxy | `4180` |
| `sidecars.oauth2Proxy.provider` | OIDC provider type | `oidc` |
| `sidecars.oauth2Proxy.oidcIssuerUrl` | OIDC issuer URL | `""` (empty, must be configured) |
| `sidecars.oauth2Proxy.clientId` | OAuth2 client ID | `""` (empty, must be configured) |
| `sidecars.oauth2Proxy.cookieName` | Session cookie name | `_osmo_session` |
| `sidecars.oauth2Proxy.cookieSecure` | Set Secure flag on cookies | `true` |
| `sidecars.oauth2Proxy.cookieDomain` | Cookie domain | `""` (empty, must be configured) |
| `sidecars.oauth2Proxy.cookieExpire` | Cookie expiration duration | `168h` |
| `sidecars.oauth2Proxy.cookieRefresh` | Cookie refresh interval | `1h` |
| `sidecars.oauth2Proxy.scope` | OAuth2 scopes to request | `openid email profile` |
| `sidecars.oauth2Proxy.oidcEndSessionUrl` | IdP end-session endpoint for federated logout. When set, Envoy exposes `/signout` which redirects to `/oauth2/sign_out?rd=<url>`, clearing both the local session cookie and the IdP's SSO session. Requires `--whitelist-domain=<idp-domain>` in `extraArgs`. | `""` (disabled) |
| `sidecars.oauth2Proxy.redisSessionStore` | Use Redis (`services.redis`) as the session store instead of in-memory | `true` |
| `sidecars.oauth2Proxy.extraArgs` | Additional arguments passed to oauth2-proxy | `[]` |
| `sidecars.oauth2Proxy.useKubernetesSecrets` | Use Kubernetes secrets for credentials | `false` |
| `sidecars.oauth2Proxy.secretName` | Kubernetes secret name (when `useKubernetesSecrets` is true) | `oauth2-proxy-secrets` |
| `sidecars.oauth2Proxy.secretPaths.clientSecret` | File path for client secret | `/etc/oauth2-proxy/client-secret` |
| `sidecars.oauth2Proxy.secretPaths.cookieSecret` | File path for cookie secret | `/etc/oauth2-proxy/cookie-secret` |

#### Additional Custom Containers

| Parameter | Description | Default |
|-----------|-------------|---------|
| `extraContainers` | List of additional custom containers to add to the pod | `[]` |

## Dependencies

This chart is self-contained and requires:
- A running Kubernetes cluster
- Access to NVIDIA container registry
- ALB or NGINX ingress controller
- Properly configured OAuth2 provider

**Optional Dependencies:**
- Kubernetes secrets (if using `useKubernetesSecrets: true` for OAuth2 credentials)
