"""Tests backend-operator login credential refresh."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from pathlib import Path
import tempfile
import unittest
from unittest import mock

from src.lib.utils import login
from src.operator.utils import login as operator_login
from src.operator.utils import objects


class OperatorLoginTest(unittest.TestCase):
    """Tests adoption of rotated projected Secret values."""

    def test_refresh_uses_new_projected_token(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            token_path = Path(temporary_directory) / 'token.txt'
            token_path.write_text('new-token', encoding='utf-8')
            config = objects.BackendBaseConfig(
                namespace='osmo-workflows',
                login_method='token',
                token_file=str(token_path))
            login_info = login.LoginStorage(
                url=config.service_url,
                token_login=login.TokenLoginStorage(
                    id_token='header.e30.signature',
                    refresh_token='old-token'))
            replacement = login.LoginStorage(
                url=config.service_url,
                token_login=login.TokenLoginStorage(
                    id_token='header.e30.signature',
                    refresh_token='new-token'))

            with mock.patch.object(
                    operator_login.login, 'token_login', return_value=replacement) as token_login:
                result = operator_login.refresh_id_token(config, login_info)

        self.assertIs(result, replacement)
        self.assertEqual(token_login.call_args.args[2], 'new-token')

    def test_refresh_preserves_osmo_token_protocol(self) -> None:
        config = objects.BackendBaseConfig(
            namespace='osmo-workflows',
            login_method='token',
            token='current-token')
        login_info = login.LoginStorage(
            url=config.service_url,
            token_login=login.TokenLoginStorage(
                id_token='header.e30.signature',
                refresh_token='current-token'),
            osmo_token=True)

        with mock.patch.object(
                operator_login.login, 'refresh_id_token',
                return_value=None) as refresh_id_token:
            result = operator_login.refresh_id_token(config, login_info)

        self.assertIs(result, login_info)
        self.assertTrue(refresh_id_token.call_args.kwargs['osmo_token'])


if __name__ == '__main__':
    unittest.main()
