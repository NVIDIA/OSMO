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
import json
import logging
import unittest

from src.lib.utils import logging as logging_utils


def _make_record(
    name: str = 'osmo-test',
    level: int = logging.INFO,
    message: str = 'hello world',
    workflow_uuid: str | None = None,
    exc_info=None,
) -> logging.LogRecord:
    record = logging.LogRecord(
        name=name,
        level=level,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=None,
        exc_info=exc_info,
    )
    record.module = 'test_logging'
    if workflow_uuid is not None:
        record.workflow_uuid = workflow_uuid
    return record


class TestLogFormat(unittest.TestCase):
    """Unit tests for the LogFormat enum and parser."""

    def test_parse_accepts_known_values(self):
        self.assertIs(logging_utils.LogFormat.parse('text'), logging_utils.LogFormat.TEXT)
        self.assertIs(logging_utils.LogFormat.parse('JSON'), logging_utils.LogFormat.JSON)
        self.assertIs(
            logging_utils.LogFormat.parse('  json  '), logging_utils.LogFormat.JSON
        )

    def test_parse_passes_through_enum(self):
        self.assertIs(
            logging_utils.LogFormat.parse(logging_utils.LogFormat.JSON),
            logging_utils.LogFormat.JSON,
        )

    def test_parse_rejects_unknown_value(self):
        with self.assertRaises(ValueError):
            logging_utils.LogFormat.parse('xml')


class TestLoggingConfig(unittest.TestCase):
    """Unit tests for LoggingConfig defaults and coercion."""

    def test_default_log_format_is_text(self):
        config = logging_utils.LoggingConfig()
        self.assertIs(config.log_format, logging_utils.LogFormat.TEXT)

    def test_log_format_string_is_coerced(self):
        config = logging_utils.LoggingConfig(log_format='json')
        self.assertIs(config.log_format, logging_utils.LogFormat.JSON)


class TestJsonServiceFormatter(unittest.TestCase):
    """Unit tests for the JSON formatter."""

    def test_required_fields_emitted(self):
        formatter = logging_utils.JsonServiceFormatter(service='osmo-test')
        payload = json.loads(formatter.format(_make_record()))

        self.assertEqual(payload['level'], 'INFO')
        self.assertEqual(payload['service'], 'osmo-test')
        self.assertEqual(payload['module'], 'test_logging')
        self.assertEqual(payload['message'], 'hello world')
        self.assertIn('timestamp', payload)
        self.assertNotIn('backend', payload)
        self.assertNotIn('workflow_uuid', payload)
        self.assertNotIn('exception', payload)

    def test_backend_field_emitted_for_backend_loggers(self):
        formatter = logging_utils.JsonServiceFormatter(
            service='osmo-test', backend='aws'
        )
        payload = json.loads(formatter.format(_make_record()))
        self.assertEqual(payload['backend'], 'aws')

    def test_workflow_uuid_propagated_when_present(self):
        formatter = logging_utils.JsonServiceFormatter(service='osmo-test')
        payload = json.loads(formatter.format(_make_record(workflow_uuid='wf-123')))
        self.assertEqual(payload['workflow_uuid'], 'wf-123')

    def test_exception_traceback_included(self):
        try:
            raise ValueError('boom')
        except ValueError:
            import sys
            exc_info = sys.exc_info()
        formatter = logging_utils.JsonServiceFormatter(service='osmo-test')
        payload = json.loads(formatter.format(_make_record(exc_info=exc_info)))
        self.assertIn('exception', payload)
        self.assertIn('ValueError', payload['exception'])
        self.assertIn('boom', payload['exception'])

    def test_output_is_single_line(self):
        formatter = logging_utils.JsonServiceFormatter(service='osmo-test')
        rendered = formatter.format(
            _make_record(message='line one\nline two', workflow_uuid='wf-123')
        )
        self.assertNotIn('\n', rendered)
        payload = json.loads(rendered)
        self.assertEqual(payload['message'], 'line one\nline two')


class TestMakeServiceFormatter(unittest.TestCase):
    """Unit tests for the formatter factory."""

    def test_text_format_returns_service_formatter(self):
        config = logging_utils.LoggingConfig(log_format='text')
        # pylint: disable=protected-access
        formatter = logging_utils._make_service_formatter('osmo-test', config)
        self.assertIsInstance(formatter, logging_utils.ServiceFormatter)
        self.assertNotIsInstance(formatter, logging_utils.JsonServiceFormatter)

    def test_json_format_returns_json_formatter(self):
        config = logging_utils.LoggingConfig(log_format='json')
        # pylint: disable=protected-access
        formatter = logging_utils._make_service_formatter(
            'osmo-test', config, backend='aws'
        )
        self.assertIsInstance(formatter, logging_utils.JsonServiceFormatter)
        payload = json.loads(formatter.format(_make_record()))
        self.assertEqual(payload['service'], 'osmo-test')
        self.assertEqual(payload['backend'], 'aws')


if __name__ == '__main__':
    unittest.main()
