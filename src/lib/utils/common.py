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

import asyncio
from collections import OrderedDict
import copy
import datetime
import enum
import hashlib
import heapq
import json
import math
import os
import random
import re
import threading
import time
from typing import Annotated, Any, Callable, Coroutine, Dict, Generator, Iterable, Iterator, List, NamedTuple, Optional, Set, Tuple
import uuid

import fastapi
import pydantic
import pytz
import requests  # type: ignore
import texttable  # type: ignore

from . import osmo_errors


# If no registry hostname is provided, default to dockerhub
DEFAULT_REGISTRY = 'registry-1.docker.io'

# Docker registry hostnames (either IP or DNS name)
IP_COMPONENT = r'([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])'
IP_REGEX = fr'({IP_COMPONENT}\.){3}{IP_COMPONENT}'
HOST_NAME_COMPONENT = r'[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?'

# Registry hostnames must contain at least one dot (e.g., gcr.io, nvcr.io)
# OR be "localhost" (special case for local development)
# OR be a bare hostname followed by a port (e.g., docker:5000 in Docker-in-Docker)
HOST_NAME_WITH_DOT_REGEX = fr'({HOST_NAME_COMPONENT}\.)+({HOST_NAME_COMPONENT})'
LOCALHOST_REGEX = r'localhost'
# Bare hostname is only valid when followed by :port/ (port presence indicates registry)
HOST_NAME_WITH_PORT_REGEX = fr'{HOST_NAME_COMPONENT}(?=:\d+/)'
HOST_REGEX = fr'(?P<host>({IP_REGEX}|{LOCALHOST_REGEX}|' \
    fr'{HOST_NAME_WITH_DOT_REGEX}|{HOST_NAME_WITH_PORT_REGEX}))'
PORT_REGEX = r'(?P<port>[0-9]{1,5})'

# Regex rules for parsing docker images
NAME_COMPONENT = r'([0-9a-z]([0-9a-z_.-]*[0-9a-z])?)'
NAME_REGEX = fr'(?P<name>{NAME_COMPONENT}(/{NAME_COMPONENT})*)'
TAG_REGEX = r'(?P<tag>[a-zA-Z0-9_][a-zA-Z0-9._-]*)'
DIGEST_REGEX = r'(?P<digest>[A-Za-z0-9_+.-]+:[A-Fa-f0-9]+)'

# Regex rules for datasets
DATASET_NAME_COMPONENT = r'[a-zA-Z0-9_-]+'
DATASET_NAME_REGEX = fr'^{DATASET_NAME_COMPONENT}$'
DATASET_BUCKET_TAG_REGEX = r'^([a-zA-Z0-9_-]*)$'
DATASET_BUCKET_NAME_TAG_REGEX = \
    fr'^((?P<bucket>{DATASET_NAME_COMPONENT})/)' +\
    fr'?(?P<name>{DATASET_NAME_COMPONENT})' +\
    fr'(:(?P<tag>{DATASET_BUCKET_TAG_REGEX[1:-1]}))?$'

# Regex rules for datasets in workflow spec
DATASET_NAME_IN_WORKFLOW_COMPONENT = r'[a-zA-Z0-9_{}-]+'
DATASET_NAME_IN_WORKFLOW_REGEX = fr'^{DATASET_NAME_IN_WORKFLOW_COMPONENT}$'
DATASET_BUCKET_TAG_IN_WORKFLOW_REGEX = r'^([a-zA-Z0-9_{}-]*)$'
DATASET_BUCKET_NAME_TAG_IN_WORKFLOW_REGEX =\
    fr'^((?P<bucket>{DATASET_NAME_IN_WORKFLOW_COMPONENT})/)?' +\
    fr'(?P<name>{DATASET_NAME_IN_WORKFLOW_COMPONENT})' +\
    fr'(:(?P<tag>{DATASET_BUCKET_TAG_IN_WORKFLOW_REGEX[1:-1]}))?$'

# Regex rules for apps
APP_NAME_REGEX = r'(?:[a-zA-Z0-9_-]+)'
APP_VERSION_REGEX = r'(?:[a-zA-Z0-9_-]*)'
APP_VERSION_REGEX = \
    fr'^(?P<name>{APP_NAME_REGEX})' +\
    fr'(:(?P<version>{APP_VERSION_REGEX}))?$'

UUID_REGEX = r'[a-f0-9]{32}'
GROUP_UUID_REGEX = r'osmo-[a-f0-9]{32}'
OLD_UUID_REGEX = r'[a-z2-7]{26}'
UuidPattern = Annotated[str,
                        pydantic.Field(regex=f'^{UUID_REGEX}|{OLD_UUID_REGEX}|{GROUP_UUID_REGEX}$')]

WFID_REGEX = r'[a-zA-Z]([a-zA-Z0-9_-]*[a-zA-Z0-9])?-\d+$'
RESOURCE_REGEX = r'(?P<size>(\d+(?:\.\d+)?))(?P<unit>([a-zA-Z]*))'

# What encoding to accept from docker registry http requests
OCI_IMAGE_INDEX_ENCODING = 'application/vnd.oci.image.index.v1+json'
OCI_IMAGE_MANIFEST_ENCODING = 'application/vnd.oci.image.manifest.v1+json'
DOCKER_MANIFEST_ENCODING = 'application/vnd.docker.distribution.manifest.v2+json'
DOCKER_MANIFEST_LIST_ENCODING = 'application/vnd.docker.distribution.manifest.list.v2+json'

CONFIG_NAME_REGEX = r'^[a-zA-Z]([a-zA-Z0-9_.-]*[a-zA-Z0-9])?$'
TOKEN_NAME_REGEX = r'^[a-zA-Z]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$'

# The keys to look for in the docker auth response
DOCKER_AUTH_TOKEN_KEYS = ['token', 'access_token']

# A dict to convert different measurements to TiB, GiB, MiB, KiB or B.
MEASUREMENTS = {
    'T': 10,
    'Ti': 10,
    'TiB': 10,
    'G': 0,
    'Gi': 0,
    'GiB': 0,
    'M': -10,
    'Mi': -10,
    'MiB': -10,
    'K': -20,
    'Ki': -20,
    'KiB': -20,
    'B': -30,
    'm': -40
}

MEASUREMENTS_SHORT = {
    'Ti', 'Gi', 'Mi', 'Ki', 'B', 'm'
}

# Default chunk size for etags
CHUNK_SIZE = 8 * 1024 * 1024
# Directory to store/load osmo config.yaml
OSMO_CONFIG_OVERRIDE = 'OSMO_CONFIG_FILE_DIR'
# Directory to store/log osmo logs
OSMO_STATE_OVERRIDE = 'OSMO_LOG_FILE_DIR'
TIMEOUT = 60

DATE_TIME_FORMAT = '%Y-%m-%d %H:%M:%S.%f'  # format of datetime.utcnow()

BACKEND_HEARTBEAT_WINDOW = datetime.timedelta(minutes=2)

TOKEN_MAPPING_REGEX = r'\{\{([^}]+)\}\}'

ACCESS_TOKEN_TIMEOUT = 300

WORKFLOW_SPEC_FILE_NAME = 'workflow_spec.yaml'
TEMPLATED_WORKFLOW_SPEC_FILE_NAME = 'templated_workflow_spec.yaml'
WORKFLOW_LOGS_FILE_NAME = 'workflow_logs.txt'
WORKFLOW_EVENTS_FILE_NAME = 'workflow_events.txt'
OLD_WORKFLOW_ERROR_LOGS_FILE_NAME = 'workflow_error_logs.txt'
ERROR_LOGS_SUFFIX_FILE_NAME = '_error_logs.txt'
WORKFLOW_APP_FILE_NAME = 'workflow_app.txt'

JSON_INDENT_SIZE = 4

TAB = '  '


def pydantic_encoder(obj):
    ''' Allows pydantic objects to be used for json.dumps '''
    if isinstance(obj, pydantic.BaseModel):
        return obj.dict()
    elif isinstance(obj, enum.Enum):
        return obj.value
    raise TypeError(f'Object of type {obj.__class__.__name__} is not JSON serializable')


class DatasetStructure:
    """ Splits Dataset Bucket, Name, and Tag. """

    bucket: str = ''
    name: str
    tag: str = ''

    def __init__(self, name: str, workflow_spec: bool = False):
        if workflow_spec:
            parsed_name = re.fullmatch(DATASET_BUCKET_NAME_TAG_IN_WORKFLOW_REGEX, name)

            if not parsed_name:
                raise osmo_errors.OSMOUserError('Name, Tag, and Bucket can only consist of lower '
                                                'and upper case letters, numbers, "-", "_", '
                                                '"{", and "}".')
        else:
            parsed_name = re.fullmatch(DATASET_BUCKET_NAME_TAG_REGEX, name)

            if not parsed_name:
                raise osmo_errors.OSMOUserError('Name, Tag, and Bucket can only consist of lower '
                                                'and upper case letters, numbers, "-" and "_".')

        self.bucket = '' if not parsed_name.group('bucket') else parsed_name.group('bucket')
        self.name = parsed_name.group('name')
        self.tag = '' if not parsed_name.group('tag') else parsed_name.group('tag')

    @property
    def full_name(self) -> str:
        output_name = self.name
        if self.bucket:
            output_name = f'{self.bucket}/{output_name}'
        if self.tag:
            output_name = f'{output_name}:{self.tag}'
        return output_name

    def to_dict(self):
        return {'name': self.name, 'tag': self.tag}


class AppStructure:
    """ Splits App User, Name, and Version. """

    name: str
    version: int | None = None

    def __init__(self, name: str):
        parsed_name = re.fullmatch(APP_VERSION_REGEX, name)

        if not parsed_name:
            raise osmo_errors.OSMOUserError('Name and Version can only consist of lower '
                                            'and upper case letters, numbers, "-" and "_".')

        self.name = parsed_name.group('name')
        self.version = None if not parsed_name.group('version') \
            else int(parsed_name.group('version'))

    @classmethod
    def from_parts(cls, name: str, version: int | None = None) \
            -> 'AppStructure':
        if version is None:
            return cls(name)
        return cls(f'{name}:{version}')

    @property
    def full_name(self) -> str:
        output_name = self.name
        if self.version:
            output_name = f'{output_name}:{self.version}'
        return output_name

    def to_dict(self):
        return {'name': self.name, 'version': self.version}


class LRUCache:
    """
    LRU cache implementation using OrderedDict.
    """

    def __init__(self, capacity: int):
        """
        Initialize the cache with a given capacity.

        :param capacity: The maximum number of items in the cache.
        """
        self.capacity: int = capacity
        self.cache: OrderedDict = OrderedDict()
        self.lock: threading.Lock = threading.Lock()

    def get(self, key: Any) -> Any:
        """
        Get the value associated with the given key.

        :param key: The key to retrieve.
        :return: The value associated with the key, or None if not found.
        """
        with self.lock:
            if key in self.cache:
                value = self.cache[key]
                self.cache.move_to_end(key)
                return value
            return None

    def set(self, key: Any, value: Any):
        """
        Set the value associated with the given key.

        :param key: The key to set.
        :param value: The value to associate with the key.
        """
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
            self.cache[key] = value
            if len(self.cache) > self.capacity:
                self.cache.popitem(last=False)  # Remove oldest item


class TokenBucket:
    """
    A rate-limiting utility that controls access to resources using the Token Bucket algorithm.
    Allows bursts up to a defined capacity and refills tokens at a specified rate over time.
    """

    def __init__(self, capacity: float, refill_rate: float):
        """
        Initialize the TokenBucket with a specified capacity and refill rate.

        Args:
            capacity (float): The maximum number of tokens the bucket can hold.
            refill_rate (float): The rate at which tokens are added to the bucket,
                                 in tokens per second.

        This setup allows the token bucket to control rate-limiting by permitting
        bursts up to the bucket's capacity and refilling tokens at a constant rate
        over time.
        """
        self.capacity = capacity
        self.tokens = capacity
        self.refill_rate = refill_rate
        self.last_refill = time.monotonic()

    def consume(self, tokens: float = 1):
        now = time.monotonic()
        elapsed = now - self.last_refill
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
        self.last_refill = now

        if self.tokens >= tokens:
            self.tokens -= tokens
            return True
        return False

    async def wait_for_tokens(self, tokens: float = 1):
        """
        Asynchronously wait until the bucket has enough tokens to allow an operation.

        Args:
            tokens (float, optional): The number of tokens required to proceed with an operation.
                                      Defaults to 1 token.

        This method will asynchronously wait until the specified number of tokens
        are available in the bucket. If there aren’t enough tokens, it calculates
        the required wait time based on the refill rate, then waits for the necessary
        duration before permitting the operation to continue.
        """
        while True:
            if self.consume(tokens):
                return
            sleep_time = (tokens - self.tokens) / self.refill_rate
            await asyncio.sleep(sleep_time)


class DockerImageInfo(NamedTuple):
    """ Docker image information. """
    name: str
    original: str
    tag: str | None
    digest: str | None
    host: str = DEFAULT_REGISTRY
    port: int = 443

    @property
    def reference(self) -> str:
        return self.digest or self.tag or 'latest'

    @property
    def manifest_url(self) -> str:
        return f'https://{self.host}:{self.port}/v2/{self.name}/manifests/{self.reference}'


def registry_auth(url: str, username: Optional[str] = None,
                  password: Optional[str] | None = None):
    """ Using the instructions here https://docs.docker.com/registry/spec/auth/token/ """

    # Step 1: Attempt to begin a push/pull operation with the registry.
    try:
        response = requests.head(url, timeout=TIMEOUT)

        # Step 2: If the registry requires authorization it will return a 401 Unauthorized HTTP
        # response with information on how to authenticate.
        if response.status_code == 200:
            return response
        if response.status_code != 401:
            raise osmo_errors.OSMOCredentialError(
                f'Registry authorization error for {url}:\n {response}')

        # Step 3: The registry client makes a request to the authorization service
        # for a Bearer token.
        # Use the www-authenticate header in the response to determine how we should authenticate
        auth_header = response.headers['www-authenticate']
        _, claims_str = auth_header.split(' ', 1)
        claim_regex = r'(?P<key>[a-z]+)="(?P<value>[^"]*)",?'
        matches = re.findall(claim_regex, claims_str)
        claims = {match[0]: match[1] for match in matches}
        realm = claims.pop('realm')

        # Step 4: The authorization service returns an opaque Bearer token representing the client’s
        # authorized access.
        auth = None
        if username is not None and password is not None:
            auth = requests.auth.HTTPBasicAuth(username, password)
        auth_response = requests.get(realm, params=claims, auth=auth, timeout=TIMEOUT)
        if auth_response.status_code != 200:
            return auth_response

        token = None
        response_payload = auth_response.json()
        for key in DOCKER_AUTH_TOKEN_KEYS:
            if key in response_payload:
                token = response_payload[key]
                break
        if token is None:
            raise osmo_errors.OSMOCredentialError(
                f'Could not find token in auth response for {url}. '
                f'Expected one of {DOCKER_AUTH_TOKEN_KEYS} but got {list(response_payload.keys())}')

        # Step 5: The client retries the original request with the Bearer token embedded in the
        # request’s Authorization header.
        response = requests.get(url, headers={
                                'Authorization': f'Bearer {token}',
                                'Accept': f'{OCI_IMAGE_INDEX_ENCODING}, '
                                          f'{OCI_IMAGE_MANIFEST_ENCODING}, '
                                          f'{DOCKER_MANIFEST_ENCODING}, '
                                          f'{DOCKER_MANIFEST_LIST_ENCODING}'},
                                timeout=TIMEOUT)
        # Step 6: The Registry authorizes the client by validating the Bearer token and the claim
        # set embedded within it.
        return response
    except requests.exceptions.ConnectionError as err:
        raise osmo_errors.OSMOCredentialError(f'Registry connection error for {url}:\n {err}')


def registry_parse(name: str) -> str:
    """ Parses a registry name """
    if not name or name == 'docker.io':
        return DEFAULT_REGISTRY
    return name


def docker_parse(image: str) -> DockerImageInfo:
    """ Parses a docker image into its separate components """
    # Parse image according to rules here
    # https://docs.docker.com/engine/reference/commandline/tag/

    regex = fr'^({HOST_REGEX}(:{PORT_REGEX})?/)?{NAME_REGEX}(:{TAG_REGEX})?(@{DIGEST_REGEX})?$'
    match = re.fullmatch(regex, image)
    if match is None:
        raise osmo_errors.OSMOUsageError(
            f'Could not parse docker image {image}. Please provide a valid image.')

    host = registry_parse(match.group('host'))
    port = match.group('port') or 443
    tag = match.group('tag')
    digest = match.group('digest')
    if tag is None and digest is None:
        tag = 'latest'
    name = match.group('name')

    # dockerhub with no org is part of the 'library' org
    if match.group('host') is None and '/' not in name:
        name = 'library/' + name

    return DockerImageInfo(host=host, port=int(port), name=name, tag=tag, digest=digest,
                           original=image)


class AllocatableResource(NamedTuple):
    """ Class for storing information about an allocatable resource. """
    # Name of resource (i.e. gpu/mem/cpu/disk)
    name: str
    # Resource request label in workflow spec
    kube_label: str
    # Unit of measurement (defined in MEASUREMENTS)
    # If None, measurement is count based (e.g. cpu, gpu)
    unit: Optional[str] = None

    @property
    def resource_label_with_unit(self) -> str:
        if self.unit:
            return f'{self.name.capitalize()} [{self.unit}]'
        else:
            return f'{(self.name).upper()} [#]'


# List of allocatable resource types
ALLOCATABLE_RESOURCES_LABELS = [
    AllocatableResource(name='storage',
                        kube_label='ephemeral-storage', unit='Gi'),
    AllocatableResource(name='cpu', kube_label='cpu'),
    AllocatableResource(name='memory',
                        kube_label='memory', unit='Gi'),
    AllocatableResource(name='gpu',
                        kube_label='nvidia.com/gpu')
]


class GpuVersionedLabel(NamedTuple):
    """ Class for storing information about labels with versions (e.g. cuda driver). """
    # Name of the Kubernetes label prefix
    kube_label_prefix: str
    # List of all the version levels for this label
    version_levels: List[str]

    def get_all_version_labels(self) -> List[str]:
        return [f'{self.kube_label_prefix}.{version}' for version in self.version_levels]

    def convert_to_version_labels(self, version: str) -> Dict[str, str]:
        """
        Convert a version string to the corresponding Kubernetes labels.
        For example, if the cuda-runtime value is set to 11.8, the returned value is:
        {
            nvidia.com/cuda.runtime.major: 11
            nvidia.com/cuda.runtime.minor: 8
        }
        """
        version_labels: Dict[str, str] = {}
        numeric_ver_arr = version.split('.')
        for version_level, version_value in zip(self.version_levels, numeric_ver_arr):
            version_key = f'{self.kube_label_prefix}.{version_level}'
            version_labels[version_key] = version_value
        return version_labels


# Dictionary of GPU labels with versions, where the key is the label used in the GPU resource
# spec, and the value is a GpuVersionedLabel object that can construct all the Kubernetes
# labels for that version label.
GPU_VERSIONED_LABELS = {
    'cuda-driver':
        GpuVersionedLabel(kube_label_prefix='nvidia.com/cuda.driver',
                          version_levels=['major', 'minor', 'rev'])
}


def merge_lists_on_name(l1: List, l2: List) -> List:
    """ Merge two lists by merging items that share the same value in the name field. """
    # Get the name of each item in list1
    name_to_index = {}
    for i, value in enumerate(l1):
        if 'name' in value:
            name_to_index[value['name']] = i

    unmatched_items = []
    for value in l2:
        # See if we can update an existing item in the first list with this item
        if 'name' in value and value['name'] in name_to_index:
            index = name_to_index[value['name']]
            l1[index] = recursive_dict_update(l1[index], value, merge_lists_on_name)
        # Otherwise, save it for later and we will append it to the end of the list
        else:
            unmatched_items.append(value)

    l1.extend(unmatched_items)
    return l1


def recursive_dict_update(dict1: Dict, dict2: Dict,
                          list_merge_func: Callable[[List, List], List] | None = None) -> Dict:
    """ Given dict1 and dict2, replace values present in dict2 into dict1. If list_merge_func is
    provided, use it to merge lists common in dict1 or dict2. If its not present, then just
    replace lists """
    for key, value in dict2.items():
        # Recurse for dictionaries
        if isinstance(value, dict):
            dict1[key] = recursive_dict_update(dict1.get(key, {}), value, list_merge_func)
        elif list_merge_func and isinstance(value, list):
            if isinstance(dict1.get(key), list):
                dict1[key] = list_merge_func(dict1[key], (value))
            else:
                # Or we can simply throw an error here
                dict1[key] = value
        else:
            dict1[key] = value
    return dict1


def current_time() -> datetime.datetime:
    """ Gets the current UTC timestamp. """
    return datetime.datetime.utcnow()


def convert_str_to_time(datetime_string: str,
                        datetime_format: str = DATE_TIME_FORMAT) -> datetime.datetime:
    """ Gets the current UTC timestamp. """
    return datetime.datetime.strptime(datetime_string, datetime_format)


def _convert_str_to_time(duration: str) -> Tuple[int, str]:
    """ Converts time duration str to a tuple of int and str. """
    if len(duration) >= 3:
        if duration[-2:] == 'ms':
            return int(duration[:-2]), 'ms'

        elif duration[-2:] == 'us':
            return int(duration[:-2]), 'us'

    return int(duration[:-1]), duration[-1]


def to_timedelta(duration: str) -> datetime.timedelta:
    """ Converts time duration str to datetime.timedelta instance. """
    error_message = f'Cannot recognize duration: {duration}. Only support xd, xh, xm, xs, xms, xus'
    try:
        value, unit = _convert_str_to_time(duration)
    except ValueError as error:
        raise ValueError(error_message) from error

    if unit == 'd':
        return datetime.timedelta(days=value)
    elif unit == 'h':
        return datetime.timedelta(hours=value)
    elif unit == 'm':
        return datetime.timedelta(minutes=value)
    elif unit == 's':
        return datetime.timedelta(seconds=value)
    elif unit == 'ms':
        return datetime.timedelta(milliseconds=value)
    elif unit == 'us':
        return datetime.timedelta(microseconds=value)
    else:
        raise ValueError(error_message)


def timedelta_to_str(duration: datetime.timedelta) -> str:
    """ Converts time duration datetime.timedelta to str. """
    total_seconds = duration.total_seconds()
    return f'{int(total_seconds)}s'


def convert_resource_value_str(resource_val: str, target: str = 'GiB') -> float:
    """
    Converts a given resource value string to an integer using GiB as measurement.
    if the argument in_bytes is True, then return measurement in bytes

    Args:
        resource_val: The given resource_val string (for memory, disk)
        target: Indicates what size type to convert to

    Returns:
        The converted integer.

    Raises:
        utils.OSMOSchemaError: The given measurement of is not supported.
    """
    resource_val = str(resource_val)
    pattern = RESOURCE_REGEX
    match = re.fullmatch(pattern, resource_val)
    if not match:
        raise ValueError(
            f'Failure in converting resource value {resource_val}'
        )
    num = match.group('size')
    unit = match.group('unit')

    if not unit:
        unit = 'B'
    if unit not in MEASUREMENTS:
        raise osmo_errors.OSMOSchemaError(f'Can not recognize {resource_val}.')
    if target not in MEASUREMENTS:
        raise osmo_errors.OSMOSchemaError(f'Can not recognize {target}.')
    raise_power = MEASUREMENTS[unit] - MEASUREMENTS[target]
    return float(num) * 2 ** raise_power


def collect_file_sizes(files: List[str]) -> Tuple[Dict[str, int], int]:
    """
    Generates size of each file and returns total size of all files
    and size of each file

    Args:
        files List[str]: A list of paths of files of which we want information of

    Returns:
        file_sizes (Dict[str, int]): Key is filepath and value is file size
        total_size: Total size of all files in bytes
    """
    file_sizes = {}
    total_size = 0
    for filepath in files:
        file_size = os.stat(filepath).st_size
        file_sizes[filepath] = file_size
        total_size += file_size
    return file_sizes, total_size


def collect_fs_objects(local_path: str, regex: str = '') -> List[str]:
    """
    Collect input objects passed as inputs
    - can be single or multiple objects
    - can be a "directory"
    """
    objs = []
    if os.path.isfile(local_path):
        objs.append(local_path)
    elif os.path.isdir(local_path):
        regex_check = re.compile(regex)
        for (root, _, files) in os.walk(local_path):
            for file in files:
                file_abs_path = os.path.join(root, file)
                if regex_check.match(os.path.relpath(os.path.join(root, file), local_path)):
                    objs.append(file_abs_path)
    return objs


def etag_checksum(filename, chunk_size=CHUNK_SIZE):
    """
    Calculate S3 Checksum (Double md5) Checksum of file
    Args:
        bytes: byte value to convert

    Return:
        string format for bytes
    """
    md5s = []

    with open(filename, 'rb') as fp:
        while True:
            data = fp.read(chunk_size)
            if not data:
                break
            md5s.append(hashlib.md5(data))

    if len(md5s) < 1:
        return f'{hashlib.md5().hexdigest()}'

    if len(md5s) == 1:
        return f'{md5s[0].hexdigest()}'

    digests = b''.join(m.digest() for m in md5s)
    digests_md5 = hashlib.md5(digests)
    return f'{digests_md5.hexdigest()}-{len(md5s)}'


def osmo_table(header: List[str], fit_width=False) -> texttable.Texttable:
    """
    returns texttable object with common format for all CLI's

    Args:
        header: for the table header and column

    Returns:
        texttable: Return a textable object with common formatting
    """
    table = texttable.Texttable(max_width=0)
    table.set_deco(texttable.Texttable.HEADER)
    table.set_chars(['', '', '', '='])
    table.header(header)
    table.set_header_align(['l' for _ in header])
    if fit_width:
        try:
            table.set_max_width(os.get_terminal_size().columns)
        except OSError:
            print('Error getting terminal width to set max width.')
            pass
    return table


def create_table_with_sum_row(table: texttable.Texttable, total_row: List[str]) -> str:
    """
    Function to create a table string that uses the input table, adds a border on the
    bottom, adds a summation row at the end, and returns the modified table in string
    form. Users can directly call print on the output of this function without calling
    the .draw() function.
    """
    # Add row which shows total cluster usage and capacity
    table.add_row(total_row)

    # Add table border delimiter above the total usage/capacity row
    lines = table.draw().split('\n')
    end_delimiter = '=' * len(lines[0])
    lines.insert(-1, end_delimiter)

    # Reconstruct the table
    return '\n'.join(lines)


def verify_dict_keys(data: Dict):
    """
    Recursively verifies that the keys are valid

    Args:
        data: dictionary of values
    """
    regex = r'^[a-zA-Z0-9_-]+$'
    for key in data.keys():
        if isinstance(data[key], dict):
            verify_dict_keys(data[key])
        else:
            if not re.fullmatch(regex, key):
                raise osmo_errors.OSMOUserError('Keys can only consist of lower and upper ' +
                                                f'case letters, numbers, "-" and "_": {key}')


class PrettyJSONResponse(fastapi.Response):
    media_type = 'application/json'

    def render(self, content: Any) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            indent=4,
        ).encode('utf-8')


def strategic_merge_patch(original: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    """
    Applies a Strategic Merge Patch to Dynamic Configs.

    :param original: The original dictionary to be patched.
    :param patch: The patch dictionary to apply to the original.
    :return: The updated dictionary after applying the patch.
    """
    if isinstance(patch, dict) and not isinstance(original, dict):
        return patch

    # Create a deep copy of the original dictionary to avoid modifying the original.
    updated = copy.deepcopy(original)

    for key, value in patch.items():
        if key not in updated:
            updated[key] = value
        elif isinstance(value, dict):
            if value.get('$action', '') == 'delete':
                # Delete the key if the value has a 'delete' action.
                updated.pop(key, None)
            else:
                updated[key] = strategic_merge_patch(updated[key], value)
        elif isinstance(value, list):
            # Handle the case where the value is a list of dictionaries.
            if all(isinstance(item, dict) for item in value):
                updated_list = []
                for i, item in enumerate(updated[key]):
                    for patch_item in value:
                        if i == patch_item.get('$index'):
                            # Apply merge or replace to the matched item.
                            if patch_item.get('$action', '') == 'replace':
                                item = patch_item
                            elif patch_item.get('$action', '') == 'delete':
                                item = None
                            else:
                                item = strategic_merge_patch(item, patch_item)
                            break
                    if item:
                        updated_list.append(item)
                # Add any items in the patch list that were not matched.
                for patch_item in value:
                    if not any(i == patch_item.get('$index') for i in range(len(updated[key]))) \
                            and not patch_item.get('$action', '') == 'delete':
                        updated_list.append(patch_item)
                for item in updated_list:
                    item.pop('$action', None)
                    item.pop('$index', None)

                updated[key] = updated_list
            else:
                # Apply the list value as a replacement.
                updated[key] = value
        else:
            # Apply the scalar value as a replacement.
            updated[key] = value

        updated.pop('$action', None)
        updated.pop('$index', None)
    return updated


def merge_dictionaries(a: Dict, b: Dict):
    """
    Merges b dictionary into a together. b overrides a
    """
    for key in b:
        if key in a:
            if isinstance(a[key], dict) and isinstance(b[key], dict):
                merge_dictionaries(a[key], b[key])
        else:
            a[key] = b[key]
    return a


def generate_unique_id(num_digits: Optional[int] = None) -> UuidPattern:
    """
    Generate a unique id.

    Args:
        num_digits(int): Number of digits in the ID.
    """
    unique_id = uuid.uuid4().hex
    if num_digits:
        return unique_id[:num_digits]
    return unique_id


def convert_cpu_unit(cpu_req: str) -> float:
    """ Convert Kubernetes CPU value from string to float. """
    value = None
    miliunit = False
    # Handle unit for m and M
    if cpu_req.lower().endswith('m'):
        value = cpu_req.rstrip('mM')
        miliunit = True
    else:
        value = cpu_req
    try:
        num_value = float(value)
        if miliunit:
            num_value = num_value / 1000.0
        return num_value
    except ValueError:
        print(f'{cpu_req} is not a valid value for CPU.')
        return 0.0


def construct_workflow_id(workflow_name: str, job_id: int) -> str:
    return f'{workflow_name}-{job_id}'


def deconstruct_workflow_id(workflow_id: str) -> Tuple[str, int]:
    workflow_info = workflow_id.rsplit('-', 1)
    return workflow_info[0], int(workflow_info[1])


def heartbeat_online(t: datetime.datetime) -> bool:
    return current_time() - t <= BACKEND_HEARTBEAT_WINDOW


def mask_string(base: str, elements: Set[str]) -> str:
    for element in elements:
        base = base.replace(element, '[MASKED]')
    return base


def readable_timedelta(td: datetime.timedelta) -> str:
    """
    Turn a timedelta into a human-readable timedelta string.
    """
    days = td.days
    hours, remainder = divmod(td.seconds, 3600)
    minutes, seconds = divmod(remainder, 60)

    readable_parts = []
    if days:
        readable_parts.append(f'{days} days')
    if hours:
        readable_parts.append(f'{hours} hours')
    if minutes:
        readable_parts.append(f'{minutes} minutes')
    if seconds:
        readable_parts.append(f'{seconds} seconds')

    # Join the parts with commas
    return ', '.join(readable_parts) if readable_parts else '0 seconds'


def relative_path(full_path: str, sub_path: str) -> str:
    '''
    Function returns the relative path from sub_path to full_path.
    If the paths point to the same object, return that object
    '''
    filtered_path = sub_path.rsplit('/', 1)[0]
    if full_path == filtered_path:
        return full_path
    rel_path = os.path.relpath(full_path, filtered_path)
    return rel_path


class IterableMerger:
    ''' Takes in a bunch of Iterables and returns the next smallest element '''

    def __init__(self, iterables: Iterable[Iterator[Any]]):
        self.iterables = list(iterables)
        self.iterators = [(iter(it), idx) for idx, it in enumerate(self.iterables)]
        self.heap: List = []
        for iterator, idx in self.iterators:
            try:
                # Fetch the first element from each iterator and push it onto the heap
                next_item = next(iterator)
                heapq.heappush(self.heap, (next_item, idx))
            except StopIteration:
                # If an iterator is empty, ignore it
                continue

    def __iter__(self):
        return self

    def __next__(self):
        if not self.heap:
            raise StopIteration

        # Pop the smallest item from the heap
        smallest, idx = heapq.heappop(self.heap)

        # Fetch the next item from the iterator that produced the smallest item
        iterator, _ = self.iterators[idx]
        try:
            next_item = next(iterator)
            # Push the new item onto the heap
            heapq.heappush(self.heap, (next_item, idx))
        except StopIteration:
            pass

        # Keep the first smallest seen
        while self.heap and smallest == self.heap[0][0]:
            # Pop the smallest item from the heap
            _, dupe_idx = heapq.heappop(self.heap)

            # Fetch the next item from the iterator that produced the smallest item
            iterator, _ = self.iterators[dupe_idx]
            try:
                next_item = next(iterator)
                # Push the new item onto the heap
                heapq.heappush(self.heap, (next_item, dupe_idx))
            except StopIteration:
                pass

        return smallest


def list_directory_sorted(path: str) -> Generator[str, None, None]:
    """ Lists all files in directory recursively """
    for item in sorted(os.listdir(path)):
        item_path = os.path.join(path, item)
        if os.path.isdir(item_path):
            for item_path in list_directory_sorted(item_path):
                yield item_path
        else:
            yield item_path


def handle_memoryview(item: Any) -> Any:
    """ Handle memoryview objects by casting to bytes. """
    if isinstance(item, memoryview):
        return bytes(item)
    return item


async def first_completed(coroutines: List[Coroutine], **kwargs):
    """
    Run all awaitables in parallel and return the first one that completes.
    """
    done, pending = await asyncio.wait(coroutines, return_when=asyncio.FIRST_COMPLETED, **kwargs)
    for task in pending:
        try:
            task.cancel()
        except Exception:  # pylint: disable=broad-except
            pass
    return next(iter(done)).result()


async def gather_cancel(*aws, **kwargs):
    # Wrap all non-task awaitables in a task
    tasks = []
    for awaitable in aws:
        if isinstance(awaitable, asyncio.Task):
            tasks.append(awaitable)
        else:
            tasks.append(asyncio.create_task(awaitable))

    # Run gather
    try:
        await asyncio.gather(*tasks, **kwargs)
    # Make sure everything is cancelled at the end
    finally:
        for awaitable_task in tasks:
            if not awaitable_task.done():
                awaitable_task.cancel()


def load_contents_from_file(path: str) -> str:
    with open(path, 'r', encoding='utf-8') as file:
        content = file.read()
    return content


def convert_fields(key: str, fields: Dict):
    if key in ['cpu', 'gpu']:
        allocatable = float(fields.get(key, 0))
    else:  # Memory or storage, which has units and requires conversion
        allocatable = convert_resource_value_str(fields[key])
    return allocatable


def convert_allocatable_request_fields(
        key: str, resource: Dict, pool_name: str, platform_name: str):
    """ Return the allocatable value and total request after rounding and unit conversions. """
    allocatable_fields = resource['allocatable_fields']
    try:
        allocatable_fields = resource['platform_allocatable_fields'][pool_name][platform_name]
    except KeyError:
        pass
    resource_fields = resource['usage_fields']
    allocatable = convert_fields(key, allocatable_fields)
    total_request = convert_fields(key, resource_fields)
    return allocatable, total_request


def convert_available_fields(key: str, resource: Dict, pool_name: str, platform_name: str):
    """ Return the available value after rounding and unit conversions. """
    available_fields = resource['allocatable_fields']
    try:
        available_fields = resource['platform_available_fields'][pool_name][platform_name]
    except KeyError:
        pass
    return convert_fields(key, available_fields)


def get_redis_task_log_name(workflow_id: str, task_name: str, retry_id: int) -> str:
    return f'{workflow_id}-{task_name}-{retry_id}-logs'


def get_task_log_file_name(task_name: str, retry_id: int) -> str:
    return f'task_logs_{task_name}_{retry_id}.txt'


def get_workflow_events_redis_name(workflow_uuid: str) -> str:
    """
    Get the Redis stream name for workflow events.

    Args:
        workflow_uuid (str): The UUID of the workflow.

    """
    assert len(workflow_uuid) == 32 and all(c in '0123456789abcdef' for c in workflow_uuid), \
        'Input must be workflow UUID (32 hex characters)'
    return f'{workflow_uuid}-pod-conditions'


def get_group_subdomain_name(group_uuid: str) -> str:
    """
    Get the subdomain name for a group to create the FQDN for a task pod.
    """
    return f'osmo-{group_uuid}'


def valid_date_format(date_str: str, date_format: str) -> bool:
    """
    Validate the date given the format.
    """
    try:
        datetime.datetime.strptime(date_str, date_format)
        return True
    except ValueError:
        return False


def convert_utc_datetime_to_user_zone(utc_time: str) -> str:
    """
    Converts datetime string to "%b %d, %Y %H:%M TIMEZONE"
    """
    formats = ['%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M']
    utc_datetime: datetime.datetime | None = None
    for fmt in formats:
        try:
            # Try to convert string to datetime object
            utc_datetime = datetime.datetime.strptime(utc_time.replace('T', ' '), fmt)
            break
        except ValueError:
            pass
    if not utc_datetime:
        raise osmo_errors.OSMOError(f'Invalid time format: {utc_time}')
    user_timezone = datetime.datetime.now(datetime.timezone.utc).astimezone().tzinfo
    user_datetime = utc_datetime.replace(tzinfo=pytz.UTC).astimezone(user_timezone)
    return f'{user_datetime.strftime("%b %d, %Y %H:%M %Z")}'


def convert_timezone(date_value: str) -> str:
    '''
    Takes in a date string with format YYYY-MM-DDTHH:MM:SS, converts that date from
    the user's timezone to UTC, and returns a date string with the format
    YYYY-MM-DDTHH:MM:SS.
    '''
    datetime_obj = datetime.datetime.strptime(date_value, '%Y-%m-%dT%H:%M:%S')
    user_timezone = datetime.datetime.now(datetime.timezone.utc).astimezone().tzinfo
    converted_dt = datetime_obj.replace(tzinfo=user_timezone).astimezone(pytz.UTC)
    return converted_dt.strftime('%Y-%m-%dT%H:%M:%S')


def prompt_user(prompt: str) -> bool:
    """
    Helper function for prompting user confirmation
    Args:
        prompt: the question to prompt the user

    Return:
        whether the user confirms or denies action
    """
    while True:
        print(prompt)
        value = input('[y/n]: ').strip().lower()
        if value in {'yes', 'y'}:
            return True
        elif value in {'no', 'n'}:
            return False
        else:
            print('Invalid input')


def get_exponential_backoff_delay(retry: int) -> float:
    """
    Get the delay for an exponential backoff with a random jitter.

    Args:
        retry (int): The number of retries.

    Returns:
        float: The delay in seconds.
    """
    random_delay = random.random() * 5
    exp_delay = 2 ** min(retry, 5)
    return random_delay + exp_delay


def storage_convert(b: int) -> str:
    """
    Helper function for converting bytes into string format
    Args:
        b: byte value to convert

    Return:
        string format for bytes
    """
    if b < 0:
        raise ValueError('Byte value cannot be negative')
    if b == 0:
        return '0 B'

    # Calculate size
    sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    if b > 1023:
        exponent = min(math.floor(math.log(b, 1024)), len(sizes) - 1)
        size = f'{b / math.pow(1024, exponent):.1f} {sizes[exponent]}'
    else:
        size = f'{b} B'
    return size
