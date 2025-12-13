# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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
{{- define "osmo.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "osmo.fullname" -}}
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
Create chart name and version as used by the chart label.
*/}}
{{- define "osmo.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "osmo.labels" -}}
helm.sh/chart: {{ include "osmo.chart" . }}
{{ include "osmo.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "osmo.selectorLabels" -}}
app.kubernetes.io/name: {{ include "osmo.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "osmo.serviceAccountName" -}}
{{- $defaultName := include "osmo.fullname" . }}
{{- if .Values.serviceAccount.create }}
{{- default $defaultName .Values.serviceAccount.name }}
{{- else }}
{{- required "serviceAccount.name must be provided when serviceAccount.create is false" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
The target port for the service
*/}}
{{- define "service.targetPort" -}}
{{- if .Values.sidecars.envoy.enabled -}}
envoy-http
{{- else -}}
8000
{{- end -}}
{{- end }}

{{/*
Service account name helper
*/}}
{{- define "osmo.service-account-name" -}}
{{- if .serviceAccountName }}
{{- .serviceAccountName }}
{{- else }}
{{- include "osmo.serviceAccountName" .root }}
{{- end }}
{{- end }}

{{/*
Extra annotations helper
*/}}
{{- define "osmo.extra-annotations" -}}
{{- if .extraPodAnnotations }}
{{- toYaml .extraPodAnnotations }}
{{- end }}
{{- end }}

{{/*
Extra labels helper
*/}}
{{- define "osmo.extra-labels" -}}
{{- if .extraPodLabels }}
{{- toYaml .extraPodLabels }}
{{- end }}
{{- end }}

{{/*
Extra environment variables helper
*/}}
{{- define "osmo.extra-env" -}}
{{- if .extraEnv }}
{{- toYaml .extraEnv }}
{{- end }}
{{- end }}

{{/*
Extra volume mounts helper
*/}}
{{- define "osmo.extra-volume-mounts" -}}
{{- if .extraVolumeMounts }}
{{- toYaml .extraVolumeMounts }}
{{- end }}
{{- end }}

{{/*
Extra volumes helper
*/}}
{{- define "osmo.extra-volumes" -}}
{{- if .extraVolumes }}
{{- toYaml .extraVolumes }}
{{- end }}
{{- end }}

{{/*
Extra sidecars helper
*/}}
{{- define "osmo.extra-sidecars" -}}
{{- if .extraSidecars }}
{{- toYaml .extraSidecars }}
{{- end }}
{{- end }}

{{/*
Extra configmaps helper
*/}}
{{- define "osmo.extra-configmaps" -}}
{{- range .Values.extraConfigMaps }}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .name }}
  namespace: {{ $.Release.Namespace }}
  labels:
    {{- include "osmo.labels" $ | nindent 4 }}
data:
  {{- toYaml .data | nindent 2 }}
{{- end }}
{{- end }}

