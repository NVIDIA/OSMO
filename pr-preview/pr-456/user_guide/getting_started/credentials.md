<!-- SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

<a id="credentials"></a>

# Setup Credentials

Credentials are secrets required to run workflows or perform data operations in OSMO.

OSMO supports the following types of credentials:

* [Registry](#credentials-registry) - for accessing private container registries where Docker images are stored
* [Data](#credentials-data) - for accessing data storage solutions to read/write data in your workflows
* [Generic](#credentials-generic) - for storing and dereferencing generic key value pairs in the workflows

<a id="credentials-registry"></a>

## Registry

> **Hint**
>
> If you are using **public** container registries, you can skip this step.

> **Important**
>
> If you are using a private container registry, you are **required** to
> set up registry credentials in order to pull container images for your workflows.

### NVIDIA GPU Cloud (NGC)

### What is NGC?

[NVIDIA GPU Cloud](https://catalog.ngc.nvidia.com) (NGC) is an online catalog of GPU accelerated
cloud applications (docker containers, helm charts, and models). It also provides **private
registries** for teams to upload their own docker containers.

Please refer to [https://org.ngc.nvidia.com/setup/api-keys](https://org.ngc.nvidia.com/setup/api-keys) to generate a personal
API Key. Ensure that while creating the key, in `Services Included*` drop down,
select `Private Registry`.

> **Important**
>
> Please make sure to save your API key to a file, it will never be displayed to you
> again. If you lose your API key, you can always generate a new one, but the old one will
> be invalidated, and applications will have to be re-authenticated.

To setup a registry credential for NGC, run the following command with your NGC API key:

```bash
$ osmo credential set my-ngc-cred \
        --type REGISTRY \
        --payload registry=nvcr.io \
        username='$oauthtoken' \
        auth=<ngc_api_key>
```

### Docker Hub

Authenticated access to [Docker Hub](https://hub.docker.com/) is supported.

#### SEE ALSO
Please refer to [Docker Documentation](https://docs.docker.com/) for more information
on username/password and Access Token authentication.

To setup a registry credential for Docker Hub, run the following command:

```bash
$ osmo credential set my-docker-hub-cred \
        --type REGISTRY \
        --payload registry=docker.io \
        username=<docker_hub_username> \
        auth=<docker_hub_password or PAT>
```

### Github

Authenticated access to [Github Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) is supported.

#### SEE ALSO
Please refer to [Github Documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
for more information on registry authentication.

To setup a registry credential for GHCR, run the following command:

```bash
$ osmo credential set my-ghcr-cred \
        --type REGISTRY \
        --payload registry=ghcr.io \
        username=<github_username> \
        auth=<github_token>
```

### Gitlab

Authenticated access to [Gitlab Container Registry](https://docs.gitlab.com/user/packages/container_registry/) is supported.

#### SEE ALSO
Please refer to [Gitlab Documentation](https://docs.gitlab.com/user/packages/container_registry/authenticate_with_container_registry/)
for more information on registry authentication.

To setup a registry credential for Gitlab, run the following command:

```bash
$ osmo credential set my-gitlab-cred \
        --type REGISTRY \
        --payload registry=<gitlab_registry_url> \
        username=<gitlab_username> \
        auth=<gitlab_password_or_token>
```

<a id="credentials-data"></a>

## Data

OSMO integrates with the following data storage solutions:

* [S3-Compatible Storage](https://aws.amazon.com/s3) (AWS S3, MinIO, LocalStack, and any S3 API-compatible services)
* [GCP Google Storage](https://cloud.google.com/storage/docs/buckets)
* [Azure Blob Storage](https://azure.microsoft.com/en-us/products/storage/blobs)
* [Torch Object Storage](https://docs.byteplus.com/en/docs/tos)

To access your data storage within workflows, you’ll need to set the appropriate credentials.

> **Important**
>
> For assistance with **creating credentials** for your data storage provider, please
> contact your OSMO administrator.

### AWS S3 / S3-Compatible

To set a credential for S3 or S3-compatible storage, run the following command:

```bash
$ osmo credential set my-s3-cred \
    --type DATA \
    --payload \
    endpoint=s3://<bucket> \
    region=<region> \
    access_key_id=<access_key_id> \
    access_key=<access_key> \
    override_url=<http_endpoint>  # Optional: required for non-AWS S3
```

> **Note**
>
> `override_url` is only required for non-AWS S3-compatible services such as MinIO, Ceph,
> and LocalStack. It specifies the HTTP endpoint of the service (e.g., `http://minio:9000`).
> Omit it for standard AWS S3.

#### SEE ALSO
Please refer to [AWS Access Key Documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-key-self-managed.html)
for additional information on managing AWS access keys.

### GCP Cloud Storage

To set a credential for GCP Cloud Storage (GCS), run the following command:

```bash
$ osmo credential set my-gcs-cred \
    --type DATA \
    --payload \
    endpoint=gs://<bucket> \
    region=<region> \
    access_key_id=<access_key_id> \
    access_key=<access_key> \
```

**Field Mappings:**

> - `access_key_id` → **Access Key** in GCP
> - `access_key` → **Secret** in GCP

#### SEE ALSO
Please refer to [GCS HMAC Keys Documentation](https://docs.cloud.google.com/storage/docs/authentication/managing-hmackeys#console)
for additional information on managing **interoperable** access keys.

### Azure Blob Storage

To set a credential for Azure Blob Storage, run the following command:

```bash
$ osmo credential set my-azure-cred \
    --type DATA \
    --payload \
    endpoint=azure://<storage-account>/<container> \
    region=<region> \
    access_key_id=<access_key_id> \
    access_key=<access_key>
```

**Field Mappings:**

> - `access_key` → **Connection String** in Azure
> - `access_key_id` → can be **ANY** string value (e.g. `<storage-account>` or `<username>`)
> - `region` → **OPTIONAL** (defaults to `eastus`)

#### SEE ALSO
Please refer to [Azure Storage Connection String Documentation](https://learn.microsoft.com/en-us/azure/storage/common/storage-configure-connection-string)
for additional information on managing Azure Storage Connection Strings.

### Torch Object Storage

To set a credential for Torch Object Storage, run the following command:

```bash
$ osmo credential set my-tos-cred \
    --type DATA \
    --payload \
    endpoint=tos://<endpoint>/<bucket> \
    region=<region> \
    access_key_id=<access_key_id> \
    access_key=<access_key>
```

**Field Mappings:**

> - `access_key_id` → **Access Key ID (AK)** in TOS
> - `access_key` → **Secret Access Key (SK)** in TOS
> - `region` → **Region** in TOS (e.g. `cn-beijing`, `cn-shanghai`, etc.)

#### SEE ALSO
Please refer to [TOS Access Keys Documentation](https://docs.byteplus.com/en/docs/byteplus-platform/docs-creating-an-accesskey)
for additional information on managing access keys.

<a id="credentials-generic"></a>

## Generic Secrets

Any other secrets unrelated to registry and data can be stored as generic credentials (`type=GENERIC`).

For example, to access the Omniverse Nucleus server:

```bash
$ osmo credential set omni-auth \
      --type GENERIC \
      --payload omni_user='$omni-api-token' \
      omni_pass=<token>
```

Another example is to access Weights and Biases (W&B) for logging and tracking your experiments:

```bash
$ osmo credential set wb-auth \
      --type GENERIC \
      --payload wb_api_key=<api_key>
```

#### SEE ALSO
Your registry and data credentials are picked up automatically when you submit a workflow.
To specify a generic credential in the workflow, refer to [Secrets](../workflows/specification/secrets.md#workflow-spec-secrets).

<a id="access-tokens"></a>

## Access Tokens

Access Tokens (PATs) provide a way to authenticate with OSMO programmatically,
enabling integration with CI/CD pipelines, scripts, and automation tools.

### Overview

PATs are tied to your user account and inherit your roles at creation time. When you create
a PAT, it receives either all of your current roles or a subset that you specify.

> **Important**
>
> - PAT roles are immutable after creation. To change a token’s roles, delete the token and create a new one.
> - When a role is removed from your user account, it is automatically removed from all your PATs.
> - Store your PAT securely—it is only displayed once at creation time.

### Creating a Access Token

#### Using the CLI

1. First, log in to OSMO:
   ```bash
   $ osmo login https://osmo.example.com
   ```
2. Create a new token with an expiration date:
   ```bash
   $ osmo token set my-token --expires-at 2027-01-01 --description "My automation token"
   ```

   The token will be displayed once. Save it securely.

   **Example output:**
   ```text
   Note: Save the token in a secure location as it will not be shown again
   Access token: osmo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

   **Specifying Roles:**

   By default, a PAT inherits all of your current roles. You can limit the token to specific
   roles using the `--roles` (or `-r`) option:
   ```bash
   $ osmo token set my-token --expires-at 2027-01-01 -r osmo-user -r osmo-ml-team
   ```

   This creates a token with only the `osmo-user` and `osmo-ml-team` roles, even if you
   have additional roles assigned. You can only assign roles that you currently have.
3. (Optional) Verify the token was created and check its roles:
   ```bash
   $ osmo token list
   ```

### Using a Access Token

Once you have a PAT, you can use it to authenticate with OSMO.

#### CLI Authentication

Log in using the token method:

```bash
$ osmo login https://osmo.example.com --method=token --token=osmo_xxxxxxxxxx
```

After logging in, all subsequent CLI commands will use this authentication:

```bash
$ osmo workflow list
$ osmo workflow submit my-workflow.yaml
```

Alternatively, you can store the token in a file and reference it:

```bash
# Store token in a file (ensure proper file permissions)
$ echo "osmo_xxxxxxxxxx" > ~/.osmo-token
$ chmod 600 ~/.osmo-token

# Login using the token file
$ osmo login https://osmo.example.com --method=token --token-file=~/.osmo-token
```

> **Note**
>
> The `--method=token` login exchanges your PAT for a short-lived JWT that is used
> for subsequent API calls. This JWT is automatically refreshed as needed.

### Best Practices

Set Appropriate Expiration

Always set an expiration date appropriate for your use case. For CI/CD pipelines,
consider shorter expiration periods and rotate tokens regularly.

Use Descriptive Names

Use descriptive token names and descriptions to help identify their purpose
(e.g., `ci-github-actions`, `jenkins-prod-pipeline`).

Secure Storage

Store tokens in secure secret management systems like HashiCorp Vault,
AWS Secrets Manager, or Kubernetes Secrets.

Rotate Regularly

Periodically rotate tokens by creating a new token and deleting the old one.
This limits the impact of potential token compromise.

<a id="credentials-cli"></a>

## CLI Reference

#### SEE ALSO
- See [osmo credential](../appendix/cli/cli_credential.md#cli-reference-credential) for the full CLI reference for `osmo credential`.
- See [osmo token](../appendix/cli/cli_token.md#cli-reference-token) for the full CLI reference for `osmo token`.
