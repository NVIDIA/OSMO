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

<a id="tos-permissions"></a>

# Torch Object Storage

To handle who can access Datasets, the necessary IAM resources/policies must be created.
This includes

- A TOS Bucket
- An IAM Policy
- Linking Users to Bucket with a IAM Policy

## Setting up the bucket

For instructions on creating TOS Buckets for Volce Engine, go to
[TOS Bucket](https://console.volcengine.com/tos/bucket) and create a bucket.

## Create IAM Policy

Go to the [IAM Policy Management page](https://console.volcengine.com/iam/policymanage)
and create a custom policy.

Select the `JSON Editor` tab and enter the information below. Remember to replace
`bucket_name` with the created bucket name from above:

```bash
{
  "Statement": [
      {
          "Effect": "Allow",
          "Action": [
              "tos:PutObject",
              "tos:GetObject",
              "tos:ListBucket",
              "tos:DeleteObject",
              "tos:GetBucketLocation"
          ],
          "Resource": [
              "trn:tos:::<bucket_name>",
              "trn:tos:::<bucket_name>/*"
          ]
      }
  ]
}
```

## Link User and Bucket with IAM Policy Permissions

Once the IAM Policy is created, you can add any created user or user groups to this policy.

To do so, go to the [IAM Policy Management page](https://console.volcengine.com/iam/policymanage)
and select the created IAM Policy from the previous step.

Select the authorization tab and select the desired users and groups.

## Construct URI

URIs are constructed as follows with examples for bucket name `my_bucket` and
endpoint `tos-s3-region.my_endpoint.com`:

```bash
tos://<endpoint><bucket>

# Example
tos://tos-s3-region.my_endpoint.com/my_bucket
```

Follow [Configure Data Storage](../../configure_data.md#configure-data) to add the bucket to OSMO.

> **Note**
>
> The endpoint chosen should be the s3 endpoint which starts with `toc-s3`.
