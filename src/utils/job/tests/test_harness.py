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


class TestHarness:
    """ A simple test harness that creates a redis and postgres instance, and static config struct.
    This also adds initial credentails and settings to the database """
    def __init__(self, postgres_port: int = 5555, redis_port: int = 5556):
        # pylint: disable=consider-using-with
        # Setup config
        self.config = TestHarnessConfig(
            postgres_port=postgres_port,
            postgres_password='osmo',
            method='dev',
            redis_port=redis_port)

        # Start redis using purely in-memory storage
        self.redis_process = subprocess.Popen(['redis-server', '--port', str(redis_port)])

        # Create temporary directory for postgres DB and initialize it
        self.postgres_dir = tempfile.TemporaryDirectory()
        pg_dir = self.postgres_dir.name
        user_info = pwd.getpwnam('postgres')
        os.chown(pg_dir, user_info.pw_uid, user_info.pw_gid)
        with tempfile.NamedTemporaryFile('w+') as pwfile:
            os.chown(pwfile.name, user_info.pw_uid, user_info.pw_gid)
            pwfile.write('osmo')
            pwfile.flush()
            subprocess.run(f'su -c "/usr/lib/postgresql/15/bin/initdb ' \
                f'-D {pg_dir} -U postgres --pwfile={pwfile.name}" postgres',
                shell=True, check=True, cwd='/tmp')

        # Start postgres as a background process
        self.postgres_process = \
            subprocess.Popen(f'su -c "/usr/lib/postgresql/15/bin/postgres ' \
                f'-p {postgres_port} -D {pg_dir}" postgres',
                shell=True, cwd='/tmp')

        # Wait for postgres and redis to start serving
        self._wait_for_port(postgres_port)
        self._wait_for_port(redis_port)

        subprocess.run(f'su -c "/usr/lib/postgresql/15/bin/createdb ' \
            f'-U postgres osmo_db --port {postgres_port}" postgres',
            shell=True, check=True)

        # Initialize db
        self.database = postgres.PostgresConnector(self.config)
        configs = self.database.get_service_configs()

        serialized_config = configs.serialize(self.database)
        self.database.set_config('workflow_backends',
                                 serialized_config['workflow_backends'],
                                 connectors.ConfigType.SERVICE)

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

        # No notifications
        self.database.execute_commit_command('INSERT INTO notification (user_name, email, slack)' \
                " VALUES ('user', FALSE, FALSE) ON CONFLICT DO NOTHING;", tuple())


    def _wait_for_port(self, port: int, timeout: int = 5):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        start_time = time.time()
        while True:
            try:
                sock.connect(('localhost', port))
                break
            except ConnectionRefusedError as error:
                if time.time() - start_time > timeout:
                    raise error
                time.sleep(SOCKET_RECONNECT_INTERVAL)
        sock.close()

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

    def get_and_run_job(self, job_type_name: str, context = None, num_times: int = 1):
        if context is None:
            context = self.job_context
        job = self.get_job(job_type_name)
        for _ in range(num_times):
            job.execute(context)
        return job
