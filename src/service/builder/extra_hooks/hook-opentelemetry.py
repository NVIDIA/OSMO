# pylint: disable=import-error, invalid-name
# hook-opentelemetry.py
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

from PyInstaller.utils import hooks  # type: ignore


# All known `opentelementry_` entry-point groups
# update if a new one is added in here:
# https://github.com/pyinstaller/pyinstaller-hooks-contrib/blob/master/_pyinstaller_hooks_contrib/stdhooks/hook-opentelemetry.py
ENTRY_POINT_GROUPS = (
    'opentelemetry_context',
    'opentelemetry_environment_variables',
    'opentelemetry_id_generator',
    'opentelemetry_logger_provider',
    'opentelemetry_logs_exporter',
    'opentelemetry_meter_provider',
    'opentelemetry_metrics_exporter',
    'opentelemetry_propagator',
    'opentelemetry_resource_detector',
    'opentelemetry_tracer_provider',
    'opentelemetry_traces_exporter',
    'opentelemetry_traces_sampler',
)

# Collect entry points
datas_set = set()
hiddenimports_set = set()

for entry_point_group in ENTRY_POINT_GROUPS:
    ep_datas, ep_hiddenimports = hooks.collect_entry_point(entry_point_group)
    datas_set.update(ep_datas)
    hiddenimports_set.update(ep_hiddenimports)

data_files = (
    'opentelemetry',
    'opentelemetry.exporter',
    'opentelemetry.exporter.otlp.proto.grpc',
    'grpc',
    'grpc._cython',
    'backoff',
    'opentelemetry.proto',
    'google.protobuf',
    'opentelemetry.semconv',
    'google.rpc',
    'opentelemetry.sdk',
    'opentelemetry.instrumentation',
    'opentelemetry.instrumentation.fastapi',
    'opentelemetry.instrumentation.asgi',
    'opentelemetry.util.http',
)

for data_file in data_files:
    datas_set.update(hooks.collect_data_files(data_file, include_py_files=True))


datas = list(datas_set)

hiddenimports_set.update(hooks.collect_submodules('grpc._cython'))
hiddenimports_set.update(hooks.collect_submodules('opentelemetry.api',
                                            filter=lambda name: True))
hiddenimports_set.update(hooks.collect_submodules('opentelemetry.instrumentation.fastapi',
                                            filter=lambda name: True))
hiddenimports_set.update(hooks.collect_submodules('opentelemetry.instrumentation.asgi',
                                            filter=lambda name: True))
hiddenimports_set.update(hooks.collect_submodules('opentelemetry.instrumentation',
                                            filter=lambda name: True))
hiddenimports_set.update(hooks.collect_submodules('opentelemetry.semconv',
                                            filter=lambda name: True))
hiddenimports_set.update(hooks.collect_submodules('opentelemetry.util.http',
                                            filter=lambda name: True))

# Add required standard library modules
standard_lib_modules = [
    'timeit',
    'typing',
    'typing.io',
    'typing.re',
    'asyncio',
    'contextvars',
    'time',
    'logging',
    'json',
    'urllib',
    'http',
]
hiddenimports_set.update(standard_lib_modules)

# Add additional OpenTelemetry dependencies
additional_modules = [
    'starlette',
    'starlette.types',
    'starlette.requests',
    'starlette.responses',
    'starlette.middleware',
    'fastapi.middleware',
    'fastapi.applications',
    'asgiref',
    'asgiref.compatibility',
    'asgiref.typing',
    'asgiref.sync',
]
hiddenimports_set.update(additional_modules)

# Add data files for ASGI dependencies
datas_set.update(hooks.collect_data_files('asgiref', include_py_files=True))
datas_set.update(hooks.copy_metadata('asgiref'))

hiddenimports = list(hiddenimports_set)
