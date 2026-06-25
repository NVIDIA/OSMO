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

<a id="aws-s3-permissions"></a>

# AWS S3

To handle who can access Datasets, the necessary AWS resources/policies must be created. This includes

- A S3 Bucket
- An IAM Policy
- A User Group

## Setting up the bucket

First, navigate to the [AWS S3 console](https://console.aws.amazon.com:443/s3/home?region=us-west-2)

Click on the `Create Bucket` button.

Here, you can specify the bucket name and region the bucket is located.
Note: The bucket name is globally unique meaning that the name is unique across all of AWS

All the settings can stay default with `ACLs disabled`, `Block all public access`, `Bucket Versioning Disabled`, `SSE-S3 Encryption`, and `Bucket Key Enable`

Click on the `Create Bucket` button to finish bucket creation.

## Configuring IAM Policy

To enforce users to write, delete, or get access on objects, navigate to the [AWS IAM Policy Console](https://us-east-1.console.aws.amazon.com/iamv2/home?region=us-west-2#/policies)

Click on the `Create Policy` button and then the `json` button to edit the policy.
Put the json below into the policy text box.
Replace `bucket-name` with your bucket.

```bash
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3Policy",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:DeleteObject",
        "s3:GetBucketLocation"
      ],
      "Resource": [
        "arn:aws:s3:::bucket-name",
        "arn:aws:s3:::bucket-name/*"
      ]
    },
    {
      "Sid": "IAMPolicy",
      "Effect": "Allow",
      "Action": [
        "iam:SimulatePrincipalPolicy"
      ],
      "Resource": [
        "*"
      ]
    }
  ]
}
```

This policy allows the users to Upload, Download, and Delete objects.
Upload Access requires `s3:PutObject` and `s3:GetObject`.
Download Access requires `s3:GetObject`.
Delete Access requires `s3:DeleteObject`.

To specify a specific path for permissions in the bucket, replace `arn:aws:s3:::bucket-name/*` with the arn for the path.
For example, to reference any objects within a path called `folder1/folder2`, the arn would be `arn:aws:s3:::bucket-name/folder1/folder2/*`

The `IAM_Policy` is used for OSMO data authentication and validation and is required.

Click on the `Next` button and enter the name for this policy.

Lastly, click on the `Create policy` button.

## Creating a User Group

To assign users to the created policy, navigate to the [AWS IAM User Group Console](https://us-east-1.console.aws.amazon.com/iamv2/home?region=us-west-2#/groups)

Click on the `Create group` button and enter the name for this group.

You can assign users to this group now or after the group is created under `Add users to the group`.

Under `Attach permissions policies`, select the policy which was created in the last step.

Click on `Create group`. Any users assigned to this group will inherit the policies defined.

## Construct URI

URIs are constructed as follows with examples for bucket name `my_bucket`:

```bash
s3://<bucket>

# Example
s3://my_bucket
```

Follow [Configure Data Storage](../../configure_data.md#configure-data) to add the bucket to OSMO.
