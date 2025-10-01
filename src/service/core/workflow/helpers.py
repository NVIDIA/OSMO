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
import hashlib
import http
import os
from typing import Any, List, Tuple
import urllib

import fastapi
import requests  # type: ignore

from src.lib.data import storage
from src.lib.utils import common, osmo_errors, priority as wf_priority
from src.utils.job import workflow, task
from src.service.core.workflow import objects
from src.utils import connectors


def get_workflows(users: List[str] | None = None,
                  name: str | None = None,
                  statuses: List[workflow.WorkflowStatus] | None = None,
                  pools: List[str] | None = None,
                  offset: int = 0,
                  limit: int = 20,
                  order: connectors.ListOrder = fastapi.Query(default=connectors.ListOrder.ASC),
                  submitted_after: datetime.datetime | None = None,
                  submitted_before: datetime.datetime | None = None,
                  tags: List[str] | None = None,
                  app_info: common.AppStructure | None = None,
                  priority: List[wf_priority.WorkflowPriority] | None = None,
                  return_raw: bool = False)\
                      -> Any:
    """ Fetch workflows with given parameters. """
    context = objects.WorkflowServiceContext.get()

    fetch_cmd = '''
            SELECT workflows.*,
                apps.owner as app_owner,
                apps.name as app_name
            FROM workflows
            LEFT JOIN apps ON workflows.app_uuid = apps.uuid
        '''
    fetch_input: List = []
    commands: List = []
    if tags:
        tags_cmd = '''
            JOIN workflow_tags ON workflows.workflow_uuid = workflow_tags.workflow_uuid
            AND workflow_tags.tag in %s
        '''
        fetch_cmd += tags_cmd
        fetch_input.append(tuple(tags))
    if app_info:
        commands.append('apps.name = %s')
        fetch_input.append(app_info.name)
        if app_info.version:
            commands.append('workflows.app_version = %s')
            fetch_input.append(app_info.version)
    if users:
        parsed_users = context.database.fetch_user_names(users)
        commands.append('submitted_by IN %s')
        fetch_input.append(tuple(parsed_users))
    if pools:
        commands.append('pool IN %s')
        fetch_input.append(tuple(pools))
    if name:
        # _ and % are special characters in postgres
        name = name.replace('_', r'\_').replace('%', r'\%')
        commands.append('workflow_id LIKE %s')
        fetch_input.append(f'%{name}%')
    if statuses:
        commands.append('status IN %s')
        fetch_input.append(tuple(status.name for status in statuses))
    else:
        commands.append('status != %s')
        fetch_input.append(f'{workflow.WorkflowStatus.FAILED_SUBMISSION.name}')
    if submitted_after:
        commands.append('submit_time >= %s')
        fetch_input.append(submitted_after.replace(microsecond=0).isoformat())
    if submitted_before:
        commands.append('submit_time < %s')
        fetch_input.append(submitted_before.replace(microsecond=0).isoformat())
    if priority:
        commands.append('priority IN %s')
        fetch_input.append(tuple(p.value for p in priority))
    if commands:
        conditions = ' AND '.join(commands)
        fetch_cmd = f'{fetch_cmd} WHERE {conditions}'

    fetch_cmd += ' ORDER BY submit_time DESC LIMIT %s OFFSET %s'
    fetch_input.extend([limit, offset])

    fetch_cmd = f'SELECT * FROM ({fetch_cmd}) as wf'
    if order == connectors.ListOrder.ASC:
        fetch_cmd += ' ORDER BY submit_time ASC'
    else:
        fetch_cmd += ' ORDER BY submit_time DESC'
    fetch_cmd += ';'
    return context.database.execute_fetch_command(fetch_cmd, tuple(fetch_input), return_raw)


def get_tasks(workflow_id: str | None = None,
              statuses: List[task.TaskGroupStatus] | None = None,
              users: List[str] | None = None,
              pools: List[str] | None = None,
              nodes: List[str] | None = None,
              started_after: datetime.datetime | None = None,
              started_before: datetime.datetime | None = None,
              offset: int = 0,
              limit: int = 20,
              order: connectors.ListOrder = fastapi.Query(default=connectors.ListOrder.ASC),
              summary: bool = False,
              aggregate_by_workflow: bool = False,
              priority: List[wf_priority.WorkflowPriority] | None = None,
              return_raw: bool = False) -> Any:
    """ Fetch workflows with given parameters. """
    context = objects.WorkflowServiceContext.get()

    if summary:
        select_statement = '''
            SELECT workflows.submitted_by, workflows.pool, workflows.priority,
                SUM(tasks.disk_count) as disk_count,
                SUM(tasks.cpu_count) as cpu_count, SUM(tasks.memory_count) as memory_count,
                SUM(tasks.gpu_count) as gpu_count
        '''
    elif aggregate_by_workflow:
        select_statement = '''
            SELECT workflows.workflow_id, workflows.submitted_by, workflows.pool, workflows.priority,
                SUM(tasks.disk_count) as disk_count,
                SUM(tasks.cpu_count) as cpu_count, SUM(tasks.memory_count) as memory_count,
                SUM(tasks.gpu_count) as gpu_count
        '''
    else:
        select_statement = '''
            SELECT tasks.*, workflows.submitted_by, workflows.workflow_uuid,
                workflows.backend, workflows.pool, workflows.priority
        '''

    fetch_cmd = f'''
        {select_statement} FROM tasks
        LEFT JOIN workflows ON tasks.workflow_id = workflows.workflow_id
    '''
    fetch_input: List = []
    commands: List = []
    if summary:
        # Summary should not have rows with user and no pool
        # Base output can show old tasks before pools were implemented
        commands.append('workflows.pool IS NOT NULL')
    if workflow_id:
        workflow_id = workflow_id.replace('_', r'\_').replace('%', r'\%')
        commands.append('tasks.workflow_id LIKE %s')
        fetch_input.append(f'%{workflow_id}%')
    if statuses:
        commands.append('tasks.status IN %s')
        fetch_input.append(tuple(status.name for status in statuses))
    if users:
        commands.append('workflows.submitted_by IN %s')
        fetch_input.append(tuple(context.database.fetch_user_names(users)))
    if pools:
        commands.append('workflows.pool IN %s')
        fetch_input.append(tuple(pools))
    if nodes:
        commands.append('tasks.node_name IN %s')
        fetch_input.append(tuple(nodes))
    if started_after:
        commands.append('(tasks.start_time >= %s OR tasks.start_time is NULL)')
        fetch_input.append(started_after.replace(microsecond=0).isoformat())
    if started_before:
        commands.append('(tasks.start_time < %s AND tasks.start_time is not NULL)')
        fetch_input.append(started_before.replace(microsecond=0).isoformat())
    if priority:
        commands.append('workflows.priority IN %s')
        fetch_input.append(tuple(p.value for p in priority))
    if commands:
        conditions = ' AND '.join(commands)
        fetch_cmd = f'{fetch_cmd} WHERE {conditions}'

    if summary:
        fetch_cmd += '''
            GROUP BY workflows.submitted_by, workflows.pool, workflows.priority
            ORDER BY workflows.submitted_by, workflows.pool, workflows.priority
            LIMIT %s OFFSET %s
        '''
        fetch_input.extend([min(limit, 1000), offset])

    elif aggregate_by_workflow:
        fetch_cmd += '''
            GROUP BY workflows.workflow_id, workflows.submitted_by, workflows.pool, workflows.priority
            LIMIT %s OFFSET %s
        '''
        fetch_input.extend([min(limit, 1000), offset])

    else:
        fetch_cmd += '''
            ORDER BY
                CASE
                    WHEN tasks.status = 'SCHEDULING' THEN 1
                    WHEN tasks.status = 'INITIALIZING' THEN 2
                    WHEN tasks.status = 'RUNNING' THEN 3
                    ELSE 4
                END,
                tasks.start_time DESC, workflows.submit_time DESC, tasks.name DESC
            LIMIT %s OFFSET %s
        '''
        fetch_input.extend([min(limit, 1000), offset])

    fetch_cmd = f'SELECT *, ROW_NUMBER() OVER () AS rn FROM ({fetch_cmd}) as t'
    # Latest at bottom
    if order == connectors.ListOrder.ASC:
        fetch_cmd += ' ORDER BY rn DESC'
    else:
        fetch_cmd += ' ORDER BY rn ASC'
    fetch_cmd += ';'
    return context.database.execute_fetch_command(fetch_cmd, tuple(fetch_input), return_raw)


def get_resource_node_hash(resource_node: List[Tuple[str, str]]):
    """ Calculate a hash value based on a node's resources. """
    resource_node_str = ''
    for resource in resource_node:
        resource_node_str += ':'.join(resource) + ','
    return hashlib.sha256((resource_node_str).encode()).hexdigest()


def get_pool_resources(pools: List[str] | None = None,
                       platforms: List[str] | None = None) -> objects.PoolResourcesResponse:
    context = objects.WorkflowServiceContext.get()

    conditions = []
    query_params = []
    if pools:
        conditions.append('pools.name IN %s')
        query_params.append(tuple(pools))
        if platforms:
            conditions.append('keys IN %s')
            query_params.append(tuple(platforms))
    fetch_cmd = f'''
        SELECT pools.name, keys as platform,
            pools.backend, backends.last_heartbeat, pools.enable_maintenance,
            json_agg(resources.usage_fields) as usage_fields,
            json_agg(resources.allocatable_fields) as allocatable_fields from pools
        CROSS JOIN LATERAL jsonb_object_keys(pools.platforms) AS keys(key)
        LEFT JOIN backends ON backends.name = pools.backend
        LEFT JOIN resource_platforms ON pools.name = resource_platforms.pool
            AND keys = resource_platforms.platform
        LEFT JOIN resources ON resource_platforms.resource_name = resources.name
            AND resource_platforms.backend = resources.backend
        {f'WHERE {" AND ".join(conditions)}' if conditions else ''}
        group by pools.name, keys, backends.last_heartbeat
        order by pools.name, keys
        '''
    pool_rows = context.database.execute_fetch_command(fetch_cmd, tuple(query_params),
                                                       return_raw=True)
    pool_response = []
    for pool_row in pool_rows:
        # Add status
        status = connectors.PoolStatus.OFFLINE
        if pool_row.get('enable_maintenance', False):
            status = connectors.PoolStatus.MAINTENANCE
        else:
            if pool_row.get('last_heartbeat', None) and \
                common.heartbeat_online(pool_row['last_heartbeat']):
                status = connectors.PoolStatus.ONLINE

        total_usage = {resource.name: 0 \
                       for resource in common.ALLOCATABLE_RESOURCES_LABELS}
        total_allocatable = {resource.name: 0 \
                             for resource in common.ALLOCATABLE_RESOURCES_LABELS}

        # Sum the usage and allocatable per pool/platform
        for usage_field, allocatable_field in \
            zip(pool_row.get('usage_fields', []), pool_row.get('allocatable_fields', [])):

            if not usage_field or not allocatable_field:
                continue

            current_info = {
                'usage_fields': connectors.BackendResource.convert_allocatable(usage_field),
                'allocatable_fields': connectors.BackendResource.convert_allocatable(
                    allocatable_field)
            }
            for resource_label in common.ALLOCATABLE_RESOURCES_LABELS:
                allocatable, usage = \
                    common.convert_allocatable_request_fields(
                        resource_label.name,
                        current_info, pool_row['name'], pool_row['platform'])
                total_usage[resource_label.name] += usage
                total_allocatable[resource_label.name] += allocatable
        pool_response.append(objects.PoolResourcesEntry(
            pool=pool_row['name'],
            platform=pool_row['platform'],
            backend=pool_row['backend'],
            status=status,
            usage_fields=total_usage,
            allocatable_fields=total_allocatable,
        ))
    return objects.PoolResourcesResponse(pools=pool_response)


def get_workflow_file_prefix(workflow_name: str, file_name: str) -> str:
    """ Return the prefix to the corresponding workflow file. """
    return os.path.join(workflow_name, file_name)


def get_workflow_file(file_name: str, workflow_name: str,
                      storage_client: storage.Client,
                      last_n_lines: int | None = None) -> storage.LinesStream:
    """
    Stream the designated workflow file.

    If the file is a templated workflow spec file, this function will check if the non-templated
    file exists and stream it if it does. If it does not exist, this function will stream the
    rendered workflow spec file.

    Args:
        file_name: The name of the file to stream.
        workflow_name: The name of the workflow.
        last_n_lines: The number of lines to stream from the end of the file.

    Returns:
        A generator of lines from the file.
    """
    file_prefix = get_workflow_file_prefix(
        workflow_name,
        file_name,
    )


    if file_name == common.TEMPLATED_WORKFLOW_SPEC_FILE_NAME:
        templated_file_exist = workflow_file_exists(
            workflow_name,
            file_name,
            storage_client,
        )
        if not templated_file_exist:
            file_prefix = get_workflow_file_prefix(
                workflow_name,
                common.WORKFLOW_SPEC_FILE_NAME,
            )

    if last_n_lines is not None:
        return storage_client.get_object_stream(
            file_prefix,
            last_n_lines=last_n_lines,
        )

    return storage_client.get_object_stream(
        file_prefix,
        as_lines=True,
    )


def workflow_file_exists(workflow_id: str,
                         file_name: str,
                         storage_client: storage.Client) -> bool:
    """ Check to see if workflow file exists in workflow data storage. """
    listed_objects = storage_client.list_objects(
        prefix=get_workflow_file_prefix(workflow_id, file_name),
    )

    return any(
        obj.key.split('/')[-1] == file_name
        for obj in listed_objects
    )


def gather_stream_content(generator) -> str:
    """ Converts a file generator into file contents. """
    data = []
    for chunk in generator:
        data.append(chunk)
    return ''.join(data)


def get_all_users() -> Any:
    """ Fetch all unique users who have submitted workflows. """
    context = objects.WorkflowServiceContext.get()

    fetch_cmd = '''
            SELECT DISTINCT (submitted_by) FROM workflows
        '''
    return context.database.execute_fetch_command(fetch_cmd, tuple())


def set_workflow_tags(workflow_id: str, add_tags: List[str] | None, remove_tags: List[str] | None):
    """ Adds and Removes Tags from a workflow """
    context = objects.WorkflowServiceContext.get()

    workflow_tags = context.database.get_workflow_configs().workflow_info.tags
    if add_tags and not set(add_tags) <= set(workflow_tags):
        raise osmo_errors.OSMOUserError(
            f'Invalid tag detected. Users can only set specified tags: {", ".join(workflow_tags)}')

    commit_input = []

    delete_cmd = ''
    if remove_tags:
        delete_cmd = '''
            DELETE FROM workflow_tags
                WHERE workflow_uuid = (
                    SELECT workflow_uuid FROM workflows
                    WHERE workflow_id = %s or workflow_uuid = %s
                )
                AND tag in %s;
            '''
        commit_input += [workflow_id, workflow_id, tuple(remove_tags)]

    add_cmd = ''
    if add_tags:
        add_cmd = f'''
            INSERT INTO workflow_tags (workflow_uuid, tag)
                SELECT w.workflow_uuid, t.tag
                FROM workflows w
                JOIN (
                    VALUES {",".join(["(%s, %s)"] * len(add_tags))}
                ) AS t(workflow_id, tag)
                ON w.workflow_id = t.workflow_id OR w.workflow_uuid = t.workflow_id
                ON CONFLICT DO NOTHING;
            '''
        for tag in add_tags:
            commit_input.append(workflow_id)
            commit_input.append(tag)

    commit_cmd = f'''
            BEGIN;
            {delete_cmd}
            {add_cmd}
            COMMIT;
        '''
    context.database.execute_commit_command(commit_cmd, tuple(commit_input))


def get_recent_tasks(database: connectors.PostgresConnector,
                     minutes_ago: int = 5) -> list:
    """
    Query for active tasks or recently completed tasks.

    Args:
        database: The database connector to use
        minutes_ago: How many minutes back to look for completed tasks

    Returns:
        List of task records with task and workflow information
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff_time = now - datetime.timedelta(minutes=minutes_ago)

    # Query for active tasks or recently completed tasks
    query = """
    SELECT
        w.pool AS pool,
        w.submitted_by AS user,
        w.workflow_uuid AS workflow_uuid,
        t.status AS status
    FROM
        tasks t
    JOIN
        workflows w ON t.workflow_id = w.workflow_id
    WHERE
        (t.end_time is NULL
            AND w.status IN ('WAITING', 'PENDING', 'RUNNING'))
        OR t.end_time > %s
    GROUP BY w.pool, w.submitted_by, t.status, w.workflow_uuid
    """

    return database.execute_fetch_command(query, (cutoff_time,), True)


def _cookie_to_header_string(cookie) -> str:
    """ Converts cookie to a string used in headers. """
    cookie_parts = [f'{cookie.name}={cookie.value}', f'Path={cookie.path}']

    same_site = cookie._rest.get('SameSite')  # pylint: disable=protected-access
    if same_site:
        cookie_parts.append(f'SameSite={same_site}')

    if cookie.secure:
        cookie_parts.append('Secure')

    return '; '.join(cookie_parts)


def get_router_cookie(url: str, timeout: int = 60) -> str:
    """ Gets router cookies """
    parsed_url = urllib.parse.urlparse(url)
    if parsed_url.scheme == 'wss':
        parsed_url = parsed_url._replace(scheme='https')
    elif parsed_url.scheme == 'ws':
        parsed_url = parsed_url._replace(scheme='http')
    else:
        raise osmo_errors.OSMOServerError(f'Invalid router address: {url}')
    url = urllib.parse.urlunparse(parsed_url)
    res = requests.get(f'{url}/api/router/version', timeout=timeout)

    # Convert cookies manualy rather than using 'set-cookie' to solve duplicate cookie names
    # for virtual node with ssh port-forwarding
    cookie_str = ', '.join([_cookie_to_header_string(i) for i in res.cookies])
    return cookie_str


def get_running_task(
    workflow_result: objects.WorkflowQueryResponse,
    task_name: str,
) -> objects.TaskQueryResponse:
    """
    Get a running task from workflow result or raise an error.

    Raises:
        osmo_errors.OSMOUserError: If task is not running/prerunning/rescheduled.
    """
    workflow_id = workflow_result.name
    task_obj = next(
        (
            task_obj for group in workflow_result.groups
            for task_obj in group.tasks
            if task_obj.name == task_name
        ),
        None,
    )
    if task_obj is None:
        raise osmo_errors.OSMOUserError(
            f'Task {task_name} does not exist in workflow {workflow_id}!',
            workflow_id=workflow_id,
            status_code=http.HTTPStatus.NOT_FOUND.value,
        )
    elif task_obj.status == task.TaskGroupStatus.RUNNING:
        return task_obj
    elif task_obj.status.prerunning() or task_obj.status == task.TaskGroupStatus.RESCHEDULED:
        raise osmo_errors.OSMOUserError(
            f'Task {task_name} is not yet running in workflow {workflow_id}!',
            workflow_id=workflow_id,
            status_code=http.HTTPStatus.TOO_EARLY.value,
        )
    else:
        raise osmo_errors.OSMOUserError(
            f'Task {task_name} is not running in workflow {workflow_id}!',
            workflow_id=workflow_id,
            status_code=http.HTTPStatus.NOT_FOUND.value,
        )


def get_running_tasks_from_group(
    workflow_result: objects.WorkflowQueryResponse,
    group_name: str,
) -> List[objects.TaskQueryResponse]:
    """
    Get all running tasks from a group or raise an error.

    Raises:
        osmo_errors.OSMOUserError: If no tasks are running/prerunning/rescheduled.
    """
    workflow_id = workflow_result.name
    group_obj = next(
        (
            group for group in workflow_result.groups
            if group.name == group_name
        ),
        None,
    )
    if not group_obj:
        raise osmo_errors.OSMOUserError(
            f'Group {group_name} does not exist in workflow {workflow_id}!',
            workflow_id=workflow_id,
            status_code=http.HTTPStatus.NOT_FOUND.value,
        )

    tasks: List[objects.TaskQueryResponse] = []
    prerunning_task_count = 0
    rescheduled_task_count = 0
    for task_query_response in group_obj.tasks:
        if task_query_response.status == task.TaskGroupStatus.RUNNING:
            tasks.append(task_query_response)
        elif task_query_response.status == task.TaskGroupStatus.RESCHEDULED:
            rescheduled_task_count += 1
        elif task_query_response.status.prerunning():
            prerunning_task_count += 1

    if len(tasks) == 0:
        if rescheduled_task_count > 0 or prerunning_task_count > 0:
            raise osmo_errors.OSMOUserError(
                f'Tasks in group {group_name} of workflow {workflow_id} are not running yet...',
                workflow_id=workflow_id,
                status_code=http.HTTPStatus.TOO_EARLY.value,
            )
        else:
            raise osmo_errors.OSMOUserError(
                f'No active tasks in group {group_name} of workflow {workflow_id}!',
                workflow_id=workflow_id,
                status_code=http.HTTPStatus.NOT_FOUND.value,
            )
    return tasks


def get_running_tasks_from_workflow(
    workflow_result: objects.WorkflowQueryResponse,
) -> List[objects.TaskQueryResponse]:
    """
    Get all running tasks from a workflow or raise an error.

    Raises:
        osmo_errors.OSMOUserError: If no tasks are running/prerunning/rescheduled.
    """
    workflow_id = workflow_result.name
    group_objs = workflow_result.groups
    if len(group_objs) == 0:
        raise osmo_errors.OSMOUserError(
            f'No groups in workflow {workflow_id}!',
            workflow_id=workflow_id,
            status_code=http.HTTPStatus.NOT_FOUND.value,
        )

    tasks: List[objects.TaskQueryResponse] = []
    prerunning_task_count = 0
    rescheduled_task_count = 0
    for group_obj in group_objs:
        for task_query_response in group_obj.tasks:
            if task_query_response.status == task.TaskGroupStatus.RUNNING:
                tasks.append(task_query_response)
            elif task_query_response.status.prerunning():
                prerunning_task_count += 1
            elif task_query_response.status == task.TaskGroupStatus.RESCHEDULED:
                rescheduled_task_count += 1

    if len(tasks) == 0:
        if prerunning_task_count > 0 or rescheduled_task_count > 0:
            # If any task in the workflow is not running yet, raise an too early error
            raise osmo_errors.OSMOUserError(
                f'Tasks in workflow {workflow_id} are not running yet...',
                workflow_id=workflow_id,
                status_code=http.HTTPStatus.TOO_EARLY.value,
            )
        else:
            raise osmo_errors.OSMOUserError(
                f'No active tasks in workflow {workflow_id}!',
                workflow_id=workflow_id,
                status_code=http.HTTPStatus.NOT_FOUND.value,
            )
    return tasks
