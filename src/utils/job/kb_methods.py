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

import abc
import dataclasses
from typing import Callable, Dict, List

import kubernetes.client as kb_client  # type: ignore
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


class KubernetesPodMethods(KubernetesResourceMethods):
    """Lists and deletes pods"""
    def __init__(self, api: kb_client.CoreV1Api):
        self.api = api

    def list_resource(self, namespace: str, **kwargs):
        return self.api.list_namespaced_pod(namespace, **kwargs)

    def delete_resource(self, name: str, namespace: str, **kwargs):
        # Remove the finalizer and then delete the pod
        self.api.patch_namespaced_pod(name, namespace, body={
            'metadata': {
                '$deleteFromPrimitiveList/finalizers': ['osmo.nvidia.com/cleanup']
            }})
        return self.api.delete_namespaced_pod(name, namespace, **kwargs)


class KubernetesServiceMethods(KubernetesResourceMethods):
    """Lists and deletes services"""
    def __init__(self, api: kb_client.CoreV1Api):
        self.api = api

    def list_resource(self, namespace: str, **kwargs):
        return self.api.list_namespaced_service(namespace, **kwargs)

    def delete_resource(self, name: str, namespace: str, **kwargs):
        return self.api.delete_namespaced_service(name, namespace, **kwargs)


class KubernetesSecretMethods(KubernetesResourceMethods):
    """Lists and deletes secrets"""
    def __init__(self, api: kb_client.CoreV1Api):
        self.api = api

    def list_resource(self, namespace: str, **kwargs):
        return self.api.list_namespaced_secret(namespace, **kwargs)

    def delete_resource(self, name: str, namespace: str, **kwargs):
        return self.api.delete_namespaced_secret(name, namespace, **kwargs)


class KubernetesGenericMethods(KubernetesResourceMethods):
    """Lists and deletes any namespaced Kubernetes resource using the dynamic client.

    Works for both core resources (apiVersion: v1) and any API group, without
    requiring explicit enumeration of resource types.
    """
    def __init__(self, api_client, api_version: str, kind: str):
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
        return self.resource_api.delete(name=name, namespace=namespace, body=kwargs.get('body'))


class KubernetesCustomObjectMethods(KubernetesResourceMethods):
    """Lists and deletes custom objects"""
    def __init__(self, api: kb_client.CustomObjectsApi, api_major: str, api_minor: str, path: str):
        self.api = api
        self.api_major = api_major
        self.api_minor = api_minor
        self.path = path

    def list_resource(self, namespace: str, **kwargs):
        objects = self.api.list_namespaced_custom_object(self.api_major, self.api_minor, namespace,
            self.path, **kwargs)
        return CustomObjectListStub(items=[CustomObjectStub(
            metadata=CustomObjectMetadataStub(
            name=obj['metadata']['name'])) for obj in objects['items']])

    def delete_resource(self, name: str, namespace: str, **kwargs):
        return self.api.delete_namespaced_custom_object(self.api_major, self.api_minor, namespace,
            self.path, name, **kwargs)


CoreV1MethodsCreator = Callable[[kb_client.CoreV1Api], KubernetesResourceMethods]


def kb_methods_factory(api_client,
                       resource: backend_job_defs.BackendCleanupSpec) -> KubernetesResourceMethods:
    if resource.generic_api is not None:
        return KubernetesGenericMethods(
            api_client,
            resource.generic_api.api_version,
            resource.generic_api.kind)

    if resource.custom_api is not None:
        return KubernetesCustomObjectMethods(
            kb_client.CustomObjectsApi(api_client),
            resource.custom_api.api_major,
            resource.custom_api.api_minor,
            resource.custom_api.path)

    methods_by_resource_type: Dict[str, CoreV1MethodsCreator] = {
        'Pod': KubernetesPodMethods,
        'Service': KubernetesServiceMethods,
        'Secret': KubernetesSecretMethods,
    }
    resource_type = resource.resource_type

    if resource_type not in methods_by_resource_type:
        raise ValueError(f'Unrecognized resource type {resource_type}')
    return methods_by_resource_type[resource_type](kb_client.CoreV1Api(api_client))
