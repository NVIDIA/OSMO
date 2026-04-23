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
import unittest

from src.utils.job import backend_job_defs


class EffectiveApiVersionTest(unittest.TestCase):
    def test_generic_api_preferred(self):
        spec = backend_job_defs.BackendCleanupSpec(
            labels={'app': 'test'},
            generic_api=backend_job_defs.BackendGenericApi(
                api_version='scheduling.run.ai/v2', kind='Queue'),
            custom_api=backend_job_defs.BackendCustomApi(
                api_major='old.api', api_minor='v1', path='queues'))
        self.assertEqual(spec.effective_api_version, 'scheduling.run.ai/v2')

    def test_custom_api_fallback(self):
        spec = backend_job_defs.BackendCleanupSpec(
            labels={'app': 'test'},
            custom_api=backend_job_defs.BackendCustomApi(
                api_major='scheduling.run.ai', api_minor='v2alpha2', path='podgroups'))
        self.assertEqual(spec.effective_api_version, 'scheduling.run.ai/v2alpha2')

    def test_default_v1_when_no_api(self):
        spec = backend_job_defs.BackendCleanupSpec(labels={'app': 'test'})
        self.assertEqual(spec.effective_api_version, 'v1')


class EffectiveKindTest(unittest.TestCase):
    def test_generic_api_preferred(self):
        spec = backend_job_defs.BackendCleanupSpec(
            labels={'app': 'test'},
            resource_type='Pod',
            generic_api=backend_job_defs.BackendGenericApi(
                api_version='v1', kind='Service'))
        self.assertEqual(spec.effective_kind, 'Service')

    def test_resource_type_fallback(self):
        spec = backend_job_defs.BackendCleanupSpec(
            labels={'app': 'test'},
            resource_type='Pod')
        self.assertEqual(spec.effective_kind, 'Pod')

    def test_none_when_nothing_set(self):
        spec = backend_job_defs.BackendCleanupSpec(labels={'app': 'test'})
        self.assertIsNone(spec.effective_kind)


class K8sSelectorTest(unittest.TestCase):
    def test_single_label(self):
        spec = backend_job_defs.BackendCleanupSpec(labels={'app': 'osmo'})
        self.assertEqual(spec.k8s_selector, 'app=osmo')

    def test_multiple_labels(self):
        spec = backend_job_defs.BackendCleanupSpec(
            labels={'app': 'osmo', 'env': 'prod'})
        parts = spec.k8s_selector.split(',')
        self.assertEqual(len(parts), 2)
        self.assertIn('app=osmo', parts)
        self.assertIn('env=prod', parts)


class BackendCreateGroupMixinTest(unittest.TestCase):
    def test_default_values(self):
        mixin = backend_job_defs.BackendCreateGroupMixin(
            group_name='group1', k8s_resources=[{'kind': 'Pod'}])
        self.assertEqual(mixin.backend_k8s_timeout, 60)
        self.assertEqual(mixin.scheduler_settings, {})


class BackendGenericApiTest(unittest.TestCase):
    def test_creation(self):
        api = backend_job_defs.BackendGenericApi(api_version='v1', kind='Pod')
        self.assertEqual(api.api_version, 'v1')
        self.assertEqual(api.kind, 'Pod')


class BackendCustomApiTest(unittest.TestCase):
    def test_creation(self):
        api = backend_job_defs.BackendCustomApi(
            api_major='scheduling.run.ai', api_minor='v2alpha2', path='podgroups')
        self.assertEqual(api.api_major, 'scheduling.run.ai')
        self.assertEqual(api.api_minor, 'v2alpha2')
        self.assertEqual(api.path, 'podgroups')


class BackendSynchronizeQueuesMixinTest(unittest.TestCase):
    def test_default_immutable_kinds(self):
        mixin = backend_job_defs.BackendSynchronizeQueuesMixin(
            cleanup_specs=[],
            k8s_resources=[])
        self.assertEqual(mixin.immutable_kinds, [])

    def test_with_immutable_kinds(self):
        mixin = backend_job_defs.BackendSynchronizeQueuesMixin(
            cleanup_specs=[],
            k8s_resources=[],
            immutable_kinds=['Topology'])
        self.assertEqual(mixin.immutable_kinds, ['Topology'])


if __name__ == '__main__':
    unittest.main()
