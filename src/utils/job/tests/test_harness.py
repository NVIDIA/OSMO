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

import datetime
import grp
import json
import logging
import os
import pwd
import socket
import subprocess
import tempfile
import threading
import time
from typing import Callable, Dict, Mapping, Type

import kombu  # type: ignore
import kombu.mixins  # type: ignore
import kombu.transport.redis  # type: ignore

from src.utils import connectors
from src.utils.connectors import postgres
from src.utils.job import jobs, backend_jobs

SOCKET_RECONNECT_INTERVAL = 0.1


class Worker(kombu.mixins.ConsumerMixin):
    """ A simple worker to pull a single job from the provided Kombu Queue """
    def __init__(self, connection, job_type_name, backend=False):
        self.connection = connection
        self.job_type_name = job_type_name
        self.job = None
        self.backend=backend

    def get_consumers(self, consumer: Callable, channel: kombu.transport.redis.Channel):
        # pylint: disable=unused-argument, arguments-renamed
        queues = [queue for queue in connectors.redis.JOBS + connectors.redis.BACKEND_JOBS
                  if queue.routing_key == self.job_type_name]
        return [consumer(queues=queues, accept=['json'], callbacks=[self.run_job])]

    def run_job(self, job_spec: Dict, message: kombu.transport.virtual.base.Message):
        self.should_stop = True
        mapping: Mapping[str, Type[jobs.Job]] = jobs.FRONTEND_JOBS
        if self.backend:
            mapping = backend_jobs.BACKEND_JOBS
        self.job = mapping[job_spec['job_type']](**job_spec)
        message.ack()


class TestHarnessConfig(connectors.PostgresConfig, connectors.RedisConfig):
    pass

from src.utils.progress_check import progress

class TestHarness:
    # ... (other methods unchanged)

    def get_and_run_job(self, job_type_name: str, context = None, num_times: int = 1):
        if context is None:
            context = self.job_context
        job = self.get_job(job_type_name)
        
        # Create a dummy progress writer
        progress_file = os.path.join(self.postgres_dir.name, 'progress.txt')
        writer = progress.ProgressWriter(progress_file)
        
        for _ in range(num_times):
            job.execute(context, writer)
        return job
    def __init__(self, postgres_port: int = 5555, redis_port: int = 5556):
        # pylint: disable=consider-using-with
        # Create temporary directory for postgres DB and initialize it
        self.postgres_dir = tempfile.TemporaryDirectory()
        pg_dir = self.postgres_dir.name

        # Try to find postgres user, fallback to current user
        try:
            user_info = pwd.getpwnam('postgres')
            pg_user = 'postgres'
        except KeyError:
            user_info = pwd.getpwuid(os.getuid())
            pg_user = user_info.pw_name

        # Start redis using purely in-memory storage
        self.redis_process = subprocess.Popen(['redis-server', '--port', str(redis_port)])

        # Setup config
        self.config = TestHarnessConfig(
            postgres_user=pg_user,
            postgres_port=postgres_port,
            postgres_password='osmo',
            method='dev',
            redis_port=redis_port)
        pg_bin_paths = [
            '/usr/lib/postgresql/15/bin/',
            '/usr/lib/postgresql/14/bin/',
            '/usr/lib/postgresql/13/bin/',
            '/usr/local/bin/',
            '/opt/homebrew/bin/',
        ]
        
        pg_bin = ''
        for path in pg_bin_paths:
            if os.path.exists(os.path.join(path, 'postgres')):
                pg_bin = path
                break
        
        # If not in common paths, try which
        if not pg_bin:
            try:
                pg_bin_which = subprocess.check_output(['which', 'postgres']).decode().strip()
                pg_bin = os.path.dirname(pg_bin_which) + '/'
            except subprocess.CalledProcessError:
                pg_bin = '/usr/bin/' # Guess something

        os.chown(pg_dir, user_info.pw_uid, user_info.pw_gid)
        with tempfile.NamedTemporaryFile('w+') as pwfile:
            os.chown(pwfile.name, user_info.pw_uid, user_info.pw_gid)
            pwfile.write('osmo')
            pwfile.flush()
            
            # Conditionally use su only if target user is different
            current_user = pwd.getpwuid(os.getuid()).pw_name
            su_cmd = f'su -c' if current_user != pg_user else ''
            
            initdb_cmd = f'{su_cmd} "{pg_bin}initdb -D {pg_dir} -U {pg_user} --pwfile={pwfile.name}" {pg_user}' if su_cmd else \
                         f'"{pg_bin}initdb" -D "{pg_dir}" -U {pg_user} --pwfile="{pwfile.name}"'
            
            subprocess.run(initdb_cmd, shell=True, check=True, cwd='/tmp')

        # Start postgres as a background process
        postgres_cmd = f'{su_cmd} "{pg_bin}postgres -p {postgres_port} -D {pg_dir}" {pg_user}' if su_cmd else \
                       f'"{pg_bin}postgres" -p {postgres_port} -D "{pg_dir}"'
        
        self.postgres_process = subprocess.Popen(postgres_cmd, shell=True, cwd='/tmp')

        # Wait for postgres and redis to start serving
        self._wait_for_port(postgres_port)
        self._wait_for_port(redis_port)

        create_db_cmd = f'{su_cmd} "{pg_bin}createdb -U {pg_user} osmo_db --port {postgres_port}" {pg_user}' if su_cmd else \
                        f'"{pg_bin}createdb" -U {pg_user} osmo_db --port {postgres_port}'
        subprocess.run(create_db_cmd, shell=True, check=True)

        # Initialize db
        self.database = postgres.PostgresConnector(self.config)
        connectors.RedisConnector(self.config)

        # Create job context
        self.job_context = jobs.JobExecutionContext(
            postgres=self.database,
            redis=self.config)

        # Create credentials
        self.database.secret_manager.add_new_user('user')
        self.database.execute_commit_command('insert into credential (user_name, cred_name, ' \
            "cred_type, profile, payload) values ('user', 'swift', 'DATA', " \
            "'swift://test-endpoint/AUTH_team-team', " \
            "'region=>us-west-1, access_key=>test, access_key_id=>test');", tuple())

        # Create notification table (missing in regular init)
        self.database.execute_commit_command('''
            CREATE TABLE IF NOT EXISTS notification (
                user_name TEXT PRIMARY KEY,
                email BOOLEAN,
                slack BOOLEAN
            );
        ''', tuple())

        # No notifications
        self.database.execute_commit_command('INSERT INTO notification (user_name, email, slack)' \
                " VALUES ('user', FALSE, FALSE) ON CONFLICT DO NOTHING;", tuple())

        # Create default backend
        self.database.execute_commit_command("""
            INSERT INTO backends (
                name, description, version, k8s_uid, k8s_namespace,
                dashboard_url, grafana_url, tests,
                scheduler_settings, node_conditions,
                last_heartbeat, created_date, router_address
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s,
                NOW(), NOW(), %s
            ) ON CONFLICT DO NOTHING;
        """, (
            'default', 'Default backend for testing', '1.0',
            'test-uid', 'default',
            '', '', '{}',
            json.dumps({
                'scheduler_type': 'kai',
                'scheduler_name': 'kai-scheduler',
                'scheduler_timeout': 30
            }),
            json.dumps({
                'rules': None,
                'prefix': 'osmo.nvidia.com/'
            }),
            ''
        ))

        # Create default pool with all required fields to satisfy Pydantic model..
        # Use parameterized query to ensure JSON is handled correctly.
        pool_platforms = {
            "linux": {
                "privileged_allowed": False,
                "allowed_mounts": [],
                "default_mounts": [],
                "tolerations": [],
                "labels": {},
                "default_variables": {},
                "resource_validations": [],
                "parsed_resource_validations": [],
                "override_pod_template": [],
                "parsed_pod_template": {}
            }
        }
        
        self.database.execute_commit_command("""
            INSERT INTO pools (
                name, description, backend, 
                enable_maintenance, 
                default_exec_timeout, default_queue_timeout, max_exec_timeout, max_queue_timeout,
                default_exit_actions,
                action_permissions, resources,
                common_default_variables,
                common_resource_validations, parsed_resource_validations,
                common_pod_template, parsed_pod_template,
                platforms, default_platform
            ) VALUES (
                %s, %s, %s,
                %s,
                %s, %s, %s, %s,
                %s,
                %s, %s,
                %s,
                %s, %s,
                %s, %s,
                %s, %s
            ) ON CONFLICT (name) DO UPDATE SET
                platforms = EXCLUDED.platforms,
                default_platform = EXCLUDED.default_platform;
        """, (
            'default-pool', 'Default pool for testing', 'default',
            False,
            '', '', '', '',
            '{}',
            json.dumps({"execute": "PUBLIC", "portforward": "PUBLIC", "cancel": "PUBLIC", "rsync": "PUBLIC"}),
            json.dumps({"gpu": {"guarantee": -1, "maximum": -1, "weight": 1}}),
            '{}',
            '{}', '[]',
            '{}', '{}',
            json.dumps(pool_platforms), 'linux'
        ))

    def _wait_for_port(self, port: int, timeout: int = 5):
        start_time = time.time()
        while True:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                sock.connect(('127.0.0.1', port))
                sock.close()
                break
            except (ConnectionRefusedError, OSError):
                sock.close()
                if time.time() - start_time > timeout:
                    raise
                time.sleep(SOCKET_RECONNECT_INTERVAL)

    def get_job(self, job_type_name: str):
        backend = job_type_name in {'CreateGroup', 'CleanupGroup'}
        transport_options = connectors.TRANSPORT_OPTIONS
        if backend:
            transport_options = connectors.get_backend_transport_option('default')

        with kombu.Connection(self.config.redis_url,
                transport_options=transport_options) as conn:
            worker = Worker(conn, job_type_name, backend)
            thread = threading.Thread(target=worker.run)
            thread.daemon = True
            thread.start()
            thread.join(timeout=2)
            if thread.is_alive():
                raise ValueError(f'Timed out waiting for {job_type_name} job')
            return worker.job

