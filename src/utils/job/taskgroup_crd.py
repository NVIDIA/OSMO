"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

import copy
import dataclasses
import re
from typing import Any, Dict, List

import yaml

OTG_API_VERSION = 'workflow.osmo.nvidia.com/v1alpha1'
OTG_KIND = 'OSMOTaskGroup'
OTG_MODE_ANNOTATION = 'workflow.osmo.nvidia.com/mode'


@dataclasses.dataclass(frozen=True)
class OSMOTaskGroupPayload:
    namespace: str
    name: str
    yaml_text: str


def otg_name(group_uuid: str) -> str:
    name = re.sub(r'[^a-z0-9-]+', '-', group_uuid.lower()).strip('-')
    if not name:
        name = 'task-group'
    if not name[0].isalpha():
        name = f'otg-{name}'
    return name[:63].rstrip('-')


def build_otg_payload(
    workflow_id: str,
    workflow_uuid: str,
    group_name: str,
    group_uuid: str,
    namespace: str,
    mode: Any,
    resources: List[Dict[str, Any]],
) -> OSMOTaskGroupPayload:
    name = otg_name(group_uuid)
    runtime_config = build_kai_runtime_config(resources)
    document = {
        'apiVersion': OTG_API_VERSION,
        'kind': OTG_KIND,
        'metadata': {
            'name': name,
            'namespace': namespace,
            'labels': {
                'osmo.workflow_id': workflow_id,
                'osmo.workflow_uuid': workflow_uuid,
                'osmo.group_name': group_name,
                'osmo.group_uuid': group_uuid,
            },
            'annotations': {
                OTG_MODE_ANNOTATION: mode_value(mode),
            },
        },
        'spec': {
            'workflowID': workflow_id,
            'workflowUUID': workflow_uuid,
            'groupName': group_name,
            'groupUUID': group_uuid,
            'runtimeType': 'kai',
            'runtimeConfig': runtime_config,
        },
    }
    return OSMOTaskGroupPayload(
        namespace=namespace,
        name=name,
        yaml_text=yaml.safe_dump(document, sort_keys=False),
    )


def mode_value(mode: Any) -> str:
    return mode.value if hasattr(mode, 'value') else str(mode)


def build_kai_runtime_config(resources: List[Dict[str, Any]]) -> Dict[str, Any]:
    kai_resources: List[Dict[str, Any]] = []
    pod_templates: List[Dict[str, Any]] = []
    group: Dict[str, Any] | None = None
    resource_order: List[Dict[str, str]] = []

    for resource in resources:
        api_version = resource.get('apiVersion', '')
        kind = resource.get('kind', '')
        metadata = resource.get('metadata', {})
        name = metadata.get('name', '')
        order_entry = {'apiVersion': api_version, 'kind': kind, 'name': name}
        if api_version == 'v1' and kind == 'Pod':
            pod_templates.append({
                'name': name,
                'labels': copy.deepcopy(metadata.get('labels', {})),
                'annotations': copy.deepcopy(metadata.get('annotations', {})),
                'spec': copy.deepcopy(resource.get('spec', {})),
            })
            order_entry['source'] = 'podTemplate'
        elif api_version == 'scheduling.run.ai/v2alpha2' and kind == 'PodGroup':
            spec = resource.get('spec', {})
            group = {
                'name': name,
                'labels': copy.deepcopy(metadata.get('labels', {})),
                'annotations': copy.deepcopy(metadata.get('annotations', {})),
                'queue': spec.get('queue', ''),
                'minMember': spec.get('minMember', len(pod_templates)),
                'priorityClassName': spec.get('priorityClassName', ''),
                'subGroups': copy.deepcopy(spec.get('subGroups', [])),
            }
            order_entry['source'] = 'group'
        else:
            kai_resources.append(copy.deepcopy(resource))
            order_entry['source'] = 'resource'
        resource_order.append(order_entry)

    return {
        'kai': {
            'resources': kai_resources,
            'group': group,
            'podTemplates': pod_templates,
            'resourceOrder': resource_order,
        },
        'expectedResources': copy.deepcopy(resources),
    }
