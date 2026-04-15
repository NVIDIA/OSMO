# SPDX-FileCopyrightText: Copyright (c) 2024-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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
Gateway Envoy ConfigMap — filesystem-based dynamic configuration.

  bootstrap.yaml — read once at startup; references LDS/CDS files
  lds.yaml       — Listener Discovery Service; watched for changes
  cds.yaml       — Cluster Discovery Service; watched for changes

Kubernetes rotates ConfigMap symlinks atomically.  The watched_directory
setting detects this rotation and triggers Envoy to reload.
*/}}

{{- define "osmo.gateway-envoy-config" -}}
{{- $gw := .Values.gateway }}
{{- $envoy := $gw.envoy }}
{{- $gwName := include "osmo.gateway-name" . }}
{{- if $envoy.enabled }}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ $gwName }}-envoy-config
  namespace: {{ .Release.Namespace }}
data:
  bootstrap.yaml: |
    admin:
      access_log_path: /dev/null
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 9901
    node:
      cluster: {{ $gwName }}
      id: {{ $gwName }}
    dynamic_resources:
      lds_config:
        path_config_source:
          path: /var/config/lds.yaml
          watched_directory:
            path: /var/config
      cds_config:
        path_config_source:
          path: /var/config/cds.yaml
          watched_directory:
            path: /var/config

  {{- if $envoy.ssl.enabled }}
  sds_downstream_tls.yaml: |
    resources:
    - "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret
      name: downstream_cert
      tls_certificate:
        certificate_chain:
          filename: /etc/ssl/envoy-certs/tls.crt
        private_key:
          filename: /etc/ssl/envoy-certs/tls.key
  {{- end }}

  {{- if $gw.tls.enabled }}
  sds_upstream_ca.yaml: |
    resources:
    - "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret
      name: upstream_ca
      validation_context:
        trusted_ca:
          filename: /etc/gateway-tls/ca.crt
  {{- end }}

  lds.yaml: |
    resources:
    - "@type": type.googleapis.com/envoy.config.listener.v3.Listener
      name: gateway_listener
      address:
        {{- if $envoy.ssl.enabled }}
        socket_address: { address: 0.0.0.0, port_value: 443 }
        {{- else }}
        socket_address: { address: 0.0.0.0, port_value: {{ $envoy.listenerPort }} }
        {{- end }}
      filter_chains:
      - filters:
        - name: envoy.filters.network.http_connection_manager
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
            stat_prefix: ingress_http
            access_log:
            - name: envoy.access_loggers.file
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
                path: "/dev/stdout"
                log_format:
                  json_format:
                    start_time: "%START_TIME%"
                    method: "%REQ(:METHOD)%"
                    path: "%REQ(X-ENVOY-ORIGINAL-PATH?:PATH)%"
                    protocol: "%PROTOCOL%"
                    response_code: "%RESPONSE_CODE%"
                    response_code_details: "%RESPONSE_CODE_DETAILS%"
                    response_flags: "%RESPONSE_FLAGS%"
                    connection_termination_details: "%CONNECTION_TERMINATION_DETAILS%"
                    bytes_received: "%BYTES_RECEIVED%"
                    bytes_sent: "%BYTES_SENT%"
                    duration: "%DURATION%"
                    request_duration: "%REQUEST_DURATION%"
                    response_duration: "%RESPONSE_DURATION%"
                    response_tx_duration: "%RESPONSE_TX_DURATION%"
                    upstream_host: "%UPSTREAM_HOST%"
                    upstream_cluster: "%UPSTREAM_CLUSTER%"
                    upstream_local_address: "%UPSTREAM_LOCAL_ADDRESS%"
                    upstream_transport_failure_reason: "%UPSTREAM_TRANSPORT_FAILURE_REASON%"
                    upstream_request_attempt_count: "%UPSTREAM_REQUEST_ATTEMPT_COUNT%"
                    downstream_remote_address: "%DOWNSTREAM_REMOTE_ADDRESS%"
                    downstream_local_address: "%DOWNSTREAM_LOCAL_ADDRESS%"
                    requested_server_name: "%REQUESTED_SERVER_NAME%"
                    route_name: "%ROUTE_NAME%"
                    connection_id: "%CONNECTION_ID%"
                    user_agent: "%REQ(USER-AGENT)%"
                    request_id: "%REQ(X-REQUEST-ID)%"
                    authority: "%REQ(:AUTHORITY)%"
                    x_forwarded_for: "%REQ(X-FORWARDED-FOR)%"
                    level: "info"
                    osmo_user: "%REQ(X-OSMO-USER)%"
                    osmo_token_name: "%REQ(X-OSMO-TOKEN-NAME)%"
                    osmo_workflow_id: "%REQ(X-OSMO-WORKFLOW-ID)%"
            codec_type: AUTO
            route_config:
              name: gateway_routes

              internal_only_headers:
              - x-osmo-auth-skip
              - x-osmo-user
              - x-osmo-token-name
              - x-osmo-workflow-id
              - x-osmo-allowed-pools

              virtual_hosts:
              - name: gateway
                domains: ["*"]
                routes:
                {{- if $gw.oauth2Proxy.enabled }}
                - match:
                    prefix: /oauth2/
                  route:
                    cluster: oauth2-proxy
                {{- end }}

                {{- if $gw.upstreams.router.enabled }}
                - match:
                    prefix: {{ $envoy.routerRoute.prefix | default "/api/router" }}
                  route:
                    cluster: osmo-router
                    timeout: {{ $envoy.routerRoute.timeout | default "0s" }}
                    hash_policy:
                    - cookie:
                        name: {{ $envoy.routerRoute.cookie.name | default "_osmo_router_affinity" }}
                        ttl: {{ $envoy.routerRoute.cookie.ttl | default "60s" }}
                {{- end }}

                {{- /* Agent routes — WebSocket to osmo-agent */}}
                {{- if $gw.upstreams.agent.enabled }}
                - match:
                    prefix: /api/agent/
                  route:
                    cluster: osmo-agent
                    timeout: 0s
                {{- end }}

                {{- /* Logger routes — WebSocket to osmo-logger */}}
                {{- if $gw.upstreams.logger.enabled }}
                - match:
                    prefix: /api/logger/
                  route:
                    cluster: osmo-logger
                    timeout: 0s
                {{- end }}

                {{- if $envoy.serviceRoutes }}
                {{- toYaml $envoy.serviceRoutes | nindent 16 }}
                {{- else }}
                - match:
                    prefix: /api/
                  route:
                    cluster: osmo-service
                - match:
                    prefix: /client/
                  route:
                    cluster: osmo-service
                {{- end }}

                {{- if $gw.upstreams.ui.enabled }}
                - match:
                    prefix: /
                  route:
                    cluster: osmo-ui
                {{- end }}

            upgrade_configs:
            - upgrade_type: websocket
              enabled: true
            max_request_headers_kb: {{ $envoy.maxHeadersSizeKb }}
            http_filters:
            - name: block-spam-ips
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
                default_source_code:
                  inline_string: |
                    function envoy_on_request(request_handle)
                      local blocked_ips = {
                      {{- range $index, $ip := $envoy.blockedIPs }}
                        {{- if $index }},{{ end }}
                        ["{{ $ip }}"] = true
                      {{- end }}
                      }

                      -- Check all IPs in x-forwarded-for (covers spoofed and real entries)
                      local xff = request_handle:headers():get("x-forwarded-for")
                      if xff ~= nil then
                        for ip in string.gmatch(xff, "([^,]+)") do
                          ip = ip:match("^%s*(.-)%s*$")
                          if blocked_ips[ip] then
                            request_handle:logInfo("Blocking request from IP (xff): " .. ip)
                            request_handle:respond(
                              {[":status"] = "403"},
                              "Access denied: IP address blocked due to excessive requests"
                            )
                            return
                          end
                        end
                      end

                      -- Also check the direct peer address
                      local peer = request_handle:streamInfo():downstreamRemoteAddress()
                      local peer_ip = string.match(peer, "([^:]+)")
                      if blocked_ips[peer_ip] then
                        request_handle:logInfo("Blocking request from IP (peer): " .. peer_ip)
                        request_handle:respond(
                          {[":status"] = "403"},
                          "Access denied: IP address blocked due to excessive requests"
                        )
                        return
                      end
                    end
            - name: strip-unauthorized-headers
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
                default_source_code:
                  inline_string: |
                    function envoy_on_request(request_handle)
                      request_handle:headers():remove("x-osmo-auth-skip")
                      request_handle:headers():remove("x-osmo-user")
                      request_handle:headers():remove("x-osmo-roles")
                      request_handle:headers():remove("x-osmo-token-name")
                      request_handle:headers():remove("x-osmo-workflow-id")
                      request_handle:headers():remove("x-osmo-allowed-pools")
                      request_handle:headers():remove("x-envoy-internal")
                      request_handle:headers():remove("x-forwarded-host")
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
                      {{- range $envoy.skipAuthPaths }}
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
                        request_handle:headers():replace("x-forwarded-host", authority)
                      end
                    end

            {{- if $gw.oauth2Proxy.enabled }}
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
                          - single_predicate:
                              input:
                                name: request-headers
                                typed_config:
                                  "@type": type.googleapis.com/envoy.type.matcher.v3.HttpRequestHeaderMatchInput
                                  header_name: authorization
                              value_match:
                                prefix: "Bearer "
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
                        uri: http://{{ $gwName }}-oauth2-proxy:{{ $gw.oauth2Proxy.httpPort }}/oauth2/auth
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
                          - exact: x-auth-request-user
                          - exact: x-auth-request-email
                          - exact: x-auth-request-preferred-username
                        allowed_client_headers_on_success:
                          patterns:
                          - exact: set-cookie
                    failure_mode_allow: false
            {{- end }}

            {{- if $envoy.jwt.providers }}
            - name: jwt-authn-with-matcher
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.common.matching.v3.ExtensionWithMatcher
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
                extension_config:
                  name: envoy.filters.http.jwt_authn
                  typed_config:
                    "@type": type.googleapis.com/envoy.extensions.filters.http.jwt_authn.v3.JwtAuthentication
                    providers:
                      {{- range $i, $provider := $envoy.jwt.providers }}
                      provider_{{$i}}:
                        issuer: {{ $provider.issuer }}
                        audiences:
                        - {{ $provider.audience }}
                        forward: true
                        payload_in_metadata: verified_jwt
                        from_headers:
                        - name: authorization
                          value_prefix: "Bearer "
                        - name: x-osmo-auth
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
                        - claim_name: {{$provider.user_claim}}
                          header_name: {{$envoy.jwt.user_header}}
                      {{- end }}
                    rules:
                    - match:
                        prefix: /
                      requires:
                        requires_any:
                          requirements:
                          {{- range $i, $provider := $envoy.jwt.providers }}
                          - provider_name: provider_{{$i}}
                          {{- end}}
            {{- end }}

            - name: envoy.filters.http.lua.roles
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
                default_source_code:
                  inline_string: |
                    function envoy_on_request(request_handle)
                      local meta = request_handle:streamInfo():dynamicMetadata():get('envoy.filters.http.jwt_authn')
                      if (meta == nil or meta.verified_jwt == nil) then
                        return
                      end
                      local roles = meta.verified_jwt.roles
                      if (roles ~= nil and type(roles) == 'table') then
                        request_handle:headers():replace('x-osmo-roles', table.concat(roles, ','))
                      end
                      if (meta.verified_jwt.osmo_token_name ~= nil) then
                        request_handle:headers():replace('x-osmo-token-name', tostring(meta.verified_jwt.osmo_token_name))
                      end
                      if (meta.verified_jwt.osmo_workflow_id ~= nil) then
                        request_handle:headers():replace('x-osmo-workflow-id', tostring(meta.verified_jwt.osmo_workflow_id))
                      end
                    end

            {{- if $gw.authz.enabled }}
            - name: envoy.filters.http.ext_authz
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
                transport_api_version: V3
                with_request_body:
                  max_request_bytes: 8192
                  allow_partial_message: true
                failure_mode_allow: false
                grpc_service:
                  envoy_grpc:
                    cluster_name: authz
                  timeout: 1s
                metadata_context_namespaces:
                  - envoy.filters.http.jwt_authn
            {{- end }}

            {{- if $gw.rateLimit.enabled }}
            - name: envoy.filters.http.ratelimit
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.http.ratelimit.v3.RateLimit
                domain: ratelimit
                enable_x_ratelimit_headers: DRAFT_VERSION_03
                rate_limit_service:
                  transport_api_version: V3
                  grpc_service:
                      envoy_grpc:
                        cluster_name: rate-limit
            {{- end }}
            - name: envoy.filters.http.router
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
        {{- if $envoy.ssl.enabled }}
        transport_socket:
          name: envoy.transport_sockets.tls
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
            common_tls_context:
              tls_certificate_sds_secret_configs:
              - name: downstream_cert
                sds_config:
                  path_config_source:
                    path: /var/config/sds_downstream_tls.yaml
                    watched_directory:
                      path: /var/config
        {{- end }}

  cds.yaml: |
    resources:
    - "@type": type.googleapis.com/envoy.config.cluster.v3.Cluster
      name: osmo-service
      connect_timeout: 3s
      type: STRICT_DNS
      dns_lookup_family: V4_ONLY
      lb_policy: ROUND_ROBIN
      {{- if $envoy.maxRequests }}
      circuit_breakers:
        thresholds:
        - priority: DEFAULT
          max_requests: {{ $envoy.maxRequests }}
      {{- end }}
      load_assignment:
        cluster_name: osmo-service
        endpoints:
        - lb_endpoints:
          - endpoint:
              address:
                socket_address:
                  address: {{ $gw.upstreams.service.host }}
                  port_value: {{ $gw.upstreams.service.port }}
      {{- if $gw.tls.enabled }}
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          common_tls_context:
            validation_context_sds_secret_config:
              name: upstream_ca
              sds_config:
                path_config_source:
                  path: /var/config/sds_upstream_ca.yaml
                  watched_directory:
                    path: /var/config
      {{- end }}

    {{- if $gw.upstreams.router.enabled }}
    - "@type": type.googleapis.com/envoy.config.cluster.v3.Cluster
      name: osmo-router
      connect_timeout: 3s
      type: STRICT_DNS
      dns_lookup_family: V4_ONLY
      lb_policy: RING_HASH
      ring_hash_lb_config:
        minimum_ring_size: 64
      load_assignment:
        cluster_name: osmo-router
        endpoints:
        - lb_endpoints:
          - endpoint:
              address:
                socket_address:
                  address: {{ $gw.upstreams.router.host }}
                  port_value: {{ $gw.upstreams.router.port }}
      {{- if $gw.tls.enabled }}
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          common_tls_context:
            validation_context_sds_secret_config:
              name: upstream_ca
              sds_config:
                path_config_source:
                  path: /var/config/sds_upstream_ca.yaml
                  watched_directory:
                    path: /var/config
      {{- end }}
    {{- end }}

    {{- if $gw.upstreams.ui.enabled }}
    - "@type": type.googleapis.com/envoy.config.cluster.v3.Cluster
      name: osmo-ui
      connect_timeout: 3s
      type: STRICT_DNS
      dns_lookup_family: V4_ONLY
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: osmo-ui
        endpoints:
        - lb_endpoints:
          - endpoint:
              address:
                socket_address:
                  address: {{ $gw.upstreams.ui.host }}
                  port_value: {{ $gw.upstreams.ui.port }}
      {{- if $gw.tls.enabled }}
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          common_tls_context:
            validation_context_sds_secret_config:
              name: upstream_ca
              sds_config:
                path_config_source:
                  path: /var/config/sds_upstream_ca.yaml
                  watched_directory:
                    path: /var/config
      {{- end }}
    {{- end }}

    {{- if $gw.upstreams.agent.enabled }}
    - "@type": type.googleapis.com/envoy.config.cluster.v3.Cluster
      name: osmo-agent
      connect_timeout: 3s
      type: STRICT_DNS
      dns_lookup_family: V4_ONLY
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: osmo-agent
        endpoints:
        - lb_endpoints:
          - endpoint:
              address:
                socket_address:
                  address: {{ $gw.upstreams.agent.host }}
                  port_value: {{ $gw.upstreams.agent.port }}
      {{- if $gw.tls.enabled }}
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          common_tls_context:
            validation_context_sds_secret_config:
              name: upstream_ca
              sds_config:
                path_config_source:
                  path: /var/config/sds_upstream_ca.yaml
                  watched_directory:
                    path: /var/config
      {{- end }}
    {{- end }}

    {{- if $gw.upstreams.logger.enabled }}
    - "@type": type.googleapis.com/envoy.config.cluster.v3.Cluster
      name: osmo-logger
      connect_timeout: 3s
      type: STRICT_DNS
      dns_lookup_family: V4_ONLY
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: osmo-logger
        endpoints:
        - lb_endpoints:
          - endpoint:
              address:
                socket_address:
                  address: {{ $gw.upstreams.logger.host }}
                  port_value: {{ $gw.upstreams.logger.port }}
      {{- if $gw.tls.enabled }}
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          common_tls_context:
            validation_context_sds_secret_config:
              name: upstream_ca
              sds_config:
                path_config_source:
                  path: /var/config/sds_upstream_ca.yaml
                  watched_directory:
                    path: /var/config
      {{- end }}
    {{- end }}

    {{- if $gw.oauth2Proxy.enabled }}
    - "@type": type.googleapis.com/envoy.config.cluster.v3.Cluster
      name: oauth2-proxy
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
                  address: {{ $gwName }}-oauth2-proxy
                  port_value: {{ $gw.oauth2Proxy.httpPort }}
    {{- end }}

    {{- if $gw.authz.enabled }}
    - "@type": type.googleapis.com/envoy.config.cluster.v3.Cluster
      name: authz
      typed_extension_protocol_options:
        envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
          "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
          explicit_http_config:
            http2_protocol_options: {}
      connect_timeout: 0.25s
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: authz
        endpoints:
        - lb_endpoints:
          - endpoint:
              address:
                socket_address:
                  address: {{ $gwName }}-authz
                  port_value: {{ $gw.authz.grpcPort }}
    {{- end }}

    {{- if $gw.rateLimit.enabled }}
    - "@type": type.googleapis.com/envoy.config.cluster.v3.Cluster
      name: rate-limit
      typed_extension_protocol_options:
        envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
          "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
          explicit_http_config:
            http2_protocol_options: {}
      connect_timeout: 0.25s
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: rate-limit
        endpoints:
        - lb_endpoints:
          - endpoint:
              address:
                socket_address:
                  address: {{ $gwName }}-ratelimit
                  port_value: {{ $gw.rateLimit.grpcPort }}
    {{- end }}

    {{- if $envoy.idp.host }}
    - "@type": type.googleapis.com/envoy.config.cluster.v3.Cluster
      name: idp
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
                  address: {{ $envoy.idp.host }}
                  port_value: 443
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          sni: {{ $envoy.idp.host }}
    {{- end }}

    {{- if $envoy.internalJwks.enabled }}
    - "@type": type.googleapis.com/envoy.config.cluster.v3.Cluster
      name: {{ $envoy.internalJwks.cluster }}
      connect_timeout: 3s
      type: STRICT_DNS
      dns_lookup_family: V4_ONLY
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: {{ $envoy.internalJwks.cluster }}
        endpoints:
        - lb_endpoints:
          - endpoint:
              address:
                socket_address:
                  address: {{ $envoy.internalJwks.host | default $gw.upstreams.service.host }}
                  port_value: {{ $envoy.internalJwks.port | default $gw.upstreams.service.port }}
    {{- end }}

{{- end }}
{{- end }}
