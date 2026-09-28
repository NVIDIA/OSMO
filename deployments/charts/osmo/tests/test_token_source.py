# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Execute rendered provenance filters with Helm, PyYAML and Lua/LuaJIT.

Run: python3 deployments/charts/osmo/tests/test_token_source.py
"""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml


CHARTS = Path(__file__).resolve().parents[2]


class TokenSourceTest(unittest.TestCase):
    """Only the internal OSMO key provider may attest a credential's source."""

    def test_verified_source_and_spoofed_headers(self):
        lua = os.environ.get('LUA') or shutil.which('luajit') or shutil.which('lua')
        self.assertIsNotNone(lua, 'Install Lua/LuaJIT or set LUA to its executable')
        for chart in ('osmo', 'service'):
            with self.subTest(chart=chart), tempfile.TemporaryDirectory() as directory:
                internal_cluster = f'osmo-{"api" if chart == "osmo" else "service"}-jwks'
                values = {
                    'gateway': {'envoy': {'jwt': {'providers': [
                        {'issuer': 'custom-osmo-issuer', 'audience': 'osmo',
                         'jwks_uri': 'http://osmo-api/api/auth/keys',
                         'cluster': internal_cluster,
                         'user_claim': 'unique_name'},
                        # Even an identically named issuer cannot attest OSMO provenance
                        # when its signature was verified by a different key provider.
                        {'issuer': 'custom-osmo-issuer', 'audience': 'external',
                         'jwks_uri': 'https://external.example/keys',
                         'cluster': 'idp', 'user_claim': 'unique_name'},
                    ]}}},
                }
                if chart == 'osmo':
                    values['externalUrl'] = 'http://localhost:30080'
                values_path = Path(directory) / 'values.yaml'
                values_path.write_text(yaml.safe_dump(values), encoding='utf-8')
                base_values = (['-f', str(CHARTS / 'osmo/tests/control-external-values.yaml')]
                               if chart == 'osmo' else [])
                rendered = subprocess.check_output([
                    'helm', 'template', 'token-source-test', str(CHARTS / chart),
                    *base_values, '-f', str(values_path),
                ], text=True)
                config = next(document for document in yaml.safe_load_all(rendered)
                              if document and 'lds.yaml' in document.get('data', {}))
                listeners = yaml.safe_load(config['data']['lds.yaml'])
                manager = listeners['resources'][0]['filter_chains'][0]['filters'][0]['typed_config']
                self.assertIn('x-osmo-token-source',
                              manager['route_config']['internal_only_headers'])
                filters = manager['http_filters']
                verifier = next(item['typed_config'] for item in filters
                                if item['name'] == 'envoy.filters.http.jwt_authn')
                self.assertEqual(verifier['providers']['provider_0']['payload_in_metadata'],
                                 'verified_jwt_0')
                self.assertEqual(verifier['providers']['provider_1']['payload_in_metadata'],
                                 'verified_jwt_1')
                source = next(item['typed_config']['default_source_code']['inline_string']
                              for item in filters if item['name'] == 'envoy.filters.http.lua.roles')
                harness = r'''
local headers = {}
local metadata = nil
local response = nil
local writes = 0
local handle = {}
function handle:headers()
  return {
    remove = function(_, name) headers[name] = nil end,
    replace = function(_, name, value)
      writes = writes + 1
      headers[name] = value
    end,
  }
end
function handle:respond(response_headers, body)
  response = {status = response_headers[':status'], body = body}
end
function handle:streamInfo()
  return {dynamicMetadata = function()
    return {get = function() return metadata end}
  end}
end
local function check(meta, expected, rejected)
  -- Represents a single or repeated client header after HTTP normalization.
  headers = {['x-osmo-token-source'] = 'bootstrap,database'}
  metadata = meta
  response = nil
  writes = 0
  envoy_on_request(handle)
  if rejected then
    assert(response ~= nil and response.status == '401', 'ambiguous identities were accepted')
    assert(writes == 0, 'identity headers were written before rejecting ambiguous identities')
  else
    assert(response == nil, 'a single verified identity was rejected')
  end
  assert(headers['x-osmo-token-source'] == expected,
         'untrusted source survived or trusted source was lost')
end
check(nil, nil)
check({}, nil)
check({verified_jwt_0 = {osmo_token_name = 'legacy'}}, nil)
check({verified_jwt_0 = {osmo_token_source = 'bootstrap'}}, 'bootstrap')
check({verified_jwt_0 = {osmo_token_source = 'database'}}, 'database')
check({verified_jwt_0 = {osmo_token_source = 'future-source'}}, nil)
check({verified_jwt_0 = {osmo_token_source = {'bootstrap'}}}, nil)
check({verified_jwt_1 = {iss = 'custom-osmo-issuer', osmo_token_source = 'bootstrap'}}, nil)
-- Reject ambiguous identity before forwarding any provider's claims, in either order.
local bootstrap = {unique_name = 'bootstrap-admin', roles = {'osmo-admin'},
                   osmo_token_source = 'bootstrap', osmo_token_name = 'bootstrap-admin-primary'}
local external = {unique_name = 'external-user', roles = {'osmo-user'},
                  osmo_workflow_id = 'external-workflow'}
check({verified_jwt_0 = bootstrap, verified_jwt_1 = external}, nil, true)
check({verified_jwt_0 = external, verified_jwt_1 = bootstrap}, nil, true)
-- Even matching claims from distinct verifiers must not select by configuration order.
check({verified_jwt_0 = bootstrap, verified_jwt_1 = bootstrap}, nil, true)
-- Existing role filtering and identity forwarding continue to work.
check({verified_jwt_0 = {roles = {'osmo-admin'}, osmo_token_name = 'name',
                         osmo_workflow_id = 'workflow'}}, nil)
assert(headers['x-osmo-roles'] == 'osmo-admin')
assert(headers['x-osmo-token-name'] == 'name')
assert(headers['x-osmo-workflow-id'] == 'workflow')
'''
                script = Path(directory) / 'test.lua'
                script.write_text(source + harness, encoding='utf-8')
                subprocess.run([lua, str(script)], check=True)


if __name__ == '__main__':
    unittest.main()
