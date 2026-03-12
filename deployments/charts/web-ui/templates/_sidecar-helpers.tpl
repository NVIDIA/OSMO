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
    allowPrivilegeEscalation: false
    capabilities:
      drop: ["ALL"]
    runAsNonRoot: true
    runAsUser: 1001

  imagePullPolicy: {{ .Values.sidecars.envoy.images.pullPolicy }}
  args:
    - -c
    - /var/config/config.yaml
    - --log-level
    - info
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
  livenessProbe:
    httpGet:
      path: /ready
      port: 9901
    initialDelaySeconds: 10
    periodSeconds: 10
    timeoutSeconds: 3
  readinessProbe:
    httpGet:
      path: /ready
      port: 9901
    initialDelaySeconds: 5
    periodSeconds: 5
    timeoutSeconds: 3
  startupProbe:
    httpGet:
      path: /ready
      port: 9901
    initialDelaySeconds: 15
    periodSeconds: 5
    timeoutSeconds: 3
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
OAuth2 Proxy sidecar container
*/}}
{{- define "ui.oauth2-proxy-sidecar-container" -}}
{{- if .Values.sidecars.oauth2Proxy.enabled }}
- name: oauth2-proxy
  image: "{{ .Values.sidecars.oauth2Proxy.image }}"
  imagePullPolicy: {{ .Values.sidecars.oauth2Proxy.imagePullPolicy }}
  securityContext:
    {{- toYaml .Values.sidecars.oauth2Proxy.securityContext | nindent 4 }}
  args:
    {{- if .Values.sidecars.oauth2Proxy.useKubernetesSecrets }}
    - --client-secret-file=/etc/oauth2-proxy/client-secret
    - --cookie-secret-file=/etc/oauth2-proxy/cookie-secret
    {{- else }}
    - --config={{ .Values.sidecars.oauth2Proxy.secretPaths.cookieSecret }}
    {{- end }}
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
    {{- if .Values.sidecars.oauth2Proxy.redisSessionStore }}
    - --session-store-type=redis
    - --redis-connection-url={{ if .Values.services.redis.tlsEnabled }}rediss{{ else }}redis{{ end }}://{{ .Values.services.redis.serviceName }}:{{ .Values.services.redis.port | default 6379 }}/{{ .Values.services.redis.dbNumber | default 0 }}
    {{- end }}
    - --upstream=static://200
    - --redirect-url=https://{{ .Values.sidecars.envoy.service.hostname }}/oauth2/callback
    - --silence-ping-logging=true
    - --skip-provider-button=true
    - --api-route=/api/.+
    {{- range .Values.sidecars.oauth2Proxy.extraArgs }}
    - {{ . }}
    {{- end }}
  ports:
  - name: http
    containerPort: {{ .Values.sidecars.oauth2Proxy.httpPort }}
  - name: oauth2-metrics
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
{{- define "ui.oauth2-proxy-volumes" -}}
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
