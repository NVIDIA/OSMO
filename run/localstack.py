#!/usr/bin/env python3
"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

# Endpoint URLs
LOCALSTACK_S3_ENDPOINT_KIND = 'http://localstack-s3.osmo.svc.cluster.local:4566'
LOCALSTACK_S3_ENDPOINT_BAZEL = 'http://localstack:4566'
LOCALSTACK_S3_ENDPOINT_BAZEL_HOST = 'http://localhost:4566'

# AWS Configuration
LOCALSTACK_REGION = 'us-east-1'
LOCALSTACK_ACCESS_KEY_ID = 'test'
LOCALSTACK_SECRET_ACCESS_KEY = 'test'
LOCALSTACK_FORCE_PATH_STYLE = 'true'
