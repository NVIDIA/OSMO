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
import os
from pathlib import Path
import shutil
import sys
import threading
from typing import Dict, List
from urllib.parse import urlparse

import diskcache # type: ignore
import fastapi
import fastapi.middleware.cors
import fastapi.responses
import uvicorn  # type: ignore
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor # type: ignore

from src.lib.data import storage
from src.lib.utils import common, osmo_errors, version
import src.lib.utils.logging
from src.utils.metrics import metrics
from src.service.agent import helpers as backend_helpers
from src.service.core import install_script_loader
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


PYPI_CACHE_DIR = '/tmp/osmo/client/pypi'
PYPI_CACHE_MAX_SIZE = 512 * 1024 * 1024 # 512MB
PYPI_S3_PATH = 'pypi/simple/nvidia-osmo/'

CLI_STORAGE_PATH = '/tmp/osmo/client/cli'
LINUX_CLI_NAME = 'osmo-client-linux.tgz'
TEMP_LINUX_FOLDER = 'linux-temp'
MACOS_CLI_NAME = 'osmo-client-macos.pkg'
TEMP_MACOS_FOLDER = 'macos-temp'


app = fastapi.FastAPI(docs_url='/api/docs', redoc_url=None, openapi_url='/api/openapi.json')
misc_router = fastapi.APIRouter(tags = ['Misc API'])
curr_cli_config = connectors.CliConfig()
cli_lock = threading.Lock()
pypi_cache = diskcache.Cache(PYPI_CACHE_DIR, size_limit=PYPI_CACHE_MAX_SIZE)


def download_cli(cli_config: connectors.CliConfig):
    """
    Set up S3 auth and parameters and download the CLI.
    """
    cli_version = cli_config.cli_name
    if not cli_version or cli_version == 'null':
        cli_version = str(version.VERSION)

    if cli_config.credential is None:
        raise osmo_errors.OSMOServerError('CLI config credential is not set')

    storage_client = storage.Client.create(
        data_credential=cli_config.credential,
    )

    if not os.path.isdir(CLI_STORAGE_PATH):
        os.makedirs(CLI_STORAGE_PATH)

    linux_client_name = f'osmo-client-linux_{cli_version}.tgz'
    macos_client_name = f'osmo-client-macos_{cli_version}.pkg'
    linux_remote_path = os.path.join(
        cli_config.credential.endpoint,
        linux_client_name
    )
    macos_remote_path = os.path.join(
        cli_config.credential.endpoint,
        macos_client_name
    )

    # Download both Linux and macOS CLI
    storage_client.download_objects(
        destination=CLI_STORAGE_PATH,
        source=[linux_remote_path, macos_remote_path],
        resume=False,
    )

    linux_dst_path = os.path.join(CLI_STORAGE_PATH, LINUX_CLI_NAME)
    macos_dst_path = os.path.join(CLI_STORAGE_PATH, MACOS_CLI_NAME)
    shutil.move(os.path.join(CLI_STORAGE_PATH, linux_client_name), linux_dst_path)
    shutil.move(os.path.join(CLI_STORAGE_PATH, macos_client_name), macos_dst_path)


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
    newest_client_version = version.Version.from_string(cli_info.cli_name) \
        if cli_info.cli_name else version.VERSION
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

@misc_router.get('/client/osmo_client', include_in_schema=False)
def get_osmo_client(
        os_type: install_script_loader.CliOSType = install_script_loader.CliOSType.LINUX):
    global curr_cli_config
    postgres = connectors.PostgresConnector.get_instance()
    service_configs = postgres.get_service_configs()
    with cli_lock:
        cli_path = f'{CLI_STORAGE_PATH}/{MACOS_CLI_NAME}' \
            if os_type == install_script_loader.CliOSType.MACOS else \
            f'{CLI_STORAGE_PATH}/{LINUX_CLI_NAME}'

        if service_configs.cli_config != curr_cli_config or not os.path.exists(cli_path):
            try:
                download_cli(service_configs.cli_config)
                curr_cli_config = service_configs.cli_config
            except (osmo_errors.OSMOError, FileNotFoundError) as e:
                raise osmo_errors.OSMOServerError(
                    'Server is unable to pull the newest clients, please '
                    'contact the admins to resolve the issue.') from e
        return fastapi.responses.FileResponse(cli_path)


@misc_router.get('/client/install.sh', include_in_schema=False)
async def get_script(request: fastapi.Request):
    """ Returns the install script. """
    rendered_script = install_script_loader.render_install_script(
        str(request.base_url))

    return fastapi.responses.Response(content=rendered_script,
                                      media_type='text/x-shellscript')


@misc_router.get('/client/version')
async def get_osmo_client_version(request: fastapi.Request):
    postgres = connectors.PostgresConnector.get_instance()
    service_configs = postgres.get_service_configs()
    cli_config = service_configs.cli_config

    # Defaults to service version if client version is not configured
    client_version = version.VERSION if not cli_config.cli_name \
        else version.Version.from_string(cli_config.cli_name)

    accept_header = request.headers.get('accept', '')
    if 'text/plain' in accept_header:
        return fastapi.responses.Response(content=str(client_version),
                                          media_type='text/plain')
    return client_version


@misc_router.get('/client/pypi/simple')
async def get_python_package_index():
    index_html = '''<!DOCTYPE html>
<html>
    <head>
        <meta name="pypi:repository-version" content="1.0">
        <title>NVIDIA OSMO Python Package Index</title>
    </head>
    <body>
        <h1>Simple index</h1>
        <a href="/client/pypi/simple/nvidia-osmo/">nvidia-osmo</a>
    </body>
</html>'''
    return fastapi.responses.HTMLResponse(
        content=index_html,
        headers={'Content-Type': 'text/html; charset=utf-8'},
    )


@misc_router.get('/client/pypi/simple/nvidia-osmo/')
def get_library_package():
    postgres = connectors.PostgresConnector.get_instance()
    service_configs = postgres.get_service_configs()
    cli_config = service_configs.cli_config

    storage_client = storage.Client.create(
        data_credential=cli_config.credential,
    )

    obj_gen = storage_client.list_objects(
        prefix=PYPI_S3_PATH,
        regex='.*whl$',
        recursive=False,
    )

    package_links = []
    for obj in obj_gen:
        package_name = os.path.basename(obj.key)
        if package_name and package_name.endswith('.whl'):
            link = f'/client/pypi/simple/nvidia-osmo/{package_name}'
            package_links.append(f'<a href="{link}">{package_name}</a>')
    links_html = '\n'.join(package_links)

    index_html = f'''<!DOCTYPE html>
<html>
    <head>
        <meta name="pypi:repository-version" content="1.0">
        <title>Links for nvidia-osmo</title>
    </head>
    <body>
        <h1>Links for nvidia-osmo</h1>
        {links_html}
    </body>
</html>'''
    return fastapi.responses.HTMLResponse(
        content=index_html,
        headers={'Content-Type': 'text/html; charset=utf-8'},
    )


@misc_router.get('/client/pypi/simple/nvidia-osmo')
async def get_library_package_redirect():
    return fastapi.responses.RedirectResponse(url='/client/pypi/simple/nvidia-osmo/')


@misc_router.get('/client/pypi/simple/nvidia-osmo/{package_name}')
def get_library_package_version(package_name: str):
    if package_name in pypi_cache:
        # Previously cached package
        return fastapi.responses.Response(
            pypi_cache[package_name],
            media_type='application/wheel+zip',
        )

    postgres = connectors.PostgresConnector.get_instance()
    service_configs = postgres.get_service_configs()
    cli_config = service_configs.cli_config

    storage_client = storage.Client.create(
        data_credential=cli_config.credential,
    )

    remote_path = os.path.join(PYPI_S3_PATH, package_name)

    # Get file from cloud storage and write into cache
    streaming_body = storage_client.get_object_stream(remote_path)
    package_data = b''.join(streaming_body)
    pypi_cache[package_name] = package_data

    return fastapi.responses.Response(
        package_data,
        media_type='application/wheel+zip',
    )


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
            username='',
        )


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
