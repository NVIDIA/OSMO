# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Pod selection must not hide a live bootstrap attempt."""

import unittest
from unittest import mock

from test.oetf.cluster_fixture import ClusterFixture


class JobPodSelectionTest(unittest.TestCase):
    @staticmethod
    def pod(name, phase, timestamp, owner='job-uid'):
        return {
            'metadata': {
                'name': name, 'creationTimestamp': timestamp,
                'ownerReferences': [{'kind': 'Job', 'controller': True, 'uid': owner}],
            },
            'status': {'phase': phase},
        }

    def select(self, pods):
        fixture = ClusterFixture()
        with mock.patch.object(fixture, 'kube_json', return_value={'items': pods}):
            return fixture.job_pod({'metadata': {'name': 'bootstrap', 'uid': 'job-uid'}})

    def test_selects_latest_terminal_retry(self):
        first = self.pod('first', 'Failed', '2026-09-16T00:00:00Z')
        last = self.pod('last', 'Succeeded', '2026-09-16T00:01:00Z')
        self.assertEqual(self.select([last, first]), last)
        self.assertEqual(self.select([first]), first)
        self.assertIsNone(self.select([]))

    def test_never_hides_a_nonterminal_pod(self):
        for phase in ('Pending', 'Running', 'Unknown', None):
            with self.subTest(phase=phase):
                self.assertIsNone(self.select([
                    self.pod('live', phase, '2026-09-16T00:00:00Z'),
                    self.pod('failed', 'Failed', '2026-09-16T00:01:00Z'),
                ]))

    def test_rejects_another_job_incarnation(self):
        with self.assertRaises(AssertionError):
            self.select([self.pod('old', 'Failed', '2026-09-16T00:00:00Z', owner='old-uid')])


if __name__ == '__main__':
    unittest.main()
