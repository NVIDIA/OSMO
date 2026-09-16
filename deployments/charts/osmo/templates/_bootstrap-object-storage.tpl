{{/* SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. */}}
{{/* SPDX-License-Identifier: Apache-2.0 */}}

{{- define "osmo.bootstrap.object-storage" -}}
{{- $phase := .phase -}}
{{- $root := .root -}}
{{- with .root -}}
{{- if .Values.planes.control.enabled }}
{{- if .Values.embeddedDependencies.objectStorage.enabled }}
{{- $bootstrapName := printf "%s-object-storage-bootstrap" (include "osmo.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- $secretName := include "osmo.objectStorage.secretName" . }}
scriptHash: {{ .Files.Get "files/object-storage-bootstrap.sh" | sha256sum | quote }}
backoffLimit: {{ .Values.embeddedDependencies.objectStorage.bootstrap.backoffLimit }}
container: |-
  - name: object-storage-bootstrap
    image: {{ include "osmo.image" (dict "root" . "image" .Values.embeddedDependencies.objectStorage.bootstrap.image "useSharedRegistry" false "useSharedTag" false) | quote }}
    imagePullPolicy: {{ .Values.embeddedDependencies.objectStorage.bootstrap.image.pullPolicy }}
    command:
    - /bin/sh
    - /scripts/object-storage-bootstrap.sh
    env:
    - name: HOME
      value: /tmp
    - name: AWS_ENDPOINT_URL
      value: {{ include "osmo.objectStorage.endpoint" . | quote }}
    - name: AWS_ACCESS_KEY_ID
      valueFrom:
        secretKeyRef:
          name: {{ $secretName }}
          key: RUSTFS_ACCESS_KEY
    - name: AWS_SECRET_ACCESS_KEY
      valueFrom:
        secretKeyRef:
          name: {{ $secretName }}
          key: RUSTFS_SECRET_KEY
    - name: AWS_DEFAULT_REGION
      value: {{ include "osmo.objectStorage.region" . | quote }}
    - name: OSMO_WORKFLOW_BUCKET
      value: {{ include "osmo.objectStorage.bucket" (dict "root" . "name" "workflows") | quote }}
    - name: OSMO_LOG_BUCKET
      value: {{ include "osmo.objectStorage.bucket" (dict "root" . "name" "logs") | quote }}
    - name: OSMO_APP_BUCKET
      value: {{ include "osmo.objectStorage.bucket" (dict "root" . "name" "apps") | quote }}
    - name: OSMO_STORAGE_BOOTSTRAP_ATTEMPTS
      value: {{ .Values.embeddedDependencies.objectStorage.bootstrap.attempts | quote }}
    securityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop:
        - ALL
      readOnlyRootFilesystem: true
      runAsNonRoot: true
      runAsUser: 10001
      runAsGroup: 10001
      seccompProfile:
        type: RuntimeDefault
    volumeMounts:
    - name: bootstrap-script
      mountPath: /scripts
      readOnly: true
    - name: object-storage-tmp
      mountPath: /tmp
    resources:
      {{- toYaml .Values.embeddedDependencies.objectStorage.bootstrap.resources | nindent 6 }}
volumes: |-
  - name: bootstrap-script
    configMap:
      name: {{ $bootstrapName }}
      defaultMode: 0555
  - name: object-storage-tmp
    emptyDir: {}
{{- end }}
{{- end }}
{{- end -}}
{{- end -}}
