#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
"""Install the unified chart; cloud provisioning stays in the provider drivers."""

import argparse
import base64
import hashlib
import copy
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile
import time


SCRIPTS = Path(__file__).resolve().parents[1]
ROOT = SCRIPTS.parents[1]
LEGACY_ROOTS = {'global', 'serviceAccount', 'secretRefs'}
LEGACY_SERVICES = {'configs', 'service', 'postgres', 'redis', 'defaultAdmin',
                   'backendApiTokens'}


def merge(*documents):
    """Merge mappings like Helm values; lists and scalar values replace."""
    result = {}
    for document in documents:
        for key, value in document.items():
            if isinstance(value, dict) and isinstance(result.get(key), dict):
                result[key] = merge(result[key], value)
            else:
                result[key] = copy.deepcopy(value)
    return result


def reject_legacy(values):
    invalid = sorted(LEGACY_ROOTS.intersection(values))
    invalid += [f'secrets.{key}' for key in ['defaultAdmin', 'backendApiTokens']
                if key in values.get('secrets', {})]
    services = values.get('services', {})
    if isinstance(services, dict):
        invalid += [f'services.{key}' for key in sorted(LEGACY_SERVICES.intersection(services))]
    if invalid:
        raise ValueError('Legacy chart values are not supported: ' + ', '.join(invalid) +
                         '. Translate them using deployments/charts/osmo/README.md.')


def command(arguments, *, capture=False, env=None, stdin=None):
    result = subprocess.run([str(item) for item in arguments], check=True, text=True,
                            input=stdin, stdout=subprocess.PIPE if capture else None, env=env)
    return result.stdout if capture else ''


class Cluster:
    """Array-based local execution or private AKS execution with explicit uploads."""

    def __init__(self, environment, directory, private=False):
        self.environment = environment
        self.directory = directory
        self.private = private

    def run(self, tool, *arguments, capture=False):
        if not self.private:
            return command([tool, *arguments], capture=capture, env=self.environment)
        local_environment = {**self.environment, 'PATH': self.environment.get('OSMO_LOCAL_PATH', self.environment.get('PATH', ''))}
        local_helm = self.environment.get('OSMO_LOCAL_HELM', 'helm')
        if tool == 'helm' and arguments[0] == 'repo':
            return command([local_helm, *arguments], capture=capture, env=local_environment)
        with tempfile.TemporaryDirectory(prefix='aks-command-', dir=self.directory) as temporary:
            upload = Path(temporary)
            files = []
            remote = [tool]
            arguments = list(arguments)
            if tool == 'helm' and arguments[0] in ['install', 'upgrade']:
                position = 1 + (arguments[1] == '--install')
                chart_position = position + 1
                reference = str(arguments[chart_position])
                if not Path(reference).is_file():
                    pull = [local_helm, 'pull', reference, '--destination', upload]
                    if '--version' in arguments:
                        pull.extend(['--version', arguments[arguments.index('--version') + 1]])
                    command(pull, env=local_environment)
                    arguments[chart_position] = next(upload.glob('*.tgz'))
            for argument in arguments:
                value = str(argument)
                # Only explicitly supplied regular files enter the remote command.
                # Charts are packaged locally; directories and Terraform state never enter it.
                if Path(value).is_file():
                    name = f'input-{len(files)}{Path(value).suffix}'
                    target = upload / name
                    shutil.copyfile(value, target)
                    files.extend(['--file', str(target)])
                    value = name
                remote.append(value)
            response = json.loads(command([
                'az', 'aks', 'command', 'invoke', '--subscription', self.environment['TF_SUBSCRIPTION_ID'],
                '--resource-group', self.environment['RESOURCE_GROUP_NAME'],
                '--name', self.environment['AKS_CLUSTER_NAME'],
                '--command', shlex.join(remote), *files, '--output', 'json',
            ], capture=True, env=self.environment))
            if response.get('exitCode') != 0:
                # Do not replay remote output: read commands may return Secret contents.
                raise RuntimeError(f'Private AKS {tool} command failed (exitCode={response.get("exitCode")})')
            output = response.get('logs', '')
            if capture:
                return output
            print(output, end='')
            return ''

    def apply(self, manifest):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', dir=self.directory) as stream:
            json.dump(manifest, stream)
            stream.flush()
            self.run('kubectl', 'apply', '-f', stream.name)

    def secret(self, namespace, name, data):
        self.apply({'apiVersion': 'v1', 'kind': 'Secret',
                    'metadata': {'name': name, 'namespace': namespace},
                    'type': 'Opaque', 'stringData': data})


def inspect_values(directory, files=(), settings=(), defaults=None):
    """Use Helm's own YAML parsing and merge semantics, without running OSMO hooks."""
    chart = directory / 'inspect'
    chart.mkdir(exist_ok=True)
    (chart / 'templates').mkdir(exist_ok=True)
    (chart / 'Chart.yaml').write_text('apiVersion: v2\nname: inspect-values\nversion: 0.0.0\n')
    (chart / 'templates/values.yaml').write_text('{{ .Values | toJson }}\n')
    (chart / 'values.yaml').write_text(json.dumps(defaults or {}))
    arguments = ['helm', 'template', 'inspect-values', chart]
    for file in files:
        arguments.extend(['--values', file])
    for setting in settings:
        arguments.extend(['--set', setting])
    output = command(arguments, capture=True)
    return json.loads('\n'.join(line for line in output.splitlines()
                                if not line.startswith(('#', '---'))))


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument('--provider', choices=['azure', 'aws', 'byo'], default='byo')
    result.add_argument('--profile', choices=['quickstart', 'single-plane'], default='quickstart')
    result.add_argument('--namespace', default=os.environ.get('OSMO_NAMESPACE', 'osmo'))
    result.add_argument('--release', default=os.environ.get('OSMO_RELEASE', 'osmo'))
    chart_source = result.add_mutually_exclusive_group()
    chart_source.add_argument('--chart-path', type=Path,
                              help='Local unified chart directory, including one in another main checkout')
    chart_source.add_argument('--chart-version', default=os.environ.get('OSMO_CHART_VERSION', ''))
    result.add_argument('--helm-values', '--values', action='append', default=[])
    result.add_argument('--helm-set', action='append', default=[])
    result.add_argument('--storage-backend', choices=['auto', 'embedded', 's3', 'azure-blob', 'byo'],
                        default=os.environ.get('STORAGE_BACKEND', 'auto'))
    result.add_argument('--auth-method', choices=['static', 'workload-identity'],
                        default=os.environ.get('AUTH_METHOD', 'static'))
    for flag in ['skip-terraform', 'skip-osmo', 'skip-prerequisites', 'destroy', 'dry-run',
                 'non-interactive', 'gpu-node-pool', 'with-nfs-storage', 'no-gpu',
                 'skip-verify', 'list-chart-versions']:
        result.add_argument('--' + flag, action='store_true')
    result.add_argument('--find-gpu-region', nargs=2, metavar=('SKU', 'COUNT'))
    for flag in ['subscription-id', 'resource-group', 'postgres-password', 'redis-password',
                 'cluster-name', 'region', 'environment', 'k8s-version', 'aws-region',
                 'aws-profile', 'ngc-api-key', 'ngc-secret-name',
                 'workload-identity-client-id', 'workload-identity-role-arn']:
        result.add_argument('--' + flag)
    return result


def configure_environment(options):
    environment = dict(os.environ)
    aliases = {'subscription_id': 'TF_SUBSCRIPTION_ID', 'resource_group': 'TF_RESOURCE_GROUP',
               'postgres_password': 'TF_POSTGRES_PASSWORD', 'redis_password': 'TF_REDIS_PASSWORD',
               'cluster_name': 'TF_CLUSTER_NAME', 'region': 'TF_REGION',
               'environment': 'TF_ENVIRONMENT', 'k8s_version': 'TF_K8S_VERSION',
               'aws_region': 'TF_AWS_REGION', 'aws_profile': 'TF_AWS_PROFILE',
               'ngc_api_key': 'NGC_API_KEY', 'ngc_secret_name': 'NGC_SECRET_NAME',
               'workload_identity_client_id': 'WORKLOAD_IDENTITY_CLIENT_ID',
               'workload_identity_role_arn': 'WORKLOAD_IDENTITY_ROLE_ARN'}
    for option, variable in aliases.items():
        value = getattr(options, option)
        if value is not None:
            environment[variable] = value
    for password in ['POSTGRES_PASSWORD', 'REDIS_PASSWORD']:
        if environment.get('TF_' + password):
            environment[password] = environment['TF_' + password]
    if options.gpu_node_pool:
        environment['TF_GPU_NODE_POOL_ENABLED'] = 'true'
    if options.with_nfs_storage:
        if options.provider != 'azure':
            raise ValueError('--with-nfs-storage requires --provider azure')
        environment['TF_NFS_STORAGE_ACCOUNT_ENABLED'] = 'true'
    environment['NO_GPU'] = '1' if options.no_gpu else environment.get('NO_GPU', '0')
    if environment.get('TF_AWS_PROFILE'):
        environment['AWS_PROFILE'] = environment['TF_AWS_PROFILE']
    if environment.get('TF_AWS_REGION'):
        environment['AWS_REGION'] = environment['TF_AWS_REGION']
    return environment


def driver(provider, function, environment, *arguments):
    command(['bash', '-euc', 'source "$1"; source "$2"; shift 2; "$@"', 'osmo',
             SCRIPTS / 'common.sh', SCRIPTS / provider / 'terraform.sh',
             f'{provider}_{function}', *arguments], env=environment)


def terraform_outputs(directory, environment):
    outputs = json.loads(command(['terraform', f'-chdir={directory}', 'output', '-json'],
                                 capture=True, env=environment))
    return {name: entry['value'] for name, entry in outputs.items()}


def configure_interactively(provider, environment, variables):
    # Export shell-selected TF_* values so later provider operations use the same context.
    with tempfile.TemporaryDirectory(prefix='osmo-provider-') as temporary:
        selected = Path(temporary) / 'environment.json'
        command(['bash', '-euc', 'set -a; source "$1"; source "$2"; '
                 '"$3"; "$4" "$5"; "$6" -c "$7" "$8"', 'osmo', SCRIPTS / 'common.sh',
                 SCRIPTS / provider / 'terraform.sh', f'{provider}_configure_interactively',
                 f'{provider}_generate_tfvars', variables, sys.executable,
                 'import json, os, pathlib, sys; pathlib.Path(sys.argv[1]).write_text('
                 'json.dumps({k: v for k, v in os.environ.items() if k.startswith("TF_")}))',
                 selected], env=environment)
        environment.update(json.loads(selected.read_text()))
    if provider == 'aws':
        environment['AWS_PROFILE'] = environment['TF_AWS_PROFILE']
        environment['AWS_REGION'] = environment['TF_AWS_REGION']


def prepare_single_plane_aws(options: argparse.Namespace, environment: dict) -> None:
    """Keep AWS state and inputs outside the temporary credential directory."""
    region = environment.get('TF_AWS_REGION') or environment.get('TF_VAR_aws_region') or environment.get('AWS_REGION') or environment.get('AWS_DEFAULT_REGION', 'us-west-2')
    cluster_name = environment.get('TF_CLUSTER_NAME') or environment.get('TF_VAR_cluster_name', 'osmo-cluster')
    deployment_environment = environment.get('TF_ENVIRONMENT', environment.get('TF_VAR_environment', 'dev'))
    environment.update(AWS_REGION=region, TF_AWS_REGION=region, TF_CLUSTER_NAME=cluster_name)
    account = command(['aws', 'sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'],
                      capture=True, env=environment).strip()
    if not re.fullmatch(r'\d{12}', account):
        raise ValueError('Unable to determine AWS account for single-plane state')
    context = {'account': account, 'region': region, 'cluster': cluster_name, 'environment': deployment_environment}
    state_key = hashlib.sha256(json.dumps(context, sort_keys=True).encode()).hexdigest()[:20]
    source = ROOT / 'deployments/terraform/aws/example'
    working = Path(environment.get('OSMO_TERRAFORM_WORK_DIR') or environment.get('AWS_TERRAFORM_DIR') or
                   source / '.osmo' / f'{account}-{state_key}').resolve()
    context_file = working / 'deployment-context.json'
    if context_file.exists() and json.loads(context_file.read_text()) != context:
        raise ValueError('AWS account/region/cluster does not match the selected Terraform working directory')
    if (options.skip_terraform or options.destroy) and not (working / 'terraform.tfstate').is_file():
        raise ValueError(f'No existing Terraform state in {working}; cannot reuse or destroy this deployment')
    if (working / 'terraform.tfstate').exists() and not context_file.exists():
        raise ValueError('Unrecognized single-plane state directory; use deploy-osmo.sh for existing legacy Terraform state')
    working.mkdir(parents=True, exist_ok=True)
    environment['AWS_TERRAFORM_DIR'] = str(working)
    if options.skip_terraform or options.destroy:
        print(f'Using AWS Terraform state: {working}')
        return
    for file in source.glob('*.tf'):
        shutil.copyfile(file, working / file.name)
    lock = source / '.terraform.lock.hcl'
    if lock.exists() and not (working / lock.name).exists():
        shutil.copyfile(lock, working / lock.name)
    variables = working / 'terraform.tfvars.json'
    if not variables.exists() and not (working / 'terraform.tfvars').exists():
        password = environment.get('TF_POSTGRES_PASSWORD') or environment.get('TF_VAR_rds_password')
        cache_password = environment.get('TF_REDIS_PASSWORD') or environment.get('TF_VAR_redis_auth_token')
        if not password or not cache_password:
            raise ValueError('Set TF_POSTGRES_PASSWORD and TF_REDIS_PASSWORD (or TF_VAR_rds_password and '
                             f'TF_VAR_redis_auth_token), or create {variables}')
        inputs = {'aws_region': region, 'cluster_name': cluster_name, 'environment': deployment_environment,
                  'rds_password': password, 'redis_auth_token': cache_password,
                  'rds_db_name': environment.get('POSTGRES_DB_NAME', 'osmo'),
                  'rds_username': environment.get('POSTGRES_USERNAME', 'postgres'),
                  'rds_instance_class': 'db.t3.medium', 'single_nat_gateway': True,
                  's3_bucket_enabled': options.storage_backend in ['auto', 's3'],
                  'node_instance_types': [environment.get('TF_NODE_INSTANCE_TYPE', 't3.xlarge')],
                  'node_ami_type': 'AL2023_x86_64_STANDARD', 'gpu_ami_type': 'AL2023_x86_64_NVIDIA',
                  'gpu_node_pool_enabled': environment.get('TF_GPU_NODE_POOL_ENABLED', 'false') == 'true',
                  'gpu_instance_type': environment.get('TF_GPU_INSTANCE_TYPE', 'g5.xlarge'),
                  'gpu_node_group_min_size': int(environment.get('TF_GPU_COUNT', '1' if environment.get('TF_GPU_NODE_POOL_ENABLED') == 'true' else '0')),
                  'gpu_node_group_max_size': int(environment.get('TF_GPU_MAX_COUNT', environment.get('TF_GPU_COUNT', '1')))}
        version = environment.get('TF_K8S_VERSION') or environment.get('TF_VAR_kubernetes_version')
        if not version:
            version = command(['aws', 'eks', 'describe-cluster-versions', '--region', region,
                               '--version-status', 'STANDARD_SUPPORT',
                               '--query', 'clusterVersions[?defaultVersion].clusterVersion | [0]',
                               '--output', 'text'],
                              capture=True, env=environment).strip()
            if not re.fullmatch(r'1\.\d+', version):
                raise ValueError('No standard-support EKS default found; supply --k8s-version')
        inputs['kubernetes_version'] = version
        variables.write_text(json.dumps(inputs, indent=2) + '\n')
        variables.chmod(0o600)
    # On reruns the persistent inputs are authoritative, including credentials.
    # Explicit scale/version flags update only the named non-secret settings.
    overrides = {}
    if options.gpu_node_pool:
        stored = json.loads(variables.read_text()) if variables.exists() else {}
        overrides['gpu_node_pool_enabled'] = True
        for variable, key, convert in [('TF_GPU_INSTANCE_TYPE', 'gpu_instance_type', str),
                                       ('TF_GPU_COUNT', 'gpu_node_group_min_size', int),
                                       ('TF_GPU_MAX_COUNT', 'gpu_node_group_max_size', int)]:
            if variable in environment:
                overrides[key] = convert(environment[variable])
        if not stored.get('gpu_node_pool_enabled') and 'TF_GPU_COUNT' not in environment:
            overrides['gpu_node_group_min_size'] = max(1, stored.get('gpu_node_group_min_size', 0))
        if 'gpu_node_group_min_size' in overrides and 'TF_GPU_MAX_COUNT' not in environment:
            overrides['gpu_node_group_max_size'] = max(overrides['gpu_node_group_min_size'],
                                                      stored.get('gpu_node_group_max_size', 1))
    if options.k8s_version:
        overrides['kubernetes_version'] = options.k8s_version
    if overrides:
        if not variables.exists():
            raise ValueError('Update GPU/version settings in the existing terraform.tfvars before rerunning')
        variables.write_text(json.dumps(merge(json.loads(variables.read_text()), overrides), indent=2) + '\n')
    context_file.write_text(json.dumps(context, indent=2) + '\n')
    print(f'Using AWS Terraform state: {working}')


def validate_single_plane_aws_context(directory: Path, environment: dict) -> None:
    encoded = command(['terraform', f'-chdir={directory}', 'console'], capture=True, env=environment,
                      stdin='jsonencode({region=var.aws_region, cluster=var.cluster_name, environment=var.environment, gpu=var.gpu_node_pool_enabled, gpu_ami_type=var.gpu_ami_type})\n')
    resolved = json.loads(json.loads(encoded))
    expected = json.loads((directory / 'deployment-context.json').read_text())
    if any(resolved[key] != expected[key] for key in ['region', 'cluster', 'environment']):
        raise ValueError('Terraform inputs do not match the selected AWS account/region/cluster state; '
                         'use matching flags and working directory')
    if resolved['gpu'] and resolved.get('gpu_ami_type') == 'AL2023_x86_64_NVIDIA':
        environment.setdefault('GPU_DRIVER_ENABLED', 'false')
        environment.setdefault('GPU_TOOLKIT_ENABLED', 'false')
    if environment.get('NO_GPU') != '1':
        environment['NO_GPU'] = '0' if resolved['gpu'] else '1'


def single_plane_credentials(cluster: Cluster, options: argparse.Namespace, values: dict,
                             environment: dict, directory: Path, upgrading: bool) -> None:
    """Prepare token login and the public RDS CA without putting credentials in Helm."""
    credential = values['authentication']['bootstrap']['identities']['admin']['tokens']['primary']
    reference = credential.get('existingSecret') or {}
    name = reference.get('name')
    password_key = reference.get('key', 'token')
    if not name or credential.get('managedSecret'):
        raise ValueError('AWS single-plane requires an existingSecret for its administrator token')
    document = json.loads(cluster.run('kubectl', 'get', 'secret', name, '-n', options.namespace,
                                     '--ignore-not-found', '-o', 'json', capture=True) or '{}')
    if document:
        encoded = document.get('data', {}).get(password_key, '')
        if not encoded:
            raise ValueError(f'Restore administrator Secret {name} with key {password_key}')
        token = base64.b64decode(encoded, validate=True).decode()
        if not token.strip():
            raise ValueError(f'Administrator Secret {name} has an empty token')
    elif upgrading or name != 'osmo-default-admin':
        raise ValueError(f'Restore or provision administrator Secret {name} before deployment')
    else:
        token = secrets.token_urlsafe(32)
        cluster.secret(options.namespace, name, {password_key: token})
    token_file = directory / 'admin-token'
    token_file.write_text(token)
    token_file.chmod(0o600)
    environment.update(OSMO_LOGIN_METHOD='token', OSMO_TOKEN_FILE=str(token_file))
    tls = values['externalDependencies']['postgresql']['tls']
    if tls['enabled'] and tls['caExistingSecret'] == 'osmo-postgresql-ca':
        certificate = directory / 'rds-ca.pem'
        if environment.get('POSTGRES_CA_FILE'):
            certificate.write_bytes(Path(environment['POSTGRES_CA_FILE']).read_bytes())
        else:
            command(['curl', '--fail', '--silent', '--show-error', '--location',
                     '--proto', '=https', '--proto-redir', '=https', '--max-time', '60',
                     'https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem',
                     '--output', certificate], env=environment)
        if '-----BEGIN CERTIFICATE-----' not in certificate.read_text():
            raise ValueError('RDS CA bundle contains no PEM certificate')
        cluster.secret(options.namespace, tls['caExistingSecret'], {tls['caKey']: certificate.read_text()})


def provision(options, environment):
    if options.provider == 'byo':
        return None, False
    provider = options.provider
    directory = Path(environment.get(f'{provider.upper()}_TERRAFORM_DIR',
                                    ROOT / f'deployments/terraform/{provider}/example')).resolve()
    if options.storage_backend in ['auto', 's3'] and provider == 'aws':
        environment['TF_S3_BUCKET_ENABLED'] = 'true'
    if options.storage_backend in ['auto', 'azure-blob'] and provider == 'azure':
        environment['TF_STORAGE_ACCOUNT_ENABLED'] = 'true'
    if not options.skip_terraform and not options.destroy:
        variables = directory / 'terraform.tfvars'
        required = ['TF_POSTGRES_PASSWORD'] + (['TF_REDIS_PASSWORD'] if provider == 'aws' else [])
        if options.profile == 'single-plane':
            pass  # prepare_single_plane_aws owns persistent JSON inputs.
        elif all(environment.get(key) for key in required):
            driver(provider, 'generate_tfvars', environment, variables)
        elif not variables.exists():
            if options.non_interactive:
                raise ValueError(f'Create {variables} or supply the required database passwords')
            configure_interactively(provider, environment, variables)
        driver(provider, 'preflight_checks', environment)
        driver(provider, 'terraform_init', environment, directory)
        if options.profile == 'single-plane':
            validate_single_plane_aws_context(directory, environment)
        driver(provider, 'terraform_apply', environment, directory, 'false')
    if options.profile == 'single-plane' and options.skip_terraform:
        validate_single_plane_aws_context(directory, environment)
    outputs = terraform_outputs(directory, environment)
    if provider == 'aws':
        encoded = command(['terraform', f'-chdir={directory}', 'console'], capture=True, env=environment,
                          stdin='nonsensitive(jsonencode({POSTGRES_PASSWORD=var.rds_password, REDIS_PASSWORD=var.redis_auth_token, POSTGRES_DB_NAME=var.rds_db_name, POSTGRES_USERNAME=var.rds_username}))\n')
        for key, value in json.loads(json.loads(encoded)).items():
            if options.profile == 'single-plane':
                environment[key] = value
            else:
                environment.setdefault(key, value)
    if provider == 'azure':
        mapping = {'RESOURCE_GROUP_NAME': 'resource_group_name', 'AKS_CLUSTER_NAME': 'aks_cluster_name',
                   'POSTGRES_HOST': 'postgres_server_fqdn', 'POSTGRES_DB_NAME': 'postgres_database_name',
                   'POSTGRES_USERNAME': 'postgres_admin_username', 'POSTGRES_PASSWORD': 'postgres_password',
                   'REDIS_HOST': 'redis_cache_hostname', 'REDIS_PORT': 'redis_cache_ssl_port',
                   'REDIS_PASSWORD': 'redis_cache_primary_access_key',
                   'STORAGE_ACCOUNT': 'storage_account', 'STORAGE_KEY': 'storage_account_key'}
        for name, output in mapping.items():
            if outputs.get(output) is not None and (options.profile == 'single-plane' or not environment.get(name)):
                environment[name] = str(outputs[output])
        if not environment.get('TF_SUBSCRIPTION_ID'):
            environment['TF_SUBSCRIPTION_ID'] = command(
                ['terraform', f'-chdir={directory}', 'console'], capture=True, env=environment,
                stdin='jsonencode(var.subscription_id)\n')
            environment['TF_SUBSCRIPTION_ID'] = json.loads(json.loads(environment['TF_SUBSCRIPTION_ID']))
        if not environment.get('POSTGRES_PASSWORD'):
            password = command(['terraform', f'-chdir={directory}', 'console'], capture=True,
                               env=environment, stdin='nonsensitive(jsonencode(var.postgres_password))\n')
            environment['POSTGRES_PASSWORD'] = json.loads(json.loads(password))
        private_fqdn = command(['az', 'aks', 'show', '--subscription', environment['TF_SUBSCRIPTION_ID'],
                                '-g', environment['RESOURCE_GROUP_NAME'], '-n', environment['AKS_CLUSTER_NAME'],
                                '--query', 'privateFqdn', '-o', 'tsv'], capture=True).strip()
        private = private_fqdn not in ['', 'null', 'None']
        if not private:
            command(['az', 'aks', 'get-credentials', '--subscription', environment['TF_SUBSCRIPTION_ID'],
                     '-g', environment['RESOURCE_GROUP_NAME'], '-n', environment['AKS_CLUSTER_NAME'],
                     '--admin', '--overwrite-existing'], env=environment)
    else:
        mapping = {'EKS_CLUSTER_NAME': 'cluster_name', 'POSTGRES_HOST': 'rds_instance_address', 'POSTGRES_PORT': 'rds_instance_port',
                   'REDIS_HOST': 'redis_primary_endpoint_address', 'AWS_REGION': 'aws_region',
                   'STORAGE_BUCKET': 's3_bucket', 'STORAGE_ACCESS_KEY_ID': 's3_access_key_id',
                   'STORAGE_ACCESS_KEY': 's3_secret_access_key'}
        for name, output in mapping.items():
            if name.startswith('STORAGE_') and not outputs.get(output):
                continue
            if outputs.get(output) is not None and (options.profile == 'single-plane' or not environment.get(name)):
                environment[name] = str(outputs[output])
        environment.setdefault('POSTGRES_DB_NAME', 'osmo')
        environment.setdefault('POSTGRES_USERNAME', 'postgres')
        environment.setdefault('REDIS_PORT', '6379')
        command(['aws', 'eks', 'update-kubeconfig', '--region', environment.get('AWS_REGION', 'us-west-2'),
                 '--name', environment['EKS_CLUSTER_NAME']], env=environment)
        private = False
    if options.profile == 'single-plane':
        environment.setdefault('POSTGRES_TLS_ENABLED', 'true')
    environment.setdefault('REDIS_TLS_ENABLED', 'true')
    return directory, private


def connection_values(options, environment, supplied=None):
    values = {}
    gpu = (supplied or {}).get('configuration', {}).get('podTemplates', {}).get('default_gpu_user', {})
    if 'tolerations' not in gpu.get('spec', {}):
        values = {'configuration': {'podTemplates': {'default_gpu_user': {'spec': {
            'tolerations': [{'key': 'nvidia.com/gpu', 'operator': 'Exists', 'effect': 'NoSchedule'}]}}}}}
    for name, prefix, selector in [('postgresql', 'POSTGRES', 'postgresql'), ('valkey', 'REDIS', 'valkey')]:
        if environment.get(prefix + '_HOST'):
            connection = {'host': environment[prefix + '_HOST'],
                          'port': int(environment.get(prefix + '_PORT', '5432' if name == 'postgresql' else '6379')),
                          'tls': {'enabled': environment.get(prefix + '_TLS_ENABLED', 'false') == 'true'}}
            if name == 'postgresql':
                connection.update(database=environment.get('POSTGRES_DB_NAME', 'osmo'),
                                  username=environment.get('POSTGRES_USERNAME', 'postgres'))
            values = merge(values, {'embeddedDependencies': {name: {'enabled': False}},
                                    'externalDependencies': {name: connection},
                                    'secrets': {selector: {'existingSecret': f'{options.release}-{name}'}}})
            if name == 'valkey':
                values['secrets'][selector]['generate'] = False
    registry = environment.get('OSMO_IMAGE_REGISTRY')
    if registry:
        if '/' not in registry or not all(registry.split('/', 1)):
            raise ValueError('OSMO_IMAGE_REGISTRY must contain a registry host and repository path')
        values.update(zip(['imageRegistry', 'imageRepository'], registry.split('/', 1)))
    if environment.get('OSMO_IMAGE_TAG'):
        values.update(imageTag=environment['OSMO_IMAGE_TAG'], runtimeImage={'tag': environment['OSMO_IMAGE_TAG']})
    pull = environment.get('OSMO_IMAGE_PULL_SECRET') or environment.get('NGC_SECRET_NAME')
    if not pull and environment.get('NGC_API_KEY'):
        pull = 'nvcr-pull'
    if pull:
        values = merge(values, {'imagePullSecrets': [{'name': pull}], 'configuration': {'workflow': {
            'backend_images': {'credential': {'secretName': pull, 'secretKey': '.dockerconfigjson'}}}}})
    backend = options.storage_backend
    if backend == 'auto':
        supplied = supplied or {}
        if ('objectStorage' in supplied.get('externalDependencies', {}) or
                'objectStorage' in supplied.get('embeddedDependencies', {})):
            return values
        if options.provider == 'azure':
            backend = 'azure-blob'
        elif options.provider == 'aws':
            backend = 's3'
        elif environment.get('STORAGE_ENDPOINT'):
            backend = 'byo'
        else:
            return values
    if backend == 'embedded':
        return merge(values, {'embeddedDependencies': {'objectStorage': {'enabled': True}}})
    if backend == 'azure-blob':
        account = environment.get('STORAGE_ACCOUNT')
        if not account:
            raise ValueError('Set STORAGE_ACCOUNT for Azure Blob storage')
        endpoint = f'azure://{account}/{environment.get("AZURE_CONTAINER_NAME", "osmo-workflows")}'
    elif backend == 's3':
        if not environment.get('STORAGE_BUCKET'):
            raise ValueError('Set STORAGE_BUCKET for S3 storage')
        endpoint = 's3://' + environment['STORAGE_BUCKET']
    else:
        endpoint = environment.get('STORAGE_ENDPOINT')
        if not endpoint:
            raise ValueError('Set STORAGE_ENDPOINT for BYO storage')
    authentication = 'sdkDefault' if options.auth_method == 'workload-identity' else 'static'
    values = merge(values, {'embeddedDependencies': {'objectStorage': {'enabled': False}},
        'externalDependencies': {'objectStorage': {'authentication': {'type': authentication},
            'locations': {name: environment.get(f'STORAGE_{name.upper()}_URL', endpoint + '/' + name)
                          for name in ['workflows', 'logs', 'apps']},
            's3': {'region': environment.get('STORAGE_REGION', environment.get('AWS_REGION', '')),
                   'overrideUrl': environment.get('STORAGE_OVERRIDE_URL', '')}}},
        'secrets': {'objectStorage': {'generate': False,
                    'existingSecret': f'{options.release}-object-storage' if authentication == 'static' else ''}}})
    if authentication == 'sdkDefault':
        azure = endpoint.startswith('azure://')
        variable = 'WORKLOAD_IDENTITY_CLIENT_ID' if azure else 'WORKLOAD_IDENTITY_ROLE_ARN'
        identity = environment.get(variable)
        if not identity:
            raise ValueError(f'Set {variable}; provision cloud identity and federation before installation')
        annotation = 'azure.workload.identity/client-id' if azure else 'eks.amazonaws.com/role-arn'
        account_name = f'{options.release}-workflow'
        service = {'serviceAccount': {'create': True, 'annotations': {annotation: identity}}}
        template = {'spec': {'serviceAccountName': account_name}}
        if azure:
            service['pod'] = {'labels': {'azure.workload.identity/use': 'true'}}
            template['metadata'] = {'labels': {'azure.workload.identity/use': 'true'}}
        values = merge(values, {'services': {'api': service, 'worker': service},
            'configuration': {'podTemplates': {'cloud_identity': template},
                              'pools': {'default': {'common_pod_template': [
                                  'default_ctrl', 'default_user', 'cloud_identity']}}}})
    return values


def ensure_credentials(cluster, options, values, environment):
    namespace = options.namespace
    workload = values['compute']['workloadNamespace']['name'] or namespace
    if values['compute']['workloadNamespace']['create']:
        found = json.loads(cluster.run('kubectl', 'get', 'namespace', workload,
                           '--ignore-not-found', '-o', 'json', capture=True) or '{}')
        labels = {'app.kubernetes.io/managed-by': 'Helm'}
        annotations = {'meta.helm.sh/release-name': options.release,
                       'meta.helm.sh/release-namespace': namespace, 'helm.sh/resource-policy': 'keep'}
        metadata = found.get('metadata', {})
        if found and (any(metadata.get('labels', {}).get(key) != value for key, value in labels.items()) or
                      any(metadata.get('annotations', {}).get(key) != value
                          for key, value in annotations.items() if key != 'helm.sh/resource-policy')):
            raise ValueError(f'Namespace {workload} already exists outside this Helm release; '
                             'set compute.workloadNamespace.create=false to reuse it')
        if not found:
            cluster.apply({'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {
                'name': workload, 'labels': labels, 'annotations': annotations}})
    elif workload != namespace:
        cluster.run('kubectl', 'get', 'namespace', workload, capture=True)
    if workload != namespace or not values['compute']['workloadNamespace']['create']:
        cluster.apply({'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': namespace}})

    def existing(name, keys=(), location=namespace):
        if not name:
            raise ValueError('External credentials require an existingSecret name')
        secret = json.loads(cluster.run('kubectl', 'get', 'secret', name, '-n', location,
                                        '--ignore-not-found', '-o', 'json', capture=True) or '{}')
        if not secret or any(not secret.get('data', {}).get(key) for key in keys):
            raise ValueError(f'Restore or provision Secret {location}/{name} with keys {list(keys)}')

    for name, prefix in [('postgresql', 'POSTGRES'), ('valkey', 'REDIS')]:
        if values['embeddedDependencies'][name]['enabled']:
            continue
        reference = values['secrets'][name]
        password = environment.get(prefix + '_PASSWORD')
        if reference['existingSecret'] == f'{options.release}-{name}' and password:
            data = {reference['keys']['password']: password}
            if name == 'postgresql':
                data[reference['keys']['username']] = values['externalDependencies'][name]['username']
            cluster.secret(namespace, reference['existingSecret'], data)
        else:
            existing(reference['existingSecret'], [reference['keys']['password']])

    storage = values['externalDependencies']['objectStorage']
    reference = values['secrets']['objectStorage']
    if not values['embeddedDependencies']['objectStorage']['enabled'] and storage['authentication']['type'] == 'static':
        refs = reference.get('credentialSecretRefs', {})
        if any(item.get('name') for item in refs.values()):
            for item in refs.values():
                existing(item.get('name', ''), [item['key']] if item.get('key') else [])
        elif reference['existingSecret'] == f'{options.release}-object-storage' and (
                environment.get('STORAGE_ACCESS_KEY') or environment.get('STORAGE_KEY')):
            if storage['locations']['workflows'].startswith('azure://'):
                account = environment['STORAGE_ACCOUNT']
                credentials = {'access_key_id': account, 'access_key':
                    f'DefaultEndpointsProtocol=https;AccountName={account};'
                    f'AccountKey={environment["STORAGE_KEY"]};'
                    f'EndpointSuffix={environment.get("AZURE_ENDPOINT_SUFFIX", "core.windows.net")}'}
            else:
                credentials = {'access_key_id': environment['STORAGE_ACCESS_KEY_ID'],
                               'access_key': environment['STORAGE_ACCESS_KEY']}
                for variable, key in [('STORAGE_REGION', 'region'), ('STORAGE_OVERRIDE_URL', 'override_url'),
                                      ('STORAGE_ADDRESSING_STYLE', 'addressing_style')]:
                    if environment.get(variable):
                        credentials[key] = environment[variable]
                if credentials.get('addressing_style', 'auto') not in ['path', 'virtual', 'auto']:
                    raise ValueError('STORAGE_ADDRESSING_STYLE must be path, virtual or auto')
            cluster.secret(namespace, reference['existingSecret'],
                           {reference['keys']['credentials']: json.dumps(credentials)})
        else:
            existing(reference['existingSecret'], [reference['keys']['credentials']])

    for item in values.get('imagePullSecrets', []):
        name = item['name']
        requested = environment.get('OSMO_IMAGE_PULL_SECRET') or environment.get('NGC_SECRET_NAME') or 'nvcr-pull'
        data = None
        if name == requested:
            registry = values['imageRegistry']
            if environment.get('OSMO_IMAGE_PULL_CONFIG'):
                config = json.loads(Path(environment['OSMO_IMAGE_PULL_CONFIG']).read_text())
                if registry not in config.get('auths', {}):
                    raise ValueError(f'Image pull config has no credentials for {registry}')
                data = {'auths': {registry: config['auths'][registry]}}
            elif environment.get('NGC_API_KEY'):
                if registry != 'nvcr.io':
                    raise ValueError('NGC_API_KEY is only valid for nvcr.io; use OSMO_IMAGE_PULL_CONFIG')
                data = {'auths': {registry: {'username': '$oauthtoken', 'password': environment['NGC_API_KEY']}}}
        for location in dict.fromkeys([namespace, workload]):
            if data:
                cluster.apply({'apiVersion': 'v1', 'kind': 'Secret',
                    'metadata': {'name': name, 'namespace': location},
                    'type': 'kubernetes.io/dockerconfigjson',
                    'stringData': {'.dockerconfigjson': json.dumps(data)}})
            else:
                existing(name, ['.dockerconfigjson'], location)

    identity = values.get('configuration', {}).get('podTemplates', {}).get('cloud_identity')
    if identity:
        azure = storage['locations']['workflows'].startswith('azure://')
        annotation = 'azure.workload.identity/client-id' if azure else 'eks.amazonaws.com/role-arn'
        variable = 'WORKLOAD_IDENTITY_CLIENT_ID' if azure else 'WORKLOAD_IDENTITY_ROLE_ARN'
        if environment.get(variable):
            cluster.apply({'apiVersion': 'v1', 'kind': 'ServiceAccount',
                'metadata': {'name': identity['spec']['serviceAccountName'], 'namespace': workload,
                             'annotations': {annotation: environment[variable]}}})


def prerequisite_environment(cluster, environment, directory):
    if not cluster.private:
        return environment
    tools = directory / 'tools'
    tools.mkdir()
    for tool in ['helm', 'kubectl']:
        path = tools / tool
        path.write_text('#!/bin/sh\nexec ' + shlex.join([
            sys.executable, str(Path(__file__).resolve()), 'cluster-command', tool]) + ' "$@"\n')
        path.chmod(0o700)
    return {**environment, 'OSMO_PRIVATE_AKS': 'true', 'OSMO_DEPLOY_TMP': str(directory),
            'OSMO_LOCAL_HELM': shutil.which('helm'), 'OSMO_LOCAL_PATH': environment['PATH'],
            'PATH': str(tools) + os.pathsep + environment['PATH']}


def prerequisites(cluster, options, values, environment, directory):
    if options.skip_prerequisites:
        return
    env = prerequisite_environment(cluster, environment, directory)
    if values['planes']['compute']['enabled']:
        command(['bash', SCRIPTS / 'install-kai-scheduler.sh'], env=env)
        command(['bash', SCRIPTS / 'install-gpu-operator.sh'], env=env)
    if values['embeddedDependencies']['postgresql']['enabled']:
        found = cluster.run('kubectl', 'get', 'crd', 'clusters.postgresql.cnpg.io',
                            '--ignore-not-found', '-o', 'name', capture=True).strip()
        if not found:
            cluster.run('helm', 'repo', 'add', 'osmo-cnpg', 'https://cloudnative-pg.github.io/charts', '--force-update')
            cluster.run('helm', 'upgrade', '--install', 'cnpg', 'osmo-cnpg/cloudnative-pg',
                        '--version', '0.29.0', '-n', 'cnpg-system', '--create-namespace', '--wait', '--timeout', '10m')


def verification_credentials(cluster, options, values, environment, directory):
    """Read the configured bootstrap token after Helm has reconciled identities."""
    if environment.get('OSMO_TOKEN_FILE'):
        environment['OSMO_LOGIN_METHOD'] = 'token'
        return
    identity = values['authentication']['bootstrap']['identities'].get('admin', {})
    credential = identity.get('tokens', {}).get('primary', {})
    reference = credential.get('existingSecret') or credential.get('managedSecret') or {}
    name = reference.get('name')
    key = reference.get('key', 'token')
    if not identity.get('enabled') or not name:
        raise ValueError('Verification requires an enabled admin primary token or OSMO_TOKEN_FILE')
    document = json.loads(cluster.run('kubectl', 'get', 'secret', name, '-n', options.namespace,
                                     '-o', 'json', capture=True) or '{}')
    token = base64.b64decode(document.get('data', {}).get(key, ''), validate=True).decode()
    if not token.strip():
        raise ValueError(f'Verification token Secret {name} has no non-empty {key} key')
    token_file = directory / 'admin-token'
    token_file.write_text(token)
    token_file.chmod(0o600)
    environment.update(OSMO_LOGIN_METHOD='token', OSMO_TOKEN_FILE=str(token_file))


def verify(cluster, options, values, environment):
    if options.skip_verify or environment.get('SKIP_VERIFY') == '1':
        return
    command(['bash', '-euc', 'source "$1"; install_osmo_cli_if_missing', 'osmo',
             SCRIPTS / 'common.sh'], env=environment)
    environment = {**environment, 'PATH': environment.get('OSMO_CLI_TARGET',
        str(Path.home() / '.local/bin')) + os.pathsep + environment['PATH']}
    url = environment.get('OSMO_URL')
    process = None
    env = {**environment, 'SKIP_GPU': '1' if environment.get('NO_GPU') == '1' else '0',
           'OSMO_NAMESPACE': options.namespace}
    try:
        if not url:
            if cluster.private:
                raise ValueError('Private AKS verification requires reachable OSMO_URL or --skip-verify')
            port = environment.get('OSMO_API_PORT', '9000')
            service = values['fullnameOverride'] + '-gateway'
            process = subprocess.Popen(['kubectl', '-n', options.namespace, 'port-forward',
                                        'service/' + service, f'{port}:{values["gateway"]["envoy"]["service"]["port"]}'], env=environment,
                                       stdout=subprocess.DEVNULL)
            url = 'http://127.0.0.1:' + port
            for _ in range(60):
                if process.poll() is not None:
                    raise RuntimeError('Gateway port-forward exited before verification')
                result = subprocess.run(['curl', '--fail', '--silent', '--max-time', '2', url + '/api/version'],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                if result.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Gateway port-forward did not become ready')
        env['OSMO_URL'] = url
        command(['bash', SCRIPTS / 'verify.sh'], env=env)
    finally:
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def prepare_chart(options, directory, environment):
    if options.chart_path is not None:
        chart = options.chart_path.expanduser().resolve(strict=True)
    elif options.chart_version:
        repository = environment.get('OSMO_HELM_REPO_URL', 'https://helm.ngc.nvidia.com/nvidia/osmo')
        command(['helm', 'repo', 'add', 'osmo-unified', repository, '--force-update'])
        command(['helm', 'pull', 'osmo-unified/osmo', '--version', options.chart_version,
                 '--destination', directory])
        chart = next(directory.glob('osmo-*.tgz'))
    else:
        chart = ROOT / 'deployments/charts/osmo'
    if options.chart_path is not None and (not chart.is_dir() or not (chart / 'Chart.yaml').is_file()):
        raise ValueError('--chart-path must name a Helm chart directory containing Chart.yaml')
    if options.profile == 'single-plane' and chart.is_dir() and not (chart / 'profiles/single-plane.yaml').is_file():
        raise ValueError('Selected local chart must include profiles/single-plane.yaml')
    defaults = directory / 'chart-defaults.yaml'
    defaults.write_text(command(['helm', 'show', 'values', chart], capture=True))
    values = inspect_values(directory, [defaults])
    if not all(key in values for key in ['planes', 'embeddedDependencies', 'externalDependencies', 'secrets']):
        raise ValueError('Selected chart is not the unified osmo chart; choose a compatible version')
    return chart


def release_state(cluster, options):
    # Explicit status filters work with both Helm 3 and Helm 4 (which removed --all).
    releases = json.loads(cluster.run('helm', 'list', '--deployed', '--failed', '--pending',
                                     '--uninstalled', '--uninstalling', '--superseded',
                                     '--all-namespaces', '-o', 'json', capture=True))
    selected = None
    for release in releases:
        legacy = re.match(r'^(service|backend-operator)-', release.get('chart', ''))
        if legacy and (release['namespace'] == options.namespace or
                       release['name'] in ['osmo-minimal', 'osmo-operator']):
            raise ValueError('Legacy Helm release detected: ' + release['namespace'] + '/' + release['name'] +
                             '. Migrate release ownership, configuration and credentials before using this installer.')
        if release['name'] == options.release and release['namespace'] == options.namespace:
            if not release.get('chart', '').startswith('osmo-'):
                raise ValueError('Selected Helm release is not the unified osmo chart')
            selected = release
    return selected


def install(options, environment, directory, chart, user_values):
    if options.destroy and options.provider in ['azure', 'aws'] and not options.skip_terraform:
        terraform_directory = Path(environment.get(f'{options.provider.upper()}_TERRAFORM_DIR',
            ROOT / f'deployments/terraform/{options.provider}/example')).resolve()
        if options.profile == 'single-plane':
            validate_single_plane_aws_context(terraform_directory, environment)
        driver(options.provider, 'terraform_destroy', environment, terraform_directory, 'false')
        return
    terraform_directory, private = provision(options, environment)
    if options.skip_osmo:
        print('Infrastructure provisioned; OSMO installation skipped.')
        return
    cluster = Cluster(environment, directory, private)
    if not options.destroy and private and not (options.skip_verify or environment.get('SKIP_VERIFY') == '1' or environment.get('OSMO_URL')):
        raise ValueError('Private AKS verification requires reachable OSMO_URL or --skip-verify')
    current = release_state(cluster, options)
    if options.destroy:
        if current:
            cluster.run('helm', 'uninstall', options.release, '-n', options.namespace, '--wait', '--timeout', '10m')
        print('Selected release removed. Retained Secrets/PVCs and namespaces are preserved; '
              'cloud resources are destroyed only when Terraform destruction is requested.')
        return
    previous = json.loads(cluster.run('helm', 'get', 'values', options.release, '-n', options.namespace,
                                      '-o', 'json', capture=True) or '{}') if current else {}
    reject_legacy(previous or {})
    generated = connection_values(options, environment, merge(previous or {}, user_values))
    if not current:
        generated = merge({'fullnameOverride': options.release,
                           'externalUrl': environment.get('OSMO_URL') or 'http://127.0.0.1:' + environment.get('OSMO_API_PORT', '9000'),
                           'gateway': {'envoy': {'service': {'type': 'ClusterIP'}}}}, generated)
    profile = {}
    if options.profile == 'single-plane':
        profile_chart = chart if chart.is_dir() else ROOT / 'deployments/charts/osmo'
        profile = inspect_values(directory, [profile_chart / 'profiles/single-plane.yaml',
                                             SCRIPTS / 'single-plane-aws.yaml'])
    requested = merge(profile, previous or {}, generated, user_values)
    if current:
        for name in ['masterEncryptionKey', 'serviceAuth']:
            if user_values.get('secrets', {}).get(name, {}).get('bootstrap', {}).get('enabled'):
                raise ValueError('Use Helm directly for explicit credential recovery/bootstrap operations')
            requested = merge(requested, {'secrets': {name: {'bootstrap': {'enabled': False}}}})
    default_file = directory / 'chart-defaults.yaml'
    default_file.write_text(command(['helm', 'show', 'values', chart], capture=True))
    override_file = directory / 'install-values.json'
    override_file.write_text(json.dumps(requested))
    effective = inspect_values(directory, [default_file, override_file])
    # The public browser origin may be a workstation's port-forward. Workflow
    # containers need the gateway's cluster DNS address for logs and token refresh.
    configuration = effective['configuration']
    snapshot = configuration.get('snapshot')
    runtime_configuration = snapshot if snapshot is not None else configuration
    if not runtime_configuration.get('service', {}).get('service_base_url'):
        gateway = f'{effective["fullnameOverride"]}-gateway.{options.namespace}.svc'
        runtime_values = {'service': {'service_base_url':
            f'http://{gateway}:{effective["gateway"]["envoy"]["service"]["port"]}'}}
        if snapshot is not None:
            runtime_values = {'snapshot': runtime_values}
        runtime_values = {'configuration': runtime_values}
        requested = merge(requested, runtime_values)
        effective = merge(effective, runtime_values)
        override_file.write_text(json.dumps(requested))
    reject_legacy(requested)
    if not effective['planes']['control']['enabled'] or not effective['planes']['compute']['enabled']:
        raise ValueError('This installer is converged; use Helm directly for split-plane profiles')
    if not effective.get('fullnameOverride'):
        raise ValueError('Set a non-empty fullnameOverride for installer gateway verification')
    if current:
        for name in ['masterEncryptionKey', 'serviceAuth']:
            reference = effective['secrets'][name]['existingSecret']
            found = cluster.run('kubectl', 'get', 'secret', reference['name'], '-n', options.namespace,
                                '--ignore-not-found', '-o', 'json', capture=True)
            secret = json.loads(found or '{}')
            if not secret.get('data', {}).get(reference['key']):
                raise ValueError(f'Restore retained {name} Secret before upgrading; automatic replacement is disabled')
    if chart.is_dir():
        command(['helm', 'repo', 'add', 'osmo-dex', 'https://charts.dexidp.io', '--force-update'])
        command(['helm', 'repo', 'add', 'osmo-postgresql', 'https://cloudnative-pg.github.io/charts', '--force-update'])
        command(['helm', 'repo', 'add', 'osmo-rustfs', 'https://charts.rustfs.com', '--force-update'])
        command(['helm', 'dependency', 'build', chart])
        command(['helm', 'package', chart, '--destination', directory])
        chart = next(directory.glob('osmo-*.tgz'))
    # Helm validation precedes Kubernetes writes, including prerequisites and Secrets.
    command(['helm', 'lint', chart, '-f', override_file])
    # Lint logs template `fail` calls without failing. Render to enforce them.
    # CNPG is installed in the next phase when embedded PostgreSQL is selected.
    capabilities = ['--api-versions', 'postgresql.cnpg.io/v1'] if effective['embeddedDependencies']['postgresql']['enabled'] else []
    command(['helm', 'template', options.release, chart, '-n', options.namespace,
             '-f', override_file, *capabilities], capture=True)
    # PVC provisioning follows the chart's effective per-dependency storage settings.
    ensure_credentials(cluster, options, effective, environment)
    if options.profile == 'single-plane':
        single_plane_credentials(cluster, options, effective, environment, directory, bool(current))
    prerequisites(cluster, options, effective, environment, directory)
    cluster.run('helm', 'upgrade', '--install', options.release, chart, '-n', options.namespace,
                '-f', override_file, '--wait', '--wait-for-jobs', '--timeout', '25m')
    bootstrap = [name for name in ['masterEncryptionKey', 'serviceAuth']
                 if effective['secrets'][name]['bootstrap']['enabled']]
    if bootstrap:
        settings = [argument for name in bootstrap for argument in
                    ['--set', f'secrets.{name}.bootstrap.enabled=false']]
        cluster.run('helm', 'upgrade', options.release, chart, '-n', options.namespace,
                    '--reuse-values', *settings, '--wait', '--wait-for-jobs', '--timeout', '25m')
    if not options.skip_verify and environment.get('SKIP_VERIFY') != '1':
        verification_credentials(cluster, options, effective, environment, directory)
    verify(cluster, options, effective, environment)
    print(f'OSMO release {options.namespace}/{options.release} is ready.')
    if options.provider == 'azure':
        print('Refresh workstation credentials: ' + shlex.join([
            'az', 'aks', 'get-credentials', '--subscription', environment['TF_SUBSCRIPTION_ID'],
            '-g', environment['RESOURCE_GROUP_NAME'], '-n', environment['AKS_CLUSTER_NAME'], '--admin']))
    elif options.provider == 'aws':
        print('Refresh workstation credentials: ' + shlex.join([
            'aws', 'eks', 'update-kubeconfig', '--region', environment.get('AWS_REGION', 'us-west-2'),
            '--name', environment['EKS_CLUSTER_NAME'], '--profile', environment.get('AWS_PROFILE', 'default')]))
    if not private:
        print(f'Local access: kubectl -n {options.namespace} port-forward '
              f'service/{effective["fullnameOverride"]}-gateway '
              f'9000:{effective["gateway"]["envoy"]["service"]["port"]}')
    else:
        print('For private AKS, use a workstation on the cluster network or the configured OSMO_URL.')



def main(arguments=None):
    arguments = sys.argv[1:] if arguments is None else arguments
    if arguments and arguments[0] == 'cluster-command':
        Cluster(dict(os.environ), Path(os.environ['OSMO_DEPLOY_TMP']), True).run(arguments[1], *arguments[2:])
        return
    options = parser().parse_args(arguments)
    environment = configure_environment(options)
    os.umask(0o077)
    for value in [options.namespace, options.release]:
        if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,51}[a-z0-9])?', value):
            raise ValueError('Release and namespace must be DNS labels of at most 53 characters')
    for tool in ['helm', 'python3', 'jq']:
        if not shutil.which(tool):
            raise ValueError(f'{tool} is required')
    if options.list_chart_versions:
        command(['helm', 'repo', 'add', 'osmo-unified', environment.get('OSMO_HELM_REPO_URL',
                 'https://helm.ngc.nvidia.com/nvidia/osmo'), '--force-update'])
        command(['helm', 'repo', 'update', 'osmo-unified'])
        command(['helm', 'search', 'repo', 'osmo-unified/osmo', '--versions', '--devel'])
        return
    if options.find_gpu_region:
        subscription = environment.get('TF_SUBSCRIPTION_ID') or command(
            ['az', 'account', 'show', '--query', 'id', '-o', 'tsv'], capture=True).strip()
        driver('azure', 'find_region_with_gpu_quota', environment, *options.find_gpu_region, subscription)
        return
    if options.profile == 'single-plane' and options.provider != 'aws':
        raise ValueError('Use deploy-osmo-single-plane.sh for the Azure single-plane deployment')
    if options.destroy and options.skip_osmo:
        raise ValueError('--destroy and --skip-osmo cannot be combined')
    with tempfile.TemporaryDirectory(prefix='osmo-deploy-') as temporary:
        directory = Path(temporary)
        files = [Path(file).resolve(strict=True) for file in options.helm_values]
        user_values = inspect_values(directory, files, options.helm_set)
        reject_legacy(user_values)
        if options.dry_run:
            print(f'Plan only: provider={options.provider}, release={options.namespace}/{options.release}, '
                  f'destroy={options.destroy}, provision={not options.skip_terraform}, '
                  f'storage={options.storage_backend}. No cluster or Terraform operations performed.')
            return
        if options.profile == 'single-plane':
            prepare_single_plane_aws(options, environment)
        chart = prepare_chart(options, directory, environment) if not (options.destroy or options.skip_osmo) else Path('.')
        # Isolate cloud credential refresh from the user's active kubeconfig/context.
        if options.provider in ['azure', 'aws']:
            environment['KUBECONFIG'] = str(directory / 'kubeconfig')
        install(options, environment, directory, chart, user_values)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
