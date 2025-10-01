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
from typing import Any, Dict

from src.lib.utils import logging as logging_utils
from src.operator.backend_test_runner import daemonset_manager
from src.operator.utils.node_validation_test import test_base
from src.operator.utils import objects as bu_objects, service_connector


class BackendTestRunner:
    """Orchestrates running a single test using daemonset."""

    def __init__(self, config: bu_objects.TestRunnerConfig):
        """Initialize TestRunner.

        Args:
            config: bu_objects.TestRunnerConfig object containing test parameters
        """

        self.backend_name = config.backend
        self.test_name = config.test_name
        self.namespace = config.namespace
        self.service_account = config.service_account
        self.prefix = config.prefix
        self.node_condition_prefix = config.node_condition_prefix or \
            test_base.DEFAULT_NODE_CONDITION_PREFIX
        self.test_config: Dict[str, Any] = {}

        # Initialize connector for test config
        if config.read_from_osmo:
            self.test_connector = service_connector.OsmoServiceConnector(
                service_url=config.service_url,
                backend_name=self.backend_name,
                config=config,
            )
            self.test_config = self.test_connector.get_test_config(
                test_name=self.test_name,
            )
        elif config.read_from_file:
            # Read test config from configmap in namespace
            try:
                with open(config.read_from_file, 'r', encoding='utf-8') as file:
                    self.test_config = json.load(file)
            except FileNotFoundError:
                logging.error('Failed to read test config from file: %s', config.read_from_file)
                raise
            except json.JSONDecodeError as error:
                logging.error('Failed to read test config from configmap: %s', error)
                raise
        else:
            raise ValueError('Either read_from_osmo or read_from_file must be specified.')
        # Initialize daemonset manager
        self.manager = daemonset_manager.DaemonSetManager(
            backend_test_name=self.test_name,
            parsed_pod_template=self.test_config.get('parsed_pod_template', {}),
            conditions=self.test_config.get('node_conditions', []),
            node_condition_prefix=self.node_condition_prefix,
            namespace=self.namespace,
            prefix=self.prefix,
            timeout=self.test_config.get('timeout', 300),
            service_account=self.service_account
        )
        logging.info('DaemonSetManager is %s', self.manager)

    def run_test(self) -> bool:
        """Run the test using daemonset.

        Returns:
            bool: True if test succeeded, False otherwise
        """
        logging.info('Running test: %s', self.test_name)

        # Get test configuration
        if not self.test_config:
            logging.error('Failed to get configuration for test %s', self.test_name)
            return False

        # Deploy daemonset with test configuration
        success = self.manager.deploy_and_wait()

        if success:
            logging.info('Test %s completed successfully', self.test_name)
        else:
            logging.error('Test %s failed', self.test_name)

        return success


def main():
    """Main function to run a single test."""
    # Load configuration
    config = bu_objects.TestRunnerConfig.load()
    logging_utils.init_logger('test_runner', config)

    # Run test
    runner = BackendTestRunner(config=config)

    success = runner.run_test()

    if success:
        logging.info('Test %s ran successfully on all nodes.', config.test_name)
    else:
        logging.error('Test %s failed on some nodes.', config.test_name)


if __name__ == '__main__':
    main()
