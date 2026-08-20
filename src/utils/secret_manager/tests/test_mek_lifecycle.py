"""Unit coverage for the Kubernetes-native MEK lifecycle controller."""

import base64
import contextlib
import copy
import io
import types
import unittest
from unittest import mock

from src.lib.utils import osmo_errors
from src.utils.secret_manager import mek_lifecycle


def _object(**values):
    return types.SimpleNamespace(**values)


class KeyringTest(unittest.TestCase):
    """Validate lifecycle keyring generation without exposing key material."""

    def test_prepare_adds_one_key_without_changing_current(self):
        original = mek_lifecycle._new_keyring("initial")
        prepared = mek_lifecycle._add_candidate(original, "rotation-1")

        self.assertEqual(original.current_key_id, prepared.current_key_id)
        self.assertEqual(set(original.fingerprints) | {"mek-rotation-1"},
                         set(prepared.fingerprints))
        self.assertNotEqual(original.registry_digest, prepared.registry_digest)

    def test_duplicate_yaml_key_is_rejected_without_echoing_it(self):
        marker = "do-not-log-this-marker"
        encoded = (
            f"currentMek: one\ncurrentMek: {marker}\nmeks: {{}}\n".encode("utf-8")
        )

        with self.assertRaises(osmo_errors.OSMOError) as context:
            mek_lifecycle._parse_keyring(encoded)
        self.assertNotIn(marker, str(context.exception))
        self.assertIsNone(context.exception.__cause__)

    def test_same_material_under_two_key_ids_is_rejected(self):
        keyring = mek_lifecycle._new_keyring("one")
        document = copy.deepcopy(keyring.document)
        encoded_jwk = base64.b64decode(document["meks"]["mek-one"])
        aliased_jwk = encoded_jwk.replace(b'"kid":"mek-one"', b'"kid":"mek-two"')
        document["meks"]["mek-two"] = base64.b64encode(aliased_jwk).decode("ascii")

        with self.assertRaises(osmo_errors.OSMOError):
            mek_lifecycle._parse_keyring(mek_lifecycle._serialize_keyring(document))

    def test_rotation_limit_keeps_old_keys_loaded(self):
        keyring = mek_lifecycle._new_keyring("one")

        with mock.patch.object(mek_lifecycle, "MAX_MEK_COUNT", 1):
            with self.assertRaisesRegex(osmo_errors.OSMOError, "rotation limit"):
                mek_lifecycle._add_candidate(keyring, "two")


class LeaseNameTest(unittest.TestCase):
    """Keep lifecycle fencing scoped to one release and full Secret identity."""

    def test_same_secret_has_different_lease_per_release(self):
        self.assertNotEqual(
            mek_lifecycle._lease_name("osmo/release-a", "shared-mek"),
            mek_lifecycle._lease_name("osmo/release-b", "shared-mek"),
        )

    def test_long_shared_prefixes_do_not_collide(self):
        prefix = "a" * 63
        first = mek_lifecycle._lease_name("osmo/release", f"{prefix}-one")
        second = mek_lifecycle._lease_name("osmo/release", f"{prefix}-two")

        self.assertNotEqual(first, second)
        self.assertLessEqual(len(first), 63)


class LeaseTest(unittest.TestCase):
    """Validate the namespace Lease fence."""

    def _lifecycle(self, holder="pod-new", renew_time=None):
        lifecycle = mek_lifecycle.MekLifecycle.__new__(mek_lifecycle.MekLifecycle)
        lifecycle.config = _object(
            pod_uid="pod-new", namespace="osmo", secret_name="mek")
        lifecycle.lease_name = "mek-mek-lifecycle"
        lifecycle.lease_resource_version = ""
        lease = _object(
            metadata=_object(resource_version="1"),
            spec=_object(holder_identity=holder, lease_duration_seconds=30,
                         acquire_time=None, renew_time=renew_time),
        )
        lifecycle.core = mock.Mock()
        lifecycle.core.list_namespaced_pod.return_value = _object(items=[])
        lifecycle.coordination = mock.Mock()
        lifecycle.coordination.read_namespaced_lease.return_value = lease
        lifecycle.coordination.replace_namespaced_lease.side_effect = (
            lambda _name, _namespace, value: _object(
                metadata=_object(resource_version="2"), spec=value.spec))
        return lifecycle

    def test_acquire_never_steals_another_holder(self):
        lifecycle = self._lifecycle(holder="pod-old")

        with self.assertRaisesRegex(osmo_errors.OSMOError, "still owns"):
            lifecycle.acquire_lease()
        lifecycle.coordination.replace_namespaced_lease.assert_not_called()

    def test_acquire_updates_the_precreated_lease(self):
        lifecycle = self._lifecycle(holder="")

        lifecycle.acquire_lease()

        self.assertEqual("2", lifecycle.lease_resource_version)
        lifecycle.coordination.replace_namespaced_lease.assert_called_once()

    def test_expired_lease_is_not_stolen_from_a_live_pod(self):
        lifecycle = self._lifecycle(
            holder="pod-old",
            renew_time=mek_lifecycle.datetime.datetime.now(
                mek_lifecycle.datetime.timezone.utc) - mek_lifecycle.datetime.timedelta(
                    minutes=5))
        lifecycle.core.list_namespaced_pod.return_value = _object(items=[
            _object(
                metadata=_object(uid="pod-old"),
                status=_object(phase="Running")),
        ])

        with self.assertRaisesRegex(osmo_errors.OSMOError, "live Pod"):
            lifecycle.acquire_lease(allow_expired=True)
        lifecycle.coordination.replace_namespaced_lease.assert_not_called()

    def test_release_clears_only_the_revision_owned_by_this_pod(self):
        lifecycle = self._lifecycle(holder="pod-new")
        lifecycle.lease_resource_version = "1"

        lifecycle.release_lease()

        replaced = lifecycle.coordination.replace_namespaced_lease.call_args.args[2]
        self.assertEqual("", replaced.spec.holder_identity)
        self.assertEqual("", lifecycle.lease_resource_version)


class PodEnumerationTest(unittest.TestCase):
    """Ensure acknowledgement gates enumerate exact Deployment-owned Pods."""

    def _lifecycle(self, pod_owner="rs-uid"):
        lifecycle = mek_lifecycle.MekLifecycle.__new__(mek_lifecycle.MekLifecycle)
        lifecycle.config = _object(
            namespace="osmo", consumer_deployments=["osmo-api"])
        deployment = _object(
            metadata=_object(uid="deployment-uid", generation=3),
            spec=_object(
                replicas=1,
                selector=_object(
                    match_labels={"app": "osmo-api"}, match_expressions=[])),
            status=_object(
                observed_generation=3, replicas=1, updated_replicas=1,
                available_replicas=1),
        )
        replica_set = _object(
            metadata=_object(
                uid="rs-uid",
                owner_references=[_object(kind="Deployment", uid="deployment-uid")]))
        pod = _object(
            metadata=_object(
                uid="pod-uid",
                owner_references=[_object(kind="ReplicaSet", uid=pod_owner)]),
            status=_object(phase="Running"),
        )
        lifecycle.apps = mock.Mock()
        lifecycle.apps.read_namespaced_deployment.return_value = deployment
        lifecycle.apps.list_namespaced_replica_set.return_value = _object(
            items=[replica_set])
        lifecycle.core = mock.Mock()
        lifecycle.core.list_namespaced_pod.return_value = _object(items=[pod])
        return lifecycle

    def test_returns_only_pods_owned_by_exact_deployment(self):
        lifecycle = self._lifecycle()

        self.assertEqual(("pod-uid",), lifecycle._required_pod_uids())
        lifecycle.core.list_namespaced_pod.assert_called_once_with(
            "osmo", label_selector="app=osmo-api")

    def test_rejects_selector_collision_from_another_deployment(self):
        lifecycle = self._lifecycle(pod_owner="other-rs")

        with self.assertRaisesRegex(osmo_errors.OSMOError, "Pod set is changing"):
            lifecycle._required_pod_uids()


class AcknowledgementTest(unittest.TestCase):
    """Use the PostgreSQL clock for freshness boundaries."""

    def test_wait_uses_database_timestamp_not_job_clock(self):
        lifecycle = mek_lifecycle.MekLifecycle.__new__(mek_lifecycle.MekLifecycle)
        database_time = mek_lifecycle.datetime.datetime(
            2040, 1, 1, tzinfo=mek_lifecycle.datetime.timezone.utc)
        cursor = mock.MagicMock()
        cursor.fetchone.return_value = (database_time,)
        connection = mock.MagicMock()
        connection.__enter__.return_value = connection
        connection.cursor.return_value.__enter__.return_value = cursor
        lifecycle.__dict__["_database"] = mock.Mock(return_value=connection)
        lifecycle.__dict__["_check_deadline"] = mock.Mock()
        acknowledged = mock.Mock(return_value=True)
        lifecycle.__dict__["_acknowledged"] = acknowledged
        keyring = mek_lifecycle._new_keyring("ack")

        lifecycle._wait_for_acknowledgements(keyring, active=False)

        self.assertEqual(2, acknowledged.call_count)
        self.assertTrue(all(
            call.args[2] == database_time
            for call in acknowledged.call_args_list))


class SecretPatchTest(unittest.TestCase):
    """Validate exact-resource-version Secret writes."""

    def test_patch_rejects_resource_version_change(self):
        lifecycle = mek_lifecycle.MekLifecycle.__new__(mek_lifecycle.MekLifecycle)
        lifecycle.config = _object(secret_name="mek", secret_key="mek.yaml", namespace="osmo")
        lifecycle.core = mock.Mock()
        lifecycle.core.read_namespaced_secret.return_value = _object(
            metadata=_object(
                uid="secret-uid", resource_version="new",
                annotations={mek_lifecycle._MANAGED_ANNOTATION: "osmo"}))
        lifecycle.__dict__["_check_deadline"] = mock.Mock()

        with self.assertRaisesRegex(osmo_errors.OSMOError, "changed concurrently"):
            lifecycle._patch_secret(
                mek_lifecycle._new_keyring(), "old", {"example": "value"})
        lifecycle.core.patch_namespaced_secret.assert_not_called()


class LifecycleBoundaryTest(unittest.TestCase):
    """Revoke one-shot RBAC and redact untrusted infrastructure failures."""

    def test_revoke_deletes_exact_attempt_role_binding(self):
        lifecycle = mek_lifecycle.MekLifecycle.__new__(mek_lifecycle.MekLifecycle)
        lifecycle.config = _object(
            service_account="mek-attempt", namespace="osmo")
        lifecycle.rbac = mock.Mock()

        lifecycle.revoke_attempt_authority()

        lifecycle.rbac.delete_namespaced_role_binding.assert_called_once_with(
            "mek-attempt", "osmo")

    def test_failure_still_revokes_attempt_role_binding(self):
        config = _object(
            operation="bootstrap", pod_uid="pod", service_account="mek-attempt")
        lifecycle = mock.Mock()
        lifecycle.lease_resource_version = ""
        lifecycle.bootstrap.side_effect = RuntimeError("untrusted")

        with mock.patch.object(
            mek_lifecycle.MekLifecycleConfig, "load", return_value=config
        ), mock.patch.object(
            mek_lifecycle, "MekLifecycle", return_value=lifecycle
        ), self.assertRaises(RuntimeError):
            mek_lifecycle._run()

        lifecycle.revoke_attempt_authority.assert_called_once_with()

    def test_main_never_logs_api_exception_body(self):
        marker = "do-not-log-mek-material"
        error = mek_lifecycle.kubernetes_exceptions.ApiException(
            status=422, reason=marker)
        error.body = f'{{"data":{{"mek.yaml":"{marker}"}}}}'
        lifecycle = mek_lifecycle.MekLifecycle.__new__(mek_lifecycle.MekLifecycle)
        lifecycle.config = _object(
            secret_name="mek", secret_key="mek.yaml", namespace="osmo",
            installation_id="osmo/release")
        lifecycle.__dict__["_check_deadline"] = mock.Mock()
        lifecycle.core = mock.Mock()
        lifecycle.core.read_namespaced_secret.return_value = _object(
            metadata=_object(
                uid="uid", resource_version="1",
                annotations={
                    mek_lifecycle._MANAGED_ANNOTATION: "osmo",
                    mek_lifecycle._INSTALLATION_ANNOTATION: "osmo/release",
                }))
        lifecycle.core.patch_namespaced_secret.side_effect = error

        def patch_secret():
            lifecycle._patch_secret(
                mek_lifecycle._new_keyring(), "1", {"example": "value"})

        stdout, stderr = io.StringIO(), io.StringIO()

        with mock.patch.object(mek_lifecycle, "_run", side_effect=patch_secret), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr), \
                self.assertLogs(level="ERROR") as captured, \
                self.assertRaises(SystemExit) as context:
            mek_lifecycle.main()

        self.assertEqual(1, context.exception.code)
        emitted = stdout.getvalue() + stderr.getvalue() + "\n".join(captured.output)
        self.assertNotIn(marker, emitted)


class RotationResumeTest(unittest.TestCase):
    """Cover the two Kubernetes/SQL crash boundaries."""

    def _lifecycle(self):
        lifecycle = mek_lifecycle.MekLifecycle.__new__(mek_lifecycle.MekLifecycle)
        lifecycle.config = _object(request_id="rotation-1")
        return lifecycle

    def test_infers_prepare_patch_completed_before_phase_cas(self):
        lifecycle = self._lifecycle()
        predecessor = mek_lifecycle._new_keyring("initial")
        prepared = mek_lifecycle._add_candidate(predecessor, "rotation-1")
        row = {
            "secret_uid": "uid", "secret_resource_version": "old",
            "phase": "claimed", "predecessor_generation": predecessor.generation,
            "candidate_generation": "", "registry_digest": predecessor.registry_digest,
        }
        secret = _object(metadata=_object(
            uid="uid", resource_version="new",
            annotations={mek_lifecycle._ROTATION_ANNOTATION: "rotation-1"}))

        self.assertEqual(
            ("prepare-written", prepared.generation),
            lifecycle._validate_resumed_rotation(row, prepared, secret))

    def test_infers_activate_patch_completed_before_phase_cas(self):
        lifecycle = self._lifecycle()
        prepared = mek_lifecycle._add_candidate(
            mek_lifecycle._new_keyring("initial"), "rotation-1")
        activated_document = copy.deepcopy(prepared.document)
        activated_document["currentMek"] = "mek-rotation-1"
        activated = mek_lifecycle._parse_keyring(
            mek_lifecycle._serialize_keyring(activated_document))
        row = {
            "secret_uid": "uid", "secret_resource_version": "old",
            "phase": "prepared", "predecessor_generation": "predecessor",
            "candidate_generation": prepared.generation,
            "registry_digest": prepared.registry_digest,
        }
        secret = _object(metadata=_object(
            uid="uid", resource_version="new",
            annotations={mek_lifecycle._ROTATION_ANNOTATION: "rotation-1"}))

        self.assertEqual(
            ("activate-written", activated.generation),
            lifecycle._validate_resumed_rotation(row, activated, secret))

    def test_rejects_unrecognized_secret_change(self):
        lifecycle = self._lifecycle()
        predecessor = mek_lifecycle._new_keyring("initial")
        row = {
            "secret_uid": "uid", "secret_resource_version": "old",
            "phase": "claimed", "predecessor_generation": predecessor.generation,
            "candidate_generation": "", "registry_digest": predecessor.registry_digest,
        }
        secret = _object(metadata=_object(
            uid="uid", resource_version="unexpected", annotations={}))

        with self.assertRaisesRegex(osmo_errors.OSMOError, "outside"):
            lifecycle._validate_resumed_rotation(row, predecessor, secret)

    def test_phase_cas_rejects_same_revision_with_different_keyring(self):
        lifecycle = self._lifecycle()
        lifecycle.config = _object(
            request_id="rotation-1", secret_key="mek.yaml", pod_uid="job-pod")
        expected = mek_lifecycle._new_keyring("initial")
        replacement = mek_lifecycle._new_keyring("other")
        expected_secret = _object(metadata=_object(
            uid="uid", resource_version="2",
            annotations={mek_lifecycle._ROTATION_ANNOTATION: "rotation-1"}))
        live_secret = _object(
            metadata=expected_secret.metadata,
            data={"mek.yaml": base64.b64encode(replacement.encoded).decode("ascii")})
        lifecycle.__dict__["_secret"] = mock.Mock(return_value=live_secret)
        lifecycle.__dict__["_database"] = mock.Mock()

        with self.assertRaisesRegex(osmo_errors.OSMOError, "phase keyring"):
            lifecycle._advance_phase(
                1, "claimed", "prepare-written", expected, expected_secret)
        lifecycle._database.assert_not_called()

    def test_completed_rotation_rerun_accepts_and_binds_marker_revision(self):
        lifecycle = self._lifecycle()
        lifecycle.config = _object(
            request_id="rotation-1", secret_name="mek", secret_key="mek.yaml",
            installation_id="osmo/release", pod_uid="retry-pod",
            service_account="retry-sa")
        keyring = mek_lifecycle._new_keyring("rotation-1")
        secret = _object(metadata=_object(
            uid="uid", resource_version="marker-rv",
            annotations={
                mek_lifecycle._ROTATION_ANNOTATION: "rotation-1",
                mek_lifecycle._ROTATION_COMPLETE_ANNOTATION: "rotation-1",
            }))
        row = {
            "rotation_id": "rotation-1", "fencing_epoch": 4, "phase": "complete",
            "active_pod_uid": "old-pod", "active_service_account": "old-sa",
            "credential_fenced": False, "predecessor_generation": "old",
            "candidate_generation": keyring.generation,
            "registry_digest": keyring.registry_digest, "secret_uid": "uid",
            "secret_resource_version": "pre-marker-rv",
        }
        cursor = mock.MagicMock()
        cursor.fetchone.side_effect = [
            row, ("mek", "mek.yaml", "uid", "osmo/release", "osmo", True)]
        cursor.rowcount = 1
        connection = mock.MagicMock()
        connection.__enter__.return_value = connection
        connection.cursor.return_value.__enter__.return_value = cursor
        lifecycle.__dict__["_database"] = mock.Mock(return_value=connection)

        claim = lifecycle._claim_rotation(keyring, secret)

        self.assertEqual("complete", claim.phase)
        self.assertTrue(any(
            "SET secret_resource_version" in call.args[0]
            for call in cursor.execute.call_args_list))


class OwnershipTest(unittest.TestCase):
    """Require explicit, content-preserving Secret ownership transitions."""

    def _lifecycle(self, keyring):
        lifecycle = mek_lifecycle.MekLifecycle.__new__(mek_lifecycle.MekLifecycle)
        lifecycle.config = _object(
            namespace="osmo", secret_name="mek", secret_key="mek.yaml",
            installation_id="osmo/release")
        secret = _object(
            metadata=_object(
                uid="new-uid", resource_version="2",
                annotations={
                    mek_lifecycle._MANAGED_ANNOTATION: "osmo",
                    mek_lifecycle._INSTALLATION_ANNOTATION: "osmo/release",
                }),
            data={"mek.yaml": base64.b64encode(keyring.encoded).decode("ascii")})
        lifecycle.__dict__["_secret"] = mock.Mock(return_value=secret)
        lifecycle.__dict__["_required_secret_keyring"] = mock.Mock(return_value=keyring)
        cursor = mock.MagicMock()
        connection = mock.MagicMock()
        connection.__enter__.return_value = connection
        connection.cursor.return_value.__enter__.return_value = cursor
        lifecycle.__dict__["_database"] = mock.Mock(return_value=connection)
        return lifecycle, cursor

    def test_rebind_accepts_only_identical_recreated_secret(self):
        keyring = mek_lifecycle._new_keyring("initial")
        lifecycle, cursor = self._lifecycle(keyring)
        cursor.fetchone.side_effect = [
            ("mek", "mek.yaml", "old-uid", "osmo/release", "osmo", True),
            ("rotate-old", "complete"),
        ]
        cursor.fetchall.return_value = [
            (kid, fingerprint, "current")
            for kid, fingerprint in keyring.fingerprints.items()
        ]
        cursor.rowcount = 1

        lifecycle.rebind()

        self.assertTrue(any(
            "SET secret_uid" in call.args[0]
            for call in cursor.execute.call_args_list))

    def test_release_records_explicit_external_ownership(self):
        keyring = mek_lifecycle._new_keyring("initial")
        lifecycle, cursor = self._lifecycle(keyring)
        cursor.fetchone.side_effect = [
            ("mek", "mek.yaml", "new-uid", "osmo/release", "osmo", True),
            ("rotate-old", "complete"),
        ]
        cursor.fetchall.return_value = [
            (kid, fingerprint, "current")
            for kid, fingerprint in keyring.fingerprints.items()
        ]
        cursor.rowcount = 1

        lifecycle.release_ownership()

        self.assertTrue(any(
            "management_mode = 'external'" in call.args[0]
            for call in cursor.execute.call_args_list))

    def test_release_retry_accepts_already_external_ownership(self):
        keyring = mek_lifecycle._new_keyring("initial")
        lifecycle, cursor = self._lifecycle(keyring)
        cursor.fetchone.side_effect = [
            ("mek", "mek.yaml", "new-uid", "osmo/release", "external", True),
            ("rotate-old", "complete"),
        ]
        cursor.fetchall.return_value = [
            (kid, fingerprint, "current")
            for kid, fingerprint in keyring.fingerprints.items()
        ]

        lifecycle.release_ownership()

        self.assertFalse(any(
            "SET management_mode = 'external'" in call.args[0]
            for call in cursor.execute.call_args_list))

    def test_reacquire_restores_managed_mode_after_safe_rollback(self):
        keyring = mek_lifecycle._new_keyring("initial")
        lifecycle, cursor = self._lifecycle(keyring)
        cursor.fetchone.side_effect = [
            ("mek", "mek.yaml", "new-uid", "osmo/release", "external", True),
            ("rotate-old", "complete"),
        ]
        cursor.fetchall.return_value = [
            (kid, fingerprint, "current")
            for kid, fingerprint in keyring.fingerprints.items()
        ]
        cursor.rowcount = 1

        lifecycle.reacquire_ownership()

        self.assertTrue(any(
            "management_mode = 'osmo'" in call.args[0]
            for call in cursor.execute.call_args_list))

    def test_rebind_rejects_wrong_installation_annotation(self):
        keyring = mek_lifecycle._new_keyring("initial")
        lifecycle, cursor = self._lifecycle(keyring)
        secret = lifecycle._secret()
        secret.metadata.annotations[mek_lifecycle._INSTALLATION_ANNOTATION] = "other/release"

        with self.assertRaisesRegex(osmo_errors.OSMOError, "not OSMO managed"):
            lifecycle.rebind()
        cursor.execute.assert_not_called()


class RecoveryTest(unittest.TestCase):
    """Bind recovery to the exact installation and failed Lease holder."""

    def _lifecycle(self):
        lifecycle = mek_lifecycle.MekLifecycle.__new__(mek_lifecycle.MekLifecycle)
        lifecycle.config = _object(
            namespace="osmo", secret_name="mek", secret_key="mek.yaml",
            installation_id="osmo/release")
        lifecycle.lease_name = "mek-mek-lifecycle"
        lifecycle.__dict__["_check_deadline"] = mock.Mock()
        lifecycle.core = mock.Mock()
        lifecycle.core.list_namespaced_pod.return_value = _object(items=[])
        lifecycle.coordination = mock.Mock()
        cursor = mock.MagicMock()
        connection = mock.MagicMock()
        connection.__enter__.return_value = connection
        connection.cursor.return_value.__enter__.return_value = cursor
        lifecycle.__dict__["_database"] = mock.Mock(return_value=connection)
        return lifecycle, cursor

    def test_recovery_rejects_another_installation(self):
        lifecycle, cursor = self._lifecycle()
        cursor.fetchone.return_value = {
            "secret_name": "other", "secret_key": "mek.yaml",
            "installation_id": "other/release", "management_mode": "osmo",
            "ready": True,
        }

        with self.assertRaisesRegex(osmo_errors.OSMOError, "installation binding"):
            lifecycle.recover()
        lifecycle.coordination.read_namespaced_lease.assert_not_called()

    def test_recovery_never_clears_a_different_lease_holder(self):
        lifecycle, cursor = self._lifecycle()
        cursor.fetchone.side_effect = [
            {
                "secret_name": "mek", "secret_key": "mek.yaml",
                "installation_id": "osmo/release", "management_mode": "osmo",
                "ready": True,
            },
            {
                "rotation_id": "rotation", "phase": "prepared",
                "active_pod_uid": "old-pod", "active_service_account": "old-sa",
            },
        ]
        cursor.rowcount = 1
        lifecycle.coordination.read_namespaced_lease.return_value = _object(
            metadata=_object(resource_version="3"),
            spec=_object(holder_identity="new-pod", renew_time=None))
        denied = _object(status=_object(allowed=False))
        authorization = mock.Mock()
        authorization.create_namespaced_local_subject_access_review.return_value = denied

        with mock.patch.object(
            mek_lifecycle.client, "AuthorizationV1Api", return_value=authorization
        ), self.assertRaisesRegex(osmo_errors.OSMOError, "different attempt"):
            lifecycle.recover()
        lifecycle.coordination.replace_namespaced_lease.assert_not_called()


if __name__ == "__main__":
    unittest.main()
