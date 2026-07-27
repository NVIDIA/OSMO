"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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

from src.utils import ssl_init  # noqa: F401  # pylint: disable=unused-import,ungrouped-imports,wrong-import-position

import base64
import datetime
import logging
from pathlib import Path
import sys
from typing import Dict, List
from urllib.parse import urlparse

import fastapi
import fastapi.middleware.cors
import fastapi.responses
import pydantic
import uvicorn  # type: ignore
import yaml
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor  # type: ignore

from src.lib.utils import common, login, osmo_errors, version
import src.lib.utils.logging
from src.utils.metrics import metrics
from src.service.agent import helpers as backend_helpers
from src.service.core.app import app_service
from src.service.core.auth import auth_service, objects as auth_objects
from src.service.core.config import (
    config_service, configmap_loader,
    helpers as config_helpers, objects as config_objects,
)
from src.service.core.profile import profile_service
from src.service.core.workflow import (
    helpers, objects, workflow_service, workflow_metrics
)
from src.service.logger import ctrl_websocket
from src.utils import auth, connectors
from src.utils.job import task as task_lib


app = fastapi.FastAPI(docs_url='/api/docs', redoc_url=None, openapi_url='/api/openapi.json')
misc_router = fastapi.APIRouter(tags=['Misc API'])
curr_cli_config = connectors.CliConfig()


@app.middleware('http')
async def check_client_version(request: fastapi.Request, call_next):
    user_id = request.headers.get(login.OSMO_USER_HEADER, '')
    with src.lib.utils.logging.UserLogContext(user_id):
        response = await _check_client_version(request, call_next)
        logging.info(
            '%s %s -> %d',
            request.method, request.url.path, response.status_code,
            extra={'status_code': response.status_code},
        )
        return response


async def _check_client_version(request: fastapi.Request, call_next):
    client_version_str = request.headers.get(version.VERSION_HEADER)
    token_name = request.headers.get(login.OSMO_TOKEN_NAME_HEADER)
    if client_version_str is None:
        return await call_next(request)
    client_version = version.Version.from_string(client_version_str)
    path = Path(request.url.path).parts
    if path[1] in ('/client'):
        return await call_next(request)
    suggest_version_update = False
    postgres = objects.WorkflowServiceContext.get().database
    cli_info = postgres.get_service_configs().cli_config
    newest_client_version = version.Version.from_string(cli_info.latest_version) \
        if cli_info.latest_version else version.VERSION
    if cli_info.client_install_url:
        install_command = f'Please run the following command:\n' \
            f'curl -fsSL {cli_info.client_install_url} | bash'
    else:
        install_command = \
            'Please update by running the install command in the documentation.'
    if client_version < newest_client_version:
        # If no min_supported_version specified, we allow all client versions
        if cli_info.min_supported_version and\
                client_version < version.Version.from_string(cli_info.min_supported_version):
            return fastapi.responses.JSONResponse(
                status_code=400,
                content={'message': 'Your client is out of date. Client version is ' +
                         f'{client_version_str} but the newest client version is '
                         f'{newest_client_version}.\n{install_command}',
                         'error_code': osmo_errors.OSMOError.error_code},
            )
        suggest_version_update = True

    warning_msg = ''
    if token_name:
        user_name = request.headers.get(login.OSMO_USER_HEADER)
        if user_name:
            try:
                token = auth_objects.AccessToken.fetch_from_db(
                    postgres, token_name, user_name)
                today = datetime.datetime.now(datetime.timezone.utc).date()
                expiry_date = token.expires_at.date()
                if expiry_date <= today:
                    return fastapi.responses.JSONResponse(
                        status_code=400,
                        content={
                            'message': f'Access token {token_name} has expired.',
                            'error_code': osmo_errors.OSMOError.error_code,
                        },
                    )
                days_until_expiry = (expiry_date - today).days
                if days_until_expiry <= 7:
                    token_warning = (
                        f'WARNING: Access token {token_name} is expiring '
                        f'on {expiry_date} at 12AM UTC.')
                    if warning_msg:
                        warning_msg += f'\n{token_warning}'
                    else:
                        warning_msg = token_warning
            except osmo_errors.OSMOUserError:
                logging.warning('Failed to fetch access token for user %s and token %s',
                                user_name, token_name)
                pass

    response = await call_next(request)

    if suggest_version_update:
        response.headers[version.SERVICE_VERSION_HEADER] = str(newest_client_version)
        version_warning = (
            f'WARNING: New client {newest_client_version} available.\n'
            f'Current version: {client_version_str}.\n'
            f'{install_command}')
        if warning_msg:
            warning_msg = f'{version_warning}\n{warning_msg}'
        else:
            warning_msg = version_warning
    if warning_msg:
        response.headers[version.WARNING_HEADER] = (
            base64.b64encode(warning_msg.encode()).decode())
    return response


app.include_router(config_service.router)
app.include_router(auth_service.router)
app.include_router(app_service.router)
app.include_router(workflow_service.router)
app.include_router(workflow_service.router_credentials)
app.include_router(workflow_service.router_resource)
app.include_router(workflow_service.router_pool)
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


@misc_router.get('/health', response_model=Dict[str, str])
async def health():
    """ To be used for the readiness probe, but not liveness probe. That way, if this method is
    slow, no new traffic gets routed, instead of killing the service. """
    return {'status': 'OK'}


@misc_router.get('/api/version', response_model=version.Version)
def get_version():
    return version.VERSION


@misc_router.get(
    '/api/users',
    response_model=List[str],
)
def get_users() -> List[str]:
    """ Returns the values of all users who have submitted a workflow. """
    user_list = helpers.get_all_users()
    return [item.submitted_by for item in user_list]


@misc_router.get('/api/tag', response_model=Dict[str, List[str]])
def get_available_workflow_tags():
    """ Returns all workflow tags. """
    context = objects.WorkflowServiceContext.get()
    return {'tags': context.database.get_workflow_configs().workflow_info.tags}


@misc_router.get(
    '/api/plugins/configs',
    response_model=connectors.PluginsConfig,
)
def get_workflow_plugins_configs() -> connectors.PluginsConfig:
    """Get all the workflow plugins configurations"""
    context = objects.WorkflowServiceContext.get()
    workflow_configs = context.database.get_workflow_configs()
    return workflow_configs.plugins_config


app.include_router(misc_router)


@app.exception_handler(osmo_errors.OSMOUsageError)
@app.exception_handler(osmo_errors.OSMOResourceError)
@app.exception_handler(osmo_errors.OSMOCredentialError)
@app.exception_handler(osmo_errors.OSMODatabaseError)
@app.exception_handler(osmo_errors.OSMOUserError)
@app.exception_handler(osmo_errors.OSMOSubmissionError)
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


@app.exception_handler(osmo_errors.OSMODataStorageError)
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
                    'backend_images': backend_images.model_dump()
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


def set_client_install_url(postgres: connectors.PostgresConnector,
                           config: objects.WorkflowServiceConfig):
    curr_service_configs = postgres.get_service_configs()
    if curr_service_configs.cli_config.client_install_url != config.client_install_url:
        updated_cli_config = curr_service_configs.cli_config.model_dump()
        updated_cli_config['client_install_url'] = config.client_install_url
        config_service.patch_service_configs(
            request=config_objects.PatchConfigRequest(
                configs_dict={'cli_config': updated_cli_config}
            ),
            username='System',
        )
        logging.info('Updated client_install_url to: %s', config.client_install_url)


def setup_bootstrap_principal(postgres: connectors.PostgresConnector,
                              principal: objects.BootstrapPrincipalSpec,
                              access_token: str):
    """Reconcile one bootstrap principal and its access token."""
    if len(access_token) != task_lib.REFRESH_TOKEN_STR_LENGTH:
        raise osmo_errors.OSMOUserError(
            f'Bootstrap token for {principal.username} must be '
            f'{task_lib.REFRESH_TOKEN_STR_LENGTH} characters long')

    logging.info('Reconciling bootstrap principal: %s', principal.username)

    connectors.upsert_user(postgres, principal.username)

    now = common.current_time()
    assign_role_cmd = '''
        INSERT INTO user_roles (user_id, role_name, assigned_by, assigned_at)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (user_id, role_name) DO NOTHING;
    '''
    for role in principal.roles:
        postgres.execute_commit_command(
            assign_role_cmd, (principal.username, role, 'System', now))

    check_token_cmd = '''
        SELECT
            at.access_token,
            COALESCE(
                ARRAY_AGG(ur.role_name ORDER BY ur.role_name)
                FILTER (WHERE ur.role_name IS NOT NULL),
                ARRAY[]::text[]
            ) AS roles
        FROM access_token at
        LEFT JOIN access_token_roles atr
            ON at.user_name = atr.user_name AND at.token_name = atr.token_name
        LEFT JOIN user_roles ur ON atr.user_role_id = ur.id
        WHERE at.user_name = %s AND at.token_name = %s
        GROUP BY at.access_token;
    '''
    existing_token = postgres.execute_fetch_command(
        check_token_cmd, (principal.username, principal.token_name), True)

    new_hashed_token = auth.hash_access_token(access_token)

    if existing_token:
        existing_hashed_token = bytes(existing_token[0]['access_token'])
        existing_roles = set(existing_token[0]['roles'])
        if existing_hashed_token == new_hashed_token and existing_roles == set(principal.roles):
            logging.info(
                'Bootstrap principal %s already matches the desired state',
                principal.username)
            return

        logging.info('Updating bootstrap token for principal %s', principal.username)
        delete_token_cmd = '''
            DELETE FROM access_token
            WHERE token_name = %s AND user_name = %s;
        '''
        postgres.execute_commit_command(
            delete_token_cmd, (principal.token_name, principal.username))

    expires_at = (
        datetime.datetime.now() +
        datetime.timedelta(days=principal.expires_in_days)
    ).strftime('%Y-%m-%d')

    try:
        auth_objects.AccessToken.insert_into_db(
            database=postgres,
            user_name=principal.username,
            token_name=principal.token_name,
            access_token=access_token,
            expires_at=expires_at,
            description=principal.description,
            roles=principal.roles,
            assigned_by='System'
        )
    except osmo_errors.OSMOUserError as error:
        # Multiple API replicas can reconcile the same principal concurrently.
        # A unique-key loser is successful only if the winner wrote the desired state.
        if 'already exists' not in str(error).lower():
            raise
        concurrent_token = postgres.execute_fetch_command(
            check_token_cmd, (principal.username, principal.token_name), True)
        if not concurrent_token:
            raise
        concurrent_hashed_token = bytes(concurrent_token[0]['access_token'])
        concurrent_roles = set(concurrent_token[0]['roles'])
        if (concurrent_hashed_token != new_hashed_token or
                concurrent_roles != set(principal.roles)):
            raise
        logging.info(
            'Bootstrap principal %s was reconciled by another service replica',
            principal.username)
        return

    logging.info('Bootstrap principal %s reconciled successfully', principal.username)


def setup_default_admin(postgres: connectors.PostgresConnector,
                        config: objects.WorkflowServiceConfig):
    """Set up the backward-compatible default admin user if configured."""
    if not config.default_admin_username or not config.default_admin_password:
        return

    setup_bootstrap_principal(
        postgres,
        objects.BootstrapPrincipalSpec(
            username=config.default_admin_username,
            token_name='default-admin-token',
            roles=['osmo-admin'],
            description='Default admin access_token created during service initialization',
        ),
        config.default_admin_password)


def setup_bootstrap_principals(postgres: connectors.PostgresConnector,
                               config: objects.WorkflowServiceConfig):
    """Load bootstrap principal metadata and tokens from mounted Kubernetes resources."""
    if not config.bootstrap_principals_file:
        return

    config_path = Path(config.bootstrap_principals_file)
    try:
        raw_config = yaml.safe_load(config_path.read_text(encoding='utf-8')) or {}
        principals_config = objects.BootstrapPrincipalsConfig.model_validate(raw_config)
    except (OSError, pydantic.ValidationError, yaml.YAMLError) as error:
        raise osmo_errors.OSMOUserError(
            f'Unable to load bootstrap principals from {config_path}: {error}') from error

    for principal in principals_config.principals:
        token_path = Path(principal.token_file)
        try:
            access_token = token_path.read_text(encoding='utf-8').strip()
        except OSError as error:
            raise osmo_errors.OSMOUserError(
                f'Unable to read bootstrap token for {principal.username} '
                f'from {token_path}: {error}') from error
        setup_bootstrap_principal(postgres, principal, access_token)


def configure_app(target_app: fastapi.FastAPI, config: objects.WorkflowServiceConfig):
    src.lib.utils.logging.init_logger('service', config)

    postgres = connectors.PostgresConnector(config)
    connectors.RedisConnector(config)
    api_service_metrics = metrics.MetricCreator(config=config).get_meter_instance()
    objects.WorkflowServiceContext.set(
        objects.WorkflowServiceContext(config=config, database=postgres))

    if not config.config_file:
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
                'login_info': login_info.model_dump()
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
        set_client_install_url(postgres, config)
        set_default_service_url(postgres)

    setup_default_admin(postgres, config)
    setup_bootstrap_principals(postgres, config)

    # Store on app state to prevent GC from killing the watcher thread.
    target_app.state.config_watcher = configmap_loader.start_config_watcher(
        config.config_file, postgres, is_api_service=True,
        backend_queue_updater=config_helpers.update_backend_queues_from_configmap,
        backend_test_updater=config_helpers.update_backend_tests_cronjobs_from_configmap)

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
    metrics.MetricCreator.get_meter_instance().start_server()

    parsed_url = urlparse(config.host)
    host = parsed_url.hostname if parsed_url.hostname else ''
    if parsed_url.port:
        port = parsed_url.port
    else:
        port = 8000

    try:
        uvicorn.run(app, host=host, port=port, log_config=None, **config.uvicorn_ssl_kwargs())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == '__main__':
    main()
