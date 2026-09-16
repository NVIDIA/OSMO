{{/* SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. */}}
{{/* SPDX-License-Identifier: Apache-2.0 */}}

{{- define "osmo.bootstrap.identity" -}}
{{- $phase := .phase -}}
{{- $root := .root -}}
{{- with .root -}}
{{- if .Values.planes.control.enabled }}
{{- $embeddedDex := eq .Values.authentication.provider "embeddedDex" -}}
{{- $passwords := list -}}
{{- $managedTokens := list -}}
{{- range $identityID, $identity := .Values.authentication.bootstrap.identities -}}
{{- if $identity.enabled -}}
{{- if and $embeddedDex (dig "enabled" false ($identity.dex | default dict)) -}}
{{- $passwords = append $passwords (dict "identityID" $identityID "secretName" (include "osmo.bootstrap.dexPasswordSecretName" $identityID) "hashEnvironment" (include "osmo.bootstrap.dexHashEnvironmentName" $identityID)) -}}
{{- end -}}
{{- range $tokenName, $token := $identity.tokens -}}
{{- if hasKey $token "managedSecret" -}}
{{- $managedTokens = append $managedTokens (dict "identityID" $identityID "tokenName" $tokenName "secretName" $token.managedSecret.name) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- if or $embeddedDex $managedTokens -}}
{{- $bootstrap := .Values.authentication.bootstrap -}}
{{- $oauthSecretName := "osmo-embedded-dex-oauth" -}}
{{- $hashSecretName := "osmo-embedded-dex-password-hashes" -}}
deadline: {{ $bootstrap.activeDeadlineSeconds }}
backoffLimit: 1
container: |-
  - name: identity-bootstrap
    image: {{ include "osmo.component.image" (dict "root" $root "component" $root.Values.services.api) | quote }}
    imagePullPolicy: {{ include "osmo.component.imagePullPolicy" (dict "root" $root "component" $root.Values.services.api) }}
    command: ["identity-bootstrap"]
    args:
    - --namespace
    - {{ $root.Release.Namespace | quote }}
    - --release-name
    - {{ $root.Release.Name | quote }}
    {{- range $passwords }}
    - --password
    - {{ printf "%s=%s=%s" .identityID .secretName .hashEnvironment | quote }}
    {{- end }}
    {{- range $managedTokens }}
    - --token
    - {{ printf "%s/%s=%s" .identityID .tokenName .secretName | quote }}
    {{- end }}
    {{- if $embeddedDex }}
    - --oauth-secret-name
    - {{ $oauthSecretName | quote }}
    - --dex-hash-secret-name
    - {{ $hashSecretName | quote }}
    {{- end }}
    volumeMounts:
    - name: kubernetes-api
      mountPath: /var/run/secrets/kubernetes.io/serviceaccount
      readOnly: true
    securityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop:
        - ALL
      readOnlyRootFilesystem: true
      runAsNonRoot: true
      runAsUser: 1001
      runAsGroup: 1001
      seccompProfile:
        type: RuntimeDefault
    resources:
      {{- toYaml $bootstrap.resources | nindent 6 }}
rules: |-
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["create"]
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames:
    {{- range $passwords }}
    - {{ .secretName | quote }}
    {{- end }}
    {{- range $managedTokens }}
    - {{ .secretName | quote }}
    {{- end }}
    {{- if $embeddedDex }}
    - {{ $oauthSecretName | quote }}
    - {{ $hashSecretName | quote }}
    {{- end }}
    verbs: ["get", "update"]
{{- end }}
{{- end }}
{{- end -}}
{{- end -}}
