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

import logging
import unittest


class CustomTextTestResult(unittest.TextTestResult):
    """
    Overrides default behavior of TextTestResult and provide custom test logging.
    """

    def startTest(self, test):
        divider = '#' * (len(self.getDescription(test)) + 4)

        if self.showAll:
            self.stream.write(divider)
            self.stream.write('\n')

        super().startTest(test)

        if self.showAll:
            self.stream.write('\n')
            self.stream.write(divider)
            self.stream.write('\n')
            self.stream.write('\n')
            self.stream.flush()

    def addSuccess(self, test):
        super().addSuccess(test)
        self.print_new_line()

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.print_new_line()

    def addError(self, test, err):
        super().addError(test, err)
        self.print_new_line()

    def print_new_line(self):
        self.stream.write('\n')
        self.stream.flush()


class CustomTextTestRunner(unittest.TextTestRunner):
    def _makeResult(self):
        return CustomTextTestResult(self.stream, self.descriptions, self.verbosity)


def run_test():
    """
    Entry point for functional testing. It prepares logging with a verbose format, then
    invoke tests with the custom text test runner.
    """
    formatter = logging.Formatter(
        fmt='%(asctime)s+%(msecs)04d %(levelname)-4s [%(filename)s:%(lineno)d] %(message)s',
        datefmt='%Y-%m-%dT%H:%M:%S',
    )

    root_logger = logging.getLogger()
    if root_logger.hasHandlers():
        for handler in root_logger.handlers:
            handler.setFormatter(formatter)

    for logger_name in logging.root.manager.loggerDict:
        logger = logging.getLogger(logger_name)
        logger.propagate = False
        logger.setLevel(logging.INFO)

        if not logger.hasHandlers():
            stream_handler = logging.StreamHandler()
            stream_handler.setFormatter(formatter)
            logger.addHandler(stream_handler)
        else:
            for handler in logger.handlers:
                handler.setFormatter(formatter)

    # Execute tests in verbose mode
    runner = CustomTextTestRunner(verbosity=2)
    unittest.main(testRunner=runner)
