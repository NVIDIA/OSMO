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

from PyInstaller.utils.hooks import collect_all  # type: ignore

# Suppress warnings for modules that may not be installed in all environments
warn_on_missing_hiddenimports = False

# Initialize collections
datas = []
binaries = []
hiddenimports = []

# Use collect_all for comprehensive collection of azure packages and dependencies
# This handles data files, binaries, and hidden imports in one call
packages_to_collect = [
    'azure.core',
    'azure.identity',
    'azure.storage.blob',
    'msal',
    'msal_extensions',
    'isodate',
]

for package in packages_to_collect:
    try:
        pkg_datas, pkg_binaries, pkg_hiddenimports = collect_all(package)
        datas.extend(pkg_datas)
        binaries.extend(pkg_binaries)
        hiddenimports.extend(pkg_hiddenimports)
    except Exception:
        # Package may not be installed; skip silently
        pass

# Explicit hidden imports for modules not auto-discovered by collect_all
hiddenimports.extend([
    # Cryptography - needed by azure SDK
    'cryptography.hazmat.primitives.ciphers.aead',
    'cryptography.hazmat.primitives.padding',
    # wsgiref stdlib - needed by azure.storage.blob._shared.policies
    'wsgiref.handlers',
])

# Deduplicate
datas = list(set(datas))
binaries = list(set(binaries))
hiddenimports = list(set(hiddenimports))
