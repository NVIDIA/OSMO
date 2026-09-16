{{/* SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. */}}
{{/* SPDX-License-Identifier: Apache-2.0 */}}

{{- define "osmo.bootstrap.internal-tls" -}}
{{- $phase := .phase -}}
{{- $root := .root -}}
{{- with .root -}}

{{- include "osmo.gateway.tlsNormalize" . }}
{{- $tls := .Values.gateway.tls }}
{{- if and .Values.planes.control.enabled $tls.enabled $tls.generated.enabled }}
{{- $bootstrapImage := $tls.generated.bootstrap.image | default (include "osmo.component.image" (dict "root" . "component" .Values.services.api)) }}
{{- $bootstrapName := printf "%s-internal-tls-bootstrap" (include "osmo.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- $caSecret := include "osmo.gateway.tlsCaSecretName" . }}
{{- $trustSecret := include "osmo.gateway.tlsTrustSecretName" . }}
{{- $routerName := include "osmo.component.fullname" (dict "root" . "suffix" "router") }}
{{- $loggerName := include "osmo.component.fullname" (dict "root" . "suffix" "logger") }}
{{- $leaves := list
      (dict "component" "api" "dns" (.Values.gateway.upstreams.api.host | default (include "osmo.api.fullname" .)))
      (dict "component" "router" "dns" (.Values.gateway.upstreams.router.host | default (printf "%s-headless" $routerName)))
      (dict "component" "agent" "dns" (.Values.gateway.upstreams.agent.host | default (include "osmo.component.fullname" (dict "root" . "suffix" "agent"))))
      (dict "component" "logger" "dns" (.Values.gateway.upstreams.logger.host | default $loggerName)) -}}
{{- if .Values.services.mcp.enabled }}
{{- $leaves = append $leaves (dict "component" "mcp" "dns" (include "osmo.component.fullname" (dict "root" . "suffix" "mcp"))) -}}
{{- end }}
{{- $consumers := list -}}
{{- range $key, $suffix := dict "api" "api" "router" "router" "agent" "agent" "logger" "logger" "mcp" "mcp" -}}
{{- if (index $root.Values.services $key).enabled -}}
{{- $consumer := include "osmo.component.fullname" (dict "root" $root "suffix" $suffix) -}}
{{- if eq $key "api" -}}{{- $consumer = include "osmo.api.fullname" $root -}}{{- end -}}
{{- $consumers = append $consumers $consumer -}}
{{- end -}}
{{- end -}}
{{- if .Values.gateway.envoy.enabled -}}{{- $consumers = append $consumers (printf "%s-envoy" (include "osmo.gateway.fullname" .)) -}}{{- end -}}
{{- $secretNames := list $caSecret $trustSecret -}}
{{- range $leaf := $leaves }}
{{- $secretName := include "osmo.gateway.tlsLeafSecretName" (dict "root" $root "component" $leaf.component) -}}
{{- $secretNames = append $secretNames $secretName -}}
{{- end }}
deadline: 300
backoffLimit: 0
container: |-
  - name: internal-tls-bootstrap
    image: {{ $bootstrapImage | quote }}
    imagePullPolicy: {{ $tls.generated.bootstrap.imagePullPolicy | quote }}
    command: ["internal-tls-bootstrap"]
    args:
    - --namespace
    - {{ .Release.Namespace | quote }}
    - --release-name
    - {{ .Release.Name | quote }}
    - --ca-secret
    - {{ $caSecret | quote }}
    - --trust-secret
    - {{ $trustSecret | quote }}
    - --leaf-rotation-nonce
    - {{ $tls.generated.leafRotationNonce | quote }}
    - --ca-rotation-id
    - {{ $tls.generated.caRotation.id | quote }}
    - --ca-rotation-phase
    - {{ $tls.generated.caRotation.phase | quote }}
    {{- range $leaf := $leaves }}
    - --leaf
    - {{ printf "%s=%s" (include "osmo.gateway.tlsLeafSecretName" (dict "root" $root "component" $leaf.component)) $leaf.dns | quote }}
    {{- end }}
    {{- range $consumer := $consumers }}
    - --consumer-deployment
    - {{ $consumer | quote }}
    {{- end }}
    {{- if $tls.generated.bootstrap.allowInitialGeneration }}
    - --allow-initial-generation
    {{- end }}
    env:
    - name: HOME
      value: /tmp
    securityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
      readOnlyRootFilesystem: true
      runAsNonRoot: true
      runAsUser: 1001
      seccompProfile:
        type: RuntimeDefault
    volumeMounts:
    - name: kubernetes-api
      mountPath: /var/run/secrets/kubernetes.io/serviceaccount
      readOnly: true
    - name: bootstrap-tmp
      mountPath: /tmp
rules: |-
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames:
    {{- range $secretName := $secretNames }}
    - {{ $secretName | quote }}
    {{- end }}
    verbs: ["get", "update", "patch"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["create"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    resourceNames:
    {{- range $consumer := $consumers }}
    - {{ $consumer | quote }}
    {{- end }}
    verbs: ["get"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["list"]
  - apiGroups: ["autoscaling"]
    resources: ["horizontalpodautoscalers"]
    verbs: ["list"]
volumes: |-
  - name: bootstrap-tmp
    emptyDir: {}
{{- end }}
{{- end -}}
{{- end -}}
