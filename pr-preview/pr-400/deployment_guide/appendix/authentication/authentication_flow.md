<!-- SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0 -->

<a id="authentication-flow-with-keycloak"></a>

<a id="authentication-flow"></a>

# Authentication Flow

This guide describes the detailed authentication flow in the OSMO platform.

## Architecture Components

The authentication system consists of the following components:

1. **User**: The end-user or entity accessing the OSMO platform. To use OSMO, the user must first acquire a signed JWT with roles and username claims (From Keycloak or from OSMO itself in the case of service accounts). Then it can make a request to OSMO using the JWT.
2. **Keycloak**: Stores mapping between users and groups and between groups and roles. It can be used to handle user authentication directly, or as an intermediary between users and external identity providers.
3. **Identity Provider (IdP)**: Optional external authentication service (e.g., Microsoft Azure AD, etc.) that verifies user identity
4. **Envoy**: API gateway that ensures requests to OSMO are authenticated with a properly signed and validated JWT. All requests to OSMO must pass through the following two internal components (or filters) of Envoy:
   - **OAuth2 Filter**: Redirects the user to Keycloak’s authentication endpoint if the user is not authenticated (Missing or invalid `OAuthHMAC` cookie or `x-osmo-auth` header is not present).
   - **JWT Filter**: Validates JWT token (provided either through the `IdToken` cookie or the `x-osmo-auth` header)
5. **OSMO Service**: Backend services providing platform functionality. They evaluate the roles provided in the JWT and determine if the user has access to the requested resource.

## User Login with Keycloak

For a human user, logging in is done through a web browser using Keycloak.

### Overview

The below diagram illustrates the high level flow for a human user logging into OSMO.

![Authentication and Authorization flow](deployment_guide/appendix/authentication/authn_authz_arch_user.png)

The flow contains the following steps:

1. **Login:** A user logs in with Keycloak. Keycloak supports multiple OAuth 2.0 flows such as device flow, and code flow. Keycloak may be configured to accept username and password directly, or redirect to an external identity provider.
2. **Lookup roles:** Keycloak looks up what roles a user has based on their group memberships. The roles from all groups are aggregated into a single list of roles.
3. **Grant JWT:** Keycloak issues a JWT token containing the user’s username (in the `preferred_username` claim) and roles (in the `roles` claim).
4. **Make request with JWT:** The user makes a request to OSMO using the JWT token in the `IdToken` cookie (For the Web UI accessed through a browser) or `x-osmo-auth` header (For the CLI client).
5. **Validate and unpack JWT:** Envoy validates the JWT token (Correct signature, not expired, correct `aud` and `iss` claims). It then unpacks the `roles` claim into a comma separated list in the `x-osmo-roles` header and the `preferred_username` claim into the `x-osmo-user` header.
6. **Make request with headers:** Envoy then forwards the request to the OSMO service with the `x-osmo-user` and `x-osmo-roles` headers set.
7. **Check request is allowed by roles:** The OSMO service checks the definitions of the roles in its database, and compares with the request the user is trying to perform. If none of the roles provided allow the request, then OSMO will return a `403 Forbidden` error.
8. **Handle request:** The OSMO service will now handle the request and return the response to the user.

> **Warning**
>
> The OSMO service accepts the `x-osmo-user` and `x-osmo-roles` headers sent to it and does not validate the JWT.
> To use OSMO securely, be sure to only allow access to the OSMO service through Envoy or some other reverse proxy that does the following:

> - Validates the authenticity of the JWT passed to it.
> - Strips `x-osmo-user` and `x-osmo-roles` headers from the downstream request.
> - Sets the `x-osmo-user` and `x-osmo-roles` headers in the upstream request from the contents of the JWT.

### Initialization

1. During system initialization, Envoy retrieves public keys from Keycloak by making a request to `GET <keycloak>/realms/osmo/protocol/openid-connect/certs`
2. Keycloak returns the public keys (HTTP 200) used to verify JWT token signatures

### Browser Based Login

Users attempting to access OSMO through the Web UI will go through the browser based login flow.

#### Logging In

1. The user attempts to access the OSMO web UI, or an OSMO API resources (e.g., `GET <osmo>/api/workflows`)
2. The OAuth2 Filter in Envoy checks for authentication credentials and determines that:
   - No `OAuthHMAC` cookie is present
   - No `x-osmo-auth` header is present
3. Since the user is not authenticated, the OAuth2 Filter initiates the OAuth 2.0 Authorization Code flow ([RFC 6749 Section 4.1](https://datatracker.ietf.org/doc/html/rfc6749#section-4.1)).
   In the OAuth 2.0 flow, Envoy acts as the client, Keycloak acts as the authorization server, and the user’s web browser acts as the user agent.
   1. Envoy returns a redirect (HTTP 302) to Keycloak’s authentication endpoint: `GET <keycloak>/realms/osmo/protocol/openid-connect/auth`.
   2. The user authenticates with Keycloak. The user may authenticate directly with Keycloak using a username and password, or Keycloak may be configured to delegate authentication with the OAuth 2.0 Authorization Code flow to an external identity provider.
   3. Keycloak redirects the user back to Envoy with a Keycloak authorization code (HTTP 302 to `<osmo>/api/auth/getAToken?code=<keycloak-code>`).
   4. Envoy exchanges the Keycloak authorization code for a JWT token by requesting from Keycloak (`GET <keycloak>/realms/osmo/protocol/openid-connect/token?code=<keycloak-code>&...&grant_type=authorization_code`).
   5. Keycloak generates JWT tokens with user roles based on the user’s group memberships and returns them to the OSMO service, as well as a refresh token (HTTP 200).
   6. Envoy finally redirects the user back to the original request (e.g., `GET <osmo>/api/workflows`) with the following cookies set:
      - **OAuthHMAC**: A hash-based message authentication code for session identification
      - **BearerToken**: The access token for API requests
      - **IdToken**: Contains user identity information (username, roles, etc.). This is the JWT token validated by the JWT filter and whose roles are extracted and passed to the OSMO Service.
      - **RefreshToken**: Used to obtain new tokens when the current ones expire

#### Authenticated Requests

After logging in, all subsequent requests to OSMO will include the `OAuthHMAC` cookie (So they will not go back through the OAuth 2.0 Authorization Code flow again). They contain a valid `IdToken`, so they will pass the JWT filter as well.

#### Using Refresh Tokens

Eventually, the `IdToken` and `BearerToken` will expire. When the user makes a request after these tokens expire, the OAuth2 filter will attempt to automatically use the refresh token as described in [RFC 6749 Section 6](https://datatracker.ietf.org/doc/html/rfc6749#section-6).

1. Envoy will call Keycloak’s token endpoint to get a new access token and id token `POST <keycloak>/realms/osmo/protocol/openid-connect/token?grant_type=refresh_token&refresh_token=<refresh_token>&...`
2. Envoy will include these new tokens as cookies as the request passes through the JWT filter and on to the OSMO Service.
3. When envoy returns the response, it will include `Set-Cookie` headers for the new tokens so they will be used in subsequent requests.

### CLI Based Login

Users attempting to access OSMO through the CLI will go through the CLI based login flow.

#### Logging In

1. The user runs the `osmo login https://<osmo>` command. The OSMO CLI calls the `GET <osmo>/api/auth/login` endpoint to get the endpoint that will be used for device authorization login.
2. The OSMO CLI client will initiate the OAuth 2.0 Device Authorization flow as specified in [RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628).
   In the OAuth 2.0 flow, Keycloak acts as the authorization server, and the OSMO CLI acts as the device client.
   1. The OSMO CLI will call Keycloak’s device authorization endpoint to get a device code and user code `POST <keycloak>/realms/osmo/protocol/openid-connect/auth/device`
   2. Keycloak returns a device code, user code, and verification URL to the OSMO CLI.
   3. The OSMO CLI will display the user code and Keycloak URL to the user to visit to complete the authentication.
   4. The user visits the Keycloak verification URL (e.g. `<keycloak>/realms/osmo/device?user_code=<user-code>`) and completes authentication.
   5. The OSMO CLI continuously polls keycloak using the device code to check if authentication is complete.
   6. Once authentication is complete, Keycloak will return an access token, id token and refresh token to the OSMO CLI.

#### Authenticated Requests

The OSMO CLI client will now include the id token in the `x-osmo-auth` header for all requests to the OSMO service.

#### Using Refresh Tokens

Eventually, the `IdToken` will expire. When the user attempts the use the CLI, the CLI will check if the id token is expired. If it is, the CLI will use the refresh token as described in [RFC 6749 Section 6](https://datatracker.ietf.org/doc/html/rfc6749#section-6) to get a new id token before making the request.

## Token Based Login Directly through OSMO

For a service account or script, logging in through Keycloak is cumbersome due to the usage of a web browser in the auth flow. For use cases like this,
OSMO allows the creation of tokens that can be exchanged for a JWT that is signed by OSMO.

### Overview

The below diagram illustrates the high level flow for a service account or script logging into OSMO.

![Authentication and Authorization flow](deployment_guide/appendix/authentication/authn_authz_arch_token.png)

The flow contains the following steps:

1. **Use token to get JWT:** The script uses the token (With either the `/api/auth/jwt/access_token` or `/api/auth/jwt/refresh_token` endpoints depending on the token type)
   to request a signed JWT token from OSMO. Envoy will allow requests to these endpoints to proceed without authentication.
2. **Validate token, lookup roles:** OSMO will validate that the token is valid and not expired and will lookup the roles corresponding to the token.
3. **Grant JWT:** OSMO will generate a JWT token containing the roles and username corresponding to the name of the token.
4. **Make request with JWT:** The user makes a request to OSMO using the JWT token in the `IdToken` cookie (For the Web UI accessed through a browser) or `x-osmo-auth` header (For the CLI client).
5. **Validate and unpack JWT:** Envoy validates the JWT token (Correct signature, not expired, correct `aud` and `iss` claims). It then unpacks the `roles` claim into a comma separated list in the `x-osmo-roles` header and the `preferred_username` claim into the `x-osmo-user` header.
6. **Make request with headers:** Envoy then forwards the request to the OSMO service with the `x-osmo-user` and `x-osmo-roles` headers set.
7. **Check request is allowed by roles:** The OSMO service checks the definitions of the roles in its database, and compares with the request the user is trying to perform. If none of the roles provided allow the request, then OSMO will return a `403 Forbidden` error.
8. **Handle request:** The OSMO service will now handle the request and return the response to the user.

### Initialization

1. During system initialization, the OSMO service will generate a public/private key pair for signing/validating tokens if one is not already present (See [/api/configs/service](../../references/configs_definitions/service.md#service-config) for more information).
2. Envoy will request the public key from the OSMO service by making a request to `GET <osmo>/api/auth/jwt/public_key`
3. OSMO will return the public key (HTTP 200) used to verify JWT token signatures

### Logging In

When token based login is used, the CLI or other service will use the `/api/auth/jwt/access_token` or `/api/auth/jwt/refresh_token` endpoints to get a JWT token.

- Tokens created through the `osmo token` API will use the `/api/auth/jwt/access_token` endpoint.
- Running workflows that need to log in to OSMO to push logs will use the `/api/auth/jwt/refresh_token` endpoint.

### Authenticated Requests

Authenticated requests will include the returned JWT token in the `x-osmo-auth` header. This JWT token will be signed by OSMO rather than Keycloak, so
Envoy’s JWT filter must be configured to recognize OSMO’s public key as well as the Keycloak public key.

If the JWT token is expired or will expire soon, the CLI or workflow will request a new one using the same `/api/auth/jwt/access_token` or `/api/auth/jwt/refresh_token` endpoint.

## Token Validation and Authorization

The JWT filter will look for a JWT either in the `IdToken` cookie or the `x-osmo-auth` header.

The JWT Filter performs the following validations on each request:

1. **Signature Verification**: Ensures the token was issued by Keycloak or by OSMO using the public keys obtained during initialization
2. **Expiration Check**: Verifies that the token has not expired (`exp` claim is in the past)
3. **Claim Validation**: Validates essential claims such as:
   - `iss` (Issuer): Must match the expected Keycloak realm URL
   - `aud` (Audience): Must include the OSMO client ID
   - `sub` (Subject): Identifies the user

Below is an example of a JWT token payload used in the authentication flow:

```json
{
  "exp": 1741819596,
  "iat": 1741819296,
  "jti": "4273aa49-bb31-420a-936a-54238388619f",
  "iss": "https://<your-keycloak-domain>/realms/osmo",
  "aud": "osmo-browser-flow",
  "sub": "<user-id>",
  "typ": "ID",
  "azp": "osmo-browser-flow",
  "sid": "<session-id>",
  "at_hash": "<hash>",
  "roles": [
    "osmo-admin",
    "dashboard-user",
    "osmo-user",
    "grafana-user",
    "dashboard-admin",
    "osmo-sre",
    "grafana-admin"
  ],
  "name": "<user-name>",
  "preferred_username": "<user-email>",
  "given_name": "<user-first-name>",
  "family_name": "<user-last-name>"
}
```

Envoy will then extract the `roles` claim and set the `x-osmo-roles` header to a comma separated list of the roles. It will also extract the `preferred_username` claim and set the `x-osmo-user` header to the username.

<a id="authentication-flow-sso"></a>

## Advanced Keycloak Configuration

Keycloak can be configured to allow users to log in directly with a username and password.

Keycloak can also be configured to integrate with an external identity provider (such as Azure AD, Google Workspace, and others) for improved integration with your organization’s authentication systems. For more information on integrating external identity providers with Keycloak, refer to the [Keycloak documentation](https://www.keycloak.org/docs/latest/server_admin/index.html#_identity_broker).

## Troubleshooting

### Common Authentication Issues

**User Cannot Log In**
: - Verify identity provider configuration
  - Check identity provider logs for authentication errors
  - Ensure the user has the necessary permissions in the identity provider

**Missing Group Memberships**
: - Verify identity provider mapper configuration
  - Check that the expected claims are present in the identity provider token
  - Review Keycloak logs for mapping errors

**Token Validation Failures**
: - Ensure Keycloak’s public key is correctly configured in OSMO services
  - Check for clock skew between services
  - Verify token signature algorithm matches the expected algorithm

#### SEE ALSO
- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [Keycloak Group and Role Management](keycloak_setup.md) for configuring Keycloak roles and groups
- [Roles and Policies](roles_policies.md) for understanding OSMO roles and policies
