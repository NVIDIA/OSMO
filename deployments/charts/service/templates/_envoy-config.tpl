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

{{- define "osmo.envoy-config" -}}
{{- $serviceEnvoy := .serviceEnvoy | default dict }}
{{- $envoy := mergeOverwrite (deepCopy .Values.sidecars.envoy) $serviceEnvoy }}
{{- $serviceName := .serviceName | default $envoy.serviceName }}
{{- if $envoy.enabled }}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ $serviceName }}-envoy-config
  namespace: {{ .Release.Namespace }}
data:
  config.yaml: |
    admin:
      access_log_path: /dev/null
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 9901
    static_resources:
      {{- if $envoy.useKubernetesSecrets }}
      secrets:
      - name: token
        generic_secret:
          secret:
            filename: /etc/envoy/secrets/{{ $envoy.oauth2Filter.clientSecretKey }}
      - name: hmac
        generic_secret:
          secret:
            filename: /etc/envoy/secrets/{{ $envoy.oauth2Filter.hmacSecretKey }}
      {{- else }}
      secrets:
      - name: token
        generic_secret:
          secret:
            filename: {{ $envoy.secretPaths.clientSecret }}
      - name: hmac
        generic_secret:
          secret:
            filename: {{ $envoy.secretPaths.hmacSecret }}
      {{- end }}

      listeners:
      - name: svc_listener
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
                  {{- toYaml $envoy.routes | nindent 18}}

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
                        -- Block specific IP addresses that are spamming
                        local downstream_remote_port = request_handle:streamInfo():downstreamRemoteAddress()
                        local downstream_remote = string.match(downstream_remote_port, "([^:]+)")

                        -- List of IPs to block
                        local blocked_ips = {
                        {{- range $index, $ip := $envoy.blockedIPs }}
                          {{- if $index }},{{ end }}
                          ["{{ $ip }}"] = true
                        {{- end }}
                        }

                        -- Check if the downstream IP is blocked
                        if blocked_ips[downstream_remote] then
                          request_handle:logInfo("Blocking request from downstream IP: " .. downstream_remote)
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
                          request_handle:headers():add("x-forwarded-host", authority)
                        end
                      end

              - name: envoy.filters.http.lua.pre_oauth2
                typed_config:
                  "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
                  default_source_code:
                    inline_string: |
                      function update_cookie_age(cookie, new_ages)
                        local new_cookie = ''
                        local first = true
                        local new_age = nil
                        local hostname = "{{ $envoy.service.hostname }}"
                        local cookie_name = nil

                        for all, key, value in string.gmatch(cookie, "(([^=;]+)=?([^;]*))") do
                          -- Do nothing if this isnt the target cookie
                          if first then
                            if new_ages[key] == nil then
                              return cookie
                            end
                            cookie_name = key
                            new_cookie = new_cookie .. all
                            new_age = new_ages[key]
                            first = false

                          -- Otherwise, if this is the max-age, update it
                          elseif key == 'Max-Age' then
                            new_cookie = new_cookie .. ';' .. 'Max-Age=' .. new_age
                          -- For Domain, keep it for non-auth cookies
                          elseif key == 'Domain' then
                            if cookie_name ~= "RefreshToken" and cookie_name ~= "BearerToken" and
                               cookie_name ~= "IdToken" and cookie_name ~= "OauthHMAC" then
                              new_cookie = new_cookie .. ';' .. all
                            end
                          -- If this is Http-Only, discard it, otherwise, append the property as is
                          elseif all ~= 'HttpOnly' then
                            new_cookie = new_cookie .. ';' .. all
                          end
                        end

                        -- Add domain for auth cookies if no domain was present
                        if cookie_name == "RefreshToken" or cookie_name == "BearerToken" or
                           cookie_name == "IdToken" or cookie_name == "OauthHMAC" then
                          new_cookie = new_cookie .. '; Domain=' .. hostname
                        end

                        return new_cookie
                      end

                      function increase_refresh_age(set_cookie_header, new_ages)
                        cookies = {}
                        for cookie in string.gmatch(set_cookie_header, "([^,]+)") do
                          cookies[#cookies + 1] = update_cookie_age(cookie, new_ages)
                        end
                        return cookies
                      end

                      function envoy_on_response(response_handle)
                        local header = response_handle:headers():get("set-cookie")
                        if header ~= nil then
                          local new_cookies = increase_refresh_age(header, {
                            RefreshToken=604800,
                            BearerToken=604800,
                            IdToken=300,
                            OauthHMAC=295,
                          })
                          response_handle:headers():remove("set-cookie")
                          for index, cookie in pairs(new_cookies) do
                            response_handle:headers():add("set-cookie", cookie)
                          end
                        end
                      end

              - name: oauth2-with-matcher
                typed_config:
                  "@type": type.googleapis.com/envoy.extensions.common.matching.v3.ExtensionWithMatcher

                  # If any of these paths match, then skip the oauth filter
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

                  # Otherwise, go through the regular oauth2 process
                  extension_config:
                    name: envoy.filters.http.oauth2
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.oauth2.v3.OAuth2
                      config:
                        token_endpoint:
                          cluster: oauth
                          uri: {{ $envoy.oauth2Filter.tokenEndpoint }}
                          timeout: 3s
                        authorization_endpoint: {{ $envoy.oauth2Filter.authEndpoint }}
                        redirect_uri: https://{{ $envoy.service.hostname }}/{{ $envoy.oauth2Filter.redirectPath }}
                        redirect_path_matcher:
                          path:
                            exact: /{{ $envoy.oauth2Filter.redirectPath }}
                        signout_path:
                          path:
                            exact: /{{ $envoy.oauth2Filter.logoutPath }}
                        forward_bearer_token: {{ $envoy.oauth2Filter.forwardBearerToken }}
                        credentials:
                          client_id: {{ $envoy.oauth2Filter.clientId }}
                          token_secret:
                            name: token
                          hmac_secret:
                            name: hmac
                        # (Optional): defaults to 'user' scope if not provided
                        auth_scopes:
                        - openid
                        use_refresh_token: true
                        pass_through_matcher:
                        - name: x-osmo-auth
                          safe_regex_match:
                            regex: ".*"

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
                        {{- range $i, $provider := $envoy.jwt.providers }}
                        provider_{{$i}}:
                          issuer: {{ $provider.issuer }}
                          audiences:
                          - {{ $provider.audience }}
                          forward: true
                          payload_in_metadata: verified_jwt
                          from_cookies:
                          - IdToken
                          from_headers:
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

              {{- with $envoy.lua }}
              - name: envoy.filters.http.lua
                typed_config:
                  "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
                  {{- toYaml . | nindent 18 }}
              {{- end }}

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
                        if (meta.verified_jwt == nil) then
                          return
                        end

                        -- Create the roles list
                        local roles_list = table.concat(meta.verified_jwt.roles, ',')

                        -- Add the header
                        request_handle:headers():replace('x-osmo-roles', roles_list)
                      end

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
              - name: envoy.filters.http.router
                typed_config:
                  "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
          {{- if $envoy.ssl.enabled }}
          transport_socket:
            name: envoy.transport_sockets.tls
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
              common_tls_context:
                tls_certificates:
                - certificate_chain:
                    filename: /etc/ssl/certs/cert.crt
                  private_key:
                    filename: /etc/ssl/private/private_key.key
          {{- end }}

      {{- if $envoy.inClusterPaths.enabled }}
      - name: in_cluster_listener
        address:
          socket_address: { address: 0.0.0.0, port_value: {{ $envoy.inClusterPaths.port }} }
        filter_chains:
        - filters:
          - name: envoy.filters.network.http_connection_manager
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
              stat_prefix: ingress_http
              max_request_headers_kb: {{ $envoy.maxHeadersSizeKb }}
              http_filters:
              - name: envoy.filters.http.router
                typed_config:
                  "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
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
                  {{- range $envoy.inClusterPaths.paths }}
                  - match:
                      path: {{.}}
                      headers:
                        name: ':method'
                        string_match:
                          exact: GET
                    route:
                      cluster: service
                  {{- end }}
      {{- end }}

      clusters:
      {{- if .Values.sidecars.rateLimit.enabled }}
      - name: rate-limit
        typed_extension_protocol_options:
          envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
            "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
            explicit_http_config:
              http2_protocol_options: {}
        connect_timeout: 0.25s
        type: STRICT_DNS
        lb_policy: round_robin
        load_assignment:
          cluster_name: rate-limit
          endpoints:
          - lb_endpoints:
            - endpoint:
                address:
                  socket_address:
                    address: 127.0.0.1
                    port_value: {{ .Values.sidecars.rateLimit.grpcPort }}
        {{- end }}

      - name: oauth
        connect_timeout: 3s
        type: STRICT_DNS
        dns_refresh_rate: 5s
        respect_dns_ttl: true
        dns_lookup_family: V4_ONLY
        lb_policy: ROUND_ROBIN
        load_assignment:
          cluster_name: oauth
          endpoints:
          - lb_endpoints:
            - endpoint:
                address:
                  socket_address:
                    address: {{ $envoy.oauth2Filter.authProvider }}
                    port_value: 443
        transport_socket:
          name: envoy.transport_sockets.tls
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
            sni: {{ $envoy.oauth2Filter.authProvider }}

      - name: service
        connect_timeout: 3s
        type: STRICT_DNS
        dns_lookup_family: V4_ONLY
        lb_policy: ROUND_ROBIN
        {{- if $envoy.maxRequests }}
        circuit_breakers:
          thresholds:
          - priority: DEFAULT
            max_requests: {{$envoy.maxRequests}}
        {{- end }}
        load_assignment:
          cluster_name: service
          endpoints:
          - lb_endpoints:
            - endpoint:
                address:
                  socket_address:
                    address: {{ $envoy.service.address }}
                    port_value: {{ $envoy.service.port }}

{{- end }}
{{- end }}
