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


def resolve_local_path(path: str) -> str:
    return os.path.realpath(os.path.expandvars(os.path.expanduser(path)))


def get_absolute_path(path: str, workflow_file: str) -> str:
    is_abs_path = len(path) > 0 and path.startswith('/')
    if not is_abs_path:
        workflow_directory = os.path.dirname(workflow_file)
        path = os.path.normpath(os.path.join(workflow_directory, path))
    return path
