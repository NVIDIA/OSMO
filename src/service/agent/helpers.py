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
import datetime
import json
import logging
import time
from typing import Dict
from urllib.parse import urlparse

import fastapi
import kombu  # type: ignore
import pydantic
import redis.asyncio  # type: ignore

from src.lib.utils import common
from src.lib.utils import logging as utils_logging
from src.lib.utils import osmo_errors
from src.service.agent import objects as backend_objects
from src.service.core.config import helpers as config_helpers
from src.service.core.workflow import helpers, objects  # pylint: disable=unused-import
from src.utils import connectors, backend_messages
from src.utils.job import backend_jobs, jobs, task, workflow
from src.utils.metrics import metrics


# Default value to use in the pod_template field for new backends
DEFAULT_POD_TEMPLATE = '{}'


def get_task_info(postgres: connectors.PostgresConnector, workflow_uuid: str, task_uuid: str,
                  retry_id: int) -> Dict:
    fetch_cmd = '''
        SELECT tasks.*, w.submitted_by FROM tasks
        INNER JOIN
            (SELECT workflow_id, submitted_by FROM workflows where workflow_uuid = %s) w
        ON tasks.workflow_id = w.workflow_id
        WHERE tasks.task_uuid = %s AND tasks.retry_id = %s;
    '''
    task_rows = postgres.execute_fetch_command(fetch_cmd, (workflow_uuid, task_uuid, retry_id),
                                               True)
    if not task_rows:
        raise osmo_errors.OSMODatabaseError(
            f'No tasks were found for task uuid {task_uuid} of workflow '\
            f'{workflow_uuid}.')
    return task_rows[0]


def create_backend(postgres: connectors.PostgresConnector,
                   name: str,
                   message: backend_messages.InitBody):
    # Initialize router_address with hostname from config if available
    router_address = ''
    if hasattr(postgres.config, 'host') and postgres.config.host:
        parsed_url = urlparse(postgres.config.host)
        if parsed_url.hostname:
            router_address = f'wss://{parsed_url.hostname}'
            logging.info('Initializing router_address for backend %s to: %s',
                        name, router_address)

    insert_cmd = '''
        WITH input_rows(name, k8s_uid, k8s_namespace, dashboard_url, grafana_url,
            scheduler_settings,
            last_heartbeat, created_date,
            description, router_address,
            version) AS (
            VALUES
                (text %s, text %s, text %s, text %s, text %s, text %s,
                 timestamp %s,
                 timestamp %s, text %s,
                 text %s, text %s)
            )
        , new_row AS (
            INSERT INTO backends (name, k8s_uid, k8s_namespace,
                dashboard_url, grafana_url,
                scheduler_settings,
                last_heartbeat, created_date, description, router_address,
                version)
            SELECT * FROM input_rows
            ON CONFLICT (name) DO NOTHING
            RETURNING name, k8s_uid, true as is_new
            )
        SELECT k8s_uid, COALESCE(is_new, false) as is_new FROM new_row
        UNION ALL
        SELECT b.k8s_uid, false as is_new FROM input_rows
        JOIN backends b USING (name)
        WHERE NOT EXISTS (SELECT 1 FROM new_row);
    '''
    k8s_info = postgres.execute_fetch_command(
        insert_cmd,
        (name, message.k8s_uid, message.k8s_namespace, '',
         '',
         connectors.BackendSchedulerSettings().json(),
         common.current_time(), common.current_time(), '', router_address,
         message.version))
    if k8s_info[0].k8s_uid != message.k8s_uid:
        raise osmo_errors.OSMOBackendError(f'Backend {name} is already being used by a '
                                           'different cluster')

    # Update node_conditions column to set the prefix while preserving existing values
    update_cmd = '''
        WITH old_values AS (
            SELECT k8s_namespace as old_k8s_namespace,
                   version as old_version,
                   COALESCE(node_conditions->>'prefix', '') as old_prefix
            FROM backends WHERE name = %s
        )
        UPDATE backends SET k8s_namespace = %s, version = %s,
        node_conditions = jsonb_set(
            COALESCE(node_conditions,
                     '{"additional_node_conditions": [], "ignore_node_conditions": []}'::jsonb
                     ),
            '{prefix}',
            to_jsonb(%s::text)
        )
        WHERE name = %s
        RETURNING
            (
                (SELECT old_k8s_namespace FROM old_values) IS DISTINCT FROM %s OR
                (SELECT old_version FROM old_values) IS DISTINCT FROM %s OR
                (SELECT old_prefix FROM old_values) IS DISTINCT FROM %s
            ) as did_update;
    '''
    update_result = postgres.execute_fetch_command(update_cmd,
                                                   (name,
                                                    message.k8s_namespace,
                                                    message.version, message.node_condition_prefix,
                                                    name,
                                                    message.k8s_namespace,
                                                    message.version, message.node_condition_prefix))

    # Only create a single history entry for the backend creation or update
    if k8s_info[0].is_new:
        config_helpers.create_backend_config_history_entry(
            postgres, name, 'system', f'Create backend {name}', [])
    elif update_result[0].did_update:
        config_helpers.create_backend_config_history_entry(
            postgres,
            name,
            'system',
            f'Update backend {name}: k8s_namespace, version, or node_conditions prefix changed',
            []
        )

def queue_update_group_job(postgres: connectors.PostgresConnector,
                           message: backend_messages.UpdatePodBody):
    task_info = get_task_info(postgres, message.workflow_uuid, message.task_uuid,
                              message.retry_id)
    if message.node and not task_info['node_name']:
        cmd = 'UPDATE tasks SET node_name = %s WHERE task_db_key = %s;'
        postgres.execute_commit_command(cmd, (message.node, task_info['task_db_key']))
    if message.pod_ip and not task_info['pod_ip']:
        cmd = 'UPDATE tasks SET pod_ip = %s WHERE task_db_key = %s;'
        postgres.execute_commit_command(cmd, (message.pod_ip, task_info['task_db_key']))

    if message.exit_code == task.ExitCode.FAILED_PREFLIGHT.value:
        labels = {
            'osmo.verified': 'False',
            'osmo.reason': 'PreflightTestFailed',
            'osmo.reserved': 'preflight',
            'osmo.last-labeled': datetime.datetime.now().strftime('%Y-%m-%d'),
        }
        label_task = backend_jobs.LabelNode(
            backend=message.backend,
            workflow_uuid=message.workflow_uuid,
            labels=labels,
            node_name=task_info['node_name'])
        label_task.send_job_to_queue()

    update_task = jobs.UpdateGroup(
        workflow_id=task_info['workflow_id'],
        workflow_uuid=message.workflow_uuid,
        group_name=task_info['group_name'],
        task_name=task_info['name'],
        retry_id=message.retry_id,
        lead_task=task_info['lead'],
        status=message.status, message=message.message,
        user=task_info['submitted_by'],
        exit_code=message.exit_code)
    update_task.send_job_to_queue()


def update_resource(postgres: connectors.PostgresConnector,
                    backend: str, message: backend_messages.ResourceBody):

    commit_cmd = '''
        INSERT INTO resources
        (name, backend, available, allocatable_fields, label_fields, usage_fields,
         non_workflow_usage_fields, taints, conditions)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb[], %s::text[])
        ON CONFLICT (name, backend) DO UPDATE SET
        available = %s,
        allocatable_fields = %s,
        label_fields = %s,
        taints = %s::jsonb[],
        conditions = %s::text[]
    '''

    resource = {
        'available': message.available,
        'allocatable_fields': postgres.encode_hstore(message.allocatable_fields),
        'label_fields': postgres.encode_hstore(message.label_fields),
        'usage_fields': postgres.encode_hstore({'cpu': '0', 'ephemeral-storage': '0',
                                                'memory': '0', 'nvidia.com/gpu': '0'}),
        'non_workflow_usage_fields': postgres.encode_hstore({'cpu': '0', 'ephemeral-storage': '0',
                                                       'memory': '0', 'nvidia.com/gpu': '0'}),
        'taints': [json.dumps(taint) for taint in message.taints],
        'conditions': message.conditions,
    }

    columns = (
        message.hostname,
        backend,
        resource['available'],
        resource['allocatable_fields'],
        resource['label_fields'],
        resource['usage_fields'],
        resource['non_workflow_usage_fields'],
        resource['taints'],
        resource['conditions'],
        resource['available'],
        resource['allocatable_fields'],
        resource['label_fields'],
        resource['taints'],
        resource['conditions']
    )

    postgres.execute_commit_command(commit_cmd, columns)
    pool_config = connectors.fetch_verbose_pool_config(postgres, backend)
    resource_entry = workflow.ResourcesEntry(hostname=message.hostname,
                                             label_fields=message.label_fields,
                                             backend=backend, taints=message.taints,
                                             # Dummy placeholder values below
                                             exposed_fields={},
                                             usage_fields={},
                                             non_workflow_usage_fields={},
                                             allocatable_fields={},
                                             pool_platform_labels={},
                                             resource_type=connectors.BackendResourceType.SHARED,
                                             conditions=message.conditions)
    config_helpers.update_node_pool_platform(resource_entry, backend, pool_config)


def update_resource_usage(postgres: connectors.PostgresConnector,
                          backend: str, message: backend_messages.ResourceUsageBody):
    commit_cmd = '''
        INSERT INTO resources
        (name, backend, usage_fields, non_workflow_usage_fields)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (name, backend) DO UPDATE SET
        usage_fields = %s,
        non_workflow_usage_fields = %s
    '''

    columns = (
        message.hostname,
        backend,
        postgres.encode_hstore(message.usage_fields),
        postgres.encode_hstore(message.non_workflow_usage_fields),
        postgres.encode_hstore(message.usage_fields),
        postgres.encode_hstore(message.non_workflow_usage_fields)
    )

    postgres.execute_commit_command(commit_cmd, columns)


def delete_resource(postgres: connectors.PostgresConnector, backend: str,
                    message: backend_messages.DeleteResourceBody):
    commit_cmd = 'DELETE FROM resources WHERE name = %s and backend = %s'
    postgres.execute_commit_command(commit_cmd, (message.resource, backend))

    # Mark tasks on that node to be FAILED
    fetch_cmd = '''
        SELECT tasks.*, workflows.workflow_uuid, workflows.submitted_by FROM tasks
        INNER JOIN workflows ON tasks.workflow_id = workflows.workflow_id
        WHERE workflows.backend = %s
        AND node_name = %s
        AND tasks.status in %s
        '''
    tasks = postgres.execute_fetch_command(fetch_cmd,
                                           (backend, message.resource,
                                            tuple(task.TaskGroupStatus.backend_states())),
                                           True)
    for task_info in tasks:
        update_job = jobs.UpdateGroup(workflow_id=task_info['workflow_id'],
                                      workflow_uuid=task_info['workflow_uuid'],
                                      group_name=task_info['group_name'],
                                      task_name=task_info['name'],
                                      retry_id=task_info['retry_id'],
                                      status=task.TaskGroupStatus.FAILED_BACKEND_ERROR,
                                      message='Node got removed from the cluster while the ' +\
                                              'pod was on it',
                                      user=task_info['submitted_by'],
                                      exit_code=task.ExitCode.FAILED_BACKEND_ERROR.value,
                                      lead_task=task_info['lead'])
        update_job.send_job_to_queue()


def clean_resources(postgres: connectors.PostgresConnector, backend: str,
                    message: backend_messages.NodeBody):

    # Track all resources from resources table
    cmd = 'SELECT name FROM resources where backend = %s'
    resources_table = postgres.execute_fetch_command(cmd, (backend,), True)
    db_node_names = set(resource['name'] for resource in resources_table)

    # Find nodes that exist in the database but not in the message
    stale_nodes = db_node_names - set(message.node_hashes)
    if stale_nodes:
        commit_cmd = 'DELETE FROM resources WHERE name IN %s and backend = %s'
        postgres.execute_commit_command(commit_cmd, (tuple(stale_nodes), backend))


def clean_tasks(postgres: connectors.PostgresConnector, backend: str,
                message: backend_messages.TaskListBody):

    # Track all tasks in the backend which are supposed to be in the backend but are not
    cmd = '''
        SELECT tasks.*, workflows.workflow_uuid, workflows.submitted_by FROM tasks
        INNER JOIN workflows ON tasks.workflow_id = workflows.workflow_id
        INNER JOIN groups
        ON (tasks.workflow_id = groups.workflow_id and tasks.group_name = groups.name)
        WHERE workflows.backend = %s
        AND groups.status in %s
        '''
    cmd_input = [backend, tuple(task.TaskGroupStatus.backend_states())]
    if message.task_list:
        cmd += ' AND tasks.task_uuid not in %s'
        cmd_input.append(tuple(message.task_list))
    tasks = postgres.execute_fetch_command(cmd, tuple(cmd_input), True)
    for task_info in tasks:
        update_job = jobs.UpdateGroup(workflow_id=task_info['workflow_id'],
                                      workflow_uuid=task_info['workflow_uuid'],
                                      group_name=task_info['group_name'],
                                      task_name=task_info['name'],
                                      retry_id=task_info['retry_id'],
                                      status=task.TaskGroupStatus.FAILED_BACKEND_ERROR,
                                      message='Pod was deleted while backend agents were down',
                                      user=task_info['submitted_by'],
                                      exit_code=task.ExitCode.FAILED_BACKEND_ERROR.value,
                                      lead_task=task_info['lead'])
        update_job.send_job_to_queue()


def send_metrics(message: backend_messages.MetricsBody, backend: str):
    backend_metrics = metrics.MetricCreator.get_meter_instance()
    if message.type == backend_messages.MetricsType.COUNTER:
        backend_metrics.send_counter(
            name=message.name, value=message.value, unit=message.unit,
            description=message.description,
            tags={'backend': backend}
        )
    elif message.type == backend_messages.MetricsType.HISTOGRAM:
        backend_metrics.send_histogram(
            name=message.name, value=message.value, unit=message.unit,
            description=message.description,
            tags={'backend': backend}
        )


def log(name: str, backend: str, config: utils_logging.LoggingConfig,
        message: backend_messages.LoggingBody):
    utils_logging.get_backend_logger(name, backend, config).log(
        message.type.value, message.text, extra={'workflow_uuid': message.workflow_uuid})


def create_monitor_job(postgres: connectors.PostgresConnector,
                       message: backend_messages.MonitorPodBody):
    task_info = get_task_info(postgres, message.workflow_uuid, message.task_uuid,
                              message.retry_id)

    update_job = jobs.UpdateGroup(workflow_id=task_info['workflow_id'],
                                  workflow_uuid=message.workflow_uuid,
                                  group_name=task_info['group_name'],
                                  task_name=task_info['name'],
                                  retry_id=task_info['retry_id'],
                                  status=task.TaskGroupStatus.FAILED_START_TIMEOUT,
                                  message=message.message,
                                  exit_code=task.ExitCode.FAILED_START_TIMEOUT.value,
                                  user=task_info['submitted_by'],
                                  lead_task=task_info['lead'])
    service_config = postgres.get_service_configs()
    update_job.send_delayed_job_to_queue(common.to_timedelta(service_config.max_pod_restart_limit))


def keep_pod_conditions(message: backend_messages.ConditionMessage) -> bool:
    """
    Check the contents to determine if the condition can be filtered out.
    """
    if message.type == 'ContainersReady':
        return False
    if message.type in ['Initialized', 'Ready'] and message.status is False:
        return False
    return True


def send_pod_conditions(postgres: connectors.PostgresConnector,
                        message: backend_messages.PodConditionsBody,
                        max_event_log_lines: int):
    fetch_cmd = '''
        SELECT name FROM tasks
        WHERE task_uuid = %s AND retry_id = %s
    '''
    task_rows = postgres.execute_fetch_command(
        fetch_cmd, (message.task_uuid, message.retry_id), True)
    if not task_rows:
        raise osmo_errors.OSMODatabaseError(
            f'No tasks were found for task uuid {message.task_uuid} of workflow '\
            f'{message.workflow_uuid}.')
    task_name = task_rows[0]['name']

    redis_connector = connectors.RedisConnector.get_instance()
    redis_client = redis_connector.client

    # Key to track latest condition timestamp for this workflow
    timestamp_key = f'pod_conditions:{message.workflow_uuid}:{task_name}:latest_timestamp'

    for condition in message.conditions:
        if not keep_pod_conditions(condition):
            continue
        # Get the latest logged timestamp for this workflow
        latest_timestamp = redis_client.get(timestamp_key)
        latest_timestamp = float(latest_timestamp) if latest_timestamp else 0

        # Only process if condition is newer
        if condition.timestamp.timestamp() > latest_timestamp:
            retry_suffix = f' retry-{message.retry_id}' if message.retry_id > 0 else ''
            condition_log = f'{condition.timestamp} [{task_name}{retry_suffix}] '\
                           f'{condition.type}: {condition.status}'
            if condition.reason and condition.message:
                condition_log += f', Reason: {condition.reason}, Message: {condition.message}'

            log_body = connectors.redis.LogStreamBody(
                time=condition.timestamp,
                io_type=connectors.redis.IOType.DUMP,
                source='OSMO',
                retry_id=message.retry_id,
                text=condition_log)

            redis_client.xadd(common.get_workflow_events_redis_name(message.workflow_uuid),
                              json.loads(log_body.json()),
                              maxlen=max_event_log_lines)

            # Update the latest timestamp
            redis_client.set(timestamp_key, condition.timestamp.timestamp())
            redis_client.expire(timestamp_key, connectors.MAX_LOG_TTL, nx=True)
            redis_client.expire(
                common.get_workflow_events_redis_name(message.workflow_uuid),
                connectors.MAX_LOG_TTL, nx=True)


def send_pod_event(postgres: connectors.PostgresConnector,
                   message: backend_messages.PodEventBody,
                   max_event_log_lines: int):
    fetch_cmd = '''
        SELECT tasks.name, workflows.workflow_uuid FROM tasks
        JOIN workflows ON tasks.workflow_id = workflows.workflow_id
        WHERE tasks.pod_name = %s
    '''
    task_rows = postgres.execute_fetch_command(
        fetch_cmd, (message.pod_name,), True)
    if not task_rows:
        logging.warning('No tasks found for pod name %s', message.pod_name)
        return
    task_name = task_rows[0]['name']
    workflow_uuid = task_rows[0]['workflow_uuid']
    # There is an extra row per task retry
    retry_id = len(task_rows) - 1

    redis_connector = connectors.RedisConnector.get_instance()
    redis_client = redis_connector.client

    # Key to track latest event timestamp for this workflow
    timestamp_key = f'pod_event:{workflow_uuid}:{task_name}:latest_timestamp'
    latest_timestamp = redis_client.get(timestamp_key)
    latest_timestamp = float(latest_timestamp) if latest_timestamp else 0

    # Only process if event is newer
    if message.timestamp.timestamp() > latest_timestamp:
        event_log = f'{message.timestamp} [{task_name}] {message.reason}: {message.message}'
        log_body = connectors.redis.LogStreamBody(
            time=message.timestamp,
            io_type=connectors.redis.IOType.DUMP,
            source='OSMO',
            retry_id=retry_id,
            text=event_log)
        redis_client.xadd(common.get_workflow_events_redis_name(workflow_uuid),
                          json.loads(log_body.json()),
                          maxlen=max_event_log_lines)
        redis_client.set(timestamp_key, message.timestamp.timestamp())
        redis_client.expire(timestamp_key, connectors.MAX_LOG_TTL, nx=True)
        redis_client.expire(
            common.get_workflow_events_redis_name(workflow_uuid),
            connectors.MAX_LOG_TTL, nx=True)


async def send_heartbeat(websocket):
    ''' Used to send heartbeat to backend worker '''
    while True:
        await websocket.send_text(json.dumps({'type': 'heartbeat'}))
        # Send every minute
        await asyncio.sleep(60)


async def backend_listener_impl(websocket: fastapi.WebSocket, name: str):
    """ Communicates with backend listener. """
    await websocket.accept()
    logging.info('Opening listener websocket connection for backend %s', name)
    metric_creator = metrics.MetricCreator.get_meter_instance()

    context = objects.WorkflowServiceContext.get()
    config = context.config
    postgres = connectors.PostgresConnector.get_instance()
    service_config = postgres.get_service_configs()
    workflow_config = postgres.get_workflow_configs()

    # Store messages from the websocket to a queue, preventing pingpang messages to be blocked in
    # the websocket buffer
    message_queue: asyncio.Queue[dict] = asyncio.Queue(service_config.agent_queue_size)
    async def get_messages():
        try:
            while True:
                message = await websocket.receive_json()
                await message_queue.put(message)
        except asyncio.exceptions.CancelledError:
            pass
    get_message_task = None

    try:
        while True:
            message_json = await websocket.receive_json()
            try:
                message = backend_messages.MessageBody(**message_json)
                message_options = {
                    message.type.value: message.body
                }
                message_body = backend_messages.MessageOptions(**message_options)
                if message_body.logging:
                    log('backend_listener', name, config, message_body.logging)
                elif message_body.init:
                    create_backend(postgres, name, message_body.init)
                    break
                else:
                    raise osmo_errors.OSMOBackendError(f'Unexpected message: {message.type.value}')
            except pydantic.ValidationError as err:
                logging.error('Invalid message received from backend %s: %s', name, str(err))
                raise osmo_errors.OSMOBackendError(
                    f'Invalid message received from backend {name}: {str(err)}') from err
            except osmo_errors.OSMODatabaseError as db_err:
                logging.error(
                    'Encountered database error %s in backend %s while processing message %s',
                    db_err.message, name, message_json)
                raise osmo_errors.OSMOBackendError(
                    f'Encountered database error {db_err.message} in backend {name} while '
                    f'processing message {message_json}',
                    ) from db_err

        get_message_task = asyncio.create_task(get_messages())
        while True:
            ack_message: backend_messages.MessageBody | None = None
            try:
                message_json = await message_queue.get()
                start_time = time.time()
                message = backend_messages.MessageBody(**message_json)
                # Create acknowledgment using new MessageBody format
                ack_body = backend_messages.AckBody(uuid=message.uuid)
                ack_message = backend_messages.MessageBody(
                    type=backend_messages.MessageType.ACK,
                    body=ack_body.dict()
                )
                message_options = {
                    message.type.value: message.body
                }
                message_body = backend_messages.MessageOptions(**message_options)

                if message_body.logging:
                    log('backend_listener', name, config, message_body.logging)
                elif message_body.update_pod:
                    queue_update_group_job(postgres, message_body.update_pod)
                elif message_body.monitor_pod:
                    create_monitor_job(postgres, message_body.monitor_pod)
                elif message_body.resource:
                    update_resource(postgres, name, message_body.resource)
                elif message_body.resource_usage:
                    update_resource_usage(postgres, name, message_body.resource_usage)
                elif message_body.delete_resource:
                    delete_resource(postgres, name, message_body.delete_resource)
                elif message_body.node_hash:
                    clean_resources(postgres, name, message_body.node_hash)
                elif message_body.task_list:
                    clean_tasks(postgres, name, message_body.task_list)
                elif message_body.heartbeat:
                    config_helpers.update_backend_last_heartbeat(
                        name, message_body.heartbeat.time
                    )
                elif message_body.metrics:
                    send_metrics(message_body.metrics, name)
                elif message_body.pod_conditions:
                    send_pod_conditions(
                        postgres, message_body.pod_conditions,
                        workflow_config.max_event_log_lines)
                elif message_body.pod_event:
                    send_pod_event(
                        postgres, message_body.pod_event,
                        workflow_config.max_event_log_lines)
                else:
                    logging.error('Ignoring invalid backend listener message type %s',
                        message.type.value)

                processing_time = time.time() - start_time
                metric_creator.send_counter(
                    name='osmo_backend_event_processing_time', value=processing_time,
                    unit='seconds',
                    description='Time taken to process an event from a backend.',
                    tags={'type': message.type.value, 'backend': name}
                )
                metric_creator.send_counter(
                    name='osmo_backend_event_count', value=1, unit='count',
                    description='Number of event sent from the backend',
                    tags={'type': message.type.value, 'backend': name}
                )

            except pydantic.ValidationError as err:
                logging.error('Invalid message received from backend %s: %s', name, str(err))
                raise osmo_errors.OSMOBackendError(
                    f'Invalid message received from backend {name}: {str(err)}') from err
            except osmo_errors.OSMODatabaseError as db_err:
                logging.error(
                    'Encountered database error %s in backend %s while processing message %s',
                    db_err.message, name, message_json)
                raise osmo_errors.OSMOBackendError(
                    f'Encountered database error {db_err.message} in backend {name} while '
                    f'processing message {message_json}',
                    ) from db_err
            finally:
                if ack_message:
                    await websocket.send_text(ack_message.json())

    except fastapi.WebSocketDisconnect as err:  # The websocket is closed by client
        logging.info(
            'Closing listener websocket connection for backend %s with code %s', name, str(err))
    except asyncio.exceptions.CancelledError:
        pass
    finally:
        logging.info('Closing listener websocket connection backend %s', name)
        if get_message_task:
            get_message_task.cancel()


async def backend_listener_control_impl(websocket: fastapi.WebSocket, name: str):
    """ Communicates with backend listener. """
    await websocket.accept()
    logging.info('Opening listener websocket connection for sending actions to backend %s', name)
    postgres = connectors.PostgresConnector.get_instance()
    context = objects.WorkflowServiceContext.get()
    config = context.config

    try:
        # Get backend info from database and send node conditions
        backend_info = connectors.Backend.fetch_from_db(postgres, name)
        node_conditions = backend_info.node_conditions.dict()

        # Send node conditions to backend listener
        message = backend_messages.MessageBody(
            type=backend_messages.MessageType.NODE_CONDITIONS,
            body=backend_messages.NodeConditionsBody(
                available_conditions=node_conditions.get('additional_node_conditions', []),
                ignore_conditions=node_conditions.get('ignore_node_conditions', [])
            )
        )
        await websocket.send_text(message.json())
        logging.info('Sent node conditions to backend %s', name)

        async with redis.asyncio.from_url(config.redis_url) as redis_client:
            while True:
                try:
                    queue_name = connectors.backend_action_queue_name(name)
                    # Use async blocking brpop which yields control while waiting
                    result = await redis_client.brpop(queue_name)
                    if result is not None:
                        _, attrributes = result
                        logging.info('Sending action to backend %s from queue: %s with key: %s',
                                     name, queue_name, attrributes)
                        json_fields = json.loads(attrributes)
                        # Send node conditions to backend listener
                        message = backend_messages.MessageBody(
                            type=backend_messages.MessageType.NODE_CONDITIONS,
                            body=backend_messages.NodeConditionsBody(
                                available_conditions=json_fields.get('additional_node_conditions',
                                                                     []),
                                ignore_conditions=json_fields.get('ignore_node_conditions', [])
                            ))
                        await websocket.send_text(message.json())
                except (ConnectionError,
                        asyncio.exceptions.TimeoutError) as conn_error:
                    # Handle connection/timeout errors
                    logging.error('Connection error for backend %s: %s, retrying in 1 second...',
                                  name, str(conn_error))
                    await asyncio.sleep(1)
                    continue
                except OSError as os_error:
                    # Handle system-level errors
                    logging.error('System error for backend %s: %s, retrying in 1 second...',
                                  name, str(os_error))
                    await asyncio.sleep(1)
                    continue
                except Exception as error:
                    # Catch any unexpected errors
                    logging.exception('Unexpected error for backend %s: %s',
                                     name, str(error))
                    raise

    except fastapi.WebSocketDisconnect as err:  # The websocket is closed by client
        logging.info(
            'Closing listener websocket connection for backend %s with code %s', name, str(err))
    except asyncio.exceptions.CancelledError:
        pass
    finally:
        logging.info('Closing listener websocket connection backend %s', name)


async def backend_worker_impl(websocket: fastapi.WebSocket, name: str):
    """ Communicates with backend worker. """
    await websocket.accept()
    logging.info('Opening worker websocket connection for backend %s', name)

    # Create heartbeat thread
    heartbeat_thread = asyncio.create_task(send_heartbeat(websocket))

    try:
        postgres = connectors.PostgresConnector.get_instance()
        context = objects.WorkflowServiceContext.get()
        config = context.config
        while True:
            message_json = await websocket.receive_json()
            message = backend_messages.MessageBody(**message_json)
            message_options = {
                message.type.value: message.body
            }
            message_body = backend_messages.MessageOptions(**message_options)
            if message_body.logging:
                log('backend_worker', name, config, message_body.logging)
            elif message_body.init:
                create_backend(postgres, name, message_body.init)
                break
            else:
                raise osmo_errors.OSMOBackendError(f'Unexpected message: {message.type.value}')

        with kombu.Connection(config.redis_url,
                transport_options=connectors.get_backend_transport_option(name)) as conn:
            worker = backend_objects.WebsocketWorker(config, conn, websocket)
            await worker.run_jobs(name)

    except osmo_errors.OSMODatabaseError as err:
        logging.info(
            'Closing worker websocket connection for backend %s due to %s', name, err.message)
        await websocket.close(code=4000, reason=err.message)
    except fastapi.WebSocketDisconnect as err:  # The websocket is closed by client
        logging.info(
            'Closing worker websocket connection for workflow %s with code %s', name, str(err))
    finally:
        logging.info('Closing websocket connection for backend worker %s', name)
        heartbeat_thread.cancel()
