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
Shared Envoy configuration helpers that can be consistent across charts.
These templates generate standardized Envoy configurations.
*/}}

{{/*
Generate standard Envoy admin configuration
*/}}
{{- define "envoy.admin" -}}
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
{{- define "envoy.secrets" -}}
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
Generate standard listener configuration
*/}}
{{- define "envoy.listener" -}}
{{- $config := .Values.sidecars.envoy -}}
listeners:
- name: svc_listener
  address:
    {{- if $config.ssl.enabled }}
    socket_address: { address: 0.0.0.0, port_value: 443 }
    {{- else }}
    socket_address: { address: 0.0.0.0, port_value: {{ $config.listenerPort }} }
    {{- end }}
  filter_chains:
  - filters:
    - name: envoy.filters.network.http_connection_manager
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
        stat_prefix: ingress_http
        {{- include "envoy.access-logs" . | nindent 8 }}
        codec_type: AUTO
        route_config:
          {{- include "envoy.routes" . | nindent 10 }}
        upgrade_configs:
        - upgrade_type: websocket
          enabled: true
        {{- if $config.maxRequests }}
        max_request_headers_kb: {{ $config.maxHeadersSizeKb }}
        {{- end }}
        http_filters:
        {{- include "envoy.lua-filters" . | nindent 8 }}
        {{- if .Values.sidecars.envoy.oauth2Filter.enabled }}
        {{- include "envoy.oauth2-filter" . | nindent 8 }}
        {{- end }}
        {{- if .Values.sidecars.envoy.jwtEnable }}
        {{- include "envoy.jwt-filter" . | nindent 8 }}
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
        {{- end }}
        - name: envoy.filters.http.router
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
{{- end }}

{{/*
Generate access logs configuration
*/}}
{{- define "envoy.access-logs" -}}
access_log:
- name: envoy.access_loggers.file
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
    path: "/logs/envoy_access_log.txt"
    log_format: {
      text_format: "[%START_TIME%] \"%REQ(:METHOD)% %REQ(X-ENVOY-ORIGINAL-PATH?:PATH)% %PROTOCOL%\" %RESPONSE_CODE% %RESPONSE_FLAGS% %BYTES_RECEIVED% %BYTES_SENT% %DURATION% %RESP(X-ENVOY-UPSTREAM-SERVICE-TIME)% \"%REQ(USER-AGENT)%\" \"%REQ(X-REQUEST-ID)%\" \"%REQ(:AUTHORITY)%\" \"%UPSTREAM_HOST%\" \"%REQ(X-OSMO-USER)%\"\n"
    }
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
{{- end }}

{{/*
Generate routes configuration
*/}}
{{- define "envoy.routes" -}}
name: service_routes
# Dont allow users to skip osmo authentication or override the user
internal_only_headers:
- x-osmo-auth-skip
- x-osmo-user
virtual_hosts:
- name: service
  domains: ["*"]
  routes:
  {{- range .Values.sidecars.envoy.routes }}
  - match:
      {{- if .match.prefix }}
      prefix: {{ .match.prefix | quote }}
      {{- else if .match.path }}
      path: {{ .match.path | quote }}
      {{- else if .match.regex }}
      safe_regex:
        regex: {{ .match.regex | quote }}
      {{- end }}
    route:
      cluster: {{ .route.cluster }}
      {{- if .route.timeout }}
      timeout: {{ .route.timeout }}
      {{- end }}
  {{- end }}
{{- end }}

{{/*
Generate HTTP filters - simplified for UI chart
*/}}
{{- define "envoy.http-filters" -}}
{{- include "envoy.lua-filters" . }}
{{- if .Values.sidecars.envoy.oauth2Filter.enabled }}
{{- include "envoy.oauth2-filter" . }}
{{- end }}
{{- if .Values.sidecars.envoy.jwtEnable }}
{{- include "envoy.jwt-filter" . }}
{{- end }}
- name: envoy.filters.http.router
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
{{- end }}

{{/*
Generate simplified Lua filters for UI chart
*/}}
{{- define "envoy.lua-filters" -}}
- name: strip-unauthorized-headers
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
    default_source_code:
      inline_string: |
        function envoy_on_request(request_handle)
          -- Strip dangerous headers that should never come from external clients
          request_handle:headers():remove("x-osmo-auth-skip")
          request_handle:headers():remove("x-osmo-user")
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
          if starts_with(request_handle:headers():get(":path") or "", "{{ . }}") then
            skip = true
          end
          {{- end }}
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
{{- end }}

{{/*
Generate OAuth2 filter configuration
*/}}
{{- define "envoy.oauth2-filter" -}}
{{- $oauth := .Values.sidecars.envoy.oauth2Filter -}}
{{- if $oauth.forceReauthOnMissingIdToken }}
- name: envoy.filters.http.lua.validate_idtoken
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
    default_source_code:
      inline_string: |
        -- Check if IdToken looks like a valid JWT structure.
        -- JWT must have exactly 3 base64url parts separated by dots.
        -- We don't decode or check expiration - we rely on cookie Max-Age (300s).
        function is_valid_jwt_structure(token)
          if not token or #token < 50 then
            return false
          end
          local header, payload, sig = token:match("^([A-Za-z0-9_-]+)%.([A-Za-z0-9_-]+)%.([A-Za-z0-9_-]+)$")
          return header ~= nil and payload ~= nil and sig ~= nil
        end

        -- Remove only auth cookies, preserving others (e.g., AWS ALB stickiness cookies)
        function remove_auth_cookies(cookie_header)
          local auth_cookies = {
            ["IdToken"] = true,
            ["BearerToken"] = true,
            ["RefreshToken"] = true,
            ["OauthHMAC"] = true,
          }
          local preserved = {}
          for cookie in string.gmatch(cookie_header, "([^;]+)") do
            cookie = cookie:match("^%s*(.-)%s*$")  -- trim whitespace
            local name = cookie:match("^([^=]+)")
            if name and not auth_cookies[name] then
              table.insert(preserved, cookie)
            end
          end
          if #preserved > 0 then
            return table.concat(preserved, "; ")
          end
          return nil
        end

        -- This filter detects invalid auth state and forces re-authentication.
        -- OAuth2 doesn't return id_token on refresh without scope=openid.
        -- We check BearerToken (7 day lifetime) since OauthHMAC (295s) expires
        -- before IdToken (300s), so we can't rely on OauthHMAC being present.
        function envoy_on_request(request_handle)
          local cookies = request_handle:headers():get("cookie")
          if not cookies then return end

          local has_bearer = cookies:match("BearerToken=[^;]+")
          local idtoken = cookies:match("IdToken=([^;%s]+)")

          -- If BearerToken exists (user was authenticated) but IdToken is missing/malformed
          if has_bearer and not is_valid_jwt_structure(idtoken) then
            request_handle:logInfo("Detected missing/malformed IdToken with valid BearerToken - clearing auth cookies to force re-auth")
            -- Only remove auth cookies, preserve others (AWS ALB stickiness, etc.)
            local remaining = remove_auth_cookies(cookies)
            request_handle:headers():remove("cookie")
            if remaining then
              request_handle:headers():add("cookie", remaining)
            end
          end
        end
{{- end }}
- name: envoy.filters.http.lua.pre_oauth2
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
    default_source_code:
      inline_string: |
        {{- include "envoy.cookie-management-lua" . | nindent 8 }}
- name: oauth2-with-matcher
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
      name: envoy.filters.http.oauth2
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.filters.http.oauth2.v3.OAuth2
        config:
          token_endpoint:
            cluster: oauth
            uri: {{ $oauth.tokenEndpoint }}
            timeout: 3s
          authorization_endpoint: {{ $oauth.authEndpoint }}
          redirect_uri: https://{{ .Values.sidecars.envoy.service.hostname }}/{{ $oauth.redirectPath }}
          redirect_path_matcher:
            path:
              exact: /{{ $oauth.redirectPath }}
          signout_path:
            path:
              exact: /{{ $oauth.logoutPath | default "logout" }}
          forward_bearer_token: true
          credentials:
            client_id: {{ $oauth.clientId }}
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
{{- end }}


{{/*
Generate JWT filter configuration
*/}}
{{- define "envoy.jwt-filter" -}}

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
          {{- range $index, $provider := .Values.sidecars.envoy.jwt.providers }}
          provider_{{ $index }}:
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
              header_name: {{ $.Values.sidecars.envoy.jwt.user_header }}
          {{- end }}
        rules:
        - match:
            prefix: /
          requires:
            requires_any:
              requirements:
              {{- range $index, $provider := .Values.sidecars.envoy.jwt.providers }}
              - provider_name: provider_{{ $index }}
              {{- end }}
{{- end }}

{{/*
Roles and rate limit filters removed for UI chart simplification
*/}}

{{/*
Generate simplified clusters configuration for UI chart
*/}}
{{- define "envoy.clusters" -}}
clusters:
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
- name: service
  connect_timeout: 3s
  type: STRICT_DNS
  dns_lookup_family: V4_ONLY
  lb_policy: ROUND_ROBIN
  load_assignment:
    cluster_name: service
    endpoints:
    - lb_endpoints:
      - endpoint:
          address:
            socket_address:
              address: {{ .Values.sidecars.envoy.service.address }}
              port_value: {{ .Values.sidecars.envoy.service.port }}
{{- end }}

{{/*
Cookie management Lua script - reusable across charts
*/}}
{{- define "envoy.cookie-management-lua" -}}
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

-- Check if a refresh response is missing IdToken
-- Envoy's OAuth2 filter does not include scope in refresh requests.
-- Returns true if BearerToken is present but IdToken is missing or empty.
function is_missing_idtoken_on_refresh(set_cookie_header)
  local has_bearer = false
  local has_valid_idtoken = false

  for cookie in string.gmatch(set_cookie_header, "([^,]+)") do
    -- Check for BearerToken with a non-empty value
    local bearer_value = string.match(cookie, "^%s*BearerToken=([^;]+)")
    if bearer_value and bearer_value ~= "" then
      has_bearer = true
    end
    -- Check for IdToken with a valid JWT value (JWTs are >50 chars)
    local idtoken_value = string.match(cookie, "^%s*IdToken=([^;]+)")
    if idtoken_value and string.len(idtoken_value) > 50 then
      has_valid_idtoken = true
    end
  end

  -- If we got a BearerToken but no valid IdToken, this is a failed refresh
  return has_bearer and not has_valid_idtoken
end

function envoy_on_response(response_handle)
  local hostname = "{{ .Values.sidecars.envoy.service.hostname }}"
  local header = response_handle:headers():get("set-cookie")

  if header ~= nil then
    -- Check if this is a token refresh response missing IdToken.
    -- unless scope=openid is explicitly included (which Envoy doesn't do).
    if is_missing_idtoken_on_refresh(header) then
      response_handle:logInfo("OAuth2 refresh missing IdToken - clearing session to force re-auth")

      -- Clear all auth cookies to force full re-authentication
      response_handle:headers():remove("set-cookie")
      response_handle:headers():add("set-cookie",
        "IdToken=; Max-Age=0; Path=/; Domain=" .. hostname)
      response_handle:headers():add("set-cookie",
        "BearerToken=; Max-Age=0; Path=/; Domain=" .. hostname)
      response_handle:headers():add("set-cookie",
        "RefreshToken=; Max-Age=0; Path=/; Domain=" .. hostname)
      response_handle:headers():add("set-cookie",
        "OauthHMAC=; Max-Age=0; Path=/; Domain=" .. hostname)
      return
    end

    -- Normal cookie processing
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
{{- end }}
