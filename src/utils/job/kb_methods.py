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

import abc
import dataclasses
from typing import List

import kubernetes.dynamic as kb_dynamic  # type: ignore

from src.utils.job import backend_job_defs

@dataclasses.dataclass
class CustomObjectMetadataStub:
    name: str


@dataclasses.dataclass
class CustomObjectStub:
    metadata: CustomObjectMetadataStub


@dataclasses.dataclass
class CustomObjectListStub:
    items: List[CustomObjectStub]


class KubernetesResourceMethods(abc.ABC):
    """Abstract base class for listing and deleting k8s resources"""
    @abc.abstractmethod
    def list_resource(self, namespace: str, **kwargs):
        pass

    @abc.abstractmethod
    def delete_resource(self, name: str, namespace: str, **kwargs):
        pass


class KubernetesGenericMethods(KubernetesResourceMethods):
    """Lists and deletes any namespaced Kubernetes resource using the dynamic client.

    Works for both core resources (apiVersion: v1) and any API group, without
    requiring explicit enumeration of resource types. For Pods, removes the OSMO
    cleanup finalizer before deletion.
    """
    def __init__(self, api_client, api_version: str, kind: str):
        self._api_version = api_version
        self._kind = kind
        dyn_client = kb_dynamic.DynamicClient(api_client)
        self.resource_api = dyn_client.resources.get(api_version=api_version, kind=kind)

    def list_resource(self, namespace: str, **kwargs):
        label_selector = kwargs.get('label_selector', '')
        result = self.resource_api.get(namespace=namespace, label_selector=label_selector)
        return CustomObjectListStub(items=[
            CustomObjectStub(metadata=CustomObjectMetadataStub(name=item.metadata.name))
            for item in result.items
        ])

    def delete_resource(self, name: str, namespace: str, **kwargs):
        if self._api_version == 'v1' and self._kind == 'Pod':
            self.resource_api.patch(
                name=name,
                namespace=namespace,
                body={'metadata': {
                    '$deleteFromPrimitiveList/finalizers': ['osmo.nvidia.com/cleanup']
                }},
                content_type='application/strategic-merge-patch+json',
            )
        return self.resource_api.delete(name=name, namespace=namespace, body=kwargs.get('body'))


def kb_methods_factory(api_client,
                       resource: backend_job_defs.BackendCleanupSpec) -> KubernetesGenericMethods:
    """Returns a KubernetesGenericMethods for the resource type described by cleanup spec."""
    kind = resource.effective_kind
    if kind is None:
        raise ValueError(f'BackendCleanupSpec has no resource kind: {resource}')
    return KubernetesGenericMethods(api_client, resource.effective_api_version, kind)
