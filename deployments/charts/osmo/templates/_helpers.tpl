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

{{- define "osmo.service.labels" -}}
{{- $labels := mergeOverwrite (deepCopy .root.Values.commonLabels) .service.labels -}}
{{- $identity := include "osmo.component.standardLabels" (dict "root" .root "component" .component) | fromYaml -}}
{{- toYaml (mergeOverwrite $labels $identity) -}}
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

{{- define "osmo.image" -}}
{{- $root := .root -}}
{{- $image := .image -}}
{{- $registry := $image.registry -}}
{{- if .useSharedRegistry -}}
{{- $registry = $root.Values.imageRegistry | default $registry -}}
{{- end -}}
{{- $repository := required "image.repository is required" $image.repository -}}
{{- $base := ternary (printf "%s/%s" $registry $repository) $repository (ne $registry "") -}}
{{- if $image.digest -}}
{{- printf "%s@%s" $base $image.digest -}}
{{- else -}}
{{- $tag := $image.tag -}}
{{- if .useSharedTag -}}
{{- $tag = $tag | default $root.Values.imageTag | default $root.Chart.AppVersion -}}
{{- end -}}
{{- printf "%s:%s" $base (required "image.tag is required when digest is empty" $tag) -}}
{{- end -}}
{{- end -}}

{{- define "osmo.component.image" -}}
{{- include "osmo.image" (dict "root" .root "image" .component.image "useSharedRegistry" true "useSharedTag" true) -}}
{{- end -}}

{{- define "osmo.component.imageRepository" -}}
{{- $registry := .Values.imageRegistry | default .Values.runtimeImage.registry -}}
{{- ternary (printf "%s/%s" $registry .Values.runtimeImage.repository) .Values.runtimeImage.repository (ne $registry "") -}}
{{- end -}}

{{- define "osmo.component.imageTag" -}}
{{- .Values.runtimeImage.tag | default .Chart.AppVersion -}}
{{- end -}}

{{- define "osmo.compute.agentNamespace" -}}
{{- .Release.Namespace -}}
{{- end -}}

{{- define "osmo.compute.backendNamespace" -}}
{{- .Values.compute.workloadNamespace | default .Release.Namespace -}}
{{- end -}}

{{- define "osmo.compute.serviceUrl" -}}
{{- if .Values.planes.control.enabled -}}
{{- printf "http://%s:%v" (include "osmo.gateway.fullname" .) .Values.gateway.envoy.service.port -}}
{{- else -}}
{{- required "externalUrl is required when the compute plane connects to an external control plane" (.Values.externalUrl | trimSuffix "/") -}}
{{- end -}}
{{- end -}}

{{- define "osmo.compute.listenerName" -}}
{{- include "osmo.component.fullname" (dict "root" . "suffix" "backend-listener") -}}
{{- end -}}

{{- define "osmo.compute.workerName" -}}
{{- include "osmo.component.fullname" (dict "root" . "suffix" "backend-worker") -}}
{{- end -}}

{{- define "osmo.compute.clusterResourceName" -}}
{{- $base := include "osmo.component.fullname" (dict "root" .root "suffix" .suffix) | trunc 54 | trimSuffix "-" -}}
{{- $identity := printf "%s/%s/%s" (include "osmo.fullname" .root) .root.Release.Namespace .suffix -}}
{{- printf "%s-%s" $base (sha256sum $identity | trunc 8) -}}
{{- end -}}

{{- define "osmo.compute.listenerClusterRoleName" -}}
{{- if .Values.compute.rbac.clusterRoles.create -}}
{{- include "osmo.compute.clusterResourceName" (dict "root" . "suffix" "backend-listener") -}}
{{- else -}}
{{- required "compute.rbac.clusterRoles.listenerName is required when cluster role creation is disabled" .Values.compute.rbac.clusterRoles.listenerName -}}
{{- end -}}
{{- end -}}

{{- define "osmo.compute.workerClusterRoleName" -}}
{{- if .Values.compute.rbac.clusterRoles.create -}}
{{- include "osmo.compute.clusterResourceName" (dict "root" . "suffix" "backend-worker") -}}
{{- else -}}
{{- required "compute.rbac.clusterRoles.workerName is required when cluster role creation is disabled" .Values.compute.rbac.clusterRoles.workerName -}}
{{- end -}}
{{- end -}}

{{- define "osmo.compute.testRunnerClusterRoleName" -}}
{{- if .Values.compute.rbac.clusterRoles.create -}}
{{- include "osmo.compute.clusterResourceName" (dict "root" . "suffix" "backend-test-runner") -}}
{{- else -}}
{{- required "compute.rbac.clusterRoles.testRunnerName is required when cluster role creation is disabled and the backend test runner is enabled" .Values.compute.rbac.clusterRoles.testRunnerName -}}
{{- end -}}
{{- end -}}

{{- define "osmo.compute.listenerServiceAccountName" -}}
{{- include "osmo.component.serviceAccountName" (dict "root" . "component" .Values.services.backendListener "suffix" "backend-listener") -}}
{{- end -}}

{{- define "osmo.compute.workerServiceAccountName" -}}
{{- include "osmo.component.serviceAccountName" (dict "root" . "component" .Values.services.backendWorker "suffix" "backend-worker") -}}
{{- end -}}

{{- define "osmo.compute.testRunnerServiceAccountName" -}}
{{- include "osmo.component.serviceAccountName" (dict "root" . "component" .Values.services.backendTestRunner "suffix" "backend-test-runner") -}}
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
{{- $pod := dig "pod" dict .component -}}
{{- $constraints := list -}}
{{- $configuredConstraints := .root.Values.podDefaults.topologySpreadConstraints -}}
{{- if hasKey $pod "topologySpreadConstraints" -}}
{{- $configuredConstraints = $pod.topologySpreadConstraints -}}
{{- end -}}
{{- $selectorLabels := include "osmo.component.selectorLabels" (dict "root" .root "component" .componentName) | fromYaml -}}
{{- range $configuredConstraints -}}
{{- $constraint := omit (deepCopy .) "labelSelector" -}}
{{- $_ := set $constraint "labelSelector" (dict "matchLabels" (deepCopy $selectorLabels)) -}}
{{- $constraints = append $constraints $constraint -}}
{{- end -}}
{{- with $constraints }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.probe" -}}
{{- if .probe.enabled -}}
{{- toYaml .probe.spec -}}
{{- end -}}
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
{{- with .extraEnv }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.component.extraVolumeMounts" -}}
{{- with (dig "extraVolumeMounts" list .) }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.pod.extraVolumes" -}}
{{- with (dig "pod" "extraVolumes" list .) }}{{ toYaml . }}{{- end -}}
{{- end -}}

{{- define "osmo.pod.extraContainers" -}}
{{- with (dig "pod" "extraContainers" list .) }}{{ toYaml . }}{{- end -}}
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

{{/* Resolve the Secret selected by one backend API token credential. */}}
{{- define "osmo.backendApiTokenSecretName" -}}
{{- $hasExistingSecret := hasKey . "existingSecret" -}}
{{- $hasManagedSecret := hasKey . "managedSecret" -}}
{{- $sourceCount := add
      (ternary 1 0 $hasExistingSecret)
      (ternary 1 0 $hasManagedSecret) -}}
{{- if ne $sourceCount 1 -}}
{{- fail (printf "backend API token credential %q must configure exactly one of existingSecret or managedSecret" (.name | default "")) -}}
{{- end -}}
{{- if $hasExistingSecret -}}
{{- required "backend API token existingSecret.name is required" .existingSecret.name -}}
{{- else -}}
{{- required "backend API token managedSecret.name is required" .managedSecret.name -}}
{{- end -}}
{{- end -}}

{{- define "osmo.configuration.args" -}}
{{- if .Values.configuration.enabled }}
- --config_file
- /etc/osmo/configs/config.yaml
{{- end }}
{{- end -}}

{{- define "osmo.configuration.extraEnv" -}}
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
{{- with (include "osmo.objectStorage.secretName" .) }}
- name: object-storage-credentials
  mountPath: /etc/osmo/secrets/{{ . }}
  readOnly: true
{{- end }}
{{- with .Values.runtimeImage.pullSecret }}
- name: runtime-image-pull-secret
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
{{- with (include "osmo.objectStorage.secretName" .) }}
- name: object-storage-credentials
  secret:
    secretName: {{ . }}
{{- end }}
{{- with .Values.runtimeImage.pullSecret }}
- name: runtime-image-pull-secret
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
{{- with .Values.secrets.masterEncryptionKey.existingSecret.name }}
- name: mek-volume
  secret:
    secretName: {{ . | quote }}
    items:
    - key: {{ required "secrets.masterEncryptionKey.existingSecret.key is required" $.Values.secrets.masterEncryptionKey.existingSecret.key | quote }}
      path: "mek.yaml"
{{- end }}
{{- end -}}

{{- define "osmo.secrets.mekFile" -}}/opt/osmo/mek/mek.yaml{{- end -}}
{{- define "osmo.secrets.mekMountPath" -}}/opt/osmo/mek{{- end -}}

{{- define "osmo.secrets.mekRolloutAnnotation" -}}
{{- with .Values.secrets.masterEncryptionKey.rotation.rolloutRevision }}
osmo.nvidia.com/mek-rollout: {{ . | quote }}
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

{{- define "osmo.postgresql.clusterName" -}}
{{- if .Values.postgresql.fullnameOverride -}}
{{- .Values.postgresql.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := .Values.postgresql.nameOverride | default "postgresql" -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "osmo.valkey.generatedSecretName" -}}
{{- printf "%s-valkey-credentials" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "osmo.rustfs.fullname" -}}
{{- $name := default "rustfs" (dig "nameOverride" "" .Values.rustfs) -}}
{{- $fullnameOverride := dig "fullnameOverride" "" .Values.rustfs -}}
{{- if $fullnameOverride -}}
{{- $fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "osmo.objectStorage.endpoint" -}}
{{- if .Values.embeddedDependencies.objectStorage.enabled -}}
{{- printf "http://%s-svc:9000" (include "osmo.rustfs.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "osmo.objectStorage.region" -}}
{{- if .Values.embeddedDependencies.objectStorage.enabled -}}
{{- .Values.embeddedDependencies.objectStorage.region -}}
{{- else -}}
{{- .Values.externalDependencies.objectStorage.s3.region -}}
{{- end -}}
{{- end -}}

{{- define "osmo.objectStorage.bucket" -}}
{{- if .root.Values.embeddedDependencies.objectStorage.enabled -}}
{{- get .root.Values.embeddedDependencies.objectStorage.buckets .name -}}
{{- end -}}
{{- end -}}

{{- define "osmo.objectStorage.location" -}}
{{- if .root.Values.embeddedDependencies.objectStorage.enabled -}}
{{- printf "s3://%s/%s" (get .root.Values.embeddedDependencies.objectStorage.buckets .name) .name -}}
{{- else -}}
{{- get .root.Values.externalDependencies.objectStorage.locations .name -}}
{{- end -}}
{{- end -}}

{{- define "osmo.objectStorage.overrideUrl" -}}
{{- if .Values.embeddedDependencies.objectStorage.enabled -}}
{{- include "osmo.objectStorage.endpoint" . -}}
{{- else -}}
{{- .Values.externalDependencies.objectStorage.s3.overrideUrl -}}
{{- end -}}
{{- end -}}

{{- define "osmo.objectStorage.secretName" -}}
{{- if .Values.embeddedDependencies.objectStorage.enabled -}}
{{- .Values.rustfs.secret.existingSecret -}}
{{- else if eq .Values.externalDependencies.objectStorage.authentication.type "static" -}}
{{- .Values.secrets.objectStorage.existingSecret -}}
{{- end -}}
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

{{- define "osmo.postgresql.host" -}}
{{- if .Values.embeddedDependencies.postgresql.enabled -}}
{{- printf "%s-rw" (include "osmo.postgresql.clusterName" .) -}}
{{- else -}}
{{- .Values.externalDependencies.postgresql.host -}}
{{- end -}}
{{- end -}}

{{- define "osmo.postgresql.port" -}}
{{- if .Values.embeddedDependencies.postgresql.enabled -}}5432{{- else -}}{{ .Values.externalDependencies.postgresql.port }}{{- end -}}
{{- end -}}

{{- define "osmo.postgresql.database" -}}
{{- if .Values.embeddedDependencies.postgresql.enabled -}}{{ .Values.postgresql.cluster.initdb.database }}{{- else -}}{{ .Values.externalDependencies.postgresql.database }}{{- end -}}
{{- end -}}

{{- define "osmo.postgresql.username" -}}
{{- if .Values.embeddedDependencies.postgresql.enabled -}}{{ .Values.postgresql.cluster.initdb.owner }}{{- else -}}{{ .Values.externalDependencies.postgresql.username }}{{- end -}}
{{- end -}}

{{- define "osmo.postgresql.secretName" -}}
{{- if .Values.embeddedDependencies.postgresql.enabled -}}
{{- $existingSecret := dig "cluster" "initdb" "secret" "name" "" .Values.postgresql -}}
{{- $existingSecret | default (printf "%s-app" (include "osmo.postgresql.clusterName" .)) -}}
{{- else -}}
{{- .Values.secrets.postgresql.existingSecret -}}
{{- end -}}
{{- end -}}

{{- define "osmo.postgresql.passwordKey" -}}
{{- if .Values.embeddedDependencies.postgresql.enabled -}}password{{- else -}}{{ .Values.secrets.postgresql.keys.password }}{{- end -}}
{{- end -}}

{{- define "osmo.postgresql.sslMode" -}}
{{- if or .Values.embeddedDependencies.postgresql.enabled .Values.externalDependencies.postgresql.tls.enabled -}}
verify-full
{{- else -}}
disable
{{- end -}}
{{- end -}}

{{- define "osmo.postgresql.caSecretName" -}}
{{- if .Values.embeddedDependencies.postgresql.enabled -}}
{{- $serverCASecret := dig "cluster" "certificates" "serverCASecret" "" .Values.postgresql -}}
{{- $serverCASecret | default (printf "%s-ca" (include "osmo.postgresql.clusterName" .)) -}}
{{- else -}}
{{- .Values.externalDependencies.postgresql.tls.caExistingSecret -}}
{{- end -}}
{{- end -}}

{{- define "osmo.postgresql.caKey" -}}
{{- if .Values.embeddedDependencies.postgresql.enabled -}}ca.crt{{- else -}}{{ .Values.externalDependencies.postgresql.tls.caKey }}{{- end -}}
{{- end -}}

{{- define "osmo.externalDependencies.connectionCaEnabled" -}}
{{- if or
  .Values.embeddedDependencies.postgresql.enabled
  .Values.externalDependencies.postgresql.tls.enabled
  (eq (include "osmo.externalDependencies.valkeyCustomCaEnabled" .) "true") -}}true{{- else -}}false{{- end -}}
{{- end -}}

{{- define "osmo.externalDependencies.caVolumeMounts" -}}
{{- if or .Values.embeddedDependencies.postgresql.enabled .Values.externalDependencies.postgresql.tls.enabled }}
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
{{- if or .Values.embeddedDependencies.postgresql.enabled .Values.externalDependencies.postgresql.tls.enabled }}
- name: postgresql-ca
  secret:
    secretName: {{ include "osmo.postgresql.caSecretName" . }}
    items:
    - key: {{ include "osmo.postgresql.caKey" . }}
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
{{- with (include "osmo.postgresql.secretName" .) }}
- name: OSMO_POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ . }}
      key: {{ include "osmo.postgresql.passwordKey" $ }}
{{- end }}
{{- with (include "osmo.valkey.secretName" .) }}
- name: OSMO_REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ . }}
      key: {{ $.Values.secrets.valkey.keys.password }}
{{- end }}
{{- if or .Values.embeddedDependencies.postgresql.enabled .Values.externalDependencies.postgresql.tls.enabled }}
- name: PGSSLMODE
  value: verify-full
- name: PGSSLROOTCERT
  value: /etc/osmo/ca/postgresql/ca.crt
{{- end }}
{{- if eq (include "osmo.externalDependencies.valkeyCustomCaEnabled" .) "true" }}
- name: SSL_CERT_FILE
  value: /etc/osmo/ca/valkey/ca-bundle.crt
{{- end }}
{{- end -}}
