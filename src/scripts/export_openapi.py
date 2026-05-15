#!/usr/bin/env python3
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

Export OpenAPI spec from FastAPI app.

This script imports the FastAPI app and generates the OpenAPI specification
as JSON. It's designed to be run via Bazel with all dependencies properly
resolved.

Usage (via Bazel):
    bazel run //src/service:export_openapi > src/ui/openapi.json

Usage (via pnpm from src/ui):
    pnpm generate-api:source
"""

import argparse
import json
import sys

from src.service.core.service import app


def main():
    parser = argparse.ArgumentParser(description='Export OpenAPI spec from FastAPI app')
    parser.add_argument(
        '--output', '-o',
        type=str,
        default=None,
        help='Output file path (default: stdout)'
    )
    parser.add_argument(
        '--pretty',
        action='store_true',
        default=True,
        help='Pretty print JSON (default: True)'
    )
    args = parser.parse_args()

    # Generate OpenAPI spec
    openapi_spec = app.openapi()

    # Post-process the spec for codegen consumers (orval).
    #
    # 1) Explicitly set `explode: true` for array query parameters.
    #    OpenAPI 3 already defaults `style=form, explode=true` for query params,
    #    but orval's fetch client generator only emits explode logic when the
    #    field is present in the spec. Pydantic v2 emits nullable arrays as
    #    `anyOf: [{type: array}, {type: null}]` (no top-level `type`), so check
    #    both shapes.
    #
    # 2) Dedupe operationIds across HTTP methods. FastAPI emits the same
    #    operationId for every method of a multi-method route (e.g.
    #    `api_route(methods=['GET', 'HEAD'])`), which generates duplicate
    #    TypeScript types and breaks `tsc`.
    def _is_array_schema(schema: dict) -> bool:
        if schema.get('type') == 'array':
            return True
        return any(sub.get('type') == 'array' for sub in schema.get('anyOf', []))

    seen_operation_ids: set[str] = set()
    for path_item in openapi_spec.get('paths', {}).values():
        for method, operation in path_item.items():
            if not isinstance(operation, dict):
                continue
            for param in operation.get('parameters', []):
                if param.get('in') == 'query' and _is_array_schema(param.get('schema', {})):
                    param.setdefault('explode', True)
            operation_id = operation.get('operationId')
            if operation_id and operation_id in seen_operation_ids:
                operation['operationId'] = f'{operation_id}_{method.lower()}'
            if operation.get('operationId'):
                seen_operation_ids.add(operation['operationId'])

    # Format JSON
    indent = 2 if args.pretty else None
    json_output = json.dumps(openapi_spec, indent=indent)

    # Write output
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(json_output)
        print(f'OpenAPI spec written to {args.output}', file=sys.stderr)
    else:
        print(json_output)


if __name__ == '__main__':
    main()
