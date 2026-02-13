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
Shared Envoy configuration helpers for the router service.
These templates generate standardized Envoy configurations.
*/}}

{{/*
Generate standard Envoy admin configuration
*/}}
{{- define "router.envoy.admin" -}}
admin:
  access_log_path: /dev/null
  address:
    socket_address:
      address: 0.0.0.0
      port_value: 9901
{{- end }}

{{/*
Generate listeners configuration
*/}}
{{- define "router.envoy.listeners" -}}
listeners:
- name: svc_listener
  address:
    socket_address:
      address: 0.0.0.0
      port_value: {{ .Values.sidecars.envoy.listenerPort }}
  filter_chains:
  - filters:
    - name: envoy.filters.network.http_connection_manager
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
        stat_prefix: ingress_http
        access_log:
        # Log all requests - no filter applied
        - name: envoy.access_loggers.file
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
            path: "/logs/envoy_access_log.txt"
            log_format: {
              text_format: "[%START_TIME%] \"%REQ(:METHOD)% %REQ(X-ENVOY-ORIGINAL-PATH?:PATH)% %PROTOCOL%\" %RESPONSE_CODE% %RESPONSE_FLAGS% %BYTES_RECEIVED% %BYTES_SENT% %DURATION% %RESP(X-ENVOY-UPSTREAM-SERVICE-TIME)% \"%REQ(USER-AGENT)%\" \"%REQ(X-REQUEST-ID)%\" \"%REQ(:AUTHORITY)%\" \"%UPSTREAM_HOST%\" \"%REQ(X-OSMO-USER)%\" \"%DOWNSTREAM_REMOTE_ADDRESS%\"\n"
            }
        # Dedicated API path logging - captures all /api/* requests
        - name: envoy.access_loggers.file
          filter:
            header_filter:
              header:
                name: ":path"
                string_match:
                  prefix: "/api/"
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
            path: "/logs/envoy_api_access_log.txt"
            log_format: {
              text_format: "[API] [%START_TIME%] \"%REQ(:METHOD)% %REQ(X-ENVOY-ORIGINAL-PATH?:PATH)% %PROTOCOL%\" %RESPONSE_CODE% %RESPONSE_FLAGS% %BYTES_RECEIVED% %BYTES_SENT% %DURATION% %RESP(X-ENVOY-UPSTREAM-SERVICE-TIME)% \"%REQ(USER-AGENT)%\" \"%REQ(X-REQUEST-ID)%\" \"%REQ(:AUTHORITY)%\" \"%UPSTREAM_HOST%\" \"%REQ(X-OSMO-USER)%\" \"%DOWNSTREAM_REMOTE_ADDRESS%\"\n"
            }
        codec_type: AUTO
        route_config:
          name: service_routes
          # Dont allow users to skip osmo authentication or override the user
          internal_only_headers:
          - x-osmo-auth-skip
          - x-osmo-user
          virtual_hosts:
          - name: service
            domains: ["*"]
            routes:
            {{- if $.Values.sidecars.oauth2Proxy.enabled }}
            - match:
                prefix: /oauth2/
              route:
                cluster: oauth2-proxy
            {{- end }}
            {{- toYaml .Values.sidecars.envoy.routes | nindent 12}}
        upgrade_configs:
        - upgrade_type: websocket
          enabled: true
        max_request_headers_kb: {{ .Values.sidecars.envoy.maxHeadersSizeKb | default 128 }}
        http_filters:
        - name: strip-unauthorized-headers
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
            default_source_code:
              inline_string: |
                 function envoy_on_request(request_handle)
                   -- Explicitly strip dangerous headers that should never come from external clients
                   request_handle:headers():remove("x-osmo-auth-skip")
                   request_handle:headers():remove("x-osmo-user")
                   request_handle:headers():remove("x-osmo-roles")
                   request_handle:headers():remove("x-envoy-internal")
                 end
        - name: add-auth-skip
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
            default_source_code:
              inline_string: |
                function starts_with(str, start)
                   return str:sub(1, #start) == start
                end

                function envoy_on_request(request_handle)
                  skip = false
                  {{- range .Values.sidecars.envoy.skipAuthPaths }}
                  if (starts_with(request_handle:headers():get(':path'), '{{.}}')) then
                    skip = true
                  end
                  {{- end}}
                  if (skip) then
                    request_handle:headers():add("x-osmo-auth-skip", "true")
                  end
                end

        - name: add-forwarded-host
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
            default_source_code:
              inline_string: |
                function envoy_on_request(request_handle)
                  local authority = request_handle:headers():get(":authority")
                  if authority ~= nil then
                    request_handle:headers():add("x-forwarded-host", authority)
                  end
                end

        {{- if $.Values.sidecars.oauth2Proxy.enabled }}
        - name: ext-authz-oauth2-proxy
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.common.matching.v3.ExtensionWithMatcher
            xds_matcher:
              matcher_list:
                matchers:
                - predicate:
                    or_matcher:
                      predicate:
                      - single_predicate:
                          input:
                            name: request-headers
                            typed_config:
                              "@type": type.googleapis.com/envoy.type.matcher.v3.HttpRequestHeaderMatchInput
                              header_name: x-osmo-auth-skip
                          value_match:
                            exact: "true"
                      - single_predicate:
                          input:
                            name: request-headers
                            typed_config:
                              "@type": type.googleapis.com/envoy.type.matcher.v3.HttpRequestHeaderMatchInput
                              header_name: x-osmo-auth
                          value_match:
                            safe_regex:
                              google_re2: {}
                              regex: ".+"
                  on_match:
                    action:
                      name: skip
                      typed_config:
                        "@type": type.googleapis.com/envoy.extensions.filters.common.matcher.action.v3.SkipFilter
            extension_config:
              name: envoy.filters.http.ext_authz
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
                http_service:
                  server_uri:
                    uri: http://127.0.0.1:{{ $.Values.sidecars.oauth2Proxy.httpPort }}/oauth2/auth
                    cluster: oauth2-proxy
                    timeout: 3s
                  authorization_request:
                    allowed_headers:
                      patterns:
                      - exact: cookie
                  authorization_response:
                    allowed_upstream_headers:
                      patterns:
                      - exact: authorization
                    allowed_client_headers_on_success:
                      patterns:
                      - exact: set-cookie
                failure_mode_allow: false
        {{- end }}

        - name: jwt-authn-with-matcher
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.common.matching.v3.ExtensionWithMatcher

            # If any of these paths match, then skip the jwt filter
            xds_matcher:
              matcher_list:
                matchers:
                - predicate:
                    single_predicate:
                      input:
                        name: request-headers
                        typed_config:
                          "@type": type.googleapis.com/envoy.type.matcher.v3.HttpRequestHeaderMatchInput
                          header_name: x-osmo-auth-skip
                      value_match:
                        exact: "true"
                  on_match:
                    action:
                      name: skip
                      typed_config:
                        "@type": type.googleapis.com/envoy.extensions.filters.common.matcher.action.v3.SkipFilter

            # Otherwise, go through the regular jwt process
            extension_config:
              name: envoy.filters.http.jwt_authn
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.http.jwt_authn.v3.JwtAuthentication
                providers:
                  {{- range $i, $provider := .Values.sidecars.envoy.jwt.providers }}
                  provider_{{$i}}:
                    issuer: {{ $provider.issuer }}
                    audiences:
                    - {{ $provider.audience }}
                    forward: true
                    payload_in_metadata: verified_jwt
                    from_headers:
                    - name: x-osmo-auth
                    - name: authorization
                      value_prefix: "Bearer "
                    remote_jwks:
                      http_uri:
                        uri: {{ $provider.jwks_uri }}
                        cluster: {{ $provider.cluster }}
                        timeout: 5s
                      cache_duration:
                        seconds: 600
                      async_fetch:
                        failed_refetch_duration: 1s
                      retry_policy:
                        num_retries: 3
                        retry_back_off:
                          base_interval: 0.01s
                          max_interval: 3s
                    claim_to_headers:
                    - claim_name: {{ $provider.user_claim }}
                      header_name: {{ $.Values.sidecars.envoy.jwt.user_header | default "x-osmo-user" }}
                  {{- end }}
                rules:
                - match:
                    prefix: /
                  requires:
                    requires_any:
                      requirements:
                      {{- range $i, $provider := .Values.sidecars.envoy.jwt.providers }}
                      - provider_name: provider_{{$i}}
                      {{- end}}

        - name: envoy.filters.http.lua.roles
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
            default_source_code:
              inline_string: |
                      -- Read in the tokens from the k8s roles and build the roles headers
                      function envoy_on_request(request_handle)
                        -- Fetch the jwt info
                        local meta = request_handle:streamInfo():dynamicMetadata():get('envoy.filters.http.jwt_authn')

                        -- If jwt verification failed, do nothing
                        if (meta == nil or meta.verified_jwt == nil) then
                          return
                        end

                        -- Create the roles list
                        local roles_list = table.concat(meta.verified_jwt.roles, ',')

                        -- Add the header
                        request_handle:headers():replace('x-osmo-roles', roles_list)
                      end
        - name: envoy.filters.http.router
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
{{- end }}

{{/*
Generate clusters configuration
*/}}
{{- define "router.envoy.clusters" -}}
clusters:
- name: service
  connect_timeout: 3s
  type: STRICT_DNS
  dns_lookup_family: V4_ONLY
  lb_policy: ROUND_ROBIN
  circuit_breakers:
    thresholds:
    - priority: DEFAULT
      max_requests: {{.Values.sidecars.envoy.maxRequests}}
  load_assignment:
    cluster_name: service
    endpoints:
    - lb_endpoints:
      - endpoint:
          address:
            socket_address:
              address: {{ .Values.sidecars.envoy.service.address | default "127.0.0.1" }}
              port_value: {{ .Values.sidecars.envoy.service.port | default 8000 }}
{{- if .Values.sidecars.envoy.osmoauth.enabled }}
- name: osmoauth
  connect_timeout: 3s
  type: STRICT_DNS
  dns_lookup_family: V4_ONLY
  lb_policy: ROUND_ROBIN
  circuit_breakers:
    thresholds:
    - priority: DEFAULT
      max_requests: {{.Values.sidecars.envoy.maxRequests}}
  load_assignment:
    cluster_name: osmoauth
    endpoints:
    - lb_endpoints:
      - endpoint:
          address:
            socket_address:
              address: {{ .Values.sidecars.envoy.osmoauth.address | default "osmo-service" }}
              port_value: {{ .Values.sidecars.envoy.osmoauth.port | default 80 }}
{{- end }}
{{- if .Values.sidecars.envoy.idp.host }}
- name: idp
  connect_timeout: 3s
  type: STRICT_DNS
  dns_refresh_rate: 5s
  respect_dns_ttl: true
  dns_lookup_family: V4_ONLY
  lb_policy: ROUND_ROBIN
  load_assignment:
    cluster_name: idp
    endpoints:
    - lb_endpoints:
      - endpoint:
          address:
            socket_address:
              address: {{ .Values.sidecars.envoy.idp.host }}
              port_value: 443
  transport_socket:
    name: envoy.transport_sockets.tls
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
      sni: {{ .Values.sidecars.envoy.idp.host }}
{{- end }}
{{- if $.Values.sidecars.oauth2Proxy.enabled }}
- name: oauth2-proxy
  connect_timeout: 0.25s
  type: STRICT_DNS
  lb_policy: ROUND_ROBIN
  load_assignment:
    cluster_name: oauth2-proxy
    endpoints:
    - lb_endpoints:
      - endpoint:
          address:
            socket_address:
              address: 127.0.0.1
              port_value: {{ $.Values.sidecars.oauth2Proxy.httpPort }}
{{- end }}
{{- end }}

{{/*
Complete Envoy configuration
*/}}
{{- define "router.envoy.config" -}}
{{ include "router.envoy.admin" . }}
static_resources:
  {{ include "router.envoy.listeners" . | nindent 2 }}
  {{ include "router.envoy.clusters" . | nindent 2 }}
{{- end }}
