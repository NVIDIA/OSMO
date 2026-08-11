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
import argparse
import os
import tempfile
from typing import cast
import unittest

from src.lib.utils import osmo_errors, validation


class TestPositiveInteger(unittest.TestCase):
    """Tests for validation.positive_integer."""

    def test_positive_integer_accepts_positive_int(self):
        self.assertEqual(validation.positive_integer(5), 5)

    def test_positive_integer_rejects_zero(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_integer(0)

    def test_positive_integer_rejects_negative(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_integer(-1)


class TestPositiveFloat(unittest.TestCase):
    """Tests for validation.positive_float."""

    def test_positive_float_accepts_positive_float(self):
        self.assertEqual(validation.positive_float(1.5), 1.5)

    def test_positive_float_rejects_zero(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_float(0.0)

    def test_positive_float_rejects_negative(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_float(-0.1)


class TestNonNegativeInteger(unittest.TestCase):
    """Tests for validation.non_negative_integer."""

    def test_non_negative_integer_accepts_zero(self):
        self.assertEqual(validation.non_negative_integer(0), 0)

    def test_non_negative_integer_accepts_positive(self):
        self.assertEqual(validation.non_negative_integer(10), 10)

    def test_non_negative_integer_rejects_negative(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.non_negative_integer(-1)


class TestIsRegex(unittest.TestCase):
    """Tests for validation.is_regex."""

    def test_is_regex_returns_valid_pattern(self):
        self.assertEqual(validation.is_regex(r'^\d+$'), r'^\d+$')

    def test_is_regex_accepts_empty_string(self):
        self.assertEqual(validation.is_regex(''), '')

    def test_is_regex_rejects_invalid_pattern(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_regex('[invalid')


class TestIsStoragePath(unittest.TestCase):
    """Tests for validation.is_storage_path."""

    def test_is_storage_path_accepts_s3(self):
        self.assertEqual(validation.is_storage_path('s3://bucket'), 's3://bucket')

    def test_is_storage_path_accepts_swift(self):
        path = 'swift://account/container/object'
        self.assertEqual(validation.is_storage_path(path), path)

    def test_is_storage_path_accepts_gs(self):
        self.assertEqual(validation.is_storage_path('gs://bucket'), 'gs://bucket')

    def test_is_storage_path_rejects_bare_path(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_path('/local/path')

    def test_is_storage_path_rejects_unknown_scheme(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_path('ftp://bucket')


class TestIsStorageCredentialPath(unittest.TestCase):
    """Tests for validation.is_storage_credential_path."""

    def test_is_storage_credential_path_accepts_s3(self):
        self.assertEqual(
            validation.is_storage_credential_path('s3://bucket'),
            's3://bucket',
        )

    def test_is_storage_credential_path_accepts_azure_profile(self):
        path = 'azure://account'
        self.assertEqual(validation.is_storage_credential_path(path), path)

    def test_is_storage_credential_path_rejects_bare_path(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_credential_path('/local/path')


class TestValidPath(unittest.TestCase):
    """Tests for validation.valid_path."""

    def test_valid_path_accepts_existing_file(self):
        with tempfile.NamedTemporaryFile() as tmp:
            self.assertEqual(validation.valid_path(tmp.name), os.path.abspath(tmp.name))

    def test_valid_path_accepts_existing_directory(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            self.assertEqual(validation.valid_path(tmp_dir), os.path.abspath(tmp_dir))

    def test_valid_path_rejects_missing(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            missing_path = os.path.join(tmp_dir, 'does-not-exist')
            with self.assertRaises(osmo_errors.OSMOUserError):
                validation.valid_path(missing_path)


class TestValidFilePath(unittest.TestCase):
    """Tests for validation.valid_file_path."""

    def test_valid_file_path_accepts_nonexistent(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = os.path.join(tmp_dir, 'new-file.txt')
            self.assertEqual(validation.valid_file_path(path), path)

    def test_valid_file_path_rejects_directory(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            with self.assertRaises(argparse.ArgumentTypeError):
                validation.valid_file_path(tmp_dir)

    def test_valid_file_path_rejects_existing_file(self):
        with tempfile.NamedTemporaryFile() as tmp:
            with self.assertRaises(argparse.ArgumentTypeError):
                validation.valid_file_path(tmp.name)


class TestDateStr(unittest.TestCase):
    """Tests for validation.date_str."""

    def test_date_str_accepts_valid_date(self):
        self.assertEqual(validation.date_str('2026-05-13'), '2026-05-13')

    def test_date_str_rejects_invalid_format(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.date_str('05/13/2026')

    def test_date_str_rejects_datetime(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.date_str('2026-05-13T12:00:00')


class TestDatetimeStr(unittest.TestCase):
    """Tests for validation.datetime_str."""

    def test_datetime_str_accepts_valid_datetime(self):
        self.assertEqual(
            validation.datetime_str('2026-05-13T12:34:56'),
            '2026-05-13T12:34:56',
        )

    def test_datetime_str_rejects_date_only(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.datetime_str('2026-05-13')

    def test_datetime_str_rejects_invalid(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.datetime_str('not-a-datetime')


class TestDateOrDatetimeStr(unittest.TestCase):
    """Tests for validation.date_or_datetime_str."""

    def test_date_or_datetime_str_accepts_date(self):
        self.assertEqual(
            validation.date_or_datetime_str('2026-05-13'),
            '2026-05-13',
        )

    def test_date_or_datetime_str_accepts_datetime(self):
        self.assertEqual(
            validation.date_or_datetime_str('2026-05-13T12:34:56'),
            '2026-05-13T12:34:56',
        )

    def test_date_or_datetime_str_rejects_invalid(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.date_or_datetime_str('not-a-date')


class TestSanitizedPath(unittest.TestCase):
    """Tests for validation.sanitized_path."""

    def test_sanitized_path_returns_none_for_empty_string(self):
        self.assertIsNone(validation.sanitized_path(''))

    def test_sanitized_path_collapses_double_slashes(self):
        self.assertEqual(validation.sanitized_path('/foo//bar'), '/foo/bar')

    def test_sanitized_path_strips_trailing_slash(self):
        self.assertEqual(validation.sanitized_path('/foo/bar/'), '/foo/bar')

    def test_sanitized_path_collapses_resolvable_parent(self):
        self.assertEqual(validation.sanitized_path('/foo/../bar'), '/bar')

    def test_sanitized_path_rejects_unresolvable_parent_traversal(self):
        self.assertIsNone(validation.sanitized_path('../etc/passwd'))


class TestWorkflowLabelValidation(unittest.TestCase):
    """Tests for the workflow label validation helpers."""

    def test_accepts_kubernetes_label_key_and_nonempty_value(self):
        self.assertEqual(validation.validate_workflow_label_key('PPP'), 'PPP')
        self.assertEqual(
            validation.validate_workflow_label_key('example.com/experiment'),
            'example.com/experiment',
        )
        self.assertEqual(
            validation.validate_workflow_label_value('run_42.alpha'),
            'run_42.alpha',
        )

    def test_accepts_any_syntactically_valid_key(self):
        # No deny-list: system-owned pod labels are protected by merge order
        # at stamping time, so even system-domain keys validate here.
        for key in (
            'app.kubernetes.io/name',
            'topology.kubernetes.io/zone',
            'osmo.workflow_uuid',
            'kai.scheduler/queue',
            'runai/queue',
            'example-kubernetes.io/name',
        ):
            with self.subTest(key=key):
                self.assertEqual(validation.validate_workflow_label_key(key), key)

    def test_rejects_invalid_key_syntax(self):
        for key in ('', '/name', 'UPPER.example.com/name', 'example.com/', '-name'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                validation.validate_workflow_label_key(key)

    def test_rejects_empty_or_invalid_value(self):
        for value in ('', '-value', 'value/', 'x' * 64):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validation.validate_workflow_label_value(value)

    def test_rejects_more_than_sixteen_labels(self):
        labels = {f'label-{index}': 'value' for index in range(17)}
        with self.assertRaisesRegex(ValueError, 'at most 16'):
            validation.validate_workflow_labels(labels)

    def test_rejects_non_string_label_values(self):
        labels = cast(
            dict[str, str],
            {'PPP': {'team': 'robotics'}},
        )
        with self.assertRaisesRegex(ValueError, 'values must be strings'):
            validation.validate_workflow_labels(labels)

    def test_parse_assignment_returns_validated_key_and_value(self):
        self.assertEqual(
            validation.parse_workflow_label_assignment('experiment=run42'),
            ('experiment', 'run42'),
        )

    def test_parse_assignment_rejects_invalid_value(self):
        with self.assertRaises(ValueError):
            validation.parse_workflow_label_assignment('experiment=run=42')

    def test_parse_assignment_rejects_missing_equals(self):
        with self.assertRaisesRegex(ValueError, 'key=value'):
            validation.parse_workflow_label_assignment('experiment')

    def test_parse_assignment_rejects_selector_syntax(self):
        for assignment in (
            'PPP=*',
            'PPP=robotics_*',
            'PPP=(team_a|team_b)',
            'PPP=team_(a|b)',
        ):
            with self.subTest(assignment=assignment), self.assertRaises(ValueError):
                validation.parse_workflow_label_assignment(assignment)

    def test_parse_exact_label_selector(self):
        self.assertEqual(
            validation.parse_workflow_label_selector('PPP=robotics'),
            validation.WorkflowLabelSelector(
                key='PPP',
                values=('robotics',),
            ),
        )

    def test_parse_glob_selector_collapses_wildcard_runs(self):
        self.assertEqual(
            validation.parse_workflow_label_selector('PPP=robotics_**'),
            validation.WorkflowLabelSelector(
                key='PPP',
                values=('robotics_*',),
            ),
        )

    def test_parse_match_all_label_selector(self):
        self.assertEqual(
            validation.parse_workflow_label_selector('PPP=*'),
            validation.WorkflowLabelSelector(
                key='PPP',
                values=('*',),
            ),
        )

    def test_parse_alternation_label_selector(self):
        self.assertEqual(
            validation.parse_workflow_label_selector('PPP=(team_a|team_b)'),
            validation.WorkflowLabelSelector(
                key='PPP',
                values=('team_a', 'team_b'),
            ),
        )

    def test_parse_wildcard_alternatives(self):
        self.assertEqual(
            validation.parse_workflow_label_selector('PPP=(team_*|osmo_*)'),
            validation.WorkflowLabelSelector(
                key='PPP',
                values=('team_*', 'osmo_*'),
            ),
        )

    def test_parse_inline_alternatives(self):
        self.assertEqual(
            validation.parse_workflow_label_selector('PPP=team_(a|b)'),
            validation.WorkflowLabelSelector(
                key='PPP',
                values=('team_a', 'team_b'),
            ),
        )

    def test_parse_multiple_flat_groups(self):
        self.assertEqual(
            validation.parse_workflow_label_selector(
                'PPP=(team|osmo)_(a|b*)'),
            validation.WorkflowLabelSelector(
                key='PPP',
                values=('team_a', 'team_b*', 'osmo_a', 'osmo_b*'),
            ),
        )

    def test_selector_rejects_missing_separator(self):
        with self.assertRaisesRegex(ValueError, 'selectors must use key=value'):
            validation.parse_workflow_label_selector('PPP')

    def test_selector_rejects_unwrapped_or_unbalanced_alternation(self):
        for selector in (
            'PPP=team_a|team_b',
            'PPP=(team_a|team_b',
            'PPP=team_a|team_b)',
        ):
            with self.subTest(selector=selector), self.assertRaisesRegex(
                    ValueError, r'alternatives must use \(value\|value\)'):
                validation.parse_workflow_label_selector(selector)

    def test_selector_rejects_empty_or_single_alternation(self):
        for selector in (
            'PPP=()',
            'PPP=(team_a)',
            'PPP=(team_a|)',
            'PPP=(|team_b)',
        ):
            with self.subTest(selector=selector), self.assertRaisesRegex(
                    ValueError, 'at least two non-empty values'):
                validation.parse_workflow_label_selector(selector)

    def test_selector_rejects_nested_alternation(self):
        for selector in (
            'PPP=((team_a|team_b))',
            'PPP=(team_a|(team_b|team_c))',
        ):
            with self.subTest(selector=selector), self.assertRaisesRegex(
                    ValueError, 'cannot be nested'):
                validation.parse_workflow_label_selector(selector)

    def test_selector_rejects_invalid_literal_pattern_characters(self):
        for selector in (
            'PPP=team[ab]',
            'PPP=team?',
            'PPP=team=value',
        ):
            with self.subTest(selector=selector), self.assertRaises(ValueError):
                validation.parse_workflow_label_selector(selector)

    def test_selector_accepts_max_expanded_patterns(self):
        parsed_selector = validation.parse_workflow_label_selector(
            f"PPP={'(a|b)' * 5}")
        self.assertEqual(len(parsed_selector.values), 32)

    def test_selector_rejects_too_many_expanded_patterns(self):
        alternatives = '|'.join(
            f'team_{index}'
            for index in range(
                validation.MAX_WORKFLOW_LABEL_SELECTOR_PATTERNS + 1)
        )
        for selector in (
            f'PPP=({alternatives})',
            f"PPP={'(a|b)' * 6}",
        ):
            with self.subTest(selector=selector), self.assertRaisesRegex(
                    ValueError, 'at most 32 patterns'):
                validation.parse_workflow_label_selector(selector)

    def test_selector_rejects_glob_longer_than_label_limit(self):
        with self.assertRaises(ValueError):
            validation.parse_workflow_label_selector('PPP=' + 'x' * 63 + '*')

    def test_selector_rejects_oversized_raw_value_before_parsing(self):
        oversized_selector = (
            'PPP='
            + 'x' * validation.MAX_WORKFLOW_LABEL_SELECTOR_BYTES
        )

        with self.assertRaisesRegex(ValueError, 'at most 4096 bytes'):
            validation.parse_workflow_label_selector(oversized_selector)

    def test_selector_rejects_non_string(self):
        with self.assertRaisesRegex(ValueError, 'must be strings'):
            validation.parse_workflow_label_selector(
                None)  # type: ignore[arg-type]

    def test_selector_rejects_invalid_utf8(self):
        with self.assertRaisesRegex(ValueError, 'valid UTF-8'):
            validation.parse_workflow_label_selector('PPP=\ud800')


class TestPodLabelPrefix(unittest.TestCase):
    """Tests for the pod-label prefix merge and its validation."""

    def test_empty_prefix_returns_keys_unchanged(self):
        labels = {'PPP': 'aurora', 'team': 'alpha'}
        self.assertEqual(validation.apply_pod_label_prefix(labels, ''), labels)

    def test_prefix_is_prepended_to_every_key(self):
        self.assertEqual(
            validation.apply_pod_label_prefix(
                {'PPP': 'aurora', 'team': 'alpha'}, 'example.com/'),
            {'example.com/PPP': 'aurora', 'example.com/team': 'alpha'},
        )

    def test_non_dns_prefix_is_prepended_verbatim(self):
        # The prefix is opaque; a bare (non-slash) prefix is merged as-is.
        self.assertEqual(
            validation.apply_pod_label_prefix({'PPP': 'aurora'}, 'osmo_'),
            {'osmo_PPP': 'aurora'},
        )

    def test_empty_prefix_validation_is_a_no_op(self):
        validation.validate_prefixed_workflow_label_keys(
            {'anything/goes': 'value'}, '')

    def test_valid_merged_keys_pass_validation(self):
        validation.validate_prefixed_workflow_label_keys(
            {'PPP': 'aurora', 'team': 'alpha'}, 'example.com/')

    def test_merged_key_with_two_slashes_is_rejected(self):
        # A user key that already carries its own prefix would form a
        # double-slash key once the pod-label prefix is prepended.
        with self.assertRaisesRegex(
                ValueError, r'example\.com/team\.example\.com/role'):
            validation.validate_prefixed_workflow_label_keys(
                {'team.example.com/role': 'lead'}, 'example.com/')

    def test_error_names_the_key_and_prefix(self):
        with self.assertRaises(ValueError) as raised:
            validation.validate_prefixed_workflow_label_keys(
                {'team.example.com/role': 'lead'}, 'example.com/')
        message = str(raised.exception)
        self.assertIn('team.example.com/role', message)
        self.assertIn('example.com/', message)


if __name__ == '__main__':
    unittest.main()
