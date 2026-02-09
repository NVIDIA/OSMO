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

import itertools
import logging
import os
import tempfile
from typing import Dict, List

import jinja2
import requests
from python import runfiles  # type: ignore
from testcontainers.core import (  # type: ignore
    labels,
    network as core_network,
    waiting_utils,
)

from src.tests.common.core import backend, network, utils

logger = logging.getLogger(__name__)

ENVOY_NAME = f'envoy-{labels.SESSION_ID}'
ENVOY_IMAGE = f'{utils.DOCKER_HUB_REGISTRY}/envoyproxy/envoy:v1.29.0'
ENVOY_ADMIN_PORT = 9901
ENVOY_LIVE_STATUS = 'LIVE'
ENVOY_PORT_FORWARD_START = 10_001  # Envoy port starts at 10000

ENVOY_CERT_BAZEL_RUNFILE = 'osmo_workspace/src/tests/common/envoy/cert.pem'
ENVOY_KEY_BAZEL_RUNFILE = 'osmo_workspace/src/tests/common/envoy/key.pem'
ENVOY_TEMPLATE_BAZEL_RUNFILE = 'osmo_workspace/src/tests/common/envoy/config.jinja'
ENVOY_CERT_CONTAINER_FILE = '/etc/envoy/certs/cert.pem'
ENVOY_KEY_CONTAINER_FILE = '/etc/envoy/certs/key.pem'
ENVOY_CONFIG_CONTAINER_FILE = '/etc/envoy/envoy.yaml'


class SslProxyBackend(backend.Backend):
    """
    Extension of a Backend object with assigned_ports in the SSL Proxy
    """
    assigned_ports: List[int]  # one to one mapping to ports in the backend


class SSLProxy(network.NetworkAwareContainer):
    """
    An SSL Proxy implemented via an Envoy container for testing purposes.

    This class should be used as part of a bazel build/test run in order to allow proper
    runfiles to be packaged with this library.

    The SSL Proxy implementation uses self-signed SSL certificate/key. As a result, SSL
    verification should be disabled by clients (e.g. boto3, requests, etc).

    Note:

        - All backend containers should be running in the same docker network as Envoy.

        - Each backend will be assigned a dedicated internal port in the range (10000, N],
          where N is the number of backends.
    """

    @staticmethod
    def _render_config(ssl_proxy_backends: List[SslProxyBackend],
                       r: runfiles.Runfiles):
        """
        Render the full envoy.yaml from template
        """
        template_path = r.Rlocation(ENVOY_TEMPLATE_BAZEL_RUNFILE)
        if not template_path:
            raise FileNotFoundError(
                'Envoy Config template not found to initiate SSL Proxy')

        template_dir = os.path.dirname(template_path)
        template_name = os.path.basename(template_path)
        env = jinja2.Environment(loader=jinja2.FileSystemLoader(template_dir))
        env.globals.update(zip=zip)
        template = env.get_template(template_name)
        rendered_config = template.render(backends=ssl_proxy_backends)

        # Create a temporary file to store the rendered config
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as tmp_file:
            tmp_file.write(rendered_config)
            return tmp_file.name

    @staticmethod
    def _create_ssl_proxy_backends(
        backends: List[backend.Backend],
        test_network: core_network.Network,
    ) -> List[SslProxyBackend]:
        """
        Create a list of SSL Proxy Backends from the provided list of backends.

        Returns a list of SSL Proxy Backends.
        """
        eligible_backends = [
            b for b in backends
            if b.network_name and b.network_name == test_network.name
        ]

        if not eligible_backends:
            logger.warning(
                'No backend found in the same network (%s) as Envoy.', test_network.name)
            return []

        ssl_proxy_backends = []
        assigned_ports = itertools.count(ENVOY_PORT_FORWARD_START)

        for eligible_backend in eligible_backends:
            ssl_proxy_backends.append(SslProxyBackend(
                **eligible_backend.dict(),
                assigned_ports=[next(assigned_ports)
                                for _ in eligible_backend.ports]
            ))

        return ssl_proxy_backends

    @staticmethod
    def _register_backends(ssl_proxy_backends: List[SslProxyBackend]) -> Dict[str, Dict[int, int]]:
        """
        Get a mapping of backend alias to assigned ports
        """
        return {
            b.alias: dict(zip(b.ports, b.assigned_ports))
            for b in ssl_proxy_backends
        }

    def __init__(self,
                 backends: List[backend.Backend],
                 test_network: core_network.Network):
        r = runfiles.Runfiles.Create()
        assert r is not None, 'Failed to create runfiles'

        # Validate that the cert/key files exist
        self.cert_path = r.Rlocation(ENVOY_CERT_BAZEL_RUNFILE)
        self.key_path = r.Rlocation(ENVOY_KEY_BAZEL_RUNFILE)
        if not self.cert_path or not self.key_path:
            raise FileNotFoundError(
                'Cert/Key files not found to initiate SSL Proxy')

        ssl_proxy_backends = SSLProxy._create_ssl_proxy_backends(
            backends, test_network)

        self.rendered_config_path = SSLProxy._render_config(
            ssl_proxy_backends, r)
        self.backend_alias_to_assigned_ports = SSLProxy._register_backends(
            ssl_proxy_backends)

        super().__init__(ENVOY_IMAGE)

        self.with_network(test_network)
        self.with_name(ENVOY_NAME)
        self.with_network_aliases(ENVOY_NAME)
        self.with_exposed_ports(*[
            port
            for ports in self.backend_alias_to_assigned_ports.values()
            for port in ports.values()
        ])
        self.with_exposed_ports(ENVOY_ADMIN_PORT)
        self.with_kwargs(
            mem_limit='256m',
            memswap_limit='256m'
        )

        # Wait for certs and config to be copied into the container before starting envoy
        # This ensures that envoy is started in the main process, allowing logs to be
        # inspected via docker logs
        startup_script = '''#!/bin/sh
echo 'Waiting for config files...'
while [ ! -f /etc/envoy/envoy.yaml ] || \
    [ ! -f /etc/envoy/certs/cert.pem ] || \
    [ ! -f /etc/envoy/certs/key.pem ]; do
    sleep 0.5
done
echo 'Files found, starting Envoy...'
exec envoy -c /etc/envoy/envoy.yaml
'''
        self.with_command(f'/bin/sh -c "{startup_script}"')

    @waiting_utils.wait_container_is_ready(
        requests.ConnectionError,
        requests.Timeout,
        requests.ReadTimeout,
    )
    def _wait_until_ready(self):
        """
        Blocks until Envoy testcontainer to be fully ready for API calls
        """
        host, port = None, None
        try:
            host = self.get_container_host_ip()
            port = self.get_exposed_port(ENVOY_ADMIN_PORT)
        except Exception as e:  # pylint: disable=broad-except
            raise ConnectionError(
                'Container host and port not ready yet') from e

        # Attempt to make a request to confirm readiness
        url = f'http://{host}:{port}/ready'
        logger.info('Waiting for Envoy to be ready at %s', url)
        response = requests.get(url, timeout=5, verify=False)
        if response.status_code != 200:
            raise ConnectionError(
                f'Unexpected status code: {response.status_code}')
        if response.text.strip() != ENVOY_LIVE_STATUS:
            raise ConnectionError(f'Envoy is not ready yet: {response.text}')

    def start(self):
        super().start()
        utils.copy_file_to_container(
            self._container, self.cert_path, ENVOY_CERT_CONTAINER_FILE)
        utils.copy_file_to_container(
            self._container, self.key_path, ENVOY_KEY_CONTAINER_FILE)
        utils.copy_file_to_container(
            self._container, self.rendered_config_path, ENVOY_CONFIG_CONTAINER_FILE)
        self._wait_until_ready()

    def stop(self):
        super().stop()
        if os.path.exists(self.rendered_config_path):
            os.remove(self.rendered_config_path)

    def get_endpoint(self, alias: str, app_port: int):
        """
        Get the endpoint (host:assigned_port) for a given alias and application port.
        """
        if alias not in self.backend_alias_to_assigned_ports:
            raise KeyError(f'Alias {alias} not found in proxied backends')
        if app_port not in self.backend_alias_to_assigned_ports[alias]:
            raise KeyError(
                f'Application port {app_port} not found for alias {alias}')

        assigned_port = self.backend_alias_to_assigned_ports[alias][app_port]
        return f'{self.get_container_host_ip()}:{self.get_exposed_port(assigned_port)}'


class SslProxyFixture(network.NetworkFixture):
    """
    A fixture that manages a SSL Proxy testcontainer.
    """
    ssl_proxy: SSLProxy

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        logger.info('Setting up Envoy SSL proxy testcontainer.')
        networked_backends = [c.get_backend()
                              for c in cls.networked_containers]
        cls.ssl_proxy = SSLProxy(
            backends=networked_backends,
            test_network=cls.network,
        )

        logger.info('Waiting for Envoy SSL Proxy testcontainer to be ready ...')
        cls.ssl_proxy.start()
        utils.patch_requests_session_for_ssl_verification()

        logger.info('Envoy SSL Proxy testcontainer is ready.')

    @classmethod
    def tearDownClass(cls):
        logger.info('Tearing down Envoy SSL Proxy testcontainer.')
        try:
            cls.ssl_proxy.stop()
            utils.restore_requests_session_init()
        finally:
            super().tearDownClass()
