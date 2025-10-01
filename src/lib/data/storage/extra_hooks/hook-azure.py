# pylint: disable=import-error, invalid-name
# hook-azure.py
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

# Collect entry points
datas_set = set()
hiddenimports_set = set()

data_files = (
    'azure',
    'azure.storage',
    'isodate',
)

for data_file in data_files:
    datas_set.update(hooks.collect_data_files(data_file, include_py_files=True))

hiddenimports_files = (
    'cryptography.hazmat.primitives.ciphers.aead',
    'cryptography.hazmat.primitives.padding',
    'wsgiref',
)

# Add hidden imports
for hiddenimport_file in hiddenimports_files:
    hiddenimports_set.update(hooks.collect_submodules(hiddenimport_file))

datas = list(datas_set)
hiddenimports = list(hiddenimports_set)
