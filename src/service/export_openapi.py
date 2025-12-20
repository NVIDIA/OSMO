#!/usr/bin/env python3
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

Export OpenAPI spec from FastAPI app.

This script imports the FastAPI app and generates the OpenAPI specification
as JSON. It's designed to be run via Bazel with all dependencies properly
resolved.

Usage (via Bazel):
    bazel run //src/service:export_openapi > ui-next/openapi.json

Usage (via pnpm from ui-next):
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
    
    # Format JSON
    indent = 2 if args.pretty else None
    json_output = json.dumps(openapi_spec, indent=indent)
    
    # Write output
    if args.output:
        with open(args.output, 'w') as f:
            f.write(json_output)
        print(f"OpenAPI spec written to {args.output}", file=sys.stderr)
    else:
        print(json_output)


if __name__ == '__main__':
    main()
