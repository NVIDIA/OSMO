# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

{{- define "osmo.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "osmo.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := include "osmo.name" . -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "osmo.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "osmo.selectorLabels" -}}
app.kubernetes.io/name: {{ include "osmo.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "osmo.metadata.standardLabels" -}}
{{- $identity := dict
      "helm.sh/chart" (include "osmo.chart" .)
      "app.kubernetes.io/name" (include "osmo.name" .)
      "app.kubernetes.io/instance" .Release.Name
      "app.kubernetes.io/managed-by" .Release.Service
      "app.kubernetes.io/part-of" (include "osmo.name" .) -}}
{{- if .Chart.AppVersion -}}
{{- $_ := set $identity "app.kubernetes.io/version" .Chart.AppVersion -}}
{{- end -}}
{{- toYaml $identity -}}
{{- end -}}

{{- define "osmo.labels" -}}
{{- $identity := include "osmo.metadata.standardLabels" . | fromYaml -}}
{{- toYaml (mergeOverwrite (deepCopy .Values.commonLabels) $identity) -}}
{{- end -}}

{{- define "osmo.component.selectorLabels" -}}
{{- $labels := include "osmo.selectorLabels" .root | fromYaml -}}
{{- $_ := set $labels "app.kubernetes.io/component" .component -}}
{{- toYaml $labels -}}
{{- end -}}

{{- define "osmo.component.standardLabels" -}}
{{- $labels := include "osmo.metadata.standardLabels" .root | fromYaml -}}
{{- $_ := set $labels "app.kubernetes.io/component" .component -}}
{{- toYaml $labels -}}
{{- end -}}

{{- define "osmo.component.labels" -}}
{{- $labels := deepCopy .root.Values.commonLabels -}}
{{- $identity := include "osmo.component.standardLabels" . | fromYaml -}}
{{- toYaml (mergeOverwrite $labels $identity) -}}
{{- end -}}

{{- define "osmo.metadata.annotations" -}}
{{- $annotations := deepCopy .root.Values.commonAnnotations -}}
{{- $annotations = mergeOverwrite $annotations (dig "annotations" dict .) -}}
{{- $annotations = mergeOverwrite $annotations (dig "protectedAnnotations" dict .) -}}
{{- with $annotations }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.component.fullname" -}}
{{- $root := .root -}}
{{- $suffix := .suffix -}}
{{- if eq $suffix "" -}}
{{- include "osmo.fullname" $root -}}
{{- else -}}
{{- printf "%s-%s" (include "osmo.fullname" $root) $suffix | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "osmo.component.image" -}}
{{- $root := .root -}}
{{- $component := .component -}}
{{- $registry := $root.Values.imageRegistry | default $component.image.registry -}}
{{- $repository := required "component image.repository is required" $component.image.repository -}}
{{- $base := ternary (printf "%s/%s" $registry $repository) $repository (ne $registry "") -}}
{{- if $component.image.digest -}}
{{- printf "%s@%s" $base $component.image.digest -}}
{{- else -}}
{{- printf "%s:%s" $base ($component.image.tag | default $root.Chart.AppVersion) -}}
{{- end -}}
{{- end -}}

{{- define "osmo.component.imageRepository" -}}
{{- $registry := .Values.imageRegistry | default .Values.runtimeImage.registry -}}
{{- ternary (printf "%s/%s" $registry .Values.runtimeImage.repository) .Values.runtimeImage.repository (ne $registry "") -}}
{{- end -}}

{{- define "osmo.component.imageTag" -}}
{{- .Values.runtimeImage.tag | default .Chart.AppVersion -}}
{{- end -}}

{{- define "osmo.hostname" -}}
{{- $url := trimSuffix "/" .Values.externalUrl -}}
{{- $withoutScheme := regexReplaceAll "^https?://" $url "" -}}
{{- regexReplaceAll "[:/].*$" $withoutScheme "" -}}
{{- end -}}

{{- define "osmo.component.imagePullPolicy" -}}
{{- .component.image.pullPolicy -}}
{{- end -}}

{{- define "osmo.component.imagePullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{- define "osmo.component.serviceAccountName" -}}
{{- if .component.serviceAccount.name -}}
{{- .component.serviceAccount.name -}}
{{- else if .component.serviceAccount.create -}}
{{- include "osmo.component.fullname" (dict "root" .root "suffix" .suffix) -}}
{{- else -}}
default
{{- end -}}
{{- end -}}

{{- define "osmo.pod.annotations" -}}
{{- $annotations := mergeOverwrite (deepCopy .root.Values.commonAnnotations) .root.Values.podDefaults.annotations (dig "pod" "annotations" dict .component) -}}
{{- $annotations = mergeOverwrite $annotations (dig "protectedAnnotations" dict .) -}}
{{- with $annotations }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.pod.labels" -}}
{{- $labels := mergeOverwrite (deepCopy .root.Values.commonLabels) .root.Values.podDefaults.labels (dig "pod" "labels" dict .component) -}}
{{- $identity := include "osmo.component.standardLabels" (dict "root" .root "component" .componentName) | fromYaml -}}
{{- toYaml (mergeOverwrite $labels $identity) -}}
{{- end -}}

{{- define "osmo.pod.topologySpreadConstraints" -}}
{{- $constraints := list -}}
{{- $selectorLabels := include "osmo.component.selectorLabels" (dict "root" .root "component" .componentName) | fromYaml -}}
{{- range .constraints -}}
{{- $constraint := omit (deepCopy .) "labelSelector" -}}
{{- $_ := set $constraint "labelSelector" (dict "matchLabels" (deepCopy $selectorLabels)) -}}
{{- $constraints = append $constraints $constraint -}}
{{- end -}}
{{- with $constraints }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.pod.tolerations" -}}
{{- $pod := dig "pod" dict .component -}}
{{- if hasKey $pod "tolerations" -}}
{{- toYaml $pod.tolerations -}}
{{- else -}}
{{- toYaml .root.Values.podDefaults.tolerations -}}
{{- end -}}
{{- end -}}

{{- define "osmo.pod.nodeSelector" -}}
{{- $selector := mergeOverwrite (deepCopy .root.Values.podDefaults.nodeSelector) (dig "pod" "nodeSelector" dict .component) -}}
{{- with $selector }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.pod.affinity" -}}
{{- $affinity := mergeOverwrite (deepCopy .root.Values.podDefaults.affinity) (dig "pod" "affinity" dict .component) -}}
{{- with $affinity }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.pod.securityContext" -}}
{{- $context := mergeOverwrite (deepCopy .root.Values.podDefaults.podSecurityContext) (dig "pod" "podSecurityContext" dict .component) -}}
{{- with $context }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.container.securityContext" -}}
{{- $context := mergeOverwrite (deepCopy .root.Values.podDefaults.containerSecurityContext) (dig "pod" "containerSecurityContext" dict .component) -}}
{{- with $context }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.pod.terminationGracePeriodSeconds" -}}
{{- $pod := dig "pod" dict .component -}}
{{- if hasKey $pod "terminationGracePeriodSeconds" -}}
{{- $pod.terminationGracePeriodSeconds -}}
{{- else -}}
{{- .root.Values.podDefaults.terminationGracePeriodSeconds -}}
{{- end -}}
{{- end -}}

{{- define "osmo.component.extraEnv" -}}
{{- with .env }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.component.extraVolumeMounts" -}}
{{- with (dig "extraVolumeMounts" list .) }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.pod.extraVolumes" -}}
{{- with (dig "pod" "extraVolumes" list .) }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.pod.extraSidecars" -}}
{{- with (dig "pod" "sidecars" list .) }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.configuration.extraConfigMaps" -}}
{{- range .Values.configuration.extraConfigMaps }}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .name }}
  namespace: {{ $.Release.Namespace }}
  labels:
    {{- include "osmo.component.labels" (dict "root" $ "component" "configuration") | nindent 4 }}
  {{- with (include "osmo.metadata.annotations" (dict "root" $)) }}
  annotations:
    {{- . | nindent 4 }}
  {{- end }}
data:
  {{- toYaml .data | nindent 2 }}
{{- end }}
{{- end -}}

{{- define "osmo.api.fullname" -}}
{{- include "osmo.component.fullname" (dict "root" . "suffix" "api") -}}
{{- end -}}

{{- define "osmo.configuration.args" -}}
{{- if .Values.configuration.enabled }}
- --config_file
- /etc/osmo/configs/config.yaml
{{- end }}
{{- end -}}

{{- define "osmo.configuration.env" -}}
{{- if .Values.configuration.enabled }}
- name: POD_NAMESPACE
  valueFrom:
    fieldRef:
      fieldPath: metadata.namespace
- name: OSMO_CONFIGMAP_NAME
  value: {{ include "osmo.api.fullname" . }}-config
{{- end }}
{{- end -}}

{{- define "osmo.configuration.volumeMounts" -}}
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

{{- define "osmo.configuration.volumes" -}}
{{- if .Values.configuration.enabled }}
- name: configs
  configMap:
    name: {{ include "osmo.api.fullname" . }}-config
{{- with .Values.secrets.objectStorage.existingSecret }}
- name: object-storage-credentials
  secret:
    secretName: {{ . }}
{{- end }}
{{- end }}
{{- end -}}

{{- define "osmo.mcp.resourceUrl" -}}
{{- $resourceUrl := required "services.mcp.resourceUrl is required when MCP is enabled" .Values.services.mcp.resourceUrl -}}
{{- if not (regexMatch "^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?/mcp$" $resourceUrl) -}}
{{- fail "services.mcp.resourceUrl must be a valid HTTPS origin followed by the exact /mcp path" -}}
{{- end -}}
{{- $resourceUrl -}}
{{- end -}}

{{- define "osmo.secrets.mekVolume" -}}
{{- with .Values.secrets.masterEncryptionKey.existingSecret }}
- name: mek-volume
  secret:
    secretName: {{ . }}
    items:
    - key: {{ $.Values.secrets.masterEncryptionKey.keys.config }}
      path: mek.yaml
{{- end }}
{{- end -}}

{{- define "osmo.valkey.fullname" -}}
{{- $name := default "valkey" (dig "nameOverride" "" .Values.valkey) -}}
{{- $fullnameOverride := dig "fullnameOverride" "" .Values.valkey -}}
{{- if $fullnameOverride -}}
{{- $fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "osmo.valkey.generatedSecretName" -}}
{{- printf "%s-valkey-credentials" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "osmo.valkey.host" -}}
{{- if .Values.embeddedDependencies.valkey.enabled -}}
{{- include "osmo.valkey.fullname" . -}}
{{- else -}}
{{- .Values.externalDependencies.valkey.host -}}
{{- end -}}
{{- end -}}

{{- define "osmo.valkey.port" -}}
{{- if .Values.embeddedDependencies.valkey.enabled -}}
{{- .Values.valkey.service.port -}}
{{- else -}}
{{- .Values.externalDependencies.valkey.port -}}
{{- end -}}
{{- end -}}

{{- define "osmo.valkey.database" -}}
{{- if .Values.embeddedDependencies.valkey.enabled -}}0{{- else -}}
{{- .Values.externalDependencies.valkey.database -}}
{{- end -}}
{{- end -}}

{{- define "osmo.valkey.tlsEnabled" -}}
{{- if .Values.embeddedDependencies.valkey.enabled -}}false{{- else -}}
{{- .Values.externalDependencies.valkey.tls.enabled -}}
{{- end -}}
{{- end -}}

{{- define "osmo.externalDependencies.valkeyCustomCaEnabled" -}}
{{- if and
  (not .Values.embeddedDependencies.valkey.enabled)
  .Values.externalDependencies.valkey.tls.enabled
  .Values.externalDependencies.valkey.tls.caExistingSecret -}}true{{- else -}}false{{- end -}}
{{- end -}}

{{- define "osmo.valkey.secretName" -}}
{{- if and .Values.embeddedDependencies.valkey.enabled .Values.secrets.valkey.generate -}}
{{- include "osmo.valkey.generatedSecretName" . -}}
{{- else -}}
{{- .Values.secrets.valkey.existingSecret -}}
{{- end -}}
{{- end -}}

{{- define "osmo.externalDependencies.caVolumeMounts" -}}
{{- if .Values.externalDependencies.postgresql.tls.enabled }}
- name: postgresql-ca
  mountPath: /etc/osmo/ca/postgresql
  readOnly: true
{{- end }}
{{- if eq (include "osmo.externalDependencies.valkeyCustomCaEnabled" .) "true" }}
- name: valkey-ca
  mountPath: /etc/osmo/ca/valkey
  readOnly: true
{{- end }}
{{- end -}}

{{- define "osmo.externalDependencies.caVolumes" -}}
{{- if .Values.externalDependencies.postgresql.tls.enabled }}
- name: postgresql-ca
  secret:
    secretName: {{ .Values.externalDependencies.postgresql.tls.caExistingSecret }}
    items:
    - key: {{ .Values.externalDependencies.postgresql.tls.caKey }}
      path: ca.crt
{{- end }}
{{- if eq (include "osmo.externalDependencies.valkeyCustomCaEnabled" .) "true" }}
- name: valkey-ca
  secret:
    secretName: {{ .Values.externalDependencies.valkey.tls.caExistingSecret }}
    items:
    - key: {{ .Values.externalDependencies.valkey.tls.caKey }}
      path: ca-bundle.crt
{{- end }}
{{- end -}}

{{- define "osmo.externalDependencies.connectionSecretEnv" -}}
{{- with .Values.secrets.postgresql.existingSecret }}
- name: OSMO_POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ . }}
      key: {{ $.Values.secrets.postgresql.keys.password }}
{{- end }}
{{- with (include "osmo.valkey.secretName" .) }}
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
{{- if eq (include "osmo.externalDependencies.valkeyCustomCaEnabled" .) "true" }}
- name: SSL_CERT_FILE
  value: /etc/osmo/ca/valkey/ca-bundle.crt
{{- end }}
{{- end -}}
