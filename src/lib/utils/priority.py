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

import enum


class WorkflowPriority(str, enum.Enum):
    """Scheduling priority for workflows"""
    HIGH = 'HIGH'
    NORMAL = 'NORMAL'
    LOW = 'LOW'

    @property
    def preemptible(self) -> bool:
        """Whether the priority is preemptible"""
        return self == WorkflowPriority.LOW
