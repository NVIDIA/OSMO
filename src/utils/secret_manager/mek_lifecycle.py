"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

import base64
import dataclasses
import datetime
import hashlib
import json
import logging
from pathlib import Path
import re
import tempfile
import time
from typing import Dict, List, Literal, Mapping, Tuple

from jwcrypto import jwk  # type: ignore
from kubernetes import client, config as kubernetes_config  # type: ignore
from kubernetes.client import exceptions as kubernetes_exceptions  # type: ignore
import psycopg2  # type: ignore
import psycopg2.extras  # type: ignore
import pydantic
import yaml

from src.lib.utils import osmo_errors
from src.utils import connectors, static_config
from src.utils.secret_manager.secret_manager import (
    MAX_KEYRING_BYTES,
    MAX_MEK_COUNT,
    SecretManager,
)


_ROTATION_ANNOTATION = "osmo.nvidia.com/mek-rotation-id"
_ROTATION_COMPLETE_ANNOTATION = "osmo.nvidia.com/mek-rotation-complete"
_MANAGED_ANNOTATION = "osmo.nvidia.com/mek-management"
_INSTALLATION_ANNOTATION = "osmo.nvidia.com/mek-installation"
_LEASE_DURATION_SECONDS = 30


@dataclasses.dataclass(frozen=True)
class ParsedKeyring:
    """Validated keyring identities and its mutable YAML representation."""

    document: Dict
    encoded: bytes
    generation: str
    current_key_id: str
    fingerprints: Mapping[str, str]
    registry_digest: str


@dataclasses.dataclass(frozen=True)
class RotationClaim:
    """Durable phase state claimed by one fenced Job Pod."""

    fencing_epoch: int
    phase: str
    predecessor_generation: str
    candidate_generation: str


class MekLifecycleConfig(connectors.PostgresConfig, static_config.StaticConfig):
    """Configuration for the namespace-scoped MEK lifecycle Job."""

    operation: Literal[
        "bootstrap", "validate", "rebind", "release", "reacquire", "recover", "rotate"
    ] = pydantic.Field(
        description="Lifecycle operation to execute.",
        json_schema_extra={"command_line": "operation", "env": "OSMO_MEK_OPERATION"},
    )
    namespace: str = pydantic.Field(
        description="Kubernetes namespace containing the MEK Secret.",
        json_schema_extra={"command_line": "namespace", "env": "OSMO_NAMESPACE"},
    )
    secret_name: str = pydantic.Field(
        description="Exact OSMO-managed MEK Secret name.",
        json_schema_extra={"command_line": "secret_name", "env": "OSMO_MEK_SECRET_NAME"},
    )
    secret_key: str = pydantic.Field(
        default="mek.yaml",
        description="Secret data key containing the MEK keyring.",
        json_schema_extra={"command_line": "secret_key", "env": "OSMO_MEK_SECRET_KEY"},
    )
    installation_id: str = pydantic.Field(
        description="Immutable namespace/release identity that owns the MEK Secret.",
        json_schema_extra={
            "command_line": "installation_id", "env": "OSMO_MEK_INSTALLATION_ID"
        },
    )
    request_id: str = pydantic.Field(
        default="",
        description="Stable non-secret identifier for a rotation request.",
        json_schema_extra={"command_line": "request_id", "env": "OSMO_MEK_REQUEST_ID"},
    )
    attempt: str = pydantic.Field(
        default="1",
        description="Unique retry attempt identifier.",
        json_schema_extra={"command_line": "attempt", "env": "OSMO_MEK_ATTEMPT"},
    )
    pod_uid: str = pydantic.Field(
        default="",
        description="UID of this lifecycle Job Pod.",
        json_schema_extra={"command_line": "pod_uid", "env": "OSMO_POD_UID"},
    )
    service_account: str = pydantic.Field(
        default="",
        description="Unique ServiceAccount for this attempt.",
        json_schema_extra={
            "command_line": "service_account", "env": "OSMO_SERVICE_ACCOUNT"
        },
    )
    consumer_deployments: List[str] = pydantic.Field(
        default_factory=list,
        description="Exact Deployment names expected to consume the MEK.",
        json_schema_extra={
            "command_line": "consumer_deployments", "env": "OSMO_MEK_CONSUMER_DEPLOYMENTS"
        },
    )
    active_deadline_seconds: int = pydantic.Field(
        default=900,
        gt=0,
        description="Maximum lifecycle operation duration.",
        json_schema_extra={
            "command_line": "active_deadline_seconds",
            "env": "OSMO_MEK_ACTIVE_DEADLINE_SECONDS",
        },
    )


def _connect(database_config: connectors.PostgresConfig):
    return psycopg2.connect(
        host=database_config.postgres_host,
        port=database_config.postgres_port,
        user=database_config.postgres_user,
        password=database_config.postgres_password,
        dbname=database_config.postgres_database_name,
    )


def _generation(current_key_id: str, key_ids: List[str]) -> str:
    descriptor = json.dumps(
        {"currentMek": current_key_id, "mekIds": sorted(key_ids)},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(descriptor).hexdigest()[:16]


def _registry_digest(fingerprints: Mapping[str, str]) -> str:
    descriptor = json.dumps(
        fingerprints, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(descriptor).hexdigest()


def _parse_keyring(encoded: bytes) -> ParsedKeyring:
    if not encoded or len(encoded) > MAX_KEYRING_BYTES:
        raise osmo_errors.OSMOError("MEK keyring is empty or exceeds its size limit.")
    keyring_path = ""
    try:
        with tempfile.NamedTemporaryFile(mode="wb", delete=False) as keyring_file:
            keyring_file.write(encoded)
            keyring_path = keyring_file.name
        manager = SecretManager(
            keyring_path,
            lambda _uid, _kid: "",
            lambda _uid, _kid, _new, _old: False,
            lambda _uid: "",
            lambda _uid, _keys: None,
        )
        document = yaml.safe_load(encoded)
        current_key_id = manager.current_mek_id
        fingerprints = manager.key_fingerprints()
    except osmo_errors.OSMOError:
        raise
    except (KeyError, TypeError, ValueError, yaml.YAMLError):
        raise osmo_errors.OSMOError("MEK keyring is invalid.") from None
    finally:
        if keyring_path:
            Path(keyring_path).unlink(missing_ok=True)
    return ParsedKeyring(
        document=document, encoded=encoded, generation=manager.generation,
        current_key_id=current_key_id, fingerprints=fingerprints,
        registry_digest=_registry_digest(fingerprints))


def _serialize_keyring(document: Dict) -> bytes:
    encoded = yaml.safe_dump(document, sort_keys=True).encode("utf-8")
    if len(encoded) > MAX_KEYRING_BYTES:
        raise osmo_errors.OSMOError("MEK keyring would exceed its size limit.")
    return encoded


def _new_keyring(request_id: str = "initial") -> ParsedKeyring:
    key_id = _candidate_key_id(request_id)
    key = jwk.JWK.generate(kty="oct", size=256, kid=key_id)
    encoded_jwk = base64.b64encode(
        json.dumps(key.export(as_dict=True), separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    return _parse_keyring(_serialize_keyring({
        "currentMek": key_id,
        "meks": {key_id: encoded_jwk},
    }))


def _candidate_key_id(request_id: str) -> str:
    safe_request = re.sub(r"[^A-Za-z0-9._-]", "-", request_id).strip("-.") or "rotation"
    return f"mek-{safe_request}"[:64]


def _lease_name(installation_id: str, secret_name: str) -> str:
    """Derive the release-scoped Lease name used by both lifecycle charts."""
    release_name = installation_id.rsplit("/", 1)[-1]
    prefix = re.sub(r"[^a-z0-9-]", "-", release_name.lower()).strip("-") or "osmo"
    digest = hashlib.sha256(
        f"{installation_id}:{secret_name}".encode("utf-8")).hexdigest()[:10]
    return f"{prefix[:46].rstrip('-')}-mek-{digest}"


def _add_candidate(keyring: ParsedKeyring, request_id: str) -> ParsedKeyring:
    if len(keyring.fingerprints) >= MAX_MEK_COUNT:
        raise osmo_errors.OSMOError(
            "MEK rotation limit reached; safe key retirement is required before another rotation."
        )
    candidate = _new_keyring(request_id)
    candidate_key_id = candidate.current_key_id
    if candidate_key_id in keyring.document["meks"]:
        raise osmo_errors.OSMOError("Rotation request ID already names a loaded MEK.")
    document = dict(keyring.document)
    document["meks"] = dict(keyring.document["meks"])
    document["meks"][candidate_key_id] = candidate.document["meks"][candidate_key_id]
    return _parse_keyring(_serialize_keyring(document))


class MekLifecycle:
    """Namespace-scoped bootstrap and explicit rotation orchestration."""

    def __init__(self, lifecycle_config: MekLifecycleConfig):
        self.config = lifecycle_config
        kubernetes_config.load_incluster_config()
        self.core = client.CoreV1Api()
        self.apps = client.AppsV1Api()
        self.coordination = client.CoordinationV1Api()
        self.rbac = client.RbacAuthorizationV1Api()
        self.deadline = time.monotonic() + lifecycle_config.active_deadline_seconds
        self.lease_name = _lease_name(
            lifecycle_config.installation_id, lifecycle_config.secret_name)
        self.lease_resource_version = ""
        self.rotation_claimed = False

    def acquire_lease(self, allow_expired: bool = False) -> None:
        """Acquire the fixed lifecycle Lease without stealing from another attempt."""
        holder = self.config.pod_uid
        if not holder:
            raise osmo_errors.OSMOError("Lifecycle Pod UID is required for fencing.")
        now = datetime.datetime.now(datetime.timezone.utc)
        while True:
            try:
                lease = self.coordination.read_namespaced_lease(
                    self.lease_name, self.config.namespace)
                break
            except kubernetes_exceptions.ApiException as error:
                if error.status != 404 or time.monotonic() >= self.deadline:
                    raise
                time.sleep(1)
        if lease.spec.holder_identity not in (None, "", holder):
            renew_time = lease.spec.renew_time or lease.spec.acquire_time
            duration = lease.spec.lease_duration_seconds or _LEASE_DURATION_SECONDS
            expired = bool(
                renew_time
                and renew_time + datetime.timedelta(seconds=duration) < now)
            if not allow_expired or not expired:
                raise osmo_errors.OSMOError(
                    "Another MEK lifecycle attempt still owns the Kubernetes Lease.")
            pods = self.core.list_namespaced_pod(self.config.namespace).items
            if any(
                pod.metadata.uid == lease.spec.holder_identity
                and pod.status.phase not in ("Succeeded", "Failed")
                for pod in pods
            ):
                raise osmo_errors.OSMOError(
                    "The expired MEK lifecycle Lease still belongs to a live Pod.")
        lease.spec.holder_identity = holder
        lease.spec.lease_duration_seconds = _LEASE_DURATION_SECONDS
        lease.spec.renew_time = now
        lease = self.coordination.replace_namespaced_lease(
            self.lease_name, self.config.namespace, lease)
        self.lease_resource_version = lease.metadata.resource_version or ""

    def release_lease(self) -> None:
        """Release only the Lease revision still owned by this Pod."""
        lease = self.coordination.read_namespaced_lease(
            self.lease_name, self.config.namespace)
        if (
            lease.spec.holder_identity != self.config.pod_uid
            or lease.metadata.resource_version != self.lease_resource_version
        ):
            raise osmo_errors.OSMOError("MEK lifecycle Lease was lost before release.")
        lease.spec.holder_identity = ""
        lease.spec.renew_time = datetime.datetime.now(datetime.timezone.utc)
        self.coordination.replace_namespaced_lease(
            self.lease_name, self.config.namespace, lease)
        self.lease_resource_version = ""

    def revoke_attempt_authority(self) -> None:
        """Remove the exact RoleBinding that authorizes this one-shot attempt."""
        if not self.config.service_account:
            raise osmo_errors.OSMOError(
                "Lifecycle ServiceAccount identity is required for credential cleanup.")
        self.rbac.delete_namespaced_role_binding(
            self.config.service_account, self.config.namespace)

    def _renew_lease(self) -> None:
        if not self.lease_resource_version:
            return
        lease = self.coordination.read_namespaced_lease(
            self.lease_name, self.config.namespace)
        if (
            lease.metadata.resource_version != self.lease_resource_version
            or lease.spec.holder_identity != self.config.pod_uid
        ):
            raise osmo_errors.OSMOError("MEK lifecycle Lease was lost.")
        lease.spec.renew_time = datetime.datetime.now(datetime.timezone.utc)
        lease = self.coordination.replace_namespaced_lease(
            self.lease_name, self.config.namespace, lease)
        self.lease_resource_version = lease.metadata.resource_version or ""

    def _check_deadline(self) -> None:
        if time.monotonic() >= self.deadline:
            raise osmo_errors.OSMOError("MEK lifecycle operation deadline exceeded.")
        self._renew_lease()

    def _secret(self):
        return self.core.read_namespaced_secret(self.config.secret_name, self.config.namespace)

    def _database(self):
        while True:
            self._check_deadline()
            try:
                return _connect(self.config)
            except psycopg2.OperationalError:
                time.sleep(2)

    def _secret_keyring(self) -> ParsedKeyring | None:
        secret = self._secret()
        encoded_value = (secret.data or {}).get(self.config.secret_key, "")
        return _parse_keyring(base64.b64decode(encoded_value)) if encoded_value else None

    def _required_secret_keyring(self, message: str) -> ParsedKeyring:
        keyring = self._secret_keyring()
        if keyring is None:
            raise osmo_errors.OSMOError(message)
        return keyring

    def _patch_secret(
            self, keyring: ParsedKeyring, resource_version: str, annotations: Dict[str, str]):
        self._check_deadline()
        secret = self._secret()
        if secret.metadata.uid is None or secret.metadata.resource_version != resource_version:
            raise osmo_errors.OSMOError("MEK Secret changed concurrently.")
        current_annotations = dict(secret.metadata.annotations or {})
        if (
            current_annotations.get(_MANAGED_ANNOTATION) != "osmo"
            or current_annotations.get(_INSTALLATION_ANNOTATION)
            != self.config.installation_id
        ):
            raise osmo_errors.OSMOError("MEK Secret is not OSMO managed.")
        current_annotations.update(annotations)
        body = {
            "metadata": {
                "resourceVersion": resource_version,
                "annotations": current_annotations,
            },
            "data": {
                self.config.secret_key: base64.b64encode(keyring.encoded).decode("ascii")
            },
        }
        return self.core.patch_namespaced_secret(
            self.config.secret_name, self.config.namespace, body)

    @staticmethod
    def _ensure_registry_schema(cursor) -> None:
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS public.mek_key_registry (
                kid TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
                state TEXT NOT NULL CHECK (state IN ('prepared', 'current')),
                remaining_references INTEGER, last_scan_started_at TIMESTAMPTZ,
                last_scan_completed_at TIMESTAMPTZ,
                first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS public.mek_keyring_adoption (
                singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
                generation TEXT NOT NULL, current_kid TEXT NOT NULL,
                loaded_kids TEXT[] NOT NULL, secret_name TEXT NOT NULL DEFAULT '',
                secret_key TEXT NOT NULL DEFAULT '', secret_uid TEXT NOT NULL DEFAULT '',
                installation_id TEXT NOT NULL DEFAULT '',
                management_mode TEXT NOT NULL DEFAULT 'external'
                    CHECK (management_mode IN ('external', 'osmo')),
                ready BOOLEAN NOT NULL DEFAULT FALSE,
                adopted_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
        ''')
        for column in ("secret_name", "secret_key", "secret_uid", "installation_id"):
            cursor.execute(
                f"ALTER TABLE public.mek_keyring_adoption "
                f"ADD COLUMN IF NOT EXISTS {column} TEXT NOT NULL DEFAULT '';"
            )
        cursor.execute('''
            ALTER TABLE public.mek_keyring_adoption
            ADD COLUMN IF NOT EXISTS management_mode TEXT;
        ''')
        cursor.execute('''
            UPDATE public.mek_keyring_adoption
            SET management_mode = CASE WHEN secret_uid <> '' THEN 'osmo' ELSE 'external' END
            WHERE management_mode IS NULL;
        ''')
        cursor.execute('''
            ALTER TABLE public.mek_keyring_adoption
            ALTER COLUMN management_mode SET DEFAULT 'external';
        ''')
        cursor.execute('''
            ALTER TABLE public.mek_keyring_adoption
            ALTER COLUMN management_mode SET NOT NULL;
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS public.mek_write_epoch (
                singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
                epoch BIGINT NOT NULL DEFAULT 0,
                writes_allowed BOOLEAN NOT NULL DEFAULT TRUE);
        ''')
        cursor.execute('''
            INSERT INTO public.mek_write_epoch(singleton, epoch, writes_allowed)
            VALUES (TRUE, 0, TRUE) ON CONFLICT (singleton) DO NOTHING;
        ''')
        cursor.execute('''
            CREATE OR REPLACE FUNCTION public.bump_mek_write_epoch()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                UPDATE public.mek_write_epoch SET epoch = epoch + 1
                WHERE singleton AND writes_allowed;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'MEK lifecycle write fence is active';
                END IF;
                RETURN NULL;
            END;
            $$;
        ''')
        for table in ("ueks", "configs"):
            cursor.execute("SELECT to_regclass(%s);", (f"public.{table}",))
            if cursor.fetchone()[0] is not None:
                cursor.execute(f"DROP TRIGGER IF EXISTS bump_mek_write_epoch ON {table};")
                cursor.execute(f'''
                    CREATE TRIGGER bump_mek_write_epoch
                    AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON {table}
                    FOR EACH STATEMENT EXECUTE FUNCTION public.bump_mek_write_epoch();
                ''')

    @staticmethod
    def _database_is_raw_empty(cursor) -> bool:
        for table in ("ueks", "configs"):
            cursor.execute("SELECT to_regclass(%s);", (f"public.{table}",))
            if cursor.fetchone()[0] is None:
                continue
            cursor.execute(f"SELECT 1 FROM public.{table} LIMIT 1;")
            if cursor.fetchone() is not None:
                return False
        return True

    @staticmethod
    def _expected_registry(keyring: ParsedKeyring):
        return {
            key_id: (
                fingerprint,
                "current" if key_id == keyring.current_key_id else "prepared",
            )
            for key_id, fingerprint in keyring.fingerprints.items()
        }

    def _keyring_from_secret(self, secret) -> ParsedKeyring | None:
        encoded_value = (secret.data or {}).get(self.config.secret_key, "")
        return _parse_keyring(base64.b64decode(encoded_value)) if encoded_value else None

    def _required_keyring_from_secret(self, secret, message: str) -> ParsedKeyring:
        keyring = self._keyring_from_secret(secret)
        if keyring is None:
            raise osmo_errors.OSMOError(message)
        return keyring

    def _verify_secret_keyring(self, secret, keyring: ParsedKeyring) -> None:
        observed = self._keyring_from_secret(secret)
        if (
            secret.metadata.uid is None
            or observed is None
            or observed.generation != keyring.generation
            or observed.registry_digest != keyring.registry_digest
            or observed.current_key_id != keyring.current_key_id
        ):
            raise osmo_errors.OSMOError(
                "Live MEK Secret does not match the lifecycle phase keyring.")

    def _reserve_bootstrap(self, keyring: ParsedKeyring, secret, allow_patch: bool):
        """Persist a write fence and pending authority before exposing a generated MEK."""
        with self._database() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s);", (0x4F534D4F4D454B41,))
                self._ensure_registry_schema(cursor)
                cursor.execute(
                    "SELECT generation, current_kid, loaded_kids, secret_name, secret_key, "
                    "secret_uid, installation_id, management_mode, ready "
                    "FROM public.mek_keyring_adoption WHERE singleton;")
                existing = cursor.fetchone()
                cursor.execute(
                    "SELECT kid, fingerprint, state FROM public.mek_key_registry;")
                registered = {row[0]: (row[1], row[2]) for row in cursor.fetchall()}
                if existing is not None:
                    if existing[3:8] != (
                        self.config.secret_name, self.config.secret_key,
                        secret.metadata.uid, self.config.installation_id, "osmo",
                    ):
                        raise osmo_errors.OSMOError(
                            "MEK Secret does not match the committed installation binding.")
                    if registered != self._expected_registry(keyring):
                        raise osmo_errors.OSMOError(
                            "MEK registry does not match the committed installation binding.")
                    if existing[8]:
                        return secret
                    if existing[:3] != (
                        keyring.generation, keyring.current_key_id,
                        sorted(keyring.fingerprints),
                    ):
                        raise osmo_errors.OSMOError(
                            "Pending MEK bootstrap does not match the Secret keyring.")
                    cursor.execute(
                        "UPDATE public.mek_write_epoch SET writes_allowed = FALSE, "
                        "epoch = epoch + 1 WHERE singleton;")
                    return secret
                if registered:
                    raise osmo_errors.OSMOError(
                        "MEK registry exists without an installation binding.")
                cursor.execute(
                    "UPDATE public.mek_write_epoch SET writes_allowed = FALSE, "
                    "epoch = epoch + 1 WHERE singleton;")
                if not self._database_is_raw_empty(cursor):
                    raise osmo_errors.OSMOError(
                        "Managed MEK generation requires a new database with no ciphertext rows.")
                if self._keyring_from_secret(secret) is None:
                    if not allow_patch:
                        raise osmo_errors.OSMOError(
                            "Validation-only bootstrap found an empty Secret.")
                    secret = self._patch_secret(
                        keyring, secret.metadata.resource_version,
                        {_MANAGED_ANNOTATION: "osmo"})
                self._verify_secret_keyring(secret, keyring)
                for key_id, fingerprint in sorted(keyring.fingerprints.items()):
                    state = "current" if key_id == keyring.current_key_id else "prepared"
                    cursor.execute(
                        "INSERT INTO public.mek_key_registry(kid, fingerprint, state) "
                        "VALUES(%s, %s, %s);", (key_id, fingerprint, state))
                cursor.execute('''
                    INSERT INTO public.mek_keyring_adoption (
                        singleton, generation, current_kid, loaded_kids,
                        secret_name, secret_key, secret_uid, installation_id,
                        management_mode, ready)
                    VALUES (TRUE, %s, %s, %s, %s, %s, %s, %s, 'osmo', FALSE);
                ''', (
                    keyring.generation, keyring.current_key_id,
                    sorted(keyring.fingerprints), self.config.secret_name,
                    self.config.secret_key, secret.metadata.uid,
                    self.config.installation_id,
                ))
                return secret

    def _finalize_bootstrap(self, keyring: ParsedKeyring, secret) -> None:
        """Verify the fenced database is still empty, then publish readiness."""
        live_secret = self._secret()
        if live_secret.metadata.uid != secret.metadata.uid:
            raise osmo_errors.OSMOError("MEK Secret identity changed during bootstrap.")
        self._verify_secret_keyring(live_secret, keyring)
        with self._database() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s);", (0x4F534D4F4D454B41,))
                self._ensure_registry_schema(cursor)
                cursor.execute(
                    "SELECT generation, current_kid, loaded_kids, secret_name, secret_key, "
                    "secret_uid, installation_id, management_mode, ready "
                    "FROM public.mek_keyring_adoption "
                    "WHERE singleton FOR UPDATE;")
                adoption = cursor.fetchone()
                identity = (
                    self.config.secret_name, self.config.secret_key,
                    live_secret.metadata.uid, self.config.installation_id)
                if adoption is None or adoption[3:8] != (*identity, "osmo"):
                    raise osmo_errors.OSMOError(
                        "Pending MEK bootstrap binding changed concurrently.")
                cursor.execute(
                    "SELECT kid, fingerprint, state FROM public.mek_key_registry;")
                registered = {row[0]: (row[1], row[2]) for row in cursor.fetchall()}
                if registered != self._expected_registry(keyring):
                    raise osmo_errors.OSMOError(
                        "Pending MEK registry changed concurrently.")
                if adoption[8]:
                    cursor.execute(
                        "SELECT writes_allowed FROM public.mek_write_epoch "
                        "WHERE singleton;")
                    if cursor.fetchone() != (True,):
                        raise osmo_errors.OSMOError(
                            "A completed lifecycle operation left the MEK write fence closed.")
                    return
                if adoption[:3] != (
                    keyring.generation, keyring.current_key_id,
                    sorted(keyring.fingerprints),
                ):
                    raise osmo_errors.OSMOError(
                        "Pending MEK bootstrap descriptor changed concurrently.")
                if not adoption[8]:
                    if not self._database_is_raw_empty(cursor):
                        raise osmo_errors.OSMOError(
                            "Protected ciphertext appeared during MEK bootstrap.")
                    cursor.execute(
                        "UPDATE public.mek_keyring_adoption SET ready = TRUE "
                        "WHERE singleton AND NOT ready;")
                cursor.execute(
                    "UPDATE public.mek_write_epoch SET writes_allowed = TRUE, "
                    "epoch = epoch + 1 WHERE singleton;")

    def bootstrap(self, allow_mutation: bool) -> None:
        secret = self._secret()
        if secret.metadata.uid is None or secret.metadata.resource_version is None:
            raise osmo_errors.OSMOError("MEK Secret metadata is incomplete.")
        if (
            (secret.metadata.annotations or {}).get(_MANAGED_ANNOTATION) != "osmo"
            or (secret.metadata.annotations or {}).get(_INSTALLATION_ANNOTATION)
            != self.config.installation_id
        ):
            raise osmo_errors.OSMOError("MEK Secret is not OSMO managed.")
        keyring = self._secret_keyring()
        if keyring is None:
            if not allow_mutation:
                raise osmo_errors.OSMOError("Validation-only bootstrap found an empty Secret.")
            keyring = _new_keyring("initial")
        secret = self._reserve_bootstrap(keyring, secret, allow_mutation)
        self._finalize_bootstrap(keyring, secret)

    def _validate_resumed_rotation(
            self, row, keyring: ParsedKeyring, secret) -> Tuple[str, str]:
        if row["secret_uid"] and row["secret_uid"] != secret.metadata.uid:
            raise osmo_errors.OSMOError("MEK Secret identity changed during rotation.")
        phase = row["phase"]
        candidate_key_id = _candidate_key_id(self.config.request_id)
        annotation_matches = (
            (secret.metadata.annotations or {}).get(_ROTATION_ANNOTATION)
            == self.config.request_id)
        resource_version_matches = (
            not row["secret_resource_version"]
            or row["secret_resource_version"] == secret.metadata.resource_version)
        completion_marker_matches = (
            phase == "complete"
            and (secret.metadata.annotations or {}).get(_ROTATION_COMPLETE_ANNOTATION)
            == self.config.request_id)
        # Kubernetes Secret mutation and the PostgreSQL phase CAS cannot be one
        # transaction. Recognize only the two exact post-patch/pre-CAS states.
        if phase == "claimed" and annotation_matches:
            without_candidate = dict(keyring.fingerprints)
            without_candidate.pop(candidate_key_id, None)
            if (
                candidate_key_id in keyring.fingerprints
                and keyring.current_key_id != candidate_key_id
                and _registry_digest(without_candidate) == row["registry_digest"]
            ):
                return "prepare-written", keyring.generation
        if (
            phase == "prepared" and annotation_matches
            and keyring.current_key_id == candidate_key_id
            and keyring.registry_digest == row["registry_digest"]
        ):
            return "activate-written", keyring.generation
        if not resource_version_matches and not completion_marker_matches:
            raise osmo_errors.OSMOError("MEK Secret changed outside the rotation state machine.")
        if phase == "claimed":
            valid = keyring.generation == row["predecessor_generation"]
        elif phase in ("prepare-written", "prepared"):
            valid = (
                keyring.generation == row["candidate_generation"]
                and keyring.current_key_id != candidate_key_id
                and candidate_key_id in keyring.fingerprints
            )
        elif phase in ("activate-written", "activated", "complete"):
            valid = (
                keyring.generation == row["candidate_generation"]
                and keyring.current_key_id == candidate_key_id
            )
        else:
            valid = False
        if not valid or (
            phase != "claimed" and not annotation_matches
        ):
            raise osmo_errors.OSMOError(
                "MEK Secret does not match the durable rotation phase.")
        if row["registry_digest"] and row["registry_digest"] != keyring.registry_digest:
            raise osmo_errors.OSMOError(
                "MEK registry digest changed outside the rotation state machine.")
        return phase, row["candidate_generation"]

    def _claim_rotation(self, keyring: ParsedKeyring, secret) -> RotationClaim:
        with self._database() as connection:
            with connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s);", (0x4F534D4F4D454B52,))
                cursor.execute(
                    "SELECT rotation_id, fencing_epoch, phase, active_pod_uid, "
                    "active_service_account, credential_fenced, predecessor_generation, "
                    "candidate_generation, registry_digest, secret_uid, "
                    "secret_resource_version FROM public.mek_rewrap_status "
                    "WHERE singleton FOR UPDATE;")
                row = cursor.fetchone()
                cursor.execute(
                    "SELECT secret_name, secret_key, secret_uid, installation_id, "
                    "management_mode, ready "
                    "FROM public.mek_keyring_adoption WHERE singleton;")
                adoption = cursor.fetchone()
                if adoption != (
                    self.config.secret_name, self.config.secret_key,
                    secret.metadata.uid, self.config.installation_id, "osmo", True,
                ):
                    raise osmo_errors.OSMOError(
                        "Live MEK Secret does not match its installation binding.")
                if (
                    row and row["rotation_id"]
                    and row["rotation_id"] != self.config.request_id
                    and row["phase"] != "complete"
                ):
                    raise osmo_errors.OSMOError("A different MEK rotation is incomplete.")
                same_request = bool(
                    row and row["rotation_id"] == self.config.request_id)
                if not same_request:
                    cursor.execute(
                        "SELECT kid, fingerprint FROM public.mek_key_registry;")
                    registered = {
                        registry_row["kid"]: registry_row["fingerprint"]
                        for registry_row in cursor.fetchall()
                    }
                    if registered != dict(keyring.fingerprints):
                        raise osmo_errors.OSMOError(
                            "Live MEK Secret does not match the registered key bundle.")
                resumed_phase = "claimed"
                resumed_candidate_generation = ""
                if same_request:
                    resumed_phase, resumed_candidate_generation = (
                        self._validate_resumed_rotation(row, keyring, secret))
                    if resumed_phase == "complete":
                        cursor.execute('''
                            UPDATE public.mek_rewrap_status
                            SET secret_resource_version = %s
                            WHERE singleton AND rotation_id = %s AND phase = 'complete'
                              AND secret_uid = %s;
                        ''', (
                            secret.metadata.resource_version,
                            self.config.request_id, secret.metadata.uid,
                        ))
                        if cursor.rowcount != 1:
                            raise osmo_errors.OSMOError(
                                "Completed MEK rotation changed concurrently.")
                        return RotationClaim(
                            row["fencing_epoch"], "complete",
                            row["predecessor_generation"], row["candidate_generation"])
                if (
                    same_request and row["active_pod_uid"]
                    and row["active_pod_uid"] != self.config.pod_uid
                    and not row["credential_fenced"]
                ):
                    raise osmo_errors.OSMOError(
                        "Previous MEK rotation attempt has not been credential-fenced.")
                fencing_epoch = (row["fencing_epoch"] if row else 0) + 1
                phase = resumed_phase if same_request else "claimed"
                predecessor_generation = (
                    row["predecessor_generation"] if same_request else keyring.generation)
                candidate_generation = (
                    resumed_candidate_generation if same_request else "")
                if (
                    same_request and row["credential_fenced"]
                    and phase == "activated"
                ):
                    cursor.execute('''
                        UPDATE public.mek_write_epoch
                        SET writes_allowed = TRUE, epoch = epoch + 1
                        WHERE singleton;
                    ''')
                    if cursor.rowcount != 1:
                        raise osmo_errors.OSMOError(
                            "MEK write fence is not initialized.")
                cursor.execute('''
                    INSERT INTO public.mek_rewrap_status (
                        singleton, generation, current_kid, persistence_registry_version,
                        rotation_id, fencing_epoch, phase, active_pod_uid,
                        active_service_account, credential_fenced, predecessor_generation,
                        candidate_generation, registry_digest, secret_uid,
                        secret_resource_version, last_started_at)
                    VALUES (TRUE, %s, %s, %s, %s, %s, %s, %s, %s, FALSE,
                            %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (singleton) DO UPDATE SET
                        rotation_id = EXCLUDED.rotation_id,
                        fencing_epoch = EXCLUDED.fencing_epoch,
                        phase = EXCLUDED.phase,
                        active_pod_uid = EXCLUDED.active_pod_uid,
                        active_service_account = EXCLUDED.active_service_account,
                        credential_fenced = FALSE,
                        predecessor_generation = EXCLUDED.predecessor_generation,
                        candidate_generation = EXCLUDED.candidate_generation,
                        registry_digest = EXCLUDED.registry_digest,
                        secret_uid = EXCLUDED.secret_uid,
                        secret_resource_version = EXCLUDED.secret_resource_version,
                        last_started_at = NOW(), blocker = '';
                ''', (
                    keyring.generation, keyring.current_key_id,
                    connectors.MEK_PERSISTENCE_REGISTRY_VERSION,
                    self.config.request_id, fencing_epoch, phase, self.config.pod_uid,
                    self.config.service_account, predecessor_generation,
                    candidate_generation,
                    keyring.registry_digest, secret.metadata.uid,
                    secret.metadata.resource_version,
                ))
                return RotationClaim(
                    fencing_epoch, phase, predecessor_generation, candidate_generation)

    def _advance_phase(
            self, fencing_epoch: int, expected_phase: str, next_phase: str,
            keyring: ParsedKeyring, secret) -> None:
        live_secret = self._secret()
        if (
            live_secret.metadata.uid != secret.metadata.uid
            or live_secret.metadata.resource_version != secret.metadata.resource_version
            or (live_secret.metadata.annotations or {}).get(_ROTATION_ANNOTATION)
            != self.config.request_id
        ):
            raise osmo_errors.OSMOError(
                "MEK Secret changed before the rotation phase was committed.")
        self._verify_secret_keyring(live_secret, keyring)
        with self._database() as connection:
            with connection.cursor() as cursor:
                cursor.execute('''
                    UPDATE public.mek_rewrap_status SET
                        phase = %s, generation = %s, current_kid = %s,
                        candidate_generation = %s, registry_digest = %s,
                        secret_uid = %s, secret_resource_version = %s
                    WHERE singleton AND rotation_id = %s AND fencing_epoch = %s
                      AND active_pod_uid = %s AND phase = %s;
                ''', (
                    next_phase, keyring.generation, keyring.current_key_id,
                    keyring.generation, keyring.registry_digest,
                    secret.metadata.uid, secret.metadata.resource_version,
                    self.config.request_id, fencing_epoch, self.config.pod_uid,
                    expected_phase,
                ))
                if cursor.rowcount != 1:
                    raise osmo_errors.OSMOError("MEK rotation phase fence was lost.")
                if next_phase == "activated":
                    cursor.execute(
                        "UPDATE public.mek_key_registry SET state = CASE "
                        "WHEN kid = %s THEN 'current' ELSE 'prepared' END;",
                        (keyring.current_key_id,))

    def _record_completion_marker(
            self, fencing_epoch: int, keyring: ParsedKeyring, secret) -> None:
        """Bind the post-completion Secret annotation revision to durable state."""
        if (
            (secret.metadata.annotations or {}).get(_ROTATION_COMPLETE_ANNOTATION)
            != self.config.request_id
        ):
            raise osmo_errors.OSMOError("MEK rotation completion marker is absent.")
        self._verify_secret_keyring(secret, keyring)
        with self._database() as connection:
            with connection.cursor() as cursor:
                cursor.execute('''
                    UPDATE public.mek_rewrap_status SET secret_resource_version = %s
                    WHERE singleton AND rotation_id = %s AND fencing_epoch = %s
                      AND active_pod_uid = %s AND phase = 'complete'
                      AND secret_uid = %s;
                ''', (
                    secret.metadata.resource_version, self.config.request_id,
                    fencing_epoch, self.config.pod_uid, secret.metadata.uid,
                ))
                if cursor.rowcount != 1:
                    raise osmo_errors.OSMOError(
                        "MEK completion marker fence was lost.")

    @staticmethod
    def _label_selector(labels: Mapping[str, str]) -> str:
        return ",".join(f"{key}={value}" for key, value in sorted(labels.items()))

    def _required_pod_uids(self) -> Tuple[str, ...]:
        required = set()
        for deployment_name in self.config.consumer_deployments:
            deployment = self.apps.read_namespaced_deployment(
                deployment_name, self.config.namespace)
            status = deployment.status
            desired = deployment.spec.replicas or 0
            if (
                status.observed_generation != deployment.metadata.generation
                or status.replicas != desired
                or status.updated_replicas != desired
                or status.available_replicas != desired
            ):
                raise osmo_errors.OSMOError(
                    f"MEK consumer Deployment {deployment_name} is changing.")
            match_labels = deployment.spec.selector.match_labels or {}
            if not match_labels or deployment.spec.selector.match_expressions:
                raise osmo_errors.OSMOError(
                    f"MEK consumer Deployment {deployment_name} has an unsupported selector.")
            selector = self._label_selector(match_labels)
            replica_sets = self.apps.list_namespaced_replica_set(
                self.config.namespace, label_selector=selector).items
            deployment_uid = deployment.metadata.uid
            replica_set_uids = {
                replica_set.metadata.uid
                for replica_set in replica_sets
                if any(
                    owner.kind == "Deployment" and owner.uid == deployment_uid
                    for owner in (replica_set.metadata.owner_references or [])
                )
            }
            pods = self.core.list_namespaced_pod(
                self.config.namespace, label_selector=selector).items
            deployment_pods = []
            for pod in pods:
                if pod.status.phase in ("Succeeded", "Failed"):
                    continue
                if any(
                    owner.kind == "ReplicaSet" and owner.uid in replica_set_uids
                    for owner in (pod.metadata.owner_references or [])
                ):
                    deployment_pods.append(pod)
            if len(deployment_pods) != desired:
                raise osmo_errors.OSMOError(
                    f"MEK consumer Deployment {deployment_name} Pod set is changing.")
            for pod in deployment_pods:
                if pod.metadata.uid is None:
                    raise osmo_errors.OSMOError("A MEK consumer Pod has no UID.")
                required.add(pod.metadata.uid)
        if not required:
            raise osmo_errors.OSMOError("No live MEK consumer Pods were found.")
        return tuple(sorted(required))

    def _acknowledged(
            self, keyring: ParsedKeyring, active: bool,
            not_before: datetime.datetime) -> bool:
        first = self._required_pod_uids()
        time.sleep(2)
        second = self._required_pod_uids()
        if first != second:
            return False
        with self._database() as connection:
            with connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
                cursor.execute('''
                    SELECT consumer_id, generation, current_kid, loaded_kids,
                           registry_digest
                    FROM public.mek_consumer_status
                    WHERE consumer_id = ANY(%s) AND last_seen_at >= %s;
                ''', (list(second), not_before))
                statuses = {row["consumer_id"]: row for row in cursor.fetchall()}
        return all(
            pod_uid in statuses
            and statuses[pod_uid]["generation"] == keyring.generation
            and statuses[pod_uid]["registry_digest"] == keyring.registry_digest
            and statuses[pod_uid]["loaded_kids"] == sorted(keyring.fingerprints)
            and (not active or statuses[pod_uid]["current_kid"] == keyring.current_key_id)
            for pod_uid in second
        )

    def _wait_for_acknowledgements(self, keyring: ParsedKeyring, active: bool) -> None:
        with self._database() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT clock_timestamp();")
                not_before = cursor.fetchone()[0]
        while True:
            self._check_deadline()
            if self._acknowledged(keyring, active, not_before):
                if self._acknowledged(keyring, active, not_before):
                    return
            time.sleep(3)

    def rotate(self) -> None:
        if not self.config.request_id:
            raise osmo_errors.OSMOError("Rotation request_id is required.")
        secret = self._secret()
        if secret.metadata.uid is None or secret.metadata.resource_version is None:
            raise osmo_errors.OSMOError("MEK Secret metadata is incomplete.")
        if (
            (secret.metadata.annotations or {}).get(_MANAGED_ANNOTATION) != "osmo"
            or (secret.metadata.annotations or {}).get(_INSTALLATION_ANNOTATION)
            != self.config.installation_id
        ):
            raise osmo_errors.OSMOError("Built-in rotation requires an OSMO-managed Secret.")
        predecessor = self._required_keyring_from_secret(secret, "MEK Secret is empty.")
        claim = self._claim_rotation(predecessor, secret)
        self.rotation_claimed = True
        # Persist the Pod/ServiceAccount claim before acquiring the Kubernetes
        # Lease. A crash at any later point is therefore recoverable from the
        # durable row; there is no pre-claim Lease state with unknown credentials.
        self.acquire_lease()
        fencing_epoch, phase = claim.fencing_epoch, claim.phase
        if phase == "complete":
            if (secret.metadata.annotations or {}).get(
                    _ROTATION_COMPLETE_ANNOTATION) != self.config.request_id:
                completed_secret = self._patch_secret(
                    predecessor, secret.metadata.resource_version,
                    {_ROTATION_COMPLETE_ANNOTATION: self.config.request_id})
                self._record_completion_marker(
                    fencing_epoch, predecessor, completed_secret)
            return
        prepared = predecessor
        if phase == "claimed":
            if (
                (secret.metadata.annotations or {}).get(_ROTATION_ANNOTATION)
                == self.config.request_id
            ):
                prepared = predecessor
            else:
                prepared = _add_candidate(predecessor, self.config.request_id)
                secret = self._patch_secret(
                    prepared, secret.metadata.resource_version,
                    {_ROTATION_ANNOTATION: self.config.request_id})
            self._advance_phase(
                fencing_epoch, "claimed", "prepare-written", prepared, secret)
            phase = "prepare-written"
        if phase == "prepare-written":
            secret = self._secret()
            prepared = self._required_keyring_from_secret(
                secret, "Prepared MEK Secret is empty.")
            self._wait_for_acknowledgements(prepared, active=False)
            secret = self._secret()
            self._advance_phase(
                fencing_epoch, "prepare-written", "prepared", prepared, secret)
            phase = "prepared"
        if phase == "prepared":
            secret = self._secret()
            prepared = self._required_keyring_from_secret(
                secret, "Prepared MEK Secret is empty.")
            candidate_key_id = _candidate_key_id(self.config.request_id)
            document = dict(prepared.document)
            document["currentMek"] = candidate_key_id
            activated = _parse_keyring(_serialize_keyring(document))
            secret = self._patch_secret(
                activated, secret.metadata.resource_version,
                {_ROTATION_ANNOTATION: self.config.request_id})
            self._advance_phase(
                fencing_epoch, "prepared", "activate-written", activated, secret)
            phase = "activate-written"
        if phase == "activate-written":
            secret = self._secret()
            activated = self._required_keyring_from_secret(
                secret, "Activated MEK Secret is empty.")
            self._wait_for_acknowledgements(activated, active=True)
            secret = self._secret()
            self._advance_phase(
                fencing_epoch, "activate-written", "activated", activated, secret)
            phase = "activated"
        if phase == "activated":
            secret = self._secret()
            activated = self._required_keyring_from_secret(
                secret, "Activated MEK Secret is empty.")
            with tempfile.NamedTemporaryFile(mode="wb", delete=False) as keyring_file:
                keyring_file.write(activated.encoded)
                keyring_path = keyring_file.name
            database = None
            try:
                connector_config = self.config.model_copy(update={
                    "mek_file": keyring_path,
                    "mek_secret_name": self.config.secret_name,
                    "mek_secret_key": self.config.secret_key,
                    "mek_installation_id": self.config.installation_id,
                })
                database = connectors.PostgresConnector(connector_config)
                database.rewrap_mek_references(
                    max(1, int(self.deadline - time.monotonic())))
            finally:
                if database is not None:
                    database.close()
                Path(keyring_path).unlink(missing_ok=True)
            secret = self._secret()
            self._advance_phase(
                fencing_epoch, "activated", "complete", activated, secret)
            completed_secret = self._patch_secret(
                activated, secret.metadata.resource_version,
                {_ROTATION_COMPLETE_ANNOTATION: self.config.request_id})
            self._record_completion_marker(
                fencing_epoch, activated, completed_secret)

    def rebind(self) -> None:
        """Explicitly bind an identical recreated Secret UID to this installation."""
        secret = self._secret()
        if (
            (secret.metadata.annotations or {}).get(_MANAGED_ANNOTATION) != "osmo"
            or (secret.metadata.annotations or {}).get(_INSTALLATION_ANNOTATION)
            != self.config.installation_id
        ):
            raise osmo_errors.OSMOError("MEK Secret is not OSMO managed.")
        keyring = self._required_keyring_from_secret(secret, "MEK Secret is empty.")
        with self._database() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s);", (0x4F534D4F4D454B41,))
                cursor.execute('''
                    SELECT secret_name, secret_key, secret_uid, installation_id,
                           management_mode, ready
                    FROM public.mek_keyring_adoption WHERE singleton FOR UPDATE;
                ''')
                adoption = cursor.fetchone()
                if (
                    adoption is None or not adoption[5]
                    or adoption[:2] != (self.config.secret_name, self.config.secret_key)
                    or adoption[3] != self.config.installation_id
                    or adoption[4] != "osmo"
                ):
                    raise osmo_errors.OSMOError(
                        "MEK installation binding is absent or names another Secret.")
                cursor.execute(
                    "SELECT kid, fingerprint, state FROM public.mek_key_registry;")
                registry = {row[0]: (row[1], row[2]) for row in cursor.fetchall()}
                if registry != self._expected_registry(keyring):
                    raise osmo_errors.OSMOError(
                        "Recreated MEK Secret is not identical to the registered keyring.")
                cursor.execute('''
                    SELECT rotation_id, phase FROM public.mek_rewrap_status
                    WHERE singleton;
                ''')
                rotation = cursor.fetchone()
                if rotation and rotation[0] and rotation[1] != "complete":
                    raise osmo_errors.OSMOError(
                        "Cannot rebind a Secret while MEK rotation is incomplete.")
                live_secret = self._secret()
                if (
                    live_secret.metadata.uid != secret.metadata.uid
                    or live_secret.metadata.resource_version
                    != secret.metadata.resource_version
                ):
                    raise osmo_errors.OSMOError(
                        "Recreated MEK Secret changed during rebind.")
                self._verify_secret_keyring(live_secret, keyring)
                cursor.execute('''
                    UPDATE public.mek_keyring_adoption SET secret_uid = %s
                    WHERE singleton AND secret_uid = %s;
                ''', (secret.metadata.uid, adoption[2]))
                if cursor.rowcount != 1:
                    raise osmo_errors.OSMOError("MEK Secret UID rebind changed concurrently.")

    def release_ownership(self) -> None:
        """Explicitly hand an unchanged managed keyring back to the operator."""
        secret = self._secret()
        if (
            (secret.metadata.annotations or {}).get(_MANAGED_ANNOTATION) != "osmo"
            or (secret.metadata.annotations or {}).get(_INSTALLATION_ANNOTATION)
            != self.config.installation_id
        ):
            raise osmo_errors.OSMOError("MEK Secret is not owned by this installation.")
        keyring = self._required_keyring_from_secret(secret, "MEK Secret is empty.")
        with self._database() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s);", (0x4F534D4F4D454B41,))
                cursor.execute('''
                    SELECT secret_name, secret_key, secret_uid, installation_id,
                           management_mode, ready
                    FROM public.mek_keyring_adoption WHERE singleton FOR UPDATE;
                ''')
                adoption = cursor.fetchone()
                expected_identity = (
                    self.config.secret_name, self.config.secret_key,
                    secret.metadata.uid, self.config.installation_id)
                if (
                    adoption is None or adoption[:4] != expected_identity
                    or adoption[4] not in ("osmo", "external") or not adoption[5]
                ):
                    raise osmo_errors.OSMOError(
                        "MEK ownership binding does not match the live Secret.")
                cursor.execute(
                    "SELECT kid, fingerprint, state FROM public.mek_key_registry;")
                registry = {row[0]: (row[1], row[2]) for row in cursor.fetchall()}
                if registry != self._expected_registry(keyring):
                    raise osmo_errors.OSMOError(
                        "MEK Secret does not match the registered keyring.")
                cursor.execute('''
                    SELECT rotation_id, phase FROM public.mek_rewrap_status
                    WHERE singleton;
                ''')
                rotation = cursor.fetchone()
                if rotation and rotation[0] and rotation[1] != "complete":
                    raise osmo_errors.OSMOError(
                        "Cannot release ownership while MEK rotation is incomplete.")
                live_secret = self._secret()
                if (
                    live_secret.metadata.uid != secret.metadata.uid
                    or live_secret.metadata.resource_version
                    != secret.metadata.resource_version
                ):
                    raise osmo_errors.OSMOError(
                        "MEK Secret changed during ownership release.")
                self._verify_secret_keyring(live_secret, keyring)
                if adoption[4] == "external":
                    return
                cursor.execute('''
                    UPDATE public.mek_keyring_adoption SET management_mode = 'external'
                    WHERE singleton AND management_mode = 'osmo' AND secret_uid = %s;
                ''', (secret.metadata.uid,))
                if cursor.rowcount != 1:
                    raise osmo_errors.OSMOError("MEK ownership release changed concurrently.")

    def reacquire_ownership(self) -> None:
        """Explicitly restore managed ownership after a released rollback boundary."""
        secret = self._secret()
        if (
            (secret.metadata.annotations or {}).get(_MANAGED_ANNOTATION) != "osmo"
            or (secret.metadata.annotations or {}).get(_INSTALLATION_ANNOTATION)
            != self.config.installation_id
        ):
            raise osmo_errors.OSMOError("MEK Secret is not owned by this installation.")
        keyring = self._required_keyring_from_secret(secret, "MEK Secret is empty.")
        with self._database() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s);", (0x4F534D4F4D454B41,))
                cursor.execute('''
                    SELECT secret_name, secret_key, secret_uid, installation_id,
                           management_mode, ready
                    FROM public.mek_keyring_adoption WHERE singleton FOR UPDATE;
                ''')
                adoption = cursor.fetchone()
                expected_identity = (
                    self.config.secret_name, self.config.secret_key,
                    secret.metadata.uid, self.config.installation_id)
                if (
                    adoption is None or adoption[:4] != expected_identity
                    or adoption[4] not in ("external", "osmo") or not adoption[5]
                ):
                    raise osmo_errors.OSMOError(
                        "MEK ownership binding does not match the live Secret.")
                cursor.execute(
                    "SELECT kid, fingerprint, state FROM public.mek_key_registry;")
                registry = {row[0]: (row[1], row[2]) for row in cursor.fetchall()}
                if registry != self._expected_registry(keyring):
                    raise osmo_errors.OSMOError(
                        "MEK Secret does not match the registered keyring.")
                cursor.execute('''
                    SELECT rotation_id, phase FROM public.mek_rewrap_status
                    WHERE singleton;
                ''')
                rotation = cursor.fetchone()
                if rotation and rotation[0] and rotation[1] != "complete":
                    raise osmo_errors.OSMOError(
                        "Cannot reacquire ownership while MEK rotation is incomplete.")
                live_secret = self._secret()
                if (
                    live_secret.metadata.uid != secret.metadata.uid
                    or live_secret.metadata.resource_version
                    != secret.metadata.resource_version
                ):
                    raise osmo_errors.OSMOError(
                        "MEK Secret changed during ownership reacquisition.")
                self._verify_secret_keyring(live_secret, keyring)
                if adoption[4] == "osmo":
                    return
                cursor.execute('''
                    UPDATE public.mek_keyring_adoption SET management_mode = 'osmo'
                    WHERE singleton AND management_mode = 'external' AND secret_uid = %s;
                ''', (secret.metadata.uid,))
                if cursor.rowcount != 1:
                    raise osmo_errors.OSMOError(
                        "MEK ownership reacquisition changed concurrently.")

    def recover(self) -> None:
        """Fence a terminal attempt after its Pod and namespace authorization are gone."""
        with self._database() as connection:
            with connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
                cursor.execute('''
                    SELECT secret_name, secret_key, installation_id, management_mode, ready
                    FROM public.mek_keyring_adoption WHERE singleton;
                ''')
                adoption = cursor.fetchone()
                if adoption != {
                    "secret_name": self.config.secret_name,
                    "secret_key": self.config.secret_key,
                    "installation_id": self.config.installation_id,
                    "management_mode": "osmo",
                    "ready": True,
                }:
                    raise osmo_errors.OSMOError(
                        "Recovery does not match the managed MEK installation binding.")
                cursor.execute('''
                    SELECT rotation_id, phase, active_pod_uid, active_service_account
                    FROM public.mek_rewrap_status WHERE singleton FOR UPDATE;
                ''')
                row = cursor.fetchone()
                if row is None or not row["rotation_id"]:
                    raise osmo_errors.OSMOError("There is no incomplete rotation to recover.")
                if not row["active_pod_uid"] or not row["active_service_account"]:
                    raise osmo_errors.OSMOError(
                        "The rotation attempt has no recoverable workload identity.")
                old_service_account = row["active_service_account"]
                authorization = client.AuthorizationV1Api()
                create_review = authorization.create_namespaced_local_subject_access_review
                while True:
                    self._check_deadline()
                    pods = self.core.list_namespaced_pod(self.config.namespace).items
                    pod_exists = any(
                        pod.metadata.uid == row["active_pod_uid"] for pod in pods)
                    any_allowed = False
                    for verb in ("get", "patch"):
                        review = client.V1LocalSubjectAccessReview(
                            spec=client.V1SubjectAccessReviewSpec(
                                user=(
                                    f"system:serviceaccount:{self.config.namespace}:"
                                    f"{old_service_account}"
                                ),
                                groups=[
                                    "system:serviceaccounts",
                                    f"system:serviceaccounts:{self.config.namespace}",
                                    "system:authenticated",
                                ],
                                resource_attributes=client.V1ResourceAttributes(
                                    namespace=self.config.namespace,
                                    verb=verb,
                                    group="",
                                    resource="secrets",
                                    name=self.config.secret_name,
                                ),
                            )
                        )
                        any_allowed = (
                            create_review(self.config.namespace, review).status.allowed
                            or any_allowed)
                    if not pod_exists and not any_allowed:
                        break
                    time.sleep(2)
                cursor.execute('''
                    UPDATE public.mek_rewrap_status SET credential_fenced = TRUE
                    WHERE singleton AND active_pod_uid = %s AND active_service_account = %s;
                ''', (row["active_pod_uid"], row["active_service_account"]))
                if cursor.rowcount != 1:
                    raise osmo_errors.OSMOError("Rotation recovery fence changed concurrently.")
        lease = self.coordination.read_namespaced_lease(
            self.lease_name, self.config.namespace)
        if lease.spec.holder_identity not in (None, "", row["active_pod_uid"]):
            raise osmo_errors.OSMOError(
                "The MEK lifecycle Lease is owned by a different attempt.")
        if not lease.spec.holder_identity:
            return
        lease.spec.holder_identity = ""
        lease.spec.renew_time = datetime.datetime.now(datetime.timezone.utc)
        self.coordination.replace_namespaced_lease(
            self.lease_name, self.config.namespace, lease)


def _run() -> None:
    """Run one configured operation and revoke its one-shot authorization."""
    lifecycle_config = MekLifecycleConfig.load()
    lifecycle = MekLifecycle(lifecycle_config)
    release_on_failure = lifecycle_config.operation in (
        "bootstrap", "validate", "rebind", "release", "reacquire")
    if lifecycle_config.operation not in ("rotate", "recover"):
        lifecycle.acquire_lease(allow_expired=release_on_failure)
    succeeded = False
    try:
        if lifecycle_config.operation == "bootstrap":
            lifecycle.bootstrap(allow_mutation=True)
        elif lifecycle_config.operation == "validate":
            lifecycle.bootstrap(allow_mutation=False)
        elif lifecycle_config.operation == "rebind":
            lifecycle.rebind()
        elif lifecycle_config.operation == "release":
            lifecycle.release_ownership()
        elif lifecycle_config.operation == "reacquire":
            lifecycle.reacquire_ownership()
        elif lifecycle_config.operation == "recover":
            lifecycle.recover()
        else:
            lifecycle.rotate()
        succeeded = True
    finally:
        try:
            if lifecycle.lease_resource_version and (
                succeeded or release_on_failure
                or (lifecycle_config.operation == "rotate" and not lifecycle.rotation_claimed)
            ):
                lifecycle.release_lease()
        finally:
            # This is deliberately the final Kubernetes operation: deleting the
            # binding immediately removes Secret mutation authority, while the
            # now-inert Role and ServiceAccount remain diagnosable until Helm's
            # next before-hook cleanup.
            lifecycle.revoke_attempt_authority()


def main() -> None:
    """Run without ever rendering Secret/API/DB exception text to logs."""
    logging.basicConfig(level=logging.INFO)
    try:
        _run()
    except Exception:  # pylint: disable=broad-except
        logging.error(
            "MEK lifecycle operation failed; inspect Kubernetes Job status and "
            "the operator runbook for the safe recovery procedure.")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
