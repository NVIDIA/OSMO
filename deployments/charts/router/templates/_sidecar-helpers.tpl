# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

{{/*
Envoy sidecar container
*/}}
{{- define "router.envoy-sidecar-container" -}}
{{- if .Values.sidecars.envoy.enabled }}
- name: envoy
  securityContext:
    {{- toYaml .Values.sidecars.envoy.securityContext | nindent 4 }}
  image: "{{ .Values.sidecars.envoy.image }}"
  imagePullPolicy: {{ .Values.sidecars.envoy.imagePullPolicy }}
  command: ["/bin/sh", "-c"]
  args:
    - |
      echo "$(date -Iseconds) Waiting to populate secrets..."
      {{- if .Values.sidecars.envoy.useKubernetesSecrets }}
      # For Kubernetes secrets, just wait and start
      sleep 5
      {{- else }}
      # For Other secrets, wait for files and process config
      while [ ! -f "{{ .Values.sidecars.envoy.secretPaths.clientSecret }}" ] || [ ! -s "{{ .Values.sidecars.envoy.secretPaths.clientSecret }}" ]; do
        echo "$(date -Iseconds) Waiting for client secret file..."
        sleep 2
      done
      while [ ! -f "{{ .Values.sidecars.envoy.secretPaths.hmacSecret }}" ] || [ ! -s "{{ .Values.sidecars.envoy.secretPaths.hmacSecret }}" ]; do
        echo "$(date -Iseconds) Waiting for HMAC secret file..."
        sleep 2
      done
      echo "$(date -Iseconds) Secret files ready..."
      {{- end }}
      echo "$(date -Iseconds) Starting Envoy..."
      exec /usr/local/bin/envoy -c /var/config/config.yaml --log-level {{ .Values.sidecars.envoy.logLevel | default "info" }} --log-path /logs/envoy.txt
  ports:
    - containerPort: {{ .Values.sidecars.envoy.listenerPort }}
      name: envoy-http
    - containerPort: 9901
      name: envoy-admin
  volumeMounts:
    - mountPath: /var/config
      name: envoy-config
      readOnly: true
    {{- if .Values.global.logs.enabled }}
    - name: logs
      mountPath: /logs
    {{- end }}
    {{- if .Values.sidecars.envoy.useKubernetesSecrets }}
    - name: envoy-secrets
      mountPath: /etc/envoy/secrets
      readOnly: true
    {{- end }}
    {{- with .Values.sidecars.envoy.extraVolumeMounts }}
      {{- toYaml . | nindent 4 }}
    {{- end }}
  resources:
    {{- toYaml .Values.sidecars.envoy.resources | nindent 4 }}
  {{- with .Values.sidecars.envoy.livenessProbe }}
  livenessProbe:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.sidecars.envoy.readinessProbe }}
  readinessProbe:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.sidecars.envoy.startupProbe }}
  startupProbe:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}
{{- end }}

{{/*
Log agent sidecar container
*/}}
{{- define "router.log-agent-sidecar-container" -}}
{{- if .Values.sidecars.logAgent.enabled }}
- name: log-agent
  image: "{{ .Values.sidecars.logAgent.image }}"
  imagePullPolicy: {{ .Values.sidecars.logAgent.imagePullPolicy }}
  securityContext:
    allowPrivilegeEscalation: false
    capabilities:
      drop: ["ALL"]
    runAsNonRoot: true
    runAsUser: 10001
  ports:
  - containerPort: {{ .Values.sidecars.logAgent.prometheusPort | default 2020 }}
    protocol: TCP
  command: ["/bin/sh", "-c"]
  args:
  - |
    {{- if .Values.sidecars.logAgent.logrotate.enabled }}
    echo "$(date -Iseconds) Removing default logrotate configs..."
    rm -f /etc/logrotate.d/*

    run_logrotate_loop() {
      while true; do
        echo "$(date -Iseconds) Running logrotate..."
        logrotate /fluent-bit/etc/logrotate-fluentbit.conf
        echo "$(date -Iseconds) Successfully ran logrotate"
        touch /tmp/logrotate-last-success
        echo "$(date -Iseconds) Sleep for 1min..."
        sleep 60
      done
    }

    echo "$(date -Iseconds) Starting logrotate..."
    run_logrotate_loop &
    {{- else }}
    echo "$(date -Iseconds) Logrotate is disabled, skipping logrotate..."
    {{- end }}

    echo "$(date -Iseconds) Starting fluentbit..."
    /fluent-bit/bin/fluent-bit -c /fluent-bit/etc/fluent-bit.conf
  env:
  - name: NODE_NAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
  - name: POD_NAMESPACE
    valueFrom:
      fieldRef:
        fieldPath: metadata.namespace
  - name: POD_IP
    valueFrom:
      fieldRef:
        fieldPath: status.podIP
  volumeMounts:
  - name: log-agent-config
    mountPath: /fluent-bit/etc
  {{- if .Values.global.logs.enabled }}
  - name: logs
    mountPath: /var/log
  {{- end }}
  {{- with .Values.sidecars.logAgent.extraVolumeMounts }}
    {{- toYaml . | nindent 2 }}
  {{- end }}
  livenessProbe:
    exec:
      command: ["/bin/sh", "-c",
                "reply=$(curl -s -o /dev/null -w %{http_code} http://127.0.0.1:{{ .Values.sidecars.logAgent.prometheusPort | default 2020 }});
                if [ \"$reply\" -lt 200 -o \"$reply\" -ge 400 ]; then exit 1; fi;
                {{- if .Values.sidecars.logAgent.logrotate.enabled }}if [ ! $(find /tmp/logrotate-last-success -mmin -1) ]; then exit 1; fi;{{- end }}"
      ]
    initialDelaySeconds: 120
    periodSeconds: 60
    successThreshold: 1
    failureThreshold: 3
  readinessProbe:
    httpGet:
      path: /api/v1/metrics/prometheus
      port: {{ .Values.sidecars.logAgent.prometheusPort | default 2020 }}
    initialDelaySeconds: 15
    periodSeconds: 20
  resources:
    {{- toYaml .Values.sidecars.logAgent.resources | nindent 4 }}
{{- end }}
{{- end }}


{{/*
Envoy volumes
*/}}
{{- define "router.envoy-volumes" -}}
{{- if .Values.sidecars.envoy.enabled }}
- name: envoy-config
  configMap:
    name: {{ .Values.services.service.serviceName }}-envoy-config
{{- end }}
{{- if .Values.sidecars.envoy.useKubernetesSecrets }}
- name: envoy-secrets
  secret:
    secretName: {{ .Values.sidecars.envoy.oauth2Filter.secretName | default "oidc-secrets" }}
    items:
    - key: {{ .Values.sidecars.envoy.oauth2Filter.clientSecretKey | default "client_secret" }}
      path: client_secret
    - key: {{ .Values.sidecars.envoy.oauth2Filter.hmacSecretKey | default "hmac_secret" }}
      path: hmac_secret
{{- end }}
{{- end }}

{{/*
Log agent volumes
*/}}
{{- define "router.log-agent-volumes" -}}
{{- if .Values.sidecars.logAgent.enabled }}
- name: log-agent-config
  configMap:
    name: {{ .Values.sidecars.logAgent.configName }}
{{- end }}
{{- end }}

