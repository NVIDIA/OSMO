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
{{- define "ui.envoy-sidecar-container" -}}
{{- if .Values.sidecars.envoy.enabled }}
- name: envoy
  image: "{{ .Values.sidecars.envoy.images.envoy }}"
  securityContext:
    capabilities:
      drop: ["NET_RAW"]

  imagePullPolicy: {{ .Values.sidecars.envoy.images.pullPolicy }}
  args:
    - -c
    - |
      /usr/local/bin/envoy -c /var/config/config.yaml --log-level info 2>&1 | tee /logs/envoy.txt

  command:
    - /bin/sh
  ports:
    {{- if .Values.sidecars.envoy.ssl.enabled }}
    - containerPort: 443
      name: envoy-http
    {{- else }}
    - containerPort: {{ .Values.sidecars.envoy.listenerPort }}
      name: envoy-http
    {{- end }}
    - containerPort: 9901
      name: envoy-admin
    {{- if .Values.sidecars.envoy.inClusterPaths.enabled }}
    - containerPort: {{ .Values.sidecars.envoy.inClusterPaths.port }}
      name: internal-http
    {{- end }}
  volumeMounts:
    - mountPath: /var/config
      name: envoy-cfg
      readOnly: true
    {{- if .Values.sidecars.envoy.useKubernetesSecrets }}
    - name: envoy-secrets
      mountPath: /etc/envoy/secrets
      readOnly: true
    {{- end }}
    {{- if .Values.sidecars.envoy.ssl.enabled }}
    - name: ssl-cert
      mountPath: /etc/ssl/certs/cert.crt
      subPath: cert.crt
    - name: ssl-key
      mountPath: /etc/ssl/private/private_key.key
      subPath: private_key.key
    {{- end }}
    {{- range .Values.sidecars.envoy.volumeMounts }}
    - name: {{ .name }}
      mountPath: {{ .mountPath }}
    {{- end }}
  resources:
{{ toYaml .Values.sidecars.envoy.resources | nindent 4 }}
{{- end }}
{{- end }}


{{/*
Envoy volumes
*/}}
{{- define "ui.envoy-volumes" -}}
{{- if .Values.sidecars.envoy.enabled }}
- name: envoy-cfg
  configMap:
    name: {{ .Values.services.ui.serviceName }}-envoy-config
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
{{- if .Values.sidecars.envoy.ssl.enabled }}
- name: ssl-cert
  secret:
    secretName: {{ .Values.sidecars.envoy.ssl.cert.secretName }}
    items:
    - key: {{ .Values.sidecars.envoy.ssl.cert.secretKey }}
      path: cert.crt
- name: ssl-key
  secret:
    secretName: {{ .Values.sidecars.envoy.ssl.privateKey.secretName }}
    items:
    - key: {{ .Values.sidecars.envoy.ssl.privateKey.secretKey }}
      path: private_key.key
{{- end }}
{{- end }}
{{- end }}



{{/*
Generate log agent sidecar container
*/}}
{{- define "ui.log-agent-sidecar-container" -}}
{{- if .Values.sidecars.logAgent.enabled }}
- name: log-agent
  image: "{{ .Values.sidecars.logAgent.image.repository }}"
  imagePullPolicy: {{ .Values.sidecars.logAgent.image.pullPolicy }}
  ports:
  - containerPort: {{ .Values.sidecars.logAgent.fluentBitPrometheusPort }}
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
        echo "$(date -Iseconds) Sleep for {{ .Values.sidecars.logAgent.logrotate.sleepSeconds }}s..."
        sleep {{ .Values.sidecars.logAgent.logrotate.sleepSeconds }}
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
  {{- if .Values.sidecars.logAgent.volumeMounts }}
  {{- toYaml .Values.sidecars.logAgent.volumeMounts | nindent 2}}
  {{- end }}
  livenessProbe:
    exec:
      command: ["/bin/sh", "-c",
                "reply=$(curl -s -o /dev/null -w %{http_code} http://127.0.0.1:{{ .Values.sidecars.logAgent.fluentBitPrometheusPort }});
                if [ \"$reply\" -lt 200 -o \"$reply\" -ge 400 ]; then exit 1; fi;
                {{- if .Values.sidecars.logAgent.logrotate.enabled }}if [ ! $(find /tmp/logrotate-last-success -mmin -{{ .Values.sidecars.logAgent.logrotate.sleepSeconds }}) ]; then exit 1; fi;{{- end }}"
      ]
    initialDelaySeconds: 120
    periodSeconds: 60
    successThreshold: 1
    failureThreshold: 3
  readinessProbe:
    httpGet:
      path: /api/v1/metrics/prometheus
      port: {{ .Values.sidecars.logAgent.fluentBitPrometheusPort }}
    initialDelaySeconds: 15
    periodSeconds: 20
  resources:
  {{- toYaml .Values.sidecars.logAgent.resources | nindent 4 }}
{{- end }}
{{- end }}

{{/*
Generate log agent volumes
*/}}
{{- define "ui.log-agent-volumes" -}}
{{- if .Values.sidecars.logAgent.enabled }}
- name: log-agent-config
  configMap:
    name: {{ .Values.services.ui.serviceName }}-log-agent-config
{{- if .Values.sidecars.logAgent.logrotate.enabled }}
- name: logrotate-config
  configMap:
    name: {{ .Values.services.ui.serviceName }}-log-agent-config
    items:
    - key: logrotate-fluentbit.conf
      path: logrotate-fluentbit.conf
{{- end }}
{{- if .Values.sidecars.logAgent.volumes }}
{{- toYaml .Values.sidecars.logAgent.volumes | nindent 0}}
{{- end }}
{{- end }}
{{- end }}
