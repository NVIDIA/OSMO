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
from typing import List

import kubernetes.client as kb_client  # type: ignore

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


def kb_methods_factory(api_client,
                       resource: backend_job_defs.BackendCleanupSpec) -> KubernetesResourceMethods:
    # Return custom methods if this is a custom method
    custom_resource_api: backend_job_defs.BackendCustomApi = resource.custom_api  # type: ignore
    if custom_resource_api is not None:
        return KubernetesCustomObjectMethods(
            kb_client.CustomObjectsApi(api_client),
            custom_resource_api.api_major,
            custom_resource_api.api_minor,
            custom_resource_api.path)

    methods_by_resource_type = {
        'Pod': KubernetesPodMethods,
        'Service': KubernetesServiceMethods,
        'Secret': KubernetesSecretMethods
    }
    resource_type = resource.resource_type

    if resource_type not in methods_by_resource_type:
        raise ValueError(f'Unrecognized resource type {resource_type}')
    return methods_by_resource_type[resource_type](kb_client.CoreV1Api(api_client))
