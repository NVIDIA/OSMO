"""Kubernetes-native MEK bootstrap and explicit rotation operations.

The Kubernetes Secret is the durable state machine.  A release-scoped Lease
serializes mutations, Pods load a keyring only at startup, and rotations use
operator-driven rollouts between PREPARE, ACTIVATE, and REWRAP.  No MEK
lifecycle state is stored in PostgreSQL.
"""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
# SPDX-License-Identifier: Apache-2.0

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
from typing import Any, Dict, List, Literal, Mapping, Tuple

from jwcrypto import jwk  # type: ignore
from kubernetes import client, config as kubernetes_config  # type: ignore
from kubernetes.client import exceptions as kubernetes_exceptions  # type: ignore
import psycopg2  # type: ignore
import pydantic
import yaml

from src.lib.utils import osmo_errors
from src.utils import connectors, static_config
from src.utils.secret_manager.secret_manager import (
    MAX_KEYRING_BYTES,
    MAX_MEK_COUNT,
    SecretManager,
)


_PREFIX = "osmo.nvidia.com/mek-"
_REQUEST = _PREFIX + "request"
_PHASE = _PREFIX + "phase"
_PREDECESSOR_GENERATION = _PREFIX + "predecessor-generation"
_PREDECESSOR_DIGEST = _PREFIX + "predecessor-digest"
_PREDECESSOR_CURRENT = _PREFIX + "predecessor-current"
_PREPARE_GENERATION = _PREFIX + "prepare-generation"
_ACTIVATE_GENERATION = _PREFIX + "activate-generation"
_BUNDLE_DIGEST = _PREFIX + "bundle-digest"
_CANDIDATE = _PREFIX + "candidate"
_INSTALLATION = _PREFIX + "installation"
_COMPLETED = _PREFIX + "completed"
_DESCRIPTOR_PREFIX = "OSMO_MEK_DESCRIPTOR "
_LEASE_DURATION_SECONDS = 30


@dataclasses.dataclass(frozen=True)
class ParsedKeyring:
    """Validated keyring identities and its YAML representation."""

    document: Dict
    encoded: bytes
    generation: str
    current_key_id: str
    fingerprints: Mapping[str, str]
    registry_digest: str


class MekLifecycleConfig(connectors.PostgresConfig, static_config.StaticConfig):
    """Configuration for one explicit Kubernetes lifecycle operation."""

    postgres_password: str = pydantic.Field(
        default="",
        description="PostgreSQL password, required only by bootstrap and rewrap.",
        json_schema_extra={"env": "OSMO_POSTGRES_PASSWORD"},
    )

    operation: Literal["bootstrap", "validate", "prepare", "activate", "rewrap"] = (
        pydantic.Field(
            description="Lifecycle operation to execute.",
            json_schema_extra={"command_line": "operation", "env": "OSMO_MEK_OPERATION"},
        )
    )
    namespace: str = pydantic.Field(
        description="Kubernetes namespace containing the MEK Secret.",
        json_schema_extra={"command_line": "namespace", "env": "OSMO_NAMESPACE"},
    )
    secret_name: str = pydantic.Field(
        description="Exact MEK Secret name.",
        json_schema_extra={"command_line": "secret_name", "env": "OSMO_MEK_SECRET_NAME"},
    )
    secret_key: str = pydantic.Field(
        default="mek.yaml",
        description="Secret data key containing the keyring.",
        json_schema_extra={"command_line": "secret_key", "env": "OSMO_MEK_SECRET_KEY"},
    )
    installation_id: str = pydantic.Field(
        description="Immutable namespace/release identity.",
        json_schema_extra={
            "command_line": "installation_id", "env": "OSMO_MEK_INSTALLATION_ID"
        },
    )
    management_mode: Literal["external", "osmo"] = pydantic.Field(
        default="external",
        description="Whether OSMO may mutate the MEK Secret.",
        json_schema_extra={
            "command_line": "management_mode", "env": "OSMO_MEK_MANAGEMENT_MODE"
        },
    )
    request_id: str = pydantic.Field(
        default="",
        max_length=64,
        description="Stable non-secret rotation identifier.",
        json_schema_extra={"command_line": "request_id", "env": "OSMO_MEK_REQUEST_ID"},
    )
    pod_uid: str = pydantic.Field(
        default="",
        description="UID of this Job Pod.",
        json_schema_extra={"command_line": "pod_uid", "env": "OSMO_POD_UID"},
    )
    consumer_deployments: List[str] = pydantic.Field(
        default_factory=list,
        description="Exact enabled MEK-consuming Deployment names.",
        json_schema_extra={
            "command_line": "consumer_deployments",
            "env": "OSMO_MEK_CONSUMER_DEPLOYMENTS",
        },
    )
    active_deadline_seconds: int = pydantic.Field(
        default=900,
        gt=0,
        description="Maximum operation duration.",
        json_schema_extra={
            "command_line": "active_deadline_seconds",
            "env": "OSMO_MEK_ACTIVE_DEADLINE_SECONDS",
        },
    )


def _generation(current_key_id: str, key_ids: List[str]) -> str:
    descriptor = json.dumps(
        {"currentMek": current_key_id, "mekIds": sorted(key_ids)},
        separators=(",", ":"), sort_keys=True).encode("utf-8")
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
    except osmo_errors.OSMOError:
        raise
    except (KeyError, TypeError, ValueError, yaml.YAMLError):
        raise osmo_errors.OSMOError("MEK keyring is invalid.") from None
    finally:
        if keyring_path:
            Path(keyring_path).unlink(missing_ok=True)
    fingerprints = manager.key_fingerprints()
    return ParsedKeyring(
        document=document,
        encoded=encoded,
        generation=manager.generation,
        current_key_id=manager.current_mek_id,
        fingerprints=fingerprints,
        registry_digest=_registry_digest(fingerprints),
    )


def _serialize_keyring(document: Dict) -> bytes:
    encoded = yaml.safe_dump(document, sort_keys=True).encode("utf-8")
    if len(encoded) > MAX_KEYRING_BYTES:
        raise osmo_errors.OSMOError("MEK keyring would exceed its size limit.")
    return encoded


def _candidate_key_id(request_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]", "-", request_id).strip("-.") or "rotation"
    return f"mek-{safe}"[:64]


def _new_keyring(request_id: str) -> ParsedKeyring:
    key_id = _candidate_key_id(request_id)
    key = jwk.JWK.generate(kty="oct", size=256, kid=key_id)
    encoded_jwk = base64.b64encode(
        json.dumps(key.export(as_dict=True), separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    return _parse_keyring(_serialize_keyring({
        "currentMek": key_id,
        "meks": {key_id: encoded_jwk},
    }))


def _add_candidate(keyring: ParsedKeyring, request_id: str) -> ParsedKeyring:
    if len(keyring.fingerprints) >= MAX_MEK_COUNT:
        raise osmo_errors.OSMOError(
            "MEK keyring limit reached; this release does not support key retirement.")
    candidate = _new_keyring(request_id)
    key_id = candidate.current_key_id
    if key_id in keyring.document["meks"]:
        raise osmo_errors.OSMOError("Rotation request already names a loaded MEK.")
    document = dict(keyring.document)
    document["meks"] = dict(keyring.document["meks"])
    document["meks"][key_id] = candidate.document["meks"][key_id]
    return _parse_keyring(_serialize_keyring(document))


def _lease_name(installation_id: str, secret_name: str) -> str:
    release = installation_id.rsplit("/", 1)[-1]
    prefix = re.sub(r"[^a-z0-9-]", "-", release.lower()).strip("-") or "osmo"
    digest = hashlib.sha256(
        f"{installation_id}:{secret_name}".encode("utf-8")).hexdigest()[:10]
    trimmed_prefix = prefix[:46].rstrip("-")
    return f"{trimmed_prefix}-mek-{digest}"


class MekLifecycle:
    """One fenced, explicit lifecycle operation."""

    def __init__(self, lifecycle_config: MekLifecycleConfig):
        self.config = lifecycle_config
        if not lifecycle_config.pod_uid:
            raise osmo_errors.OSMOError("Lifecycle Job Pod UID is required.")
        self.deadline = time.monotonic() + lifecycle_config.active_deadline_seconds
        self.holder = (
            f"{lifecycle_config.request_id or lifecycle_config.operation}:"
            f"{lifecycle_config.operation}:{lifecycle_config.pod_uid}"
        )
        self.lease_name = _lease_name(
            lifecycle_config.installation_id, lifecycle_config.secret_name)
        kubernetes_config.load_incluster_config()
        self.core = client.CoreV1Api()
        self.apps = client.AppsV1Api()
        self.coordination = client.CoordinationV1Api()

    def _check_deadline(self) -> None:
        if time.monotonic() >= self.deadline:
            raise osmo_errors.OSMOError("MEK lifecycle operation exceeded its deadline.")

    def acquire_lease(self) -> None:
        """Acquire without stealing: an expired holder may still be a paused Job."""
        try:
            lease = self.coordination.read_namespaced_lease(
                self.lease_name, self.config.namespace)
        except kubernetes_exceptions.ApiException as error:
            if error.status != 404:
                raise
            release = self.config.installation_id.rsplit("/", 1)[-1]
            try:
                lease = self.coordination.create_namespaced_lease(
                    self.config.namespace,
                    {
                        "apiVersion": "coordination.k8s.io/v1",
                        "kind": "Lease",
                        "metadata": {
                            "name": self.lease_name,
                            "labels": {
                                "app.kubernetes.io/name": "osmo",
                                "app.kubernetes.io/instance": release,
                                "app.kubernetes.io/component": "mek-lifecycle",
                                "app.kubernetes.io/managed-by": "osmo-mek-lifecycle",
                            },
                        },
                        "spec": {},
                    },
                )
            except kubernetes_exceptions.ApiException as create_error:
                if create_error.status != 409:
                    raise
                lease = self.coordination.read_namespaced_lease(
                    self.lease_name, self.config.namespace)
        holder = lease.spec.holder_identity or ""
        if holder and holder != self.holder:
            raise osmo_errors.OSMOError(
                "MEK lifecycle Lease is held; delete the old Job Pod and clear its holder "
                "before retrying.")
        now = datetime.datetime.now(datetime.timezone.utc)
        body = {
            "metadata": {"resourceVersion": lease.metadata.resource_version},
            "spec": {
                "holderIdentity": self.holder,
                "leaseDurationSeconds": _LEASE_DURATION_SECONDS,
                "acquireTime": now.isoformat(),
                "renewTime": now.isoformat(),
            },
        }
        self.coordination.patch_namespaced_lease(
            self.lease_name, self.config.namespace, body)

    def _assert_lease(self) -> None:
        lease = self.coordination.read_namespaced_lease(
            self.lease_name, self.config.namespace)
        if lease.spec.holder_identity != self.holder:
            raise osmo_errors.OSMOError("MEK lifecycle Lease ownership changed.")
        lease.spec.renew_time = datetime.datetime.now(datetime.timezone.utc)
        self.coordination.patch_namespaced_lease(
            self.lease_name,
            self.config.namespace,
            {"metadata": {"resourceVersion": lease.metadata.resource_version},
             "spec": {"holderIdentity": self.holder,
                      "renewTime": lease.spec.renew_time.isoformat()}},
        )

    def release_lease(self) -> None:
        lease = self.coordination.read_namespaced_lease(
            self.lease_name, self.config.namespace)
        if lease.spec.holder_identity != self.holder:
            return
        self.coordination.patch_namespaced_lease(
            self.lease_name,
            self.config.namespace,
            {"metadata": {"resourceVersion": lease.metadata.resource_version},
             "spec": {"holderIdentity": None, "renewTime": None}},
        )

    def _secret(self):
        return self.core.read_namespaced_secret(
            self.config.secret_name, self.config.namespace)

    def _optional_secret(self):
        try:
            return self._secret()
        except kubernetes_exceptions.ApiException as error:
            if error.status == 404:
                return None
            raise

    def _keyring_from_secret(self, secret, required: bool = True) -> ParsedKeyring | None:
        encoded = (secret.data or {}).get(self.config.secret_key)
        if not encoded:
            if required:
                raise osmo_errors.OSMOError("MEK Secret data key is empty.")
            return None
        try:
            return _parse_keyring(base64.b64decode(encoded, validate=True))
        except (ValueError, TypeError):
            raise osmo_errors.OSMOError("MEK Secret data is invalid.") from None

    def _required_keyring_from_secret(self, secret) -> ParsedKeyring:
        keyring = self._keyring_from_secret(secret, required=True)
        if keyring is None:  # Kept explicit for static type checking and fail-closed behavior.
            raise osmo_errors.OSMOError("MEK Secret data key is empty.")
        return keyring

    def _patch_secret(
            self, secret, keyring: ParsedKeyring, annotation_updates: Mapping[str, str]
    ):
        """JSON-patch with UID/resourceVersion tests immediately after Lease validation."""
        self._check_deadline()
        self._assert_lease()
        annotations = dict(secret.metadata.annotations or {})
        annotations.update(annotation_updates)
        encoded = base64.b64encode(keyring.encoded).decode("ascii")
        escaped_key = self.config.secret_key.replace("~", "~0").replace("/", "~1")
        patch = [
            {"op": "test", "path": "/metadata/uid", "value": secret.metadata.uid},
            {"op": "test", "path": "/metadata/resourceVersion",
             "value": secret.metadata.resource_version},
            {"op": "add", "path": "/metadata/annotations", "value": annotations},
            {"op": "add", "path": "/data", "value": dict(secret.data or {})},
            {"op": "add", "path": f"/data/{escaped_key}", "value": encoded},
        ]
        return self.core.patch_namespaced_secret(
            self.config.secret_name,
            self.config.namespace,
            patch,
        )

    def _create_secret(self, keyring: ParsedKeyring):
        """Create the full initialized Secret atomically; never patch an empty placeholder."""
        self._check_deadline()
        self._assert_lease()
        release = self.config.installation_id.rsplit("/", 1)[-1]
        return self.core.create_namespaced_secret(
            self.config.namespace,
            {
                "apiVersion": "v1",
                "kind": "Secret",
                "metadata": {
                    "name": self.config.secret_name,
                    "labels": {
                        "app.kubernetes.io/name": "osmo",
                        "app.kubernetes.io/instance": release,
                        "app.kubernetes.io/component": "master-encryption-key",
                        "app.kubernetes.io/managed-by": "osmo-mek-lifecycle",
                    },
                    "annotations": {
                        _INSTALLATION: self.config.installation_id,
                        _PHASE: "idle",
                        _BUNDLE_DIGEST: keyring.registry_digest,
                    },
                },
                "type": "Opaque",
                "data": {
                    self.config.secret_key: base64.b64encode(keyring.encoded).decode("ascii")
                },
            },
        )

    @staticmethod
    def _rotation_annotations(secret) -> Dict[str, str]:
        return dict(secret.metadata.annotations or {})

    def _assert_installation(self, annotations: Mapping[str, str]) -> None:
        existing = annotations.get(_INSTALLATION)
        if existing and existing != self.config.installation_id:
            raise osmo_errors.OSMOError("MEK Secret belongs to another Helm release.")

    @staticmethod
    def _descriptor_from_log(log_text: str) -> Dict:
        matches = []
        for line in log_text.splitlines():
            try:
                structured = json.loads(line)
            except json.JSONDecodeError:
                structured = None
            candidates = [line]
            if isinstance(structured, dict) and isinstance(structured.get("message"), str):
                candidates.append(structured["message"])
            for candidate in candidates:
                marker = candidate.find(_DESCRIPTOR_PREFIX)
                if marker < 0:
                    continue
                try:
                    descriptor = json.loads(candidate[marker + len(_DESCRIPTOR_PREFIX):])
                except json.JSONDecodeError:
                    continue
                if isinstance(descriptor, dict):
                    matches.append(descriptor)
        if not matches:
            raise osmo_errors.OSMOError("Pod has no machine-readable MEK startup descriptor.")
        return matches[-1]

    def _current_replica_sets(self, deployment, selector: str) -> Dict[str, Any]:
        """Return only the exact highest-revision ReplicaSet(s) for one Deployment."""
        revisions = []
        for replica_set in self.apps.list_namespaced_replica_set(
                self.config.namespace, label_selector=selector).items:
            owners = [
                owner for owner in replica_set.metadata.owner_references or []
                if owner.controller and owner.kind == "Deployment"
            ]
            if (
                len(owners) != 1
                or owners[0].name != deployment.metadata.name
                or owners[0].uid != deployment.metadata.uid
            ):
                continue
            try:
                revision = int((replica_set.metadata.annotations or {})[
                    "deployment.kubernetes.io/revision"])
            except (KeyError, TypeError, ValueError):
                raise osmo_errors.OSMOError(
                    f"MEK consumer ReplicaSet {replica_set.metadata.name} has no revision.") \
                    from None
            revisions.append((revision, replica_set))
        if not revisions:
            return {}
        current_revision = max(revision for revision, _ in revisions)
        return {
            replica_set.metadata.name: replica_set
            for revision, replica_set in revisions
            if revision == current_revision
        }

    def _observe_pods_once(self, expected: ParsedKeyring) -> Tuple[str, ...]:
        if not self.config.consumer_deployments:
            raise osmo_errors.OSMOError("No MEK consumer Deployments were configured.")
        observed = []
        expected_descriptor = {
            "currentKid": expected.current_key_id,
            "loadedKids": sorted(expected.fingerprints),
            "generation": expected.generation,
            "digest": expected.registry_digest,
        }
        for deployment_name in sorted(set(self.config.consumer_deployments)):
            deployment = self.apps.read_namespaced_deployment(
                deployment_name, self.config.namespace)
            desired = deployment.spec.replicas or 0
            status = deployment.status
            if (
                desired < 1
                or status.observed_generation != deployment.metadata.generation
                or status.updated_replicas != desired
                or status.ready_replicas != desired
                or status.available_replicas != desired
            ):
                raise osmo_errors.OSMOError(
                    f"MEK consumer Deployment {deployment_name} rollout is incomplete.")
            selector = ",".join(
                f"{key}={value}" for key, value in
                sorted((deployment.spec.selector.match_labels or {}).items()))
            current_replica_sets = self._current_replica_sets(deployment, selector)
            if not current_replica_sets:
                raise osmo_errors.OSMOError(
                    f"MEK consumer Deployment {deployment_name} has no current ReplicaSet.")
            pods = self.core.list_namespaced_pod(
                self.config.namespace, label_selector=selector).items
            owned = []
            for pod in pods:
                if pod.status.phase in ("Succeeded", "Failed"):
                    continue
                owners = [owner for owner in pod.metadata.owner_references or []
                          if owner.controller and owner.kind == "ReplicaSet"]
                if len(owners) != 1:
                    raise osmo_errors.OSMOError(
                        f"Selected MEK consumer Pod {pod.metadata.name} has an unexpected owner.")
                replica_set = current_replica_sets.get(owners[0].name)
                if replica_set is None:
                    raise osmo_errors.OSMOError(
                        f"Selected MEK consumer Pod {pod.metadata.name} is not in the current "
                        "ReplicaSet.")
                if owners[0].uid != replica_set.metadata.uid:
                    raise osmo_errors.OSMOError(
                        f"MEK consumer Pod {pod.metadata.name} has a stale ReplicaSet owner.")
                deployment_owners = [owner for owner in replica_set.metadata.owner_references or []
                                     if owner.controller and owner.kind == "Deployment"]
                if len(deployment_owners) != 1 or deployment_owners[0].name != deployment_name:
                    raise osmo_errors.OSMOError(
                        f"Selected MEK consumer Pod {pod.metadata.name} has the wrong Deployment.")
                if deployment_owners[0].uid != deployment.metadata.uid:
                    raise osmo_errors.OSMOError(
                        f"MEK consumer ReplicaSet {replica_set.metadata.name} has a stale owner.")
                ready = any(
                    condition.type == "Ready" and condition.status == "True"
                    for condition in pod.status.conditions or [])
                if pod.metadata.deletion_timestamp or pod.status.phase != "Running" or not ready:
                    raise osmo_errors.OSMOError(
                        f"MEK consumer Pod {pod.metadata.name} is not stably Ready.")
                container_name = pod.spec.containers[0].name
                log_text = self.core.read_namespaced_pod_log(
                    pod.metadata.name, self.config.namespace, container=container_name)
                if self._descriptor_from_log(log_text) != expected_descriptor:
                    raise osmo_errors.OSMOError(
                        f"MEK consumer Pod {pod.metadata.name} loaded another keyring.")
                owned.append(pod.metadata.uid)
            if len(owned) != desired:
                raise osmo_errors.OSMOError(
                    f"MEK consumer Deployment {deployment_name} has an unexpected Pod cohort.")
            observed.extend(owned)
        return tuple(sorted(observed))

    def verify_rollout(self, expected: ParsedKeyring) -> None:
        """Require two identical observations of every exact owned consumer Pod."""
        first = self._observe_pods_once(expected)
        self._check_deadline()
        time.sleep(2)
        second = self._observe_pods_once(expected)
        if first != second:
            raise osmo_errors.OSMOError("MEK consumer Pod cohort changed during verification.")

    def _connect_database_ready(self):
        """Wait within the Job deadline for PostgreSQL to accept connections."""
        while True:
            self._check_deadline()
            try:
                return psycopg2.connect(
                    host=self.config.postgres_host,
                    port=self.config.postgres_port,
                    user=self.config.postgres_user,
                    password=self.config.postgres_password,
                    dbname=self.config.postgres_database_name,
                    connect_timeout=max(1, min(5, int(self.deadline - time.monotonic()))),
                )
            except psycopg2.OperationalError:
                time.sleep(min(2, max(0.1, self.deadline - time.monotonic())))

    @staticmethod
    def _database_is_fresh(connection) -> bool:
        with connection.cursor() as cursor:
            for table in ("users", "ueks", "configs"):
                cursor.execute("SELECT to_regclass(%s);", (f"public.{table}",))
                if cursor.fetchone()[0] is None:
                    continue
                cursor.execute(f"SELECT 1 FROM public.{table} LIMIT 1;")
                if cursor.fetchone() is not None:
                    return False
        return True

    def _bootstrap_consumer_cohort(self) -> Tuple[str, ...]:
        """Prove chart consumer application containers have never started."""
        observed = []
        for deployment_name in sorted(set(self.config.consumer_deployments)):
            deployment = self.apps.read_namespaced_deployment(
                deployment_name, self.config.namespace)
            selector = ",".join(
                f"{key}={value}" for key, value in
                sorted((deployment.spec.selector.match_labels or {}).items()))
            current_replica_sets = self._current_replica_sets(deployment, selector)
            for pod in self.core.list_namespaced_pod(
                    self.config.namespace, label_selector=selector).items:
                if pod.status.phase in ("Succeeded", "Failed"):
                    continue
                owners = [owner for owner in pod.metadata.owner_references or []
                          if owner.controller and owner.kind == "ReplicaSet"]
                if len(owners) != 1:
                    raise osmo_errors.OSMOError(
                        f"Selected bootstrap Pod {pod.metadata.name} has an unexpected owner.")
                replica_set = current_replica_sets.get(owners[0].name)
                if replica_set is None:
                    raise osmo_errors.OSMOError(
                        f"Selected bootstrap Pod {pod.metadata.name} is not in the current "
                        "ReplicaSet.")
                if owners[0].uid != replica_set.metadata.uid:
                    raise osmo_errors.OSMOError(
                        f"Selected bootstrap Pod {pod.metadata.name} has a stale owner.")
                deployment_owners = [
                    owner for owner in replica_set.metadata.owner_references or []
                    if owner.controller and owner.kind == "Deployment"
                ]
                if (
                    len(deployment_owners) != 1
                    or deployment_owners[0].name != deployment_name
                    or deployment_owners[0].uid != deployment.metadata.uid
                ):
                    raise osmo_errors.OSMOError(
                        f"Selected bootstrap Pod {pod.metadata.name} has the wrong Deployment.")
                statuses = pod.status.container_statuses or []
                if any(
                    status.state.running is not None
                    or status.state.terminated is not None
                    or status.restart_count
                    or status.container_id
                    for status in statuses
                ):
                    raise osmo_errors.OSMOError(
                        f"MEK bootstrap consumer Pod {pod.metadata.name} has started a writer.")
                observed.append(pod.metadata.uid)
        return tuple(sorted(observed))

    def _verify_bootstrap_quiescence(self) -> None:
        while True:
            self._check_deadline()
            try:
                first = self._bootstrap_consumer_cohort()
                time.sleep(2)
                if first == self._bootstrap_consumer_cohort():
                    return
            except kubernetes_exceptions.ApiException as error:
                if error.status != 404:
                    raise
            time.sleep(1)

    def _authenticate_existing_database(self, keyring: ParsedKeyring) -> None:
        keyring_path = ""
        try:
            with tempfile.NamedTemporaryFile(mode="wb", delete=False) as keyring_file:
                keyring_file.write(keyring.encoded)
                keyring_path = keyring_file.name
            config = self.config.model_copy(update={"mek_file": keyring_path})
            connector = connectors.PostgresConnector(config)
            connector.close()
        finally:
            if keyring_path:
                Path(keyring_path).unlink(missing_ok=True)

    def bootstrap(self) -> None:
        if self.config.management_mode != "osmo":
            raise osmo_errors.OSMOError("Automatic MEK bootstrap requires managed mode.")
        secret = self._optional_secret()
        if secret is not None:
            annotations = self._rotation_annotations(secret)
            if (
                annotations.get(_INSTALLATION) != self.config.installation_id
                or annotations.get(_PHASE) != "idle"
            ):
                raise osmo_errors.OSMOError(
                    "Existing MEK Secret is not an exact bootstrap retry for this installation.")
            existing = self._required_keyring_from_secret(secret)
            if annotations.get(_BUNDLE_DIGEST) != existing.registry_digest:
                raise osmo_errors.OSMOError(
                    "Existing bootstrap MEK Secret identity does not match its data.")
            self._authenticate_existing_database(existing)
            logging.info(
                "Validated existing bootstrap MEK Secret current_kid=%s",
                existing.current_key_id)
            return
        connection = self._connect_database_ready()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_lock(%s);", (0x4F534D4F4D454B,))
            if not self._database_is_fresh(connection):
                raise osmo_errors.OSMOError(
                    "Automatic MEK generation is allowed only for a fresh OSMO database.")
            self._verify_bootstrap_quiescence()
            if self._optional_secret() is not None:
                raise osmo_errors.OSMOError(
                    "MEK Secret appeared during bootstrap; retry exact-state validation.")
            keyring = _new_keyring("initial")
            self._create_secret(keyring)
        finally:
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_unlock(%s);", (0x4F534D4F4D454B,))
            finally:
                connection.close()
        logging.info("Initialized Kubernetes MEK Secret current_kid=%s", keyring.current_key_id)

    def validate(self) -> None:
        secret = self._secret()
        self._assert_installation(self._rotation_annotations(secret))
        keyring = self._required_keyring_from_secret(secret)
        logging.info(
            "Validated Kubernetes MEK Secret current_kid=%s loaded_kids=%s",
            keyring.current_key_id, sorted(keyring.fingerprints))

    def prepare(self) -> None:
        if self.config.management_mode != "osmo":
            raise osmo_errors.OSMOError("PREPARE Secret mutation requires managed mode.")
        if not self.config.request_id:
            raise osmo_errors.OSMOError("MEK PREPARE requires a request ID.")
        secret = self._secret()
        annotations = self._rotation_annotations(secret)
        self._assert_installation(annotations)
        keyring = self._required_keyring_from_secret(secret)
        phase = annotations.get(_PHASE, "idle")
        if phase == "prepared" and annotations.get(_REQUEST) == self.config.request_id:
            if (
                annotations.get(_PREPARE_GENERATION) != keyring.generation
                or annotations.get(_BUNDLE_DIGEST) != keyring.registry_digest
            ):
                raise osmo_errors.OSMOError("Existing PREPARE state does not match Secret data.")
            return
        if phase not in ("idle", "complete"):
            raise osmo_errors.OSMOError("Another MEK rotation is incomplete.")
        candidate = _add_candidate(keyring, self.config.request_id)
        if candidate.current_key_id != keyring.current_key_id:
            raise osmo_errors.OSMOError("PREPARE cannot change the current MEK.")
        candidate_id = next(iter(set(candidate.fingerprints) - set(keyring.fingerprints)))
        self._patch_secret(secret, candidate, {
            _INSTALLATION: self.config.installation_id,
            _REQUEST: self.config.request_id,
            _PHASE: "prepared",
            _PREDECESSOR_GENERATION: keyring.generation,
            _PREDECESSOR_DIGEST: keyring.registry_digest,
            _PREDECESSOR_CURRENT: keyring.current_key_id,
            _PREPARE_GENERATION: candidate.generation,
            _BUNDLE_DIGEST: candidate.registry_digest,
            _CANDIDATE: candidate_id,
            _COMPLETED: "",
        })
        logging.info("MEK PREPARE committed candidate=%s", candidate_id)

    def activate(self) -> None:
        if self.config.management_mode != "osmo":
            raise osmo_errors.OSMOError("ACTIVATE Secret mutation requires managed mode.")
        secret = self._secret()
        annotations = self._rotation_annotations(secret)
        self._assert_installation(annotations)
        if annotations.get(_REQUEST) == self.config.request_id and annotations.get(
                _PHASE) in ("activated", "complete"):
            activated = self._required_keyring_from_secret(secret)
            if (
                activated.generation != annotations.get(_ACTIVATE_GENERATION)
                or activated.registry_digest != annotations.get(_BUNDLE_DIGEST)
                or activated.current_key_id != annotations.get(_CANDIDATE)
            ):
                raise osmo_errors.OSMOError(
                    "Existing ACTIVATE state does not match Secret data.")
            return
        if (
            annotations.get(_REQUEST) != self.config.request_id
            or annotations.get(_PHASE) != "prepared"
        ):
            raise osmo_errors.OSMOError("ACTIVATE requires the matching completed PREPARE phase.")
        prepared = self._required_keyring_from_secret(secret)
        if (
            prepared.generation != annotations.get(_PREPARE_GENERATION)
            or prepared.registry_digest != annotations.get(_BUNDLE_DIGEST)
            or prepared.current_key_id != annotations.get(_PREDECESSOR_CURRENT)
            or annotations.get(_CANDIDATE) not in prepared.fingerprints
        ):
            raise osmo_errors.OSMOError("PREPARE annotations do not match Secret data.")
        self.verify_rollout(prepared)
        document = dict(prepared.document)
        document["currentMek"] = annotations[_CANDIDATE]
        activated = _parse_keyring(_serialize_keyring(document))
        self._patch_secret(secret, activated, {
            _PHASE: "activated",
            _ACTIVATE_GENERATION: activated.generation,
            _BUNDLE_DIGEST: activated.registry_digest,
        })
        logging.info("MEK ACTIVATE committed current_kid=%s", activated.current_key_id)

    def rewrap(self) -> None:
        secret = self._secret()
        annotations = self._rotation_annotations(secret)
        self._assert_installation(annotations)
        activated = self._required_keyring_from_secret(secret)
        if self.config.management_mode == "osmo":
            if (
                annotations.get(_REQUEST) == self.config.request_id
                and annotations.get(_PHASE) == "complete"
                and annotations.get(_COMPLETED) == self.config.request_id
            ):
                if (
                    activated.generation != annotations.get(_ACTIVATE_GENERATION)
                    or activated.registry_digest != annotations.get(_BUNDLE_DIGEST)
                    or activated.current_key_id != annotations.get(_CANDIDATE)
                ):
                    raise osmo_errors.OSMOError(
                        "Existing REWRAP completion does not match Secret data.")
                return
            if (
                annotations.get(_REQUEST) != self.config.request_id
                or annotations.get(_PHASE) != "activated"
            ):
                raise osmo_errors.OSMOError("REWRAP requires the matching ACTIVATE phase.")
            if (
                activated.generation != annotations.get(_ACTIVATE_GENERATION)
                or activated.registry_digest != annotations.get(_BUNDLE_DIGEST)
                or activated.current_key_id != annotations.get(_CANDIDATE)
            ):
                raise osmo_errors.OSMOError("ACTIVATE annotations do not match Secret data.")
        elif len(activated.fingerprints) < 2:
            raise osmo_errors.OSMOError(
                "External REWRAP requires an activated keyring that retains historical MEKs.")
        self.verify_rollout(activated)
        connector = connectors.PostgresConnector(self.config)
        try:
            connector.rewrap_mek_references(
                deadline_seconds=max(1, int(self.deadline - time.monotonic())),
                expected_generation=activated.generation,
                expected_current_kid=activated.current_key_id,
                expected_registry_digest=activated.registry_digest,
            )
        finally:
            connector.close()
        live = self._secret()
        if (
            live.metadata.uid != secret.metadata.uid
            or live.metadata.resource_version != secret.metadata.resource_version
            or self._required_keyring_from_secret(live).encoded != activated.encoded
        ):
            raise osmo_errors.OSMOError("MEK Secret changed during database rewrap.")
        self.verify_rollout(activated)
        if self.config.management_mode == "osmo":
            self._patch_secret(live, activated, {
                _PHASE: "complete",
                _COMPLETED: self.config.request_id,
            })
        logging.info(
            "MEK rotation complete request=%s; all historical MEKs remain mandatory",
            self.config.request_id)

    def run(self) -> None:
        self.acquire_lease()
        try:
            getattr(self, self.config.operation)()
        finally:
            self.release_lease()


def _run() -> None:
    lifecycle_config = MekLifecycleConfig.load()
    MekLifecycle(lifecycle_config).run()


def main() -> None:
    try:
        _run()
    except (osmo_errors.OSMOError, kubernetes_exceptions.ApiException, psycopg2.Error):
        # Never stringify Kubernetes/DB exceptions: admission responses can echo
        # the submitted Secret body and therefore MEK bytes.
        logging.error("MEK lifecycle operation failed; inspect redacted preceding logs.")
        raise SystemExit(1) from None
    except Exception:  # pylint: disable=broad-exception-caught
        logging.error("MEK lifecycle operation failed unexpectedly; sensitive details omitted.")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
