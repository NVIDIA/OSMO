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

import os
from typing import List, Optional

import pydantic

NODE_NAME_ENV='OSMO_NODE_NAME'


class CacheConfigEntry(pydantic.BaseModel):
    ''' Describes a mapping from a certain data bucket to a new endpoint that is hosting some
    type of s3 compatible caching service'''
    path: str
    endpoint: str
    # If not empty, ignore this entry if the current OSMO_NODE_NAME is not in this list
    allowed_nodes: List[str] = []


class CacheConfig(pydantic.BaseModel):
    ''' Data caching configuration for an osmo client '''
    endpoints: List[CacheConfigEntry] = []

    def get_cache_endpoint(self, url: str) -> Optional[str]:
        '''Return the cache config endpoint if applicable for this url'''
        node_name = os.environ.get(NODE_NAME_ENV)
        for config in self.endpoints:
            # Skip if the path doesn't match
            if not url.startswith(config.path):
                continue
            # Skip if this node isnt allowed
            if config.allowed_nodes and node_name not in config.allowed_nodes:
                continue
            return config.endpoint
        return None
