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

<a id="troubleshooting"></a>

# Troubleshooting

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

<a id="troubleshooting-credentials"></a>

## Credentials

Below are some common errors you might run into when using the credential CLI. Please follow the
suggested steps to troubleshoot. Please also refer to [Setup Credentials](../getting_started/credentials.md#credentials) for more information

### Could not connect to the endpoint URL

```bash
client [ERROR] common: Server responded with status code 400
Data validation failed with error: Could not connect to the endpoint URL: "{your_data_endpoint_url}"
```

Please confirm if the data endpoint URL is valid

### Extra fields not permitted

```bash
client [ERROR] common: Server responded with status code 422
{'detail': [{'loc': ['body', 'xxxx_credential', 'xxx'], 'msg': 'extra fields not permitted', 'type': 'value_error.extra'}]}
```

Please make sure you don’t provide extra field when setting credentials with payload. The
tabulated information illustrates the keys that are compulsory and those that are optional
for the payload corresponding to each type of credential.

### SignatureDoesNotMatch

```bash
client [ERROR] common: Server responded with status code 400
Data validation failed with error: An error occurred (SignatureDoesNotMatch) when calling the ListBuckets operation: The request signature we calculated does not match the signature you provided. Check your key and signing method.
```

Please check if you access_key_id and access_key are valid.

### AuthorizationHeaderMalformed

```bash
client [ERROR] common: Server responded with status code 400
Data validation failed with error: An error occurred (AuthorizationHeaderMalformed) when calling the ListBuckets operation: The authorization header is malformed; the region 'us-east-3' is wrong; expecting 'us-east-1'
```

Please correct the region based on the suggestion.

### Max retries exceeded with url

```bash
client [ERROR] common: Server responded with status code 400
Registry connection error for https://your_registry/v2/:
HTTPSConnectionPool(host='your_registry', port=443): Max retries exceeded with url: /v2/ (Caused by NewConnectionError('<urllib3.connection.HTTPSConnection object at 0x7fe07c119e40>: Failed to establish a new connection: [Errno -2] Name or service not known'))
```

Please check if your registry is valid.

### Registry authentication failed

```bash
client [ERROR] common: Server responded with status code 400
Registry authentication failed.
```

Please check if you registry username and auth is valid.

### Duplicate key value

```bash
client [ERROR] common: Server responded with status code 400
{'message': ' duplicate key value violates unique constraint "credential_pkey"\nDETAIL:  Key (user_name, cred_name)=(your_user_name, your_cred_name) already exists.\n', 'error_code': 'USER'}
```

Please rename your credential or delete it with `$ osmo credential delete <your_cred_name>`
and then reset it.

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

<a id="troubleshooting-dataset"></a>

## Dataset

Below are some common errors you might run into when using the dataset CLI. Please follow the
suggested steps to troubleshoot. Please also refer to [Data](../getting_started/credentials.md#credentials-data) or
[Working with Data](../tutorials/data/index.md#tutorials-working-with-data) for more information.

### Validation error

```bash
Data upload failed with error:

Data key validation error: access_key_id <> not valid for <>
Data key validation error: access_key_id has no read access for <>
Data key validation error: access_key_id has no write access for <>
```

Please confirm if the `access_key_id` set for your data credentials is the same as the Shared
Storage S3 ACL Access User found at [Data](../getting_started/credentials.md#credentials-data)
If the access_key_id does not have the correct permissions, ask an admin for permission.

### No default bucket

```bash
No default bucket set. Specify default bucket using the "osmo profile set" CLI.
```

Please set a default bucket as specified at [Data](../getting_started/credentials.md#credentials-data)

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

<a id="troubleshooting-resources"></a>

## Resources

Please make change to the workflow resource specs based on the detailed error message. Please
also refer [Overview](../resource_pools/index.md#concepts-resources-pools-platforms) to make sure your resource spec is correct. Set the labels,
cpu/gpu, memory, storage based on the current pool/platform availability `osmo resource list`

Some common errors are listed below:

### Too high for label memory

```bash
Resource memory error
E.g. Value "1000000" too high for label memory
```

Please check the available memory and set it correctly.

### Too high for label cpu

```bash
Resource cpu/gpu error
E.g. Value "1000000" too high for label cpu
```

Please check the available cpu and set it correctly.

### Too high for label storage

```bash
Resource storage error
E.g. Value "1000000" too high for label storage
```

Please check the available storage and set it correctly.

### Does not allow mount

```bash
Mount error:
E.g. Mount /bad_mount not allowed for selected platform dgx-h100
```

If you need specific host mounts, reach out to admin to update the platform configs.

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

<a id="troubleshooting-workflow"></a>

## Workflow

When a workflow fails, refer to [query](../appendix/cli/cli_workflow.md#cli_reference_workflow_query) to gain an overview of the workflow tasks
statuses on which pods failed as well as their failure messages. Refer to [Status Reference](../workflows/lifecycle/index.md#workflow-lifecycle-status)
that contains more information regarding different workflow statuses.

Use [logs](../appendix/cli/cli_workflow.md#cli_reference_workflow_logs) for a better insight of what happened during the workflow runtime.

<a id="troubleshooting-137-error-code"></a>

### 137 Error Code

When a task exits with exit code `137`, it usually signifies that your task was killed due to
using too much memory.

A user can confirm this if the admins have setup a Grafana Dashboard for detailed
workflow usage information. To see the dashboard, users can click on the `Resource Usage` button
in the UI on the detailed workflow information page.

To resolve the memory issue, users can try increasing the amount of memory requested or lower
the memory usage within the task. To learn more about workflow resources, refer to
[Overview](../resource_pools/index.md#concepts-resources-pools-platforms).
