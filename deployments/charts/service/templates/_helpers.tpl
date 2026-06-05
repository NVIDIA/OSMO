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
{{- if .Values.serviceAccount.create }}
{{- default (include "osmo.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Service account name helper
*/}}
{{- define "osmo.service-account-name" -}}
{{- if .serviceAccountName }}
{{- .serviceAccountName }}
{{- else }}
{{- .Values.global.serviceAccountName }}
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

{{/*
ConfigMap-mode mounts (shared by api-service, worker, agent, logger).
All four services need the same configs ConfigMap and its referenced
secrets so they can read the in-memory snapshot via ConfigMapWatcher
instead of falling back to Postgres.

OSMO_CONFIGMAP_NAME deliberately references services.service.serviceName
(the API service) because the API owns the shared configs ConfigMap.
*/}}
{{- define "osmo.configmap-args" -}}
{{- if .Values.services.configs.enabled }}
- --config_file
- /etc/osmo/configs/config.yaml
{{- end }}
{{- end -}}

{{- define "osmo.configmap-env" -}}
{{- if .Values.services.configs.enabled }}
- name: POD_NAMESPACE
  valueFrom:
    fieldRef:
      fieldPath: metadata.namespace
- name: OSMO_CONFIGMAP_NAME
  value: {{ .Values.services.service.serviceName }}-configs
{{- end }}
{{- end -}}

{{/*
The minimal deploy values keep nvcr-secret as the private-registry default for
existing deployments. Public installs can omit that Secret; in that case, do
not render references that make pods wait on or configs load a missing Secret.
*/}}
{{- define "osmo.config-secret-ref-enabled" -}}
{{- $secretName := .secretName | default "" -}}
{{- $root := .root -}}
{{- $imagePullSecret := $root.Values.global.imagePullSecret | default "" -}}
{{- if and (eq $secretName "nvcr-secret") (ne $imagePullSecret $secretName) (not (lookup "v1" "Secret" $root.Release.Namespace $secretName)) -}}
false
{{- else -}}
true
{{- end -}}
{{- end -}}

{{- define "osmo.configmap-volume-mounts" -}}
{{- if .Values.services.configs.enabled }}
- name: configs
  mountPath: /etc/osmo/configs
  readOnly: true
{{- range .Values.services.configs.secretRefs }}
{{- $secretName := .secretName | default "" }}
{{- if and $secretName (eq (include "osmo.config-secret-ref-enabled" (dict "root" $ "secretName" $secretName) | trim) "true") }}
- name: secret-{{ .secretName }}
  mountPath: /etc/osmo/secrets/{{ .secretName }}
  readOnly: true
{{- end }}
{{- end }}
{{- end }}
{{- end -}}

{{- define "osmo.configmap-volumes" -}}
{{- if .Values.services.configs.enabled }}
- name: configs
  configMap:
    name: {{ .Values.services.service.serviceName }}-configs
{{- range .Values.services.configs.secretRefs }}
{{- $secretName := .secretName | default "" }}
{{- if and $secretName (eq (include "osmo.config-secret-ref-enabled" (dict "root" $ "secretName" $secretName) | trim) "true") }}
- name: secret-{{ .secretName }}
  secret:
    secretName: {{ .secretName }}
{{- end }}
{{- end }}
{{- end }}
{{- end -}}
