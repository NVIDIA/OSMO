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

import kubernetes  # type: ignore
import pydantic


class ClusterConfig(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ A class for managing the config for the execution cluster. """
    cluster_host: str = pydantic.Field(
        default='https://localhost:6443',
        description='The url at which the kubernetes api server is hosted.')
    cluster_api_key: str = pydantic.Field(
        description='The kubernetes api token.')

class ClusterConnector:
    """A class to manage the connection to a kubernetes cluster"""
    def __init__(self, config: ClusterConfig):
        self._config = config

    def core_v1_api(self) -> kubernetes.client.api.core_v1_api.CoreV1Api:
        """ Gets kubernetes CoreV1Api. """
        client = kubernetes.client.ApiClient(self._kb_client_config())
        api = kubernetes.client.CoreV1Api(api_client=client)
        return api

    def custom_api(self) -> kubernetes.client.api.custom_objects_api.CustomObjectsApi:
        """ Gets kubernetes CustomObjectsApi. """
        client = kubernetes.client.ApiClient(self._kb_client_config())
        api = kubernetes.client.CustomObjectsApi(api_client=client)
        return api

    def _kb_client_config(self) -> kubernetes.client.configuration.Configuration:
        """ Gets kubernetes CustomObjectsApi. """
        configuration = kubernetes.client.Configuration()
        configuration.verify_ssl = False
        configuration.api_key['authorization'] = self._config.cluster_api_key
        configuration.api_key_prefix['authorization'] = 'Bearer'
        configuration.host = self._config.cluster_host
        return configuration
