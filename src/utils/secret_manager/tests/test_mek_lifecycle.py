"""Unit tests for the Kubernetes-only MEK state machine."""

# SPDX-License-Identifier: Apache-2.0
# pylint: disable=protected-access

import base64
import copy
import json
from pathlib import Path
import time
import types
from typing import Literal
import unittest
from unittest import mock

from src.lib.utils import osmo_errors
from src.utils.secret_manager import mek_lifecycle as lifecycle_module
from src.utils.secret_manager.mek_lifecycle import (
    MekLifecycle,
    MekLifecycleConfig,
    _ACTIVATE_GENERATION,
    _BUNDLE_DIGEST,
    _CANDIDATE,
    _COMPLETED,
    _INSTALLATION,
    _PHASE,
    _PREDECESSOR_CURRENT,
    _PREPARE_GENERATION,
    _REQUEST,
    _add_candidate,
    _new_keyring,
    _parse_keyring,
    _serialize_keyring,
)


def _config(
    operation: Literal["bootstrap", "validate", "prepare", "activate", "rewrap"] = "prepare",
    mode: Literal["external", "osmo"] = "osmo",
    request_id: str = "rotate-1",
    pod_uid: str = "pod-1",
    consumer_deployments: list | None = None,
) -> MekLifecycleConfig:
    return MekLifecycleConfig.model_construct(
        operation=operation,
        namespace="osmo",
        secret_name="osmo-mek",
        secret_key="mek.yaml",
        installation_id="osmo/release",
        management_mode=mode,
        request_id=request_id,
        pod_uid=pod_uid,
        consumer_deployments=["api"] if consumer_deployments is None else consumer_deployments,
        active_deadline_seconds=900,
        postgres_host="postgres",
        postgres_port=5432,
        postgres_user="osmo",
        postgres_password="redacted",
        postgres_database_name="osmo",
    )


def _secret(keyring, annotations=None):
    return types.SimpleNamespace(
        metadata=types.SimpleNamespace(
            uid="secret-uid", resource_version="1", annotations=annotations or {}),
        data={"mek.yaml": base64.b64encode(keyring.encoded).decode()},
    )


def _lifecycle(
    operation: Literal["bootstrap", "validate", "prepare", "activate", "rewrap"] = "prepare",
    mode: Literal["external", "osmo"] = "osmo",
    request_id: str = "rotate-1",
    consumer_deployments: list | None = None,
) -> MekLifecycle:
    lifecycle = MekLifecycle.__new__(MekLifecycle)
    lifecycle.config = _config(
        operation, mode, request_id=request_id, consumer_deployments=consumer_deployments)
    lifecycle.deadline = time.monotonic() + 900
    lifecycle.holder = f"{request_id or operation}:{operation}:pod-1"
    lifecycle.lease_name = "release-mek-deadbeef"
    return lifecycle


def _owner(kind: str, name: str, uid: str):
    return types.SimpleNamespace(kind=kind, name=name, uid=uid, controller=True)


def _deployment():
    return types.SimpleNamespace(
        metadata=types.SimpleNamespace(name="api", uid="deployment-uid", generation=2),
        spec=types.SimpleNamespace(
            replicas=1, selector=types.SimpleNamespace(match_labels={"app": "api"})),
        status=types.SimpleNamespace(
            observed_generation=2, updated_replicas=1, ready_replicas=1,
            available_replicas=1),
    )


def _replica_set(name: str, uid: str, revision: int, owner_name: str = "api"):
    return types.SimpleNamespace(
        metadata=types.SimpleNamespace(
            name=name, uid=uid,
            annotations={"deployment.kubernetes.io/revision": str(revision)},
            owner_references=[_owner(
                "Deployment", owner_name,
                "deployment-uid" if owner_name == "api" else "other-uid")]),
    )


def _pod(owner_references, deletion_timestamp=None):
    return types.SimpleNamespace(
        metadata=types.SimpleNamespace(
            name="api-pod", uid="pod-uid", deletion_timestamp=deletion_timestamp,
            owner_references=owner_references),
        status=types.SimpleNamespace(
            phase="Running",
            conditions=[types.SimpleNamespace(type="Ready", status="True")]),
        spec=types.SimpleNamespace(containers=[types.SimpleNamespace(name="api")]),
    )


def _bootstrap_cohort():
    lifecycle = _lifecycle("bootstrap")
    lifecycle.apps = mock.Mock()
    lifecycle.core = mock.Mock()
    lifecycle.apps.read_namespaced_deployment.return_value = _deployment()
    current = _replica_set("api-current", "rs-current", 2)
    old = _replica_set("api-old", "rs-old", 1)
    lifecycle.apps.list_namespaced_replica_set.return_value = types.SimpleNamespace(
        items=[old, current])
    lifecycle.apps.read_namespaced_replica_set.return_value = old
    pod = _pod([_owner("ReplicaSet", "api-old", "rs-old")], "now")
    pod.status.phase = "Pending"
    pod.status.container_statuses = []
    pod.status.init_container_statuses = []
    gate = types.SimpleNamespace(
        name="bootstrap-credentials", image="osmo/service:previous",
        env_from=None,
        command=["/osmo/bootstrap-step"],
        args=["--timeout", "300s", "--", "osmo-bootstrap", "--config",
              "/bootstrap-config/config.json", "gate"],
        env=[types.SimpleNamespace(
            name="OSMO_BOOTSTRAP_FILES", value_from=None,
            value=json.dumps([{"secret": "osmo-mek", "key": "mek.yaml", "optional": False}]))])
    pod.spec.init_containers = [gate]
    old.spec = types.SimpleNamespace(template=types.SimpleNamespace(
        spec=types.SimpleNamespace(init_containers=[copy.deepcopy(gate)])))
    lifecycle.core.list_namespaced_pod.return_value = types.SimpleNamespace(items=[pod])
    return lifecycle, old, pod


class TestMekLifecycle(unittest.TestCase):
    """Validate the Kubernetes-only lifecycle state machine."""

    @mock.patch.dict(lifecycle_module.os.environ, {"OSMO_BOOTSTRAP_CONFIG": "/config.json"})
    @mock.patch("src.utils.secret_manager.mek_lifecycle.time.sleep")
    def test_bootstrap_accepts_stable_old_and_new_gated_cohorts(self, sleep):
        lifecycle, _, old_pod = _bootstrap_cohort()
        current_pod = _pod([_owner("ReplicaSet", "api-current", "rs-current")])
        current_pod.status.phase = "Pending"
        current_pod.status.container_statuses = []
        current_pod.metadata.uid = "current-pod"
        lifecycle.core.list_namespaced_pod.return_value = types.SimpleNamespace(
            items=[old_pod, current_pod])
        self.assertEqual(lifecycle._bootstrap_consumer_cohort(), ("current-pod", "pod-uid"))
        lifecycle.core.list_namespaced_pod.reset_mock()
        lifecycle._verify_bootstrap_quiescence()
        self.assertEqual(lifecycle.core.list_namespaced_pod.call_count, 2)
        lifecycle.apps.read_namespaced_replica_set.assert_called_with("api-old", "osmo")
        sleep.assert_called_once_with(2)

    @mock.patch.dict(lifecycle_module.os.environ, {"OSMO_BOOTSTRAP_CONFIG": "/config.json"})
    @mock.patch("src.utils.secret_manager.mek_lifecycle.time.sleep")
    def test_bootstrap_old_gated_cohort_remains_deadline_bounded(self, sleep):
        lifecycle, _, _ = _bootstrap_cohort()
        lifecycle.deadline = 0.5
        with mock.patch("src.utils.secret_manager.mek_lifecycle.time.monotonic",
                        side_effect=[0, 1]):
            with self.assertRaisesRegex(osmo_errors.OSMOError, "deadline"):
                lifecycle._verify_bootstrap_quiescence()
        self.assertEqual(lifecycle.core.list_namespaced_pod.call_count, 1)
        sleep.assert_called_once_with(2)

    @mock.patch.dict(lifecycle_module.os.environ, {}, clear=True)
    def test_standalone_bootstrap_rejects_old_cohort(self):
        lifecycle, _, _ = _bootstrap_cohort()
        with self.assertRaisesRegex(osmo_errors.OSMOError, "coordinated"):
            lifecycle._bootstrap_consumer_cohort()

    @mock.patch.dict(lifecycle_module.os.environ, {"OSMO_BOOTSTRAP_CONFIG": "/config.json"})
    def test_old_cohort_requires_exact_blocked_mek_gate(self):
        for invalid in ("missing-gate", "wrong-command", "wrong-args", "wrong-image",
                        "malformed-json", "object-json", "nonmapping-json", "missing-env",
                        "indirect-env", "duplicate-env", "wrong-secret", "wrong-key",
                        "optional", "string-optional", "missing-mapping", "before-command",
                        "indirect-environment",
                        "completed", "previously-completed"):
            with self.subTest(invalid=invalid):
                lifecycle, _, pod = _bootstrap_cohort()
                gate = pod.spec.init_containers[0]
                mapping = {"secret": "osmo-mek", "key": "mek.yaml", "optional": False}
                if invalid == "missing-gate":
                    pod.spec.init_containers = []
                elif invalid == "wrong-command":
                    gate.command = ["/bin/true"]
                elif invalid == "wrong-args":
                    gate.args[-1] = "ready"
                elif invalid == "wrong-image":
                    gate.image = "untrusted/image"
                elif invalid in ("malformed-json", "object-json", "nonmapping-json"):
                    gate.env[0].value = {
                        "malformed-json": "{", "object-json": "{}", "nonmapping-json": "[1]"
                    }[invalid]
                elif invalid == "missing-env":
                    gate.env = []
                elif invalid == "indirect-env":
                    gate.env[0].value_from = object()
                elif invalid == "duplicate-env":
                    gate.env.append(copy.deepcopy(gate.env[0]))
                elif invalid == "before-command":
                    gate.env.append(types.SimpleNamespace(name="OSMO_BOOTSTRAP_BEFORE"))
                elif invalid == "indirect-environment":
                    gate.env_from = [object()]
                elif invalid in ("completed", "previously-completed"):
                    completed = types.SimpleNamespace(terminated=types.SimpleNamespace(exit_code=0))
                    pending = types.SimpleNamespace(terminated=None)
                    pod.status.init_container_statuses = [types.SimpleNamespace(
                        name="bootstrap-credentials",
                        state=completed if invalid == "completed" else pending,
                        last_state=completed if invalid == "previously-completed" else pending)]
                else:
                    if invalid == "wrong-secret":
                        mapping["secret"] = "other-mek"
                    elif invalid == "wrong-key":
                        mapping["key"] = "other.yaml"
                    elif invalid == "optional":
                        mapping["optional"] = True
                    elif invalid == "string-optional":
                        mapping["optional"] = "false"
                    gate.env[0].value = json.dumps(
                        [] if invalid == "missing-mapping" else [mapping])
                with self.assertRaises(osmo_errors.OSMOError):
                    lifecycle._bootstrap_consumer_cohort()

    @mock.patch.dict(lifecycle_module.os.environ, {"OSMO_BOOTSTRAP_CONFIG": "/config.json"})
    def test_old_gate_mapping_defaults_to_required(self):
        lifecycle, _, pod = _bootstrap_cohort()
        pod.spec.init_containers[0].env[0].value = json.dumps([
            {"secret": "osmo-mek", "key": "mek.yaml"}])
        self.assertEqual(lifecycle._bootstrap_consumer_cohort(), ("pod-uid",))

    @mock.patch("src.utils.secret_manager.mek_lifecycle.time.sleep")
    def test_bootstrap_old_cohort_never_retries_unsafe_pods(self, sleep):
        for unsafe in ("foreign-deployment", "stale-deployment", "stale-replica-set",
                       "running", "terminated", "restarted", "container-id"):
            with self.subTest(unsafe=unsafe):
                lifecycle, old, pod = _bootstrap_cohort()
                if unsafe == "foreign-deployment":
                    old.metadata.owner_references[0].name = "other"
                elif unsafe == "stale-deployment":
                    old.metadata.owner_references[0].uid = "previous-deployment"
                elif unsafe == "stale-replica-set":
                    pod.metadata.owner_references[0].uid = "previous-replica-set"
                else:
                    pod.status.container_statuses = [types.SimpleNamespace(
                        state=types.SimpleNamespace(
                            running=object() if unsafe == "running" else None,
                            terminated=object() if unsafe == "terminated" else None),
                        restart_count=1 if unsafe == "restarted" else 0,
                        container_id="container" if unsafe == "container-id" else None)]
                with self.assertRaises(osmo_errors.OSMOError):
                    lifecycle._verify_bootstrap_quiescence()
                sleep.assert_not_called()

    def test_bootstrap_advisory_lock_is_nonblocking_and_deadline_bounded(self):
        lifecycle = _lifecycle('bootstrap')
        lifecycle.deadline = time.monotonic() + 0.02
        connection = mock.MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (False,)
        with self.assertRaisesRegex(osmo_errors.OSMOError, 'deadline'):
            lifecycle._acquire_database_lock(connection)
        cursor.execute.assert_called_with(
            'SELECT pg_try_advisory_lock(%s);', (0x4F534D4F4D454B,))

    def test_bootstrap_advisory_lock_retries_until_acquired(self):
        lifecycle = _lifecycle('bootstrap')
        connection = mock.MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.side_effect = [(False,), (True,)]
        with mock.patch.object(lifecycle_module.time, 'sleep'):
            lifecycle._acquire_database_lock(connection)
        self.assertEqual(cursor.execute.call_count, 2)

    def test_secret_json_patch_uses_generated_client_compatible_signature(self):
        lifecycle = _lifecycle()
        lifecycle._assert_lease = mock.Mock()  # type: ignore[method-assign]
        calls = []

        class CompatibleCore:
            @staticmethod
            def patch_namespaced_secret(name, namespace, body):
                calls.append((name, namespace, body))
                return "patched"

        lifecycle.core = CompatibleCore()
        keyring = _new_keyring("initial")
        result = lifecycle._patch_secret(
            _secret(keyring), keyring, {_PHASE: "prepared"})

        self.assertEqual(result, "patched")
        self.assertEqual(calls[0][0:2], ("osmo-mek", "osmo"))
        self.assertEqual(calls[0][2][0]["op"], "test")

    def test_prepare_adds_exactly_one_key_and_keeps_current(self):
        original = _new_keyring("initial")
        prepared = _add_candidate(original, "rotate-1")
        self.assertEqual(prepared.current_key_id, original.current_key_id)
        self.assertEqual(set(prepared.fingerprints) - set(original.fingerprints), {"mek-rotate-1"})
        self.assertTrue(set(original.fingerprints).issubset(prepared.fingerprints))

    def test_bootstrap_rejects_an_unowned_existing_secret(self):
        lifecycle = _lifecycle("bootstrap")
        lifecycle._optional_secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(_new_keyring("initial")))
        lifecycle._authenticate_existing_database = mock.Mock()  # type: ignore[method-assign]
        with self.assertRaisesRegex(osmo_errors.OSMOError, "exact bootstrap retry"):
            lifecycle.bootstrap()
        lifecycle._authenticate_existing_database.assert_not_called()

    def test_bootstrap_retry_authenticates_exact_owned_secret_without_mutation(self):
        lifecycle = _lifecycle("bootstrap")
        keyring = _new_keyring("initial")
        lifecycle._optional_secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(keyring, {
                _INSTALLATION: "osmo/release",
                _PHASE: "idle",
                _BUNDLE_DIGEST: keyring.registry_digest,
            }))
        lifecycle._authenticate_existing_database = mock.Mock()  # type: ignore[method-assign]
        lifecycle._create_secret = mock.Mock()  # type: ignore[method-assign]
        lifecycle.bootstrap()
        lifecycle._authenticate_existing_database.assert_called_once_with(keyring)
        lifecycle._create_secret.assert_not_called()

    def test_prepare_persists_strict_adjacent_annotations(self):
        lifecycle = _lifecycle()
        original = _new_keyring("initial")
        secret = _secret(original, {_INSTALLATION: "osmo/release", _PHASE: "idle"})
        lifecycle._secret = mock.Mock(return_value=secret)  # type: ignore[method-assign]
        lifecycle._patch_secret = mock.Mock()  # type: ignore[method-assign]
        lifecycle.prepare()
        patched = lifecycle._patch_secret.call_args.args[1]
        annotations = lifecycle._patch_secret.call_args.args[2]
        self.assertEqual(patched.current_key_id, original.current_key_id)
        self.assertEqual(annotations[_REQUEST], "rotate-1")
        self.assertEqual(annotations[_PHASE], "prepared")
        self.assertEqual(annotations[_PREDECESSOR_CURRENT], original.current_key_id)
        self.assertEqual(annotations[_PREPARE_GENERATION], patched.generation)
        self.assertEqual(annotations[_BUNDLE_DIGEST], patched.registry_digest)

    def test_prepare_resume_reuses_candidate(self):
        lifecycle = _lifecycle()
        prepared = _add_candidate(_new_keyring("initial"), "rotate-1")
        secret = _secret(prepared, {
            _INSTALLATION: "osmo/release",
            _REQUEST: "rotate-1",
            _PHASE: "prepared",
            _PREPARE_GENERATION: prepared.generation,
            _BUNDLE_DIGEST: prepared.registry_digest,
        })
        lifecycle._secret = mock.Mock(return_value=secret)  # type: ignore[method-assign]
        lifecycle._patch_secret = mock.Mock()  # type: ignore[method-assign]
        lifecycle.prepare()
        lifecycle._patch_secret.assert_not_called()

    def test_activate_requires_verified_prepare_cohort(self):
        lifecycle = _lifecycle("activate")
        prepared = _add_candidate(_new_keyring("initial"), "rotate-1")
        candidate = "mek-rotate-1"
        secret = _secret(prepared, {
            _INSTALLATION: "osmo/release",
            _REQUEST: "rotate-1",
            _PHASE: "prepared",
            _PREDECESSOR_CURRENT: prepared.current_key_id,
            _PREPARE_GENERATION: prepared.generation,
            _BUNDLE_DIGEST: prepared.registry_digest,
            _CANDIDATE: candidate,
        })
        lifecycle._secret = mock.Mock(return_value=secret)  # type: ignore[method-assign]
        lifecycle.verify_rollout = mock.Mock()  # type: ignore[method-assign]
        lifecycle._patch_secret = mock.Mock()  # type: ignore[method-assign]
        lifecycle.activate()
        lifecycle.verify_rollout.assert_called_once_with(prepared)
        activated = lifecycle._patch_secret.call_args.args[1]
        annotations = lifecycle._patch_secret.call_args.args[2]
        self.assertEqual(activated.current_key_id, candidate)
        self.assertEqual(annotations[_PHASE], "activated")
        self.assertEqual(annotations[_ACTIVATE_GENERATION], activated.generation)

    def test_activate_retry_accepts_already_committed_matching_state(self):
        lifecycle = _lifecycle("activate")
        prepared = _add_candidate(_new_keyring("initial"), "rotate-1")
        document = dict(prepared.document)
        document["currentMek"] = "mek-rotate-1"
        activated = _parse_keyring(_serialize_keyring(document))
        secret = _secret(activated, {
            _INSTALLATION: "osmo/release",
            _REQUEST: "rotate-1",
            _PHASE: "activated",
            _ACTIVATE_GENERATION: activated.generation,
            _BUNDLE_DIGEST: activated.registry_digest,
            _CANDIDATE: activated.current_key_id,
        })
        lifecycle._secret = mock.Mock(return_value=secret)  # type: ignore[method-assign]
        lifecycle.verify_rollout = mock.Mock()  # type: ignore[method-assign]
        lifecycle._patch_secret = mock.Mock()  # type: ignore[method-assign]
        lifecycle.activate()
        lifecycle.verify_rollout.assert_not_called()
        lifecycle._patch_secret.assert_not_called()

    def test_external_mode_cannot_mutate_prepare_or_activate(self):
        for operation in ("prepare", "activate"):
            with self.subTest(operation=operation):
                lifecycle = _lifecycle(operation, "external")
                with self.assertRaisesRegex(osmo_errors.OSMOError, "managed mode"):
                    getattr(lifecycle, operation)()

    @mock.patch("src.utils.secret_manager.mek_lifecycle.connectors.PostgresConnector")
    def test_managed_rewrap_retry_accepts_matching_completion(self, connector_class):
        lifecycle = _lifecycle("rewrap")
        prepared = _add_candidate(_new_keyring("initial"), "rotate-1")
        document = dict(prepared.document)
        document["currentMek"] = "mek-rotate-1"
        activated = _parse_keyring(_serialize_keyring(document))
        secret = _secret(activated, {
            _INSTALLATION: "osmo/release",
            _REQUEST: "rotate-1",
            _PHASE: "complete",
            _COMPLETED: "rotate-1",
            _ACTIVATE_GENERATION: activated.generation,
            _BUNDLE_DIGEST: activated.registry_digest,
            _CANDIDATE: activated.current_key_id,
        })
        lifecycle._secret = mock.Mock(return_value=secret)  # type: ignore[method-assign]
        lifecycle.verify_rollout = mock.Mock()  # type: ignore[method-assign]
        lifecycle.rewrap()
        connector_class.assert_not_called()
        lifecycle.verify_rollout.assert_not_called()

    @mock.patch("src.utils.secret_manager.mek_lifecycle.connectors.PostgresConnector")
    def test_external_rewrap_uses_live_activated_bundle_without_managed_annotations(
            self, connector_class):
        lifecycle = _lifecycle("rewrap", "external")
        activated = _add_candidate(_new_keyring("initial"), "rotate-1")
        secret = _secret(activated)
        lifecycle._secret = mock.Mock(side_effect=[secret, secret])  # type: ignore[method-assign]
        lifecycle.verify_rollout = mock.Mock()  # type: ignore[method-assign]
        lifecycle._patch_secret = mock.Mock()  # type: ignore[method-assign]
        lifecycle.rewrap()
        self.assertEqual(lifecycle.verify_rollout.call_count, 2)
        connector_class.return_value.rewrap_mek_references.assert_called_once_with(
            deadline_seconds=mock.ANY,
            expected_generation=activated.generation,
            expected_current_kid=activated.current_key_id,
            expected_registry_digest=activated.registry_digest,
        )
        lifecycle._patch_secret.assert_not_called()

    def test_descriptor_log_is_exact_machine_readable_json(self):
        descriptor = {
            "currentKid": "key2",
            "loadedKids": ["key1", "key2"],
            "generation": "abc",
            "digest": "def",
        }
        log = "prefix\nINFO OSMO_MEK_DESCRIPTOR " + json.dumps(descriptor)
        self.assertEqual(MekLifecycle._descriptor_from_log(log), descriptor)
        structured_log = json.dumps({
            "timestamp": "2026-08-21T00:00:00Z",
            "level": "INFO",
            "message": "OSMO_MEK_DESCRIPTOR " + json.dumps(descriptor),
        })
        self.assertEqual(MekLifecycle._descriptor_from_log(structured_log), descriptor)
        with self.assertRaisesRegex(osmo_errors.OSMOError, "descriptor"):
            MekLifecycle._descriptor_from_log("normal startup")

    def test_lease_is_never_stolen_from_another_holder(self):
        lifecycle = _lifecycle()
        lifecycle.holder = "rotate-1:prepare:pod-1"
        lifecycle.lease_name = "release-mek-deadbeef"
        lifecycle.coordination = mock.Mock()
        lifecycle.coordination.read_namespaced_lease.return_value = types.SimpleNamespace(
            spec=types.SimpleNamespace(holder_identity="old:prepare:pod-old"))
        with self.assertRaisesRegex(osmo_errors.OSMOError, "delete the old Job Pod"):
            lifecycle.acquire_lease()
        lifecycle.coordination.patch_namespaced_lease.assert_not_called()

    def test_missing_lease_is_created_outside_helm_desired_state(self):
        lifecycle = _lifecycle()
        lifecycle.holder = "rotate-1:prepare:pod-1"
        lifecycle.lease_name = "release-mek-deadbeef"
        lifecycle.coordination = mock.Mock()
        missing = lifecycle_module.kubernetes_exceptions.ApiException(status=404)
        created = types.SimpleNamespace(
            metadata=types.SimpleNamespace(resource_version="1"),
            spec=types.SimpleNamespace(holder_identity=""))
        lifecycle.coordination.read_namespaced_lease.side_effect = missing
        lifecycle.coordination.create_namespaced_lease.return_value = created
        lifecycle.acquire_lease()
        lifecycle.coordination.create_namespaced_lease.assert_called_once()
        lifecycle.coordination.patch_namespaced_lease.assert_called_once()

    def test_every_unexpected_selected_pod_blocks_attestation(self):
        lifecycle = _lifecycle("activate")
        lifecycle.apps = mock.Mock()
        lifecycle.core = mock.Mock()
        lifecycle.apps.read_namespaced_deployment.return_value = _deployment()
        current = _replica_set("api-current", "rs-current", 2)
        old = _replica_set("api-old", "rs-old", 1)
        expected = _new_keyring("initial")
        cases = {
            "standalone": ([current], _pod([])),
            "wrong-owner": ([current], _pod([_owner("ReplicaSet", "other", "other-rs")])),
            "stale-rs-uid": (
                [current], _pod([_owner("ReplicaSet", "api-current", "stale-uid")])),
            "old-replica-set": (
                [old, current], _pod([_owner("ReplicaSet", "api-old", "rs-old")])),
            "terminating": (
                [current], _pod(
                    [_owner("ReplicaSet", "api-current", "rs-current")], "now")),
        }
        for name, (replica_sets, pod) in cases.items():
            with self.subTest(name=name):
                lifecycle.apps.list_namespaced_replica_set.return_value = \
                    types.SimpleNamespace(items=replica_sets)
                lifecycle.core.list_namespaced_pod.return_value = \
                    types.SimpleNamespace(items=[pod])
                with self.assertRaises(osmo_errors.OSMOError):
                    lifecycle._observe_pods_once(expected)

    @mock.patch("src.utils.secret_manager.mek_lifecycle._run")
    def test_unexpected_failure_boundary_never_logs_exception_text(self, run):
        sentinel = "MEK-SENTINEL-DO-NOT-LOG"
        run.side_effect = RuntimeError(sentinel)
        with self.assertLogs(level="ERROR") as captured:
            with self.assertRaises(SystemExit):
                lifecycle_module.main()
        self.assertNotIn(sentinel, "\n".join(captured.output))


def _descriptor_log(keyring) -> str:
    """Render the machine-readable startup line a compliant consumer Pod emits."""
    return "INFO " + lifecycle_module._DESCRIPTOR_PREFIX + json.dumps({
        "currentKid": keyring.current_key_id,
        "loadedKids": sorted(keyring.fingerprints),
        "generation": keyring.generation,
        "digest": keyring.registry_digest,
    })


def _lease(holder: str, resource_version: str = "1"):
    return types.SimpleNamespace(
        metadata=types.SimpleNamespace(resource_version=resource_version),
        spec=types.SimpleNamespace(holder_identity=holder, renew_time=None))


def _api_error(status: int):
    return lifecycle_module.kubernetes_exceptions.ApiException(status=status)


def _container_status(running=None, terminated=None, restart_count=0, container_id=""):
    return types.SimpleNamespace(
        state=types.SimpleNamespace(running=running, terminated=terminated),
        restart_count=restart_count,
        container_id=container_id)


def _bootstrap_pod(owner_references, statuses=None, phase="Pending"):
    return types.SimpleNamespace(
        metadata=types.SimpleNamespace(
            name="api-pod", uid="pod-uid", deletion_timestamp=None,
            owner_references=owner_references),
        status=types.SimpleNamespace(phase=phase, container_statuses=statuses or []),
        spec=types.SimpleNamespace(containers=[types.SimpleNamespace(name="api")]),
    )


def _replica_set_with_deployment_owner(name: str, uid: str, owner_name: str, owner_uid: str):
    return types.SimpleNamespace(
        metadata=types.SimpleNamespace(
            name=name, uid=uid,
            annotations={"deployment.kubernetes.io/revision": "2"},
            owner_references=[_owner("Deployment", owner_name, owner_uid)]),
    )


class FakeCursor:
    """Cursor stub returning a scripted fetchone result per execute call."""

    def __init__(self, results):
        self.results = list(results)
        self.statements = []
        self._current = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, statement, params=None):
        del params
        self.statements.append(statement)
        self._current = self.results.pop(0) if self.results else None

    def fetchone(self):
        return self._current


class FakeDatabaseConnection:
    """Connection stub handing out one shared scripted cursor."""

    def __init__(self, cursor):
        self.fake_cursor = cursor
        self.close_count = 0

    def cursor(self):
        return self.fake_cursor

    def close(self):
        self.close_count += 1


class TestMekKeyringPrimitives(unittest.TestCase):
    """Validate the pure keyring identity and naming helpers."""

    def test_generation_ignores_the_order_of_key_identifiers(self):
        first = lifecycle_module._generation("mek-a", ["mek-a", "mek-b"])
        second = lifecycle_module._generation("mek-a", ["mek-b", "mek-a"])
        self.assertEqual(first, second)
        self.assertEqual(len(first), 16)

    def test_generation_changes_when_the_current_key_changes(self):
        self.assertNotEqual(
            lifecycle_module._generation("mek-a", ["mek-a", "mek-b"]),
            lifecycle_module._generation("mek-b", ["mek-a", "mek-b"]))

    def test_registry_digest_ignores_fingerprint_insertion_order(self):
        self.assertEqual(
            lifecycle_module._registry_digest({"a": "1", "b": "2"}),
            lifecycle_module._registry_digest({"b": "2", "a": "1"}))

    def test_parse_keyring_rejects_empty_data(self):
        with self.assertRaisesRegex(osmo_errors.OSMOError, "empty or exceeds"):
            _parse_keyring(b"")

    def test_parse_keyring_rejects_data_over_the_size_limit(self):
        with self.assertRaisesRegex(osmo_errors.OSMOError, "empty or exceeds"):
            _parse_keyring(b"a" * (lifecycle_module.MAX_KEYRING_BYTES + 1))

    def test_parse_keyring_propagates_keyring_validation_errors(self):
        document = dict(_new_keyring("initial").document)
        document["unexpected"] = "field"
        with self.assertRaisesRegex(osmo_errors.OSMOError, "currentMek and meks"):
            _parse_keyring(_serialize_keyring(document))

    def test_parse_keyring_hides_yaml_failures_behind_a_generic_error(self):
        encoded = _new_keyring("initial").encoded
        with mock.patch.object(lifecycle_module.yaml, "safe_load",
                               side_effect=lifecycle_module.yaml.YAMLError("boom")):
            with self.assertRaisesRegex(osmo_errors.OSMOError, "keyring is invalid"):
                _parse_keyring(encoded)

    def test_serialize_keyring_rejects_a_document_over_the_size_limit(self):
        oversized = {"currentMek": "a" * (lifecycle_module.MAX_KEYRING_BYTES + 1), "meks": {}}
        with self.assertRaisesRegex(osmo_errors.OSMOError, "exceed its size limit"):
            _serialize_keyring(oversized)

    def test_add_candidate_rejects_a_keyring_at_the_key_limit(self):
        full = lifecycle_module.ParsedKeyring(
            document={"currentMek": "mek-a", "meks": {}},
            encoded=b"",
            generation="generation",
            current_key_id="mek-a",
            fingerprints={f"mek-{index}": "fingerprint"
                          for index in range(lifecycle_module.MAX_MEK_COUNT)},
            registry_digest="digest")
        with self.assertRaisesRegex(osmo_errors.OSMOError, "keyring limit reached"):
            _add_candidate(full, "rotate-2")

    def test_add_candidate_rejects_a_request_naming_a_loaded_key(self):
        with self.assertRaisesRegex(osmo_errors.OSMOError, "already names a loaded MEK"):
            _add_candidate(_new_keyring("rotate-1"), "rotate-1")

    def test_lease_name_is_stable_and_distinguishes_secrets(self):
        name = lifecycle_module._lease_name("osmo/my-release", "osmo-mek")
        self.assertTrue(name.startswith("my-release-mek-"))
        self.assertEqual(name, lifecycle_module._lease_name("osmo/my-release", "osmo-mek"))
        self.assertNotEqual(name, lifecycle_module._lease_name("osmo/my-release", "other-mek"))

    def test_lease_name_falls_back_when_the_release_has_no_usable_characters(self):
        self.assertTrue(
            lifecycle_module._lease_name("osmo/___", "osmo-mek").startswith("osmo-mek-"))


class TestMekLifecycleConstruction(unittest.TestCase):
    """Validate constructor fencing identity and the deadline guard."""

    def test_construction_requires_a_pod_uid(self):
        with self.assertRaisesRegex(osmo_errors.OSMOError, "Pod UID is required"):
            MekLifecycle(_config("prepare", pod_uid=""))

    def test_construction_derives_the_holder_and_lease_from_config(self):
        with mock.patch.object(lifecycle_module.kubernetes_config, "load_incluster_config"), \
                mock.patch.object(lifecycle_module.client, "CoreV1Api"), \
                mock.patch.object(lifecycle_module.client, "AppsV1Api"), \
                mock.patch.object(lifecycle_module.client, "CoordinationV1Api"):
            lifecycle = MekLifecycle(_config("prepare"))

        self.assertEqual(lifecycle.holder, "rotate-1:prepare:pod-1")
        self.assertEqual(
            lifecycle.lease_name, lifecycle_module._lease_name("osmo/release", "osmo-mek"))

    def test_check_deadline_rejects_an_expired_operation(self):
        lifecycle = _lifecycle()
        lifecycle.deadline = time.monotonic() - 1

        with self.assertRaisesRegex(osmo_errors.OSMOError, "exceeded its deadline"):
            lifecycle._check_deadline()


class TestMekLease(unittest.TestCase):
    """Validate the fencing Lease acquire, renew, and release paths."""

    def test_acquire_lease_propagates_unexpected_read_errors(self):
        lifecycle = _lifecycle()
        lifecycle.coordination = mock.Mock()
        lifecycle.coordination.read_namespaced_lease.side_effect = _api_error(500)

        with self.assertRaises(lifecycle_module.kubernetes_exceptions.ApiException):
            lifecycle.acquire_lease()

        lifecycle.coordination.create_namespaced_lease.assert_not_called()

    def test_acquire_lease_rereads_a_lease_created_concurrently(self):
        lifecycle = _lifecycle()
        lifecycle.coordination = mock.Mock()
        lifecycle.coordination.read_namespaced_lease.side_effect = [
            _api_error(404), _lease("")]
        lifecycle.coordination.create_namespaced_lease.side_effect = _api_error(409)

        lifecycle.acquire_lease()

        self.assertEqual(lifecycle.coordination.read_namespaced_lease.call_count, 2)
        lifecycle.coordination.patch_namespaced_lease.assert_called_once()

    def test_acquire_lease_propagates_unexpected_create_errors(self):
        lifecycle = _lifecycle()
        lifecycle.coordination = mock.Mock()
        lifecycle.coordination.read_namespaced_lease.side_effect = [_api_error(404)]
        lifecycle.coordination.create_namespaced_lease.side_effect = _api_error(500)

        with self.assertRaises(lifecycle_module.kubernetes_exceptions.ApiException):
            lifecycle.acquire_lease()

        lifecycle.coordination.patch_namespaced_lease.assert_not_called()

    def test_assert_lease_rejects_a_lease_taken_over_by_another_holder(self):
        lifecycle = _lifecycle()
        lifecycle.coordination = mock.Mock()
        lifecycle.coordination.read_namespaced_lease.return_value = _lease("someone-else")

        with self.assertRaisesRegex(osmo_errors.OSMOError, "Lease ownership changed"):
            lifecycle._assert_lease()

        lifecycle.coordination.patch_namespaced_lease.assert_not_called()

    def test_assert_lease_renews_a_lease_it_still_holds(self):
        lifecycle = _lifecycle()
        lifecycle.coordination = mock.Mock()
        lifecycle.coordination.read_namespaced_lease.return_value = _lease(lifecycle.holder)

        lifecycle._assert_lease()

        body = lifecycle.coordination.patch_namespaced_lease.call_args.args[2]
        self.assertEqual(body["spec"]["holderIdentity"], lifecycle.holder)
        self.assertIsInstance(body["spec"]["renewTime"], str)

    def test_release_lease_leaves_another_holders_lease_untouched(self):
        lifecycle = _lifecycle()
        lifecycle.coordination = mock.Mock()
        lifecycle.coordination.read_namespaced_lease.return_value = _lease("someone-else")

        lifecycle.release_lease()

        lifecycle.coordination.patch_namespaced_lease.assert_not_called()

    def test_release_lease_clears_its_own_holder(self):
        lifecycle = _lifecycle()
        lifecycle.coordination = mock.Mock()
        lifecycle.coordination.read_namespaced_lease.return_value = _lease(lifecycle.holder)

        lifecycle.release_lease()

        body = lifecycle.coordination.patch_namespaced_lease.call_args.args[2]
        self.assertIsNone(body["spec"]["holderIdentity"])
        self.assertIsNone(body["spec"]["renewTime"])


class TestMekSecretAccess(unittest.TestCase):
    """Validate Secret read, decode, and create behavior."""

    def test_secret_reads_the_configured_name_and_namespace(self):
        lifecycle = _lifecycle()
        lifecycle.core = mock.Mock()
        lifecycle.core.read_namespaced_secret.return_value = "secret"

        self.assertEqual(lifecycle._secret(), "secret")
        lifecycle.core.read_namespaced_secret.assert_called_once_with("osmo-mek", "osmo")

    def test_optional_secret_returns_none_when_the_secret_is_absent(self):
        lifecycle = _lifecycle()
        lifecycle.core = mock.Mock()
        lifecycle.core.read_namespaced_secret.side_effect = _api_error(404)

        self.assertIsNone(lifecycle._optional_secret())

    def test_optional_secret_propagates_other_api_errors(self):
        lifecycle = _lifecycle()
        lifecycle.core = mock.Mock()
        lifecycle.core.read_namespaced_secret.side_effect = _api_error(500)

        with self.assertRaises(lifecycle_module.kubernetes_exceptions.ApiException):
            lifecycle._optional_secret()

    def test_keyring_from_secret_rejects_an_empty_data_key(self):
        lifecycle = _lifecycle()
        secret = types.SimpleNamespace(data={})

        with self.assertRaisesRegex(osmo_errors.OSMOError, "data key is empty"):
            lifecycle._keyring_from_secret(secret)

    def test_keyring_from_secret_returns_none_when_the_keyring_is_optional(self):
        lifecycle = _lifecycle()
        secret = types.SimpleNamespace(data=None)

        self.assertIsNone(lifecycle._keyring_from_secret(secret, required=False))

    def test_keyring_from_secret_rejects_data_that_is_not_base64(self):
        lifecycle = _lifecycle()
        secret = types.SimpleNamespace(data={"mek.yaml": "not base64!!"})

        with self.assertRaisesRegex(osmo_errors.OSMOError, "Secret data is invalid"):
            lifecycle._keyring_from_secret(secret)

    def test_required_keyring_fails_closed_when_parsing_yields_nothing(self):
        lifecycle = _lifecycle()
        lifecycle._keyring_from_secret = mock.Mock(  # type: ignore[method-assign]
            return_value=None)

        with self.assertRaisesRegex(osmo_errors.OSMOError, "data key is empty"):
            lifecycle._required_keyring_from_secret(types.SimpleNamespace(data={}))

    def test_create_secret_writes_a_fully_initialized_idle_secret(self):
        lifecycle = _lifecycle("bootstrap")
        lifecycle._assert_lease = mock.Mock()  # type: ignore[method-assign]
        lifecycle.core = mock.Mock()
        keyring = _new_keyring("initial")

        lifecycle._create_secret(keyring)

        namespace, body = lifecycle.core.create_namespaced_secret.call_args.args
        self.assertEqual(namespace, "osmo")
        self.assertEqual(body["metadata"]["annotations"][_PHASE], "idle")
        self.assertEqual(body["metadata"]["annotations"][_INSTALLATION], "osmo/release")
        self.assertEqual(
            body["metadata"]["annotations"][_BUNDLE_DIGEST], keyring.registry_digest)
        self.assertEqual(
            body["data"]["mek.yaml"], base64.b64encode(keyring.encoded).decode("ascii"))

    def test_assert_installation_rejects_a_secret_from_another_release(self):
        lifecycle = _lifecycle()

        with self.assertRaisesRegex(osmo_errors.OSMOError, "another Helm release"):
            lifecycle._assert_installation({_INSTALLATION: "osmo/other"})

    def test_assert_installation_accepts_an_unlabelled_secret(self):
        lifecycle = _lifecycle()

        try:
            lifecycle._assert_installation({})
        except osmo_errors.OSMOError as error:
            self.fail(f"unlabelled secret was rejected: {error}")


class TestMekReplicaSetSelection(unittest.TestCase):
    """Validate exact current-ReplicaSet selection for attestation."""

    def test_replica_sets_owned_by_another_deployment_are_ignored(self):
        lifecycle = _lifecycle("activate")
        lifecycle.apps = mock.Mock()
        lifecycle.apps.list_namespaced_replica_set.return_value = types.SimpleNamespace(
            items=[_replica_set("other-current", "rs-other", 2, owner_name="other")])

        self.assertEqual(lifecycle._current_replica_sets(_deployment(), "app=api"), {})

    def test_replica_sets_without_a_revision_annotation_are_rejected(self):
        lifecycle = _lifecycle("activate")
        lifecycle.apps = mock.Mock()
        unversioned = types.SimpleNamespace(
            metadata=types.SimpleNamespace(
                name="api-current", uid="rs-current", annotations={},
                owner_references=[_owner("Deployment", "api", "deployment-uid")]))
        lifecycle.apps.list_namespaced_replica_set.return_value = types.SimpleNamespace(
            items=[unversioned])

        with self.assertRaisesRegex(osmo_errors.OSMOError, "has no revision"):
            lifecycle._current_replica_sets(_deployment(), "app=api")

    def test_only_the_highest_revision_replica_set_is_selected(self):
        lifecycle = _lifecycle("activate")
        lifecycle.apps = mock.Mock()
        lifecycle.apps.list_namespaced_replica_set.return_value = types.SimpleNamespace(
            items=[_replica_set("api-old", "rs-old", 1),
                   _replica_set("api-current", "rs-current", 2)])

        selected = lifecycle._current_replica_sets(_deployment(), "app=api")

        self.assertEqual(list(selected), ["api-current"])


class TestMekPodAttestation(unittest.TestCase):
    """Validate consumer Pod attestation against an expected keyring."""

    def _lifecycle_with_pod(self, pod, replica_sets=None, log=None, deployment=None):
        lifecycle = _lifecycle("activate")
        lifecycle.apps = mock.Mock()
        lifecycle.core = mock.Mock()
        lifecycle.apps.read_namespaced_deployment.return_value = deployment or _deployment()
        lifecycle.apps.list_namespaced_replica_set.return_value = types.SimpleNamespace(
            items=replica_sets if replica_sets is not None
            else [_replica_set("api-current", "rs-current", 2)])
        lifecycle.core.list_namespaced_pod.return_value = types.SimpleNamespace(items=[pod])
        lifecycle.core.read_namespaced_pod_log.return_value = log or ""
        return lifecycle

    def test_attestation_requires_configured_consumer_deployments(self):
        lifecycle = _lifecycle("activate", consumer_deployments=[])

        with self.assertRaisesRegex(osmo_errors.OSMOError, "No MEK consumer Deployments"):
            lifecycle._observe_pods_once(_new_keyring("initial"))

    def test_attestation_returns_the_owned_pod_cohort_on_an_exact_match(self):
        expected = _new_keyring("initial")
        lifecycle = self._lifecycle_with_pod(
            _pod([_owner("ReplicaSet", "api-current", "rs-current")]),
            log=_descriptor_log(expected))

        self.assertEqual(lifecycle._observe_pods_once(expected), ("pod-uid",))

    def test_attestation_rejects_an_incomplete_rollout(self):
        deployment = _deployment()
        deployment.status.ready_replicas = 0
        lifecycle = self._lifecycle_with_pod(
            _pod([_owner("ReplicaSet", "api-current", "rs-current")]), deployment=deployment)

        with self.assertRaisesRegex(osmo_errors.OSMOError, "rollout is incomplete"):
            lifecycle._observe_pods_once(_new_keyring("initial"))

    def test_attestation_rejects_a_deployment_without_a_current_replica_set(self):
        lifecycle = self._lifecycle_with_pod(
            _pod([_owner("ReplicaSet", "api-current", "rs-current")]), replica_sets=[])

        with self.assertRaisesRegex(osmo_errors.OSMOError, "no current ReplicaSet"):
            lifecycle._observe_pods_once(_new_keyring("initial"))

    def test_attestation_ignores_terminal_pods_but_requires_the_full_cohort(self):
        pod = _pod([_owner("ReplicaSet", "api-current", "rs-current")])
        pod.status.phase = "Succeeded"
        lifecycle = self._lifecycle_with_pod(pod)

        with self.assertRaisesRegex(osmo_errors.OSMOError, "unexpected Pod cohort"):
            lifecycle._observe_pods_once(_new_keyring("initial"))

    def test_attestation_rejects_a_replica_set_owned_by_another_deployment(self):
        expected = _new_keyring("initial")
        lifecycle = self._lifecycle_with_pod(
            _pod([_owner("ReplicaSet", "api-current", "rs-current")]),
            log=_descriptor_log(expected))
        lifecycle._current_replica_sets = mock.Mock(  # type: ignore[method-assign]
            return_value={"api-current": _replica_set_with_deployment_owner(
                "api-current", "rs-current", "other", "deployment-uid")})

        with self.assertRaisesRegex(osmo_errors.OSMOError, "wrong Deployment"):
            lifecycle._observe_pods_once(expected)

    def test_attestation_rejects_a_replica_set_with_a_stale_deployment_owner(self):
        expected = _new_keyring("initial")
        lifecycle = self._lifecycle_with_pod(
            _pod([_owner("ReplicaSet", "api-current", "rs-current")]),
            log=_descriptor_log(expected))
        lifecycle._current_replica_sets = mock.Mock(  # type: ignore[method-assign]
            return_value={"api-current": _replica_set_with_deployment_owner(
                "api-current", "rs-current", "api", "stale-deployment-uid")})

        with self.assertRaisesRegex(osmo_errors.OSMOError, "stale owner"):
            lifecycle._observe_pods_once(expected)

    def test_attestation_rejects_a_pod_that_loaded_another_keyring(self):
        lifecycle = self._lifecycle_with_pod(
            _pod([_owner("ReplicaSet", "api-current", "rs-current")]),
            log=_descriptor_log(_add_candidate(_new_keyring("initial"), "rotate-1")))

        with self.assertRaisesRegex(osmo_errors.OSMOError, "loaded another keyring"):
            lifecycle._observe_pods_once(_new_keyring("initial"))

    def test_verify_rollout_accepts_two_identical_observations(self):
        lifecycle = _lifecycle("activate")
        lifecycle._observe_pods_once = mock.Mock(  # type: ignore[method-assign]
            side_effect=[("pod-uid",), ("pod-uid",)])

        with mock.patch.object(lifecycle_module.time, "sleep"):
            lifecycle.verify_rollout(_new_keyring("initial"))

        self.assertEqual(lifecycle._observe_pods_once.call_count, 2)

    def test_verify_rollout_rejects_a_cohort_that_changed(self):
        lifecycle = _lifecycle("activate")
        lifecycle._observe_pods_once = mock.Mock(  # type: ignore[method-assign]
            side_effect=[("pod-a",), ("pod-b",)])

        with mock.patch.object(lifecycle_module.time, "sleep"):
            with self.assertRaisesRegex(osmo_errors.OSMOError, "cohort changed"):
                lifecycle.verify_rollout(_new_keyring("initial"))


class TestMekBootstrapGuards(unittest.TestCase):
    """Validate the fail-closed guards protecting automatic MEK generation."""

    def test_connect_database_ready_retries_until_postgres_accepts(self):
        lifecycle = _lifecycle("bootstrap")
        attempts = [lifecycle_module.psycopg2.OperationalError("not ready"), "connection"]

        with mock.patch.object(lifecycle_module.psycopg2, "connect", side_effect=attempts), \
                mock.patch.object(lifecycle_module.time, "sleep"):
            self.assertEqual(lifecycle._connect_database_ready(), "connection")

    def test_database_is_fresh_when_the_identity_tables_are_absent(self):
        cursor = FakeCursor([(None,), (None,)])

        self.assertTrue(MekLifecycle._database_is_fresh(FakeDatabaseConnection(cursor)))

    def test_database_is_fresh_when_the_identity_tables_are_empty(self):
        cursor = FakeCursor([("public.users",), None, ("public.ueks",), None])

        self.assertTrue(MekLifecycle._database_is_fresh(FakeDatabaseConnection(cursor)))

    def test_database_is_not_fresh_when_a_user_row_exists(self):
        cursor = FakeCursor([("public.users",), (1,)])

        self.assertFalse(MekLifecycle._database_is_fresh(FakeDatabaseConnection(cursor)))

    def test_database_is_not_fresh_when_a_uek_row_exists(self):
        cursor = FakeCursor([("public.users",), None, ("public.ueks",), (1,)])

        self.assertFalse(MekLifecycle._database_is_fresh(FakeDatabaseConnection(cursor)))

    def test_bootstrap_cohort_accepts_pods_whose_containers_never_started(self):
        lifecycle = _lifecycle("bootstrap")
        lifecycle.apps = mock.Mock()
        lifecycle.core = mock.Mock()
        lifecycle.apps.read_namespaced_deployment.return_value = _deployment()
        lifecycle.apps.list_namespaced_replica_set.return_value = types.SimpleNamespace(
            items=[_replica_set("api-current", "rs-current", 2)])
        lifecycle.core.list_namespaced_pod.return_value = types.SimpleNamespace(
            items=[_bootstrap_pod([_owner("ReplicaSet", "api-current", "rs-current")])])

        self.assertEqual(lifecycle._bootstrap_consumer_cohort(), ("pod-uid",))

    def test_bootstrap_cohort_skips_terminal_pods(self):
        lifecycle = _lifecycle("bootstrap")
        lifecycle.apps = mock.Mock()
        lifecycle.core = mock.Mock()
        lifecycle.apps.read_namespaced_deployment.return_value = _deployment()
        lifecycle.apps.list_namespaced_replica_set.return_value = types.SimpleNamespace(
            items=[_replica_set("api-current", "rs-current", 2)])
        lifecycle.core.list_namespaced_pod.return_value = types.SimpleNamespace(
            items=[_bootstrap_pod([], phase="Failed")])

        self.assertEqual(lifecycle._bootstrap_consumer_cohort(), ())

    def test_bootstrap_cohort_rejects_a_standalone_pod(self):
        lifecycle = _lifecycle("bootstrap")
        lifecycle.apps = mock.Mock()
        lifecycle.core = mock.Mock()
        lifecycle.apps.read_namespaced_deployment.return_value = _deployment()
        lifecycle.apps.list_namespaced_replica_set.return_value = types.SimpleNamespace(
            items=[_replica_set("api-current", "rs-current", 2)])
        lifecycle.core.list_namespaced_pod.return_value = types.SimpleNamespace(
            items=[_bootstrap_pod([])])

        with self.assertRaisesRegex(osmo_errors.OSMOError, "unexpected owner"):
            lifecycle._bootstrap_consumer_cohort()

    def test_bootstrap_cohort_rejects_a_pod_with_a_missing_replica_set(self):
        lifecycle = _lifecycle("bootstrap")
        lifecycle.apps = mock.Mock()
        lifecycle.core = mock.Mock()
        lifecycle.apps.read_namespaced_deployment.return_value = _deployment()
        lifecycle.apps.list_namespaced_replica_set.return_value = types.SimpleNamespace(items=[])
        lifecycle.core.list_namespaced_pod.return_value = types.SimpleNamespace(
            items=[_bootstrap_pod([_owner("ReplicaSet", "api-current", "rs-current")])])

        with self.assertRaisesRegex(osmo_errors.OSMOError, "stale owner"):
            lifecycle._bootstrap_consumer_cohort()

    def test_bootstrap_cohort_rejects_a_pod_with_a_stale_replica_set_owner(self):
        lifecycle = _lifecycle("bootstrap")
        lifecycle.apps = mock.Mock()
        lifecycle.core = mock.Mock()
        lifecycle.apps.read_namespaced_deployment.return_value = _deployment()
        lifecycle.apps.list_namespaced_replica_set.return_value = types.SimpleNamespace(
            items=[_replica_set("api-current", "rs-current", 2)])
        lifecycle.core.list_namespaced_pod.return_value = types.SimpleNamespace(
            items=[_bootstrap_pod([_owner("ReplicaSet", "api-current", "stale-uid")])])

        with self.assertRaisesRegex(osmo_errors.OSMOError, "stale owner"):
            lifecycle._bootstrap_consumer_cohort()

    def test_bootstrap_cohort_rejects_a_replica_set_from_another_deployment(self):
        lifecycle = _lifecycle("bootstrap")
        lifecycle.apps = mock.Mock()
        lifecycle.core = mock.Mock()
        lifecycle.apps.read_namespaced_deployment.return_value = _deployment()
        lifecycle.core.list_namespaced_pod.return_value = types.SimpleNamespace(
            items=[_bootstrap_pod([_owner("ReplicaSet", "api-current", "rs-current")])])
        lifecycle._current_replica_sets = mock.Mock(  # type: ignore[method-assign]
            return_value={"api-current": _replica_set_with_deployment_owner(
                "api-current", "rs-current", "other", "deployment-uid")})

        with self.assertRaisesRegex(osmo_errors.OSMOError, "wrong Deployment"):
            lifecycle._bootstrap_consumer_cohort()

    def test_bootstrap_cohort_rejects_a_pod_that_already_started_a_writer(self):
        lifecycle = _lifecycle("bootstrap")
        lifecycle.apps = mock.Mock()
        lifecycle.core = mock.Mock()
        lifecycle.apps.read_namespaced_deployment.return_value = _deployment()
        lifecycle.apps.list_namespaced_replica_set.return_value = types.SimpleNamespace(
            items=[_replica_set("api-current", "rs-current", 2)])
        lifecycle.core.list_namespaced_pod.return_value = types.SimpleNamespace(
            items=[_bootstrap_pod(
                [_owner("ReplicaSet", "api-current", "rs-current")],
                statuses=[_container_status(running=types.SimpleNamespace())])])

        with self.assertRaisesRegex(osmo_errors.OSMOError, "started a writer"):
            lifecycle._bootstrap_consumer_cohort()

    def test_quiescence_accepts_two_identical_cohorts(self):
        lifecycle = _lifecycle("bootstrap")
        lifecycle._bootstrap_consumer_cohort = mock.Mock(  # type: ignore[method-assign]
            side_effect=[("pod-uid",), ("pod-uid",)])

        with mock.patch.object(lifecycle_module.time, "sleep"):
            lifecycle._verify_bootstrap_quiescence()

        self.assertEqual(lifecycle._bootstrap_consumer_cohort.call_count, 2)

    def test_quiescence_retries_until_the_cohort_settles(self):
        lifecycle = _lifecycle("bootstrap")
        lifecycle._bootstrap_consumer_cohort = mock.Mock(  # type: ignore[method-assign]
            side_effect=[("pod-a",), ("pod-b",), ("pod-b",), ("pod-b",)])

        with mock.patch.object(lifecycle_module.time, "sleep"):
            lifecycle._verify_bootstrap_quiescence()

        self.assertEqual(lifecycle._bootstrap_consumer_cohort.call_count, 4)

    def test_quiescence_tolerates_deployments_that_do_not_exist_yet(self):
        lifecycle = _lifecycle("bootstrap")
        lifecycle._bootstrap_consumer_cohort = mock.Mock(  # type: ignore[method-assign]
            side_effect=[_api_error(404), ("pod-uid",), ("pod-uid",)])

        with mock.patch.object(lifecycle_module.time, "sleep"):
            lifecycle._verify_bootstrap_quiescence()

        self.assertEqual(lifecycle._bootstrap_consumer_cohort.call_count, 3)

    def test_quiescence_propagates_unexpected_api_errors(self):
        lifecycle = _lifecycle("bootstrap")
        lifecycle._bootstrap_consumer_cohort = mock.Mock(  # type: ignore[method-assign]
            side_effect=_api_error(500))

        with mock.patch.object(lifecycle_module.time, "sleep"):
            with self.assertRaises(lifecycle_module.kubernetes_exceptions.ApiException):
                lifecycle._verify_bootstrap_quiescence()

    @mock.patch("src.utils.secret_manager.mek_lifecycle.connectors.PostgresConnector")
    def test_authenticating_an_existing_database_removes_the_temporary_keyring(
            self, connector_class):
        lifecycle = _lifecycle("bootstrap")
        keyring = _new_keyring("initial")

        lifecycle._authenticate_existing_database(keyring)

        keyring_path = connector_class.call_args.args[0].mek_file
        self.assertFalse(Path(keyring_path).exists())
        connector_class.return_value.close.assert_called_once()

    def test_bootstrap_requires_managed_mode(self):
        lifecycle = _lifecycle("bootstrap", "external")

        with self.assertRaisesRegex(osmo_errors.OSMOError, "managed mode"):
            lifecycle.bootstrap()

    def test_bootstrap_rejects_an_existing_secret_whose_digest_drifted(self):
        lifecycle = _lifecycle("bootstrap")
        keyring = _new_keyring("initial")
        lifecycle._optional_secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(keyring, {
                _INSTALLATION: "osmo/release",
                _PHASE: "idle",
                _BUNDLE_DIGEST: "stale-digest",
            }))
        lifecycle._authenticate_existing_database = mock.Mock()  # type: ignore[method-assign]

        with self.assertRaisesRegex(osmo_errors.OSMOError, "does not match its data"):
            lifecycle.bootstrap()

        lifecycle._authenticate_existing_database.assert_not_called()

    def test_bootstrap_creates_a_keyring_only_for_a_fresh_quiescent_install(self):
        lifecycle = _lifecycle("bootstrap")
        cursor = FakeCursor([(True,)])
        connection = FakeDatabaseConnection(cursor)
        lifecycle._optional_secret = mock.Mock(  # type: ignore[method-assign]
            side_effect=[None, None])
        lifecycle._connect_database_ready = mock.Mock(  # type: ignore[method-assign]
            return_value=connection)
        lifecycle._database_is_fresh = mock.Mock(  # type: ignore[method-assign]
            return_value=True)
        lifecycle._verify_bootstrap_quiescence = mock.Mock()  # type: ignore[method-assign]
        lifecycle._create_secret = mock.Mock()  # type: ignore[method-assign]

        lifecycle.bootstrap()

        lifecycle._create_secret.assert_called_once()
        lifecycle._verify_bootstrap_quiescence.assert_called_once()
        self.assertIn("pg_try_advisory_lock", cursor.statements[0])
        self.assertIn("pg_advisory_unlock", cursor.statements[1])
        self.assertEqual(connection.close_count, 1)

    def test_bootstrap_refuses_to_mint_a_key_over_a_populated_database(self):
        lifecycle = _lifecycle("bootstrap")
        cursor = FakeCursor([(True,)])
        connection = FakeDatabaseConnection(cursor)
        lifecycle._optional_secret = mock.Mock(  # type: ignore[method-assign]
            return_value=None)
        lifecycle._connect_database_ready = mock.Mock(  # type: ignore[method-assign]
            return_value=connection)
        lifecycle._database_is_fresh = mock.Mock(  # type: ignore[method-assign]
            return_value=False)
        lifecycle._verify_bootstrap_quiescence = mock.Mock()  # type: ignore[method-assign]
        lifecycle._create_secret = mock.Mock()  # type: ignore[method-assign]

        with self.assertRaisesRegex(osmo_errors.OSMOError, "fresh OSMO database"):
            lifecycle.bootstrap()

        lifecycle._create_secret.assert_not_called()
        lifecycle._verify_bootstrap_quiescence.assert_not_called()
        self.assertEqual(connection.close_count, 1)

    def test_bootstrap_aborts_when_a_secret_appears_mid_flight(self):
        lifecycle = _lifecycle("bootstrap")
        connection = FakeDatabaseConnection(FakeCursor([(True,)]))
        lifecycle._optional_secret = mock.Mock(  # type: ignore[method-assign]
            side_effect=[None, _secret(_new_keyring("initial"))])
        lifecycle._connect_database_ready = mock.Mock(  # type: ignore[method-assign]
            return_value=connection)
        lifecycle._database_is_fresh = mock.Mock(  # type: ignore[method-assign]
            return_value=True)
        lifecycle._verify_bootstrap_quiescence = mock.Mock()  # type: ignore[method-assign]
        lifecycle._create_secret = mock.Mock()  # type: ignore[method-assign]

        with self.assertRaisesRegex(osmo_errors.OSMOError, "appeared during bootstrap"):
            lifecycle.bootstrap()

        lifecycle._create_secret.assert_not_called()


class TestMekPhaseTransitions(unittest.TestCase):
    """Validate the PREPARE, ACTIVATE, and REWRAP phase guards."""

    def test_validate_accepts_a_secret_owned_by_this_installation(self):
        lifecycle = _lifecycle("validate")
        keyring = _new_keyring("initial")
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(keyring, {_INSTALLATION: "osmo/release"}))

        lifecycle.validate()

        lifecycle._secret.assert_called_once()

    def test_validate_rejects_a_secret_owned_by_another_release(self):
        lifecycle = _lifecycle("validate")
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(_new_keyring("initial"), {_INSTALLATION: "osmo/other"}))

        with self.assertRaisesRegex(osmo_errors.OSMOError, "another Helm release"):
            lifecycle.validate()

    def test_prepare_requires_a_request_id(self):
        lifecycle = _lifecycle("prepare", request_id="")

        with self.assertRaisesRegex(osmo_errors.OSMOError, "requires a request ID"):
            lifecycle.prepare()

    def test_prepare_resume_rejects_annotations_that_drifted_from_the_data(self):
        lifecycle = _lifecycle("prepare")
        prepared = _add_candidate(_new_keyring("initial"), "rotate-1")
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(prepared, {
                _INSTALLATION: "osmo/release",
                _REQUEST: "rotate-1",
                _PHASE: "prepared",
                _PREPARE_GENERATION: "stale-generation",
                _BUNDLE_DIGEST: prepared.registry_digest,
            }))
        lifecycle._patch_secret = mock.Mock()  # type: ignore[method-assign]

        with self.assertRaisesRegex(osmo_errors.OSMOError, "Existing PREPARE state"):
            lifecycle.prepare()

        lifecycle._patch_secret.assert_not_called()

    def test_prepare_rejects_a_rotation_that_is_already_in_flight(self):
        lifecycle = _lifecycle("prepare")
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(_new_keyring("initial"), {
                _INSTALLATION: "osmo/release", _PHASE: "activated"}))
        lifecycle._patch_secret = mock.Mock()  # type: ignore[method-assign]

        with self.assertRaisesRegex(osmo_errors.OSMOError, "rotation is incomplete"):
            lifecycle.prepare()

        lifecycle._patch_secret.assert_not_called()

    def test_prepare_refuses_a_candidate_that_changes_the_current_key(self):
        lifecycle = _lifecycle("prepare")
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(_new_keyring("initial"), {
                _INSTALLATION: "osmo/release", _PHASE: "idle"}))
        lifecycle._patch_secret = mock.Mock()  # type: ignore[method-assign]

        with mock.patch.object(lifecycle_module, "_add_candidate",
                               return_value=_new_keyring("rotate-1")):
            with self.assertRaisesRegex(osmo_errors.OSMOError, "cannot change the current MEK"):
                lifecycle.prepare()

        lifecycle._patch_secret.assert_not_called()

    def test_activate_retry_rejects_annotations_that_drifted_from_the_data(self):
        lifecycle = _lifecycle("activate")
        prepared = _add_candidate(_new_keyring("initial"), "rotate-1")
        document = dict(prepared.document)
        document["currentMek"] = "mek-rotate-1"
        activated = _parse_keyring(_serialize_keyring(document))
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(activated, {
                _INSTALLATION: "osmo/release",
                _REQUEST: "rotate-1",
                _PHASE: "activated",
                _ACTIVATE_GENERATION: "stale-generation",
                _BUNDLE_DIGEST: activated.registry_digest,
                _CANDIDATE: activated.current_key_id,
            }))

        with self.assertRaisesRegex(osmo_errors.OSMOError, "Existing ACTIVATE state"):
            lifecycle.activate()

    def test_activate_requires_a_completed_prepare_phase(self):
        lifecycle = _lifecycle("activate")
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(_new_keyring("initial"), {
                _INSTALLATION: "osmo/release", _REQUEST: "rotate-1", _PHASE: "idle"}))

        with self.assertRaisesRegex(osmo_errors.OSMOError, "matching completed PREPARE"):
            lifecycle.activate()

    def test_activate_rejects_a_candidate_missing_from_the_keyring(self):
        lifecycle = _lifecycle("activate")
        prepared = _add_candidate(_new_keyring("initial"), "rotate-1")
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(prepared, {
                _INSTALLATION: "osmo/release",
                _REQUEST: "rotate-1",
                _PHASE: "prepared",
                _PREDECESSOR_CURRENT: prepared.current_key_id,
                _PREPARE_GENERATION: prepared.generation,
                _BUNDLE_DIGEST: prepared.registry_digest,
                _CANDIDATE: "mek-never-loaded",
            }))
        lifecycle.verify_rollout = mock.Mock()  # type: ignore[method-assign]

        with self.assertRaisesRegex(osmo_errors.OSMOError, "PREPARE annotations do not match"):
            lifecycle.activate()

        lifecycle.verify_rollout.assert_not_called()

    @mock.patch("src.utils.secret_manager.mek_lifecycle.connectors.PostgresConnector")
    def test_managed_rewrap_retry_rejects_a_completion_that_drifted(self, connector_class):
        lifecycle = _lifecycle("rewrap")
        activated = _add_candidate(_new_keyring("initial"), "rotate-1")
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(activated, {
                _INSTALLATION: "osmo/release",
                _REQUEST: "rotate-1",
                _PHASE: "complete",
                _COMPLETED: "rotate-1",
                _ACTIVATE_GENERATION: "stale-generation",
                _BUNDLE_DIGEST: activated.registry_digest,
                _CANDIDATE: activated.current_key_id,
            }))

        with self.assertRaisesRegex(osmo_errors.OSMOError, "Existing REWRAP completion"):
            lifecycle.rewrap()

        connector_class.assert_not_called()

    @mock.patch("src.utils.secret_manager.mek_lifecycle.connectors.PostgresConnector")
    def test_managed_rewrap_requires_the_activate_phase(self, connector_class):
        lifecycle = _lifecycle("rewrap")
        prepared = _add_candidate(_new_keyring("initial"), "rotate-1")
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(prepared, {
                _INSTALLATION: "osmo/release",
                _REQUEST: "rotate-1",
                _PHASE: "prepared",
            }))

        with self.assertRaisesRegex(osmo_errors.OSMOError, "matching ACTIVATE phase"):
            lifecycle.rewrap()

        connector_class.assert_not_called()

    @mock.patch("src.utils.secret_manager.mek_lifecycle.connectors.PostgresConnector")
    def test_managed_rewrap_rejects_activate_annotations_that_drifted(self, connector_class):
        lifecycle = _lifecycle("rewrap")
        activated = _add_candidate(_new_keyring("initial"), "rotate-1")
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(activated, {
                _INSTALLATION: "osmo/release",
                _REQUEST: "rotate-1",
                _PHASE: "activated",
                _ACTIVATE_GENERATION: "stale-generation",
                _BUNDLE_DIGEST: activated.registry_digest,
                _CANDIDATE: activated.current_key_id,
            }))

        with self.assertRaisesRegex(osmo_errors.OSMOError, "ACTIVATE annotations do not match"):
            lifecycle.rewrap()

        connector_class.assert_not_called()

    @mock.patch("src.utils.secret_manager.mek_lifecycle.connectors.PostgresConnector")
    def test_external_rewrap_requires_a_keyring_retaining_historical_keys(self, connector_class):
        lifecycle = _lifecycle("rewrap", "external")
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            return_value=_secret(_new_keyring("initial")))

        with self.assertRaisesRegex(osmo_errors.OSMOError, "retains historical MEKs"):
            lifecycle.rewrap()

        connector_class.assert_not_called()

    @mock.patch("src.utils.secret_manager.mek_lifecycle.connectors.PostgresConnector")
    def test_rewrap_aborts_when_the_secret_changes_during_the_database_rewrap(
            self, connector_class):
        del connector_class
        lifecycle = _lifecycle("rewrap", "external")
        activated = _add_candidate(_new_keyring("initial"), "rotate-1")
        changed = _secret(activated)
        changed.metadata.resource_version = "2"
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            side_effect=[_secret(activated), changed])
        lifecycle.verify_rollout = mock.Mock()  # type: ignore[method-assign]

        with self.assertRaisesRegex(osmo_errors.OSMOError, "changed during database rewrap"):
            lifecycle.rewrap()

    @mock.patch("src.utils.secret_manager.mek_lifecycle.connectors.PostgresConnector")
    def test_managed_rewrap_marks_the_secret_complete(self, connector_class):
        lifecycle = _lifecycle("rewrap")
        prepared = _add_candidate(_new_keyring("initial"), "rotate-1")
        document = dict(prepared.document)
        document["currentMek"] = "mek-rotate-1"
        activated = _parse_keyring(_serialize_keyring(document))
        secret = _secret(activated, {
            _INSTALLATION: "osmo/release",
            _REQUEST: "rotate-1",
            _PHASE: "activated",
            _ACTIVATE_GENERATION: activated.generation,
            _BUNDLE_DIGEST: activated.registry_digest,
            _CANDIDATE: activated.current_key_id,
        })
        lifecycle._secret = mock.Mock(  # type: ignore[method-assign]
            side_effect=[secret, secret])
        lifecycle.verify_rollout = mock.Mock()  # type: ignore[method-assign]
        lifecycle._patch_secret = mock.Mock()  # type: ignore[method-assign]

        lifecycle.rewrap()

        annotations = lifecycle._patch_secret.call_args.args[2]
        self.assertEqual(annotations[_PHASE], "complete")
        self.assertEqual(annotations[_COMPLETED], "rotate-1")
        connector_class.return_value.close.assert_called_once()


class TestMekLifecycleEntryPoints(unittest.TestCase):
    """Validate lease-fenced dispatch and the redacted failure boundary."""

    def test_run_dispatches_the_configured_operation_under_the_lease(self):
        lifecycle = _lifecycle("prepare")
        lifecycle.acquire_lease = mock.Mock()  # type: ignore[method-assign]
        lifecycle.release_lease = mock.Mock()  # type: ignore[method-assign]
        lifecycle.prepare = mock.Mock()  # type: ignore[method-assign]

        lifecycle.run()

        lifecycle.acquire_lease.assert_called_once()
        lifecycle.prepare.assert_called_once()
        lifecycle.release_lease.assert_called_once()

    def test_run_releases_the_lease_even_when_the_operation_fails(self):
        lifecycle = _lifecycle("prepare")
        lifecycle.acquire_lease = mock.Mock()  # type: ignore[method-assign]
        lifecycle.release_lease = mock.Mock()  # type: ignore[method-assign]
        lifecycle.prepare = mock.Mock(  # type: ignore[method-assign]
            side_effect=osmo_errors.OSMOError("boom"))

        with self.assertRaises(osmo_errors.OSMOError):
            lifecycle.run()

        lifecycle.release_lease.assert_called_once()

    def test_entry_point_loads_config_and_runs_one_operation(self):
        with mock.patch.object(lifecycle_module.MekLifecycleConfig, "load",
                               return_value=_config()) as load, \
                mock.patch.object(lifecycle_module, "MekLifecycle") as lifecycle_class:
            lifecycle_module._run()

        load.assert_called_once()
        lifecycle_class.return_value.run.assert_called_once()

    @mock.patch("src.utils.secret_manager.mek_lifecycle._run")
    def test_expected_failure_boundary_never_logs_exception_text(self, run):
        sentinel = "MEK-SENTINEL-DO-NOT-LOG"
        run.side_effect = osmo_errors.OSMOError(sentinel)

        with self.assertLogs(level="ERROR") as captured:
            with self.assertRaises(SystemExit):
                lifecycle_module.main()

        logged = "\n".join(captured.output)
        self.assertNotIn(sentinel, logged)
        self.assertIn("redacted", logged)


if __name__ == "__main__":
    unittest.main()
