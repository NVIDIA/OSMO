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
{{- define "osmo.gateway.fullname" -}}
{{- include "osmo.component.fullname" (dict "root" . "suffix" "gateway") -}}
{{- end }}

{{/*
Gateway component labels. Pass a dict with "component" and "context" keys.
*/}}
{{- define "osmo.gateway.componentSelectorLabels" -}}
{{- include "osmo.component.selectorLabels" (dict "root" .context "component" (printf "gateway-%s" .component)) -}}
{{- end }}

{{/*
Per-upstream TLS args. Pass a dict with "context" and "secretName".

The chart always mounts a stable Kubernetes Secret when internal TLS is on.
*/}}
{{- define "osmo.gateway.upstreamTlsArgs" -}}
{{- if .context.Values.gateway.tls.enabled }}
- --ssl_keyfile
- /etc/osmo/tls/tls.key
- --ssl_certfile
- /etc/osmo/tls/tls.crt
{{- end }}
{{- end }}

{{/* TLS volume mount for an upstream container. */}}
{{- define "osmo.gateway.upstreamTlsVolumeMount" -}}
{{- if .context.Values.gateway.tls.enabled }}
- name: tls
  mountPath: /etc/osmo/tls
  readOnly: true
{{- end }}
{{- end }}

{{/* TLS volume for an upstream pod. Pass dict with "context" and "secretName". */}}
{{- define "osmo.gateway.upstreamTlsVolume" -}}
{{- if .context.Values.gateway.tls.enabled }}
- name: tls
  secret:
    secretName: {{ required "internal TLS Secret name is required" .secretName | quote }}
{{- end }}
{{- end }}

{{- define "osmo.gateway.tlsLeafSecretName" -}}
{{- if .root.Values.gateway.tls.generated.enabled -}}
{{- printf "%s-internal-tls-%s" (include "osmo.fullname" .root) .component | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- required (printf "gateway.tls.upstreamCerts.%s is required when generated TLS is disabled" .component) (index .root.Values.gateway.tls.upstreamCerts .component) -}}
{{- end -}}
{{- end -}}

{{- define "osmo.gateway.tlsTrustSecretName" -}}
{{- if .Values.gateway.tls.generated.enabled -}}
{{- printf "%s-internal-tls-trust" (include "osmo.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- required "gateway.tls.caSecret is required when generated TLS is disabled" .Values.gateway.tls.caSecret -}}
{{- end -}}
{{- end -}}

{{- define "osmo.gateway.tlsCaSecretName" -}}
{{- printf "%s-internal-tls-ca" (include "osmo.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "osmo.gateway.tlsRolloutAnnotations" -}}
checksum/internal-tls-rotation: {{ dict "external" .Values.gateway.tls.rolloutNonce "leaf" .Values.gateway.tls.generated.leafRotationNonce "ca" .Values.gateway.tls.generated.caRotation | toJson | sha256sum | quote }}
checksum/internal-tls-ca-phase: {{ printf "%s:%s" .Values.gateway.tls.generated.caRotation.id .Values.gateway.tls.generated.caRotation.phase | quote }}
{{- end -}}

{{- define "osmo.gateway.upstreamValidationContext" -}}
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

{{/*
Render a probe block, injecting `scheme: HTTPS` into httpGet when TLS is on.
Pass dict with "probe" (the probe value from Values) and "context" ($).

Use:
  livenessProbe:
  {{- include "osmo.gateway.upstreamProbeYaml" (dict "probe" .Values.services.api.livenessProbe "context" .) | nindent 10 }}
*/}}
{{- define "osmo.gateway.upstreamProbeYaml" -}}
{{- $probe := .probe }}
{{- if and $probe .context.Values.gateway.tls.enabled (hasKey $probe "httpGet") }}
  {{- $probe = mustMergeOverwrite (deepCopy $probe) (dict "httpGet" (dict "scheme" "HTTPS")) }}
{{- end }}
{{- toYaml $probe }}
{{- end }}
