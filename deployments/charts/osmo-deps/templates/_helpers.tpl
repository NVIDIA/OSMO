{{/* SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. */}}
{{/* SPDX-License-Identifier: Apache-2.0 */}}

{{- define "osmo-deps.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "osmo-deps.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else if contains (include "osmo-deps.name" .) .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "osmo-deps.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "osmo-deps.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "osmo-deps.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "osmo-deps.componentLabels" -}}
{{ include "osmo-deps.labels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "osmo-deps.credentialsSecretName" -}}
{{- default (printf "%s-credentials" (include "osmo-deps.fullname" .)) .Values.credentials.secretName -}}
{{- end }}
