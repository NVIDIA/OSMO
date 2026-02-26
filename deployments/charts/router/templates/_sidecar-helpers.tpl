# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

{{/*
OAuth2 Proxy sidecar container
*/}}
{{- define "router.oauth2-proxy-sidecar-container" -}}
{{- if .Values.sidecars.oauth2Proxy.enabled }}
- name: oauth2-proxy
  image: "{{ .Values.sidecars.oauth2Proxy.image }}"
  imagePullPolicy: {{ .Values.sidecars.oauth2Proxy.imagePullPolicy }}
  securityContext:
    {{- toYaml .Values.sidecars.oauth2Proxy.securityContext | nindent 4 }}
  args:
    - --config={{ .Values.sidecars.oauth2Proxy.secretPaths.cookieSecret }}
    - --http-address=0.0.0.0:{{ .Values.sidecars.oauth2Proxy.httpPort }}
    - --metrics-address=0.0.0.0:{{ .Values.sidecars.oauth2Proxy.metricsPort }}
    - --reverse-proxy=true
    - --provider={{ .Values.sidecars.oauth2Proxy.provider }}
    - --oidc-issuer-url={{ .Values.sidecars.oauth2Proxy.oidcIssuerUrl }}
    - --client-id={{ .Values.sidecars.oauth2Proxy.clientId }}
    - --cookie-secure={{ .Values.sidecars.oauth2Proxy.cookieSecure }}
    - --cookie-name={{ .Values.sidecars.oauth2Proxy.cookieName }}
    {{- if .Values.sidecars.oauth2Proxy.cookieDomain }}
    - --cookie-domain={{ .Values.sidecars.oauth2Proxy.cookieDomain }}
    {{- end }}
    - --cookie-expire={{ .Values.sidecars.oauth2Proxy.cookieExpire }}
    - --cookie-refresh={{ .Values.sidecars.oauth2Proxy.cookieRefresh }}
    - --scope={{ .Values.sidecars.oauth2Proxy.scope }}
    - --email-domain=*
    - --set-xauthrequest=true
    - --set-authorization-header=true
    - --pass-access-token={{ .Values.sidecars.oauth2Proxy.passAccessToken }}
    - --upstream=static://200
    - --redirect-url=https://{{ .Values.sidecars.envoy.service.hostname }}/oauth2/callback
    - --silence-ping-logging=true
    - --skip-provider-button=true
    {{- range .Values.sidecars.oauth2Proxy.extraArgs }}
    - {{ . }}
    {{- end }}
  ports:
  - name: http
    containerPort: {{ .Values.sidecars.oauth2Proxy.httpPort }}
  - name: metrics
    containerPort: {{ .Values.sidecars.oauth2Proxy.metricsPort }}
  livenessProbe:
    httpGet:
      path: /ping
      port: http
    initialDelaySeconds: 10
    periodSeconds: 10
    timeoutSeconds: 3
  readinessProbe:
    httpGet:
      path: /ready
      port: http
    initialDelaySeconds: 5
    periodSeconds: 5
    timeoutSeconds: 3
  resources:
    {{- toYaml .Values.sidecars.oauth2Proxy.resources | nindent 4 }}
  volumeMounts:
    {{- if .Values.sidecars.oauth2Proxy.useKubernetesSecrets }}
    - name: oauth2-proxy-secrets
      mountPath: /etc/oauth2-proxy
      readOnly: true
    {{- end }}
    {{- with .Values.sidecars.oauth2Proxy.extraVolumeMounts }}
      {{- toYaml . | nindent 4 }}
    {{- end }}
{{- end }}
{{- end }}

{{/*
OAuth2 Proxy volumes
*/}}
{{- define "router.oauth2-proxy-volumes" -}}
{{- if .Values.sidecars.oauth2Proxy.enabled }}
{{- if .Values.sidecars.oauth2Proxy.useKubernetesSecrets }}
- name: oauth2-proxy-secrets
  secret:
    secretName: {{ .Values.sidecars.oauth2Proxy.secretName | default "oauth2-proxy-secrets" }}
    items:
    - key: {{ .Values.sidecars.oauth2Proxy.clientSecretKey | default "client_secret" }}
      path: client-secret
    - key: {{ .Values.sidecars.oauth2Proxy.cookieSecretKey | default "cookie_secret" }}
      path: cookie-secret
{{- end }}
{{- end }}
{{- end }}
Authorization sidecar container
*/}}
{{- define "router.authz-sidecar-container" -}}
{{- if .Values.sidecars.authz.enabled }}
- name: authz-sidecar
  securityContext:
    {{- toYaml .Values.sidecars.authz.securityContext | nindent 4 }}
  image: "{{ .Values.global.osmoImageLocation }}/{{ .Values.sidecars.authz.imageName }}:{{ .Values.global.osmoImageTag }}"
  imagePullPolicy: {{ .Values.sidecars.authz.imagePullPolicy }}
  args:
    - "--grpc-port={{ .Values.sidecars.authz.grpcPort }}"
    - "--postgres-host={{ .Values.services.postgres.serviceName }}"
    - "--postgres-port={{ .Values.services.postgres.port }}"
    - "--postgres-database={{ .Values.services.postgres.db }}"
    - "--postgres-user={{ .Values.services.postgres.user }}"
    - "--postgres-ssl-mode={{ .Values.sidecars.authz.postgres.sslMode }}"
    - "--postgres-max-conns={{ .Values.sidecars.authz.postgres.maxConns }}"
    - "--postgres-min-conns={{ .Values.sidecars.authz.postgres.minConns }}"
    - "--postgres-max-conn-lifetime={{ .Values.sidecars.authz.postgres.maxConnLifetimeMin }}"
    - "--cache-ttl={{ .Values.sidecars.authz.cache.ttl }}"
    - "--cache-max-size={{ .Values.sidecars.authz.cache.maxSize }}"
    {{- if .Values.global.logs.enabled }}
    - "--log-dir=/logs"
    - "--log-name=authz_sidecar"
    {{- end }}
  env:
    - name: OSMO_SCHEMA_VERSION
      value: {{ .Values.schemaVersion | default "public" }}
    {{- with .Values.sidecars.authz.extraEnv }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
    {{- if .Values.services.postgres.password }}
    - name: OSMO_POSTGRES_PASSWORD
      value: {{ .Values.services.postgres.password }}
    {{- else if .Values.services.configFile.enabled }}
    - name: OSMO_POSTGRES_PASSWORD
      valueFrom:
        secretKeyRef:
          name: db-secret
          key: db-password
    {{- end }}
  {{- if .Values.global.logs.enabled }}
  volumeMounts:
    - name: logs
      mountPath: /logs
  {{- end }}
  {{- with .Values.sidecars.authz.livenessProbe }}
  livenessProbe:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.sidecars.authz.readinessProbe }}
  readinessProbe:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  resources:
    {{- toYaml .Values.sidecars.authz.resources | nindent 4 }}
{{- end }}
{{- end }}

