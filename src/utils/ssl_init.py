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
# Patch kubernetes-client's REST pool manager to use a truststore SSLContext.
#
# Python 3.14 hardens X.509 path validation: CA certs without keyUsage are
# rejected at handshake (`_ssl.c:1081`). Microk8s ships such certs, so every
# in-cluster Python service crashloops on startup against a microk8s cluster.
#
# We can't replace the cluster's CA, so we delegate verification to the OS
# trust store (lenient verification) for kubernetes API calls. We do NOT
# monkey-patch ssl globally via `truststore.inject_into_ssl()` because that
# breaks botocore: its vendored urllib3's create_urllib3_context() recurses
# into the patched ssl.SSLContext class. Boto3 (S3 storage SDK) is used by
# every OSMO service that talks to workflow storage, so a global patch would
# crash production too.
#
# Instead, intercept kubernetes.client.rest.RESTClientObject.__init__ and
# attach a truststore SSLContext to its urllib3 PoolManager. Scope is
# kubernetes API calls only — boto3, requests, etc. continue using Python's
# default verifier.

import ssl

import truststore
from kubernetes.client import rest as _kube_rest

_orig_init = _kube_rest.RESTClientObject.__init__


def _patched_init(self, configuration, *args, **kwargs):
    _orig_init(self, configuration, *args, **kwargs)
    ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    if configuration.ssl_ca_cert:
        ctx.load_verify_locations(cafile=configuration.ssl_ca_cert)
    # urllib3's PoolManager honors ssl_context via connection_pool_kw
    self.pool_manager.connection_pool_kw["ssl_context"] = ctx


_kube_rest.RESTClientObject.__init__ = _patched_init  # type: ignore[method-assign]
