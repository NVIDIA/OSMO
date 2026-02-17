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

<a id="workflow-spec-secrets"></a>

# Secrets

Your registry credentials for pulling images and data credentials for downloading/uploading data are
automatically applied when the workflow is submitted.

However, you can also submit other generic credentials and securely dereference them inside the
workflow as environment variables or mount them as a secret file with a specific path:

```yaml
workflow:
  name: use-generic-creds
  tasks:
  - name: task_generic_creds_usage
    image: ubuntu
    command: ['bash']
    credentials:
      omni_cred:
        OMNI_USER: omni_user # (1)
        OMNI_PASS: omni_pass # (2)
      aws_keys: /root/.osmo  # (3)
```

1. The environment variable `OMNI_USER` to the value of `omni_user` from credential `omni_cred` in the container.
2. The environment variable `OMNI_PASS` to the value of `omni_pass` from credential `omni_cred` in the container.
3. `aws_keys` is mapped as a file mounted to the path `/root/.osmo` in the task.

These `credentials` are a list of credential names that are configured using
[Generic Secrets](../../getting_started/credentials.md#credentials-generic).

> **Note**
>
> Credentials are MASKED in the workflow logs and error logs if they are **8** characters or more.
> Do **NOT** use **8** characters or less for credentials or they can be subject to being leaked.
