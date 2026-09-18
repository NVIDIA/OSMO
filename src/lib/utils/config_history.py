"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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

import enum


class ConfigHistoryType(enum.Enum):
    """ Type of configs supported by config history """
    DATASET = 'DATASET'
    SERVICE = 'SERVICE'
    WORKFLOW = 'WORKFLOW'
    BACKEND = 'BACKEND'
    POOL = 'POOL'
    POD_TEMPLATE = 'POD_TEMPLATE'
    GROUP_TEMPLATE = 'GROUP_TEMPLATE'
    RESOURCE_VALIDATION = 'RESOURCE_VALIDATION'
    BACKEND_TEST = 'BACKEND_TEST'
    ROLE = 'ROLE'
