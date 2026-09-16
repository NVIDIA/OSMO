# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""YAML-aware shell-test selectors; compare values independently of quoting/layout."""

import argparse
import json
from pathlib import Path
from typing import Any

import yaml


def matches(value: Any, expected: Any) -> bool:
    if isinstance(expected, dict):
        return isinstance(value, dict) and all(
            key in value and matches(value[key], item) for key, item in expected.items()
        )
    return type(value) is type(expected) and value == expected


def count_matches(value: Any, expected: Any) -> int:
    count = int(matches(value, expected))
    if isinstance(value, dict):
        count += sum(count_matches(item, expected) for item in value.values())
    elif isinstance(value, list):
        count += sum(count_matches(item, expected) for item in value)
    return count


def count_list_items(value: Any, expected: Any) -> int:
    if isinstance(value, list):
        return sum(
            int(matches(item, expected)) + count_list_items(item, expected)
            for item in value
        )
    if isinstance(value, dict):
        return sum(count_list_items(item, expected) for item in value.values())
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        'action',
        choices=[
            'contains',
            'count',
            'job-name',
            'container',
            'snapshot',
            'empty-dir',
            'projection',
        ],
    )
    parser.add_argument('file')
    parser.add_argument('expected')
    arguments = parser.parse_args()
    # Helm's YAML parser accepts trailing tab whitespace; PyYAML does not.
    content = '\n'.join(
        line.rstrip('\t') for line in Path(arguments.file).read_text().splitlines()
    )
    try:
        resources = list(yaml.safe_load_all(content))
    except yaml.YAMLError:
        if arguments.action == 'count':
            print(0)
            return
        raise SystemExit(1) from None
    if arguments.action == 'empty-dir':
        for resource in resources:
            if not isinstance(resource, dict):
                continue
            pod = resource.get('spec', {}).get('template', {}).get('spec', {})
            if any(
                volume.get('name') == arguments.expected and 'emptyDir' in volume
                for volume in pod.get('volumes', [])
            ):
                return
        raise SystemExit(1)
    if arguments.action == 'projection':
        name, key = arguments.expected.split(':', 1)
        for resource in resources:
            if not isinstance(resource, dict):
                continue
            pod = resource.get('spec', {}).get('template', {}).get('spec', {})
            for volume in pod.get('volumes', []):
                specification = volume.get('secret', {})
                if specification.get('secretName') == name and any(
                    item.get('key') == key for item in specification.get('items', [])
                ):
                    return
        raise SystemExit(1)
    if arguments.action == 'snapshot':
        name, _, key = arguments.expected.partition(':')
        for resource in resources:
            if not isinstance(resource, dict) or resource.get('kind') != 'Deployment':
                continue
            pod = resource['spec']['template']['spec']
            for container in pod.get('initContainers', []):
                if container['name'] != 'bootstrap-credentials':
                    continue
                for environment in container.get('env', []):
                    if environment['name'] != 'OSMO_BOOTSTRAP_FILES':
                        continue
                    if any(
                        item['secret'] == name and (not key or item['key'] == key)
                        for item in json.loads(environment['value'])
                    ):
                        return
        raise SystemExit(1)
    if arguments.action in ('job-name', 'container'):
        selected = [
            (resource, container)
            for resource in resources
            if isinstance(resource, dict) and resource.get('kind') == 'Job'
            for container in resource['spec']['template']['spec'].get(
                'initContainers', []
            )
            if container['name'] == arguments.expected
        ]
        if len(selected) != 1:
            raise SystemExit(1)
        job, container = selected[0]
        if 'helm.sh/hook' in job['metadata'].get('annotations', {}):
            raise SystemExit('Ordinary bootstrap unexpectedly became a Helm hook.')
        print(
            job['metadata']['name']
            if arguments.action == 'job-name'
            else yaml.safe_dump(container, sort_keys=False),
            end='\n',
        )
        return
    try:
        expected = yaml.safe_load(arguments.expected)
    except yaml.YAMLError:
        raise SystemExit(1) from None
    if (
        arguments.expected.lstrip().startswith('- ')
        and isinstance(expected, list)
        and len(expected) == 1
    ):
        count = sum(count_list_items(resource, expected[0]) for resource in resources)
    else:
        count = sum(count_matches(resource, expected) for resource in resources)
    if arguments.action == 'count':
        print(count)
    elif count == 0:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
