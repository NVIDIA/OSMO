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

{{/*
Per-upstream TLS args. Used by api-service, agent-service, logger-service,
router-service when gateway.tls.enabled is true. Pass a dict with "context".

Outputs --ssl_keyfile and --ssl_certfile, indented to fit container args lists.
The mount path is fixed at /etc/osmo/tls; the cert is provided by the
{name}-tls Secret created by gateway-tls.yaml.
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
TLS volume mount for an upstream container. Use under volumeMounts.
*/}}
{{- define "osmo.upstream-tls-volume-mount" -}}
{{- if .context.Values.gateway.tls.enabled }}
- name: tls
  mountPath: /etc/osmo/tls
  readOnly: true
{{- end }}
{{- end }}

{{/*
TLS volume for an upstream pod. Pass dict with "context" and "secret" (the
per-service Secret name, e.g. "osmo-service-tls"). Use under volumes.
*/}}
{{- define "osmo.upstream-tls-volume" -}}
{{- if .context.Values.gateway.tls.enabled }}
- name: tls
  secret:
    secretName: {{ .secret }}
{{- end }}
{{- end }}

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
