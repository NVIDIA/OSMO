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

import datetime
import types
from typing import cast
import unittest
from unittest import mock

from src.lib.utils import osmo_errors
from src.service.core.workflow import objects
from src.utils import connectors
from src.utils.job import common as task_common, workflow


def _label_policy(
        key: str,
        enforcement: connectors.LabelEnforcement,
        allow_list: list[str] | None = None,
        assert_message: str = '',
) -> connectors.LabelPolicy:
    return connectors.LabelPolicy(
        key=key,
        enforcement=enforcement,
        allow_list=allow_list if allow_list is not None else [],
        assert_message=assert_message,
    )


def _submit_info(
        policy: list[connectors.LabelPolicy],
        pod_label_prefix: str = '') -> objects.WorkflowSubmitInfo:
    database = mock.Mock()
    database.get_workflow_configs.return_value = types.SimpleNamespace(
        labels_config=types.SimpleNamespace(
            policy=policy, pod_label_prefix=pod_label_prefix),
    )
    context = cast(
        objects.WorkflowServiceContext,
        types.SimpleNamespace(database=database),
    )
    return objects.WorkflowSubmitInfo.model_construct(
        context=context,
        base32_id='uuid-1',
        name='workflow-1',
        user='user-1',
        pool='pool-1',
        backend='backend-1',
    )


def _rendered_spec(labels: dict[str, str]) -> workflow.WorkflowSpec:
    return cast(workflow.WorkflowSpec, types.SimpleNamespace(labels=labels))


class TestWorkflowLabelOverrides(unittest.TestCase):
    """Covers CLI/YAML/canonical label merging in construct_workflow_dict."""

    def test_cli_overrides_are_applied_after_render_and_last_value_wins(self):
        submit_info = _submit_info([])
        template_spec = mock.Mock()
        template_spec.load_template_with_variables.return_value = '''
version: 2
workflow:
  name: workflow
  labels:
    team: yaml
    existing: value
'''

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(backend='backend-1')):
            result = submit_info.construct_workflow_dict(
                template_spec,
                label_overrides=['team=first', 'team=cli', 'detail=nested'],
            )

        self.assertEqual(
            result['workflow']['labels'],
            {'team': 'cli', 'existing': 'value', 'detail': 'nested'},
        )

    def test_canonical_labels_replace_yaml_before_cli_overrides(self):
        submit_info = _submit_info([])
        template_spec = mock.Mock()
        template_spec.load_template_with_variables.return_value = '''
version: 2
workflow:
  name: workflow
  labels:
    team: stale-yaml
    removed: stale-yaml
'''

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(backend='backend-1')):
            result = submit_info.construct_workflow_dict(
                template_spec,
                label_overrides=['team=cli', 'new=override'],
                canonical_labels={'team': 'database', 'kept': 'database'},
            )

        self.assertEqual(
            result['workflow']['labels'],
            {'team': 'cli', 'kept': 'database', 'new': 'override'},
        )

    def test_empty_canonical_labels_remove_stale_yaml_labels(self):
        submit_info = _submit_info([])
        template_spec = mock.Mock()
        template_spec.load_template_with_variables.return_value = '''
version: 2
workflow:
  name: workflow
  labels:
    team: stale-yaml
'''

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(backend='backend-1')):
            result = submit_info.construct_workflow_dict(
                template_spec, canonical_labels={})

        self.assertEqual(result['workflow']['labels'], {})

    def test_invalid_label_override_does_not_create_failed_submission(self):
        submit_info = _submit_info([])
        template_spec = mock.Mock()
        template_spec.load_template_with_variables.return_value = '''
version: 2
workflow:
  name: workflow
'''

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(backend='backend-1')), \
             mock.patch.object(
                 objects.WorkflowSubmitInfo,
                 'insert_failed_submission_to_db') as insert_failed:
            with self.assertRaises(osmo_errors.OSMOUsageError):
                submit_info.construct_workflow_dict(
                    template_spec,
                    label_overrides=['missing-separator'],
                )

        insert_failed.assert_not_called()

    def test_invalid_yaml_label_does_not_create_failed_submission(self):
        submit_info = _submit_info([])
        template_spec = mock.Mock()
        template_spec.load_template_with_variables.return_value = '''
version: 2
workflow:
  name: workflow
  labels:
    bad/key/nested: value
'''

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(backend='backend-1')), \
             mock.patch.object(
                 objects.WorkflowSubmitInfo,
                 'insert_failed_submission_to_db') as insert_failed:
            with self.assertRaises(osmo_errors.OSMOUsageError):
                submit_info.construct_workflow_dict(template_spec)

        insert_failed.assert_not_called()

    def test_nested_yaml_label_does_not_create_failed_submission(self):
        submit_info = _submit_info([])
        template_spec = mock.Mock()
        template_spec.load_template_with_variables.return_value = '''
version: 2
workflow:
  name: workflow
  labels:
    project:
      team: alpha
'''

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(backend='backend-1')), \
             mock.patch.object(
                 objects.WorkflowSubmitInfo,
                 'insert_failed_submission_to_db') as insert_failed:
            with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
                submit_info.construct_workflow_dict(template_spec)

        self.assertIn('must be strings', raised.exception.message)
        insert_failed.assert_not_called()


class TestWorkflowLabelPolicy(unittest.TestCase):
    """Covers the submission gate in validate_workflow_label_policy."""

    def test_omitted_policy_accepts_missing_and_unlisted_values(self):
        submit_info = _submit_info([])
        rendered_spec = _rendered_spec({'team': 'other'})

        self.assertEqual(
            submit_info.validate_workflow_label_policy(rendered_spec),
            [],
        )

    def test_off_policy_accepts_missing_and_unlisted_values_without_metrics(self):
        submit_info = _submit_info([
            _label_policy('project', connectors.LabelEnforcement.OFF),
            _label_policy(
                'team', connectors.LabelEnforcement.OFF, ['alpha', 'beta']),
        ])
        rendered_spec = _rendered_spec({'team': 'other'})
        metric_creator = mock.Mock()

        with mock.patch.object(
                objects.metrics.MetricCreator,
                'get_meter_instance',
                return_value=metric_creator):
            warnings = submit_info.validate_workflow_label_policy(rendered_spec)

        self.assertEqual(warnings, [])
        metric_creator.send_counter.assert_not_called()

    def test_warn_returns_visible_warnings_for_missing_and_unlisted_values(self):
        submit_info = _submit_info([
            _label_policy('project', connectors.LabelEnforcement.WARN),
            _label_policy(
                'team', connectors.LabelEnforcement.WARN, ['alpha', 'beta']),
        ])
        rendered_spec = _rendered_spec({'team': 'other'})

        with self.assertLogs(level='WARNING') as captured:
            warnings = submit_info.validate_workflow_label_policy(rendered_spec)

        expected = [
            "Workflow is missing label 'project'; add it now to avoid rejected "
            "submissions once it is required.",
            "Workflow label 'team' has a value that is not allowed; use an allowed "
            "value now to avoid rejected submissions once the label is required.",
        ]
        self.assertEqual(warnings, expected)
        self.assertEqual(len(captured.output), 2)
        combined_output = '\n'.join([*warnings, *captured.output])
        for allowed_value in ('alpha', 'beta'):
            self.assertNotIn(allowed_value, combined_output)

    def test_warn_and_enforce_policies_advance_independently(self):
        submit_info = _submit_info([
            _label_policy('project', connectors.LabelEnforcement.WARN),
            _label_policy(
                'team', connectors.LabelEnforcement.ENFORCE, ['alpha']),
        ])
        rendered_spec = _rendered_spec({'team': 'alpha'})

        warnings = submit_info.validate_workflow_label_policy(rendered_spec)

        self.assertEqual(warnings, [
            "Workflow is missing label 'project'; add it now to avoid rejected "
            "submissions once it is required.",
        ])

    def test_enforce_violation_rejects_when_another_policy_only_warns(self):
        submit_info = _submit_info([
            _label_policy('project', connectors.LabelEnforcement.WARN),
            _label_policy(
                'team', connectors.LabelEnforcement.ENFORCE, ['alpha']),
        ])
        rendered_spec = _rendered_spec({'team': 'other'})

        with self.assertLogs(level='WARNING') as captured:
            with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
                submit_info.validate_workflow_label_policy(rendered_spec)

        self.assertEqual(
            raised.exception.message,
            "Workflow label 'team' has a value that is not allowed.",
        )
        self.assertIn(
            "Workflow is missing label 'project'; add it now to avoid rejected "
            "submissions once it is required.",
            '\n'.join(captured.output),
        )

    def test_policy_assert_message_is_appended_to_warn_and_enforce_messages(self):
        assert_message = 'Look up valid values in the registry.'
        warn_info = _submit_info([
            _label_policy(
                'project', connectors.LabelEnforcement.WARN, assert_message=assert_message),
        ])
        warnings = warn_info.validate_workflow_label_policy(_rendered_spec({}))
        self.assertEqual(
            warnings,
            ["Workflow is missing label 'project'; add it now to avoid rejected "
             f'submissions once it is required. {assert_message}'],
        )

        enforce_info = _submit_info([
            _label_policy(
                'project', connectors.LabelEnforcement.ENFORCE, assert_message=assert_message),
        ])
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            enforce_info.validate_workflow_label_policy(_rendered_spec({}))
        self.assertEqual(
            raised.exception.message,
            f"Workflow is missing required label 'project'. {assert_message}",
        )

    def test_warn_is_not_persisted_when_later_validation_fails(self):
        submit_info = _submit_info([
            _label_policy('team', connectors.LabelEnforcement.WARN, ['alpha']),
        ])
        rendered_spec = cast(workflow.WorkflowSpec, mock.Mock())
        rendered_spec.labels = {'team': 'other'}
        cast(mock.Mock, rendered_spec.validate_name_and_inputs).side_effect = \
            ValueError('invalid task')
        workflow_obj = mock.Mock()

        with mock.patch.object(
                objects.WorkflowSubmitInfo, 'build_workflow_object',
                return_value=workflow_obj) as build_workflow:
            with mock.patch.object(
                    objects.WorkflowSubmitInfo,
                    'send_workflow_spec_to_queue') as upload_spec:
                with self.assertRaises(ValueError):
                    submit_info.validate_workflow_spec(
                        rendered_spec,
                        group_and_task_uuids={},
                        roles=[],
                        original_templated_spec=None,
                    )

        self.assertNotIn('warnings', build_workflow.call_args.kwargs)
        workflow_obj.insert_to_db.assert_called_once_with()
        upload_spec.assert_called_once()

    def test_enforce_policy_rejections_have_no_submission_side_effects(self):
        cases = [
            (
                'missing',
                _label_policy('project', connectors.LabelEnforcement.ENFORCE),
                {},
                "Workflow is missing required label 'project'.",
                (),
            ),
            (
                'disallowed',
                _label_policy(
                    'team', connectors.LabelEnforcement.ENFORCE,
                    ['alpha', 'beta']),
                {'team': 'other'},
                "Workflow label 'team' has a value that is not allowed.",
                ('alpha', 'beta', 'other'),
            ),
        ]

        for case_id, label_policy, labels, message, undisclosed_values in cases:
            with self.subTest(case_id=case_id):
                submit_info = _submit_info([label_policy])
                rendered_spec = cast(workflow.WorkflowSpec, mock.Mock())
                rendered_spec.labels = labels

                with mock.patch.object(
                        objects.WorkflowSubmitInfo,
                        'build_workflow_object') as build_workflow, \
                     mock.patch.object(
                         objects.WorkflowSubmitInfo,
                         'insert_failed_submission_to_db') as insert_failed, \
                     mock.patch.object(
                         objects.WorkflowSubmitInfo,
                         'send_workflow_spec_to_queue') as upload_spec, \
                     mock.patch.object(
                         objects.jobs, 'SubmitWorkflow') as submit_workflow:
                    with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
                        submit_info.validate_workflow_spec(
                            rendered_spec,
                            group_and_task_uuids={},
                            roles=[],
                            original_templated_spec=None,
                        )

                self.assertEqual(raised.exception.message, message)
                for value in undisclosed_values:
                    self.assertNotIn(value, raised.exception.message)
                build_workflow.assert_not_called()
                insert_failed.assert_not_called()
                submit_workflow.assert_not_called()
                upload_spec.assert_not_called()
                submit_info.context.database.execute_commit_command.assert_not_called()

    def test_enforce_accepts_value_in_nonempty_allow_list(self):
        submit_info = _submit_info([
            _label_policy(
                'team', connectors.LabelEnforcement.ENFORCE, ['alpha', 'beta']),
        ])
        rendered_spec = _rendered_spec({'team': 'alpha'})

        self.assertEqual(
            submit_info.validate_workflow_label_policy(rendered_spec),
            [],
        )

    def test_empty_allow_list_accepts_any_valid_present_value(self):
        for enforcement in (
                connectors.LabelEnforcement.WARN,
                connectors.LabelEnforcement.ENFORCE):
            with self.subTest(enforcement=enforcement):
                submit_info = _submit_info([
                    _label_policy('project', enforcement, []),
                ])
                rendered_spec = _rendered_spec({'project': 'anything'})

                self.assertEqual(
                    submit_info.validate_workflow_label_policy(rendered_spec),
                    [],
                )

    def test_allow_list_values_are_not_disclosed(self):
        submit_info = _submit_info([
            _label_policy(
                'team',
                connectors.LabelEnforcement.WARN,
                ['one', 'two', 'three', 'four', 'five', 'six'],
            ),
        ])
        rendered_spec = _rendered_spec({'team': 'other'})

        warnings = submit_info.validate_workflow_label_policy(rendered_spec)

        self.assertEqual(
            [
                "Workflow label 'team' has a value that is not allowed; use an "
                "allowed value now to avoid rejected submissions once the label "
                "is required."
            ],
            warnings)
        for allowed_value in ('one', 'two', 'three', 'four', 'five', 'six'):
            self.assertNotIn(allowed_value, warnings[0])

    def test_validation_counter_records_all_bounded_outcomes(self):
        submit_info = _submit_info([
            _label_policy('off', connectors.LabelEnforcement.OFF),
            _label_policy('ok', connectors.LabelEnforcement.WARN, ['allowed']),
            _label_policy('missing', connectors.LabelEnforcement.WARN),
            _label_policy(
                'invalid', connectors.LabelEnforcement.WARN, ['allowed']),
            _label_policy('required', connectors.LabelEnforcement.ENFORCE),
        ])
        rendered_spec = _rendered_spec({
                'ok': 'allowed',
                'invalid': 'not-allowed',
            })
        metric_creator = mock.Mock()

        with mock.patch.object(
                objects.metrics.MetricCreator,
                'get_meter_instance',
                return_value=metric_creator):
            with self.assertRaises(osmo_errors.OSMOUsageError):
                submit_info.validate_workflow_label_policy(rendered_spec)

        expected_calls = [
            mock.call(
                name='osmo_label_validation_total',
                value=1,
                unit='count',
                description='Workflow label policy validation outcomes.',
                tags={'key': key, 'outcome': outcome},
            )
            for key, outcome in (
                ('ok', 'ok'),
                ('missing', 'missing'),
                ('invalid', 'invalid'),
                ('required', 'rejected'),
            )
        ]
        self.assertEqual(
            metric_creator.send_counter.call_args_list,
            expected_calls,
        )


class TestPodLabelPrefixGate(unittest.TestCase):
    """Covers the pod-label-prefix merge check in the submission gate."""

    def test_no_prefix_accepts_any_valid_label_key(self):
        submit_info = _submit_info([])
        self.assertEqual(
            submit_info.validate_workflow_label_policy(
                _rendered_spec({'team.example.com/role': 'lead'})),
            [],
        )

    def test_prefix_accepts_bare_keys(self):
        submit_info = _submit_info([], pod_label_prefix='example.com/')
        self.assertEqual(
            submit_info.validate_workflow_label_policy(
                _rendered_spec({'PPP': 'aurora'})),
            [],
        )

    def test_prefix_rejects_key_that_forms_an_invalid_merged_key(self):
        submit_info = _submit_info([], pod_label_prefix='example.com/')
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            submit_info.validate_workflow_label_policy(
                _rendered_spec({'team.example.com/role': 'lead'}))
        self.assertIn(
            'example.com/team.example.com/role', raised.exception.message)


class TestWorkflowLabelResponses(unittest.TestCase):
    """Covers warnings on submit responses and the get-workflow detail path."""

    def test_submit_response_defaults_warnings_for_older_clients(self):
        response = objects.SubmitResponse(name='workflow-1', logs='ok')

        self.assertEqual(response.warnings, [])

    def test_build_workflow_object_does_not_persist_warnings(self):
        submit_info = _submit_info([])
        submit_info.context.config = mock.Mock(redis_url='redis://test')
        rendered_spec = cast(workflow.WorkflowSpec, mock.Mock())
        sentinel = mock.sentinel.workflow

        with mock.patch.object(
                workflow.Workflow, 'from_workflow_spec',
                return_value=sentinel) as workflow_factory:
            result = submit_info.build_workflow_object(
                rendered_spec=rendered_spec,
                group_and_task_uuids={},
                remaining_upstream_groups={},
                downstream_groups={},
            )

        self.assertIs(result, sentinel)
        self.assertNotIn('warnings', workflow_factory.call_args.kwargs)

    def test_send_submission_does_not_thread_warnings_into_workflow_object(self):
        submit_info = _submit_info([])
        cast(
            mock.Mock,
            submit_info.context.database.get_workflow_service_url).return_value = 'https://test'
        rendered_spec = cast(workflow.WorkflowSpec, mock.Mock())
        cast(mock.Mock, rendered_spec.saved_spec).return_value = {}
        expected = ["Workflow label 'team' has a value that is not allowed."]

        with mock.patch.object(
                objects.WorkflowSubmitInfo, 'build_workflow_object',
                side_effect=RuntimeError('stop after construction')) as build_workflow:
            with self.assertRaises(RuntimeError):
                submit_info.send_submit_workflow_to_queue(
                    rendered_spec=rendered_spec,
                    group_and_task_uuids={},
                    warnings=expected,
                )

        self.assertNotIn('warnings', build_workflow.call_args.kwargs)

    def test_send_submission_returns_warnings_without_persisting_them(self):
        submit_info = _submit_info([])
        cast(
            mock.Mock,
            submit_info.context.database.get_workflow_service_url).return_value = 'https://test'
        rendered_spec = cast(workflow.WorkflowSpec, mock.Mock())
        cast(mock.Mock, rendered_spec.saved_spec).return_value = {}
        expected = ["Workflow label 'team' has a value that is not allowed."]
        workflow_obj = mock.Mock()
        workflow_obj.workflow_id = 'workflow-1'
        workflow_obj.groups = []
        workflow_obj.get_task_db_keys.return_value = {}
        submit_job = mock.Mock()
        service_context = types.SimpleNamespace(
            config=types.SimpleNamespace(method='dev'))

        with mock.patch.object(
                objects.WorkflowSubmitInfo, 'build_workflow_object',
                return_value=workflow_obj) as build_workflow, \
             mock.patch.object(
                 objects.jobs, 'SubmitWorkflow', return_value=submit_job) as submit_workflow, \
             mock.patch.object(
                 objects.task.TaskGroup, 'batch_insert_groups_and_tasks'), \
             mock.patch.object(
                 objects.WorkflowSubmitInfo, 'send_workflow_spec_to_queue'), \
             mock.patch.object(
                 objects.WorkflowServiceContext, 'get', return_value=service_context), \
             mock.patch.object(
                 objects, 'generate_dashboard_url', return_value='https://dashboard'):
            response = submit_info.send_submit_workflow_to_queue(
                rendered_spec=rendered_spec,
                group_and_task_uuids={},
                warnings=expected,
            )

        submit_job.send_job_to_queue.assert_called_once_with()
        workflow_obj.insert_to_db.assert_called_once_with()
        self.assertNotIn('warnings', build_workflow.call_args.kwargs)
        self.assertNotIn('warnings', submit_workflow.call_args.kwargs)
        self.assertEqual(expected, response.warnings)

    def _fetch_detail_response(
            self,
            labels: dict[str, str],
            status: workflow.WorkflowStatus,
            policy: list[connectors.LabelPolicy],
    ) -> objects.WorkflowQueryResponse:
        database = mock.Mock()
        database.get_workflow_service_url.return_value = 'https://test'
        database.get_workflow_configs.return_value = types.SimpleNamespace(
            labels_config=types.SimpleNamespace(policy=policy),
        )
        workflow_obj = types.SimpleNamespace(
            workflow_id='workflow-1',
            workflow_uuid='a' * 32,
            user='user-1',
            cancelled_by=None,
            parent_name=None,
            parent_job_id=None,
            app_uuid=None,
            app_version=None,
            submit_time=datetime.datetime(2026, 1, 1),
            start_time=None,
            end_time=None,
            status=status,
            outputs='',
            pool='pool-1',
            backend='backend-1',
            plugins=task_common.WorkflowPlugins(),
            priority='NORMAL',
            labels=labels,
            timeout=types.SimpleNamespace(
                exec_timeout=None,
                queue_timeout=None,
            ),
        )
        service_context = types.SimpleNamespace(
            config=types.SimpleNamespace(method='dev'),
        )

        with (
            mock.patch.object(
                workflow.Workflow, 'fetch_from_db', return_value=workflow_obj,
            ),
            mock.patch.object(
                objects.WorkflowServiceContext, 'get',
                return_value=service_context,
            ),
            mock.patch.object(objects, 'get_groups', return_value=[]),
            mock.patch.object(objects, 'get_workflow_tags', return_value=[]),
            mock.patch.object(
                objects, 'get_workflow_queued_time',
                return_value=datetime.timedelta(0),
            ),
            mock.patch.object(
                objects, 'get_workflow_duration', return_value=None,
            ),
            mock.patch.object(
                objects, 'generate_dashboard_url',
                return_value='https://dashboard',
            ),
            mock.patch.object(
                objects, 'generate_grafana_url', return_value=None,
            ),
        ):
            return objects.WorkflowQueryResponse.fetch_from_db(
                database, 'workflow-1',
            )

    def test_detail_warnings_are_recomputed_from_current_warn_policy(self):
        warning_policy = [
            _label_policy('project', connectors.LabelEnforcement.WARN, ['team_a']),
        ]

        response = self._fetch_detail_response(
            labels={},
            status=workflow.WorkflowStatus.RUNNING,
            policy=warning_policy,
        )

        self.assertEqual(response.warnings, [
            "Workflow is missing label 'project'; add it now to avoid rejected "
            "submissions once it is required.",
        ])

        required_response = self._fetch_detail_response(
            labels={},
            status=workflow.WorkflowStatus.RUNNING,
            policy=[
                _label_policy(
                    'project', connectors.LabelEnforcement.ENFORCE, ['team_a']),
            ],
        )
        omitted_response = self._fetch_detail_response(
            labels={},
            status=workflow.WorkflowStatus.RUNNING,
            policy=[],
        )

        self.assertEqual(required_response.warnings, [])
        self.assertEqual(omitted_response.warnings, [])

    def test_detail_invalid_warning_does_not_disclose_values(self):
        response = self._fetch_detail_response(
            labels={'project': 'submitted-secret'},
            status=workflow.WorkflowStatus.RUNNING,
            policy=[
                _label_policy(
                    'project', connectors.LabelEnforcement.WARN,
                    ['allow-list-secret']),
            ],
        )

        self.assertEqual(
            response.warnings,
            [
                "Workflow label 'project' has a value that is not allowed; use an "
                "allowed value now to avoid rejected submissions once the label "
                "is required."
            ],
        )
        combined_warnings = '\n'.join(response.warnings)
        self.assertNotIn('submitted-secret', combined_warnings)
        self.assertNotIn('allow-list-secret', combined_warnings)

    def test_detail_warnings_are_recomputed_for_every_workflow_status(self):
        warning_policy = [
            _label_policy('project', connectors.LabelEnforcement.WARN),
        ]

        for status in workflow.WorkflowStatus:
            with self.subTest(status=status):
                response = self._fetch_detail_response(
                    labels={},
                    status=status,
                    policy=warning_policy,
                )
                self.assertNotEqual(response.warnings, [])


if __name__ == '__main__':
    unittest.main()
