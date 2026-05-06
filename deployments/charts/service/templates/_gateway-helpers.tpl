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
Per-upstream TLS args. Pass a dict with "context" and "secretName".

When secretName is non-empty, that Secret is mounted at /etc/osmo/tls and
uvicorn loads tls.crt + tls.key from there (--ssl_keyfile / --ssl_certfile).
When empty, the Python service mints an ephemeral self-signed cert in
process at startup (--ssl_self_signed true) — no chart-side cert material.
*/}}
{{- define "osmo.upstream-tls-args" -}}
{{- if .context.Values.gateway.tls.enabled }}
{{- if .secretName }}
- --ssl_keyfile
- /etc/osmo/tls/tls.key
- --ssl_certfile
- /etc/osmo/tls/tls.crt
{{- else }}
- --ssl_self_signed
- "true"
{{- end }}
{{- end }}
{{- end }}

{{/*
TLS volume mount for an upstream container. Only emitted when a Secret
name is provided — self-signed mode keeps cert material in an in-process
tempdir, so no mount is needed.
*/}}
{{- define "osmo.upstream-tls-volume-mount" -}}
{{- if and .context.Values.gateway.tls.enabled .secretName }}
- name: tls
  mountPath: /etc/osmo/tls
  readOnly: true
{{- end }}
{{- end }}

{{/*
TLS volume for an upstream pod. Pass dict with "context" and "secretName".
Only emitted when secretName is non-empty.
*/}}
{{- define "osmo.upstream-tls-volume" -}}
{{- if and .context.Values.gateway.tls.enabled .secretName }}
- name: tls
  secret:
    secretName: {{ .secretName }}
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
