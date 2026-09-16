{{/* SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. */}}
{{/* SPDX-License-Identifier: Apache-2.0 */}}

{{- define "osmo.bootstrap.gatedResources" -}}
{{- $root := .root -}}
{{- $definition := include "osmo.bootstrap.definition" $root | fromYaml -}}
{{- range $document := regexSplit "(?m)^---[ \\t]*$" .content -1 -}}
{{- $resource := fromYaml $document -}}
{{- with $resource.Error -}}{{- fail . -}}{{- end -}}
{{- if $resource.kind -}}
{{- if and (eq $resource.kind "Deployment") (has $resource.metadata.name $definition.configuration.consumers) -}}
{{- include "osmo.bootstrap.gatedDeployment" (dict "root" $root "deployment" $resource "configuration" $definition.configuration "rotationSecrets" $definition.rotationSecrets) }}
{{- else }}
{{ $document }}
{{- end }}
{{ print "\n---\n" }}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "osmo.bootstrap.gatedDeployment" -}}
{{- $root := .root -}}
{{- $deployment := .deployment -}}
{{- $configuration := .configuration -}}
{{- $pod := $deployment.spec.template.spec -}}
{{- $annotations := $deployment.spec.template.metadata.annotations | default dict -}}
{{- $_ := set $annotations "osmo.nvidia.com/bootstrap-generation" $configuration.generation -}}
{{- $_ := set $deployment.spec.template.metadata "annotations" $annotations -}}
{{- $name := printf "%s-bootstrap-%s" ($deployment.metadata.name | trunc 40 | trimSuffix "-") ($configuration.generation | trunc 10) -}}
{{- $secrets := dict -}}
{{- range (concat $configuration.secrets (.rotationSecrets | default list)) -}}{{- $_ := set $secrets .name . -}}{{- end -}}
{{- $volumes := list -}}
{{- $mounts := list -}}
{{- $mappings := list -}}
{{- $readSecrets := list -}}
{{- range ($pod.volumes | default list) -}}
{{- $secretName := dig "secret" "secretName" "" . | default "" -}}
{{- if hasKey $secrets $secretName -}}
{{- $specification := index $secrets $secretName -}}
{{- $items := .secret.items | default list -}}
{{- if not $items -}}{{- range (concat $specification.keys ($specification.optional_keys | default list)) -}}{{- $items = append $items (dict "key" . "path" .) -}}{{- end -}}{{- end -}}
{{- $volumeName := .name -}}
{{- range $items -}}
{{- if not (has .key (concat $specification.keys ($specification.optional_keys | default list))) -}}{{- fail (printf "bootstrap snapshot does not declare key %s/%s" $secretName .key) -}}{{- end -}}
{{- if or (hasPrefix "/" .path) (has ".." (splitList "/" .path)) -}}{{- fail "bootstrap Secret item paths must stay inside their volume" -}}{{- end -}}
{{- $mappings = append $mappings (dict "secret" $secretName "key" .key "optional" (has .key ($specification.optional_keys | default list)) "path" (printf "/bootstrap-snapshot/%s/%s" $volumeName .path)) -}}
{{- end -}}
{{- $mounts = append $mounts (dict "name" .name "mountPath" (printf "/bootstrap-snapshot/%s" .name)) -}}
{{- $volumes = append $volumes (dict "name" .name "emptyDir" (dict "medium" "Memory" "sizeLimit" "16Mi")) -}}
{{- $readSecrets = append $readSecrets $secretName -}}
{{- else -}}
{{- $volumes = append $volumes . -}}
{{- end -}}
{{- end -}}
{{- $apiVolume := first (include "osmo.bootstrap.apiVolume" $root | fromYamlArray) -}}
{{- $_ := set $apiVolume "name" "bootstrap-gate-api" -}}
{{- $volumes = append $volumes $apiVolume -}}
{{- $volumes = append $volumes (dict "name" "bootstrap-gate-config" "configMap" (dict "name" $name)) -}}
{{- $mounts = append $mounts (dict "name" "bootstrap-gate-api" "mountPath" "/var/run/secrets/kubernetes.io/serviceaccount" "readOnly" true) -}}
{{- $mounts = append $mounts (dict "name" "bootstrap-gate-config" "mountPath" "/bootstrap-config" "readOnly" true) -}}
{{- $security := $pod.securityContext | default dict -}}
{{- if not (hasKey $security "fsGroup") -}}{{- $_ := set $security "fsGroup" 1001 -}}{{- end -}}
{{- $_ := set $pod "securityContext" $security -}}
{{- $containerSecurity := include "osmo.bootstrap.securityContext" . | fromYaml -}}
{{- $_ := set $containerSecurity "runAsGroup" $security.fsGroup -}}
{{- $gate := dict "name" "bootstrap-credentials" "image" (include "osmo.component.image" (dict "root" $root "component" $root.Values.services.api)) "imagePullPolicy" (include "osmo.component.imagePullPolicy" (dict "root" $root "component" $root.Values.services.api)) "command" (list "/osmo/bootstrap-step") "args" (list "--timeout" "300s" "--" "osmo-bootstrap" "--config" "/bootstrap-config/config.json" "gate") "volumeMounts" $mounts "securityContext" $containerSecurity "resources" $root.Values.bootstrap.resources "env" (list (dict "name" "OSMO_BOOTSTRAP_FILES" "value" (toJson $mappings))) -}}
{{- if $configuration.tls_rotation -}}
{{- $_ := set $gate "env" (append $gate.env (dict "name" "OSMO_BOOTSTRAP_TLS_PHASE" "value" (printf "%s:%s" $configuration.tls_rotation.id $configuration.tls_rotation.phase))) -}}
{{- end -}}
{{- $_ := set $pod "volumes" $volumes -}}
{{- $_ := set $pod "initContainers" (concat (list $gate) ($pod.initContainers | default list)) -}}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ $name }}
  namespace: {{ $root.Release.Namespace }}
  labels:
    {{- include "osmo.component.labels" (dict "root" $root "component" "bootstrap") | nindent 4 }}
  {{- with (include "osmo.metadata.annotations" (dict "root" $root)) }}
  annotations:
    {{- . | nindent 4 }}
  {{- end }}
data:
  config.json: {{ toJson $configuration | quote }}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ $name }}
  namespace: {{ $root.Release.Namespace }}
  labels:
    {{- include "osmo.component.labels" (dict "root" $root "component" "bootstrap") | nindent 4 }}
  {{- with (include "osmo.metadata.annotations" (dict "root" $root)) }}
  annotations:
    {{- . | nindent 4 }}
  {{- end }}
rules:
- apiGroups: [""]
  resources: [configmaps]
  resourceNames:
  {{- if $configuration.steps }}
  - {{ $configuration.record | quote }}
  {{- end }}
  {{- with $configuration.tls_rotation }}
  - {{ .record | quote }}
  {{- end }}
  verbs: [get]
{{- if $readSecrets }}
- apiGroups: [""]
  resources: [secrets]
  resourceNames: {{ toJson ($readSecrets | uniq) }}
  verbs: [get]
{{- end }}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ $name }}
  namespace: {{ $root.Release.Namespace }}
  labels:
    {{- include "osmo.component.labels" (dict "root" $root "component" "bootstrap") | nindent 4 }}
  {{- with (include "osmo.metadata.annotations" (dict "root" $root)) }}
  annotations:
    {{- . | nindent 4 }}
  {{- end }}
subjects:
- kind: ServiceAccount
  name: {{ $pod.serviceAccountName | default "default" }}
  namespace: {{ $root.Release.Namespace }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ $name }}
---
{{ toYaml $deployment }}
{{- end -}}
