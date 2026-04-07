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
Transform secretName to secret_file in a dict.
Expects a dict context. If the dict has a "secretName" key, replaces it with
"secret_file: /etc/osmo/secrets/<secretName>/cred.yaml".
*/}}
{{- define "osmo.resolve-secret-name" -}}
{{- if .secretName -}}
{{- $secretName := .secretName -}}
{{- $secretKey := default "cred.yaml" .secretKey -}}
{{- $_ := set . "secret_file" (printf "/etc/osmo/secrets/%s/%s" $secretName $secretKey) -}}
{{- $_ := unset . "secretName" -}}
{{- $_ := unset . "secretKey" -}}
{{- end -}}
{{- end -}}

{{/*
Recursively walk a config dict and resolve secretName references at any level.
Since Go templates lack true recursion via 'template' with dynamic context mutation,
we handle this with explicit depth traversal up to 4 levels deep.
Expects a dict as context.
*/}}
{{- define "osmo.resolve-secret-names-in-config" -}}
{{- range $key, $value := . }}
{{- if kindIs "map" $value }}
{{- if hasKey $value "secretName" }}
{{- $secretName := $value.secretName }}
{{- $secretKey := default "cred.yaml" (index $value "secretKey") }}
{{- $_ := set $value "secret_file" (printf "/etc/osmo/secrets/%s/%s" $secretName $secretKey) }}
{{- $_ := unset $value "secretKey" }}
{{- $_ := unset $value "secretName" }}
{{- else }}
{{/* Recurse one level deeper */}}
{{- range $k2, $v2 := $value }}
{{- if kindIs "map" $v2 }}
{{- if hasKey $v2 "secretName" }}
{{- $sn := $v2.secretName }}
{{- $sk := default "cred.yaml" (index $v2 "secretKey") }}
{{- $_ := set $v2 "secret_file" (printf "/etc/osmo/secrets/%s/%s" $sn $sk) }}
{{- $_ := unset $v2 "secretKey" }}
{{- $_ := unset $v2 "secretName" }}
{{- else }}
{{/* Recurse another level deeper */}}
{{- range $k3, $v3 := $v2 }}
{{- if kindIs "map" $v3 }}
{{- if hasKey $v3 "secretName" }}
{{- $sn := $v3.secretName }}
{{- $sk := default "cred.yaml" (index $v3 "secretKey") }}
{{- $_ := set $v3 "secret_file" (printf "/etc/osmo/secrets/%s/%s" $sn $sk) }}
{{- $_ := unset $v3 "secretKey" }}
{{- $_ := unset $v3 "secretName" }}
{{- else }}
{{/* One more level */}}
{{- range $k4, $v4 := $v3 }}
{{- if kindIs "map" $v4 }}
{{- if hasKey $v4 "secretName" }}
{{- $sn := $v4.secretName }}
{{- $sk := default "cred.yaml" (index $v4 "secretKey") }}
{{- $_ := set $v4 "secret_file" (printf "/etc/osmo/secrets/%s/%s" $sn $sk) }}
{{- $_ := unset $v4 "secretKey" }}
{{- $_ := unset $v4 "secretName" }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end -}}

{{/*
Collect all secretName values from a config dict (up to 4 levels deep).
Returns a comma-separated string of unique secret names.
Expects a dict as context.
*/}}
{{- define "osmo.collect-secret-names" -}}
{{- $secrets := dict -}}
{{- range $key, $value := . }}
{{- if kindIs "map" $value }}
{{- if hasKey $value "secretName" }}
{{- $_ := set $secrets $value.secretName "1" }}
{{- else }}
{{- range $k2, $v2 := $value }}
{{- if kindIs "map" $v2 }}
{{- if hasKey $v2 "secretName" }}
{{- $_ := set $secrets $v2.secretName "1" }}
{{- else }}
{{- range $k3, $v3 := $v2 }}
{{- if kindIs "map" $v3 }}
{{- if hasKey $v3 "secretName" }}
{{- $_ := set $secrets $v3.secretName "1" }}
{{- else }}
{{- range $k4, $v4 := $v3 }}
{{- if kindIs "map" $v4 }}
{{- if hasKey $v4 "secretName" }}
{{- $_ := set $secrets $v4.secretName "1" }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
{{- keys $secrets | sortAlpha | join "," -}}
{{- end -}}

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

