"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import logging

from src.lib.utils import login
from src.lib.utils.client import LoginManager, RequestMethod, ServiceClient
from test.oetf.models import OetfConfig

logger = logging.getLogger(__name__)

OETF_USER_AGENT_PREFIX = "oetf"
DATA_CREDENTIAL_NAME = "osmo_cred"


def create_service_client(config: OetfConfig) -> ServiceClient:
    """Create an authenticated ServiceClient from OetfConfig."""
    if config.auth_method == "token":
        if not config.auth_token:
            raise ValueError(
                "Token auth requires --auth-token or OSMO_ACCESS_TOKEN env var"
            )
        refresh_url = login.construct_token_refresh_url(config.url)
        try:
            login_storage = login.token_login(
                url=config.url,
                refresh_url=refresh_url,
                refresh_token=config.auth_token,
                user_agent=OETF_USER_AGENT_PREFIX,
            )
        except Exception as error:
            raise ValueError(
                f"Failed to authenticate with token against {config.url}: {error}\n"
                f"The token may be invalid or expired for this instance. "
                f"Generate a new token with: `osmo login {config.url}` then "
                f"`osmo token set oetf --roles osmo-admin`"
            ) from error
    elif config.auth_method == "dev":
        if not config.auth_username:
            raise ValueError("Dev auth requires --auth-username")
        login_storage = login.LoginStorage(
            url=config.url,
            dev_login=login.DevLoginStorage(username=config.auth_username),
        )
    else:
        raise ValueError(f"Unsupported auth method: {config.auth_method}")

    login_config = login.LoginConfig(url=config.url)
    login_manager = LoginManager(config=login_config, user_agent_prefix=OETF_USER_AGENT_PREFIX)
    login_manager._login_storage = login_storage  # pylint: disable=protected-access
    return ServiceClient(login_manager)


def setup_data_credential(service_client: ServiceClient, config: OetfConfig) -> None:
    """POST the DATA credential when all 4 storage fields are set; no-op otherwise."""
    fields = [
        config.data_storage_access_key_id,
        config.data_storage_access_key,
        config.data_storage_endpoint,
        config.data_storage_region,
    ]
    if not all(fields):
        return
    service_client.request(
        method=RequestMethod.POST,
        endpoint=f"api/credentials/{DATA_CREDENTIAL_NAME}",
        payload={
            "data_credential": {
                "access_key_id": config.data_storage_access_key_id,
                "access_key": config.data_storage_access_key,
                "endpoint": config.data_storage_endpoint,
                "region": config.data_storage_region,
            },
        },
    )
    logger.info(
        "Data credential '%s' configured for %s",
        DATA_CREDENTIAL_NAME, config.data_storage_endpoint,
    )
