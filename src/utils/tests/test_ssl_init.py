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

import unittest

import truststore
from kubernetes.client import Configuration
from kubernetes.client import rest as kube_rest

from src.utils import ssl_init  # noqa: F401  # pylint: disable=unused-import


class SSLInitTest(unittest.TestCase):
    """Verifies the surgical kubernetes-only truststore patch in
    src/utils/ssl_init.py.

    The patch's two structural assumptions:
      1. RESTClientObject.pool_manager exists on the configured client (the
         object the kubernetes Python client uses internally for HTTP calls).
      2. urllib3 PoolManager honors `ssl_context` passed via
         `connection_pool_kw` — that's where the patch injects the
         truststore SSLContext.

    Both must hold for the patch to actually flow through to runtime SSL
    handshakes; if either changes (e.g. kubernetes-client refactor), this
    test catches it instead of failing at deploy time.
    """

    def _make_client(self):
        cfg = Configuration()
        cfg.host = 'https://10.0.0.1'
        cfg.verify_ssl = True
        # Leave ssl_ca_cert unset — the patch skips load_verify_locations
        # when no CA is configured, but still attaches the truststore
        # SSLContext, which is what we're testing.
        return kube_rest.RESTClientObject(cfg)

    def test_pool_manager_attribute_exists(self):
        """Risk 1: RESTClientObject must expose a pool_manager attribute that
        the patch can mutate."""
        client = self._make_client()
        self.assertTrue(hasattr(client, 'pool_manager'),
                        'RESTClientObject is expected to expose pool_manager')
        self.assertIsNotNone(client.pool_manager)
        self.assertTrue(hasattr(client.pool_manager, 'connection_pool_kw'),
                        'urllib3 PoolManager is expected to expose '
                        'connection_pool_kw for ssl_context injection')

    def test_patched_init_injects_truststore_ssl_context(self):
        """Risk 2: the patch must successfully attach a truststore SSLContext
        to the pool manager's connection_pool_kw, so subsequent connections
        from this client use OS trust store verification."""
        client = self._make_client()
        ctx = client.pool_manager.connection_pool_kw.get('ssl_context')
        self.assertIsNotNone(
            ctx, 'ssl_context should be injected into connection_pool_kw '
            'by the ssl_init patch')
        self.assertIsInstance(
            ctx, truststore.SSLContext,
            'injected ssl_context should be a truststore.SSLContext, not '
            f'{type(ctx).__name__}')


if __name__ == '__main__':
    unittest.main()
