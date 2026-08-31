#!/usr/bin/env python3
"""Adopt 6.3 ConfigMap roles into PostgreSQL before the 6.4 cutover."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
# SPDX-License-Identifier: Apache-2.0

import argparse
import datetime
import hashlib
import json
import os
import tempfile
from typing import Any

import psycopg2  # type: ignore
import psycopg2.extras  # type: ignore
import yaml

from src.lib.utils import role as role_models


FORMAT_VERSION = 1
SYNC_MODES = frozenset({'force', 'import', 'ignore'})
PROBE_NAMES = ('loginJwt', 'personalAccessToken', 'poolAuthorization')


class AdoptionError(ValueError):
    """A safe role adoption precondition or verification failed."""


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), default=str)


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode('utf-8')).hexdigest()


def _read_yaml(path: str) -> Any:
    with open(path, encoding='utf-8') as input_file:
        return yaml.safe_load(input_file)


def _normalize_policy(raw_policy: Any, role_name: str) -> dict[str, Any]:
    if not isinstance(raw_policy, dict):
        raise AdoptionError(f'Role {role_name} contains a non-object policy.')
    actions = raw_policy.get('actions', [])
    resources = raw_policy.get('resources', [])
    if not isinstance(actions, list) or not all(
            isinstance(action, str) and action for action in actions):
        raise AdoptionError(
            f'Role {role_name} must use semantic string actions before adoption.')
    if not isinstance(resources, list) or not all(
            isinstance(resource, str) and resource for resource in resources):
        raise AdoptionError(f'Role {role_name} contains invalid resources.')
    effect = raw_policy.get('effect', 'Allow')
    try:
        validated = role_models.RolePolicy(
            effect=effect, actions=actions, resources=resources)
    except Exception as error:  # Pydantic and OSMO validation errors
        raise AdoptionError(
            f'Role {role_name} contains a policy rejected by the production '
            'role validator.') from error
    return {
        'effect': validated.effect.value,
        'actions': sorted(set(validated.actions)),
        'resources': sorted(set(validated.resources)),
    }


def _normalize_role(
    name: str, raw_role: Any, sync_mode: str,
) -> dict[str, Any]:
    if not isinstance(name, str) or not name or not isinstance(raw_role, dict):
        raise AdoptionError('Every role must be a named object.')
    description = raw_role.get('description', '')
    if not isinstance(description, str):
        raise AdoptionError(f'Role {name} contains an invalid description.')
    immutable = raw_role.get('immutable', False)
    if not isinstance(immutable, bool):
        raise AdoptionError(f'Role {name} contains an invalid immutable flag.')
    policies = raw_role.get('policies', [])
    if not isinstance(policies, list):
        raise AdoptionError(f'Role {name} contains invalid policies.')
    normalized_policies = [
        _normalize_policy(policy, name) for policy in policies
    ]
    normalized_policies.sort(key=_canonical_json)

    external_roles = raw_role.get('external_roles')
    # The 6.3 file store mapped an omitted or empty list back to the role name.
    if not external_roles:
        external_roles = [name]
    if not isinstance(external_roles, list) or not all(
            isinstance(external_role, str) and external_role
            for external_role in external_roles):
        raise AdoptionError(f'Role {name} contains invalid external_roles.')
    return {
        'name': name,
        'description': description,
        'policies': normalized_policies,
        'immutable': immutable,
        'sync_mode': sync_mode,
        'external_roles': sorted(set(external_roles)),
    }


def load_desired_roles(roles_path: str, sync_modes_path: str) -> list[dict[str, Any]]:
    raw_config = _read_yaml(roles_path)
    raw_sync_modes = _read_yaml(sync_modes_path)
    if isinstance(raw_config, dict) and 'configuration' in raw_config:
        raw_config = raw_config['configuration']
    raw_roles = raw_config.get('roles') if isinstance(raw_config, dict) else None
    if not isinstance(raw_roles, dict) or not raw_roles:
        raise AdoptionError('The 6.3 configuration must contain a non-empty roles map.')
    if isinstance(raw_sync_modes, dict) and 'syncModes' in raw_sync_modes:
        raw_sync_modes = raw_sync_modes['syncModes']
    if not isinstance(raw_sync_modes, dict):
        raise AdoptionError('The sync-mode file must contain a syncModes map.')
    if set(raw_sync_modes) != set(raw_roles):
        missing = sorted(set(raw_roles) - set(raw_sync_modes))
        extra = sorted(set(raw_sync_modes) - set(raw_roles))
        raise AdoptionError(
            f'syncModes must name every role exactly; missing={missing}, extra={extra}.')

    desired = []
    for name in sorted(raw_roles):
        sync_mode = raw_sync_modes[name]
        if sync_mode not in SYNC_MODES:
            raise AdoptionError(f'Role {name} has invalid sync mode {sync_mode!r}.')
        desired.append(_normalize_role(name, raw_roles[name], sync_mode))
    return desired


def _normalize_db_policy(raw_policy: Any, role_name: str) -> dict[str, Any]:
    if isinstance(raw_policy, str):
        raw_policy = json.loads(raw_policy)
    return _normalize_policy(raw_policy, role_name)


def _read_db_roles(cursor: Any) -> list[dict[str, Any]]:
    cursor.execute('''
        SELECT name, description, policies, immutable, sync_mode
        FROM roles ORDER BY name;
    ''')
    roles = []
    for row in cursor.fetchall():
        policies = [
            _normalize_db_policy(policy, row['name'])
            for policy in (row['policies'] or [])
        ]
        policies.sort(key=_canonical_json)
        cursor.execute('''
            SELECT external_role FROM role_external_mappings
            WHERE role_name = %s ORDER BY external_role;
        ''', (row['name'],))
        roles.append({
            'name': row['name'],
            'description': row['description'],
            'policies': policies,
            'immutable': row['immutable'],
            'sync_mode': row['sync_mode'],
            'external_roles': [mapping['external_role'] for mapping in cursor.fetchall()],
        })
    return roles


def _read_assignments(cursor: Any) -> dict[str, Any]:
    cursor.execute('''
        SELECT id, user_id, role_name, assigned_by, assigned_at
        FROM user_roles ORDER BY user_id, role_name;
    ''')
    user_roles = [dict(row) for row in cursor.fetchall()]
    cursor.execute('''
        SELECT user_name, token_name, user_role_id, assigned_by, assigned_at
        FROM access_token_roles
        ORDER BY user_name, token_name, user_role_id;
    ''')
    token_roles = [dict(row) for row in cursor.fetchall()]
    return {'userRoles': user_roles, 'accessTokenRoles': token_roles}


def _lock_role_authority(cursor: Any) -> None:
    cursor.execute('LOCK TABLE roles IN SHARE ROW EXCLUSIVE MODE;')
    cursor.execute('LOCK TABLE role_external_mappings IN SHARE ROW EXCLUSIVE MODE;')
    cursor.execute('LOCK TABLE user_roles IN SHARE ROW EXCLUSIVE MODE;')
    cursor.execute('LOCK TABLE access_token_roles IN SHARE ROW EXCLUSIVE MODE;')


def _validate_adoption_set(
    current: list[dict[str, Any]], desired: list[dict[str, Any]],
) -> None:
    current_names = {role['name'] for role in current}
    desired_names = {role['name'] for role in desired}
    extra = sorted(current_names - desired_names)
    if extra:
        raise AdoptionError(
            'PostgreSQL contains roles absent from the 6.3 ConfigMap: '
            f'{extra}. Add them to the adoption source or remove them explicitly.')


def _role_diff(
    current: list[dict[str, Any]], desired: list[dict[str, Any]],
) -> dict[str, list[str]]:
    current_by_name = {item['name']: item for item in current}
    desired_by_name = {item['name']: item for item in desired}
    return {
        'create': sorted(set(desired_by_name) - set(current_by_name)),
        'update': sorted(
            name for name in set(desired_by_name) & set(current_by_name)
            if desired_by_name[name] != current_by_name[name]
        ),
        'unchanged': sorted(
            name for name in set(desired_by_name) & set(current_by_name)
            if desired_by_name[name] == current_by_name[name]
        ),
    }


def _write_roles(cursor: Any, desired: list[dict[str, Any]]) -> None:
    for role in desired:
        cursor.execute('''
            INSERT INTO roles (name, description, policies, immutable, sync_mode)
            VALUES (%s, %s, %s::jsonb[], %s, %s)
            ON CONFLICT (name) DO UPDATE SET
                description = EXCLUDED.description,
                policies = EXCLUDED.policies,
                immutable = EXCLUDED.immutable,
                sync_mode = EXCLUDED.sync_mode;
        ''', (
            role['name'], role['description'],
            [_canonical_json(policy) for policy in role['policies']],
            role['immutable'], role['sync_mode'],
        ))
        cursor.execute(
            'DELETE FROM role_external_mappings WHERE role_name = %s;',
            (role['name'],))
        for external_role in role['external_roles']:
            cursor.execute('''
                INSERT INTO role_external_mappings (role_name, external_role)
                VALUES (%s, %s);
            ''', (role['name'], external_role))


def _record_history(cursor: Any, desired: list[dict[str, Any]]) -> None:
    cursor.execute('LOCK TABLE config_history IN SHARE ROW EXCLUSIVE MODE;')
    cursor.execute('''
        SELECT COALESCE(MAX(revision), 0) + 1 AS revision
        FROM config_history WHERE config_type = 'role';
    ''')
    revision = cursor.fetchone()['revision']
    cursor.execute('''
        INSERT INTO config_history
            (config_type, revision, name, username, created_at, tags,
             description, data)
        VALUES ('role', %s, '', 'system', NOW(), %s, %s, %s::jsonb);
    ''', (
        revision, ['6.4-role-adoption'],
        'Adopted 6.3 ConfigMap roles into PostgreSQL',
        _canonical_json(desired),
    ))


def _connect(arguments: argparse.Namespace):
    password = os.environ.get(arguments.postgres_password_env)
    if password is None:
        raise AdoptionError(
            f'{arguments.postgres_password_env} is required for role adoption.')
    return psycopg2.connect(
        host=arguments.postgres_host,
        port=arguments.postgres_port,
        dbname=arguments.postgres_database,
        user=arguments.postgres_user,
        password=password,
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def _write_json_atomic(path: str, value: dict[str, Any]) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    if os.path.exists(path):
        raise AdoptionError(f'Refusing to overwrite existing file {path}.')
    descriptor, temporary_path = tempfile.mkstemp(prefix='.osmo-adoption-', dir=directory)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output_file:
            json.dump(value, output_file, indent=2, sort_keys=True)
            output_file.write('\n')
        os.link(temporary_path, path)
    finally:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass


def plan(arguments: argparse.Namespace) -> None:
    desired = load_desired_roles(arguments.roles_file, arguments.sync_modes_file)
    with _connect(arguments) as connection:
        connection.set_session(readonly=True)
        with connection.cursor() as cursor:
            current = _read_db_roles(cursor)
            assignments = _read_assignments(cursor)
    _validate_adoption_set(current, desired)
    plan_data = {
        'formatVersion': FORMAT_VERSION,
        'status': 'planned',
        'hybridVersion': arguments.hybrid_version,
        'plannedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'roles': desired,
        'rolesHash': _digest(desired),
        'currentRolesHash': _digest(current),
        'assignmentsHash': _digest(assignments),
        'diff': _role_diff(current, desired),
    }
    plan_data['planHash'] = _digest(plan_data)
    _write_json_atomic(arguments.output, plan_data)


def _load_plan(path: str) -> dict[str, Any]:
    with open(path, encoding='utf-8') as plan_file:
        plan_data = json.load(plan_file)
    plan_hash = plan_data.pop('planHash', None)
    if plan_data.get('formatVersion') != FORMAT_VERSION or plan_data.get(
            'status') != 'planned':
        raise AdoptionError('The role-adoption plan is invalid.')
    if plan_hash != _digest(plan_data):
        raise AdoptionError('The role-adoption plan has been modified.')
    plan_data['planHash'] = plan_hash
    return plan_data


def apply(arguments: argparse.Namespace) -> None:
    plan_data = _load_plan(arguments.plan)
    desired = plan_data['roles']
    with _connect(arguments) as connection:
        with connection.cursor() as cursor:
            _lock_role_authority(cursor)
            current = _read_db_roles(cursor)
            if _digest(current) != plan_data['currentRolesHash']:
                raise AdoptionError(
                    'PostgreSQL roles changed after planning; create a new plan.')
            _validate_adoption_set(current, desired)
            assignments_before = _read_assignments(cursor)
            if _digest(assignments_before) != plan_data['assignmentsHash']:
                raise AdoptionError(
                    'Role assignments changed after planning; create a new plan.')
            _write_roles(cursor, desired)
            if _read_db_roles(cursor) != desired:
                raise AdoptionError('PostgreSQL roles do not exactly match the adoption source.')
            if _read_assignments(cursor) != assignments_before:
                raise AdoptionError('Role adoption changed an existing role assignment.')
            _record_history(cursor, desired)

    state = {
        'formatVersion': FORMAT_VERSION,
        'status': 'prepared',
        'hybridVersion': plan_data['hybridVersion'],
        'preparedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'roles': desired,
        'rolesHash': _digest(desired),
        'assignmentsHash': _digest(assignments_before),
    }
    state['stateHash'] = _digest(state)
    _write_json_atomic(arguments.output, state)


def _load_prepared_state(path: str) -> dict[str, Any]:
    with open(path, encoding='utf-8') as state_file:
        state = json.load(state_file)
    state_hash = state.pop('stateHash', None)
    if state.get('formatVersion') != FORMAT_VERSION or state.get('status') != 'prepared':
        raise AdoptionError('The role-adoption state file is invalid.')
    if state_hash != _digest(state):
        raise AdoptionError('The role-adoption state file has been modified.')
    state['stateHash'] = state_hash
    return state


def _load_probe_evidence(path: str, hybrid_version: str) -> dict[str, Any]:
    evidence = _read_yaml(path)
    if not isinstance(evidence, dict) or evidence.get('hybridVersion') != hybrid_version:
        raise AdoptionError('Probe evidence must identify the prepared hybrid version.')
    for probe_name in PROBE_NAMES:
        probe = evidence.get(probe_name)
        if not isinstance(probe, dict) or probe.get('passed') is not True:
            raise AdoptionError(f'Probe {probe_name} must explicitly pass.')
        if not isinstance(probe.get('evidence'), str) or not probe['evidence'].strip():
            raise AdoptionError(f'Probe {probe_name} must include non-empty evidence.')
    return evidence


def verify(arguments: argparse.Namespace) -> None:
    state = _load_prepared_state(arguments.state)
    evidence = _load_probe_evidence(arguments.probe_evidence, state['hybridVersion'])
    with _connect(arguments) as connection:
        connection.set_session(readonly=True)
        with connection.cursor() as cursor:
            roles = _read_db_roles(cursor)
            assignments = _read_assignments(cursor)
    if roles != state['roles'] or _digest(roles) != state['rolesHash']:
        raise AdoptionError('PostgreSQL roles changed after the prepare phase.')
    if _digest(assignments) != state['assignmentsHash']:
        raise AdoptionError('Role assignments changed after the prepare phase.')

    receipt = {
        'formatVersion': FORMAT_VERSION,
        'status': 'verified',
        'hybridVersion': state['hybridVersion'],
        'preparedAt': state['preparedAt'],
        'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'rolesHash': state['rolesHash'],
        'assignmentsHash': state['assignmentsHash'],
        'probeEvidence': evidence,
    }
    receipt['receiptHash'] = _digest(receipt)
    _write_json_atomic(arguments.output, receipt)


def verify_receipt(path: str) -> dict[str, Any]:
    with open(path, encoding='utf-8') as receipt_file:
        receipt = json.load(receipt_file)
    receipt_hash = receipt.pop('receiptHash', None)
    if receipt.get('formatVersion') != FORMAT_VERSION or receipt.get('status') != 'verified':
        raise AdoptionError('The role-adoption receipt is not verified.')
    if receipt_hash != _digest(receipt):
        raise AdoptionError('The role-adoption receipt has been modified.')
    for field in ('rolesHash', 'assignmentsHash'):
        value = receipt.get(field)
        if not isinstance(value, str) or len(value) != 64:
            raise AdoptionError(f'The role-adoption receipt has invalid {field}.')
    _load_probe_evidence_from_receipt(receipt)
    receipt['receiptHash'] = receipt_hash
    return receipt


def _load_probe_evidence_from_receipt(receipt: dict[str, Any]) -> None:
    evidence = receipt.get('probeEvidence')
    if not isinstance(evidence, dict) or evidence.get('hybridVersion') != receipt.get(
            'hybridVersion'):
        raise AdoptionError('The role-adoption receipt has invalid probe evidence.')
    for probe_name in PROBE_NAMES:
        probe = evidence.get(probe_name)
        if not isinstance(probe, dict) or probe.get('passed') is not True or not isinstance(
                probe.get('evidence'), str) or not probe['evidence'].strip():
            raise AdoptionError(f'The role-adoption receipt has invalid {probe_name}.')


def _add_postgres_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument('--postgres-host', required=True)
    parser.add_argument('--postgres-port', type=int, required=True)
    parser.add_argument('--postgres-database', required=True)
    parser.add_argument('--postgres-user', required=True)
    parser.add_argument(
        '--postgres-password-env', default='OSMO_POSTGRES_PASSWORD',
        help='Environment variable containing the PostgreSQL password.')


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    plan_parser = commands.add_parser('plan')
    _add_postgres_arguments(plan_parser)
    plan_parser.add_argument('--roles-file', required=True)
    plan_parser.add_argument('--sync-modes-file', required=True)
    plan_parser.add_argument('--hybrid-version', required=True)
    plan_parser.add_argument('--output', required=True)

    apply_parser = commands.add_parser('apply')
    _add_postgres_arguments(apply_parser)
    apply_parser.add_argument('--plan', required=True)
    apply_parser.add_argument('--output', required=True)

    verify_parser = commands.add_parser('verify')
    _add_postgres_arguments(verify_parser)
    verify_parser.add_argument('--state', required=True)
    verify_parser.add_argument('--probe-evidence', required=True)
    verify_parser.add_argument('--output', required=True)
    return parser.parse_args()


def main() -> None:
    arguments = _parse_arguments()
    try:
        if arguments.command == 'plan':
            plan(arguments)
        elif arguments.command == 'apply':
            apply(arguments)
        else:
            verify(arguments)
    except (AdoptionError, OSError, json.JSONDecodeError, yaml.YAMLError,
            psycopg2.Error) as error:
        raise SystemExit(f'Role adoption failed: {error}') from None


if __name__ == '__main__':
    main()
