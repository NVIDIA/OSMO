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

import logging
from pathlib import Path
import sys
from typing import Dict, List
from urllib.parse import urlparse

import fastapi
import fastapi.middleware.cors
import fastapi.responses
import uvicorn  # type: ignore
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor # type: ignore

from src.lib.utils import common, osmo_errors, version
import src.lib.utils.logging
from src.utils.metrics import metrics
from src.service.agent import helpers as backend_helpers
from src.service.core.app import app_service
from src.service.core.auth import auth_service
from src.service.core.config import (
    config_service, helpers as config_helpers, objects as config_objects
)
from src.service.core.data import data_service, query
from src.service.core.profile import profile_service
from src.service.core.workflow import (
    helpers, objects, workflow_service, workflow_metrics
)
from src.service.logger import ctrl_websocket
from src.utils import auth, connectors


app = fastapi.FastAPI(docs_url='/api/docs', redoc_url=None, openapi_url='/api/openapi.json')
misc_router = fastapi.APIRouter(tags = ['Misc API'])
curr_cli_config = connectors.CliConfig()


@app.middleware('http')
async def check_client_version(request: fastapi.Request, call_next):
    client_version_str = request.headers.get(version.VERSION_HEADER)
    if client_version_str is None:
        return await call_next(request)
    client_version = version.Version.from_string(client_version_str)
    path = Path(request.url.path).parts
    if path[1] in ('/client'):
        return await call_next(request)
    suggest_version_update = False
    postgres = objects.WorkflowServiceContext.get().database
    service_url = postgres.get_workflow_service_url()
    cli_info = postgres.get_service_configs().cli_config
    newest_client_version = version.Version.from_string(cli_info.latest_version) \
        if cli_info.latest_version else version.VERSION
    if client_version < newest_client_version:
        # If no min_supported_version specified, we allow all client versions
        if cli_info.min_supported_version and\
                client_version < version.Version.from_string(cli_info.min_supported_version):
            return fastapi.responses.JSONResponse(
                status_code=400,
                content={'message': 'Your client is out of date. Client version is ' + \
                        f'{client_version_str} but the newest client version is '
                        f'{newest_client_version}. Please run the following command:\n'
                        f'curl -fsSL {service_url}/client/install.sh | bash',
                        'error_code': osmo_errors.OSMOError.error_code},
            )
        suggest_version_update = True
    response = await call_next(request)
    if suggest_version_update:
        response.headers[version.SERVICE_VERSION_HEADER] = str(newest_client_version)
    return response


app.include_router(config_service.router)
app.include_router(auth_service.router)
app.include_router(app_service.router)
app.include_router(workflow_service.router)
app.include_router(workflow_service.router_credentials)
app.include_router(workflow_service.router_resource)
app.include_router(workflow_service.router_pool)
app.include_router(data_service.router)
app.include_router(profile_service.router)


@misc_router.get('/client/version')
async def get_osmo_client_version(request: fastapi.Request):
    postgres = connectors.PostgresConnector.get_instance()
    service_configs = postgres.get_service_configs()
    cli_config = service_configs.cli_config

    # Defaults to service version if client version is not configured
    client_version = version.VERSION if not cli_config.latest_version \
        else version.Version.from_string(cli_config.latest_version)

    accept_header = request.headers.get('accept', '')
    if 'text/plain' in accept_header:
        return fastapi.responses.Response(content=str(client_version),
                                          media_type='text/plain')
    return client_version


@misc_router.get('/health')
async def health():
    """ To be used for the readiness probe, but not liveness probe. That way, if this method is
    slow, no new traffic gets routed, instead of killing the service. """
    return {'status': 'OK'}


@misc_router.get('/api/version')
def get_version():
    return version.VERSION


@misc_router.get('/api/users', response_class=common.PrettyJSONResponse)
def get_users() -> List[str]:
    """ Returns the values of all users who have submitted a workflow. """
    user_list = helpers.get_all_users()
    return [item.submitted_by for item in user_list]


@misc_router.get('/api/tag')
def get_available_workflow_tags():
    """ Returns all workflow tags. """
    context = objects.WorkflowServiceContext.get()
    return {'tags': context.database.get_workflow_configs().workflow_info.tags}


@misc_router.get('/api/plugins/configs', response_class=common.PrettyJSONResponse)
def get_workflow_plugins_configs() -> Dict:
    """Get all the workflow plugins configurations"""
    context = objects.WorkflowServiceContext.get()
    workflow_configs = context.database.get_workflow_configs()
    return workflow_configs.plugins_config.dict(by_alias=True)


app.include_router(misc_router)

@app.exception_handler(osmo_errors.OSMOUsageError)
@app.exception_handler(osmo_errors.OSMOResourceError)
@app.exception_handler(osmo_errors.OSMOCredentialError)
@app.exception_handler(osmo_errors.OSMODatabaseError)
@app.exception_handler(osmo_errors.OSMOUserError)
async def user_error_handler(request: fastapi.Request, error: osmo_errors.OSMOError):
    """ Returns user readable error responses. """
    # pylint: disable=unused-argument
    err_msg = {
        'message': str(error),
        'error_code': type(error).error_code,
        'workflow_id': error.workflow_id
    }
    logging.info(err_msg)
    return fastapi.responses.JSONResponse(
        status_code=error.status_code or 400,
        content=err_msg,
    )


@app.exception_handler(osmo_errors.OSMOBackendError)
@app.exception_handler(osmo_errors.OSMOServerError)
@app.exception_handler(Exception)
async def top_level_exception_handler(request: fastapi.Request, error: Exception):
    logging.exception('Got an exception of type %s on url path %s', type(error).__name__,
                      request.url.path)
    return fastapi.responses.JSONResponse(
        status_code=500,
        content={'message': f'Internal server error: {error}'}
    )


def create_default_pool(postgres: connectors.PostgresConnector):
    # Populate with default pod templates if no pod templates exist
    pod_templates = postgres.execute_fetch_command(
        'SELECT COUNT(*) as count from pod_templates', (), return_raw=True)
    if pod_templates[0]['count'] == 0:
        config_service.put_pod_templates(
            request=config_objects.PutPodTemplatesRequest(
                configs=config_objects.DEFAULT_POD_TEMPLATES,
            ),
            username='',
        )

    # Populate with default resource validation rules if no resource validation rules exist
    resource_validations = postgres.execute_fetch_command(
        'SELECT COUNT(*) as count from resource_validations', (), return_raw=True)
    if resource_validations[0]['count'] == 0:
        config_service.put_resource_validations(
            request=config_objects.PutResourceValidationsRequest(
                configs_dict=config_objects.DEFAULT_RESOURCE_CHECKS
            ),
            username='',
        )

    pools = postgres.execute_fetch_command(
        'SELECT COUNT(*) as count from pools', (), return_raw=True)
    if pools[0]['count'] == 0:
        default_pool = connectors.Pool(
            name='default',
            description='Default pool',
            # We expect admins to connect this default pool to a backend
            backend='default',
            platforms={'default': connectors.Platform()},
            default_platform='default',
            common_pod_template=list(config_objects.DEFAULT_POD_TEMPLATES.keys()),
            common_resource_validations=list(config_objects.DEFAULT_RESOURCE_CHECKS.keys()),
            common_default_variables=config_objects.DEFAULT_VARIABLES
        )
        config_service.put_pools(
            request=config_objects.PutPoolsRequest(
                configs={'default': default_pool},
            ),
            username='System',
        )


def set_default_backend_images(postgres: connectors.PostgresConnector):
    curr_workflow_configs = postgres.get_workflow_configs()

    # If backend_images are already set, do not override them
    if curr_workflow_configs.backend_images.init and \
        curr_workflow_configs.backend_images.client:
        return

    if postgres.config.osmo_image_location and \
        postgres.config.osmo_image_tag:
        # Override default backend_images with deployment values
        backend_images = connectors.OsmoImageConfig(
            init=f'{postgres.config.osmo_image_location}/'
                    f'init-container:{postgres.config.osmo_image_tag}',
            client=f'{postgres.config.osmo_image_location}/'
                    f'client:{postgres.config.osmo_image_tag}',
        )
        config_service.patch_workflow_configs(
            request=config_objects.PatchConfigRequest(
                configs_dict={
                    'backend_images': backend_images.dict()
                }
            ),
            username='System',
        )

        logging.info(
            'Using deployment values for backend_images: %s:%s',
            postgres.config.osmo_image_location,
            postgres.config.osmo_image_tag)


def set_default_service_url(postgres: connectors.PostgresConnector):
    curr_service_configs = postgres.get_service_configs()

    # If service_base_url is already set, do not override it
    if curr_service_configs.service_base_url:
        return

    if postgres.config.service_hostname:
        config_service.patch_service_configs(
            request=config_objects.PatchConfigRequest(
                configs_dict={
                    'service_base_url': f'https://{postgres.config.service_hostname}'
                }
            ),
            username='System',
        )

        logging.info(
            'Using deployment hostname for service_base_url: %s',
            postgres.config.service_hostname)


def configure_app(target_app: fastapi.FastAPI, config: objects.WorkflowServiceConfig):
    src.lib.utils.logging.init_logger('service', config)

    postgres = connectors.PostgresConnector(config)
    connectors.RedisConnector(config)
    api_service_metrics = metrics.MetricCreator(config=config).get_meter_instance()
    objects.WorkflowServiceContext.set(
        objects.WorkflowServiceContext(config=config, database=postgres))

    target_app.add_middleware(connectors.AccessControlMiddleware, method=config.method)

    service_configs_dict = postgres.get_service_configs()

    configs_dict = {}
    login_info = auth.LoginInfo(
        device_endpoint=config.device_endpoint,
        device_client_id=config.device_client_id,
        browser_endpoint=config.browser_endpoint,
        browser_client_id=config.browser_client_id,
        token_endpoint=config.token_endpoint,
        logout_endpoint=config.logout_endpoint,
    )
    if login_info != service_configs_dict.service_auth.login_info:
        configs_dict['service_auth'] = {
            'login_info': login_info.dict()
        }

    if configs_dict:
        config_helpers.patch_configs(
            request=config_objects.PatchConfigRequest(
                configs_dict=configs_dict,
                description='Updated service auth',
            ),
            config_type=connectors.ConfigType.SERVICE,
            username='',
        )

    create_default_pool(postgres)
    set_default_backend_images(postgres)
    set_default_service_url(postgres)

    # Instantiate QueryParser
    query.QueryParser()

    if config.method != 'dev':
        FastAPIInstrumentor().instrument_app(
            target_app,
            meter_provider=api_service_metrics.meter_provider
        )

        # Register task metrics after service is configured
        try:
            workflow_metrics.register_task_metrics()
            logging.info('Task metrics registered successfully')
        except (ValueError, AttributeError, TypeError) as err:
            logging.error('Failed to register task metrics: %s', str(err))
    else:
        target_app.add_api_websocket_route(
            '/api/logger/workflow/{name}/osmo_ctrl/{task_name}/retry_id/{retry_id}',
            endpoint=ctrl_websocket.run_websocket)
        target_app.add_api_websocket_route('/api/agent/listener/event/backend/{name}',
                                           endpoint=backend_helpers.backend_listener_impl)
        target_app.add_api_websocket_route('/api/agent/listener/node/backend/{name}',
                                           endpoint=backend_helpers.backend_listener_impl)
        target_app.add_api_websocket_route('/api/agent/listener/pod/backend/{name}',
                                           endpoint=backend_helpers.backend_listener_impl)
        target_app.add_api_websocket_route('/api/agent/listener/heartbeat/backend/{name}',
                                           endpoint=backend_helpers.backend_listener_impl)
        target_app.add_api_websocket_route('/api/agent/listener/control/backend/{name}',
                                           endpoint=backend_helpers.backend_listener_control_impl)
        target_app.add_api_websocket_route('/api/agent/worker/backend/{name}',
                                           endpoint=backend_helpers.backend_worker_impl)

        # Allow CORS requests
        target_app.add_middleware(
            fastapi.middleware.cors.CORSMiddleware,
            allow_origins=['*'],
            allow_credentials=True,
            allow_methods=['*'],
            allow_headers=['*']
        )

        config_service.create_clean_config_api(target_app)


def main():
    config = objects.WorkflowServiceConfig.load()
    configure_app(app, config)

    parsed_url = urlparse(config.host)
    host = parsed_url.hostname if parsed_url.hostname else ''
    if parsed_url.port:
        port = parsed_url.port
    else:
        port = 8000

    try:
        uvicorn.run(app, host=host, port=port)
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == '__main__':
    main()
