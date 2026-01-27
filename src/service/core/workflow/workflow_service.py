"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES.
All rights reserved.

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

import collections
import dataclasses
import datetime
import enum
import http
import json
import logging
import re
from typing import Any, AsyncGenerator, Dict, Generator, List, Optional
import urllib.parse
import yaml

import fastapi
import fastapi.responses
import fastapi.staticfiles

from src.lib.data import storage
from src.lib.utils import common, credentials, login, osmo_errors, priority as wf_priority
from src.utils.job import common as job_common, jobs, workflow, task
from src.service.core.workflow import helpers, objects
from src.utils import connectors


router = fastapi.APIRouter(tags = ['Workflow API'])
router_credentials = fastapi.APIRouter(tags = ['Credentials API'])
router_resource = fastapi.APIRouter(tags = ['Resource API'])
router_pool = fastapi.APIRouter(tags = ['Pool API'])


FETCH_TASK_LIMIT = 1000


class ActionType(enum.Enum):
    EXEC = 'exec'
    PORTFORWARD = 'portforward'
    WEBSERVER = 'webserver'
    RSYNC = 'rsync'
    CANCEL = 'cancel'


@dataclasses.dataclass
class NodeGpuUsage:
    """Represents the GPU usage of a node"""
    allocatable: int = 0
    usage: int = 0

    def __add__(self, other: 'NodeGpuUsage') -> 'NodeGpuUsage':
        return NodeGpuUsage(self.allocatable + other.allocatable, self.usage + other.usage)


@dataclasses.dataclass(frozen=True)
class NodeSet:
    """Represents a set of nodes in the same backend. If two pools use the same nodeset, we will
    show the capacity together."""
    backend: str
    nodes: frozenset[str]

    def add_node(self, node: str) -> 'NodeSet':
        return NodeSet(self.backend, self.nodes | {node})

    def __iter__(self):
        """Iterate over the nodes in the set, yielding (backend, node) tuples."""
        for node in self.nodes:
            yield (self.backend, node)


@dataclasses.dataclass
class BaseResourceUsage:
    """Represents the resource usage of a pool"""
    quota_used: int = 0
    quota_limit: int = -1
    total_usage: int = 0


@router_pool.get('/api/pool', response_class=common.PrettyJSONResponse)
def get_pools(all_pools: bool = True,
              pools: List[str] | None = fastapi.Query(default = None)) -> \
                   connectors.MinimalPoolConfig | objects.PoolResponse:
    """
    Returns information regarding pools to users.

    If all_pools is set to true, all pools' information will be returned in API response.
    Otherwise, only information from pools that the user has access to will be returned
    in the response.
    """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.fetch_minimal_pool_config(
            postgres,
            pools=pools,
            all_pools=all_pools)


@router_pool.get('/api/pool_quota', response_class=common.PrettyJSONResponse)
def get_pool_quotas(all_pools: bool = True,
                    pools: List[str] | None = fastapi.Query(default = None)) -> \
                        objects.PoolResponse:
    postgres = connectors.PostgresConnector.get_instance()
    pool_configs = \
        connectors.fetch_minimal_pool_config(
            postgres,
            pools=pools,
            all_pools=all_pools).pools

    # Get the label used for GPU resources.
    gpu_label = [label for label in common.ALLOCATABLE_RESOURCES_LABELS
                 if label.name == 'gpu'][0].name

    # Initialize the pool resources, resource usage, and capacity:
    resource_usage_map : Dict[str, BaseResourceUsage] = {}
    for pool_name, pool_config in pool_configs.items():
        # Initialize the resource limits if not present
        if not pool_config.resources:
            pool_config.resources = connectors.PoolResources()
        if not pool_config.resources.gpu:
            pool_config.resources.gpu = connectors.PoolResourceCountable()

        # Initialize the resource usage
        resource_usage_map[pool_name] = BaseResourceUsage(
            quota_used=0,
            quota_limit=pool_config.resources.gpu.guarantee,
            total_usage=0,
        )

    offset = 0
    while True:
        # Get all of the RUNNING tasks for each pool
        task_rows = helpers.get_tasks(
            statuses=[task.TaskGroupStatus.RUNNING],
            pools=[] if all_pools else pools,
            summary=True,
            limit=FETCH_TASK_LIMIT,
            offset=offset,
            return_raw=True,
        )
        tasks = objects.ListTaskSummaryResponse.from_db_rows(task_rows)

        # Sum up the resource used by running tasks in each pool
        for summary in tasks.summaries:
            task_pool = summary.pool
            if not task_pool or task_pool not in pool_configs:
                continue
            resource_usage_map[task_pool].total_usage += summary.gpu
            priority = wf_priority.WorkflowPriority(summary.priority)
            if not priority.preemptible:
                resource_usage_map[task_pool].quota_used += summary.gpu

        if len(tasks.summaries) < FETCH_TASK_LIMIT:
            break

        offset += FETCH_TASK_LIMIT

    # Get all resources for the pools
    resources_response = objects.get_resources(
        pools=[] if all_pools else pools,
        platforms=None,
    )

    # Keep a map of which nodes are in each pool
    node_sets = \
        {pool: NodeSet(config.backend, frozenset()) \
            for pool, config in pool_configs.items()}
    # Keep a map of how much GPUs allocatable/requests are in each node
    node_gpu_usage = {}


    # Sum up the capacity for each node
    sum_node_capacity = 0
    sum_node_free = 0
    for resource in resources_response.resources:
        # Fill up the node_gpu_usage map
        resource_key = (resource.backend, resource.hostname)
        node_gpu_usage[resource_key] = NodeGpuUsage(
            allocatable=int(resource.allocatable_fields.get(gpu_label, 0)),
            usage=int(resource.usage_fields.get(gpu_label, 0)) + \
                  int(resource.non_workflow_usage_fields.get('nvidia.com/gpu', 0))
        )

        # Sum up total capacity for each node
        sum_node_capacity += node_gpu_usage[resource_key].allocatable
        sum_node_free += node_gpu_usage[resource_key].allocatable - \
                         node_gpu_usage[resource_key].usage

        # Keep track of which nodes are in each pool
        for pool_platform in resource.exposed_fields['pool/platform']:
            pool, _ = pool_platform.split('/')
            if pool not in node_sets:
                if all_pools:
                    logging.warning(
                        'During pool quota request, pool %s not found in '
                        'nodesets for resource %s', pool, resource.hostname)
                continue
            node_sets[pool] = node_sets[pool].add_node(resource.hostname)

    pools_by_nodeset = collections.defaultdict(list)
    for pool, nodeset in node_sets.items():
        pools_by_nodeset[nodeset].append(pool)

    gpu_usage_by_nodeset = {
        nodeset: sum((node_gpu_usage[node] for node in nodeset), start=NodeGpuUsage())
        for nodeset in pools_by_nodeset.keys()
    }

    # Initialize per-pool calculated sums
    sum_quota_free = 0
    sum_quota_limit = 0
    sum_quota_used = 0
    sum_total_usage = 0

    node_set_resource_usage_list : List[objects.PoolNodeSetResourceUsage] = []
    for nodeset in gpu_usage_by_nodeset.keys():
        node_set_response = objects.PoolNodeSetResourceUsage(pools=[])
        gpu_usage = gpu_usage_by_nodeset[nodeset]
        for pool in pools_by_nodeset[nodeset]:
            pool_config = pool_configs[pool]
            # Capacity and total free are only printed for the first pool in the nodeset
            total_capacity = gpu_usage.allocatable
            total_free = gpu_usage.allocatable - gpu_usage.usage

            # Calculate other per-pool values
            quota_used = resource_usage_map[pool].quota_used
            quota_limit = resource_usage_map[pool].quota_limit
            if quota_limit == -1:
                quota_limit = gpu_usage.allocatable
            total_usage = resource_usage_map[pool].total_usage
            quota_free = quota_limit - resource_usage_map[pool].quota_used

            # Aggregate quota data
            sum_total_usage += total_usage
            sum_quota_limit += quota_limit
            sum_quota_used += quota_used
            sum_quota_free += quota_free

            resource_usage = objects.ResourceUsage(
                quota_used=quota_used,
                quota_free=quota_free,
                quota_limit=quota_limit,
                total_usage=total_usage,
                total_capacity=total_capacity,
                total_free=total_free
            )

            node_set_response.pools.append(objects.PoolResourceUsage(
                **pool_config.dict(),
                resource_usage=resource_usage
            ))

        node_set_resource_usage_list.append(node_set_response)

    response = objects.PoolResponse(
        node_sets=node_set_resource_usage_list,
        resource_sum=objects.ResourceUsage(
            quota_used=str(sum_quota_used),
            quota_free=str(sum_quota_free),
            quota_limit=str(sum_quota_limit),
            total_usage=str(sum_total_usage),
            total_capacity=str(sum_node_capacity),
            total_free=str(sum_node_free)
        )
    )

    return response


@router_pool.post('/api/pool/{pool_name}/workflow')
def submit_workflow(pool_name: str,
                    template_spec: workflow.TemplateSpec | None = None,
                    workflow_id: str | None = None,
                    app_uuid: str | None = None,
                    app_version: int | None = None,
                    dry_run: bool = False,
                    validation_only: bool = False,
                    priority: wf_priority.WorkflowPriority = wf_priority.WorkflowPriority.NORMAL,
                    env_vars: List[str] = fastapi.Query(default=[]),
                    user_header: Optional[str] =
                        fastapi.Header(alias=login.OSMO_USER_HEADER, default=None),
                    roles_header: Optional[str] =
                        fastapi.Header(alias=login.OSMO_USER_ROLES, default=None)) -> \
        objects.SubmitResponse:
    """ This api validates that a workflow is well formed and valid and then submits it. """
    if template_spec and workflow_id:
        raise osmo_errors.OSMOUsageError(
            'Either file contents or workflow ID can be provided, but not both.')

    if not template_spec and not workflow_id:
        raise osmo_errors.OSMOUsageError(
            'Need to provide either file contents or workflow ID.'
        )

    if workflow_id:
        wf_spec = helpers.gather_stream_content(download_workflow_spec(workflow_id))
        template_spec = workflow.TemplateSpec(file=wf_spec, set_variables=[])
    elif not template_spec:
        raise osmo_errors.OSMOUsageError(
            'Need to provide either file contents or workflow ID.'
        )

    user = connectors.parse_username(user_header)
    context = objects.WorkflowServiceContext.get()

    workflow_submit_info = objects.WorkflowSubmitInfo(
        context=context, base32_id=common.generate_unique_id(),
        parent_workflow_id=workflow_id, app_uuid=app_uuid, app_version=app_version, user=user,
        pool=pool_name, priority=priority)

    workflow_dict = workflow_submit_info.construct_workflow_dict(template_spec)

    if dry_run:
        spec = yaml.dump(workflow_dict)
        return objects.SubmitResponse(name=workflow_submit_info.name, spec=spec)

    workflow_spec = workflow_submit_info.construct_workflow_spec_from_dict(workflow_dict)
    workflow_submit_info.update_dataset_buckets(workflow_spec)

    env_vars_dict = {}
    if env_vars:
        for item in env_vars:
            kv_split = item.split('=')
            try:
                env_vars_dict[kv_split[0]] = kv_split[1]
            except IndexError as e:
                raise osmo_errors.OSMOUsageError(
                    f'Environment variable {item} is incorrectly formatted') from e

    def update_env_vars(tasks: List[task.TaskSpec]):
        for wf_task in tasks:
            wf_task.environment.update(env_vars_dict)

    if workflow_spec.groups:
        for group in workflow_spec.groups:
            update_env_vars(group.tasks)
    else:
        update_env_vars(workflow_spec.tasks)

    group_and_task_uuids: Dict[str, common.UuidPattern] = {}
    rendered_spec = workflow_spec.parse(context.database,
                                        workflow_submit_info.backend, workflow_submit_info.pool,
                                        group_and_task_uuids)

    workflow_config = context.database.get_workflow_configs()
    if rendered_spec.get_num_tasks() > workflow_config.max_num_tasks:
        raise osmo_errors.OSMOUserError(
            f'Workflow cannot have more than {workflow_config.max_num_tasks} tasks.'
        )

    original_templated_spec = template_spec.uploaded_templated_spec if template_spec else None


    workflow_submit_info.validate_workflow_spec(rendered_spec, group_and_task_uuids,
                                                login.construct_roles_list(roles_header),
                                                original_templated_spec,
                                                priority)

    if validation_only:
        return objects.SubmitResponse(
            name=workflow_submit_info.name,
            logs='Workflow validation succeeded.')

    # Limit the total user workflows/tasks
    user_workflow_limits = workflow_config.user_workflow_limits
    if user_workflow_limits.max_num_workflows or user_workflow_limits.max_num_tasks:
        # Get # of active tasks and workflows
        current_num_workflows, current_num_tasks = workflow.get_num_workflows_and_tasks(
            context.database,
            workflow_submit_info.user,
            workflow.WorkflowStatus.get_alive_statuses(),
            task.TaskGroupStatus.get_alive_statuses())

        if user_workflow_limits.max_num_workflows and \
                current_num_workflows >= user_workflow_limits.max_num_workflows:
            raise osmo_errors.OSMOUserError(
                f'User {workflow_submit_info.user} cannot submit more than '
                f'{user_workflow_limits.max_num_workflows} ongoing workflows.')

        if user_workflow_limits.max_num_tasks and \
                current_num_tasks + workflow_spec.get_num_tasks() > \
                    user_workflow_limits.max_num_tasks:
            raise osmo_errors.OSMOUserError(
                f'User {workflow_submit_info.user} cannot submit more than '
                f'{user_workflow_limits.max_num_tasks} ongoing tasks.')

    return workflow_submit_info.send_submit_workflow_to_queue(rendered_spec,
                                                              group_and_task_uuids,
                                                              original_templated_spec)

@router_pool.post('/api/pool/{pool_name}/workflow/{workflow_id}/restart')
def restart_workflow(pool_name: str,
                     workflow_id: str,
                     user_header: Optional[str] =
                         fastapi.Header(alias=login.OSMO_USER_HEADER, default=None),
                     roles_header: Optional[str] =
                         fastapi.Header(alias=login.OSMO_USER_ROLES, default=None)) -> \
        objects.SubmitResponse:
    """ This api restarts a failed workflow and then submits it. """
    context = objects.WorkflowServiceContext.get()
    workflow_obj = workflow.Workflow.fetch_from_db(context.database, workflow_id)
    workflow_id = workflow_obj.workflow_id
    if not workflow_obj.status.failed():
        raise osmo_errors.OSMOSubmissionError(
            f'Restart can only be used on FAILED workflows: '
            f'Workflow {workflow_id} has status {workflow_obj.status}')

    wf_spec = helpers.gather_stream_content(download_workflow_spec(workflow_id))
    template_spec = workflow.TemplateSpec(file=wf_spec, set_variables=[])
    user = connectors.parse_username(user_header)

    workflow_submit_info = objects.WorkflowSubmitInfo(
        context=context, base32_id=common.generate_unique_id(),
        parent_workflow_id=workflow_id, user=user,
        pool=pool_name, priority=workflow_obj.priority)

    workflow_dict = workflow_submit_info.construct_workflow_dict(template_spec)

    workflow_spec = workflow_submit_info.construct_workflow_spec_from_dict(workflow_dict)

    # Construct new workflow
    completed_tasks: Dict[str, bool] = {}
    for group_info in workflow_obj.groups:
        completed_tasks[group_info.name] = not group_info.status.failed()
        for group_task_info in group_info.tasks:
            completed_tasks[group_task_info.name] = not group_info.status.failed()

    # Update Dict
    new_groups = []
    for group in workflow_spec.groups:
        if not completed_tasks[group.name]:
            for group_task in group.tasks:
                for task_input in group_task.inputs:
                    if isinstance(task_input, task.TaskInputOutput):
                        parent_task, old_task = task_input.parsed_workflow_info()
                        # If it is from a previous task, no need to update
                        if old_task:
                            continue
                        # Only use the parent task if the parent group succeeded. If the group
                        # failed, then the group will be rerun in this new workflow
                        if completed_tasks[parent_task]:
                            task_input.task = f'{workflow_id}:{parent_task}'
            new_groups.append(group)
    workflow_spec.groups = new_groups

    new_tasks = []
    for task_obj in workflow_spec.tasks:
        if not completed_tasks[task_obj.name]:
            for task_input in task_obj.inputs:
                if isinstance(task_input, task.TaskInputOutput):
                    parent_task, old_task = task_input.parsed_workflow_info()
                    # If it is from a previous task, no need to update
                    if old_task:
                        continue
                    # Only use the parent task if the parent group succeeded. If the group
                    # failed, then the group will be rerun in this new workflow
                    if completed_tasks[parent_task]:
                        task_input.task = f'{workflow_id}:{parent_task}'
            new_tasks.append(task_obj)
    workflow_spec.tasks = new_tasks

    workflow_submit_info.update_dataset_buckets(workflow_spec)

    group_and_task_uuids: Dict[str, common.UuidPattern] = {}
    rendered_spec = workflow_spec.parse(context.database,
                                        workflow_submit_info.backend, workflow_submit_info.pool,
                                        group_and_task_uuids)

    original_templated_spec = template_spec.uploaded_templated_spec if template_spec else None


    workflow_submit_info.validate_workflow_spec(rendered_spec, group_and_task_uuids,
                                                login.construct_roles_list(roles_header),
                                                original_templated_spec)

    return workflow_submit_info.send_submit_workflow_to_queue(rendered_spec,
                                                              group_and_task_uuids,
                                                              original_templated_spec)


@router.post('/api/workflow/{name}/cancel')
def cancel_workflow(name: str,
                    message: str | None = None,
                    force: bool = False,
                    user: str = fastapi.Depends(connectors.parse_username)) -> \
        objects.CancelResponse:
    """ Cancels the workflow. """

    workflow_response = get_workflow(name)

    if workflow_response.status.finished() and not force:
        raise osmo_errors.OSMOUserError(
            f'Workflow {workflow_response.name} is already finished.')

    job_id=f'{workflow_response.uuid}-cancel'
    if force:
        job_id = f'{workflow_response.uuid}-{common.generate_unique_id(5)}-force-cancel'

    cancel_job = jobs.CancelWorkflow(
        job_id=job_id,
        workflow_id=workflow_response.name,
        workflow_uuid=workflow_response.uuid,
        message=message,
        user=user, force=force)
    cancel_job.send_job_to_queue()

    return objects.CancelResponse(name=workflow_response.name)


@router.get('/api/workflow', response_class=common.PrettyJSONResponse)
def list_workflow(users: List[str] | None = fastapi.Query(default = None),
                  name: str | None = None,
                  statuses: List[workflow.WorkflowStatus] | None = \
                      fastapi.Query(default = None),
                  offset: int = 0,
                  limit: int = 20,
                  order: connectors.ListOrder = fastapi.Query(default=connectors.ListOrder.ASC),
                  all_users: bool = False,
                  pools: List[str] | None = fastapi.Query(default = None),
                  all_pools: bool = False,
                  submitted_before: datetime.datetime | None = None,
                  submitted_after: datetime.datetime | None = None,
                  tags: List[str] | None = fastapi.Query(default = None),
                  app: str | None = fastapi.Query(default = None),
                  priority: List[wf_priority.WorkflowPriority] | None = \
                      fastapi.Query(default = None),
                  user_header: Optional[str] =
                      fastapi.Header(alias=login.OSMO_USER_HEADER, default=None)) \
                  -> objects.ListResponse:
    if offset < 0:
        raise osmo_errors.OSMOUsageError('Parameter start must be a non-negative integer.')

    if limit > 1000:
        raise osmo_errors.OSMOUserError('Limit must be less than 1000.')

    postgres = objects.WorkflowServiceContext.get().database
    service_url = postgres.get_workflow_service_url()
    if not users and not all_users:
        if user_header:
            users = [user_header]
    if not pools and not all_pools:
        user_pool = connectors.UserProfile.fetch_from_db(postgres, user_header or '').pool
        if not user_pool:
            raise osmo_errors.OSMOUserError('No pool selected!')
        pools = [user_pool]
    if all_pools:
        pools = []

    app_info = common.AppStructure(app) if app else None
    rows = helpers.get_workflows(users, name, statuses, pools, offset, limit+1, order,
                                 submitted_after, submitted_before, tags, app_info,
                                 priority=priority, return_raw=True)
    if order == connectors.ListOrder.DESC:
        rows = rows[:limit]
    elif len(rows) > limit:
        rows = rows[1:]
    return objects.ListResponse.from_db_rows(rows, service_url,
                                             more_entries=len(rows) > limit)


@router.get('/api/workflow/{name}/task/{task_name}', response_class=common.PrettyJSONResponse)
def get_workflow_task(name: str, task_name: str) -> objects.TaskEntry:
    """ Returns the task (with the latest retry_id) with the given name in the workflow. """
    context = objects.WorkflowServiceContext.get()
    task_row = task.Task.fetch_row_from_db(context.database, name, task_name)
    return objects.TaskEntry.from_db_row(task_row)


@router.get('/api/task', response_class=common.PrettyJSONResponse)
def list_task(workflow_id: str | None = None,
              statuses: List[task.TaskGroupStatus] | None = \
                  fastapi.Query(default = None),
              users: List[str] | None = fastapi.Query(default = None),
              all_users: bool = False,
              pools: List[str] | None = fastapi.Query(default = None),
              all_pools: bool = False,
              nodes: List[str] | None = fastapi.Query(default = None),
              started_after: datetime.datetime | None = None,
              started_before: datetime.datetime | None = None,
              offset: int = 0,
              limit: int = 20,
              order: connectors.ListOrder = fastapi.Query(default=connectors.ListOrder.ASC),
              summary: bool = False,
              aggregate_by_workflow: bool = False,
              priority: List[wf_priority.WorkflowPriority] | None = \
                  fastapi.Query(default = None),
              user_header: Optional[str] =
                  fastapi.Header(alias=login.OSMO_USER_HEADER, default=None)) \
              -> objects.ListTaskSummaryResponse | objects.ListTaskResponse | \
                 objects.ListTaskAggregatedResponse:

    if limit == 0:
        raise osmo_errors.OSMOUserError('Limit must be greater than 0.')
    if offset < 0:
        raise osmo_errors.OSMOUsageError('Parameter start must be a non-negative integer.')
    postgres = objects.WorkflowServiceContext.get().database
    if not users and not all_users:
        if user_header:
            users = [user_header]
    if not pools and not all_pools:
        user_pool = connectors.UserProfile.fetch_from_db(postgres, user_header or '').pool
        if not user_pool:
            raise osmo_errors.OSMOUserError('No pool selected!')
        pools = [user_pool]
    if all_pools:
        pools = []
    rows = helpers.get_tasks(workflow_id, statuses, users, pools, nodes,
                             started_after, started_before, offset, limit, order, summary,
                             aggregate_by_workflow,
                             priority=priority, return_raw=True)
    if summary:
        return objects.ListTaskSummaryResponse.from_db_rows(rows)
    if aggregate_by_workflow:
        return objects.ListTaskAggregatedResponse.from_db_rows(rows)
    service_url = postgres.get_workflow_service_url()
    return objects.ListTaskResponse.from_db_rows(rows, service_url)


@router.get('/api/workflow/{name}', response_class=common.PrettyJSONResponse)
def get_workflow(name: str, skip_groups: bool = False, verbose: bool = False
                 ) -> objects.WorkflowQueryResponse:
    """ Returns the workflow with the given name in the database. """
    context = objects.WorkflowServiceContext.get()
    return objects.WorkflowQueryResponse.fetch_from_db(context.database, name,
                                                       skip_groups=skip_groups,
                                                       verbose=verbose)


def get_file_info(name: str, redis_name: str, file_name: str,
                  storage_client: storage.Client,
                  download: bool = False, last_n_lines: Optional[int] = None,
                  regexes: Optional[List[str]] = None) -> Any:
    """ Returns the log from redis link or downloaded text file. """
    context = objects.WorkflowServiceContext.get()
    log_info = workflow.LogInfo.fetch_log_info_from_db(context.database, name)

    if last_n_lines:
        if last_n_lines <= 0:
            raise osmo_errors.OSMOUserError('Users should specify positive value for flag -n.')

        # If the backend exists, check to see if the last_n_lines is over max_lines for s3 read
        # optimization
        try:
            workflow_config = context.database.get_workflow_configs()
            max_log_lines = workflow_config.max_log_lines
            if last_n_lines >= max_log_lines:
                last_n_lines = None
        except osmo_errors.OSMOBackendError:
            pass

    parsed_result = urllib.parse.urlparse(log_info.logs)

    if regexes:
        compiled_regexes = []
        for regex in regexes:
            try:
                compiled_regexes.append(re.compile(regex))
            except re.error as _:
                raise osmo_errors.OSMOUserError(f'Invalid regex: {regex}')

    async def async_filter_log(log_generator: AsyncGenerator[str, None])\
        -> AsyncGenerator[str, None]:
        ''' Returns whether to send the log '''
        async for line in log_generator:
            if not regexes or \
                all(compiled_regex.search(line) for compiled_regex in compiled_regexes):
                yield line

    def filter_log(log_generator: storage.LinesStream) -> Generator[str, None, None]:
        ''' Returns whether to send the log '''
        for line in log_generator:
            if not regexes or \
                all(compiled_regex.search(line) for compiled_regex in compiled_regexes):
                yield line

    if parsed_result.scheme in ('redis', 'rediss') and not download:
        response = fastapi.responses.StreamingResponse(
            async_filter_log(
                connectors.redis_log_formatter(log_info.logs, redis_name, last_n_lines)))
    else:
        response = fastapi.responses.StreamingResponse(
            filter_log(
                helpers.get_workflow_file(
                    file_name, name, storage_client, last_n_lines)))

    # Disable browser buffering
    response.headers['Content-type'] = 'text/plain; charset=us-ascii'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@router.get('/api/workflow/{name}/logs', response_class=fastapi.responses.PlainTextResponse)
def get_workflow_logs(name: str,
                      last_n_lines: Optional[int] = None,
                      task_name: Optional[str] = None,
                      retry_id: Optional[int] = None,
                      query: Optional[str] = None) -> Any:
    """ Returns the workflow logs. """
    context = objects.WorkflowServiceContext.get()
    regexes = []
    if query:
        regexes.append(query)
    redis_name = f'{name}-logs'
    file_name = common.WORKFLOW_LOGS_FILE_NAME
    workflow_config = context.database.get_workflow_configs()

    if workflow_config.workflow_log.credential is None:
        raise osmo_errors.OSMOServerError('Workflow log credential is not set')

    storage_client = storage.Client.create(
        data_credential=workflow_config.workflow_log.credential,
    )
    if task_name:
        task_obj = task.Task.fetch_from_db(context.database, name, task_name)
        if retry_id is None:
            retry_id = task_obj.retry_id if task_obj.retry_id else 0
        redis_name = common.get_redis_task_log_name(name, task_name, retry_id)
        task_log_file = common.get_task_log_file_name(task_obj.name, retry_id)

        if helpers.workflow_file_exists(name, task_log_file, storage_client):
            file_name = task_log_file
        else:
            # Fall back to using regex to filter task logs if task log file doesn't exist
            if retry_id > 0:
                regexes.append(fr'^[^ ]+ [^ ]+ \[{task_name} retry-{retry_id}\]')
            else:
                regexes.append(fr'^[^ ]+ [^ ]+ \[{task_name}\]')
    return get_file_info(name, redis_name, file_name,
                         last_n_lines=last_n_lines,
                         storage_client=storage_client,
                         regexes=regexes)


@router.get('/api/workflow/{name}/events', response_class=fastapi.responses.PlainTextResponse)
def get_workflow_pod_conditions(name: str,
                                task_name: Optional[str] = None,
                                retry_id: Optional[int] = None) -> Any:
    """ Returns the workflow pod conditions. """
    context = objects.WorkflowServiceContext.get()
    workflow_config = context.database.get_workflow_configs()
    if workflow_config.workflow_log.credential is None:
        raise osmo_errors.OSMOServerError('Workflow log credential is not set')

    storage_client = storage.Client.create(
        data_credential=workflow_config.workflow_log.credential,
    )
    workflow_uuid = get_workflow(name, skip_groups=True).uuid
    regexes = []
    if task_name:
        # Verify task exists
        task_obj = task.Task.fetch_from_db(context.database, name, task_name)
        if retry_id is None:
            retry_id = task_obj.retry_id if task_obj.retry_id else 0
        if retry_id > 0:
            regexes.append(fr'^[^ ]+ [^ ]+ \[{task_name} retry-{retry_id}\]')
        else:
            regexes.append(fr'^[^ ]+ [^ ]+ \[{task_name}\]')
    return get_file_info(name, common.get_workflow_events_redis_name(workflow_uuid),
                         common.WORKFLOW_EVENTS_FILE_NAME,
                         storage_client=storage_client,
                         regexes=regexes)


@router.get('/api/workflow/{name}/error_logs', response_class=fastapi.responses.PlainTextResponse)
def get_workflow_error_logs(name: str,
                            last_n_lines: Optional[int] = None,
                            task_name: Optional[str] = None,
                            retry_id: Optional[int] = None,
                            query: Optional[str] = None) -> Any:
    """ Returns the workflow error logs. """
    if not task_name:
        msg = 'Specify task for error logs.\n\n'
        workflow_obj = get_workflow(name, verbose=True)
        log_table = {f'{t.name} retry-{t.retry_id}': \
            t.error_logs for g in workflow_obj.groups for t in g.tasks}
        return msg + json.dumps(log_table, indent=4)

    context = objects.WorkflowServiceContext.get()
    workflow_config = context.database.get_workflow_configs()
    if workflow_config.workflow_log.credential is None:
        raise osmo_errors.OSMOServerError('Workflow log credential is not set')

    storage_client = storage.Client.create(
        data_credential=workflow_config.workflow_log.credential,
    )
    task_obj = task.Task.fetch_from_db(context.database, name, task_name)
    if retry_id is None:
        retry_id = task_obj.retry_id

    regexes = []
    if query:
        regexes.append(query)

    if helpers.workflow_file_exists(
        name, common.OLD_WORKFLOW_ERROR_LOGS_FILE_NAME, storage_client):
        file_name = common.OLD_WORKFLOW_ERROR_LOGS_FILE_NAME
    elif retry_id == 0:  # To fetch old logs without retry id
        file_name = f'{task_name}{common.ERROR_LOGS_SUFFIX_FILE_NAME}'
    else:
        file_name = f'{task_name}_{retry_id}{common.ERROR_LOGS_SUFFIX_FILE_NAME}'
    return get_file_info(name, '', file_name,
                         storage_client=storage_client,
                         download=True,
                         last_n_lines=last_n_lines, regexes=regexes)


def download_workflow_spec(workflow_id: str, use_template: bool = False):
    """ Returns the workflow spec generator. """
    # Directly get workflow_spec.yaml from cloud storage, because it is never stored in Redis
    context = objects.WorkflowServiceContext.get()
    workflow_config = context.database.get_workflow_configs()
    if workflow_config.workflow_log.credential is None:
        raise osmo_errors.OSMOServerError('Workflow log credential is not set')

    storage_client = storage.Client.create(
        data_credential=workflow_config.workflow_log.credential,
    )
    previous_workflow = get_workflow(workflow_id)
    filename = common.TEMPLATED_WORKFLOW_SPEC_FILE_NAME if use_template\
        else common.WORKFLOW_SPEC_FILE_NAME
    return helpers.get_workflow_file(
        filename, previous_workflow.name, storage_client)


@router.get('/api/workflow/{name}/spec', response_class=fastapi.responses.PlainTextResponse)
def get_workflow_spec(name: str, use_template: bool = False) -> Any:
    """ Returns the workflow spec. """
    return fastapi.responses.StreamingResponse(download_workflow_spec(name, use_template))


@router.post('/api/workflow/{name}/tag')
def tag_workflow(name: str,
                 add: List[str] | None = fastapi.Query(default = None),
                 remove: List[str] | None = fastapi.Query(default = None)):
    """ Returns the workflow spec. """
    if not add and not remove:
        raise osmo_errors.OSMOUserError('No tags specified!')
    # Validate Workflow exists
    get_workflow(name)
    helpers.set_workflow_tags(name, add, remove)


@router_resource.get('/api/resources', response_class=common.PrettyJSONResponse)
def get_resources(pools: List[str] | None = fastapi.Query(default = None),
                  platforms: List[str] | None = fastapi.Query(default = None),
                  all_pools: bool = False,
                  concise: bool = False,
                  roles_header: Optional[str] =
                    fastapi.Header(alias=login.OSMO_USER_ROLES, default=None)) -> \
    objects.ResourcesResponse | objects.PoolResourcesResponse:
    """ Returns the information of resources available in different pools. """
    pools_arg = pools if pools else []
    if not pools or all_pools:
        pools_arg = connectors.Pool.get_pools(login.construct_roles_list(roles_header),
                                              all_pools=all_pools)

    if not concise:
        return objects.get_resources(
            pools=pools_arg, platforms=(platforms if pools and platforms else None))

    return helpers.get_pool_resources(
        pools=pools_arg, platforms=(platforms if pools and platforms else None))


@router_resource.get('/api/resources/{name}', response_class=common.PrettyJSONResponse)
def get_one_resource(name: str) -> objects.ResourcesResponse:
    """ Returns the request resource's information. """
    result = objects.get_resources(resource_name=name)
    if len(result.resources) == 0:
        raise osmo_errors.OSMONotFoundError(f'Resource {name} does not exist!')
    return result


@router_credentials.get('/api/credentials', response_class=common.PrettyJSONResponse)
def get_user_credential(
    user_header: Optional[str] =
        fastapi.Header(alias=login.OSMO_USER_HEADER, default=None)) \
            -> objects.CredentialGetResponse:
    """ Get default/all user credentials """
    user_name = connectors.parse_username(user_header)
    context = objects.WorkflowServiceContext.get()
    select_cmd = '''
        SELECT * FROM credential WHERE user_name = %s
        ORDER BY cred_type DESC, cred_name
    '''
    rows = context.database.execute_fetch_command(select_cmd, (user_name,))
    return objects.CredentialGetResponse(credentials=objects.UserCredential.from_db_row(rows))


@router_credentials.post('/api/credentials/{cred_name}')
def set_user_credential(
    cred_name: str,
    credential_option: objects.CredentialOptions,
    user_header: Optional[str] =
        fastapi.Header(alias=login.OSMO_USER_HEADER, default=None)):
    """ Post/Update user credentials """
    if not re.fullmatch(credentials.CREDNAMEREGEX, cred_name):
        raise osmo_errors.OSMOUserError(
            f'Invalid name: {cred_name}. Follow regex: {credentials.CREDNAMEREGEX}')
    user_name = connectors.parse_username(user_header)
    context = objects.WorkflowServiceContext.get()
    cmd = 'SELECT * FROM ueks WHERE uid = %s'
    rows = context.database.execute_fetch_command(cmd, (user_name,))
    if not rows:
        context.database.secret_manager.add_new_user(user_name)

    credential = credential_option.get_credential()
    workflow_config = context.database.get_workflow_configs()
    credential.valid_cred(workflow_config)
    try:
        cmd_arg = credential.to_db_row(user_name, context.database)
        context.database.execute_commit_command(objects.UserCredential.commit_cmd(),
                                                tuple([user_name, cred_name]) + cmd_arg)
        logging.info('Saved credential %s on the server.', cred_name)
    except osmo_errors.OSMODatabaseError as err:
        raise osmo_errors.OSMOUserError(err.message.split(':', 1)[1])


@router_credentials.delete('/api/credentials/{cred_name}')
def delete_users_credential(cred_name: str,
                            user_header: Optional[str] =
                            fastapi.Header(alias=login.OSMO_USER_HEADER, default=None)) \
                            -> objects.CredentialGetResponse:
    """ Delete user credentials given the secret_id """
    if not re.fullmatch(credentials.CREDNAMEREGEX, cred_name):
        raise osmo_errors.OSMOUserError(
            f'Invalid name: {cred_name}. Follow regex: {credentials.CREDNAMEREGEX}')
    user_name = connectors.parse_username(user_header)
    context = objects.WorkflowServiceContext.get()
    delete_cmd = '''DELETE FROM credential
                    WHERE user_name = %s AND cred_name = %s;'''
    try:
        select_data_cmd = connectors.PostgresSelectCommand(
        table='credential',
        conditions=['user_name = %s', 'cred_name = %s'],
        condition_args=[user_name, cred_name])
        rows = context.database.execute_fetch_command(*select_data_cmd.get_args())

        if not rows:
            raise osmo_errors.OSMOUserError(f'Credential {cred_name} does not exits')
        context.database.execute_commit_command(delete_cmd, (user_name, cred_name))
        logging.info('Deleted credential %s on the server.', cred_name)
        return objects.CredentialGetResponse(
            credentials=objects.UserCredential.from_db_row(rows))

    except osmo_errors.OSMODatabaseError as err:
        raise osmo_errors.OSMOUserError(err.message.split(':', 1)[1])


def action_request_helper(action_type: ActionType, payload: Dict[str, Any], name: str,
                          task_name: str | None = None, group_name: str | None = None,
                          cached_workflow_response: objects.WorkflowQueryResponse | None = None) \
                            -> Dict[str, objects.RouterResponse]:
    """ Helper function that implements support for exec and portforward. """
    workflow_result = cached_workflow_response or get_workflow(name)
    workflow_id = workflow_result.name

    if not workflow_result.backend:
        raise osmo_errors.OSMONotFoundError(
            f'Workflow {workflow_id} has no backend!',
            workflow_id=workflow_id,
            status_code=http.HTTPStatus.UNPROCESSABLE_ENTITY.value,
        )
    if workflow_result.status.finished():
        raise osmo_errors.OSMOUserError(
            f'Workflow {workflow_id} is not running!',
            workflow_id=workflow_id,
            status_code=http.HTTPStatus.GONE.value,
        )
    if workflow_result.status != workflow.WorkflowStatus.RUNNING:
        raise osmo_errors.OSMOUserError(
            f'Workflow {workflow_id} is not running yet...',
            workflow_id=workflow_id,
            status_code=http.HTTPStatus.TOO_EARLY.value,
        )

    context = objects.WorkflowServiceContext.get()
    backend_config = connectors.Backend.fetch_from_db(context.database, workflow_result.backend)
    router_address = backend_config.router_address
    if not router_address:
        raise osmo_errors.OSMONotFoundError(
            f'Backend {workflow_result.backend} has no router!',
            workflow_id=workflow_id,
            status_code=http.HTTPStatus.UNPROCESSABLE_ENTITY.value,
        )

    tasks: List[objects.TaskQueryResponse] = []
    if task_name:
        # Single task
        tasks.append(helpers.get_running_task(workflow_result, task_name))
    elif group_name:
        # All tasks in a group
        tasks.extend(helpers.get_running_tasks_from_group(workflow_result, group_name))
    else:
        # All tasks in the workflow
        tasks.extend(helpers.get_running_tasks_from_workflow(workflow_result))

    redis_client = connectors.RedisConnector.get_instance().client
    total_timeout = job_common.calculate_total_timeout(
        workflow_id, workflow_result.queue_timeout, workflow_result.exec_timeout)
    cookie = helpers.get_router_cookie(router_address)

    router_infos = {}
    for task_obj in tasks:  # type: ignore
        key = f'{action_type.name}-{common.generate_unique_id()}'
        router_info = objects.RouterResponse(router_address=router_address, key=key, cookie=cookie)
        router_infos[task_obj.name] = router_info
        action_attributes: Dict[str, Any] = {
            'action': action_type.value, **router_info.dict(), **payload}

        # Create redis object
        redis_client.set(key, json.dumps(action_attributes))
        redis_client.expire(key, total_timeout, nx=True)

        # Store redis object
        queue_name = workflow.action_queue_name(workflow_id, task_obj.name, task_obj.retry_id)
        logging.info('Send action key %s to queue %s', key, queue_name)
        redis_client.lpush(queue_name, key)
        redis_client.expire(queue_name, total_timeout, nx=True)

    return router_infos


@router.post('/api/workflow/{name}/exec/group/{group_name}')
def exec_into_group(name: str, group_name: str, entry_command: str) -> \
        Dict[str, objects.RouterResponse]:
    """ Send command to all tasks in a group. """
    workflow_response = get_workflow(name)
    payload = {'entry_command': entry_command}
    return action_request_helper(ActionType.EXEC, payload, name, group_name=group_name,
                                 cached_workflow_response=workflow_response)


@router.post('/api/workflow/{name}/exec/task/{task_name}')
def exec_into_task(name: str, task_name: str, entry_command: str) -> \
        objects.RouterResponse:
    """ Exec into a task container. """
    workflow_response = get_workflow(name)
    payload = {'entry_command': entry_command}
    return action_request_helper(ActionType.EXEC, payload, name, task_name=task_name,
                                 cached_workflow_response=workflow_response)[task_name]


@router.post('/api/workflow/{name}/portforward/{task_name}')
def port_forward_task(name: str, task_name: str,
                      task_ports: List[int] | None = fastapi.Query(default=None),
                      use_udp: bool = False) -> \
        List[objects.RouterResponse] | objects.RouterResponse:
    """ Portforward into a task container. """
    workflow_response = get_workflow(name)

    if not task_ports:
        raise osmo_errors.OSMOUserError('No port is provided!')

    context = objects.WorkflowServiceContext.get()
    workflow_config = context.database.get_workflow_configs()
    if len(task_ports) > workflow_config.max_num_ports_per_task:
        raise osmo_errors.OSMOUserError(
            f'Number of ports to portforward ({len(task_ports)}) '
            f'exceeds the maximum number of ports per call'
            f'({workflow_config.max_num_ports_per_task})!')

    router_infos = []
    for port in task_ports:
        payload = {'task_port': port, 'use_udp': use_udp}
        router_infos.append(action_request_helper(
            ActionType.PORTFORWARD, payload, name, task_name=task_name,
            cached_workflow_response=workflow_response)[task_name])

    return router_infos


@router.post('/api/workflow/{name}/webserver/{task_name}')
def port_forward_webserver(name: str, task_name: str, task_port: int) -> \
        objects.RouterResponse:
    """ Hold a webserver connection to a task container. """
    workflow_response = get_workflow(name)
    payload = {'task_port': task_port}
    return action_request_helper(
        ActionType.WEBSERVER, payload, name, task_name=task_name,
        cached_workflow_response=workflow_response)[task_name]


@router.post('/api/workflow/{name}/rsync/task/{task_name}')
def rsync_task(name: str, task_name: str) -> \
        objects.RouterResponse:
    """ Rsync into a task container. """
    workflow_response = get_workflow(name)

    if not workflow_response.plugins.rsync:
        raise osmo_errors.OSMOUserError(
            'Rsync is not enabled for this workflow!',
            workflow_id=name,
            status_code=http.HTTPStatus.FORBIDDEN.value,
        )

    context = objects.WorkflowServiceContext.get()
    workflow_config = context.database.get_workflow_configs()
    enable_telemetry = workflow_config.plugins_config.rsync.enable_telemetry

    return action_request_helper(
        ActionType.RSYNC,
        {'enable_telemetry': enable_telemetry},
        name,
        task_name=task_name,
        cached_workflow_response=workflow_response,
    )[task_name]
