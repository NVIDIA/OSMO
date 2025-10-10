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

import io
import logging
import os
import re
import socket
import tarfile
import time
from functools import cache

import boto3
import docker  # type: ignore
from testcontainers.core import config, utils  # type: ignore

logger = logging.getLogger(__name__)

DOCKER_HUB_REGISTRY = os.getenv('DOCKER_HUB_REGISTRY', 'docker.io')
DOCKER_DESKTOP_LOCALHOST = 'host.docker.internal'
DOCKER_DEFAULT_LOCALHOST = '127.0.0.1'

# Shorten the testcontainer startup timeout to 150 secs (half of test timeout 300s)
config.testcontainers_config.max_tries = 150
config.testcontainers_config.sleep_time = 1

# Use Ryuk image from Nvidia's DockerHub
config.testcontainers_config.ryuk_image = f'{DOCKER_HUB_REGISTRY}/{config.RYUK_IMAGE}'

# Save the original boto3.Session function to allow restoration
_OriginalSession = boto3.Session


def patch_boto3_session_for_ssl_verification():
    """
    Patches boto3.Session to disable SSL verification globally
    """
    def _patched_boto3_session(*args, **kwargs):
        session = _OriginalSession(*args, **kwargs)
        original_session_client = session.client

        def _patched_session_client(service_name, **client_kwargs):
            if 'verify' not in client_kwargs:
                client_kwargs['verify'] = False
            return original_session_client(service_name, **client_kwargs)

        setattr(session, 'client', _patched_session_client)
        return session

    setattr(boto3, 'Session', _patched_boto3_session)


def restore_boto3_session():
    """
    Restores the original boto3.Session
    """
    setattr(boto3, 'Session', _OriginalSession)

#patch added for CVE-2025-8194 - to prevent tarfile.InvalidHeaderError
_ORIGINAL_TARINFO_BLOCK = getattr(tarfile.TarInfo, '_block')

def _patched_tarinfo_block(self, count):
    if count < 0:
        raise tarfile.InvalidHeaderError('invalid offset') # type: ignore[attr-defined]
    return _ORIGINAL_TARINFO_BLOCK(self, count)

setattr(tarfile.TarInfo, '_block', _patched_tarinfo_block)

def copy_file_to_container(container, host_path, container_path):
    """
    Copy a file from the host to a Docker container.
    """
    with open(host_path, 'rb') as file_obj:
        # Create a tar stream with the file
        tar_stream = io.BytesIO()

        with tarfile.open(fileobj=tar_stream, mode='w') as tar:
            tarinfo = tarfile.TarInfo(name=os.path.basename(container_path))
            tarinfo.size = os.fstat(file_obj.fileno()).st_size
            tar.addfile(tarinfo, file_obj)

        tar_stream.seek(0)

        # Copy the tar stream into the container
        dir_name = os.path.dirname(container_path)
        container.exec_run(['mkdir', '-p', dir_name])
        container.put_archive(dir_name, tar_stream)


def retry(retries, delay, on_failure=None):
    def decorator(func):
        def wrapper(*args, **kwargs):
            last_exception: Exception | None = None
            for attempt in range(retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:  # pylint: disable=broad-except
                    last_exception = e
                    logger.error((f'Attempt {attempt + 1}/{retries} failed.'
                                 ' Retrying in {delay} seconds: %s', e))

                    if on_failure:
                        on_failure(e, *args, **kwargs)

                    time.sleep(delay)
            if last_exception:
                raise last_exception
        return wrapper
    return decorator


def is_char_hex(string) -> bool:
    pattern = r'^[0-9a-f]+$'  # Match lowercase hexadecimal
    return bool(re.fullmatch(pattern, string))


@cache
def inside_docker_container() -> bool:
    """
    Detects if we are running inside a docker container or on a local host.

    If a test is running in a Docker VM (instead of a Docker container), the hostname
    will be `docker-desktop`.

    This implies that this test is using local network and should be treated
    as *NOT* inside a container.
    """
    if not utils.inside_container():
        return False

    if not is_char_hex(socket.gethostname()):
        return False

    return not os.getenv('DOCKER_HOST')


@cache
def get_container_id() -> str:
    """
    Resolves the container ID of the Python Runtime (if we are inside a Docker container).
    """
    client = docker.from_env()
    container = client.containers.get(socket.gethostname())
    return container.id


@cache
def get_localhost() -> str:
    if not utils.inside_container():
        return DOCKER_DEFAULT_LOCALHOST

    try:
        socket.gethostbyname(DOCKER_DESKTOP_LOCALHOST)
        return DOCKER_DESKTOP_LOCALHOST
    except socket.gaierror:
        pass

    testcontainers_host_override = os.environ.get('TESTCONTAINERS_HOST_OVERRIDE')
    if testcontainers_host_override:
        return testcontainers_host_override

    return DOCKER_DEFAULT_LOCALHOST
