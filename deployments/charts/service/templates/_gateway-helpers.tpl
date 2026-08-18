# SPDX-FileCopyrightText: Copyright (c) 2024-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

{{/*
Gateway component name prefix. All gateway resources are named
<prefix>-<component>, e.g. osmo-gateway-envoy.
*/}}
{{- define "osmo.gateway-name" -}}
{{- .Values.gateway.name | default "osmo-gateway" }}
{{- end }}

{{/*
Gateway component labels. Pass a dict with "component" and "context" keys.
*/}}
{{- define "osmo.gateway-component-labels" -}}
app.kubernetes.io/name: {{ include "osmo.gateway-name" .context }}
app.kubernetes.io/instance: {{ .context.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/* Fail without echoing untrusted values when a typed values object is malformed. */}}
{{- define "osmo.contract.validate-object" -}}
{{- if not (kindIs "map" .value) -}}
{{- fail (printf "%s must be an object" .path) -}}
{{- end -}}
{{- $valid := true -}}
{{- range $key := keys .value -}}
{{- if not (has $key $.fields) -}}{{- $valid = false -}}{{- end -}}
{{- end -}}
{{- if not $valid -}}{{- fail (printf "%s contains unsupported fields" .path) -}}{{- end -}}
{{- end -}}

{{- define "osmo.contract.validate-string" -}}
{{- if not (kindIs "string" .value) -}}
{{- fail (printf "%s must be a string" .path) -}}
{{- end -}}
{{- end -}}

{{- define "osmo.contract.validate-existing-secret" -}}
{{- include "osmo.contract.validate-object" (dict "path" .path "value" .value "fields" (list "name" "key")) -}}
{{- include "osmo.contract.validate-string" (dict "path" (printf "%s.name" .path) "value" .value.name) -}}
{{- include "osmo.contract.validate-string" (dict "path" (printf "%s.key" .path) "value" .value.key) -}}
{{- end -}}

{{/* Typed OAuth Secret contracts with a compatibility mapping for the legacy
single-Secret fields. Vault/file-path mode is intentionally rejected. */}}
{{- define "osmo.oauth-secrets.validate" -}}
{{- $oauth := .Values.gateway.oauth2Proxy -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.oauth2Proxy.secretName" "value" $oauth.secretName) -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.oauth2Proxy.clientSecretKey" "value" $oauth.clientSecretKey) -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.oauth2Proxy.cookieSecretKey" "value" $oauth.cookieSecretKey) -}}
{{- include "osmo.contract.validate-object" (dict "path" "gateway.oauth2Proxy.secretPaths" "value" $oauth.secretPaths "fields" (list "clientSecret" "cookieSecret")) -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.oauth2Proxy.secretPaths.clientSecret" "value" $oauth.secretPaths.clientSecret) -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.oauth2Proxy.secretPaths.cookieSecret" "value" $oauth.secretPaths.cookieSecret) -}}
{{- if not (kindIs "bool" $oauth.useKubernetesSecrets) -}}
{{- fail "gateway.oauth2Proxy.useKubernetesSecrets must be a boolean" -}}
{{- end -}}
{{- include "osmo.contract.validate-object" (dict "path" "gateway.oauth2Proxy.clientSecret" "value" $oauth.clientSecret "fields" (list "existingSecret" "rolloutNonce")) -}}
{{- include "osmo.contract.validate-existing-secret" (dict "path" "gateway.oauth2Proxy.clientSecret.existingSecret" "value" $oauth.clientSecret.existingSecret) -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.oauth2Proxy.clientSecret.rolloutNonce" "value" $oauth.clientSecret.rolloutNonce) -}}
{{- include "osmo.contract.validate-object" (dict "path" "gateway.oauth2Proxy.cookieSecret" "value" $oauth.cookieSecret "fields" (list "generate" "existingSecret" "rolloutNonce" "bootstrap")) -}}
{{- if not (kindIs "bool" $oauth.cookieSecret.generate) -}}
{{- fail "gateway.oauth2Proxy.cookieSecret.generate must be a boolean" -}}
{{- end -}}
{{- include "osmo.contract.validate-existing-secret" (dict "path" "gateway.oauth2Proxy.cookieSecret.existingSecret" "value" $oauth.cookieSecret.existingSecret) -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.oauth2Proxy.cookieSecret.rolloutNonce" "value" $oauth.cookieSecret.rolloutNonce) -}}
{{- include "osmo.contract.validate-object" (dict "path" "gateway.oauth2Proxy.cookieSecret.bootstrap" "value" $oauth.cookieSecret.bootstrap "fields" (list "image" "imagePullPolicy")) -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.oauth2Proxy.cookieSecret.bootstrap.image" "value" $oauth.cookieSecret.bootstrap.image) -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.oauth2Proxy.cookieSecret.bootstrap.imagePullPolicy" "value" $oauth.cookieSecret.bootstrap.imagePullPolicy) -}}
{{- if not (has $oauth.cookieSecret.bootstrap.imagePullPolicy (list "Always" "IfNotPresent" "Never")) -}}
{{- fail "gateway.oauth2Proxy.cookieSecret.bootstrap.imagePullPolicy is invalid" -}}
{{- end -}}
{{- if not $oauth.useKubernetesSecrets -}}
{{- fail "gateway.oauth2Proxy.useKubernetesSecrets=false is no longer supported; configure clientSecret.existingSecret and cookieSecret" -}}
{{- end -}}
{{- if or (ne $oauth.secretPaths.clientSecret "/etc/oauth2-proxy/client-secret") (ne $oauth.secretPaths.cookieSecret "/etc/oauth2-proxy/cookie-secret") -}}
{{- fail "gateway.oauth2Proxy.secretPaths are chart-owned; remove custom Vault or file paths" -}}
{{- end -}}
{{- if and $oauth.cookieSecret.generate $oauth.cookieSecret.existingSecret.name -}}
{{- fail "gateway.oauth2Proxy.cookieSecret.generate and existingSecret.name are mutually exclusive" -}}
{{- end -}}
{{- end -}}

{{- define "osmo.oauth-client-secret-name" -}}
{{- .Values.gateway.oauth2Proxy.clientSecret.existingSecret.name | default .Values.gateway.oauth2Proxy.secretName | required "gateway.oauth2Proxy.clientSecret.existingSecret.name is required" -}}
{{- end -}}

{{- define "osmo.oauth-client-secret-key" -}}
{{- .Values.gateway.oauth2Proxy.clientSecret.existingSecret.key | default .Values.gateway.oauth2Proxy.clientSecretKey | required "gateway.oauth2Proxy.clientSecret.existingSecret.key is required" -}}
{{- end -}}

{{- define "osmo.oauth-cookie-secret-name" -}}
{{- if .Values.gateway.oauth2Proxy.cookieSecret.generate -}}
{{- printf "%s-oauth-cookie" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- .Values.gateway.oauth2Proxy.cookieSecret.existingSecret.name | default .Values.gateway.oauth2Proxy.secretName | required "gateway.oauth2Proxy.cookieSecret.existingSecret.name is required" -}}
{{- end -}}
{{- end -}}

{{- define "osmo.oauth-cookie-secret-key" -}}
{{- .Values.gateway.oauth2Proxy.cookieSecret.existingSecret.key | default .Values.gateway.oauth2Proxy.cookieSecretKey | required "gateway.oauth2Proxy.cookieSecret.existingSecret.key is required" -}}
{{- end -}}

{{- define "osmo.gateway-tls-leaf-secret-name" -}}
{{- include "osmo.gateway-tls.validate" .root -}}
{{- if .root.Values.gateway.tls.generated.enabled -}}
{{- printf "%s-internal-tls-%s" .root.Release.Name .component | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- required (printf "gateway.tls.upstreamCerts.%s is required when generated TLS is disabled" .component) (index .root.Values.gateway.tls.upstreamCerts .component) -}}
{{- end -}}
{{- end -}}

{{- define "osmo.gateway-tls-ca-secret-name" -}}
{{- include "osmo.gateway-tls.validate" . -}}
{{- if .Values.gateway.tls.generated.enabled -}}
{{- printf "%s-internal-tls-trust" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- required "gateway.tls.caSecret is required when generated TLS is disabled" .Values.gateway.tls.caSecret -}}
{{- end -}}
{{- end -}}

{{- define "osmo.gateway-tls-generated-ca-secret-name" -}}
{{- printf "%s-internal-tls-ca" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "osmo.gateway-tls.validate" -}}
{{- $tls := .Values.gateway.tls -}}
{{- include "osmo.contract.validate-object" (dict "path" "gateway.tls" "value" $tls "fields" (list "enabled" "rolloutNonce" "generated" "upstreamCerts" "caSecret")) -}}
{{- if not (kindIs "bool" $tls.enabled) -}}{{- fail "gateway.tls.enabled must be a boolean" -}}{{- end -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.tls.rolloutNonce" "value" $tls.rolloutNonce) -}}
{{- include "osmo.contract.validate-object" (dict "path" "gateway.tls.generated" "value" $tls.generated "fields" (list "enabled" "bootstrap" "leafRotationNonce" "caRotation")) -}}
{{- if not (kindIs "bool" $tls.generated.enabled) -}}{{- fail "gateway.tls.generated.enabled must be a boolean" -}}{{- end -}}
{{- include "osmo.contract.validate-object" (dict "path" "gateway.tls.generated.bootstrap" "value" $tls.generated.bootstrap "fields" (list "image" "imagePullPolicy")) -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.tls.generated.bootstrap.image" "value" $tls.generated.bootstrap.image) -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.tls.generated.bootstrap.imagePullPolicy" "value" $tls.generated.bootstrap.imagePullPolicy) -}}
{{- if not (has $tls.generated.bootstrap.imagePullPolicy (list "Always" "IfNotPresent" "Never")) -}}{{- fail "gateway.tls.generated.bootstrap.imagePullPolicy is invalid" -}}{{- end -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.tls.generated.leafRotationNonce" "value" $tls.generated.leafRotationNonce) -}}
{{- include "osmo.contract.validate-object" (dict "path" "gateway.tls.generated.caRotation" "value" $tls.generated.caRotation "fields" (list "id" "phase" "freezeHpas")) -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.tls.generated.caRotation.id" "value" $tls.generated.caRotation.id) -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.tls.generated.caRotation.phase" "value" $tls.generated.caRotation.phase) -}}
{{- if not (kindIs "bool" $tls.generated.caRotation.freezeHpas) -}}{{- fail "gateway.tls.generated.caRotation.freezeHpas must be a boolean" -}}{{- end -}}
{{- include "osmo.contract.validate-object" (dict "path" "gateway.tls.upstreamCerts" "value" $tls.upstreamCerts "fields" (list "service" "router" "agent" "logger" "mcp")) -}}
{{- range $component := list "service" "router" "agent" "logger" "mcp" -}}
{{- include "osmo.contract.validate-string" (dict "path" (printf "gateway.tls.upstreamCerts.%s" $component) "value" (index $tls.upstreamCerts $component)) -}}
{{- end -}}
{{- include "osmo.contract.validate-string" (dict "path" "gateway.tls.caSecret" "value" $tls.caSecret) -}}
{{- if $tls.enabled -}}
{{- if $tls.generated.enabled -}}
{{- if or $tls.caSecret $tls.upstreamCerts.service $tls.upstreamCerts.router $tls.upstreamCerts.agent $tls.upstreamCerts.logger $tls.upstreamCerts.mcp -}}
{{- fail "gateway.tls.generated.enabled cannot be combined with caSecret or upstreamCerts" -}}
{{- end -}}
{{- if not (has $tls.generated.caRotation.phase (list "stable" "prepare" "activate" "retire")) -}}
{{- fail "gateway.tls.generated.caRotation.phase must be stable, prepare, activate, or retire" -}}
{{- end -}}
{{- if and (ne $tls.generated.caRotation.phase "stable") (not $tls.generated.caRotation.id) -}}
{{- fail "gateway.tls.generated.caRotation.id is required outside the stable phase" -}}
{{- end -}}
{{- if and (ne $tls.generated.caRotation.phase "stable") (not $tls.generated.caRotation.freezeHpas) -}}
{{- fail "gateway.tls.generated.caRotation.freezeHpas must be true during CA rotation" -}}
{{- end -}}
{{- else -}}
{{- if not $tls.caSecret -}}
{{- fail "gateway.tls.caSecret is required when generated TLS is disabled" -}}
{{- end -}}
{{- range $component := list "service" "router" "agent" "logger" -}}
{{- if not (index $tls.upstreamCerts $component) -}}
{{- fail (printf "gateway.tls.upstreamCerts.%s is required when generated TLS is disabled" $component) -}}
{{- end -}}
{{- end -}}
{{- if and .Values.services.mcp.enabled (not $tls.upstreamCerts.mcp) -}}
{{- fail "gateway.tls.upstreamCerts.mcp is required when generated TLS is disabled and MCP is enabled" -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Per-upstream TLS args. Pass a dict with "context" and "secretName".

The chart always mounts a stable Kubernetes Secret when internal TLS is on.
*/}}
{{- define "osmo.upstream-tls-args" -}}
{{- if .context.Values.gateway.tls.enabled }}
- --ssl_keyfile
- /etc/osmo/tls/tls.key
- --ssl_certfile
- /etc/osmo/tls/tls.crt
{{- end }}
{{- end }}

{{/*
TLS volume mount for an upstream container.
*/}}
{{- define "osmo.upstream-tls-volume-mount" -}}
{{- if .context.Values.gateway.tls.enabled }}
- name: tls
  mountPath: /etc/osmo/tls
  readOnly: true
{{- end }}
{{- end }}

{{/*
TLS volume for an upstream pod. Pass dict with "context" and "secretName".
*/}}
{{- define "osmo.upstream-tls-volume" -}}
{{- if .context.Values.gateway.tls.enabled }}
- name: tls
  secret:
    secretName: {{ required "internal TLS Secret name is required" .secretName | quote }}
{{- end }}
{{- end }}

{{- define "osmo.gateway-tls-rollout-annotations" -}}
{{- include "osmo.gateway-tls.validate" . -}}
checksum/internal-tls-rotation: {{ dict "external" .Values.gateway.tls.rolloutNonce "leaf" .Values.gateway.tls.generated.leafRotationNonce "ca" .Values.gateway.tls.generated.caRotation | toJson | sha256sum | quote }}
checksum/internal-tls-ca-phase: {{ printf "%s:%s" .Values.gateway.tls.generated.caRotation.id .Values.gateway.tls.generated.caRotation.phase | quote }}
{{- end -}}

{{- define "osmo.gateway-upstream-validation-context" -}}
combined_validation_context:
  default_validation_context:
    match_typed_subject_alt_names:
    - san_type: DNS
      matcher:
        exact: {{ .host | quote }}
  validation_context_sds_secret_config:
    name: upstream_ca
    sds_config:
      path_config_source:
        path: /var/config/sds_upstream_ca.yaml
        watched_directory:
          path: /var/config
{{- end -}}

{{- define "osmo.mcp-credentials.validate" -}}
{{- $proxy := .Values.services.mcp.oidcProxy -}}
{{- if not (kindIs "bool" $proxy.enabled) -}}{{- fail "services.mcp.oidcProxy.enabled must be a boolean" -}}{{- end -}}
{{- include "osmo.contract.validate-object" (dict "path" "services.mcp.oidcProxy.existingSecret" "value" $proxy.existingSecret "fields" (list "name" "mountPath" "clientSecretKey" "redisPasswordKey")) -}}
{{- range $field := list "name" "mountPath" "clientSecretKey" "redisPasswordKey" -}}
{{- include "osmo.contract.validate-string" (dict "path" (printf "services.mcp.oidcProxy.existingSecret.%s" $field) "value" (index $proxy.existingSecret $field)) -}}
{{- end -}}
{{- include "osmo.contract.validate-string" (dict "path" "services.mcp.oidcProxy.oidc.clientSecretFile" "value" $proxy.oidc.clientSecretFile) -}}
{{- include "osmo.contract.validate-string" (dict "path" "services.mcp.oidcProxy.redis.passwordFile" "value" $proxy.redis.passwordFile) -}}
{{- $credentials := $proxy.credentials -}}
{{- include "osmo.contract.validate-object" (dict "path" "services.mcp.oidcProxy.credentials" "value" $credentials "fields" (list "rolloutNonce" "clientSecret" "redisPassword" "storageEncryptionKey" "jwtSigningKey")) -}}
{{- include "osmo.contract.validate-string" (dict "path" "services.mcp.oidcProxy.credentials.rolloutNonce" "value" $credentials.rolloutNonce) -}}
{{- range $credential := list "clientSecret" "redisPassword" "storageEncryptionKey" "jwtSigningKey" -}}
{{- $value := index $credentials $credential -}}
{{- include "osmo.contract.validate-object" (dict "path" (printf "services.mcp.oidcProxy.credentials.%s" $credential) "value" $value "fields" (list "existingSecret")) -}}
{{- include "osmo.contract.validate-existing-secret" (dict "path" (printf "services.mcp.oidcProxy.credentials.%s.existingSecret" $credential) "value" $value.existingSecret) -}}
{{- end -}}
{{- end -}}

{{/*
Render a probe block, injecting `scheme: HTTPS` into httpGet when TLS is on.
Pass dict with "probe" (the probe value from Values) and "context" ($).

Use:
  livenessProbe:
  {{- include "osmo.upstream-probe-yaml" (dict "probe" .Values.services.service.livenessProbe "context" .) | nindent 10 }}
*/}}
{{- define "osmo.upstream-probe-yaml" -}}
{{- $probe := .probe }}
{{- if and $probe .context.Values.gateway.tls.enabled (hasKey $probe "httpGet") }}
  {{- $probe = mustMergeOverwrite (deepCopy $probe) (dict "httpGet" (dict "scheme" "HTTPS")) }}
{{- end }}
{{- toYaml $probe }}
{{- end }}
