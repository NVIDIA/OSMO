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
Expand the name of the chart.
*/}}
{{- define "gateway.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "gateway.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label.
*/}}
{{- define "gateway.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "gateway.labels" -}}
helm.sh/chart: {{ include "gateway.chart" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Component selector labels. Pass a dict with "component" and "context" keys.
*/}}
{{- define "gateway.componentLabels" -}}
app.kubernetes.io/name: {{ include "gateway.name" .context }}
app.kubernetes.io/instance: {{ .context.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Service account name helper.
*/}}
{{- define "gateway.serviceAccountName" -}}
{{- if .serviceAccountName }}
{{- .serviceAccountName }}
{{- else }}
{{- .global.serviceAccountName | default "default" }}
{{- end }}
{{- end }}

{{/*
Extra annotations helper.
*/}}
{{- define "gateway.extra-annotations" -}}
{{- if .extraPodAnnotations }}
{{- toYaml .extraPodAnnotations }}
{{- end }}
{{- end }}

{{/*
Extra environment variables helper.
*/}}
{{- define "gateway.extra-env" -}}
{{- if .extraEnv }}
{{- toYaml .extraEnv }}
{{- end }}
{{- end }}

{{/*
Extra configmaps helper.
*/}}
{{- define "gateway.extra-configmaps" -}}
{{- range .Values.extraConfigMaps }}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .name }}
  namespace: {{ $.Release.Namespace }}
  labels:
    {{- include "gateway.labels" $ | nindent 4 }}
data:
  {{- toYaml .data | nindent 2 }}
{{- end }}
{{- end }}
