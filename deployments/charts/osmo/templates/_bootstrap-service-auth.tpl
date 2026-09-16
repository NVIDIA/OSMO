{{/* SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. */}}
{{/* SPDX-License-Identifier: Apache-2.0 */}}

{{- define "osmo.bootstrap.service-auth" -}}
{{- $phase := .phase -}}
{{- $root := .root -}}
{{- with .root -}}

{{- $serviceAuth := .Values.secrets.serviceAuth -}}
{{- if and $serviceAuth.bootstrap.enabled (ne $serviceAuth.managementMode "osmo") -}}
{{- fail "secrets.serviceAuth.bootstrap.enabled requires managementMode=osmo" -}}
{{- end -}}
{{- if and $serviceAuth.bootstrap.enabled (not .Values.planes.control.enabled) -}}
{{- fail "secrets.serviceAuth.bootstrap.enabled requires planes.control.enabled=true" -}}
{{- end -}}

{{- if $serviceAuth.bootstrap.enabled }}
{{- $secretName := required "secrets.serviceAuth.existingSecret.name is required during bootstrap" $serviceAuth.existingSecret.name -}}
{{- $secretKey := required "secrets.serviceAuth.existingSecret.key is required during bootstrap" $serviceAuth.existingSecret.key -}}
attempt: {{ $serviceAuth.bootstrap.attempt | quote }}
deadline: {{ $serviceAuth.bootstrap.activeDeadlineSeconds }}
backoffLimit: 0
container: |-
  - name: bootstrap-service-auth
    image: {{ include "osmo.component.image" (dict "root" . "component" .Values.services.api) }}
    imagePullPolicy: {{ include "osmo.component.imagePullPolicy" (dict "root" . "component" .Values.services.api) }}
    command: ["service-auth-bootstrap"]
    args:
    - bootstrap
    - --namespace
    - {{ .Release.Namespace | quote }}
    - --release-name
    - {{ .Release.Name | quote }}
    - --target-secret
    - {{ $secretName | quote }}
    - --target-key
    - {{ $secretKey | quote }}
    volumeMounts:
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
    {{- with $serviceAuth.bootstrap.resources }}
    resources:
      {{- toYaml . | nindent 6 }}
    {{- end }}
rules: |-
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: [{{ $secretName | quote }}]
    verbs: ["get"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["create"]
{{- end }}
{{- end -}}
{{- end -}}
