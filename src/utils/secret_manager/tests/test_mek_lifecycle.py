"""Unit tests for the Kubernetes-only MEK state machine."""

# SPDX-License-Identifier: Apache-2.0
# pylint: disable=protected-access

import base64
import json
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
) -> MekLifecycleConfig:
    return MekLifecycleConfig.model_construct(
        operation=operation,
        namespace="osmo",
        secret_name="osmo-mek",
        secret_key="mek.yaml",
        installation_id="osmo/release",
        management_mode=mode,
        request_id="rotate-1",
        pod_uid="pod-1",
        consumer_deployments=["api"],
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
) -> MekLifecycle:
    lifecycle = MekLifecycle.__new__(MekLifecycle)
    lifecycle.config = _config(operation, mode)
    lifecycle.deadline = time.monotonic() + 900
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


class TestMekLifecycle(unittest.TestCase):
    """Validate the Kubernetes-only lifecycle state machine."""

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


if __name__ == "__main__":
    unittest.main()
