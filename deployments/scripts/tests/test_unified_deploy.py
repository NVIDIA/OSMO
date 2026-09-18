"""Regression coverage for installer boundaries, credential ownership and cloud inputs.

SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

import base64
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock


ROOT = Path(os.environ['TEST_SRCDIR']) / '_main' if 'TEST_SRCDIR' in os.environ else Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('deploy', ROOT / 'deployments/scripts/lib/deploy.py')
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


class FakeCluster:
    def __init__(self, previous=None, secrets=True, releases=None):
        self.private = False
        self.calls = []
        self.manifests = []
        self.previous = previous
        self.secrets = secrets
        self.releases = releases

    def run(self, tool, *args, capture=False):
        self.calls.append((tool, *map(str, args)))
        if tool == 'helm' and args[0] == 'list':
            return json.dumps(self.releases if self.releases is not None else ([{
                'name': 'osmo', 'namespace': 'osmo', 'chart': 'osmo-0.1.0', 'status': 'deployed',
            }] if self.previous is not None else []))
        if tool == 'helm' and args[:2] == ('get', 'values'):
            return json.dumps(self.previous)
        if tool == 'kubectl' and args[:2] == ('get', 'storageclass'):
            return json.dumps({'items': [{'metadata': {'annotations': {
                'storageclass.kubernetes.io/is-default-class': 'true'}}}]})
        if tool == 'kubectl' and args[:3] == ('get', 'secret', 'osmo-default-admin'):
            return json.dumps({'data': {'password': base64.b64encode(b'retained-admin-token').decode()}}) if self.previous is not None and self.secrets else ''
        if tool == 'kubectl' and args[:3] == ('get', 'secret', 'osmo-admin-token'):
            return json.dumps({'data': {'token': base64.b64encode(b'chart-admin-token').decode()}}) if self.secrets else ''
        if tool == 'kubectl' and args[:2] == ('get', 'secret'):
            return json.dumps({'data': {'mek.yaml': 'retained', 'authentication-config.json': 'retained',
                                       'db-password': 'existing', 'redis-password': 'existing',
                                       'object-storage.yaml': 'existing'}}) if self.secrets else ''
        return ''

    def apply(self, manifest):
        self.manifests.append(manifest)

    def secret(self, namespace, name, data):
        self.manifests.append({'kind': 'Secret', 'metadata': {'name': name, 'namespace': namespace}, 'stringData': data})


class DeploymentTest(unittest.TestCase):
    def options(self, *args):
        with mock.patch.dict(os.environ, {}, clear=True):
            return deploy.parser().parse_args(['--skip-verify', '--no-gpu', *args])

    def test_release_discovery_uses_status_filters_supported_by_helm_3_and_4(self):
        release = {'name': 'osmo', 'namespace': 'osmo', 'chart': 'osmo-0.1.0',
                   'status': 'pending-upgrade'}
        cluster = FakeCluster(releases=[release])
        self.assertEqual(deploy.release_state(cluster, self.options()), release)
        arguments = cluster.calls[0]
        self.assertNotIn('--all', arguments)
        for status in ['deployed', 'failed', 'pending', 'uninstalled', 'uninstalling', 'superseded']:
            self.assertIn('--' + status, arguments)

    def test_legacy_values_rejected_in_files_and_sets_before_provision(self):
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary) / 'old.yaml'
            file.write_text('global:\n  osmoImageTag: old\n')
            for arguments in [['--helm-values', str(file)], ['--helm-set', 'services.configs.workflow.x=bad']]:
                with self.subTest(arguments=arguments), mock.patch.object(deploy, 'provision') as provision:
                    with self.assertRaisesRegex(ValueError, 'Legacy chart values'):
                        deploy.main(arguments)
                    provision.assert_not_called()
        deploy.reject_legacy({'services': {'backendWorker': {'enabled': True}}})

    def test_old_chart_specific_options_fail(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.options('--service-helm-values', 'legacy.yaml')

    def test_dry_run_never_contacts_cluster_or_provisions(self):
        with mock.patch.object(deploy, 'install') as install, contextlib.redirect_stdout(io.StringIO()):
            deploy.main(['--provider', 'azure', '--dry-run', '--destroy'])
        install.assert_not_called()

    def test_new_local_profiles_do_not_seed_legacy_dependencies(self):
        for provider in ['byo']:
            values = deploy.connection_values(self.options('--provider', provider), {})
            self.assertNotIn('externalDependencies', values)
            self.assertNotIn('secrets', values)

    def test_external_connections_use_tls_and_typed_secrets(self):
        values = deploy.connection_values(self.options('--storage-backend', 'embedded'), {
            'POSTGRES_HOST': 'postgres.example', 'REDIS_HOST': 'redis.example',
            'REDIS_PORT': '6379', 'REDIS_TLS_ENABLED': 'true',
        })
        self.assertTrue(values['externalDependencies']['valkey']['tls']['enabled'])
        self.assertFalse(values['embeddedDependencies']['postgresql']['enabled'])
        self.assertFalse(values['secrets']['valkey']['generate'])

    def test_workload_identity_wires_services_and_workflow(self):
        for backend, environment, annotation in [
            ('s3', {'STORAGE_BUCKET': 'bucket', 'WORKLOAD_IDENTITY_ROLE_ARN': 'role'}, 'eks.amazonaws.com/role-arn'),
            ('azure-blob', {'STORAGE_ACCOUNT': 'account', 'WORKLOAD_IDENTITY_CLIENT_ID': 'client'},
             'azure.workload.identity/client-id'),
        ]:
            with self.subTest(backend=backend):
                values = deploy.connection_values(self.options('--storage-backend', backend,
                    '--auth-method', 'workload-identity'), environment)
                self.assertEqual(values['externalDependencies']['objectStorage']['authentication']['type'], 'sdkDefault')
                self.assertFalse(values['secrets']['objectStorage']['existingSecret'])
                for service in ['api', 'worker']:
                    self.assertIn(annotation, values['services'][service]['serviceAccount']['annotations'])
                self.assertIn('cloud_identity', values['configuration']['pools']['default']['common_pod_template'])
                self.assertEqual(values['configuration']['podTemplates']['cloud_identity']['spec']['serviceAccountName'],
                                 'osmo-workflow')

    def test_remote_failure_and_private_upload_allowlist(self):
        environment = {'TF_SUBSCRIPTION_ID': 'sub', 'RESOURCE_GROUP_NAME': 'group', 'AKS_CLUSTER_NAME': 'aks'}
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            chart = directory / "chart with ' quote.tgz"
            chart.write_text('chart')
            (directory / 'terraform.tfstate').write_text('must not upload')
            received = []

            def invoke(arguments, **kwargs):
                received.append(arguments)
                files = [arguments[i + 1] for i, item in enumerate(arguments) if item == '--file']
                self.assertEqual(len(files), 1)
                self.assertEqual(Path(files[0]).read_text(), 'chart')
                remote = shlex.split(arguments[arguments.index('--command') + 1])
                self.assertEqual(remote, ['helm', 'upgrade', 'osmo', 'input-0.tgz'])
                return json.dumps({'exitCode': 17, 'logs': 'sensitive failure output'})

            cluster = deploy.Cluster(environment, directory, True)
            with mock.patch.object(deploy, 'command', side_effect=invoke):
                with self.assertRaisesRegex(RuntimeError, 'exitCode=17') as failure:
                    cluster.run('helm', 'upgrade', 'osmo', chart)
                self.assertNotIn('sensitive', str(failure.exception))
            self.assertFalse(list(directory.glob('aks-command-*')))
            self.assertEqual(len(received), 1)

    def test_legacy_custom_release_is_rejected(self):
        cluster = FakeCluster(releases=[{'namespace': 'osmo', 'name': 'custom-control', 'chart': 'service-1.3.1'}])
        with self.assertRaisesRegex(ValueError, 'Legacy Helm release'):
            deploy.release_state(cluster, self.options())
        self.assertFalse(cluster.manifests)

    def run_install(self, cluster, overrides=None, environment=None, options=None, render_failure=False,
                    chart=None):
        actual_command = deploy.command
        captured = []
        environment = environment if environment is not None else {}
        def local_command(arguments, **kwargs):
            if arguments[:2] in [['helm', 'repo'], ['helm', 'dependency']]:
                return ''
            if arguments[0] == 'curl' and '--output' in arguments:
                Path(arguments[arguments.index('--output') + 1]).write_text('-----BEGIN CERTIFICATE-----\nmock-ca\n')
                return ''
            if arguments[:3] == ['helm', 'show', 'values']:
                return actual_command(['helm', 'show', 'values', ROOT / 'deployments/charts/osmo'], **kwargs)
            if arguments[:3] == ['helm', 'template', 'osmo'] and render_failure:
                raise subprocess.CalledProcessError(1, arguments)
            if arguments[:2] == ['helm', 'lint'] or arguments[:3] == ['helm', 'template', 'osmo']:
                return ''
            return actual_command(arguments, **kwargs)
        def capture_run(tool, *arguments, **kwargs):
            if tool == 'helm' and arguments[0] == 'upgrade' and '-f' in arguments:
                captured.append(json.loads(Path(arguments[arguments.index('-f') + 1]).read_text()))
            return FakeCluster.run(cluster, tool, *arguments, **kwargs)
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(deploy, 'command', side_effect=local_command), \
                mock.patch.object(deploy, 'Cluster', return_value=cluster), \
                mock.patch.object(deploy, 'provision', return_value=(None, False)), \
                mock.patch.object(deploy, 'prerequisites') as prerequisites, \
                mock.patch.object(cluster, 'run', side_effect=capture_run), contextlib.redirect_stdout(io.StringIO()) as output:
            directory = Path(temporary)
            deploy.install(options or self.options(), environment, directory,
                           chart or directory / 'osmo.tgz', overrides or {})
            self.install_output = output.getvalue()
            self.install_environment = environment
            if environment.get('OSMO_TOKEN_FILE'):
                self.admin_token = Path(environment['OSMO_TOKEN_FILE']).read_text()
            return captured, prerequisites.call_args

    def test_template_validation_failure_precedes_cluster_writes(self):
        cluster = FakeCluster()
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_install(cluster, render_failure=True)
        self.assertFalse(cluster.manifests)
        self.assertFalse(any(call[:2] == ('helm', 'upgrade') for call in cluster.calls))

    def test_quickstart_reads_chart_token_after_install_for_verification(self):
        options = self.options()
        options.skip_verify = False
        cluster = FakeCluster()
        with mock.patch.object(deploy, 'verify') as verify:
            _, calls = self.run_install(cluster, options=options,
                                        environment={'OSMO_API_PORT': '9100'})
        self.assertEqual(calls.args[2]['externalUrl'], 'http://127.0.0.1:9100')
        self.assertEqual(self.install_environment['OSMO_LOGIN_METHOD'], 'token')
        self.assertEqual(self.admin_token, 'chart-admin-token')
        verify.assert_called_once()
        token_read = next(i for i, call in enumerate(cluster.calls)
                          if call[:4] == ('kubectl', 'get', 'secret', 'osmo-admin-token'))
        self.assertGreater(token_read, max(i for i, call in enumerate(cluster.calls)
                                         if call[:2] == ('helm', 'upgrade')))

    def test_workflow_endpoint_uses_gateway_namespace_port_and_preserves_overrides(self):
        for snapshot in [False, True]:
            for explicit in ['', 'https://workflow.example.com']:
                with self.subTest(snapshot=snapshot, explicit=explicit):
                    service = {'service_base_url': explicit} if explicit else {}
                    configuration = {'service': service}
                    if snapshot:
                        configuration = {'snapshot': configuration}
                    overrides = {'fullnameOverride': 'site', 'externalUrl': 'http://127.0.0.1:9100',
                                 'gateway': {'envoy': {'service': {'port': 8081}}},
                                 'compute': {'workloadNamespace': {'name': 'tasks', 'create': True}},
                                 'configuration': configuration}
                    _, calls = self.run_install(FakeCluster(), overrides=overrides,
                                                options=self.options('--namespace', 'control'))
                    effective = calls.args[2]
                    self.assertEqual(effective['externalUrl'], 'http://127.0.0.1:9100')
                    runtime = effective['configuration']['snapshot'] if snapshot else effective['configuration']
                    self.assertEqual(runtime['service']['service_base_url'],
                                     explicit or 'http://site-gateway.control.svc:8081')

    def test_verification_token_handles_custom_reference_and_missing_data(self):
        values = {'authentication': {'bootstrap': {'identities': {'admin': {
            'enabled': True, 'tokens': {'primary': {'existingSecret': {
                'name': 'site-admin', 'key': 'access-token'}}}}}}}}
        with tempfile.TemporaryDirectory() as temporary:
            cluster = FakeCluster()
            for document, succeeds in [({'data': {'access-token': base64.b64encode(b'site-token').decode()}}, True), ({}, False)]:
                with self.subTest(document=document), mock.patch.object(cluster, 'run', return_value=json.dumps(document)):
                    environment = {}
                    if succeeds:
                        deploy.verification_credentials(cluster, self.options(), values, environment, Path(temporary))
                        token_file = Path(environment['OSMO_TOKEN_FILE'])
                        self.assertEqual(token_file.read_text(), 'site-token')
                        self.assertEqual(token_file.stat().st_mode & 0o777, 0o600)
                    else:
                        with self.assertRaisesRegex(ValueError, 'no non-empty access-token'):
                            deploy.verification_credentials(cluster, self.options(), values, environment, Path(temporary))

    def test_removed_auth_values_fail_before_installing_or_replacing_credentials(self):
        for key in ['defaultAdmin', 'backendApiTokens']:
            with self.subTest(key=key):
                previous = {'secrets': {key: {'existingSecret': 'retained-secret'}}}
                cluster = FakeCluster(previous=previous)
                with self.assertRaisesRegex(ValueError, 'Legacy chart values'):
                    self.run_install(cluster)
                self.assertFalse(cluster.manifests)
                self.assertFalse(any(call[:2] == ('helm', 'upgrade') for call in cluster.calls))

    def test_initial_install_disables_bootstrap_after_success(self):
        cluster = FakeCluster()
        self.run_install(cluster)
        upgrades = [call for call in cluster.calls if call[:2] == ('helm', 'upgrade')]
        self.assertEqual(len(upgrades), 2)
        self.assertIn('secrets.serviceAuth.bootstrap.enabled=false', upgrades[-1])
        self.assertIn('secrets.masterEncryptionKey.bootstrap.enabled=false', upgrades[-1])
        self.assertFalse(any(item['kind'] == 'Secret' for item in cluster.manifests))

    def test_upgrade_preserves_values_and_refuses_missing_retained_keys(self):
        previous = {'configuration': {'pools': {'site': {'name': 'site'}}},
                    'secrets': {'serviceAuth': {'bootstrap': {'enabled': False}}}}
        cluster = FakeCluster(previous=previous)
        values, _ = self.run_install(cluster)
        self.assertEqual(values[0]['configuration']['pools'], previous['configuration']['pools'])
        self.assertFalse(values[0]['secrets']['serviceAuth']['bootstrap']['enabled'])
        self.assertFalse(values[0]['secrets']['masterEncryptionKey']['bootstrap']['enabled'])
        missing = FakeCluster(previous=previous, secrets=False)
        with self.assertRaisesRegex(ValueError, 'Restore retained'):
            self.run_install(missing)
        self.assertFalse(missing.manifests)
        self.assertFalse(any(call[:2] == ('helm', 'upgrade') for call in missing.calls))

    def test_external_storage_uses_one_secret_without_helm_passwords(self):
        cluster = FakeCluster()
        environment = {'STORAGE_ENDPOINT': 's3://existing-bucket', 'STORAGE_OVERRIDE_URL': 'https://minio.example',
                       'STORAGE_ACCESS_KEY_ID': 'identity', 'STORAGE_ACCESS_KEY': 'credential-sentinel',
                       'STORAGE_ADDRESSING_STYLE': 'path'}
        values, _ = self.run_install(cluster, environment=environment)
        self.assertNotIn('credential-sentinel', json.dumps(values))
        secrets = [item for item in cluster.manifests if item['kind'] == 'Secret']
        self.assertEqual(len(secrets), 1)
        credentials = json.loads(secrets[0]['stringData']['object-storage.yaml'])
        self.assertEqual(credentials['access_key'], 'credential-sentinel')
        self.assertEqual(credentials['addressing_style'], 'path')
        self.assertEqual(credentials['override_url'], 'https://minio.example')

    def test_effective_overrides_control_prerequisites(self):
        cluster = FakeCluster()
        overrides = {'embeddedDependencies': {'postgresql': {'enabled': False}},
                     'externalDependencies': {'postgresql': {'host': 'custom.example'}},
                     'secrets': {'postgresql': {'existingSecret': 'custom-db'}}}
        _, arguments = self.run_install(cluster, overrides)
        self.assertFalse(arguments.args[2]['embeddedDependencies']['postgresql']['enabled'])
        self.assertFalse(any(item['kind'] == 'Secret' for item in cluster.manifests))

    def test_destroy_does_not_delete_namespaces_or_credentials(self):
        cluster = FakeCluster(previous={})
        self.run_install(cluster, options=self.options('--destroy'))
        mutations = [call for call in cluster.calls if call[:2] == ('helm', 'uninstall')]
        self.assertEqual(len(mutations), 1)
        self.assertEqual(mutations[0][2], 'osmo')
        self.assertFalse(cluster.manifests)
        self.assertFalse(any(call[:2] == ('kubectl', 'delete') for call in cluster.calls))

    def test_cloud_destroy_does_not_require_live_kubernetes(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(deploy, 'driver') as driver, \
                mock.patch.object(deploy, 'provision') as provision:
            deploy.install(self.options('--provider', 'aws', '--destroy'), {}, Path(temporary), Path('.'), {})
            self.assertEqual(driver.call_args.args[:2], ('aws', 'terraform_destroy'))
            provision.assert_not_called()

    @unittest.skipUnless(shutil.which('terraform'), 'Terraform is required for sensitive-input regression')
    def test_provider_sensitive_tfvars_and_nondefault_context(self):
        actual_command = deploy.command
        for provider in ['azure', 'aws']:
            with self.subTest(provider=provider), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                variables = {'postgres_password': 'quoted"password', 'rds_password': 'rds-secret',
                             'redis_auth_token': 'cache-secret', 'subscription_id': 'selected-sub',
                             'rds_db_name': 'custom_db', 'rds_username': 'custom_user'}
                (directory / 'main.tf.json').write_text(json.dumps({'variable': {
                    key: {'type': 'string', 'sensitive': 'password' in key or 'token' in key}
                    for key in variables}}))
                (directory / 'terraform.tfvars.json').write_text(json.dumps(variables))
                environment = {**os.environ, f'{provider.upper()}_TERRAFORM_DIR': temporary}
                outputs = {'resource_group_name': 'group', 'aks_cluster_name': 'aks',
                           'postgres_password': None, 'cluster_name': 'eks'}
                cloud = []

                def execute(arguments, **kwargs):
                    if arguments[0] == 'terraform':
                        return actual_command(arguments, **kwargs)
                    cloud.append(arguments)
                    return ''

                with mock.patch.object(deploy, 'terraform_outputs', return_value=outputs), \
                        mock.patch.object(deploy, 'command', side_effect=execute):
                    deploy.provision(self.options('--provider', provider, '--skip-terraform'), environment)
                if provider == 'azure':
                    self.assertEqual(environment['POSTGRES_PASSWORD'], variables['postgres_password'])
                    self.assertEqual(environment['TF_SUBSCRIPTION_ID'], 'selected-sub')
                    for call in cloud:
                        self.assertEqual(call[call.index('--subscription') + 1], 'selected-sub')
                else:
                    self.assertEqual(environment['POSTGRES_PASSWORD'], 'rds-secret')
                    self.assertEqual(environment['REDIS_PASSWORD'], 'cache-secret')
                    self.assertEqual(environment['POSTGRES_DB_NAME'], 'custom_db')
                    self.assertEqual(environment['POSTGRES_USERNAME'], 'custom_user')
                self.assertNotIn('rds-secret', json.dumps(cloud))

    def test_interactive_choices_survive_shell(self):
        with tempfile.TemporaryDirectory() as temporary:
            scripts = Path(temporary)
            (scripts / 'common.sh').write_text('')
            for provider in ['azure', 'aws']:
                (scripts / provider).mkdir()
                (scripts / provider / 'terraform.sh').write_text(
                    provider + '_configure_interactively() { TF_SUBSCRIPTION_ID=chosen-sub; '
                    'TF_AWS_PROFILE=chosen-profile; TF_AWS_REGION=chosen-region; }\n' +
                    provider + '_generate_tfvars() { touch "$1"; }\n')
                environment = dict(os.environ)
                with mock.patch.object(deploy, 'SCRIPTS', scripts):
                    deploy.configure_interactively(provider, environment, scripts / 'terraform.tfvars')
                self.assertEqual(environment['TF_SUBSCRIPTION_ID'], 'chosen-sub')
                if provider == 'aws':
                    self.assertEqual(environment['AWS_PROFILE'], 'chosen-profile')
                    self.assertEqual(environment['AWS_REGION'], 'chosen-region')

    def test_private_prerequisite_chart_is_downloaded_locally(self):
        environment = {'TF_SUBSCRIPTION_ID': 'sub', 'RESOURCE_GROUP_NAME': 'group', 'AKS_CLUSTER_NAME': 'aks'}
        calls = []
        def execute(arguments, **kwargs):
            calls.append(list(map(str, arguments)))
            if arguments[:2] == ['helm', 'pull']:
                (Path(arguments[arguments.index('--destination') + 1]) / 'chart.tgz').write_text('prerequisite')
                return ''
            if arguments[0] == 'az':
                remote = shlex.split(arguments[arguments.index('--command') + 1])
                self.assertIn('input-0.tgz', remote)
                self.assertNotIn('repo/chart', remote)
                uploaded = Path(arguments[arguments.index('--file') + 1])
                self.assertEqual(uploaded.read_text(), 'prerequisite')
                return json.dumps({'exitCode': 0, 'logs': ''})
            return ''
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(deploy, 'command', side_effect=execute):
            cluster = deploy.Cluster(environment, Path(temporary), True)
            cluster.run('helm', 'repo', 'add', 'repo', 'https://example.invalid')
            cluster.run('helm', 'upgrade', '--install', 'release', 'repo/chart', '--version', '1.2.3')
        self.assertEqual(calls[0][:2], ['helm', 'repo'])
        self.assertEqual(calls[1][:2], ['helm', 'pull'])
        self.assertEqual(calls[1][-2:], ['--version', '1.2.3'])
        self.assertEqual(len([call for call in calls if call[0] == 'az']), 1)

    def test_auto_storage_preserves_explicit_and_prior_config(self):
        storage = {'externalDependencies': {'objectStorage': {'locations': {
            name: 's3://site/' + name for name in ['workflows', 'logs', 'apps']}}},
            'embeddedDependencies': {'objectStorage': {'enabled': False}},
            'secrets': {'objectStorage': {'generate': False, 'existingSecret': 'site-storage'}}}
        for previous in [None, storage]:
            cluster = FakeCluster(previous=previous)
            for provider in ['azure', 'aws']:
                # Native storage inputs are deliberately absent: supplied values must win.
                generated = deploy.connection_values(self.options('--provider', provider), {}, storage)
                self.assertNotIn('objectStorage', generated.get('externalDependencies', {}))
            values, _ = self.run_install(cluster, overrides=storage if previous is None else {})
            self.assertEqual(values[0]['externalDependencies'], storage['externalDependencies'])

    def test_workload_namespace_has_helm_ownership_and_rejects_adoption(self):
        overrides = {'compute': {'workloadNamespace': {'name': 'workflows', 'create': True}}}
        cluster = FakeCluster()
        self.run_install(cluster, overrides)
        namespace = next(item for item in cluster.manifests if item['metadata']['name'] == 'workflows')
        self.assertEqual(namespace['metadata']['labels']['app.kubernetes.io/managed-by'], 'Helm')
        self.assertEqual(namespace['metadata']['annotations']['meta.helm.sh/release-name'], 'osmo')
        self.assertEqual(namespace['metadata']['annotations']['meta.helm.sh/release-namespace'], 'osmo')
        actual_run = FakeCluster.run
        def existing_namespace(instance, tool, *arguments, **kwargs):
            if tool == 'kubectl' and arguments[:2] == ('get', 'namespace'):
                return json.dumps({'metadata': {'name': 'workflows'}})
            return actual_run(instance, tool, *arguments, **kwargs)
        conflict = FakeCluster()
        with mock.patch.object(FakeCluster, 'run', existing_namespace), \
                self.assertRaisesRegex(ValueError, 'outside this Helm release'):
            self.run_install(conflict, overrides)
        self.assertFalse(conflict.manifests)

    def test_explicit_storage_classes_and_gateway_port(self):
        cluster = FakeCluster()
        self.run_install(cluster, {'gateway': {'envoy': {'service': {'port': 8081}}},
            'postgresql': {'cluster': {'storage': {'storageClass': 'site'}}},
            'valkey': {'dataStorage': {'className': 'site'}},
            'rustfs': {'storageclass': {'name': 'site'}}})
        self.assertIn('9000:8081', self.install_output)
        self.assertFalse(any(call[:3] == ('kubectl', 'get', 'storageclass') for call in cluster.calls))

    def test_verification_uses_effective_port_and_cleans_own_process(self):
        process = mock.Mock()
        process.poll.return_value = None
        with mock.patch.object(deploy, 'command') as command, \
                mock.patch.object(deploy.subprocess, 'Popen', return_value=process) as start, \
                mock.patch.object(deploy.subprocess, 'run', return_value=mock.Mock(returncode=0)):
            options = self.options()
            options.skip_verify = False
            deploy.verify(FakeCluster(), options, {'fullnameOverride': 'site',
                'gateway': {'envoy': {'service': {'port': 8081}}}}, {'PATH': os.environ['PATH']})
            self.assertIn('9000:8081', start.call_args.args[0])
            process.terminate.assert_called_once()
            process.wait.assert_called_once()
            self.assertEqual(command.call_args.kwargs['env']['OSMO_URL'], 'http://127.0.0.1:9000')

    def test_old_published_chart_rejected_before_provision(self):
        actual_command = deploy.command
        def execute(arguments, **kwargs):
            if arguments[:3] == ['helm', 'show', 'values']:
                return 'service: {}\n'
            return actual_command(arguments, **kwargs)
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(deploy, 'command', side_effect=execute):
            with self.assertRaisesRegex(ValueError, 'not the unified'):
                deploy.prepare_chart(self.options(), Path(temporary), {})

    def test_local_chart_path_overrides_inherited_version_and_reads_selected_values(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            chart = directory / 'main checkout' / 'osmo'
            chart.mkdir(parents=True)
            (chart / 'Chart.yaml').write_text('apiVersion: v2\nname: osmo\nversion: 0.1.0\n')
            (chart / 'values.yaml').write_text(json.dumps({
                'planes': {}, 'embeddedDependencies': {}, 'externalDependencies': {},
                'secrets': {}, 'selectedCheckout': 'main'}))
            with mock.patch.dict(os.environ, {'OSMO_CHART_VERSION': '9.9.9'}, clear=True):
                options = deploy.parser().parse_args(['--chart-path', str(chart)])
            self.assertEqual(deploy.prepare_chart(options, directory, {}), chart.resolve())
            self.assertEqual(json.loads((directory / 'chart-defaults.yaml').read_text())['selectedCheckout'], 'main')

    def test_local_chart_path_rejects_explicit_published_version(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.options('--chart-path', '/some/chart', '--chart-version', '1.0.0')

    def test_invalid_local_chart_is_rejected_before_install(self):
        with tempfile.TemporaryDirectory() as temporary:
            chart = Path(temporary)
            options = self.options('--chart-path', str(chart))
            with self.assertRaisesRegex(ValueError, 'Chart.yaml'):
                deploy.prepare_chart(options, chart, {})
            (chart / 'Chart.yaml').write_text('apiVersion: v2\nname: legacy\nversion: 0.1.0\n')
            (chart / 'values.yaml').write_text('service: {}\n')
            with self.assertRaisesRegex(ValueError, 'not the unified'):
                deploy.prepare_chart(options, chart, {})
            options = self.options('--provider', 'aws', '--profile', 'single-plane', '--chart-path', str(chart))
            with self.assertRaisesRegex(ValueError, 'profiles/single-plane.yaml'):
                deploy.prepare_chart(options, chart, {})

    def test_single_plane_uses_profile_from_selected_local_chart(self):
        with tempfile.TemporaryDirectory() as temporary:
            chart = Path(temporary) / 'main-chart'
            (chart / 'profiles').mkdir(parents=True)
            (chart / 'Chart.yaml').write_text('apiVersion: v2\nname: osmo\nversion: 0.1.0\n')
            profile = (ROOT / 'deployments/charts/osmo/profiles/single-plane.yaml').read_text()
            (chart / 'profiles/single-plane.yaml').write_text(profile + '\ncommonLabels:\n  selected-checkout: main\n')
            values, _ = self.run_install(FakeCluster(), chart=chart, environment={'EKS_CLUSTER_NAME': 'site'},
                options=self.options('--provider', 'aws', '--profile', 'single-plane',
                                     '--storage-backend', 'embedded', '--chart-path', str(chart)))
            self.assertEqual(values[0]['commonLabels']['selected-checkout'], 'main')

    def test_aws_single_plane_entrypoint_routes_profile_and_rejects_retired_provider(self):
        script = ROOT / 'deployments/scripts/deploy-osmo-single-plane.sh'
        result = subprocess.run(['bash', script, '--provider', 'aws', '--dry-run', '--no-gpu',
                                 '--chart-path', str(ROOT / 'deployments/charts/osmo')],
                                capture_output=True, text=True, check=True)
        self.assertIn('provider=aws', result.stdout)
        self.assertNotIn('TF_RESOURCE_GROUP', result.stderr)
        rejected = subprocess.run(['bash', script, '--provider', 'microk8s'], capture_output=True, text=True)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn('Unsupported provider', rejected.stderr)

    def test_single_plane_aws_is_authenticated_with_external_dependencies(self):
        environment = {'POSTGRES_HOST': 'rds.example', 'POSTGRES_PASSWORD': 'pg-secret',
                       'POSTGRES_USERNAME': 'site_admin', 'POSTGRES_DB_NAME': 'site', 'POSTGRES_PORT': '5433',
                       'POSTGRES_TLS_ENABLED': 'true', 'REDIS_HOST': 'cache.example',
                       'REDIS_PASSWORD': 'cache-secret', 'REDIS_TLS_ENABLED': 'true',
                       'STORAGE_BUCKET': 'site', 'STORAGE_ACCESS_KEY_ID': 'access-id',
                       'STORAGE_ACCESS_KEY': 'access-secret', 'AWS_REGION': 'us-west-2', 'EKS_CLUSTER_NAME': 'site'}
        cluster = FakeCluster()
        values, calls = self.run_install(cluster, environment=environment,
            options=self.options('--provider', 'aws', '--profile', 'single-plane'))
        effective = calls.args[2]
        self.assertTrue(effective['gateway']['authz']['enabled'])
        self.assertTrue(effective['externalDependencies']['postgresql']['tls']['enabled'])
        self.assertEqual(effective['externalDependencies']['postgresql']['port'], 5433)
        self.assertEqual(effective['externalDependencies']['postgresql']['tls']['caExistingSecret'], 'osmo-postgresql-ca')
        self.assertTrue(effective['externalDependencies']['valkey']['tls']['enabled'])
        self.assertEqual(effective['externalDependencies']['objectStorage']['locations']['workflows'], 's3://site/workflows')
        self.assertTrue(effective['embeddedDependencies']['dex']['enabled'])
        self.assertTrue(all(not effective['embeddedDependencies'][key]['enabled']
                            for key in ['postgresql', 'valkey', 'objectStorage']))
        self.assertEqual(effective['authentication']['bootstrap']['identities']['backend-operator-default']['tokens']['single-plane']['managedSecret']['name'], 'osmo-backend-token')
        self.assertEqual(self.install_environment['OSMO_LOGIN_METHOD'], 'token')
        self.assertTrue(self.admin_token)
        self.assertNotIn(self.admin_token, json.dumps(values))
        for password in ['pg-secret', 'cache-secret', 'access-secret']:
            self.assertNotIn(password, json.dumps(values))
        self.assertEqual(len([item for item in cluster.manifests if item['metadata']['name'] == 'osmo-default-admin']), 1)
        self.assertEqual(len([call for call in cluster.calls if call[:2] == ('helm', 'upgrade')]), 2)

    def test_single_plane_admin_token_is_retained_and_missing_upgrade_token_fails(self):
        options = self.options('--provider', 'aws', '--profile', 'single-plane')
        with tempfile.TemporaryDirectory() as temporary:
            values = {'authentication': {'bootstrap': {'identities': {'admin': {'tokens': {'primary': {'existingSecret': {'name': 'osmo-default-admin', 'key': 'password'}}}}}}},
                      'externalDependencies': {'postgresql': {'tls': {'enabled': False}}}}
            cluster = FakeCluster(previous={})
            environment = {}
            deploy.single_plane_credentials(cluster, options, values, environment, Path(temporary), True)
            self.assertEqual(Path(environment['OSMO_TOKEN_FILE']).read_text(), 'retained-admin-token')
            self.assertFalse(cluster.manifests)
            missing = FakeCluster(previous={}, secrets=False)
            with self.assertRaisesRegex(ValueError, 'Restore or provision administrator'):
                deploy.single_plane_credentials(missing, options, values, {}, Path(temporary), True)
            self.assertFalse(missing.manifests)

    def test_generated_aws_values_render_with_native_identity_templates(self):
        environment = {'EKS_CLUSTER_NAME': 'site', 'POSTGRES_HOST': 'rds.example', 'POSTGRES_PASSWORD': 'pg-secret',
                       'REDIS_HOST': 'cache.example', 'REDIS_PASSWORD': 'cache-secret',
                       'STORAGE_BUCKET': 'site', 'STORAGE_ACCESS_KEY_ID': 'access-id',
                       'STORAGE_ACCESS_KEY': 'access-secret'}
        values, _ = self.run_install(FakeCluster(), environment=environment,
                                    options=self.options('--provider', 'aws', '--profile', 'single-plane'))
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            # Render the actual root templates/schema without downloading subcharts.
            chart = directory / 'osmo'
            shutil.copytree(ROOT / 'deployments/charts/osmo', chart,
                            ignore=shutil.ignore_patterns('charts', 'tmpcharts-*'))
            metadata = (chart / 'Chart.yaml').read_text().split('\ndependencies:', 1)[0]
            (chart / 'Chart.yaml').write_text(metadata)
            overrides = directory / 'values.json'
            # These inert defaults normally come from the Dex dependency.
            rendered_values = deploy.merge(values[0], {'dex': {
                'replicaCount': 1, 'https': {'enabled': False}, 'grpc': {'enabled': False},
                'service': {'ports': {'http': {'port': 5556}}},
                'autoscaling': {'enabled': False}, 'networkPolicy': {'enabled': False}}})
            overrides.write_text(json.dumps(rendered_values))
            result = subprocess.run(['helm', 'template', 'osmo', str(chart), '-n', 'osmo',
                                     '-f', str(overrides)], capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            rendered = result.stdout
            for expected in ['identity-bootstrap', 'secretName: osmo-default-admin',
                             '/etc/osmo/bootstrap-tokens/backend-operator-default/single-plane',
                             'service_base_url: http://osmo-gateway.osmo.svc:80',
                             'http://127.0.0.1:9000/dex']:
                self.assertIn(expected, rendered)
            for forbidden in ['pg-secret', 'cache-secret', 'access-secret']:
                self.assertNotIn(forbidden, rendered)

    def test_single_plane_aws_persistent_inputs_and_state_context(self):
        with tempfile.TemporaryDirectory() as temporary:
            environment = {'OSMO_TERRAFORM_WORK_DIR': temporary, 'TF_AWS_REGION': 'us-west-2',
                           'TF_CLUSTER_NAME': 'site', 'TF_K8S_VERSION': '1.34', 'TF_POSTGRES_PASSWORD': 'quoted"secret',
                           'TF_REDIS_PASSWORD': 'cache-password-long'}
            options = self.options('--provider', 'aws', '--profile', 'single-plane')
            with mock.patch.object(deploy, 'command', return_value='123456789012'), contextlib.redirect_stdout(io.StringIO()):
                deploy.prepare_single_plane_aws(options, environment)
                variables = Path(temporary) / 'terraform.tfvars.json'
                original = variables.read_text()
                self.assertEqual(json.loads(original)['rds_password'], 'quoted"secret')
                self.assertEqual(variables.stat().st_mode & 0o777, 0o600)
                self.assertTrue(json.loads(original)['s3_bucket_enabled'])
                self.assertEqual(json.loads(original)['node_ami_type'], 'AL2023_x86_64_STANDARD')
                self.assertEqual(json.loads(original)['gpu_ami_type'], 'AL2023_x86_64_NVIDIA')
                environment['TF_POSTGRES_PASSWORD'] = 'must-not-rotate'
                deploy.prepare_single_plane_aws(options, environment)
                self.assertEqual(variables.read_text(), original)
                with self.assertRaisesRegex(ValueError, 'No existing Terraform state'):
                    deploy.prepare_single_plane_aws(self.options('--provider', 'aws', '--profile', 'single-plane', '--destroy'), environment)
                (Path(temporary) / 'terraform.tfstate').write_text('{}')
                deploy.prepare_single_plane_aws(self.options('--provider', 'aws', '--profile', 'single-plane', '--skip-terraform'), environment)
                environment['TF_AWS_REGION'] = 'us-east-1'
                with self.assertRaisesRegex(ValueError, 'does not match'):
                    deploy.prepare_single_plane_aws(options, environment)
                self.assertEqual(variables.read_text(), original)

    def test_single_plane_aws_context_validates_resolved_tfvars_and_cpu_gpu_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            context = {'region': 'us-west-2', 'cluster': 'site', 'environment': 'dev'}
            (directory / 'deployment-context.json').write_text(json.dumps(context))
            for gpu in [True, False]:
                environment = {}
                with mock.patch.object(deploy, 'command', return_value=json.dumps(json.dumps({**context, 'gpu': gpu, 'gpu_ami_type': 'AL2023_x86_64_NVIDIA'}))):
                    deploy.validate_single_plane_aws_context(directory, environment)
                self.assertEqual(environment['NO_GPU'], '0' if gpu else '1')
                if gpu:
                    self.assertEqual(environment['GPU_DRIVER_ENABLED'], 'false')
                    self.assertEqual(environment['GPU_TOOLKIT_ENABLED'], 'false')
            with mock.patch.object(deploy, 'command', return_value=json.dumps(json.dumps({**context, 'cluster': 'wrong'}))), \
                    self.assertRaisesRegex(ValueError, 'inputs do not match'):
                deploy.validate_single_plane_aws_context(directory, {})

    def test_single_plane_discovers_supported_eks_version_only_on_first_creation(self):
        calls = []
        def cloud(arguments, **kwargs):
            calls.append(arguments)
            return '123456789012' if arguments[1] == 'sts' else '1.34'
        with tempfile.TemporaryDirectory() as temporary:
            environment = {'OSMO_TERRAFORM_WORK_DIR': temporary, 'TF_POSTGRES_PASSWORD': 'db-password',
                           'TF_REDIS_PASSWORD': 'long-cache-password'}
            options = self.options('--provider', 'aws', '--profile', 'single-plane')
            with mock.patch.object(deploy, 'command', side_effect=cloud), contextlib.redirect_stdout(io.StringIO()):
                deploy.prepare_single_plane_aws(options, environment)
                deploy.prepare_single_plane_aws(options, environment)
            self.assertEqual(json.loads((Path(temporary) / 'terraform.tfvars.json').read_text())['kubernetes_version'], '1.34')
            versions = [call for call in calls if call[1] == 'eks']
            self.assertEqual(len(versions), 1)
            self.assertIn('STANDARD_SUPPORT', versions[0])
            self.assertNotIn('--default-only', versions[0])
            self.assertEqual(versions[0][versions[0].index('--query') + 1],
                             'clusterVersions[?defaultVersion].clusterVersion | [0]')

    def test_single_plane_custom_admin_key(self):
        values = {'authentication': {'bootstrap': {'identities': {'admin': {'tokens': {'primary': {
                  'existingSecret': {'name': 'osmo-default-admin', 'key': 'custom-token'}}}}}}},
                  'externalDependencies': {'postgresql': {'tls': {'enabled': False}}}}
        options = self.options('--provider', 'aws', '--profile', 'single-plane')
        with tempfile.TemporaryDirectory() as temporary:
            cluster = FakeCluster()
            deploy.single_plane_credentials(cluster, options, values, {}, Path(temporary), False)
            token = cluster.manifests[0]['stringData']['custom-token']
            self.assertTrue(token)
            existing = FakeCluster()
            with mock.patch.object(existing, 'run', return_value=json.dumps({'data': {
                    'custom-token': base64.b64encode(token.encode()).decode()}})):
                deploy.single_plane_credentials(existing, options, values, {}, Path(temporary), True)
            self.assertFalse(existing.manifests)

    def test_single_plane_byo_credentials_survive_empty_terraform_storage_outputs(self):
        environment = {'STORAGE_ACCESS_KEY_ID': 'byo-id', 'STORAGE_ACCESS_KEY': 'byo-secret'}
        outputs = {'cluster_name': 'site', 's3_bucket': '', 's3_access_key_id': '', 's3_secret_access_key': ''}
        resolved = {'POSTGRES_PASSWORD': 'pg-password', 'REDIS_PASSWORD': 'cache-password',
                    'POSTGRES_DB_NAME': 'osmo', 'POSTGRES_USERNAME': 'postgres'}
        with mock.patch.object(deploy, 'validate_single_plane_aws_context'), \
                mock.patch.object(deploy, 'terraform_outputs', return_value=outputs), \
                mock.patch.object(deploy, 'command', return_value=json.dumps(json.dumps(resolved))):
            deploy.provision(self.options('--provider', 'aws', '--profile', 'single-plane',
                '--skip-terraform', '--storage-backend', 'byo'), environment)
        self.assertEqual(environment['STORAGE_ACCESS_KEY_ID'], 'byo-id')
        self.assertEqual(environment['STORAGE_ACCESS_KEY'], 'byo-secret')

    def test_aws_single_plane_full_orchestration_reuses_state_and_credentials(self):
        actual_command = deploy.command
        events = []
        cluster = FakeCluster()
        admin_tokens = []
        helm_values = []
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / 'state'
            state.mkdir()
            environment = {'PATH': os.environ['PATH'], 'OSMO_TERRAFORM_WORK_DIR': str(state),
                           'TF_POSTGRES_PASSWORD': 'db-password-sentinel',
                           'TF_REDIS_PASSWORD': 'cache-password-sentinel'}
            outputs = {'cluster_name': 'site-dev', 'aws_region': 'us-west-2',
                       'rds_instance_address': 'rds.example', 'rds_instance_port': 5432,
                       'redis_primary_endpoint_address': 'cache.example', 's3_bucket': 'private-bucket',
                       's3_access_key_id': 's3-identity', 's3_secret_access_key': 's3-secret-sentinel'}
            def command(arguments, **kwargs):
                events.append(tuple(map(str, arguments[:3])))
                if arguments[0] == 'aws':
                    self.assertEqual(kwargs['env']['AWS_PROFILE'], 'selected-profile')
                    if arguments[1] == 'sts':
                        return '123456789012'
                    if arguments[2] == 'describe-cluster-versions':
                        return '1.34'
                    if arguments[2] == 'update-kubeconfig':
                        return ''
                    self.fail('Unexpected AWS command')
                if arguments[0] == 'terraform':
                    inputs = json.loads((state / 'terraform.tfvars.json').read_text())
                    if arguments[2] == 'output':
                        return json.dumps({key: {'value': value} for key, value in outputs.items()})
                    if 'POSTGRES_PASSWORD' in kwargs['stdin']:
                        return json.dumps(json.dumps({'POSTGRES_PASSWORD': inputs['rds_password'],
                            'REDIS_PASSWORD': inputs['redis_auth_token'], 'POSTGRES_DB_NAME': inputs['rds_db_name'],
                            'POSTGRES_USERNAME': inputs['rds_username']}))
                    return json.dumps(json.dumps({'region': inputs['aws_region'], 'cluster': inputs['cluster_name'],
                        'environment': inputs['environment'], 'gpu': inputs['gpu_node_pool_enabled'],
                        'gpu_ami_type': inputs['gpu_ami_type']}))
                if arguments[:3] == ['helm', 'show', 'values']:
                    return actual_command(['helm', 'show', 'values', ROOT / 'deployments/charts/osmo'], **kwargs)
                if arguments[:2] == ['helm', 'lint'] or arguments[:3] == ['helm', 'template', 'osmo']:
                    return ''
                if arguments[0] == 'curl':
                    Path(arguments[arguments.index('--output') + 1]).write_text('-----BEGIN CERTIFICATE-----\nmock\n')
                    return ''
                return actual_command(arguments, **kwargs)
            def driver(provider, function, env, directory, *arguments):
                events.append((provider, function))
                self.assertEqual(env['AWS_PROFILE'], 'selected-profile')
                if function == 'terraform_apply':
                    (Path(directory) / 'terraform.tfstate').write_text('{}')
            def verify(_cluster, _options, values, env):
                self.assertEqual(env['OSMO_LOGIN_METHOD'], 'token')
                self.assertEqual(env['NO_GPU'], '1')
                admin_tokens.append(Path(env['OSMO_TOKEN_FILE']).read_text())
                self.assertTrue(values['gateway']['authz']['enabled'])
            actual_run = cluster.run
            def run(tool, *arguments, **kwargs):
                if tool == 'helm' and arguments[0] == 'upgrade' and '-f' in arguments:
                    helm_values.append(json.loads(Path(arguments[arguments.index('-f') + 1]).read_text()))
                if tool == 'kubectl' and arguments[:3] == ('get', 'secret', 'osmo-default-admin'):
                    existing = [item for item in cluster.manifests if item['metadata']['name'] == 'osmo-default-admin']
                    if existing:
                        return json.dumps({'data': {'password': base64.b64encode(existing[0]['stringData']['password'].encode()).decode()}})
                    return ''
                return actual_run(tool, *arguments, **kwargs)
            with mock.patch.dict(os.environ, environment, clear=True), \
                    mock.patch.object(deploy, 'command', side_effect=command), \
                    mock.patch.object(deploy, 'driver', side_effect=driver), \
                    mock.patch.object(deploy, 'prepare_chart', return_value=Path(temporary) / 'osmo.tgz'), \
                    mock.patch.object(deploy, 'Cluster', return_value=cluster), \
                    mock.patch.object(cluster, 'run', side_effect=run), \
                    mock.patch.object(deploy, 'prerequisites'), mock.patch.object(deploy, 'verify', side_effect=verify), \
                    contextlib.redirect_stdout(io.StringIO()):
                arguments = ['--provider', 'aws', '--profile', 'single-plane', '--aws-profile', 'selected-profile',
                             '--cluster-name', 'site', '--non-interactive']
                # preflight has no directory argument; record it independently.
                with mock.patch.object(deploy, 'driver', side_effect=lambda p, f, e, *args:
                        driver(p, f, e, args[0] if args else state, *args[1:])):
                    deploy.main(arguments)
                    cluster.previous = helm_values[0]
                    os.environ['TF_POSTGRES_PASSWORD'] = 'ignored-on-rerun'
                    deploy.main(arguments + ['--skip-terraform'])
            self.assertEqual(admin_tokens[0], admin_tokens[1])
            self.assertEqual(sum(event == ('aws', 'terraform_apply') for event in events), 1)
            self.assertTrue((state / 'terraform.tfstate').exists())
            self.assertEqual(json.loads((state / 'terraform.tfvars.json').read_text())['rds_password'], 'db-password-sentinel')
            for credential in ['db-password-sentinel', 'cache-password-sentinel', 's3-secret-sentinel', admin_tokens[0]]:
                self.assertNotIn(credential, json.dumps(helm_values))
            credentials = [item for item in cluster.manifests if item['metadata']['name'] == 'osmo-postgresql']
            self.assertTrue(all(item['stringData']['db-password'] == 'db-password-sentinel' for item in credentials))

    def test_enabling_gpu_preserves_stored_capacity_and_accepts_explicit_resize(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            inputs = {'gpu_node_pool_enabled': True, 'gpu_instance_type': 'p4d.24xlarge',
                      'gpu_node_group_min_size': 3, 'gpu_node_group_max_size': 5}
            (state / 'terraform.tfvars.json').write_text(json.dumps(inputs))
            environment = {'OSMO_TERRAFORM_WORK_DIR': temporary}
            options = self.options('--provider', 'aws', '--profile', 'single-plane', '--gpu-node-pool')
            with mock.patch.object(deploy, 'command', return_value='123456789012'), contextlib.redirect_stdout(io.StringIO()):
                deploy.prepare_single_plane_aws(options, environment)
                self.assertEqual(json.loads((state / 'terraform.tfvars.json').read_text()), inputs)
                environment['TF_GPU_COUNT'] = '4'
                deploy.prepare_single_plane_aws(options, environment)
                resized = json.loads((state / 'terraform.tfvars.json').read_text())
                self.assertEqual(resized['gpu_instance_type'], 'p4d.24xlarge')
                self.assertEqual(resized['gpu_node_group_min_size'], 4)
                self.assertEqual(resized['gpu_node_group_max_size'], 5)

    def test_gpu_operator_reuses_preinstalled_eks_driver_and_toolkit(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            log = directory / 'commands'
            for tool in ['kubectl', 'helm']:
                executable = directory / tool
                executable.write_text('#!/bin/sh\necho "$0 $*" >> "$COMMAND_LOG"\n'
                                      'if [ "$1" = list ]; then echo "[]"; fi\n')
                executable.chmod(0o700)
            environment = {**os.environ, 'PATH': str(directory) + os.pathsep + os.environ['PATH'],
                           'COMMAND_LOG': str(log), 'GPU_DRIVER_ENABLED': 'false',
                           'GPU_TOOLKIT_ENABLED': 'false', 'NO_GPU': '0'}
            subprocess.run(['bash', ROOT / 'deployments/scripts/install-gpu-operator.sh'],
                           env=environment, capture_output=True, text=True, check=True)
            install = next(line for line in log.read_text().splitlines() if 'upgrade --install' in line)
            self.assertIn('--set driver.enabled=false', install)
            self.assertIn('--set toolkit.enabled=false', install)

    def test_removed_microk8s_provider_is_rejected(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.options('--provider', 'microk8s')


if __name__ == '__main__':
    unittest.main()
