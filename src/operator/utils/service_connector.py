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


import json
import logging
import urllib
from typing import Any, Optional

import requests
from urllib3.util import Retry

from src.lib.utils import login, osmo_errors
from src.operator.utils import login as bu_login, objects as bu_objects


class OsmoServiceConnector:
    """Handles connections to OSMO service and config retrieval."""

    RETRY_COUNT = 5

    def __init__(self, service_url: str, backend_name: str,
                 config: bu_objects.BackendBaseConfig):
        """Initialize OsmoServiceConnector and connect to OSMO service.

        Args:
            service_url: URL of the OSMO service
            backend_name: Name of the backend
            config: Backend configuration for authentication
        """
        self.service_url = service_url
        self.backend_name = backend_name
        self.config = config

    def _get_config(self, endpoint: str) -> Any:
        """Private function to get configuration from OSMO service.

        Args:
            endpoint: API endpoint to call

        Returns:
            Any: Configuration object or None if failed
        """
        parsed_uri = urllib.parse.urlparse(self.service_url)
        scheme = 'https' if parsed_uri.scheme == 'https' else 'http'
        url = f'{scheme}://{parsed_uri.netloc}/{endpoint}'

        try:
            _, headers = bu_login.get_headers_and_login_info(self.config)

            retry_strategy = Retry(
                total=self.RETRY_COUNT,
                status_forcelist=[429, 500, 502, 503, 504],
                allowed_methods=['GET'],
                backoff_factor=1,
                respect_retry_after_header=True
            )

            timeout: Optional[int] = login.TIMEOUT
            session = requests.Session()
            session.mount(
                f'{scheme}://',
                requests.adapters.HTTPAdapter(max_retries=retry_strategy)
            )
            response = session.get(url, timeout=timeout, headers=headers)
            if response.status_code == 200:
                try:
                    payload = json.loads(response.text)
                    return payload
                except json.decoder.JSONDecodeError as e:
                    logging.error('Error parsing config response: %s', e)
                    logging.info(response.text)
            else:
                logging.warning(
                    'Failed to get config from %s: HTTP %d - %s',
                    endpoint, response.status_code, response.text
                )

        except (requests.exceptions.ConnectionError, osmo_errors.OSMOServerError) as error:
            logging.error('Error connecting to OSMO service: %s', error)

        return None

    def get_test_config(self, test_name: str) -> Any:
        """Get test configuration from OSMO service.

        Args:
            test_name: Name of the test to get config for

        Returns:
            Any: Configuration object
        """
        endpoint = f'api/configs/backend_test/{test_name}'
        return self._get_config(endpoint)

    def get_backend_config(self) -> Optional[Any]:
        """Get backend configuration from OSMO service.

        Returns:
            Optional[Any]: Complete backend configuration payload or None if failed to retrieve
        """
        endpoint = f'api/configs/backend/{self.backend_name}'
        payload = self._get_config(endpoint)
        return payload
