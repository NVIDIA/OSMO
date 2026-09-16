{{/* SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. */}}
{{/* SPDX-License-Identifier: Apache-2.0 */}}

{{- define "osmo.bootstrap.retainedPrefix" -}}
{{- $name := include "osmo.fullname" . -}}
{{- if gt (len $name) 46 -}}
{{- printf "%s-%s" ($name | trunc 37 | trimSuffix "-") ($name | sha256sum | trunc 8) -}}
{{- else -}}{{- $name -}}{{- end -}}
{{- end -}}

{{- define "osmo.bootstrap.tlsRecordName" -}}
{{- printf "%s-tls-state" (include "osmo.bootstrap.retainedPrefix" .) -}}
{{- end -}}

{{- define "osmo.bootstrap.recordName" -}}
{{- printf "%s-bootstrap-state" (include "osmo.bootstrap.retainedPrefix" .) -}}
{{- end -}}

{{- define "osmo.bootstrap.definition" -}}
{{- include "osmo.gateway.tlsNormalize" . -}}
{{- $steps := list -}}
{{- range $name := list "internal-tls" "identity" "service-auth" "mek" "object-storage" -}}
{{- $enabled := $.Values.planes.control.enabled -}}
{{- if and (eq $name "mek") (not $.Values.secrets.masterEncryptionKey.bootstrap.enabled) -}}{{- $enabled = false -}}{{- end -}}
{{- if and (eq $name "internal-tls") (ne $.Values.gateway.tls.generated.caRotation.phase "stable") -}}{{- $enabled = false -}}{{- end -}}
{{- if $enabled -}}
{{- $definition := include (printf "osmo.bootstrap.%s" $name) (dict "root" $ "phase" "pre") | fromYaml -}}
{{- with $definition.Error -}}{{- fail . -}}{{- end -}}
{{- if $definition.container -}}
{{- $_ := set $definition "step" $name -}}
{{- $_ := unset $definition "name" -}}
{{- if eq $name "object-storage" -}}{{- $_ := set $definition "deadline" $.Values.bootstrap.storageActiveDeadlineSeconds -}}{{- end -}}
{{- $steps = append $steps $definition -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $secrets := list -}}
{{- $names := list -}}
{{- range $steps -}}{{- $names = append $names .step -}}{{- end -}}
{{- if has "internal-tls" $names -}}
{{- $secrets = append $secrets (dict "name" (include "osmo.gateway.tlsCaSecretName" .) "step" "internal-tls" "owner" "osmo-internal-tls-bootstrap" "keys" (list "ca.crt" "ca.key") "rotation_id" .Values.gateway.tls.generated.caRotation.id) -}}
{{- $secrets = append $secrets (dict "name" (include "osmo.gateway.tlsTrustSecretName" .) "step" "internal-tls" "owner" "osmo-internal-tls-bootstrap" "keys" (list "ca.crt") "protected" false) -}}
{{- $leaves := list "api" "router" "agent" "logger" -}}
{{- if .Values.services.mcp.enabled -}}{{- $leaves = append $leaves "mcp" -}}{{- end -}}
{{- range $leaves -}}
{{- $secrets = append $secrets (dict "name" (include "osmo.gateway.tlsLeafSecretName" (dict "root" $ "component" .)) "step" "internal-tls" "owner" "osmo-internal-tls-bootstrap" "keys" (list "tls.crt" "tls.key") "protected" false) -}}
{{- end -}}
{{- end -}}
{{- if has "identity" $names -}}
{{- range $identityID, $identity := .Values.authentication.bootstrap.identities -}}
{{- if $identity.enabled -}}
{{- range $token := $identity.tokens -}}
{{- if hasKey $token "managedSecret" -}}
{{- $secrets = append $secrets (dict "name" $token.managedSecret.name "step" "identity" "owner" "osmo-identity-bootstrap" "keys" (list "token") "optional_keys" (list "previous-token")) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- if has "service-auth" $names -}}
{{- $secrets = append $secrets (dict "name" .Values.secrets.serviceAuth.existingSecret.name "step" "service-auth" "owner" "osmo-service-auth-bootstrap" "keys" (list .Values.secrets.serviceAuth.existingSecret.key)) -}}
{{- end -}}
{{- if has "mek" $names -}}
{{- $secrets = append $secrets (dict "name" .Values.secrets.masterEncryptionKey.existingSecret.name "step" "mek" "owner" "osmo-mek-lifecycle" "keys" (list .Values.secrets.masterEncryptionKey.existingSecret.key) "rotation_id" .Values.secrets.masterEncryptionKey.rotation.requestId) -}}
{{- end -}}
{{- $tlsRotation := dict -}}
{{- $rotationSecrets := list -}}
{{- if and .Values.planes.control.enabled .Values.gateway.tls.enabled .Values.gateway.tls.generated.enabled (ne .Values.gateway.tls.generated.caRotation.phase "stable") -}}
{{- $tlsRotation = dict "record" (include "osmo.bootstrap.tlsRecordName" .) "id" .Values.gateway.tls.generated.caRotation.id "phase" .Values.gateway.tls.generated.caRotation.phase -}}
{{- $rotationSecrets = append $rotationSecrets (dict "name" (include "osmo.gateway.tlsTrustSecretName" .) "keys" (list "ca.crt")) -}}
{{- $leaves := list "api" "router" "agent" "logger" -}}
{{- if .Values.services.mcp.enabled -}}{{- $leaves = append $leaves "mcp" -}}{{- end -}}
{{- range $leaves -}}
{{- $rotationSecrets = append $rotationSecrets (dict "name" (include "osmo.gateway.tlsLeafSecretName" (dict "root" $ "component" .)) "keys" (list "tls.crt" "tls.key")) -}}
{{- end -}}
{{- end -}}
{{- $consumers := list -}}
{{- if and (or $steps $tlsRotation) .Values.planes.control.enabled -}}
{{- range $key, $suffix := dict "api" "api" "worker" "worker" "router" "router" "agent" "agent" "logger" "logger" "delayedJobMonitor" "delayed-job-monitor" "mcp" "mcp" -}}
{{- if (index $.Values.services $key).enabled -}}
{{- $consumer := include "osmo.component.fullname" (dict "root" $ "suffix" $suffix) -}}
{{- if eq $key "api" -}}{{- $consumer = include "osmo.api.fullname" $ -}}{{- end -}}
{{- $consumers = append $consumers $consumer -}}
{{- end -}}
{{- end -}}

{{- if .Values.gateway.envoy.enabled -}}{{- $consumers = append $consumers (printf "%s-envoy" (include "osmo.gateway.fullname" .)) -}}{{- end -}}
{{- end -}}
{{- $tokenIdentities := dict -}}
{{- range $identityID, $identity := .Values.authentication.bootstrap.identities -}}
{{- if and $identity.enabled $identity.tokens -}}{{- $_ := set $tokenIdentities $identityID (omit $identity "dex") -}}{{- end -}}
{{- end -}}
{{- $generationInputs := dict "secrets" $secrets "steps" $names "consumers" $consumers "identities" $tokenIdentities "tls" (omit .Values.gateway.tls.generated "bootstrap") "serviceAuthRollout" .Values.secrets.serviceAuth.rolloutNonce -}}
{{- if $tlsRotation -}}
{{- $rotationDefinition := include "osmo.bootstrap.internal-tls" (dict "root" . "phase" "rotation") | fromYaml -}}
{{- $_ := set $generationInputs "rotationArguments" (first ($rotationDefinition.container | fromYamlArray)).args -}}
{{- end -}}
{{- $effectiveSteps := list -}}
{{- range $steps -}}
{{- $container := first (.container | fromYamlArray) -}}
{{- $arguments := list -}}
{{- $skip := false -}}
{{- range ($container.args | default list) -}}
{{- if $skip -}}{{- $skip = false -}}
{{- else if eq . "--active_deadline_seconds" -}}{{- $skip = true -}}
{{- else if ne . "--allow-initial-generation" -}}{{- $arguments = append $arguments . -}}
{{- end -}}
{{- end -}}
{{- $environment := list -}}
{{- range ($container.env | default list) -}}
{{- if not (has .name (list "HOME" "OSMO_POD_UID" "OSMO_STORAGE_BOOTSTRAP_ATTEMPTS")) -}}{{- $environment = append $environment . -}}{{- end -}}
{{- end -}}
{{- $effectiveSteps = append $effectiveSteps (dict "step" .step "command" $container.command "args" $arguments "env" $environment) -}}
{{- end -}}
{{- $_ := set $generationInputs "effectiveSteps" $effectiveSteps -}}
{{- $configuration := dict "namespace" .Release.Namespace "release" .Release.Name "record" (include "osmo.bootstrap.recordName" .) "generation" (toJson $generationInputs | sha256sum) "initialization_id" .Values.bootstrap.initializationId "secrets" $secrets "consumers" $consumers "steps" $names "tls_rotation" $tlsRotation -}}
{{- toYaml (dict "steps" $steps "configuration" $configuration "rotationSecrets" $rotationSecrets) -}}
{{- end -}}

{{- define "osmo.bootstrap.securityContext" -}}
allowPrivilegeEscalation: false
capabilities:
  drop: [ALL]
readOnlyRootFilesystem: true
runAsNonRoot: true
runAsUser: 1001
runAsGroup: 1001
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "osmo.bootstrap.apiVolume" -}}
- name: kubernetes-api
  projected:
    sources:
    - serviceAccountToken:
        path: token
        expirationSeconds: 600
    - configMap:
        name: kube-root-ca.crt
        items:
        - key: ca.crt
          path: ca.crt
    - downwardAPI:
        items:
        - path: namespace
          fieldRef:
            fieldPath: metadata.namespace
{{- end -}}

{{- define "osmo.bootstrap.coordinatorContainer" -}}
name: {{ .action }}
image: {{ include "osmo.component.image" (dict "root" .root "component" .root.Values.services.api) | quote }}
imagePullPolicy: {{ include "osmo.component.imagePullPolicy" (dict "root" .root "component" .root.Values.services.api) }}
command: [/bootstrap-tools/bootstrap-step]
args: [--timeout, {{ printf "%ds" (int .root.Values.bootstrap.coordinatorActiveDeadlineSeconds) | quote }}, --, osmo-bootstrap, --config, /bootstrap-config/config.json, --wait-seconds, {{ .root.Values.bootstrap.coordinatorActiveDeadlineSeconds | quote }}, {{ .action }}]
env:
{{- include "osmo.bootstrap.leaseEnv" (dict "root" .root "mek" false) | nindent 0 }}
- name: OSMO_POD_NAME
  valueFrom:
    fieldRef:
      fieldPath: metadata.name
- name: OSMO_POD_UID
  valueFrom:
    fieldRef:
      fieldPath: metadata.uid
volumeMounts:
- name: bootstrap-tools
  mountPath: /bootstrap-tools
  readOnly: true
- name: bootstrap-config
  mountPath: /bootstrap-config
  readOnly: true
- name: kubernetes-api
  mountPath: /var/run/secrets/kubernetes.io/serviceaccount
  readOnly: true
securityContext:
  {{- include "osmo.bootstrap.securityContext" . | nindent 2 }}
resources:
  {{- toYaml .root.Values.bootstrap.resources | nindent 2 }}
{{- end -}}

{{- define "osmo.bootstrap.leaseEnv" -}}
{{- $names := list (include "osmo.bootstrap.recordName" .root) -}}
{{- if .mek -}}
{{- $hash := printf "%s/%s:%s" .root.Release.Namespace .root.Release.Name .root.Values.secrets.masterEncryptionKey.existingSecret.name | sha256sum | trunc 10 -}}
{{- $prefix := regexReplaceAll "[^a-z0-9-]" (lower .root.Release.Name) "-" | trimAll "-" | trunc 46 | trimSuffix "-" -}}
{{- $names = append $names (printf "%s-mek-%s" $prefix $hash) -}}
{{- end }}
- name: OSMO_BOOTSTRAP_LEASES
  value: {{ join "," $names | quote }}
- name: OSMO_POD_NAMESPACE
  valueFrom:
    fieldRef:
      fieldPath: metadata.namespace
{{- end -}}
