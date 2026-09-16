{{/* SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. */}}
{{/* SPDX-License-Identifier: Apache-2.0 */}}

{{- define "osmo.bootstrap.mek" -}}
{{- $phase := .phase -}}
{{- $root := .root -}}
{{- with .root -}}

{{- $mek := .Values.secrets.masterEncryptionKey -}}
{{- $secretName := $mek.existingSecret.name -}}
{{- $secretKey := $mek.existingSecret.key -}}
{{- $operation := $mek.rotation.phase -}}
{{- if not (has $mek.managementMode (list "external" "osmo")) -}}
{{- fail "secrets.masterEncryptionKey.managementMode must be external or osmo" -}}
{{- end -}}
{{- if not (has $operation (list "" "prepare" "activate" "rewrap")) -}}
{{- fail "secrets.masterEncryptionKey.rotation.phase must be empty, prepare, activate, or rewrap" -}}
{{- end -}}
{{- if and $operation (not $mek.rotation.requestId) -}}
{{- fail "secrets.masterEncryptionKey.rotation.requestId is required for a lifecycle phase" -}}
{{- end -}}
{{- if and (has $operation (list "prepare" "activate")) (ne $mek.managementMode "osmo") -}}
{{- fail "prepare and activate require managementMode=osmo; external operators update the Secret directly" -}}
{{- end -}}
{{- if and $mek.bootstrap.enabled (ne $mek.managementMode "osmo") -}}
{{- fail "secrets.masterEncryptionKey.bootstrap.enabled requires managementMode=osmo" -}}
{{- end -}}
{{- if and $mek.bootstrap.enabled $operation -}}
{{- fail "disable secrets.masterEncryptionKey.bootstrap.enabled before requesting a rotation phase" -}}
{{- end -}}

{{- if or $mek.bootstrap.enabled $operation }}
{{- $secretName = required "secrets.masterEncryptionKey.existingSecret.name is required" $secretName }}
{{- $secretKey = required "secrets.masterEncryptionKey.existingSecret.key is required" $secretKey }}
{{- $leaseHash := printf "%s/%s:%s" .Release.Namespace .Release.Name $secretName | sha256sum | trunc 10 }}
{{- $leasePrefix := regexReplaceAll "[^a-z0-9-]" (lower .Release.Name) "-" | trimAll "-" | trunc 46 | trimSuffix "-" }}
{{- $leaseName := printf "%s-mek-%s" $leasePrefix $leaseHash }}
{{- $actualOperation := ternary "bootstrap" $operation $mek.bootstrap.enabled }}
{{- $needsDatabase := or $mek.bootstrap.enabled (eq $operation "rewrap") }}
{{- $request := ternary "initial" $mek.rotation.requestId $mek.bootstrap.enabled }}
{{- $consumerDeployments := list }}
{{- if and .Values.planes.control.enabled .Values.services.api.enabled }}{{- $consumerDeployments = append $consumerDeployments (include "osmo.api.fullname" .) }}{{- end }}
{{- if and .Values.planes.control.enabled .Values.services.worker.enabled }}{{- $consumerDeployments = append $consumerDeployments (include "osmo.component.fullname" (dict "root" . "suffix" "worker")) }}{{- end }}
{{- if and .Values.planes.control.enabled .Values.services.router.enabled }}{{- $consumerDeployments = append $consumerDeployments (include "osmo.component.fullname" (dict "root" . "suffix" "router")) }}{{- end }}
{{- if and .Values.planes.control.enabled .Values.services.logger.enabled }}{{- $consumerDeployments = append $consumerDeployments (include "osmo.component.fullname" (dict "root" . "suffix" "logger")) }}{{- end }}
{{- if and .Values.planes.control.enabled .Values.services.agent.enabled }}{{- $consumerDeployments = append $consumerDeployments (include "osmo.component.fullname" (dict "root" . "suffix" "agent")) }}{{- end }}
{{- if and .Values.planes.control.enabled .Values.services.delayedJobMonitor.enabled }}{{- $consumerDeployments = append $consumerDeployments (include "osmo.component.fullname" (dict "root" . "suffix" "delayed-job-monitor")) }}{{- end }}
{{- if eq (len $consumerDeployments) 0 }}{{- fail "MEK lifecycle requires at least one enabled control-plane consumer" }}{{- end }}
attempt: {{ $mek.bootstrap.attempt | quote }}
deadline: {{ ternary $mek.bootstrap.activeDeadlineSeconds $mek.rotation.activeDeadlineSeconds $mek.bootstrap.enabled }}
backoffLimit: 0
container: |-
  - name: mek-lifecycle
    image: {{ include "osmo.component.image" (dict "root" . "component" .Values.services.api) }}
    imagePullPolicy: {{ ternary $mek.bootstrap.imagePullPolicy $mek.rotation.imagePullPolicy $mek.bootstrap.enabled | quote }}
    command: ["mek-lifecycle"]
    args:
    - --operation
    - {{ $actualOperation | quote }}
    - --namespace
    - {{ .Release.Namespace | quote }}
    - --secret_name
    - {{ $secretName | quote }}
    - --secret_key
    - {{ $secretKey | quote }}
    - --installation_id
    - {{ printf "%s/%s" .Release.Namespace .Release.Name | quote }}
    - --management_mode
    - {{ $mek.managementMode | quote }}
    - --request_id
    - {{ $request | quote }}
    - --consumer_deployments
    - {{ join "," $consumerDeployments | quote }}
    {{- if $needsDatabase }}
    - --postgres_host
    - {{ include "osmo.postgresql.host" . | quote }}
    - --postgres_port
    - {{ include "osmo.postgresql.port" . | quote }}
    - --postgres_database_name
    - {{ include "osmo.postgresql.database" . | quote }}
    - --postgres_user
    - {{ include "osmo.postgresql.username" . | quote }}
    {{- include "osmo.secrets.serviceAuthArgs" . | nindent 4 }}
    {{- end }}
    - --active_deadline_seconds
    - {{ ternary $mek.bootstrap.activeDeadlineSeconds $mek.rotation.activeDeadlineSeconds $mek.bootstrap.enabled | quote }}
    env:
    - name: OSMO_POD_UID
      valueFrom:
        fieldRef:
          fieldPath: metadata.uid
    {{- if $needsDatabase }}
    {{- include "osmo.externalDependencies.connectionSecretEnv" . | nindent 4 }}
    {{- end }}
    volumeMounts:
    - name: lifecycle-temp
      mountPath: /tmp
    {{- if not $mek.bootstrap.enabled }}
    - name: mek-volume
      mountPath: {{ include "osmo.secrets.mekMountPath" . | quote }}
      readOnly: true
    {{- end }}
    {{- if $needsDatabase }}
    {{- include "osmo.secrets.serviceAuthVolumeMount" . | nindent 4 }}
    {{- include "osmo.externalDependencies.caVolumeMounts" . | nindent 4 }}
    {{- end }}
    - name: kubernetes-api
      mountPath: /var/run/secrets/kubernetes.io/serviceaccount
      readOnly: true
    securityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
      readOnlyRootFilesystem: true
      runAsNonRoot: true
      runAsUser: 1001
      seccompProfile:
        type: RuntimeDefault
rules: |-
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: [{{ $secretName | quote }}]
    verbs: ["get"{{- if and (eq $mek.managementMode "osmo") $operation }}, "patch"{{- end }}]
  {{- if $mek.bootstrap.enabled }}
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["create"]
  {{- end }}
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list"]
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    resourceNames: [{{ $leaseName | quote }}]
    verbs: ["get", "patch", "update"]
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    verbs: ["create"]
volumes: |-
  - name: lifecycle-temp
    emptyDir: {}
  {{- if not $mek.bootstrap.enabled }}
  - name: mek-volume
    secret:
      secretName: {{ $secretName | quote }}
      items:
      - key: {{ $secretKey | quote }}
        path: "mek.yaml"
  {{- end }}
  {{- if $needsDatabase }}
  {{- include "osmo.secrets.serviceAuthVolume" . | nindent 2 }}
  {{- include "osmo.externalDependencies.caVolumes" . | nindent 2 }}
  {{- end }}
{{- end }}
{{- end -}}
{{- end -}}
