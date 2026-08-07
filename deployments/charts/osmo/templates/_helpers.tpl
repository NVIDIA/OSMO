# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

{{- define "osmo.v1.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "osmo.v1.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := include "osmo.v1.name" . -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "osmo.v1.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "osmo.v1.selectorLabels" -}}
app.kubernetes.io/name: {{ include "osmo.v1.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "osmo.v1.labels" -}}
helm.sh/chart: {{ include "osmo.v1.chart" . }}
{{ include "osmo.v1.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "osmo.v1.componentName" -}}
{{- $root := .root -}}
{{- $suffix := .suffix -}}
{{- if eq $suffix "" -}}
{{- include "osmo.v1.fullname" $root -}}
{{- else -}}
{{- printf "%s-%s" (include "osmo.v1.fullname" $root) $suffix | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "osmo.v1.image" -}}
{{- $root := .root -}}
{{- $component := .component -}}
{{- $registry := $root.Values.image.registry -}}
{{- $prefix := $root.Values.image.repositoryPrefix -}}
{{- $name := required "component image.name is required" $component.image.name -}}
{{- $tag := $component.image.tag | default $root.Values.image.tag | default $root.Chart.AppVersion -}}
{{- printf "%s/%s/%s:%s" $registry $prefix $name $tag -}}
{{- end -}}

{{- define "osmo.v1.imageRepository" -}}
{{- printf "%s/%s" .Values.image.registry .Values.image.repositoryPrefix -}}
{{- end -}}

{{- define "osmo.v1.imageTag" -}}
{{- .Values.image.tag | default .Chart.AppVersion -}}
{{- end -}}

{{- define "osmo.v1.hostname" -}}
{{- $url := trimSuffix "/" .Values.exposure.baseUrl -}}
{{- $withoutScheme := regexReplaceAll "^https?://" $url "" -}}
{{- regexReplaceAll "[:/].*$" $withoutScheme "" -}}
{{- end -}}

{{- define "osmo.v1.imagePullPolicy" -}}
{{- .component.image.pullPolicy | default .root.Values.image.pullPolicy -}}
{{- end -}}

{{- define "osmo.v1.imagePullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
{{ toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{- define "osmo.v1.service-account-name" -}}
{{- if .component.serviceAccount.name -}}
{{- .component.serviceAccount.name -}}
{{- else if .component.serviceAccount.create -}}
{{- include "osmo.v1.componentName" (dict "root" .root "suffix" .suffix) -}}
{{- else -}}
default
{{- end -}}
{{- end -}}

{{- define "osmo.v1.extra-annotations" -}}
{{- $annotations := mergeOverwrite (deepCopy .root.Values.commonAnnotations) .root.Values.podDefaults.annotations (dig "pod" "annotations" dict .component) -}}
{{- with $annotations }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.v1.pod-default-labels" -}}
{{- $labels := mergeOverwrite (deepCopy .root.Values.commonLabels) .root.Values.podDefaults.labels (dig "pod" "labels" dict .component) -}}
{{- with $labels }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.v1.tolerations" -}}
{{- $pod := dig "pod" dict .component -}}
{{- if hasKey $pod "tolerations" -}}
{{- toYaml $pod.tolerations -}}
{{- else -}}
{{- toYaml .root.Values.podDefaults.tolerations -}}
{{- end -}}
{{- end -}}

{{- define "osmo.v1.node-selector" -}}
{{- $selector := mergeOverwrite (deepCopy .root.Values.podDefaults.nodeSelector) (dig "pod" "nodeSelector" dict .component) -}}
{{- with $selector }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.v1.extra-env" -}}
{{- with .env }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.v1.extra-volume-mounts" -}}
{{- with (dig "volumeMounts" list .) }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.v1.extra-volumes" -}}
{{- with (dig "pod" "volumes" list .) }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.v1.extra-sidecars" -}}
{{- with (dig "pod" "sidecars" list .) }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.v1.extra-configmaps" -}}
{{- range .Values.configuration.extraConfigMaps }}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .name }}
  namespace: {{ $.Release.Namespace }}
  labels:
    {{- include "osmo.v1.labels" $ | nindent 4 }}
data:
  {{- toYaml .data | nindent 2 }}
{{- end }}
{{- end -}}

{{- define "osmo.v1.apiName" -}}
{{- include "osmo.v1.componentName" (dict "root" . "suffix" "service") -}}
{{- end -}}

{{- define "osmo.v1.configmap-args" -}}
{{- if .Values.configuration.enabled }}
- --config_file
- /etc/osmo/configs/config.yaml
{{- end }}
{{- end -}}

{{- define "osmo.v1.configmap-env" -}}
{{- if .Values.configuration.enabled }}
- name: POD_NAMESPACE
  valueFrom:
    fieldRef:
      fieldPath: metadata.namespace
- name: OSMO_CONFIGMAP_NAME
  value: {{ include "osmo.v1.apiName" . }}-configs
{{- end }}
{{- end -}}

{{- define "osmo.v1.configmap-volume-mounts" -}}
{{- if .Values.configuration.enabled }}
- name: configs
  mountPath: /etc/osmo/configs
  readOnly: true
{{- with .Values.secrets.objectStorage.existingSecret }}
- name: object-storage-credentials
  mountPath: /etc/osmo/secrets/{{ . }}
  readOnly: true
{{- end }}
{{- end }}
{{- end -}}

{{- define "osmo.v1.configmap-volumes" -}}
{{- if .Values.configuration.enabled }}
- name: configs
  configMap:
    name: {{ include "osmo.v1.apiName" . }}-configs
{{- with .Values.secrets.objectStorage.existingSecret }}
- name: object-storage-credentials
  secret:
    secretName: {{ . }}
{{- end }}
{{- end }}
{{- end -}}

{{- define "osmo.v1.mcp-resource-url" -}}
{{- $resourceUrl := required "services.mcp.resourceUrl is required when MCP is enabled" .Values.services.mcp.resourceUrl -}}
{{- if not (regexMatch "^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?/mcp$" $resourceUrl) -}}
{{- fail "services.mcp.resourceUrl must be a valid HTTPS origin followed by the exact /mcp path" -}}
{{- end -}}
{{- $resourceUrl -}}
{{- end -}}

{{- define "osmo.v1.mek-volume" -}}
{{- with .Values.secrets.masterEncryptionKey.existingSecret }}
- name: mek-volume
  secret:
    secretName: {{ . }}
    items:
    - key: {{ $.Values.secrets.masterEncryptionKey.keys.config }}
      path: mek.yaml
{{- end }}
{{- end -}}

{{- define "osmo.v1.external-ca-volume-mounts" -}}
{{- if .Values.externalDependencies.postgresql.tls.enabled }}
- name: postgresql-ca
  mountPath: /etc/osmo/ca/postgresql
  readOnly: true
{{- end }}
{{- if .Values.externalDependencies.valkey.tls.enabled }}
- name: valkey-ca
  mountPath: /etc/osmo/ca/valkey
  readOnly: true
{{- end }}
{{- end -}}

{{- define "osmo.v1.external-ca-volumes" -}}
{{- if .Values.externalDependencies.postgresql.tls.enabled }}
- name: postgresql-ca
  secret:
    secretName: {{ .Values.externalDependencies.postgresql.tls.caExistingSecret }}
    items:
    - key: {{ .Values.externalDependencies.postgresql.tls.caKey }}
      path: ca.crt
{{- end }}
{{- if .Values.externalDependencies.valkey.tls.enabled }}
- name: valkey-ca
  secret:
    secretName: {{ .Values.externalDependencies.valkey.tls.caExistingSecret }}
    items:
    - key: {{ .Values.externalDependencies.valkey.tls.caKey }}
      path: ca-bundle.crt
{{- end }}
{{- end -}}

{{- define "osmo.v1.connection-secret-env" -}}
{{- with .Values.secrets.postgresql.existingSecret }}
- name: OSMO_POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ . }}
      key: {{ $.Values.secrets.postgresql.keys.password }}
{{- end }}
{{- with .Values.secrets.valkey.existingSecret }}
- name: OSMO_REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ . }}
      key: {{ $.Values.secrets.valkey.keys.password }}
{{- end }}
{{- if .Values.externalDependencies.postgresql.tls.enabled }}
- name: PGSSLROOTCERT
  value: /etc/osmo/ca/postgresql/ca.crt
{{- end }}
{{- if .Values.externalDependencies.valkey.tls.enabled }}
- name: SSL_CERT_FILE
  value: /etc/osmo/ca/valkey/ca-bundle.crt
{{- end }}
{{- end -}}
