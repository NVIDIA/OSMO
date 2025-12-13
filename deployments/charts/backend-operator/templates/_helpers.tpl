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
{{- define "backend-operator.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "backend-operator.fullname" -}}
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
{{- define "backend-operator.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "backend-operator.labels" -}}
helm.sh/chart: {{ include "backend-operator.chart" . }}
{{ include "backend-operator.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "backend-operator.selectorLabels" -}}
app.kubernetes.io/name: {{ include "backend-operator.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create a common service account name based on component
*/}}
{{- define "backend-operator.serviceAccountName" -}}
{{- $name := or .root.Values.global.name .root.Release.Name -}}
{{- if .serviceConfig.serviceAccount -}}
{{- printf "%s-%s" $name .serviceConfig.serviceAccount | trunc 63 | trimSuffix "-" -}}
{{- else if .root.Values.serviceAccount.name -}}
{{- .root.Values.serviceAccount.name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" $name .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end }}

{{/*
Create the name of the service account to use for backend listener
*/}}
{{- define "backend-operator.listener.serviceAccountName" -}}
{{- include "backend-operator.serviceAccountName" (dict "root" . "serviceConfig" .Values.services.backendListener "component" "backend-listener") -}}
{{- end }}

{{/*
Create the name of the service account to use for backend-operator worker
*/}}
{{- define "backend-operator.worker.serviceAccountName" -}}
{{- include "backend-operator.serviceAccountName" (dict "root" . "serviceConfig" .Values.services.backendWorker "component" "backend-worker") -}}
{{- end }}
{{/*
Create the name of the service account to use for test-runner pods.
*/}}
{{- define "backend-operator.testRunner.serviceAccountName" -}}
{{- include "backend-operator.serviceAccountName" (dict "root" . "serviceConfig" .Values.backendTestRunner "component" "test-runner") -}}
{{- end }}
