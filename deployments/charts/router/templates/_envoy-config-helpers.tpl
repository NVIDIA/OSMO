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
Generate secrets configuration - supports both custom path and Kubernetes secrets
*/}}
{{- define "router.envoy.secrets" -}}
{{- if .Values.sidecars.envoy.useKubernetesSecrets }}
secrets:
- name: token
  generic_secret:
    secret:
      filename: /etc/envoy/secrets/{{ .Values.sidecars.envoy.oauth2Filter.clientSecretKey | default "client_secret" }}
- name: hmac
  generic_secret:
    secret:
      filename: /etc/envoy/secrets/{{ .Values.sidecars.envoy.oauth2Filter.hmacSecretKey | default "hmac_secret" }}
{{- else }}
secrets:
- name: token
  generic_secret:
    secret:
      filename: {{ .Values.sidecars.envoy.secretPaths.clientSecret }}
- name: hmac
  generic_secret:
    secret:
      filename: {{ .Values.sidecars.envoy.secretPaths.hmacSecret }}
{{- end }}
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

        - name: envoy.filters.http.lua.pre_oauth2
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
            default_source_code:
              inline_string: |
                function update_cookie_age(cookie, new_ages)
                  local new_cookie = ''
                  local first = true
                  local new_age = nil
                  local hostname = "{{ .Values.sidecars.envoy.service.hostname }}"
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

        {{- if .Values.sidecars.envoy.oauth2Filter.enabled }}
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
                    uri: {{ .Values.sidecars.envoy.oauth2Filter.tokenEndpoint }}
                    timeout: 3s
                  authorization_endpoint: {{ .Values.sidecars.envoy.oauth2Filter.authEndpoint }}
                  redirect_uri: "https://{{ .Values.sidecars.envoy.service.hostname }}/{{ .Values.sidecars.envoy.oauth2Filter.redirectPath }}"
                  redirect_path_matcher:
                    path:
                      exact: "/{{ .Values.sidecars.envoy.oauth2Filter.redirectPath }}"
                  signout_path:
                    path:
                      exact: "/{{ .Values.sidecars.envoy.oauth2Filter.logoutPath | default "logout" }}"
                  {{- if .Values.sidecars.envoy.oauth2Filter.forwardBearerToken }}
                  forward_bearer_token: {{ .Values.sidecars.envoy.oauth2Filter.forwardBearerToken }}
                  {{- end }}
                  credentials:
                    client_id: {{ .Values.sidecars.envoy.oauth2Filter.clientId }}
                    token_secret:
                      name: token
                    hmac_secret:
                      name: hmac
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
                  {{- range $i, $provider := .Values.sidecars.envoy.jwt.providers }}
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
        {{- end }}
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
{{- if .Values.sidecars.envoy.oauth2Filter.enabled }}
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
              address: {{ .Values.sidecars.envoy.oauth2Filter.authProvider }}
              port_value: 443
  transport_socket:
    name: envoy.transport_sockets.tls
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
      sni: {{ .Values.sidecars.envoy.oauth2Filter.authProvider }}
{{- end }}
{{- end }}

{{/*
Complete Envoy configuration
*/}}
{{- define "router.envoy.config" -}}
{{ include "router.envoy.admin" . }}
static_resources:
  {{ include "router.envoy.secrets" . | nindent 2 }}
  {{ include "router.envoy.listeners" . | nindent 2 }}
  {{ include "router.envoy.clusters" . | nindent 2 }}
{{- end }}
