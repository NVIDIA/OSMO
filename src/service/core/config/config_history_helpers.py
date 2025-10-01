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

from typing import Any, Tuple

from src.lib.utils import config_history
from src.service.core.config import objects
from src.utils import connectors


def build_get_configs_history_query(
    params: objects.ConfigHistoryQueryParams,
) -> Tuple[str, Tuple]:
    """
    Build the query for getting config history

    Args:
        params: Query parameters for config history

    Returns:
        Tuple[str, Tuple]: A tuple containing the query and the query parameters
    """
    # Build query conditions
    query_conditions: list[str] = []
    query_params: Tuple = ()

    if params.config_types:
        if len(params.config_types) == 1:
            query_conditions.append('config_type = %s')
            query_params = query_params + \
                (params.config_types[0].value.lower(),)
        else:
            query_conditions.append('config_type = ANY(%s)')
            query_params = query_params + \
                ([t.value.lower() for t in params.config_types],)

    if params.name is not None:
        query_conditions.append('name = %s')
        query_params = query_params + (params.name,)

    if params.revision is not None:
        query_conditions.append('revision = %s')
        query_params = query_params + (params.revision,)

    if params.tags:
        query_conditions.append('tags @> %s')
        query_params = query_params + (params.tags,)

    if params.created_before is not None:
        query_conditions.append('created_at < %s')
        query_params = query_params + (params.created_before,)

    if params.created_after is not None:
        query_conditions.append('created_at > %s')
        query_params = query_params + (params.created_after,)

    # Build the SELECT clause based on omit_data parameter
    select_clause = 'config_type, name, revision, username, created_at, tags, description'
    if not params.omit_data:
        select_clause += ', data'

    if params.at_timestamp is not None:
        # If at_timestamp is provided, return the latest config active at that time for each
        # config_type/name
        where_clause = (
            ' AND '.join(query_conditions + ['created_at <= %s'])
            if query_conditions else 'created_at <= %s'
        )
        query_params = query_params + (params.at_timestamp,)
        query = f'''
            SELECT * FROM (
                SELECT DISTINCT ON (config_type)
                    {select_clause}
                FROM config_history
                WHERE {where_clause} AND deleted_at IS NULL
                ORDER BY config_type, created_at DESC
            ) AS ch
            ORDER BY created_at {params.order.value}
        '''
        return query, query_params

    where_clause = ' AND '.join(query_conditions) if query_conditions else 'TRUE'

    query = f'''
        SELECT * FROM (
            SELECT {select_clause}
            FROM config_history
            WHERE {where_clause} AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT {params.limit} OFFSET {params.offset}
        ) AS ch
        ORDER BY created_at {params.order.value}
    '''

    return query, query_params


def transform_config_data(postgres: connectors.PostgresConnector, config_type: str, data: Any):
    """
    Transform the config data for returning to the client with obfuscated credentials
    """
    if config_type == config_history.ConfigHistoryType.SERVICE.value.lower():
        return connectors.ServiceConfig.deserialize(data, postgres)
    elif config_type == config_history.ConfigHistoryType.WORKFLOW.value.lower():
        return connectors.WorkflowConfig.deserialize(data, postgres)
    elif config_type == config_history.ConfigHistoryType.DATASET.value.lower():
        return connectors.DatasetConfig.deserialize(data, postgres)
    elif config_type == config_history.ConfigHistoryType.ROLE.value.lower():
        return connectors.Role.parse_actions_as_strings(data)
    return data
