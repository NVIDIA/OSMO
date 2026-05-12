"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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
import asyncio
import datetime
import enum
import os
import tempfile
import unittest
from unittest import mock
import uuid

import pydantic

from src.lib.utils import common, osmo_errors


class TestCommon(unittest.TestCase):
    """
    Unit tests for the common module.
    """

    def test_convert_resource_value(self):
        self.assertEqual(common.convert_resource_value_str('10Gi', target='TiB'), 10.0 / 1024)
        self.assertEqual(common.convert_resource_value_str('1.5Ti', target='GiB'), 1.5 * 1024)
        self.assertEqual(common.convert_resource_value_str(
            '1.5Ti', target='MiB'), 1.5 * 1024 * 1024)
        self.assertEqual(common.convert_resource_value_str('1000', target='KiB'), 1000.0 / 1024)

    def test_docker_parse(self):
        """Data-driven tests for docker_parse function."""
        # (image, expected_host, expected_port, expected_name, expected_tag, expected_digest)
        test_cases = [
            # Official Docker Hub images
            ('ubuntu', common.DEFAULT_REGISTRY, 443, 'library/ubuntu', 'latest', None),
            ('ubuntu:22.04', common.DEFAULT_REGISTRY, 443, 'library/ubuntu', '22.04', None),
            ('alpine', common.DEFAULT_REGISTRY, 443, 'library/alpine', 'latest', None),

            # Docker Hub org/image (should NOT treat org as host)
            ('alpine/curl', common.DEFAULT_REGISTRY, 443, 'alpine/curl', 'latest', None),
            ('alpine/curl:latest', common.DEFAULT_REGISTRY, 443, 'alpine/curl', 'latest', None),
            ('alpine/git', common.DEFAULT_REGISTRY, 443, 'alpine/git', 'latest', None),
            ('nginx/nginx', common.DEFAULT_REGISTRY, 443, 'nginx/nginx', 'latest', None),
            ('company/team/project', common.DEFAULT_REGISTRY,
             443, 'company/team/project', 'latest', None),

            # localhost registry (special case)
            ('localhost/image', 'localhost', 443, 'image', 'latest', None),
            ('localhost/image:latest', 'localhost', 443, 'image', 'latest', None),
            ('localhost:5000/image', 'localhost', 5000, 'image', 'latest', None),
            ('localhost:5000/org/image:v1', 'localhost', 5000, 'org/image', 'v1', None),

            # Custom registries with dots
            ('gcr.io/project/image', 'gcr.io', 443, 'project/image', 'latest', None),
            ('gcr.io/image/sub:latest', 'gcr.io', 443, 'image/sub', 'latest', None),
            ('nvcr.io/nvidia/pytorch:23.10-py3', 'nvcr.io', 443,
             'nvidia/pytorch', '23.10-py3', None),
            ('registry.example.com/org/image', 'registry.example.com', 443,
             'org/image', 'latest', None),
            ('registry.example.com:5000/org/image:v1',
             'registry.example.com', 5000, 'org/image', 'v1', None),

            # IP-based registries
            ('192.168.1.100:5000/myimage', '192.168.1.100', 5000, 'myimage', 'latest', None),
            ('10.0.0.1:5000/org/image:v2', '10.0.0.1', 5000, 'org/image', 'v2', None),

            # Bare hostname with port (Docker-in-Docker, testcontainers, etc.)
            # Port presence disambiguates registry from org
            ('docker:5000/image', 'docker', 5000, 'image', 'latest', None),
            ('docker:32781/test_image', 'docker', 32781, 'test_image', 'latest', None),
            ('registry:5000/org/image:v1', 'registry', 5000, 'org/image', 'v1', None),
            ('myhost:8080/project/app:latest', 'myhost', 8080, 'project/app', 'latest', None),

            # Images with digest
            ('ubuntu@sha256:abc123def456', common.DEFAULT_REGISTRY,
             443, 'library/ubuntu', None, 'sha256:abc123def456'),
            ('ubuntu:22.04@sha256:abc123def456', common.DEFAULT_REGISTRY,
             443, 'library/ubuntu', '22.04', 'sha256:abc123def456'),

            # Edge cases
            ('ubuntu:v', common.DEFAULT_REGISTRY, 443, 'library/ubuntu', 'v', None),
        ]

        for image, exp_host, exp_port, exp_name, exp_tag, exp_digest in test_cases:
            with self.subTest(image=image):
                result = common.docker_parse(image)
                self.assertEqual(result.host, exp_host, f'host mismatch for {image}')
                self.assertEqual(result.port, exp_port, f'port mismatch for {image}')
                self.assertEqual(result.name, exp_name, f'name mismatch for {image}')
                self.assertEqual(result.tag, exp_tag, f'tag mismatch for {image}')
                self.assertEqual(result.digest, exp_digest, f'digest mismatch for {image}')


class TestPydanticEncoder(unittest.TestCase):
    """ Tests for pydantic_encoder. """

    def test_encodes_pydantic_model(self):
        class Sample(pydantic.BaseModel):
            x: int

        result = common.pydantic_encoder(Sample(x=5))
        self.assertEqual(result, {'x': 5})

    def test_encodes_enum(self):
        class Color(enum.Enum):
            RED = 'red'

        self.assertEqual(common.pydantic_encoder(Color.RED), 'red')

    def test_encodes_datetime(self):
        dt = datetime.datetime(2026, 1, 2, 3, 4, 5)
        self.assertEqual(common.pydantic_encoder(dt), '2026-01-02T03:04:05')

    def test_encodes_date(self):
        self.assertEqual(
            common.pydantic_encoder(datetime.date(2026, 1, 2)), '2026-01-02')

    def test_encodes_time(self):
        self.assertEqual(
            common.pydantic_encoder(datetime.time(3, 4, 5)), '03:04:05')

    def test_encodes_timedelta(self):
        self.assertEqual(
            common.pydantic_encoder(datetime.timedelta(seconds=30)), 30.0)

    def test_encodes_uuid(self):
        value = uuid.UUID('12345678-1234-5678-1234-567812345678')
        self.assertEqual(
            common.pydantic_encoder(value), '12345678-1234-5678-1234-567812345678')

    def test_encodes_set_as_list(self):
        result = common.pydantic_encoder({1, 2})
        self.assertIsInstance(result, list)
        self.assertEqual(set(result), {1, 2})

    def test_encodes_frozenset_as_list(self):
        result = common.pydantic_encoder(frozenset({'a'}))
        self.assertEqual(result, ['a'])

    def test_encodes_bytes(self):
        self.assertEqual(common.pydantic_encoder(b'hello'), 'hello')

    def test_encodes_bytes_with_invalid_utf8_replaces(self):
        self.assertEqual(common.pydantic_encoder(b'\xff'), '�')

    def test_unsupported_type_raises_type_error(self):
        with self.assertRaises(TypeError):
            common.pydantic_encoder(object())


class TestDatasetStructureWorkflowSpec(unittest.TestCase):
    """ Tests for DatasetStructure with workflow_spec=True. """

    def test_workflow_spec_allows_braces(self):
        info = common.DatasetStructure('{bucket}/ds:{tag}', workflow_spec=True)
        self.assertEqual(info.bucket, '{bucket}')
        self.assertEqual(info.name, 'ds')
        self.assertEqual(info.tag, '{tag}')

    def test_workflow_spec_rejects_invalid_chars(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            common.DatasetStructure('bad!name', workflow_spec=True)

    def test_full_name_name_only(self):
        info = common.DatasetStructure('mydata')
        self.assertEqual(info.full_name, 'mydata')

    def test_full_name_with_bucket(self):
        info = common.DatasetStructure('b/mydata')
        self.assertEqual(info.full_name, 'b/mydata')

    def test_full_name_with_tag(self):
        info = common.DatasetStructure('mydata:v1')
        self.assertEqual(info.full_name, 'mydata:v1')

    def test_full_name_with_bucket_and_tag(self):
        info = common.DatasetStructure('b/mydata:v1')
        self.assertEqual(info.full_name, 'b/mydata:v1')

    def test_to_dict(self):
        info = common.DatasetStructure('b/mydata:v1')
        self.assertEqual(info.to_dict(), {'name': 'mydata', 'tag': 'v1'})


class TestAppStructure(unittest.TestCase):
    """ Tests for AppStructure. """

    def test_name_only(self):
        app = common.AppStructure('my-app')
        self.assertEqual(app.name, 'my-app')
        self.assertIsNone(app.version)

    def test_name_and_version(self):
        app = common.AppStructure('my-app:42')
        self.assertEqual(app.name, 'my-app')
        self.assertEqual(app.version, 42)

    def test_invalid_name_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            common.AppStructure('bad!name')

    def test_from_parts_with_version(self):
        app = common.AppStructure.from_parts('name', 3)
        self.assertEqual(app.name, 'name')
        self.assertEqual(app.version, 3)

    def test_from_parts_without_version(self):
        app = common.AppStructure.from_parts('name')
        self.assertEqual(app.name, 'name')
        self.assertIsNone(app.version)

    def test_full_name_without_version(self):
        app = common.AppStructure('myapp')
        self.assertEqual(app.full_name, 'myapp')

    def test_full_name_with_version(self):
        app = common.AppStructure('myapp:7')
        self.assertEqual(app.full_name, 'myapp:7')

    def test_to_dict(self):
        app = common.AppStructure('myapp:7')
        self.assertEqual(app.to_dict(), {'name': 'myapp', 'version': 7})


class TestLRUCache(unittest.TestCase):
    """ Tests for LRUCache. """

    def test_get_missing_returns_none(self):
        cache = common.LRUCache(2)
        self.assertIsNone(cache.get('missing'))

    def test_set_and_get(self):
        cache = common.LRUCache(2)
        cache.set('a', 1)
        self.assertEqual(cache.get('a'), 1)

    def test_eviction_drops_oldest(self):
        cache = common.LRUCache(2)
        cache.set('a', 1)
        cache.set('b', 2)
        cache.set('c', 3)
        self.assertIsNone(cache.get('a'))
        self.assertEqual(cache.get('b'), 2)
        self.assertEqual(cache.get('c'), 3)

    def test_get_refreshes_recency(self):
        cache = common.LRUCache(2)
        cache.set('a', 1)
        cache.set('b', 2)
        cache.get('a')  # Mark 'a' as most recently used.
        cache.set('c', 3)
        self.assertEqual(cache.get('a'), 1)
        self.assertIsNone(cache.get('b'))

    def test_set_existing_key_updates_value(self):
        cache = common.LRUCache(2)
        cache.set('a', 1)
        cache.set('a', 2)
        self.assertEqual(cache.get('a'), 2)


class TestTokenBucket(unittest.TestCase):
    """ Tests for TokenBucket. """

    def test_consume_success(self):
        bucket = common.TokenBucket(capacity=5, refill_rate=1)
        self.assertTrue(bucket.consume(1))

    def test_consume_insufficient_tokens(self):
        bucket = common.TokenBucket(capacity=1, refill_rate=1)
        self.assertTrue(bucket.consume(1))
        self.assertFalse(bucket.consume(1))

    def test_refill_over_time(self):
        bucket = common.TokenBucket(capacity=10, refill_rate=100)
        # Drain the bucket.
        bucket.consume(10)
        # Manually rewind last_refill to simulate elapsed time.
        bucket.last_refill -= 1.0
        self.assertTrue(bucket.consume(1))

    def test_capacity_is_upper_bound(self):
        bucket = common.TokenBucket(capacity=2, refill_rate=100)
        bucket.last_refill -= 100  # Should not exceed capacity.
        bucket.consume(0)
        self.assertEqual(bucket.tokens, 2)

    def test_wait_for_tokens_returns_when_available(self):
        async def run_test():
            bucket = common.TokenBucket(capacity=5, refill_rate=1000)
            await bucket.wait_for_tokens(1)
        asyncio.run(run_test())


class TestDockerImageInfoProperties(unittest.TestCase):
    """ Tests for DockerImageInfo properties. """

    def test_reference_prefers_digest(self):
        info = common.DockerImageInfo(
            name='x', original='x', tag='v1', digest='sha256:abc')
        self.assertEqual(info.reference, 'sha256:abc')

    def test_reference_falls_back_to_tag(self):
        info = common.DockerImageInfo(
            name='x', original='x', tag='v1', digest=None)
        self.assertEqual(info.reference, 'v1')

    def test_reference_defaults_to_latest(self):
        info = common.DockerImageInfo(
            name='x', original='x', tag=None, digest=None)
        self.assertEqual(info.reference, 'latest')

    def test_manifest_url(self):
        info = common.DockerImageInfo(
            name='lib/ubuntu', original='ubuntu', tag='22.04', digest=None,
            host='registry.example.com', port=443)
        self.assertEqual(
            info.manifest_url,
            'https://registry.example.com:443/v2/lib/ubuntu/manifests/22.04')


class TestRegistryParse(unittest.TestCase):
    """ Tests for registry_parse. """

    def test_empty_returns_default(self):
        self.assertEqual(common.registry_parse(''), common.DEFAULT_REGISTRY)

    def test_docker_io_returns_default(self):
        self.assertEqual(common.registry_parse('docker.io'), common.DEFAULT_REGISTRY)

    def test_returns_name_as_is(self):
        self.assertEqual(common.registry_parse('gcr.io'), 'gcr.io')


class TestDockerParseInvalid(unittest.TestCase):
    """ Tests for docker_parse error path. """

    def test_invalid_image_raises(self):
        with self.assertRaises(osmo_errors.OSMOUsageError):
            common.docker_parse('!!!invalid!!!')


class TestAllocatableResource(unittest.TestCase):
    """ Tests for AllocatableResource.resource_label_with_unit. """

    def test_with_unit(self):
        resource = common.AllocatableResource(
            name='memory', kube_label='memory', unit='Gi')
        self.assertEqual(resource.resource_label_with_unit, 'Memory [Gi]')

    def test_without_unit(self):
        resource = common.AllocatableResource(name='cpu', kube_label='cpu')
        self.assertEqual(resource.resource_label_with_unit, 'CPU [#]')


class TestGpuVersionedLabel(unittest.TestCase):
    """ Tests for GpuVersionedLabel. """

    def test_get_all_version_labels(self):
        label = common.GpuVersionedLabel(
            kube_label_prefix='nvidia.com/cuda.driver',
            version_levels=['major', 'minor'])
        self.assertEqual(
            label.get_all_version_labels(),
            ['nvidia.com/cuda.driver.major', 'nvidia.com/cuda.driver.minor'])

    def test_convert_to_version_labels(self):
        label = common.GpuVersionedLabel(
            kube_label_prefix='nvidia.com/cuda.driver',
            version_levels=['major', 'minor'])
        self.assertEqual(
            label.convert_to_version_labels('11.8'),
            {
                'nvidia.com/cuda.driver.major': '11',
                'nvidia.com/cuda.driver.minor': '8',
            })

    def test_convert_to_version_labels_partial(self):
        label = common.GpuVersionedLabel(
            kube_label_prefix='nvidia.com/cuda.driver',
            version_levels=['major', 'minor', 'rev'])
        # Fewer version values than version_levels - only matches on zip.
        self.assertEqual(
            label.convert_to_version_labels('11'),
            {'nvidia.com/cuda.driver.major': '11'})


class TestMergeListsOnName(unittest.TestCase):
    """ Tests for merge_lists_on_name. """

    def test_merges_common_named_items(self):
        l1 = [{'name': 'a', 'value': 1}]
        l2 = [{'name': 'a', 'value': 2}]
        result = common.merge_lists_on_name(l1, l2)
        self.assertEqual(result, [{'name': 'a', 'value': 2}])

    def test_appends_unmatched_items(self):
        l1 = [{'name': 'a', 'value': 1}]
        l2 = [{'name': 'b', 'value': 2}]
        result = common.merge_lists_on_name(l1, l2)
        self.assertEqual(
            result, [{'name': 'a', 'value': 1}, {'name': 'b', 'value': 2}])

    def test_appends_items_without_name(self):
        l1 = [{'name': 'a', 'value': 1}]
        l2 = [{'value': 2}]
        result = common.merge_lists_on_name(l1, l2)
        self.assertEqual(result, [{'name': 'a', 'value': 1}, {'value': 2}])


class TestRecursiveDictUpdate(unittest.TestCase):
    """ Tests for recursive_dict_update. """

    def test_replaces_scalar(self):
        result = common.recursive_dict_update({'a': 1}, {'a': 2})
        self.assertEqual(result, {'a': 2})

    def test_adds_new_key(self):
        result = common.recursive_dict_update({'a': 1}, {'b': 2})
        self.assertEqual(result, {'a': 1, 'b': 2})

    def test_recurses_into_nested_dict(self):
        result = common.recursive_dict_update(
            {'a': {'x': 1, 'y': 2}}, {'a': {'y': 20, 'z': 3}})
        self.assertEqual(result, {'a': {'x': 1, 'y': 20, 'z': 3}})

    def test_replaces_list_without_merge_func(self):
        result = common.recursive_dict_update({'a': [1, 2]}, {'a': [3]})
        self.assertEqual(result, {'a': [3]})

    def test_uses_list_merge_func(self):
        result = common.recursive_dict_update(
            {'a': [{'name': 'x', 'v': 1}]},
            {'a': [{'name': 'x', 'v': 2}]},
            common.merge_lists_on_name)
        self.assertEqual(result, {'a': [{'name': 'x', 'v': 2}]})

    def test_list_merge_func_replaces_when_original_not_list(self):
        result = common.recursive_dict_update(
            {'a': 'scalar'}, {'a': [1, 2]}, common.merge_lists_on_name)
        self.assertEqual(result, {'a': [1, 2]})


class TestConvertStrToTime(unittest.TestCase):
    """ Tests for convert_str_to_time. """

    def test_default_format(self):
        result = common.convert_str_to_time('2026-01-02 03:04:05.123456')
        self.assertEqual(result, datetime.datetime(2026, 1, 2, 3, 4, 5, 123456))

    def test_custom_format(self):
        result = common.convert_str_to_time('2026-01-02', '%Y-%m-%d')
        self.assertEqual(result, datetime.datetime(2026, 1, 2))


class TestToTimedelta(unittest.TestCase):
    """ Tests for to_timedelta. """

    def test_days(self):
        self.assertEqual(common.to_timedelta('2d'), datetime.timedelta(days=2))

    def test_hours(self):
        self.assertEqual(common.to_timedelta('3h'), datetime.timedelta(hours=3))

    def test_minutes(self):
        self.assertEqual(common.to_timedelta('5m'), datetime.timedelta(minutes=5))

    def test_seconds(self):
        self.assertEqual(common.to_timedelta('10s'), datetime.timedelta(seconds=10))

    def test_milliseconds(self):
        self.assertEqual(
            common.to_timedelta('250ms'), datetime.timedelta(milliseconds=250))

    def test_microseconds(self):
        self.assertEqual(
            common.to_timedelta('750us'), datetime.timedelta(microseconds=750))

    def test_iso8601_seconds(self):
        self.assertEqual(
            common.to_timedelta('PT10S'), datetime.timedelta(seconds=10))

    def test_iso8601_complex(self):
        self.assertEqual(
            common.to_timedelta('PT1H30M15S'),
            datetime.timedelta(hours=1, minutes=30, seconds=15))

    def test_iso8601_days(self):
        self.assertEqual(
            common.to_timedelta('P2DT3H'),
            datetime.timedelta(days=2, hours=3))

    def test_iso8601_empty_raises(self):
        with self.assertRaises(ValueError):
            common.to_timedelta('P')

    def test_invalid_iso8601_raises(self):
        with self.assertRaises(ValueError):
            common.to_timedelta('PXYZ')

    def test_invalid_format_raises(self):
        with self.assertRaises(ValueError):
            common.to_timedelta('abc')

    def test_invalid_unit_raises(self):
        # Non-recognised unit after numeric value.
        with self.assertRaises(ValueError):
            common.to_timedelta('5x')


class TestTimedeltaToStr(unittest.TestCase):
    """ Tests for timedelta_to_str. """

    def test_seconds(self):
        self.assertEqual(
            common.timedelta_to_str(datetime.timedelta(seconds=45)), '45s')

    def test_mixed(self):
        self.assertEqual(
            common.timedelta_to_str(datetime.timedelta(minutes=2)), '120s')


class TestConvertResourceValueErrors(unittest.TestCase):
    """ Tests for convert_resource_value_str error paths. """

    def test_invalid_format_raises_value_error(self):
        with self.assertRaises(ValueError):
            common.convert_resource_value_str('!@#')

    def test_unknown_unit_raises_schema_error(self):
        with self.assertRaises(osmo_errors.OSMOSchemaError):
            common.convert_resource_value_str('10Xi')

    def test_unknown_target_raises_schema_error(self):
        with self.assertRaises(osmo_errors.OSMOSchemaError):
            common.convert_resource_value_str('10Gi', target='Xi')


class TestCollectFileSizes(unittest.TestCase):
    """ Tests for collect_file_sizes. """

    def test_reports_sizes_and_total(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            a = os.path.join(tmpdir, 'a.txt')
            b = os.path.join(tmpdir, 'b.txt')
            with open(a, 'wb') as f:
                f.write(b'12345')
            with open(b, 'wb') as f:
                f.write(b'abc')
            sizes, total = common.collect_file_sizes([a, b])
            self.assertEqual(sizes[a], 5)
            self.assertEqual(sizes[b], 3)
            self.assertEqual(total, 8)

    def test_empty_list(self):
        sizes, total = common.collect_file_sizes([])
        self.assertEqual(sizes, {})
        self.assertEqual(total, 0)


class TestCollectFsObjects(unittest.TestCase):
    """ Tests for collect_fs_objects. """

    def test_single_file(self):
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(b'x')
            tmp_path = tmp.name
        try:
            result = common.collect_fs_objects(tmp_path)
            self.assertEqual(result, [tmp_path])
        finally:
            os.unlink(tmp_path)

    def test_directory_walk(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            sub = os.path.join(tmpdir, 'sub')
            os.makedirs(sub)
            a = os.path.join(tmpdir, 'a.txt')
            b = os.path.join(sub, 'b.txt')
            with open(a, 'w', encoding='utf-8') as f:
                f.write('a')
            with open(b, 'w', encoding='utf-8') as f:
                f.write('b')
            result = common.collect_fs_objects(tmpdir)
            self.assertIn(a, result)
            self.assertIn(b, result)

    def test_directory_regex_filter(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            a = os.path.join(tmpdir, 'match.txt')
            b = os.path.join(tmpdir, 'skip.log')
            with open(a, 'w', encoding='utf-8') as f:
                f.write('a')
            with open(b, 'w', encoding='utf-8') as f:
                f.write('b')
            result = common.collect_fs_objects(tmpdir, regex=r'.*\.txt')
            self.assertEqual(result, [a])

    def test_nonexistent_returns_empty(self):
        self.assertEqual(
            common.collect_fs_objects('/nonexistent/path/xyz/123'), [])


class TestEtagChecksum(unittest.TestCase):
    """ Tests for etag_checksum. """

    def test_empty_file(self):
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp_path = tmp.name
        try:
            result = common.etag_checksum(tmp_path)
            # md5 of empty string.
            self.assertEqual(result, 'd41d8cd98f00b204e9800998ecf8427e')
        finally:
            os.unlink(tmp_path)

    def test_single_chunk(self):
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(b'hello')
            tmp_path = tmp.name
        try:
            result = common.etag_checksum(tmp_path, chunk_size=1024)
            self.assertEqual(result, '5d41402abc4b2a76b9719d911017c592')
        finally:
            os.unlink(tmp_path)

    def test_multiple_chunks(self):
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(b'abcdef')
            tmp_path = tmp.name
        try:
            # chunk_size=2 forces three chunks.
            result = common.etag_checksum(tmp_path, chunk_size=2)
            self.assertTrue(result.endswith('-3'))
        finally:
            os.unlink(tmp_path)


class TestOsmoTable(unittest.TestCase):
    """ Tests for osmo_table and create_table_with_sum_row. """

    def test_osmo_table_builds_table(self):
        table = common.osmo_table(['col1', 'col2'])
        table.add_row(['a', 'b'])
        output = table.draw()
        self.assertIn('col1', output)
        self.assertIn('a', output)

    def test_osmo_table_with_fit_width_handles_oserror(self):
        with mock.patch('os.get_terminal_size', side_effect=OSError):
            # Should not raise; error path prints message and passes.
            table = common.osmo_table(['col1'], fit_width=True)
            self.assertIsNotNone(table)

    def test_create_table_with_sum_row(self):
        table = common.osmo_table(['a', 'b'])
        table.add_row(['1', '2'])
        result = common.create_table_with_sum_row(table, ['sum_a', 'sum_b'])
        self.assertIn('sum_a', result)
        self.assertIn('sum_b', result)


class TestVerifyDictKeys(unittest.TestCase):
    """ Tests for verify_dict_keys. """

    def test_valid_keys(self):
        # Should not raise.
        common.verify_dict_keys({'valid-key': 1, 'nested': {'sub_key': 2}})

    def test_invalid_key_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            common.verify_dict_keys({'bad!key': 1})

    def test_invalid_nested_key_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            common.verify_dict_keys({'outer': {'bad!inner': 1}})


class TestStrategicMergePatch(unittest.TestCase):
    """ Tests for strategic_merge_patch. """

    def test_adds_new_key(self):
        result = common.strategic_merge_patch({'a': 1}, {'b': 2})
        self.assertEqual(result, {'a': 1, 'b': 2})

    def test_replaces_scalar(self):
        result = common.strategic_merge_patch({'a': 1}, {'a': 2})
        self.assertEqual(result, {'a': 2})

    def test_merges_nested_dict(self):
        result = common.strategic_merge_patch(
            {'nested': {'x': 1}}, {'nested': {'y': 2}})
        self.assertEqual(result, {'nested': {'x': 1, 'y': 2}})

    def test_delete_action_removes_key(self):
        result = common.strategic_merge_patch(
            {'a': {'keep': True}}, {'a': {'$action': 'delete'}})
        self.assertNotIn('a', result)

    def test_replace_action_on_list_item(self):
        result = common.strategic_merge_patch(
            {'items': [{'x': 1}, {'x': 2}]},
            {'items': [{'$index': 0, '$action': 'replace', 'y': 99}]})
        self.assertEqual(result['items'][0], {'y': 99})
        self.assertEqual(result['items'][1], {'x': 2})

    def test_delete_action_on_list_item(self):
        result = common.strategic_merge_patch(
            {'items': [{'x': 1}, {'x': 2}]},
            {'items': [{'$index': 0, '$action': 'delete'}]})
        self.assertEqual(result['items'], [{'x': 2}])

    def test_merge_action_on_list_item(self):
        result = common.strategic_merge_patch(
            {'items': [{'x': 1}]},
            {'items': [{'$index': 0, 'y': 2}]})
        self.assertEqual(result['items'], [{'x': 1, 'y': 2}])

    def test_appends_unmatched_list_items(self):
        result = common.strategic_merge_patch(
            {'items': [{'x': 1}]},
            {'items': [{'$index': 5, 'new': True}]})
        self.assertIn({'new': True}, result['items'])

    def test_delete_for_unmatched_index_is_skipped(self):
        result = common.strategic_merge_patch(
            {'items': [{'x': 1}]},
            {'items': [{'$index': 99, '$action': 'delete'}]})
        self.assertEqual(result['items'], [{'x': 1}])

    def test_replaces_list_of_non_dicts(self):
        result = common.strategic_merge_patch(
            {'items': [1, 2]}, {'items': [9]})
        self.assertEqual(result['items'], [9])

    def test_non_dict_original(self):
        # When the original is not a dict but the patch is, return the patch.
        result = common.strategic_merge_patch('scalar', {'a': 1})  # type: ignore[arg-type]
        self.assertEqual(result, {'a': 1})


class TestMergeDictionaries(unittest.TestCase):
    """ Tests for merge_dictionaries. """

    def test_merges_nested(self):
        result = common.merge_dictionaries(
            {'a': {'x': 1}}, {'a': {'y': 2}, 'b': 3})
        self.assertEqual(result, {'a': {'x': 1, 'y': 2}, 'b': 3})

    def test_keeps_existing_scalar(self):
        # When key is in both and not both dicts, keeps the original.
        result = common.merge_dictionaries({'a': 1}, {'a': 2})
        self.assertEqual(result, {'a': 1})

    def test_adds_new_key(self):
        result = common.merge_dictionaries({'a': 1}, {'b': 2})
        self.assertEqual(result, {'a': 1, 'b': 2})


class TestGenerateUniqueId(unittest.TestCase):
    """ Tests for generate_unique_id. """

    def test_full_length(self):
        uid = common.generate_unique_id()
        self.assertEqual(len(uid), 32)

    def test_truncated(self):
        uid = common.generate_unique_id(num_digits=8)
        self.assertEqual(len(uid), 8)


class TestConvertCpuUnit(unittest.TestCase):
    """ Tests for convert_cpu_unit. """

    def test_integer_string(self):
        self.assertEqual(common.convert_cpu_unit('4'), 4.0)

    def test_float_string(self):
        self.assertEqual(common.convert_cpu_unit('2.5'), 2.5)

    def test_milli_unit(self):
        self.assertEqual(common.convert_cpu_unit('500m'), 0.5)

    def test_upper_milli_unit(self):
        self.assertEqual(common.convert_cpu_unit('250M'), 0.25)

    def test_invalid_returns_zero(self):
        with mock.patch('builtins.print'):
            self.assertEqual(common.convert_cpu_unit('not-a-number'), 0.0)


class TestWorkflowId(unittest.TestCase):
    """ Tests for workflow id helpers. """

    def test_construct_workflow_id(self):
        self.assertEqual(common.construct_workflow_id('my-flow', 42), 'my-flow-42')

    def test_deconstruct_workflow_id(self):
        self.assertEqual(
            common.deconstruct_workflow_id('my-flow-42'), ('my-flow', 42))

    def test_deconstruct_preserves_dashes_in_name(self):
        self.assertEqual(
            common.deconstruct_workflow_id('my-multi-dash-name-7'),
            ('my-multi-dash-name', 7))


class TestHeartbeatOnline(unittest.TestCase):
    """ Tests for heartbeat_online. """

    def test_recent_heartbeat_online(self):
        now = datetime.datetime.utcnow()
        self.assertTrue(common.heartbeat_online(now))

    def test_old_heartbeat_offline(self):
        old = datetime.datetime.utcnow() - datetime.timedelta(hours=1)
        self.assertFalse(common.heartbeat_online(old))


class TestMaskString(unittest.TestCase):
    """ Tests for mask_string. """

    def test_masks_single_element(self):
        self.assertEqual(
            common.mask_string('hello secret world', {'secret'}),
            'hello [MASKED] world')

    def test_masks_multiple_elements(self):
        result = common.mask_string('a b c', {'a', 'c'})
        self.assertEqual(result, '[MASKED] b [MASKED]')

    def test_no_matches(self):
        self.assertEqual(
            common.mask_string('no matches here', {'xyz'}),
            'no matches here')


class TestReadableTimedelta(unittest.TestCase):
    """ Tests for readable_timedelta. """

    def test_zero(self):
        self.assertEqual(
            common.readable_timedelta(datetime.timedelta(0)), '0 seconds')

    def test_seconds_only(self):
        self.assertEqual(
            common.readable_timedelta(datetime.timedelta(seconds=45)), '45 seconds')

    def test_days_hours_minutes_seconds(self):
        td = datetime.timedelta(days=2, hours=3, minutes=4, seconds=5)
        self.assertEqual(
            common.readable_timedelta(td),
            '2 days, 3 hours, 4 minutes, 5 seconds')


class TestRelativePath(unittest.TestCase):
    """ Tests for relative_path. """

    def test_same_object_returns_full_path(self):
        # sub_path is the file in the same directory as full_path (no dir change).
        self.assertEqual(common.relative_path('/a/b', '/a/b/file'), '/a/b')

    def test_relative_path(self):
        self.assertEqual(common.relative_path('/a/b/c', '/a/d/file'), '../b/c')


class TestIterableMerger(unittest.TestCase):
    """ Tests for IterableMerger. """

    def test_merges_sorted_iterables(self):
        merger = common.IterableMerger([iter([1, 3, 5]), iter([2, 4, 6])])
        self.assertEqual(list(merger), [1, 2, 3, 4, 5, 6])

    def test_deduplicates_across_iterables(self):
        merger = common.IterableMerger([iter([1, 2, 3]), iter([2, 3, 4])])
        self.assertEqual(list(merger), [1, 2, 3, 4])

    def test_empty_iterables(self):
        merger = common.IterableMerger([iter([]), iter([])])
        self.assertEqual(list(merger), [])

    def test_some_empty_iterables(self):
        merger = common.IterableMerger([iter([1, 2]), iter([])])
        self.assertEqual(list(merger), [1, 2])


class TestListDirectorySorted(unittest.TestCase):
    """ Tests for list_directory_sorted. """

    def test_yields_sorted_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            sub = os.path.join(tmpdir, 'sub')
            os.makedirs(sub)
            with open(os.path.join(tmpdir, 'a.txt'), 'w', encoding='utf-8') as f:
                f.write('x')
            with open(os.path.join(tmpdir, 'b.txt'), 'w', encoding='utf-8') as f:
                f.write('x')
            with open(os.path.join(sub, 'c.txt'), 'w', encoding='utf-8') as f:
                f.write('x')
            result = list(common.list_directory_sorted(tmpdir))
            self.assertEqual(len(result), 3)
            self.assertIn(os.path.join(tmpdir, 'a.txt'), result)
            self.assertIn(os.path.join(tmpdir, 'b.txt'), result)
            self.assertIn(os.path.join(sub, 'c.txt'), result)


class TestHandleMemoryview(unittest.TestCase):
    """ Tests for handle_memoryview. """

    def test_memoryview_converted_to_bytes(self):
        result = common.handle_memoryview(memoryview(b'hello'))
        self.assertEqual(result, b'hello')
        self.assertIsInstance(result, bytes)

    def test_non_memoryview_returned_unchanged(self):
        self.assertEqual(common.handle_memoryview('plain'), 'plain')


class TestFirstCompleted(unittest.TestCase):
    """ Tests for first_completed. """

    def test_returns_first_result(self):
        async def fast():
            return 'fast'

        async def slow():
            await asyncio.sleep(10)
            return 'slow'

        async def run_test():
            return await common.first_completed([fast(), slow()])

        result = asyncio.run(run_test())
        self.assertEqual(result, 'fast')


class TestGatherCancel(unittest.TestCase):
    """ Tests for gather_cancel. """

    def test_runs_all_to_completion(self):
        async def worker(x):
            return x

        async def run_test():
            await common.gather_cancel(worker(1), worker(2))

        # Should complete without error.
        asyncio.run(run_test())

    def test_cancels_on_exception(self):
        async def fail():
            raise RuntimeError('oops')

        async def slow():
            await asyncio.sleep(10)

        async def run_test():
            with self.assertRaises(RuntimeError):
                await common.gather_cancel(fail(), slow())

        asyncio.run(run_test())


class TestLoadContentsFromFile(unittest.TestCase):
    """ Tests for load_contents_from_file. """

    def test_reads_file(self):
        with tempfile.NamedTemporaryFile(
                mode='w', delete=False, encoding='utf-8', suffix='.txt') as tmp:
            tmp.write('hello world')
            tmp_path = tmp.name
        try:
            self.assertEqual(
                common.load_contents_from_file(tmp_path), 'hello world')
        finally:
            os.unlink(tmp_path)


class TestConvertFields(unittest.TestCase):
    """ Tests for convert_fields. """

    def test_cpu_is_float(self):
        self.assertEqual(common.convert_fields('cpu', {'cpu': '4'}), 4.0)

    def test_gpu_is_float(self):
        self.assertEqual(common.convert_fields('gpu', {'gpu': '2'}), 2.0)

    def test_cpu_missing_returns_zero(self):
        self.assertEqual(common.convert_fields('cpu', {}), 0.0)

    def test_memory_is_converted(self):
        result = common.convert_fields('memory', {'memory': '2Gi'})
        self.assertEqual(result, 2.0)


class TestConvertAllocatableRequestFields(unittest.TestCase):
    """ Tests for convert_allocatable_request_fields. """

    def test_uses_default_allocatable_when_no_platform_override(self):
        resource = {
            'allocatable_fields': {'cpu': '4'},
            'usage_fields': {'cpu': '2'},
        }
        allocatable, total = common.convert_allocatable_request_fields(
            'cpu', resource, 'pool-a', 'plat-a')
        self.assertEqual(allocatable, 4.0)
        self.assertEqual(total, 2.0)

    def test_prefers_platform_specific_allocatable(self):
        resource = {
            'allocatable_fields': {'cpu': '4'},
            'platform_allocatable_fields': {'pool-a': {'plat-a': {'cpu': '10'}}},
            'usage_fields': {'cpu': '2'},
        }
        allocatable, total = common.convert_allocatable_request_fields(
            'cpu', resource, 'pool-a', 'plat-a')
        self.assertEqual(allocatable, 10.0)
        self.assertEqual(total, 2.0)


class TestConvertAvailableFields(unittest.TestCase):
    """ Tests for convert_available_fields. """

    def test_uses_default_when_no_platform_override(self):
        resource = {'allocatable_fields': {'cpu': '8'}}
        self.assertEqual(
            common.convert_available_fields('cpu', resource, 'pool-a', 'plat-a'),
            8.0)

    def test_prefers_platform_specific_available(self):
        resource = {
            'allocatable_fields': {'cpu': '8'},
            'platform_available_fields': {'pool-a': {'plat-a': {'cpu': '3'}}},
        }
        self.assertEqual(
            common.convert_available_fields('cpu', resource, 'pool-a', 'plat-a'),
            3.0)


class TestRedisNameHelpers(unittest.TestCase):
    """ Tests for redis name helpers. """

    def test_get_redis_task_log_name(self):
        self.assertEqual(
            common.get_redis_task_log_name('wf-1', 'task-a', 0),
            'wf-1-task-a-0-logs')

    def test_get_task_log_file_name(self):
        self.assertEqual(
            common.get_task_log_file_name('task-a', 2),
            'task_logs_task-a_2.txt')

    def test_get_workflow_events_redis_name(self):
        uid = 'abcdef0123456789abcdef0123456789'
        self.assertEqual(
            common.get_workflow_events_redis_name(uid),
            f'{uid}-pod-conditions')

    def test_get_group_subdomain_name(self):
        self.assertEqual(
            common.get_group_subdomain_name('xyz'), 'osmo-xyz')


class TestValidDateFormat(unittest.TestCase):
    """ Tests for valid_date_format. """

    def test_valid(self):
        self.assertTrue(
            common.valid_date_format('2026-01-02', '%Y-%m-%d'))

    def test_invalid(self):
        self.assertFalse(
            common.valid_date_format('not a date', '%Y-%m-%d'))


class TestConvertUtcDatetimeToUserZone(unittest.TestCase):
    """ Tests for convert_utc_datetime_to_user_zone. """

    def test_valid_with_fractional_seconds(self):
        result = common.convert_utc_datetime_to_user_zone(
            '2026-01-02 03:04:05.123456')
        # Result shape: "Mon DD, YYYY HH:MM TZ"
        self.assertIn('2026', result)

    def test_valid_without_seconds(self):
        result = common.convert_utc_datetime_to_user_zone('2026-01-02 03:04')
        self.assertIn('2026', result)

    def test_invalid_raises(self):
        with self.assertRaises(osmo_errors.OSMOError):
            common.convert_utc_datetime_to_user_zone('garbage-time')


class TestConvertTimezone(unittest.TestCase):
    """ Tests for convert_timezone. """

    def test_round_trip_format(self):
        result = common.convert_timezone('2026-01-02T03:04:05')
        # Output format should be YYYY-MM-DDTHH:MM:SS.
        self.assertRegex(result, r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$')


class TestPromptUser(unittest.TestCase):
    """ Tests for prompt_user. """

    def test_accepts_yes(self):
        with mock.patch('builtins.input', return_value='y'), \
                mock.patch('builtins.print'):
            self.assertTrue(common.prompt_user('continue?'))

    def test_accepts_no(self):
        with mock.patch('builtins.input', return_value='n'), \
                mock.patch('builtins.print'):
            self.assertFalse(common.prompt_user('continue?'))

    def test_retries_on_invalid(self):
        inputs = iter(['maybe', 'yes'])
        with mock.patch('builtins.input', side_effect=lambda _prompt='': next(inputs)), \
                mock.patch('builtins.print'):
            self.assertTrue(common.prompt_user('continue?'))


class TestGetExponentialBackoffDelay(unittest.TestCase):
    """ Tests for get_exponential_backoff_delay. """

    def test_zero_retry_baseline(self):
        with mock.patch('random.random', return_value=0):
            self.assertEqual(common.get_exponential_backoff_delay(0), 1.0)

    def test_retry_scales_exponentially(self):
        with mock.patch('random.random', return_value=0):
            self.assertEqual(common.get_exponential_backoff_delay(3), 8.0)

    def test_retry_clamped_at_32(self):
        with mock.patch('random.random', return_value=0):
            self.assertEqual(common.get_exponential_backoff_delay(100), 32.0)

    def test_adds_random_jitter(self):
        with mock.patch('random.random', return_value=0.5):
            # Jitter is random.random() * 5 = 2.5 + 2^0 = 3.5.
            self.assertEqual(common.get_exponential_backoff_delay(0), 3.5)


class TestStorageConvert(unittest.TestCase):
    """ Tests for storage_convert. """

    def test_zero(self):
        self.assertEqual(common.storage_convert(0), '0 B')

    def test_negative_raises(self):
        with self.assertRaises(ValueError):
            common.storage_convert(-1)

    def test_small_bytes(self):
        self.assertEqual(common.storage_convert(500), '500 B')

    def test_kib(self):
        self.assertEqual(common.storage_convert(2048), '2.0 KiB')

    def test_mib(self):
        self.assertEqual(
            common.storage_convert(2 * 1024 * 1024), '2.0 MiB')

    def test_gib(self):
        self.assertEqual(
            common.storage_convert(3 * 1024 * 1024 * 1024), '3.0 GiB')

    def test_tib(self):
        self.assertEqual(
            common.storage_convert(2 * 1024 ** 4), '2.0 TiB')

    def test_clamped_to_tib(self):
        # Values above PiB still render in TiB since that's the max unit.
        result = common.storage_convert(5 * 1024 ** 5)
        self.assertTrue(result.endswith('TiB'))


if __name__ == '__main__':
    unittest.main()
