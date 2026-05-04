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
import uuid

import pydantic

from src.lib.utils import common
from src.lib.utils import osmo_errors


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
    """Tests for pydantic_encoder covering supported JSON conversions."""

    def test_base_model_returns_model_dump(self):
        class Sample(pydantic.BaseModel):
            value: int

        self.assertEqual(common.pydantic_encoder(Sample(value=5)), {'value': 5})

    def test_enum_returns_value(self):
        class Color(enum.Enum):
            RED = 'red'

        self.assertEqual(common.pydantic_encoder(Color.RED), 'red')

    def test_datetime_returns_isoformat(self):
        moment = datetime.datetime(2026, 1, 2, 3, 4, 5)
        self.assertEqual(common.pydantic_encoder(moment), moment.isoformat())

    def test_date_returns_isoformat(self):
        day = datetime.date(2026, 1, 2)
        self.assertEqual(common.pydantic_encoder(day), day.isoformat())

    def test_time_returns_isoformat(self):
        clock = datetime.time(3, 4, 5)
        self.assertEqual(common.pydantic_encoder(clock), clock.isoformat())

    def test_timedelta_returns_total_seconds(self):
        delta = datetime.timedelta(seconds=90)
        self.assertEqual(common.pydantic_encoder(delta), 90.0)

    def test_uuid_returns_string(self):
        sample_uuid = uuid.UUID('12345678-1234-5678-1234-567812345678')
        self.assertEqual(common.pydantic_encoder(sample_uuid), str(sample_uuid))

    def test_set_returns_list(self):
        result = common.pydantic_encoder({1, 2, 3})
        self.assertEqual(sorted(result), [1, 2, 3])

    def test_frozenset_returns_list(self):
        result = common.pydantic_encoder(frozenset(['a', 'b']))
        self.assertEqual(sorted(result), ['a', 'b'])

    def test_bytes_returns_decoded_string(self):
        self.assertEqual(common.pydantic_encoder(b'hello'), 'hello')

    def test_unsupported_type_raises_typeerror(self):
        with self.assertRaises(TypeError):
            common.pydantic_encoder(object())


class TestDatasetStructure(unittest.TestCase):
    """Tests for DatasetStructure parsing and formatting."""

    def test_plain_name(self):
        ds = common.DatasetStructure('my_dataset')
        self.assertEqual(ds.name, 'my_dataset')
        self.assertEqual(ds.bucket, '')
        self.assertEqual(ds.tag, '')

    def test_bucket_name_tag(self):
        ds = common.DatasetStructure('bucket1/my_dataset:v2')
        self.assertEqual(ds.bucket, 'bucket1')
        self.assertEqual(ds.name, 'my_dataset')
        self.assertEqual(ds.tag, 'v2')

    def test_invalid_name_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            common.DatasetStructure('bad name!')

    def test_workflow_spec_allows_curly_braces(self):
        ds = common.DatasetStructure('{bucket}/name:{tag}', workflow_spec=True)
        self.assertEqual(ds.bucket, '{bucket}')
        self.assertEqual(ds.name, 'name')
        self.assertEqual(ds.tag, '{tag}')

    def test_workflow_spec_invalid_name_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            common.DatasetStructure('bad!name', workflow_spec=True)

    def test_full_name_with_all_parts(self):
        ds = common.DatasetStructure('bucket1/dataset:tag1')
        self.assertEqual(ds.full_name, 'bucket1/dataset:tag1')

    def test_full_name_with_name_only(self):
        ds = common.DatasetStructure('dataset')
        self.assertEqual(ds.full_name, 'dataset')

    def test_full_name_with_bucket_only(self):
        ds = common.DatasetStructure('bucket1/dataset')
        self.assertEqual(ds.full_name, 'bucket1/dataset')

    def test_to_dict(self):
        ds = common.DatasetStructure('bucket/dataset:tag')
        self.assertEqual(ds.to_dict(), {'name': 'dataset', 'tag': 'tag'})


class TestAppStructure(unittest.TestCase):
    """Tests for AppStructure parsing and formatting."""

    def test_plain_name(self):
        app = common.AppStructure('my_app')
        self.assertEqual(app.name, 'my_app')
        self.assertIsNone(app.version)

    def test_name_with_version(self):
        app = common.AppStructure('my_app:5')
        self.assertEqual(app.name, 'my_app')
        self.assertEqual(app.version, 5)

    def test_invalid_name_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            common.AppStructure('bad name!')

    def test_from_parts_without_version(self):
        app = common.AppStructure.from_parts('my_app')
        self.assertEqual(app.name, 'my_app')
        self.assertIsNone(app.version)

    def test_from_parts_with_version(self):
        app = common.AppStructure.from_parts('my_app', 3)
        self.assertEqual(app.name, 'my_app')
        self.assertEqual(app.version, 3)

    def test_full_name_with_version(self):
        app = common.AppStructure.from_parts('my_app', 5)
        self.assertEqual(app.full_name, 'my_app:5')

    def test_full_name_without_version(self):
        app = common.AppStructure('my_app')
        self.assertEqual(app.full_name, 'my_app')

    def test_to_dict(self):
        app = common.AppStructure('my_app:5')
        self.assertEqual(app.to_dict(), {'name': 'my_app', 'version': 5})


class TestLRUCache(unittest.TestCase):
    """Tests for LRUCache eviction and access semantics."""

    def test_get_missing_key_returns_none(self):
        cache = common.LRUCache(capacity=2)
        self.assertIsNone(cache.get('missing'))

    def test_set_and_get(self):
        cache = common.LRUCache(capacity=2)
        cache.set('a', 1)
        self.assertEqual(cache.get('a'), 1)

    def test_overwrite_existing_key(self):
        cache = common.LRUCache(capacity=2)
        cache.set('a', 1)
        cache.set('a', 2)
        self.assertEqual(cache.get('a'), 2)

    def test_eviction_beyond_capacity(self):
        cache = common.LRUCache(capacity=2)
        cache.set('a', 1)
        cache.set('b', 2)
        cache.set('c', 3)
        self.assertIsNone(cache.get('a'))
        self.assertEqual(cache.get('b'), 2)
        self.assertEqual(cache.get('c'), 3)

    def test_get_promotes_most_recent(self):
        cache = common.LRUCache(capacity=2)
        cache.set('a', 1)
        cache.set('b', 2)
        # Access 'a' — 'b' becomes least recently used
        cache.get('a')
        cache.set('c', 3)
        self.assertEqual(cache.get('a'), 1)
        self.assertIsNone(cache.get('b'))


class TestTokenBucket(unittest.TestCase):
    """Tests for TokenBucket rate limiting."""

    def test_consume_success_when_enough_tokens(self):
        bucket = common.TokenBucket(capacity=5, refill_rate=1)
        self.assertTrue(bucket.consume(3))

    def test_consume_failure_when_not_enough_tokens(self):
        bucket = common.TokenBucket(capacity=1, refill_rate=1)
        bucket.consume(1)
        # Immediately consuming again should fail since refill rate is low
        self.assertFalse(bucket.consume(1))

    def test_consume_default_tokens(self):
        bucket = common.TokenBucket(capacity=2, refill_rate=1)
        self.assertTrue(bucket.consume())

    def test_wait_for_tokens_returns_when_available(self):
        bucket = common.TokenBucket(capacity=5, refill_rate=1000)

        async def run():
            await bucket.wait_for_tokens(1)

        asyncio.run(run())
        # After wait_for_tokens returns, the bucket should have consumed 1 token
        self.assertLess(bucket.tokens, bucket.capacity)


class TestDockerImageInfo(unittest.TestCase):
    """Tests for DockerImageInfo properties."""

    def test_reference_returns_digest_when_present(self):
        info = common.DockerImageInfo(
            name='lib/app', original='lib/app', tag='v1', digest='sha256:abc')
        self.assertEqual(info.reference, 'sha256:abc')

    def test_reference_returns_tag_when_no_digest(self):
        info = common.DockerImageInfo(
            name='lib/app', original='lib/app', tag='v1', digest=None)
        self.assertEqual(info.reference, 'v1')

    def test_reference_returns_latest_when_neither(self):
        info = common.DockerImageInfo(
            name='lib/app', original='lib/app', tag=None, digest=None)
        self.assertEqual(info.reference, 'latest')

    def test_manifest_url_uses_reference(self):
        info = common.DockerImageInfo(
            name='lib/app', original='lib/app', tag='v2', digest=None,
            host='example.com', port=5000)
        self.assertEqual(
            info.manifest_url, 'https://example.com:5000/v2/lib/app/manifests/v2')


class TestDockerParseErrors(unittest.TestCase):
    """Tests for docker_parse error conditions and helpers."""

    def test_invalid_image_raises(self):
        with self.assertRaises(osmo_errors.OSMOUsageError):
            common.docker_parse('BAD_UPPERCASE_NAME')

    def test_registry_parse_empty_returns_default(self):
        self.assertEqual(common.registry_parse(''), common.DEFAULT_REGISTRY)

    def test_registry_parse_docker_io_returns_default(self):
        self.assertEqual(common.registry_parse('docker.io'), common.DEFAULT_REGISTRY)

    def test_registry_parse_custom_registry(self):
        self.assertEqual(common.registry_parse('gcr.io'), 'gcr.io')


class TestAllocatableResource(unittest.TestCase):
    """Tests for AllocatableResource.resource_label_with_unit."""

    def test_label_with_unit(self):
        resource = common.AllocatableResource(name='memory', kube_label='memory', unit='Gi')
        self.assertEqual(resource.resource_label_with_unit, 'Memory [Gi]')

    def test_label_without_unit(self):
        resource = common.AllocatableResource(name='cpu', kube_label='cpu')
        self.assertEqual(resource.resource_label_with_unit, 'CPU [#]')


class TestGpuVersionedLabel(unittest.TestCase):
    """Tests for GpuVersionedLabel."""

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
            version_levels=['major', 'minor', 'rev'])
        self.assertEqual(
            label.convert_to_version_labels('11.8.0'),
            {
                'nvidia.com/cuda.driver.major': '11',
                'nvidia.com/cuda.driver.minor': '8',
                'nvidia.com/cuda.driver.rev': '0',
            })

    def test_convert_to_version_labels_partial(self):
        label = common.GpuVersionedLabel(
            kube_label_prefix='nvidia.com/cuda.driver',
            version_levels=['major', 'minor', 'rev'])
        # With fewer parts, only matching version_levels should be populated
        self.assertEqual(
            label.convert_to_version_labels('11.8'),
            {
                'nvidia.com/cuda.driver.major': '11',
                'nvidia.com/cuda.driver.minor': '8',
            })


class TestMergeListsOnName(unittest.TestCase):
    """Tests for merge_lists_on_name."""

    def test_merge_matching_items(self):
        list_a = [{'name': 'a', 'value': 1}, {'name': 'b', 'value': 2}]
        list_b = [{'name': 'a', 'value': 10}]
        result = common.merge_lists_on_name(list_a, list_b)
        self.assertEqual(
            result,
            [{'name': 'a', 'value': 10}, {'name': 'b', 'value': 2}])

    def test_append_unmatched_items(self):
        list_a = [{'name': 'a', 'value': 1}]
        list_b = [{'name': 'c', 'value': 3}]
        result = common.merge_lists_on_name(list_a, list_b)
        self.assertEqual(
            result,
            [{'name': 'a', 'value': 1}, {'name': 'c', 'value': 3}])

    def test_item_without_name_appended(self):
        list_a = [{'name': 'a', 'value': 1}]
        list_b = [{'value': 42}]
        result = common.merge_lists_on_name(list_a, list_b)
        self.assertEqual(len(result), 2)
        self.assertIn({'value': 42}, result)


class TestRecursiveDictUpdate(unittest.TestCase):
    """Tests for recursive_dict_update."""

    def test_shallow_update(self):
        result = common.recursive_dict_update({'a': 1}, {'b': 2})
        self.assertEqual(result, {'a': 1, 'b': 2})

    def test_nested_update(self):
        result = common.recursive_dict_update({'a': {'x': 1}}, {'a': {'y': 2}})
        self.assertEqual(result, {'a': {'x': 1, 'y': 2}})

    def test_list_replaced_without_merge_func(self):
        result = common.recursive_dict_update({'a': [1, 2]}, {'a': [3, 4]})
        self.assertEqual(result, {'a': [3, 4]})

    def test_list_merged_with_merge_func(self):
        result = common.recursive_dict_update(
            {'items': [{'name': 'a', 'v': 1}]},
            {'items': [{'name': 'a', 'v': 2}]},
            list_merge_func=common.merge_lists_on_name)
        self.assertEqual(result, {'items': [{'name': 'a', 'v': 2}]})

    def test_list_replaces_non_list(self):
        result = common.recursive_dict_update(
            {'items': 'not-a-list'},
            {'items': [{'name': 'a'}]},
            list_merge_func=common.merge_lists_on_name)
        self.assertEqual(result, {'items': [{'name': 'a'}]})


class TestToTimedelta(unittest.TestCase):
    """Tests for to_timedelta and _parse_iso8601_duration."""

    def test_seconds(self):
        self.assertEqual(common.to_timedelta('30s'), datetime.timedelta(seconds=30))

    def test_minutes(self):
        self.assertEqual(common.to_timedelta('5m'), datetime.timedelta(minutes=5))

    def test_hours(self):
        self.assertEqual(common.to_timedelta('2h'), datetime.timedelta(hours=2))

    def test_days(self):
        self.assertEqual(common.to_timedelta('3d'), datetime.timedelta(days=3))

    def test_milliseconds(self):
        self.assertEqual(common.to_timedelta('500ms'), datetime.timedelta(milliseconds=500))

    def test_microseconds(self):
        self.assertEqual(common.to_timedelta('250us'), datetime.timedelta(microseconds=250))

    def test_iso8601_seconds(self):
        self.assertEqual(common.to_timedelta('PT10S'), datetime.timedelta(seconds=10))

    def test_iso8601_full(self):
        self.assertEqual(
            common.to_timedelta('P1DT2H30M15S'),
            datetime.timedelta(days=1, hours=2, minutes=30, seconds=15))

    def test_iso8601_empty_after_p_raises(self):
        with self.assertRaises(ValueError):
            common.to_timedelta('P')

    def test_iso8601_bad_format_raises(self):
        with self.assertRaises(ValueError):
            common.to_timedelta('PXYZ')

    def test_unsupported_unit_raises(self):
        with self.assertRaises(ValueError):
            common.to_timedelta('10z')

    def test_invalid_numeric_raises(self):
        with self.assertRaises(ValueError):
            common.to_timedelta('abc')


class TestTimedeltaToStr(unittest.TestCase):
    """Tests for timedelta_to_str."""

    def test_seconds(self):
        self.assertEqual(
            common.timedelta_to_str(datetime.timedelta(seconds=90)), '90s')

    def test_zero(self):
        self.assertEqual(
            common.timedelta_to_str(datetime.timedelta(seconds=0)), '0s')


class TestConvertResourceValueErrors(unittest.TestCase):
    """Tests for convert_resource_value_str error paths."""

    def test_invalid_value_raises(self):
        with self.assertRaises(ValueError):
            common.convert_resource_value_str('???')

    def test_unknown_unit_raises(self):
        with self.assertRaises(osmo_errors.OSMOSchemaError):
            common.convert_resource_value_str('10Xi')

    def test_unknown_target_raises(self):
        with self.assertRaises(osmo_errors.OSMOSchemaError):
            common.convert_resource_value_str('10Gi', target='Xi')

    def test_no_unit_defaults_to_bytes(self):
        # 1024 bytes -> 1 KiB
        self.assertEqual(common.convert_resource_value_str('1024', target='KiB'), 1.0)


class TestCollectFileSizes(unittest.TestCase):
    """Tests for collect_file_sizes."""

    def test_single_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, 'a.txt')
            with open(file_path, 'wb') as f:
                f.write(b'hello')
            sizes, total = common.collect_file_sizes([file_path])
            self.assertEqual(sizes[file_path], 5)
            self.assertEqual(total, 5)

    def test_multiple_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            first = os.path.join(tmpdir, 'a.txt')
            second = os.path.join(tmpdir, 'b.txt')
            with open(first, 'wb') as f:
                f.write(b'abc')
            with open(second, 'wb') as f:
                f.write(b'defg')
            sizes, total = common.collect_file_sizes([first, second])
            self.assertEqual(total, 7)
            self.assertEqual(sizes[first], 3)
            self.assertEqual(sizes[second], 4)

    def test_empty_list(self):
        sizes, total = common.collect_file_sizes([])
        self.assertEqual(sizes, {})
        self.assertEqual(total, 0)


class TestCollectFsObjects(unittest.TestCase):
    """Tests for collect_fs_objects."""

    def test_single_file_returned(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, 'file.txt')
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write('x')
            self.assertEqual(common.collect_fs_objects(file_path), [file_path])

    def test_directory_walks_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            nested_dir = os.path.join(tmpdir, 'nested')
            os.makedirs(nested_dir)
            file_a = os.path.join(tmpdir, 'a.txt')
            file_b = os.path.join(nested_dir, 'b.txt')
            with open(file_a, 'w', encoding='utf-8') as f:
                f.write('x')
            with open(file_b, 'w', encoding='utf-8') as f:
                f.write('y')
            found = common.collect_fs_objects(tmpdir)
            self.assertEqual(set(found), {file_a, file_b})

    def test_missing_path_returns_empty(self):
        self.assertEqual(common.collect_fs_objects('/nonexistent/path/xyz'), [])


class TestEtagChecksum(unittest.TestCase):
    """Tests for etag_checksum covering empty, single-chunk, and multi-chunk."""

    def test_empty_file(self):
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp_path = tmp.name
        try:
            result = common.etag_checksum(tmp_path)
            # Empty file returns md5 of nothing (32 hex chars)
            self.assertEqual(len(result), 32)
        finally:
            os.unlink(tmp_path)

    def test_single_chunk(self):
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(b'hello')
            tmp_path = tmp.name
        try:
            result = common.etag_checksum(tmp_path)
            # Single-chunk format: 32 hex chars with no dash
            self.assertEqual(len(result), 32)
            self.assertNotIn('-', result)
        finally:
            os.unlink(tmp_path)

    def test_multi_chunk(self):
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(b'a' * 10)
            tmp_path = tmp.name
        try:
            # Force multi-chunk by using small chunk_size
            result = common.etag_checksum(tmp_path, chunk_size=3)
            # Multi-chunk format ends with dash-count
            self.assertIn('-', result)
            self.assertTrue(result.endswith('-4'))
        finally:
            os.unlink(tmp_path)


class TestOsmoTable(unittest.TestCase):
    """Tests for osmo_table and create_table_with_sum_row."""

    def test_osmo_table_has_header(self):
        table = common.osmo_table(['col_a', 'col_b'])
        output = table.draw()
        self.assertIn('col_a', output)
        self.assertIn('col_b', output)

    def test_osmo_table_fit_width_no_terminal_error(self):
        # Should not raise even when no tty available
        table = common.osmo_table(['col_a'], fit_width=True)
        self.assertIn('col_a', table.draw())

    def test_create_table_with_sum_row_adds_total(self):
        table = common.osmo_table(['col_a', 'col_b'])
        table.add_row(['x', 'y'])
        output = common.create_table_with_sum_row(table, ['total_a', 'total_b'])
        self.assertIn('total_a', output)
        self.assertIn('total_b', output)
        self.assertIn('x', output)


class TestVerifyDictKeys(unittest.TestCase):
    """Tests for verify_dict_keys."""

    def test_valid_flat_keys(self):
        common.verify_dict_keys({'a': 1, 'b_c-d': 2})

    def test_valid_nested_keys(self):
        common.verify_dict_keys({'a': {'b': {'c': 1}}})

    def test_invalid_key_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            common.verify_dict_keys({'bad key!': 1})

    def test_invalid_nested_key_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            common.verify_dict_keys({'outer': {'bad!': 1}})


class TestStrategicMergePatch(unittest.TestCase):
    """Tests for strategic_merge_patch."""

    def test_patch_replaces_dict_when_original_scalar(self):
        result = common.strategic_merge_patch({'a': 'scalar'}, {'a': {'b': 1}})
        self.assertEqual(result, {'a': {'b': 1}})

    def test_patch_adds_missing_key(self):
        result = common.strategic_merge_patch({'a': 1}, {'b': 2})
        self.assertEqual(result, {'a': 1, 'b': 2})

    def test_patch_deletes_key(self):
        result = common.strategic_merge_patch({'a': 1, 'b': 2}, {'b': {'$action': 'delete'}})
        self.assertEqual(result, {'a': 1})

    def test_patch_merges_nested_dict(self):
        result = common.strategic_merge_patch({'a': {'x': 1}}, {'a': {'y': 2}})
        self.assertEqual(result, {'a': {'x': 1, 'y': 2}})

    def test_patch_scalar_replace(self):
        result = common.strategic_merge_patch({'a': 1}, {'a': 2})
        self.assertEqual(result, {'a': 2})

    def test_patch_list_of_scalars_replaced(self):
        result = common.strategic_merge_patch({'a': [1, 2, 3]}, {'a': [4, 5]})
        self.assertEqual(result, {'a': [4, 5]})

    def test_patch_list_of_dicts_merge_by_index(self):
        result = common.strategic_merge_patch(
            {'items': [{'k': 'a'}, {'k': 'b'}]},
            {'items': [{'$index': 0, 'extra': True}]})
        self.assertEqual(
            result,
            {'items': [{'k': 'a', 'extra': True}, {'k': 'b'}]})

    def test_patch_list_of_dicts_replace_by_index(self):
        result = common.strategic_merge_patch(
            {'items': [{'k': 'a'}, {'k': 'b'}]},
            {'items': [{'$index': 1, '$action': 'replace', 'k': 'replaced'}]})
        self.assertEqual(result['items'][1], {'k': 'replaced'})

    def test_patch_list_of_dicts_delete_by_index(self):
        result = common.strategic_merge_patch(
            {'items': [{'k': 'a'}, {'k': 'b'}]},
            {'items': [{'$index': 0, '$action': 'delete'}]})
        self.assertEqual(result['items'], [{'k': 'b'}])

    def test_patch_list_of_dicts_append_unmatched(self):
        result = common.strategic_merge_patch(
            {'items': [{'k': 'a'}]},
            {'items': [{'$index': 5, 'k': 'new'}]})
        # Unmatched $index items are appended without the $index field
        self.assertEqual(result['items'], [{'k': 'a'}, {'k': 'new'}])


class TestMergeDictionaries(unittest.TestCase):
    """Tests for merge_dictionaries."""

    def test_missing_key_added(self):
        target = {'a': 1}
        common.merge_dictionaries(target, {'b': 2})
        self.assertEqual(target, {'a': 1, 'b': 2})

    def test_existing_scalar_not_overwritten(self):
        target = {'a': 1}
        common.merge_dictionaries(target, {'a': 99})
        self.assertEqual(target, {'a': 1})

    def test_nested_dict_merged(self):
        target = {'a': {'x': 1}}
        common.merge_dictionaries(target, {'a': {'y': 2}})
        self.assertEqual(target, {'a': {'x': 1, 'y': 2}})


class TestConvertCpuUnit(unittest.TestCase):
    """Tests for convert_cpu_unit."""

    def test_plain_float(self):
        self.assertEqual(common.convert_cpu_unit('2'), 2.0)

    def test_milliunit_lower(self):
        self.assertEqual(common.convert_cpu_unit('500m'), 0.5)

    def test_milliunit_upper(self):
        self.assertEqual(common.convert_cpu_unit('500M'), 0.5)

    def test_invalid_returns_zero(self):
        self.assertEqual(common.convert_cpu_unit('abc'), 0.0)


class TestWorkflowIdHelpers(unittest.TestCase):
    """Tests for construct_workflow_id / deconstruct_workflow_id."""

    def test_construct(self):
        self.assertEqual(common.construct_workflow_id('my-workflow', 42), 'my-workflow-42')

    def test_deconstruct(self):
        name, job_id = common.deconstruct_workflow_id('my-workflow-42')
        self.assertEqual(name, 'my-workflow')
        self.assertEqual(job_id, 42)

    def test_deconstruct_with_hyphenated_name(self):
        name, job_id = common.deconstruct_workflow_id('a-b-c-100')
        self.assertEqual(name, 'a-b-c')
        self.assertEqual(job_id, 100)


class TestMaskString(unittest.TestCase):
    """Tests for mask_string."""

    def test_masks_single_element(self):
        self.assertEqual(
            common.mask_string('my secret password', {'secret'}),
            'my [MASKED] password')

    def test_masks_multiple_elements(self):
        masked = common.mask_string('user=admin pass=123', {'admin', '123'})
        self.assertEqual(masked, 'user=[MASKED] pass=[MASKED]')

    def test_no_match_returns_original(self):
        self.assertEqual(common.mask_string('hello', {'xyz'}), 'hello')


class TestReadableTimedelta(unittest.TestCase):
    """Tests for readable_timedelta."""

    def test_zero(self):
        self.assertEqual(common.readable_timedelta(datetime.timedelta(0)), '0 seconds')

    def test_seconds(self):
        self.assertEqual(common.readable_timedelta(datetime.timedelta(seconds=42)), '42 seconds')

    def test_minutes_and_seconds(self):
        self.assertEqual(
            common.readable_timedelta(datetime.timedelta(seconds=125)),
            '2 minutes, 5 seconds')

    def test_hours_minutes(self):
        self.assertEqual(
            common.readable_timedelta(datetime.timedelta(hours=1, minutes=5)),
            '1 hours, 5 minutes')

    def test_days_included(self):
        self.assertEqual(
            common.readable_timedelta(datetime.timedelta(days=2, hours=3)),
            '2 days, 3 hours')


class TestRelativePath(unittest.TestCase):
    """Tests for relative_path."""

    def test_same_path_returns_full(self):
        # When sub_path's parent equals full_path, returns full_path
        result = common.relative_path('/a/b', '/a/b/file.txt')
        self.assertEqual(result, '/a/b')

    def test_relative_computed(self):
        result = common.relative_path('/a/b/c', '/a/file.txt')
        self.assertEqual(result, 'b/c')


class TestIterableMerger(unittest.TestCase):
    """Tests for IterableMerger."""

    def test_merges_sorted_iterables(self):
        merger = common.IterableMerger([iter([1, 3, 5]), iter([2, 4, 6])])
        self.assertEqual(list(merger), [1, 2, 3, 4, 5, 6])

    def test_deduplicates_across_iterables(self):
        merger = common.IterableMerger([iter([1, 2, 3]), iter([2, 3, 4])])
        self.assertEqual(list(merger), [1, 2, 3, 4])

    def test_empty_iterables(self):
        merger = common.IterableMerger([iter([]), iter([])])
        self.assertEqual(list(merger), [])

    def test_single_iterable(self):
        merger = common.IterableMerger([iter([5, 10, 15])])
        self.assertEqual(list(merger), [5, 10, 15])


class TestListDirectorySorted(unittest.TestCase):
    """Tests for list_directory_sorted."""

    def test_sorted_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            paths = [os.path.join(tmpdir, name) for name in ('b.txt', 'a.txt', 'c.txt')]
            for path in paths:
                with open(path, 'w', encoding='utf-8') as f:
                    f.write('x')
            result = list(common.list_directory_sorted(tmpdir))
            self.assertEqual(result, sorted(paths))

    def test_recurses_into_subdirs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, 'sub')
            os.makedirs(subdir)
            nested = os.path.join(subdir, 'a.txt')
            top = os.path.join(tmpdir, 'z.txt')
            with open(nested, 'w', encoding='utf-8') as f:
                f.write('x')
            with open(top, 'w', encoding='utf-8') as f:
                f.write('y')
            result = list(common.list_directory_sorted(tmpdir))
            self.assertEqual(result, [nested, top])


class TestHandleMemoryview(unittest.TestCase):
    """Tests for handle_memoryview."""

    def test_converts_memoryview_to_bytes(self):
        mv = memoryview(b'hello')
        self.assertEqual(common.handle_memoryview(mv), b'hello')

    def test_non_memoryview_passes_through(self):
        self.assertEqual(common.handle_memoryview(42), 42)


class TestFirstCompleted(unittest.TestCase):
    """Tests for first_completed."""

    def test_returns_first_result(self):
        async def fast():
            return 'fast'

        async def slow():
            await asyncio.sleep(1)
            return 'slow'

        result = asyncio.run(common.first_completed([fast(), slow()]))
        self.assertEqual(result, 'fast')


class TestGatherCancel(unittest.TestCase):
    """Tests for gather_cancel."""

    def test_runs_coroutines(self):
        ran = []

        async def work(value):
            ran.append(value)

        async def main():
            await common.gather_cancel(work(1), work(2))

        asyncio.run(main())
        self.assertEqual(sorted(ran), [1, 2])

    def test_cancels_on_exception(self):
        async def raiser():
            raise RuntimeError('boom')

        async def slow():
            await asyncio.sleep(10)

        async def main():
            with self.assertRaises(RuntimeError):
                await common.gather_cancel(raiser(), slow())

        asyncio.run(main())


class TestLoadContentsFromFile(unittest.TestCase):
    """Tests for load_contents_from_file."""

    def test_reads_content(self):
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt') as tmp:
            tmp.write('hello\nworld')
            tmp_path = tmp.name
        try:
            self.assertEqual(common.load_contents_from_file(tmp_path), 'hello\nworld')
        finally:
            os.unlink(tmp_path)


class TestConvertFields(unittest.TestCase):
    """Tests for convert_fields helper."""

    def test_cpu_converts_to_float(self):
        self.assertEqual(common.convert_fields('cpu', {'cpu': 4}), 4.0)

    def test_cpu_missing_defaults_zero(self):
        self.assertEqual(common.convert_fields('cpu', {}), 0.0)

    def test_memory_uses_resource_value_conversion(self):
        self.assertEqual(common.convert_fields('memory', {'memory': '2Gi'}), 2.0)


class TestConvertAllocatableRequestFields(unittest.TestCase):
    """Tests for convert_allocatable_request_fields."""

    def test_default_allocatable_used(self):
        resource = {
            'allocatable_fields': {'cpu': 4},
            'usage_fields': {'cpu': 1},
        }
        allocatable, total = common.convert_allocatable_request_fields(
            'cpu', resource, 'pool', 'platform')
        self.assertEqual(allocatable, 4.0)
        self.assertEqual(total, 1.0)

    def test_platform_specific_allocatable_overrides(self):
        resource = {
            'allocatable_fields': {'cpu': 4},
            'platform_allocatable_fields': {'pool_a': {'platform_a': {'cpu': 8}}},
            'usage_fields': {'cpu': 2},
        }
        allocatable, total = common.convert_allocatable_request_fields(
            'cpu', resource, 'pool_a', 'platform_a')
        self.assertEqual(allocatable, 8.0)
        self.assertEqual(total, 2.0)


class TestConvertAvailableFields(unittest.TestCase):
    """Tests for convert_available_fields."""

    def test_default_available(self):
        resource = {'allocatable_fields': {'cpu': 4}}
        self.assertEqual(
            common.convert_available_fields('cpu', resource, 'pool', 'platform'),
            4.0)

    def test_platform_specific_available(self):
        resource = {
            'allocatable_fields': {'cpu': 4},
            'platform_available_fields': {'pool_a': {'platform_a': {'cpu': 16}}},
        }
        self.assertEqual(
            common.convert_available_fields('cpu', resource, 'pool_a', 'platform_a'),
            16.0)


class TestStorageConvert(unittest.TestCase):
    """Tests for storage_convert."""

    def test_zero(self):
        self.assertEqual(common.storage_convert(0), '0 B')

    def test_bytes(self):
        self.assertEqual(common.storage_convert(512), '512 B')

    def test_kib(self):
        self.assertEqual(common.storage_convert(2048), '2.0 KiB')

    def test_mib(self):
        self.assertEqual(common.storage_convert(2 * 1024 * 1024), '2.0 MiB')

    def test_gib(self):
        self.assertEqual(common.storage_convert(3 * 1024 ** 3), '3.0 GiB')

    def test_negative_raises(self):
        with self.assertRaises(ValueError):
            common.storage_convert(-1)


class TestExponentialBackoffDelay(unittest.TestCase):
    """Tests for get_exponential_backoff_delay."""

    def test_positive_delay_returned(self):
        delay = common.get_exponential_backoff_delay(0)
        self.assertGreaterEqual(delay, 1.0)
        self.assertLessEqual(delay, 6.0)

    def test_capped_at_retry_five(self):
        delay = common.get_exponential_backoff_delay(10)
        # 2 ** min(10, 5) = 32, plus random [0,5)
        self.assertGreaterEqual(delay, 32.0)
        self.assertLess(delay, 37.0)


class TestRedisAndLogNameHelpers(unittest.TestCase):
    """Tests for redis and task log name helpers."""

    def test_redis_task_log_name(self):
        self.assertEqual(
            common.get_redis_task_log_name('wf-1', 'task_a', 0),
            'wf-1-task_a-0-logs')

    def test_task_log_file_name(self):
        self.assertEqual(
            common.get_task_log_file_name('task_a', 2),
            'task_logs_task_a_2.txt')

    def test_workflow_events_redis_name(self):
        uuid_str = 'a' * 32
        self.assertEqual(
            common.get_workflow_events_redis_name(uuid_str),
            f'{uuid_str}-pod-conditions')

    def test_group_subdomain_name(self):
        self.assertEqual(common.get_group_subdomain_name('abc123'), 'osmo-abc123')


class TestValidDateFormat(unittest.TestCase):
    """Tests for valid_date_format."""

    def test_valid_format(self):
        self.assertTrue(common.valid_date_format('2026-01-02', '%Y-%m-%d'))

    def test_invalid_format(self):
        self.assertFalse(common.valid_date_format('not-a-date', '%Y-%m-%d'))


class TestGenerateUniqueId(unittest.TestCase):
    """Tests for generate_unique_id."""

    def test_default_length(self):
        unique = common.generate_unique_id()
        self.assertEqual(len(unique), 32)

    def test_truncated_length(self):
        self.assertEqual(len(common.generate_unique_id(num_digits=8)), 8)


class TestHeartbeatOnline(unittest.TestCase):
    """Tests for heartbeat_online."""

    def test_recent_timestamp_is_online(self):
        now = common.current_time()
        self.assertTrue(common.heartbeat_online(now))

    def test_old_timestamp_is_offline(self):
        old = common.current_time() - datetime.timedelta(minutes=10)
        self.assertFalse(common.heartbeat_online(old))


if __name__ == '__main__':
    unittest.main()
