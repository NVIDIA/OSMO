{{/* SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. */}}
{{/* SPDX-License-Identifier: Apache-2.0 */}}

{{- define "osmo.notes" -}}
OSMO control plane installed.

The API component is named {{ include "osmo.api.fullname" . }}. The gateway
Service has one port and follows gateway.envoy.service.type; Ingress and
HTTPRoute are optional edge resources.

Configured public URL:

  {{ .Values.externalUrl }}

{{ if .Values.httproute.enabled }}
An HTTPRoute attaches to an existing Gateway named in httproute.parentRefs;
this chart does not create a Gateway or GatewayClass.
{{ end }}

To test a ClusterIP gateway locally, run:

  kubectl --namespace {{ .Release.Namespace }} port-forward service/{{ include "osmo.gateway.fullname" . }} 8080:{{ .Values.gateway.envoy.service.port }}

{{- if .Values.gateway.envoy.ssl.enabled }}

For a local-only TLS check, disable certificate verification because the
gateway certificate normally identifies its public DNS name:

  curl --insecure https://127.0.0.1:8080/api/version
{{- else }}

Then query:

  curl http://127.0.0.1:8080/api/version
{{- end }}
{{- end }}
