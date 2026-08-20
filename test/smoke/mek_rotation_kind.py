"""KIND coverage for the Kubernetes-native MEK rotation Job."""

import base64
import hashlib
import json
import os
import secrets
import subprocess
import time
import unittest

import yaml

from test.oetf.smoke_fixture import SmokeFixture


class MekRotationKind(SmokeFixture):
    """Exercise the chart-rendered PREPARE, ACTIVATE, and rewrap lifecycle."""

    namespace = os.environ.get("OSMO_NAMESPACE", "osmo")
    timeout_seconds = 300

    def _kubectl(self, *args, input_text=None, namespace=None):
        target_namespace = self.namespace if namespace is None else namespace
        command = ["kubectl"]
        if target_namespace:
            command.extend(["--namespace", target_namespace])
        command.extend(args)
        result = subprocess.run(
            command, input=input_text, check=False, capture_output=True, text=True)
        if result.returncode:
            joined_command = " ".join(command)
            raise RuntimeError(
                f"{joined_command} failed with exit code {result.returncode}: "
                f"{result.stderr.strip()}")
        return result.stdout

    def _json(self, *args):
        return json.loads(self._kubectl(*args, "-o", "json"))

    @staticmethod
    def _lease_name(installation_id, secret_name):
        release_name = installation_id.rsplit("/", maxsplit=1)[-1]
        prefix = "".join(
            character if character.islower() or character.isdigit() or character == "-"
            else "-" for character in release_name.lower()).strip("-") or "osmo"
        digest = hashlib.sha256(
            f"{installation_id}:{secret_name}".encode("utf-8")).hexdigest()[:10]
        prefix = prefix[:46].rstrip("-")
        return f"{prefix}-mek-{digest}"

    def _resource_exists(self, resource, name):
        return self._resource_exists_in(self.namespace, resource, name)

    @staticmethod
    def _resource_exists_in(namespace, resource, name):
        result = subprocess.run(
            ["kubectl", "--namespace", namespace, "get", resource, name],
            check=False, capture_output=True, text=True)
        return result.returncode == 0

    def _wait(self, description, predicate):
        deadline = time.monotonic() + self.timeout_seconds
        while time.monotonic() < deadline:
            value = predicate()
            if value is not None:
                return value
            time.sleep(2)
        self.fail(f"timed out waiting for {description}")

    def _api_deployment(self):
        matches = [
            deployment
            for deployment in self._json("get", "deployments")["items"]
            if any(
                container.get("command") == ["service"]
                for container in deployment["spec"]["template"]["spec"]["containers"]
            )
        ]
        self.assertEqual(1, len(matches), "expected exactly one API Deployment")
        return matches[0]

    def _postgres_scalar(self, query, variables=None):
        return self._postgres_scalar_in(self.namespace, query, variables)

    def _postgres_scalar_in(self, namespace, query, variables=None):
        command = [
            "exec", "-i", "deployment/postgres", "--", "psql",
            "--username=postgres", "--dbname=osmo", "--tuples-only", "--no-align",
            "--set", "ON_ERROR_STOP=1",
        ]
        for name, value in (variables or {}).items():
            command.extend(["--set", f"{name}={value}"])
        return self._kubectl(
            *command, input_text=f"{query}\n", namespace=namespace).strip()

    @staticmethod
    def _run_checked(command, expected_success=True):
        result = subprocess.run(
            command, check=False, capture_output=True, text=True, timeout=900)
        if (result.returncode == 0) != expected_success:
            joined_command = " ".join(command)
            raise RuntimeError(
                f"{joined_command} exited {result.returncode}: "
                f"{result.stderr.strip()}")
        return result

    def _component_job(self, namespace, component):
        jobs = self._json_in(
            namespace, "get", "jobs", "-l",
            f"app.kubernetes.io/component={component}")["items"]
        return jobs[0]["metadata"]["name"] if jobs else None

    def _json_in(self, namespace, *args):
        return json.loads(self._kubectl(*args, "-o", "json", namespace=namespace))

    @staticmethod
    def _jwe_kid(value):
        protected = value.split(".", maxsplit=1)[0]
        protected += "=" * (-len(protected) % 4)
        return json.loads(base64.urlsafe_b64decode(protected))["kid"]

    def _credential_uek_wrapper_mek_id(self, credential_name):
        wrapper = self._postgres_scalar(
            "SELECT u.keys -> (u.keys -> 'current') "
            "FROM ueks u JOIN credential c ON c.user_name = u.uid "
            "WHERE c.cred_name = :'credential_name' LIMIT 1;",
            {"credential_name": credential_name},
        )
        return self._jwe_kid(wrapper) if wrapper else None

    def _workflow_alerts_raw(self):
        return self._postgres_scalar(
            "SELECT value FROM configs "
            "WHERE key = 'workflow_alerts' AND type = 'WORKFLOW';")

    def _workflow_alerts_mek_id(self, raw_value=None):
        raw_value = raw_value or self._workflow_alerts_raw()
        if not raw_value:
            return None
        slack_token = json.loads(raw_value).get("slack_token", "")
        return self._jwe_kid(slack_token) if slack_token else None

    def _restore_workflow_alerts(self, raw_value):
        encoded = base64.b64encode(raw_value.encode("utf-8")).decode("ascii")
        self._kubectl(
            "exec", "-i", "deployment/postgres", "--", "psql",
            "--username=postgres", "--dbname=osmo",
            input_text=(
                "UPDATE configs SET value = "
                f"convert_from(decode('{encoded}', 'base64'), 'UTF8') "
                "WHERE key = 'workflow_alerts' AND type = 'WORKFLOW';\n"),
        )

    @staticmethod
    def _service_chart_path():
        return os.path.join(
            os.environ["TEST_SRCDIR"], os.environ["TEST_WORKSPACE"],
            "deployments", "charts", "service")

    @staticmethod
    def _split_image(image):
        repository, tag = image.rsplit(":", maxsplit=1)
        location, image_name = repository.rsplit("/", maxsplit=1)
        return location, image_name, tag

    def _render_lifecycle_resources(
            self, secret_name, secret_key, operation, request_id="", attempt="1",
            invalid_consumer=False):
        deployment = self._api_deployment()
        service_container = next(
            container
            for container in deployment["spec"]["template"]["spec"]["containers"]
            if container.get("command") == ["service"])
        image_location, image_name, image_tag = self._split_image(
            service_container["image"])
        chart_path = self._service_chart_path()
        command = [
            "helm", "template", "osmo", chart_path,
            "--namespace", self.namespace,
            "--is-upgrade",
            "--show-only", "templates/mek-bootstrap.yaml",
            "-f", os.path.join(chart_path, "quick-start-values.yaml"),
            "--set", "services.masterEncryptionKey.bootstrap.enabled=false",
            "--set", "services.masterEncryptionKey.managementMode=osmo",
            "--set", f"services.masterEncryptionKey.existingSecret.name={secret_name}",
            "--set", f"services.masterEncryptionKey.existingSecret.key={secret_key}",
            "--set", f"global.osmoImageLocation={image_location}",
            "--set", f"global.osmoImageTag={image_tag}",
            "--set", f"services.service.imageName={image_name}",
        ]
        if operation == "rotate":
            command.extend([
                "--set", f"services.masterEncryptionKey.rotation.requestId={request_id}",
                "--set", f"services.masterEncryptionKey.rotation.attempt={attempt}",
            ])
        elif operation == "recover":
            command.extend([
                "--set", "services.masterEncryptionKey.recovery.enabled=true",
                "--set", f"services.masterEncryptionKey.recovery.attempt={attempt}",
            ])
        elif operation == "rebind":
            command.extend([
                "--set", "services.masterEncryptionKey.rebind.enabled=true",
                "--set", f"services.masterEncryptionKey.rebind.attempt={attempt}",
            ])
        else:
            raise ValueError(f"unsupported lifecycle operation: {operation}")
        result = subprocess.run(command, check=False, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(f"helm template failed: {result.stderr.strip()}")
        documents = [document for document in yaml.safe_load_all(result.stdout) if document]
        component = {
            "rotate": "mek-rotation",
            "recover": "mek-recovery",
            "rebind": "mek-bootstrap",
        }[operation]
        job = next(
            document for document in documents
            if document.get("kind") == "Job"
            and document["spec"]["template"]["metadata"]["labels"].get(
                "app.kubernetes.io/component") == component)
        if invalid_consumer:
            args = job["spec"]["template"]["spec"]["containers"][0]["args"]
            args[args.index("--consumer_deployments") + 1] = "missing-mek-consumer"
        attempt_name = job["metadata"]["name"]
        resources = [
            document for document in documents
            if document.get("kind") in ("ServiceAccount", "Role", "RoleBinding", "Job")
            and document.get("metadata", {}).get("name") == attempt_name
        ]
        self.assertEqual(4, len(resources), "lifecycle attempt RBAC is incomplete")
        return attempt_name, yaml.safe_dump_all(resources)

    def _delete_rotation_resources(self, attempt_name):
        self._kubectl(
            "delete", "job", "rolebinding", "role", "serviceaccount",
            attempt_name, "--ignore-not-found=true")

    def _run_lifecycle(
            self, secret_name, secret_key, operation, request_id="", attempt="1",
            invalid_consumer=False, expect_failure=False):
        attempt_name, manifest = self._render_lifecycle_resources(
            secret_name, secret_key, operation, request_id, attempt, invalid_consumer)
        self._kubectl("apply", "-f", "-", input_text=manifest)
        self.addCleanup(self._delete_rotation_resources, attempt_name)

        def completed():
            job = self._json("get", "job", attempt_name)
            if job.get("status", {}).get("failed"):
                logs = self._kubectl("logs", f"job/{attempt_name}")
                if expect_failure:
                    return logs
                self.fail(f"MEK rotation Job failed:\n{logs}")
            if job.get("status", {}).get("succeeded"):
                if expect_failure:
                    self.fail(f"MEK lifecycle Job {attempt_name} unexpectedly succeeded")
                return attempt_name
            return None

        return self._wait(f"the MEK {operation} Job to complete", completed)

    def _recreate_secret(self, secret):
        metadata = secret["metadata"]
        manifest = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {
                "name": metadata["name"],
                "namespace": self.namespace,
                "annotations": metadata.get("annotations", {}),
                "labels": metadata.get("labels", {}),
            },
            "type": secret.get("type", "Opaque"),
            "data": secret["data"],
        }
        self._kubectl("delete", "secret", metadata["name"])
        self._kubectl("apply", "-f", "-", input_text=yaml.safe_dump(manifest))
        return self._json("get", "secret", metadata["name"])

    def _delete_credential(self, credential_name):
        self.http("DELETE", f"/api/credentials/{credential_name}").expect_ok()

    def test_projected_secret_ha_rotation_and_rewrap(self):
        credential_name = f"kind-mek-{secrets.token_hex(6)}"
        self.http("POST", f"/api/credentials/{credential_name}").payload({
            "generic_credential": {"credential": {"rotation_probe": "present"}}
        }).expect_ok()
        self.addCleanup(self._delete_credential, credential_name)

        deployment = self._api_deployment()
        mek_volume = next(
            volume for volume in deployment["spec"]["template"]["spec"]["volumes"]
            if volume["name"] == "mek-volume")["secret"]
        secret_name = mek_volume["secretName"]
        secret_key = mek_volume["items"][0]["key"]
        secret = self._json("get", "secret", secret_name)
        keyring = yaml.safe_load(base64.b64decode(secret["data"][secret_key]))
        old_key_id = keyring["currentMek"]
        installation_id = f"{self.namespace}/osmo"
        self.assertEqual(
            installation_id,
            secret["metadata"].get("annotations", {}).get(
                "osmo.nvidia.com/mek-installation"))
        adoption = self._postgres_scalar(
            "SELECT secret_uid || '|' || installation_id || '|' || management_mode || '|' || "
            "ready::text FROM public.mek_keyring_adoption WHERE singleton;")
        secret_uid = secret["metadata"]["uid"]
        self.assertEqual(
            f"{secret_uid}|{installation_id}|osmo|true", adoption)
        lease_name = self._lease_name(installation_id, secret_name)
        lease = self._json("get", "lease", lease_name)
        self.assertFalse(lease.get("spec", {}).get("holderIdentity"))
        self.assertFalse(any(
            "mek-bootstrap" in binding["metadata"]["name"]
            for binding in self._json("get", "rolebindings")["items"]),
            "successful bootstrap left its mutation RoleBinding live")

        recreated = self._recreate_secret(secret)
        self.assertNotEqual(secret["metadata"]["uid"], recreated["metadata"]["uid"])
        rejected_logs = self._run_lifecycle(
            secret_name, secret_key, "rotate", request_id="uid-mismatch",
            expect_failure=True)
        self.assertIn("installation binding", rejected_logs)
        lease = self._json("get", "lease", lease_name)
        self.assertFalse(lease.get("spec", {}).get("holderIdentity"))
        self._run_lifecycle(secret_name, secret_key, "rebind", attempt="uid-2")
        rebound_uid = self._postgres_scalar(
            "SELECT secret_uid FROM public.mek_keyring_adoption WHERE singleton;")
        self.assertEqual(recreated["metadata"]["uid"], rebound_uid)

        original_workflow_alerts = self._workflow_alerts_raw()
        self.assertTrue(original_workflow_alerts)
        self.addCleanup(self._restore_workflow_alerts, original_workflow_alerts)
        self._wait(
            "the credential UEK wrapper seed",
            lambda: old_key_id if self._credential_uek_wrapper_mek_id(
                credential_name) == old_key_id else None)
        self.http("PATCH", "/api/configs/workflow").payload({
            "configs_dict": {
                "workflow_alerts": {
                    "slack_token": f"kind-mek-direct-{secrets.token_hex(12)}"}},
            "description": "OETF MEK direct-config rewrap seed",
        }).expect_ok()
        self._wait(
            "the direct-MEK config seed",
            lambda: old_key_id if self._workflow_alerts_mek_id() == old_key_id else None)

        request_id = f"kind-{secrets.token_hex(8)}"
        failed_name, failed_manifest = self._render_lifecycle_resources(
            secret_name, secret_key, "rotate", request_id, invalid_consumer=True)
        self._kubectl("apply", "-f", "-", input_text=failed_manifest)
        self.addCleanup(self._delete_rotation_resources, failed_name)

        def failed_after_claim():
            job = self._json("get", "job", failed_name)
            return failed_name if job.get("status", {}).get("failed") else None

        self._wait("a claimed rotation attempt to fail", failed_after_claim)
        self.assertEqual(
            f"{request_id}|prepare-written|false",
            self._postgres_scalar(
                "SELECT rotation_id || '|' || phase || '|' || credential_fenced::text "
                "FROM public.mek_rewrap_status WHERE singleton;"))
        self._delete_rotation_resources(failed_name)
        self._wait(
            "the failed rotation Pod to disappear",
            lambda: True if not self._json("get", "pods")["items"] or not any(
                pod["metadata"].get("labels", {}).get("job-name") == failed_name
                for pod in self._json("get", "pods")["items"]) else None)
        self._run_lifecycle(secret_name, secret_key, "recover", attempt="recover-1")
        self.assertEqual(
            "true", self._postgres_scalar(
                "SELECT credential_fenced::text FROM public.mek_rewrap_status "
                "WHERE singleton;"))
        completed_name = self._run_lifecycle(
            secret_name, secret_key, "rotate", request_id=request_id, attempt="2")
        self.assertFalse(
            self._resource_exists("rolebinding", completed_name),
            "successful rotation left its mutation RoleBinding live")
        rotated_secret = self._json("get", "secret", secret_name)
        rotated_keyring = yaml.safe_load(
            base64.b64decode(rotated_secret["data"][secret_key]))
        new_key_id = rotated_keyring["currentMek"]
        self.assertNotEqual(old_key_id, new_key_id)
        self.assertIn(old_key_id, rotated_keyring["meks"])
        self.assertEqual(len(keyring["meks"]) + 1, len(rotated_keyring["meks"]))
        self.assertEqual(
            new_key_id, self._credential_uek_wrapper_mek_id(credential_name))
        self.assertEqual(new_key_id, self._workflow_alerts_mek_id())

    def test_real_helm_install_failure_recovery_and_resume(self):
        """Exercise Helm ownership/order, not only directly applied manifests."""
        suffix = secrets.token_hex(4)
        namespace = f"mek-e2e-{suffix}"
        release = f"mek-e2e-{suffix}"
        secret_name = f"{release}-mek"
        chart_path = self._service_chart_path()
        deployment = self._api_deployment()
        service_container = next(
            container
            for container in deployment["spec"]["template"]["spec"]["containers"]
            if container.get("command") == ["service"])
        image_location, image_name, image_tag = self._split_image(
            service_container["image"])
        common_values = [
            "-f", os.path.join(chart_path, "quick-start-values.yaml"),
            "--set", f"global.osmoImageLocation={image_location}",
            "--set", f"global.osmoImageTag={image_tag}",
            "--set", f"services.service.imageName={image_name}",
            "--set", "services.masterEncryptionKey.managementMode=osmo",
            "--set", f"services.masterEncryptionKey.existingSecret.name={secret_name}",
            "--set", "services.masterEncryptionKey.bootstrap.enabled=true",
        ]

        def helm_upgrade(*sets, wait=False):
            command = [
                "helm", "upgrade", release, chart_path, "--namespace", namespace,
                "--reuse-values",
            ]
            for value in sets:
                command.extend(["--set", value])
            if wait:
                command.extend(["--wait", "--wait-for-jobs", "--timeout", "10m"])
            return self._run_checked(command)

        self.addCleanup(
            subprocess.run,
            ["kubectl", "delete", "namespace", namespace, "--ignore-not-found=true"],
            check=False, capture_output=True, text=True)
        self._run_checked([
            "helm", "install", release, chart_path, "--namespace", namespace,
            "--create-namespace", "--wait", "--wait-for-jobs", "--timeout", "10m",
            *common_values,
        ])
        self.addCleanup(
            subprocess.run,
            ["helm", "uninstall", release, "--namespace", namespace],
            check=False, capture_output=True, text=True)

        adoption = self._postgres_scalar_in(
            namespace,
            "SELECT management_mode || '|' || ready::text "
            "FROM public.mek_keyring_adoption WHERE singleton;")
        self.assertEqual("osmo|true", adoption)
        bindings = self._json_in(namespace, "get", "rolebindings")["items"]
        self.assertFalse(any(
            "mek-bootstrap" in binding["metadata"]["name"] for binding in bindings))

        request_id = f"helm-{suffix}"
        helm_upgrade(
            "services.masterEncryptionKey.bootstrap.enabled=false",
            f"services.masterEncryptionKey.rotation.requestId={request_id}")
        self._wait(
            "the Helm rotation claim",
            lambda: request_id if self._postgres_scalar_in(
                namespace,
                "SELECT rotation_id FROM public.mek_rewrap_status WHERE singleton;")
            == request_id else None)
        self._kubectl(
            "delete", "deployment", "osmo-logger", namespace=namespace)
        rotation_job = self._wait(
            "the Helm rotation Job",
            lambda: self._component_job(namespace, "mek-rotation"))
        self._wait(
            "the claimed Helm rotation failure",
            lambda: rotation_job if self._json_in(
                namespace, "get", "job", rotation_job).get(
                    "status", {}).get("failed") else None)

        # Model a container/API loss before the final self-revocation by
        # restoring the exact release-owned binding. The recovery upgrade must
        # remove it as part of normal Helm reconciliation before LSAR runs.
        release_manifest = self._run_checked([
            "helm", "get", "manifest", release, "--namespace", namespace,
        ]).stdout
        rotation_binding = next(
            document for document in yaml.safe_load_all(release_manifest)
            if document and document.get("kind") == "RoleBinding"
            and document["metadata"]["name"] == rotation_job)
        self._kubectl(
            "apply", "-f", "-", namespace=namespace,
            input_text=yaml.safe_dump(rotation_binding))
        self.assertTrue(self._resource_exists_in(
            namespace, "rolebinding", rotation_job))

        helm_upgrade(
            "services.masterEncryptionKey.rotation.requestId=",
            "services.masterEncryptionKey.recovery.enabled=true")
        recovery_job = self._wait(
            "the Helm recovery Job",
            lambda: self._component_job(namespace, "mek-recovery"))
        self._wait(
            "the Helm recovery completion",
            lambda: recovery_job if self._json_in(
                namespace, "get", "job", recovery_job).get(
                    "status", {}).get("succeeded") else None)
        self.assertFalse(self._resource_exists_in(
            namespace, "rolebinding", rotation_job))

        helm_upgrade(
            "services.masterEncryptionKey.recovery.enabled=false", wait=True)
        helm_upgrade(
            f"services.masterEncryptionKey.rotation.requestId={request_id}",
            "services.masterEncryptionKey.rotation.attempt=2")
        resumed_job = self._wait(
            "the resumed Helm rotation Job",
            lambda: self._component_job(namespace, "mek-rotation"))
        self._wait(
            "the resumed Helm rotation completion",
            lambda: resumed_job if self._json_in(
                namespace, "get", "job", resumed_job).get(
                    "status", {}).get("succeeded") else None)
        self.assertFalse(self._resource_exists_in(
            namespace, "rolebinding", resumed_job))
        completed_secret = self._json_in(namespace, "get", "secret", secret_name)
        self.assertEqual(
            request_id,
            completed_secret["metadata"]["annotations"].get(
                "osmo.nvidia.com/mek-rotation-complete"))

        helm_upgrade()
        self.assertIsNone(self._component_job(namespace, "mek-rotation"))


if __name__ == "__main__":
    unittest.main()
