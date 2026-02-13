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

<a id="service-config"></a>

# /api/configs/service

Service config is used to configure the service.

## Top-Level Configuration

| **Field**               | **Type**                   | **Description**                                                                                                | **Default Values**    |
|-------------------------|----------------------------|----------------------------------------------------------------------------------------------------------------|-----------------------|
| `service_base_url`      | String                     | The base URL of the service.                                                                                   | `https://0.0.0.0`     |
| `service_auth`          | [Service Authentication]() | The authentication configuration for the service.                                                              | Default configuration |
| `cli_config`            | [CLI Configuration]()      | The CLI configuration for the service.                                                                         | Default configuration |
| `max_pod_restart_limit` | String                     | The maximum duration allowed for a pod restart. The format must be <integer><unit> (for example, 10m, 1h, 1d). | `30m`                 |
| `agent_queue_size`      | Integer                    | The size of the agent queue used to process messages from the backend listener.                                | `1024`                |

## Service Authentication

| **Field**            | **Type**                              | **Description**                                                                                | **Default Values**          |
|----------------------|---------------------------------------|------------------------------------------------------------------------------------------------|-----------------------------|
| `keys`               | Dict[String, [Authentication Keys]()] | Keys that are used to mint and sign JWT tokens for workflows to communicate with the service.  | Auto-generated RSA key pair |
| `active_key`         | String                                | The active key that is used to mint and sign JWT, referenced by the `keys` field.              | Auto-generated UUID         |
| `issuer`             | String                                | The issuer of the JWT tokens.                                                                  | `osmo`                      |
| `audience`           | String                                | The audience of the JWT tokens.                                                                | `osmo`                      |
| `user_roles`         | Array[String]                         | The roles that are given to the JWT tokens inside a workflow.                                  | `[osmo-user]`               |
| `ctrl_roles`         | Array[String]                         | The roles that are given to the JWT tokens inside osmo-ctrl.                                   | `[osmo-user, osmo-ctrl]`    |
| `login_info`         | [Login Information]()                 | Configuration for users to authenticate with the service via OAuth2.                           | Empty configuration         |
| `max_token_duration` | String                                | The lifetime of the JWT tokens. The format must be <integer><unit> (for example, 10m, 1h, 1d). | `365d`                      |

> **Note**
>
> When minting a new JWT, the private_key of the active_key is used to sign it.
> When checking a JWT to see if it is valid, the service checks if it matches the public_key of ANY key.
> This way, users can do key rotations by adding a new key to the key list and updating the active_key.
> Old JWTs will still work as long as the old key is in the keys array.

## Authentication Keys

| **Field**     | **Type**   | **Description**                                               | **Default Values**   |
|---------------|------------|---------------------------------------------------------------|----------------------|
| `public_key`  | String     | The public key of the key pair, in JSON Web Key (JWK) format. | Auto-generated       |
| `private_key` | String     | The private key of the key pair.                              | Auto-generated       |

An example of a JWK public key:

```json
"{\"e\":\"AQAB\",\"kid\":\"3b7f1b02-6a2d-4c66-9e3e-9f6c1a0a7f84\",\"kty\":\"RSA\",\"n\":\"vKNCk1pR2LrGqf2yA1oV3pTz7f4e9kTtTQyTz7kT1s7c8u6mQv1cG1yqkZB2fN1eY3r3b3q9o4yQw8mR2sEJwTn1yKxZbKp7XoH8jQ3u9mQyWgkZP1eN0s7j5iPz9qYbVYF9yq3uJv2r5sQn0mH2cZx8Uu4v6aY9dP0mT2r5sQn0mH2cZx8Uu4v6aY9dP0mT2r5sQn0mH2cZx8Uu4v6aY9dP0mT2r5sQn0mH2cZx8Uu4v6aY9dP0mT2r5sQn0mH2cZx8Uu4v6aY9dP0mT2r5sQn0mH2cZx8Uu4v6aY9dP0mT2r5sQn0mH2cZx8Uu4v6aY9dP0\"}"
```

> **Note**
>
> This is automatically generated by the service, and admins are not expected
> to generate and set this themselves.

## Login Information

| **Field**           | **Type**   | **Description**                                                                | **Default Values**   |
|---------------------|------------|--------------------------------------------------------------------------------|----------------------|
| `device_endpoint`   | String     | The url to use to completed device flow authentication.                        | `None`               |
| `device_client_id`  | String     | The client id to use when authenticating with the device endpoint.             | `None`               |
| `browser_endpoint`  | String     | The url to use to complete browser flow authentication.                        | `None`               |
| `browser_client_id` | String     | The client id to use when authenticating with the browser endpoint.            | `None`               |
| `token_endpoint`    | String     | The url to use to get a token from device auth, client auth, or refresh token. | `None`               |
| `logout_endpoint`   | String     | The url to use to log out of the service.                                      | `None`               |

## CLI Configuration

| **Field**               | **Type**   | **Description**                                                                                                          | **Default Values**   |
|-------------------------|------------|--------------------------------------------------------------------------------------------------------------------------|----------------------|
| `latest_version`        | String     | The name of the CLI build that will be used fetch the build in cloud storage.                                            | `None`               |
| `min_supported_version` | String     | The minimum supported version of the CLI. Any CLI with a version older than this will require users to update their CLI. | `None`               |
