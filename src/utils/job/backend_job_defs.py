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

from typing import Any, Dict, List, Optional

import pydantic

class BackendCreateGroupMixin(pydantic.BaseModel):
    """
    Submit task job contains the id of a task that is to be submitted.
    When executed, it should do the following:
    - Read the definition of the task from the database from the task_id.
    - Create the resources in kubernetes needed to start the task.
    """
    group_name: str
    k8s_resources: List[Dict]
    backend_k8s_timeout: int = 60
    scheduler_settings: Dict[str, Any] = {}


class BackendCustomApi(pydantic.BaseModel):
    api_major: str
    api_minor: str
    path: str


class BackendCleanupSpec(pydantic.BaseModel):
    resource_type: str
    labels: Dict[str, str]
    custom_api: Optional[BackendCustomApi]

    @property
    def k8s_selector(self) -> str:
        return ','.join(f'{key}={value}' for key, value in self.labels.items())


class BackendCleanupGroupMixin(pydantic.BaseModel):
    """
    Submit task job contains the id of a task that is to be submitted.
    When executed, it should do the following:
    - Read the definition of the task from the database from the task_id.
    - Create the resources in kubernetes needed to start the task.
    """
    # The list of objects to be deleted
    cleanup_specs: List[BackendCleanupSpec]
    # The name of the pod to fetch error logs from, if any
    error_log_spec: Optional[BackendCleanupSpec] = None
    # The task to create a Backend Job for
    group_name: str
    # Whether to force deleting from kubernetes
    force_delete: bool = False
    # Max error logs per container
    max_log_lines: int


class BackendSynchronizeQueuesMixin(pydantic.BaseModel):
    """
    Reconciles the queues in the backend with the provided list of queues.
    - Any queues that match the cleanup_spec but are not in the k8s_resources list will be deleted
    - Any queues in both the cleanup_spec and k8s_resources list will be updated with the new spec
    - Any queues in the k8s_resources list that do not match the cleanup_spec will be created
    """
    # Search for queues to cleanup using this spec
    cleanup_spec: BackendCleanupSpec
    # The k8s specs for the queues to create in the backend
    k8s_resources: List[Dict]


class BackendSynchronizeBackendTestMixin(pydantic.BaseModel):
    """
    Synchronizes backend test CronJobs using test configurations.
    The job will create ConfigMaps and CronJob specs internally from the provided test configs.
    - Any CronJobs that exist but are not for the specified test_configs will be deleted
    - Any CronJobs for test_configs will be updated with the new spec
    - Any test_configs that don't have existing CronJobs will have new ones created
    """
    # Dictionary of test configurations (test_name -> BackendTests object)
    test_configs: Dict[str, Any]
    # Prefix for node conditions/labels
    node_condition_prefix: str
