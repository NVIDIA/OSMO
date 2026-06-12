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

import argparse
import json
import logging
import logging.handlers
import multiprocessing
import requests  # type: ignore
import traceback
import sys

from src.cli import main_parser
from src.lib.utils import client, client_configs, logging as logging_utils, login, osmo_errors


logger = logging.getLogger(__name__)


def configure_logging(
    log_level: logging_utils.LoggingLevel = logging_utils.LoggingLevel.DEBUG
):
    """
    Configure the logging for the CLI.

    Logs are written to both:
    - the console (more restricted and unformatted)
    - a log file (more verbose and formatted)
    """
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)  # Allow all logs to be processed

    # Console logger configuration
    class ConsoleLoggerFilter(logging.Filter):
        def filter(self, record) -> bool:
            if record.name.startswith('src.'):
                # OSMO logs to console at the user specified log level
                return record.levelno >= log_level.value
            else:
                # Non OSMO logs to console at ERROR level
                return record.levelno >= logging.ERROR

    console_handler = logging.StreamHandler()
    console_handler.setLevel(log_level.name)
    console_handler.setFormatter(logging.Formatter('%(message)s'))
    console_handler.addFilter(ConsoleLoggerFilter())
    root_logger.addHandler(console_handler)

    # File logger configuration
    class FileLoggerFilter(logging.Filter):
        def filter(self, record) -> bool:
            if record.name.startswith('src.'):
                # Always log OSMO logs to file
                return True
            else:
                # Non OSMO logs to file at INFO level
                return record.levelno >= logging.INFO

    file_handler = logging.handlers.RotatingFileHandler(
        client_configs.get_log_file_path(),
        encoding='utf-8',
        maxBytes=10 * 1024 * 1024,
        backupCount=5
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.addFilter(FileLoggerFilter())
    file_handler.setFormatter(
        logging_utils.ServiceFormatter(
            '%(asctime)s client [%(levelname)s] %(module)s: %(workflow_uuid_formatted)s%(message)s',
        ),
    )
    root_logger.addHandler(file_handler)


def main():

    parser = main_parser.create_cli_parser()

    try:
        args = parser.parse_args()
    except argparse.ArgumentError as e:
        print(f'An error occurred while parsing the arguments: {e}')
        sys.exit(1)

    configure_logging(args.log_level)

    logger.debug('Running OSMO CLI command: %s', ' '.join(sys.argv[1:]))

    # Run the appropriate sub-parser function
    # Added a try except block to allow to only print the error msg to the user
    # and not the complete traceback in case of OSMOError, but for Other Exceptions,
    # print the complete traceback.
    login_manager = client.LoginManager(
        login.LoginConfig(username=''),
        user_agent_prefix=client.CLIENT_USER_AGENT_PREFIX,
    )
    service_client = client.ServiceClient(login_manager)
    message = None
    status_code = None
    exit_code = 0
    try:
        if hasattr(args, 'func'):
            args.func(service_client, args)
        else:
            parser.print_help()
    except osmo_errors.OSMOSubmissionError as e:
        message = e.message
        status_code = e.status_code
        exit_code = 1
    except osmo_errors.OSMOServerError as e:
        message = e.message
        status_code = e.status_code
        exit_code = 10
    except osmo_errors.OSMOError as e:
        message = e.message
        status_code = e.status_code
        # 429 is a rate limit error, so we should report error code 75 for retryable errors
        exit_code = 75 if status_code == 429 else 2
    except KeyboardInterrupt:
        exit_code = 3
    except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError) as e:
        message = f'\nCannot connect to OSMO service, with error:\n{e}\n'
        exit_code = 10
    except ConnectionRefusedError as e:
        message = f'\nCannot connect to OSMO service, connection refused with errno {e.errno}\n\n'\
                  f'ERROR {e}'
        exit_code = 10
    except json.decoder.JSONDecodeError as e:
        message = f'\nError decoding JSON: {e}\n'\
                  f'Original text: {e.doc}\n'\
                  f'Traceback: {traceback.format_exc()}\n\n'
        exit_code = 10
    except Exception as e:  # pylint: disable=broad-except
        message = str(e) + '\n' + traceback.format_exc()
        exit_code = 2
    finally:
        if message:
            if hasattr(args, 'format_type') and args.format_type == 'json':
                print(json.dumps({'message': message, 'code': status_code or 1}, indent=2))
            else:
                print('Error message:', message)
                print('Error code:', status_code or 1)
        sys.exit(exit_code)


if __name__ == '__main__':
    # freeze_support is needed for executable built from pyinstaller to work properly on
    # Windows and MacOS. Without this, child processes are 'spawned' by default (instead of
    # 'forked' in Linux), and would recursively create new processes inside a child process.
    #
    # Reference: https://cx-freeze.readthedocs.io/en/latest/faq.html#multiprocessing-support
    multiprocessing.freeze_support()

    # Force the start method to be 'spawn' to avoid possible deadlocks when using
    # multiprocessing/multithreading. This is especially important for Linux (which uses 'fork' by
    # default).
    multiprocessing.set_start_method('spawn', force=True)

    main()
