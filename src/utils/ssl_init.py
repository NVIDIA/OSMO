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
# Delegate ssl verification to the OS trust store. Python 3.14 enforces RFC 5280
# strictly: CA certs without keyUsage are rejected with "_ssl.c:1081: CA cert
# does not include key usage extension". microk8s ships such certs, so every
# in-cluster Python service crashes on startup. truststore (a Python 3.10+
# package recommended by urllib3 maintainers) routes verification through the
# OS, which uses lenient validation and accepts these certs.
#
# Import this module before kubernetes / urllib3 / requests / httpx — once
# SSLContext is built, the patch lands too late.

import truststore

truststore.inject_into_ssl()
