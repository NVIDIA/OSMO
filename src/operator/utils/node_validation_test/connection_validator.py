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

import yaml
import os
import logging
import pydantic
import time
import sys
from typing import List, Optional

import requests

from src.operator.utils.node_validation_test import test_base
from src.lib.utils import logging as logging_utils


class URLTestConfig(pydantic.BaseModel):
    """Configuration for a single URL test."""

    url: str = pydantic.Field(description='URL to test connection to')
    method: str = pydantic.Field(default='GET', description='HTTP method to use')
    timeout: int = pydantic.Field(
        default=30, description='Timeout in seconds for the connection test')
    expected_status_code: int = pydantic.Field(
        default=200, description='Expected HTTP status code')
    condition_name: Optional[str] = pydantic.Field(
        default='ServiceConnectionTestFailure', description='Custom condition name for this URL')


class ConnectionTestConfig(test_base.NodeTestConfig):
    """Configuration for connection validation tests."""

    condition_name: str = pydantic.Field(
        command_line='condition_name',
        default='ServiceConnectionTestFailure',
        description='Condition name for service connection failure')
    test_url: Optional[str] = pydantic.Field(
        command_line='test_url',
        default=None,
        description='Single URL to test connection to')
    test_timeout: int = pydantic.Field(
        command_line='test_timeout',
        default=30,
        description='Default timeout in seconds for connection tests')
    url_configs_filepath: Optional[str] = pydantic.Field(
        command_line='url_configs_filepath',
        default=os.path.join(os.path.dirname(__file__), 'connection_validator.yaml'),
        description='Path to a YAML file containing url_configs list'
    )
    url_configs: Optional[List[URLTestConfig]] = pydantic.Field(
        default=None,
        description='List of URLTestConfig items loaded from YAML'
    )

    @pydantic.root_validator(pre=True)
    @classmethod
    def load_url_configs_from_file(cls, values):
        """
        If url_configs_filepath is provided, load url_configs from the YAML file.
        """
        filepath = values.get('url_configs_filepath')

        if filepath:
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = yaml.safe_load(f) or {}
                url_configs_data = data.get('url_configs', []) or []
                url_test_configs = [URLTestConfig(**cfg) for cfg in url_configs_data]
                values['url_configs'] = url_test_configs
            except Exception as e:
                raise ValueError(f'Failed to load url_configs from {filepath}: {e}') from e
        return values

    def get_url_configs(self) -> List[URLTestConfig]:
        """Get the list of URL configurations to test."""
        configs = []

        if self.test_url is not None and isinstance(self.test_url, str) and self.test_url.strip():
            configs.append(URLTestConfig(
                url=self.test_url,
                timeout=self.test_timeout,
                condition_name=self.condition_name
            ))
            return configs

        if self.url_configs is not None:
            configs.extend(self.url_configs)

        return configs


class ConnectionValidator(test_base.NodeTestBase):
    """A class for validating service connections in a Kubernetes cluster."""

    def __init__(self, config: ConnectionTestConfig):
        super().__init__(config.node_name, config.node_condition_prefix)
        self.config = config

    @test_base.NodeTestBase.retry_with_backoff()
    def _connection_test(self, url_config: URLTestConfig) -> test_base.NodeCondition | None:
        """
        Test a single URL via HTTP.

        Returns:
            NodeCondition on success, None on failure (to trigger retry/backoff).
        """
        try:
            logging.info('Testing URL: %s', url_config.url)
            response = requests.request(
                method=url_config.method.upper(),
                url=url_config.url,
                timeout=url_config.timeout,
            )

            if response.status_code != url_config.expected_status_code:
                logging.error(
                    'Unexpected status code from %s: %s != %s',
                    url_config.url,
                    response.status_code,
                    url_config.expected_status_code,
                )
                return None

            logging.info('URL test passed: %s (%s)', url_config.url, url_config.condition_name)
            return test_base.NodeCondition(
                type=url_config.condition_name or self.config.condition_name,
                status='False',
                reason='ServiceConnectionSuccess',
                message=f'Connection test passed: {url_config.url}',
            )
        except requests.RequestException as e:
            logging.error('Connection test failed for %s: %s', url_config.url, str(e))
            return None

    def connection_test(self) -> None:
        """Run the connection test and update node conditions."""
        url_configs = self.config.get_url_configs()
        conditions = []
        logging.info('Running connection test for %s', url_configs)
        for url_config in url_configs:
            condition = self._connection_test(url_config)
            if not condition:
                condition = test_base.NodeCondition(
                    type=url_config.condition_name or self.config.condition_name,
                    status='True',
                    reason='ServiceConnectionFailure',
                    message=f'Connection test failed: {url_config.url}',
                )
                logging.error('URL test failed: %s', url_config.url)
            conditions.append(condition)
        self.update_node(conditions=conditions)


def main() -> None:
    try:
        test_config = ConnectionTestConfig.load()
        logging_utils.init_logger('connection_validator', test_config)
        validator = ConnectionValidator(config=test_config)
        validator.connection_test()

        logging.info('Connection validation completed for node %s', test_config.node_name)
        while True:
            if test_config.exit_after_validation:
                sys.exit()
            time.sleep(30)

    except Exception as e:
        logging.error('Error during connection validation: %s', e)
        raise

if __name__ == '__main__':
    main()
