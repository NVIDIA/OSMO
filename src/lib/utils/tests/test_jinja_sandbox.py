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
import platform
import time
import unittest

from src.lib.utils import jinja_sandbox, osmo_errors


# Test functions
# These are defined as global functions to avoid pickling issues on macOS.

def triple(x):
    return x*3


def triple_hang_on_odd(x):
    if x % 2 == 0:
        return x*3
    else:
        while True:
            time.sleep(1)


def triple_allocate_on_odd(x):
    if x % 2 == 0:
        return x*3
    else:
        return [100] * (10**15)


# This template is safe and doesen't use too much CPU or memory
GOOD_TEMPLATE = """Hello, {{ name }}!"""

BIG_TEMPLATE = """
workflow:
  name: {{name}}
  task:
{% for task_num in range(0, 4096) %}
  - name: worker_{{task_num}}
    image: ubuntu:22.04
    command:
    - bash
    - -c
    - |
      echo "Hello, world!"
      sleep 1
      python3 my-script.py
{% endfor %}

"""

# This template will loop a huge number of times (with no output) which will consume lots of CPU
CPU_BOUND_TEMPLATE = """
Hello, my name is {{ name }}!
{% for i in range(100000) -%}
{% for j in range(100000) -%}
{% for k in range(100000) -%}
{% for l in range(100000) -%}
{%- endfor %}
{%- endfor %}
{%- endfor %}
{%- endfor %}
"""

# This template will build a massive string which will consume lots of memory
MEMORY_BOUND_TEMPLATE = """
Hello, my name is {{ name }}!
{% set x = 'AAAAAAAAAAAAAAAA' %}
{% for i in range(100000) %}
{% for j in range(100000) %}
{% for k in range(100000) %}
{% for l in range(100000) %}
{% set x = x + x %}
{% endfor %}
{% endfor %}
{% endfor %}
{% endfor %}
"""

# This template will try to access an unsafe method
UNSAFE_TEMPLATE = """
Hello, my name is {{ ''.__class__}}!
"""


class TestJinjaSandbox(unittest.TestCase):
    """Test that the jinja sandbox works as expected"""
    @classmethod
    def setUpClass(cls):
        # Initialize the renderer with a slightly longer timeout to allow memory errors to happen.
        jinja_sandbox.SandboxedJinjaRenderer(workers=2, max_time=3, jinja_memory=50*1024*1024)

    def test_sandboxed_worker_good(self):
        values = [1, 5, 10, 100, 1000]
        results = [triple(x) for x in values]
        worker = jinja_sandbox.SandboxedWorker(triple)
        for value, result in zip(values, results):
            self.assertEqual(worker.run(value), result)

    def test_sandboxed_worker_too_much_cpu(self):
        values = [0, 1, 2]
        results = [3*x if x % 2 == 0 else None for x in values]

        worker = jinja_sandbox.SandboxedWorker(triple_hang_on_odd)
        for value, result in zip(values, results):
            if result is None:
                with self.assertRaises(TimeoutError):
                    worker.run(value)
            else:
                self.assertEqual(worker.run(value), result)

    def test_sandboxed_worker_too_much_memory(self):
        values = [0, 1, 2]
        results = [3*x if x % 2 == 0 else None for x in values]

        worker = jinja_sandbox.SandboxedWorker(triple_allocate_on_odd)
        for value, result in zip(values, results):
            if result is None:
                with self.assertRaises(MemoryError):
                    worker.run(value)
            else:
                self.assertEqual(worker.run(value), result)

    def test_good_template(self):
        result = jinja_sandbox.sandboxed_jinja_substitute(GOOD_TEMPLATE, {'name': 'World'})
        self.assertEqual(result, 'Hello, World!')

    def test_cpu_bound_template(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUsageError, 'TimeoutError'):
            jinja_sandbox.sandboxed_jinja_substitute(CPU_BOUND_TEMPLATE, {'name': 'World'})

    def test_memory_bound_template(self):
        if platform.system() == 'Darwin':
            # On macOS, the memory limit is not enforced, so we expect a timeout error
            with self.assertRaisesRegex(osmo_errors.OSMOUsageError, 'TimeoutError'):
                jinja_sandbox.sandboxed_jinja_substitute(MEMORY_BOUND_TEMPLATE, {'name': 'World'})
        elif platform.system() == 'Linux':
            with self.assertRaisesRegex(osmo_errors.OSMOUsageError, 'MemoryError'):
                jinja_sandbox.sandboxed_jinja_substitute(MEMORY_BOUND_TEMPLATE, {'name': 'World'})
        else:
            raise ValueError(f'Unknown platform: {platform.system()}')

    def test_unsafe_template(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUsageError, 'SecurityError'):
            jinja_sandbox.sandboxed_jinja_substitute(UNSAFE_TEMPLATE, {'name': 'World'})

    def test_big_template_multiple_times(self):
        for _ in range(10):
            jinja_sandbox.sandboxed_jinja_substitute(BIG_TEMPLATE, {'name': 'my-workflow'})


if __name__ == '__main__':
    unittest.main()
