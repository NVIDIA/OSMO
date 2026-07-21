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

import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest


RUNNER = pathlib.Path(__file__).with_name('run_migrations.sh')
MIGRATION_FILES = (
    '001_v6_0_0_data_prep.json',
    '002_v6_0_0_schema.json',
    '003_v6_2_0_schema.json',
    '004_v6_2_0_data.json',
    '005_v6_3_0_schema.json',
)


class RunMigrationsTest(unittest.TestCase):
    """Behavior tests for the pgroll migration runner."""

    def setUp(self) -> None:
        temporary_path = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, temporary_path)
        self.binary_directory = temporary_path / 'bin'
        self.binary_directory.mkdir()
        self.pgroll_log = temporary_path / 'pgroll.log'
        self.psql_log = temporary_path / 'psql.log'
        self.status_count = temporary_path / 'status-count'
        self._write_executable('psql', r"""#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MIGRATION_TEST_PSQL_LOG"
if [[ "$*" == *"AS v6_2_schema_current"* ]]; then
    if [[ "$MIGRATION_TEST_V6_2_SCHEMA" == 'true' ]]; then
        printf 't\n'
    else
        printf 'f\n'
    fi
elif [[ "$*" == *"AS v6_0_schema_current"* ]]; then
    if [[ "$MIGRATION_TEST_V6_0_SCHEMA" == 'true' ]]; then
        printf 't\n'
    else
        printf 'f\n'
    fi
elif [[ "$*" == *"last_usage_updated"* ]]; then
    if [[ "$MIGRATION_TEST_RELEASED_SCHEMA" == 'true' ]]; then
        printf 't\n'
    else
        printf 'f\n'
    fi
elif [[ "$*" == *"migration_type = 'baseline'"* ]]; then
    printf '%s\n' "$MIGRATION_TEST_BASELINE"
elif [[ "$*" == *"to_regclass('public.workflows')"* ]]; then
    if [[ "$MIGRATION_TEST_HAS_OSMO_SCHEMA" == 'true' ]]; then
        printf 't\n'
    else
        printf 'f\n'
    fi
elif [[ "$*" == *"done = false"* ]]; then
    if [[ "$MIGRATION_TEST_ACTIVE_MIGRATION" == 'true' ]]; then
        printf 't\n'
    else
        printf 'f\n'
    fi
elif [[ "$*" == *"FROM pgroll.migrations"* ]]; then
    if [[ -n "$MIGRATION_TEST_BASELINE" \
          && "$*" == *"name = '$MIGRATION_TEST_BASELINE'"* ]]; then
        printf 't\n'
        exit 0
    fi
    IFS=',' read -ra applied_migrations <<< "$MIGRATION_TEST_APPLIED"
    for applied_migration in "${applied_migrations[@]}"; do
        if [[ -n "$applied_migration" \
              && "$*" == *"name = '$applied_migration'"* ]]; then
            printf 't\n'
            exit 0
        fi
    done
    printf 'f\n'
fi
""")
        self._write_executable('pgroll', r"""#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MIGRATION_TEST_PGROLL_LOG"
case "$1" in
    init)
        if [[ "$MIGRATION_TEST_FAIL_COMMAND" == 'init' ]]; then
            printf 'simulated init failure\n' >&2
            exit 41
        fi
        exit 0
        ;;
    status)
        status_count=0
        if [[ -f "$MIGRATION_TEST_STATUS_COUNT" ]]; then
            read -r status_count < "$MIGRATION_TEST_STATUS_COUNT"
        fi
        status_count=$((status_count + 1))
        printf '%s\n' "$status_count" > "$MIGRATION_TEST_STATUS_COUNT"
        if [[ "$MIGRATION_TEST_FAIL_COMMAND" == 'status_initial' \
              && "$status_count" -eq 1 ]]; then
            printf 'simulated initial status failure\n' >&2
            exit 42
        fi
        if [[ "$MIGRATION_TEST_FAIL_COMMAND" == 'status_final' \
              && "$status_count" -eq 2 ]]; then
            printf 'simulated final status failure\n' >&2
            exit 43
        fi
        if [[ "$MIGRATION_TEST_NO_HISTORY" == 'true' ]]; then
            printf '{"status": "No migrations"}\n'
        else
            printf '{"status": "Complete"}\n'
        fi
        exit 0
        ;;
    baseline)
        if [[ "$MIGRATION_TEST_FAIL_COMMAND" == 'baseline' ]]; then
            printf 'simulated baseline failure\n' >&2
            exit 44
        fi
        exit 0
        ;;
    complete)
        if [[ "$MIGRATION_TEST_FAIL_COMMAND" == 'complete' ]]; then
            printf 'simulated complete failure\n' >&2
            exit 45
        fi
        if [[ "$MIGRATION_TEST_COMPLETE_SUCCEEDS" == 'true' ]]; then
            exit 0
        fi
        printf 'no migration in progress\n' >&2
        exit 46
        ;;
    start)
        migration_name="$(basename "$2")"
        if [[ "$migration_name" == "$MIGRATION_TEST_FAIL_MIGRATION" ]]; then
            printf 'simulated pgroll failure for %s\n' "$migration_name" >&2
            exit 47
        fi
        exit 0
        ;;
esac
exit 48
""")

    def _write_executable(self, name: str, contents: str) -> None:
        path = self.binary_directory / name
        path.write_text(contents, encoding='utf-8')
        path.chmod(0o755)

    def _run(
        self,
        *,
        active_migration: bool = False,
        applied_migrations: str = '',
        baseline_migration: str = '',
        complete_succeeds: bool = False,
        failing_command: str = '',
        failing_migration: str = '',
        has_osmo_schema: bool = False,
        no_history: bool = False,
        released_schema: bool = False,
        target_schema: str = 'public_v6_3_0',
        v6_0_schema: bool = False,
        v6_2_schema: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        self.pgroll_log.unlink(missing_ok=True)
        self.psql_log.unlink(missing_ok=True)
        self.status_count.unlink(missing_ok=True)

        environment = os.environ.copy()
        existing_path = environment['PATH']
        environment.update({
            'MIGRATION_TEST_ACTIVE_MIGRATION':
                str(active_migration).lower(),
            'MIGRATION_TEST_APPLIED': applied_migrations,
            'MIGRATION_TEST_BASELINE': baseline_migration,
            'MIGRATION_TEST_COMPLETE_SUCCEEDS':
                str(complete_succeeds).lower(),
            'MIGRATION_TEST_FAIL_COMMAND': failing_command,
            'MIGRATION_TEST_FAIL_MIGRATION': failing_migration,
            'MIGRATION_TEST_HAS_OSMO_SCHEMA':
                str(has_osmo_schema).lower(),
            'MIGRATION_TEST_NO_HISTORY': str(no_history).lower(),
            'MIGRATION_TEST_PGROLL_LOG': str(self.pgroll_log),
            'MIGRATION_TEST_PSQL_LOG': str(self.psql_log),
            'MIGRATION_TEST_RELEASED_SCHEMA':
                str(released_schema).lower(),
            'MIGRATION_TEST_STATUS_COUNT': str(self.status_count),
            'MIGRATION_TEST_V6_0_SCHEMA': str(v6_0_schema).lower(),
            'MIGRATION_TEST_V6_2_SCHEMA': str(v6_2_schema).lower(),
            'OSMO_POSTGRES_PASSWORD': 'test-password',
            'PATH': f'{self.binary_directory}:{existing_path}',
        })
        return subprocess.run(
            ['bash', str(RUNNER), target_schema],
            check=False,
            capture_output=True,
            env=environment,
            text=True,
            timeout=10,
        )

    def _pgroll_calls(self) -> list[str]:
        return self.pgroll_log.read_text(encoding='utf-8').splitlines()

    def _start_migrations(self) -> list[str]:
        return [
            pathlib.Path(call.split()[1]).name
            for call in self._pgroll_calls()
            if call.startswith('start ')
        ]

    def test_runs_all_migrations_and_refreshes_versioned_views(self) -> None:
        result = self._run()

        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(list(MIGRATION_FILES), self._start_migrations())
        psql_calls = self.psql_log.read_text(encoding='utf-8')
        self.assertIn('CREATE OR REPLACE VIEW public_v6_3_0.', psql_calls)

    def test_pgroll_status_and_init_failures_exit_nonzero(self) -> None:
        for failing_command, expected_message in (
            ('init', 'Failed to initialize pgroll'),
            ('status_initial', 'Failed to read pgroll status'),
            ('status_final', 'Failed to read final pgroll status'),
        ):
            with self.subTest(failing_command=failing_command):
                result = self._run(
                    failing_command=failing_command,
                    target_schema='public',
                )

                self.assertNotEqual(
                    0, result.returncode, result.stdout + result.stderr)
                self.assertIn(
                    expected_message, result.stdout + result.stderr)

    def test_active_migration_completion_failure_exits_nonzero(self) -> None:
        result = self._run(
            active_migration=True,
            failing_command='complete',
            target_schema='public',
        )

        self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn(
            'Failed to complete the active migration',
            result.stdout + result.stderr,
        )
        self.assertFalse(self._start_migrations())

    def test_active_migration_is_completed_before_new_migrations(self) -> None:
        result = self._run(
            active_migration=True,
            complete_succeeds=True,
            target_schema='public',
        )

        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        pgroll_calls = self._pgroll_calls()
        complete_index = pgroll_calls.index('complete --postgres-url '
                                            'postgres://postgres:'
                                            'test-password@localhost:5432/'
                                            'osmo_db?sslmode=require')
        first_start_index = next(
            index
            for index, call in enumerate(pgroll_calls)
            if call.startswith('start ')
        )
        self.assertLess(complete_index, first_start_index)

    def test_baseline_creation_failure_exits_nonzero(self) -> None:
        result = self._run(
            failing_command='baseline',
            has_osmo_schema=True,
            no_history=True,
            target_schema='public',
        )

        self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn(
            'Failed to create pgroll baseline',
            result.stdout + result.stderr,
        )
        self.assertFalse(self._start_migrations())

    def test_pgroll_start_failure_exits_nonzero(self) -> None:
        result = self._run(
            failing_migration='005_v6_3_0_schema.json',
            target_schema='public',
        )

        self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn(
            'simulated pgroll failure', result.stdout + result.stderr)

    def test_existing_schema_without_history_replays_untracked_data(self) -> None:
        result = self._run(
            has_osmo_schema=True,
            no_history=True,
            target_schema='public',
            v6_0_schema=True,
            v6_2_schema=True,
        )

        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertTrue(any(
            call.startswith('baseline 000_baseline ')
            for call in self._pgroll_calls()
        ))
        self.assertEqual(
            [
                '001_v6_0_0_data_prep.json',
                '004_v6_2_0_data.json',
                '005_v6_3_0_schema.json',
            ],
            self._start_migrations(),
        )

    def test_completed_migrations_are_not_started_again(self) -> None:
        result = self._run(
            applied_migrations=','.join(
                migration_file.removesuffix('.json')
                for migration_file in MIGRATION_FILES
            ),
            released_schema=True,
            target_schema='public',
            v6_0_schema=True,
            v6_2_schema=True,
        )

        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertFalse(self._start_migrations())

    def test_recorded_005_requires_its_resources_columns(self) -> None:
        result = self._run(
            applied_migrations='005_v6_3_0_schema',
            target_schema='public',
            v6_0_schema=True,
            v6_2_schema=True,
        )

        self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn(
            'covered by pgroll history', result.stdout + result.stderr)
        self.assertIn(
            'resources columns are missing', result.stdout + result.stderr)
        self.assertFalse(self._start_migrations())

    def test_005_baseline_requires_its_resources_columns(self) -> None:
        result = self._run(
            baseline_migration='005_v6_3_0_schema',
            target_schema='public',
            v6_0_schema=True,
            v6_2_schema=True,
        )

        self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn(
            'covered by pgroll history', result.stdout + result.stderr)
        self.assertIn(
            'resources columns are missing', result.stdout + result.stderr)
        self.assertFalse(self._start_migrations())

    def test_valid_005_baseline_covers_released_migrations(self) -> None:
        result = self._run(
            baseline_migration='005_v6_3_0_schema',
            released_schema=True,
            target_schema='public',
            v6_0_schema=True,
            v6_2_schema=True,
        )

        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertFalse(self._start_migrations())

    def test_004_baseline_does_not_cover_005(self) -> None:
        result = self._run(
            baseline_migration='004_v6_2_0_data',
            target_schema='public',
            v6_0_schema=True,
            v6_2_schema=True,
        )

        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(
            ['005_v6_3_0_schema.json'], self._start_migrations())

    def test_sparse_history_with_data_records_runs_only_005(self) -> None:
        result = self._run(
            applied_migrations=','.join([
                '001_v6_0_0_data_prep',
                '004_v6_2_0_data',
            ]),
            baseline_migration='000_baseline',
            target_schema='public',
            v6_0_schema=True,
            v6_2_schema=True,
        )

        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(
            ['005_v6_3_0_schema.json'], self._start_migrations())

    def test_sparse_history_replays_each_missing_data_migration(self) -> None:
        for applied_migrations, expected_starts in (
            (
                '001_v6_0_0_data_prep',
                [
                    '004_v6_2_0_data.json',
                    '005_v6_3_0_schema.json',
                ],
            ),
            (
                '004_v6_2_0_data',
                [
                    '001_v6_0_0_data_prep.json',
                    '005_v6_3_0_schema.json',
                ],
            ),
        ):
            with self.subTest(applied_migrations=applied_migrations):
                result = self._run(
                    applied_migrations=applied_migrations,
                    baseline_migration='000_baseline',
                    target_schema='public',
                    v6_0_schema=True,
                    v6_2_schema=True,
                )

                self.assertEqual(
                    0, result.returncode, result.stdout + result.stderr)
                self.assertEqual(expected_starts, self._start_migrations())

    def test_sparse_v6_0_schema_skips_only_present_structure(self) -> None:
        result = self._run(
            applied_migrations='001_v6_0_0_data_prep',
            baseline_migration='000_baseline',
            target_schema='public',
            v6_0_schema=True,
        )

        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(
            [
                '003_v6_2_0_schema.json',
                '004_v6_2_0_data.json',
                '005_v6_3_0_schema.json',
            ],
            self._start_migrations(),
        )

    def test_inconsistent_structural_fingerprint_is_not_skipped(self) -> None:
        result = self._run(
            applied_migrations=','.join([
                '001_v6_0_0_data_prep',
                '004_v6_2_0_data',
            ]),
            baseline_migration='000_baseline',
            failing_migration='002_v6_0_0_schema.json',
            target_schema='public',
            v6_2_schema=True,
        )

        self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn(
            'Failed to apply 002_v6_0_0_schema.json',
            result.stdout + result.stderr,
        )

    def test_unknown_baseline_does_not_cover_005(self) -> None:
        result = self._run(
            applied_migrations=','.join([
                '001_v6_0_0_data_prep',
                '002_v6_0_0_schema',
                '003_v6_2_0_schema',
                '004_v6_2_0_data',
            ]),
            baseline_migration='006_future_migration',
            target_schema='public',
            v6_0_schema=True,
            v6_2_schema=True,
        )

        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(
            ['005_v6_3_0_schema.json'], self._start_migrations())


if __name__ == '__main__':
    unittest.main()
