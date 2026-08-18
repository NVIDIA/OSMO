"""KIND-only HA coverage for kubelet-projected MEK Secret rotation."""

import ast
import base64
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import time
import unittest

import yaml

from test.oetf.smoke_fixture import SmokeFixture


class MekRotationKind(SmokeFixture):
    """Exercise malformed, PREPARE, skipped-PREPARE, ACTIVATE, and rewrap paths."""

    namespace = os.environ.get("OSMO_NAMESPACE", "osmo")
    timeout_seconds = 300

    def _kubectl(self, *args, input_text=None, namespace=None):
        target_namespace = self.namespace if namespace is None else namespace
        command = ["kubectl"]
        if target_namespace:
            command.extend(["--namespace", target_namespace])
        command.extend(args)
        result = subprocess.run(
            command,
            input=input_text,
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            command_text = " ".join(command)
            raise RuntimeError(
                f"{command_text} failed with exit code "
                f"{result.returncode}: {result.stderr.strip()}"
            )
        return result.stdout

    def _json(self, *args, namespace=None):
        return json.loads(
            self._kubectl(*args, "-o", "json", namespace=namespace)
        )

    def _mek_consumers(self):
        consumers = {}
        for pod in self._json("get", "pods")["items"]:
            if pod["metadata"].get("labels", {}).get(
                "osmo.nvidia.com/mek-consumer"
            ) != "true":
                continue
            ready = any(
                condition["type"] == "Ready" and condition["status"] == "True"
                for condition in pod.get("status", {}).get("conditions", [])
            )
            if not ready:
                continue
            for container in pod["spec"]["containers"]:
                if any(
                    argument == "--mek_file" or argument.startswith("--mek_file=")
                    for argument in container.get("args", [])
                ):
                    consumers[pod["metadata"]["name"]] = container["name"]
        return consumers

    def _consumer_logs(self, since="15m"):
        return {
            pod: self._kubectl(
                "logs", pod, "--container", container, f"--since={since}", "--tail=500")
            for pod, container in self._mek_consumers().items()
        }

    def _wait(self, description, predicate):
        deadline = time.monotonic() + self.timeout_seconds
        last_value = None
        while time.monotonic() < deadline:
            last_value = predicate()
            if last_value is not None:
                return last_value
            time.sleep(2)
        self.fail(f"timed out waiting for {description}; last observation: {last_value!r}")

    def _apply_keyring(self, secret_name, secret_key, contents):
        with tempfile.NamedTemporaryFile("w", encoding="utf-8") as keyring_file:
            keyring_file.write(contents)
            keyring_file.flush()
            manifest = self._kubectl(
                "create", "secret", "generic", secret_name,
                f"--from-file={secret_key}={keyring_file.name}",
                "--dry-run=client", "-o", "json",
            )
        self._kubectl("apply", "-f", "-", input_text=manifest)

    def _api_deployment(self):
        matches = [
            deployment["metadata"]["name"]
            for deployment in self._json("get", "deployments")["items"]
            if any(
                container.get("command") == ["service"]
                for container in deployment["spec"]["template"]["spec"][
                    "containers"]
            )
        ]
        self.assertEqual(len(matches), 1, f"expected one API deployment, found {matches}")
        return matches[0]

    def _service_image(self):
        deployment = self._json("get", "deployment", self._api_deployment())
        images = [
            container["image"]
            for container in deployment["spec"]["template"]["spec"]["containers"]
            if container.get("command") == ["service"]
        ]
        self.assertEqual(len(images), 1, f"expected one service image, found {images}")
        return images[0]

    def _restore_replicas(self, deployment, replicas):
        self._kubectl("scale", "deployment", deployment, f"--replicas={replicas}")
        self._kubectl("rollout", "status", "deployment", deployment, "--timeout=5m")

    def _delete_credential(self, credential_name):
        self.http("DELETE", f"/api/credentials/{credential_name}").expect_ok()

    def _postgres_scalar(self, query, variables=None):
        command = [
            "exec", "-i", "deployment/postgres", "--",
            "psql", "--username=postgres", "--dbname=osmo",
            "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1",
        ]
        for name, value in (variables or {}).items():
            command.extend(["--set", f"{name}={value}"])
        # psql only performs variable interpolation for input read by its
        # main loop, not SQL supplied with --command.
        return self._kubectl(*command, input_text=f"{query}\n").strip()

    def _restore_workflow_alerts(self, raw_value):
        encoded = base64.b64encode(raw_value.encode("utf-8")).decode("ascii")
        statement = (
            "UPDATE configs SET value = "
            f"convert_from(decode('{encoded}', 'base64'), 'UTF8') "
            "WHERE key = 'workflow_alerts' AND type = 'WORKFLOW';\n"
        )
        self._kubectl(
            "exec", "-i", "deployment/postgres", "--",
            "psql", "--username=postgres", "--dbname=osmo",
            input_text=statement,
        )

    @staticmethod
    def _jwe_kid(value):
        protected = value.split(".", maxsplit=1)[0]
        protected += "=" * (-len(protected) % 4)
        return json.loads(base64.urlsafe_b64decode(protected))["kid"]

    def _workflow_alerts_raw(self):
        return self._postgres_scalar(
            "SELECT value FROM configs "
            "WHERE key = 'workflow_alerts' AND type = 'WORKFLOW';"
        )

    def _workflow_alerts_mek_id(self, raw_value=None):
        raw_value = raw_value or self._workflow_alerts_raw()
        if not raw_value:
            return None
        slack_token = json.loads(raw_value).get("slack_token", "")
        return self._jwe_kid(slack_token) if slack_token else None

    def _credential_uek_wrapper_mek_id(self, credential_name):
        wrapper = self._postgres_scalar(
            "SELECT u.keys -> (u.keys -> 'current') "
            "FROM ueks u JOIN credential c ON c.user_name = u.uid "
            "WHERE c.cred_name = :'credential_name' LIMIT 1;",
            {"credential_name": credential_name},
        )
        return self._jwe_kid(wrapper) if wrapper else None

    @staticmethod
    def _reference_counts(logs, key_id):
        counts = []
        for output in logs.values():
            for match in re.finditer(r"references=(\{.*?\}) blockers=", output):
                references = ast.literal_eval(match.group(1))
                if key_id in references:
                    counts.append(references[key_id])
        return counts

    @staticmethod
    def _service_chart_path():
        return os.path.join(
            os.environ["TEST_SRCDIR"],
            os.environ["TEST_WORKSPACE"],
            "deployments",
            "charts",
            "service",
        )

    def test_failed_bootstrap_revokes_privilege_and_keeps_diagnostics(self):
        release_name = f"mek-hook-{secrets.token_hex(4)}"
        test_namespace = f"{release_name}-test"
        hook_name = f"{release_name}-mek-bootstrap"
        diagnostic_name = f"{hook_name}-diagnostic"
        missing_secret = f"{release_name}-missing"
        self._kubectl("create", "namespace", test_namespace, namespace="")

        try:
            install = subprocess.run(
                [
                    "helm", "install", release_name, self._service_chart_path(),
                    "--namespace", test_namespace,
                    "--timeout", "30s",
                    "--set", "services.masterEncryptionKey.bootstrap.enabled=true",
                    "--set", (
                        "services.masterEncryptionKey.existingSecret.name="
                        f"{missing_secret}"
                    ),
                    "--set", (
                        "services.masterEncryptionKey.bootstrap.image="
                        "invalid.invalid/osmo/mek-bootstrap:never"
                    ),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(
                install.returncode,
                0,
                "invalid bootstrap image unexpectedly completed Helm install",
            )
            for resource in ("rolebinding", "role", "serviceaccount", "job"):
                retained = subprocess.run(
                    [
                        "kubectl", "--namespace", test_namespace,
                        "get", resource, hook_name,
                    ],
                    check=False,
                    capture_output=True,
                    text=True,
                )
                self.assertNotEqual(
                    retained.returncode,
                    0,
                    f"failed bootstrap retained hook {resource}/{hook_name}",
                )
            self.assertIn(
                "privileged resources were removed",
                json.loads(self._kubectl(
                    "get", "configmap", diagnostic_name, "-o", "json",
                    namespace=test_namespace,
                ))["data"]["recovery"],
            )
        finally:
            subprocess.run(
                [
                    "helm", "uninstall", release_name,
                    "--namespace", test_namespace,
                    "--ignore-not-found",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self._kubectl(
                "delete", "namespace", test_namespace,
                "--ignore-not-found=true", "--wait=true",
                namespace="",
            )

    def test_generated_tls_secrets_pass_real_helm_install(self):
        release_name = f"tls-hook-{secrets.token_hex(4)}"
        test_namespace = f"{release_name}-test"
        source_chart = self._service_chart_path()
        with tempfile.TemporaryDirectory() as temporary_directory:
            test_chart = os.path.join(temporary_directory, "service")
            templates = os.path.join(test_chart, "templates")
            os.makedirs(templates)
            for filename in ("Chart.yaml", "values.yaml"):
                shutil.copy2(
                    os.path.join(source_chart, filename),
                    os.path.join(test_chart, filename),
                )
            for filename in (
                "_helpers.tpl",
                "_gateway-helpers.tpl",
                "internal-tls-bootstrap.yaml",
            ):
                shutil.copy2(
                    os.path.join(source_chart, "templates", filename),
                    os.path.join(templates, filename),
                )

            try:
                install = subprocess.run(
                    [
                        "helm", "install", release_name, test_chart,
                        "--namespace", test_namespace, "--create-namespace",
                        "--wait", "--wait-for-jobs", "--timeout", "5m",
                        "--set-string", (
                            "gateway.tls.generated.bootstrap.image="
                            f"{self._service_image()}"
                        ),
                        "--set", (
                            "gateway.tls.generated.bootstrap.imagePullPolicy="
                            "IfNotPresent"
                        ),
                    ],
                    check=False,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(
                    install.returncode,
                    0,
                    f"real Helm install failed: {install.stdout}\n{install.stderr}",
                )
                expected = {
                    f"{release_name}-internal-tls-ca": (
                        "Opaque", {"ca.crt", "ca.key", "rotation-id"}
                    ),
                    f"{release_name}-internal-tls-trust": (
                        "Opaque", {"ca.crt"}
                    ),
                    f"{release_name}-internal-tls-service": (
                        "kubernetes.io/tls", {"tls.crt", "tls.key"}
                    ),
                    f"{release_name}-internal-tls-router": (
                        "kubernetes.io/tls", {"tls.crt", "tls.key"}
                    ),
                    f"{release_name}-internal-tls-agent": (
                        "kubernetes.io/tls", {"tls.crt", "tls.key"}
                    ),
                    f"{release_name}-internal-tls-logger": (
                        "kubernetes.io/tls", {"tls.crt", "tls.key"}
                    ),
                }
                for secret_name, (secret_type, required_keys) in expected.items():
                    secret = self._json(
                        "get", "secret", secret_name, namespace=test_namespace
                    )
                    self.assertEqual(secret["type"], secret_type)
                    self.assertTrue(
                        required_keys <= secret.get("data", {}).keys(),
                        f"{secret_name} was not initialized by the hook",
                    )
            finally:
                subprocess.run(
                    [
                        "helm", "uninstall", release_name,
                        "--namespace", test_namespace, "--ignore-not-found",
                    ],
                    check=False,
                    capture_output=True,
                    text=True,
                )
                self._kubectl(
                    "delete", "namespace", test_namespace,
                    "--ignore-not-found=true", "--wait=true",
                    namespace="",
                )

    def test_projected_secret_ha_rotation_and_rewrap(self):
        credential_name = f"kind-mek-{secrets.token_hex(6)}"
        self.http("POST", f"/api/credentials/{credential_name}").payload({
            "generic_credential": {"credential": {"rotation_probe": "present"}}
        }).expect_ok()
        self.addCleanup(self._delete_credential, credential_name)

        api_deployment = self._api_deployment()
        deployment = self._json("get", "deployment", api_deployment)
        original_replicas = deployment["spec"].get("replicas", 1)
        self.addCleanup(self._restore_replicas, api_deployment, original_replicas)
        self._kubectl("scale", "deployment", api_deployment, "--replicas=2")
        self._kubectl(
            "rollout", "status", "deployment", api_deployment, "--timeout=5m")
        self._wait(
            "at least two ready MEK consumers",
            lambda: (current if len(current := self._mek_consumers()) >= 2 else None),
        )
        deployment = self._json("get", "deployment", api_deployment)
        mek_volumes = [
            volume
            for volume in deployment["spec"]["template"]["spec"]["volumes"]
            if volume["name"] == "mek-volume"
        ]
        self.assertEqual(len(mek_volumes), 1, "expected one API MEK volume")
        self.assertIn("secret", mek_volumes[0], "MEK must use a Secret volume")
        mek_volume = mek_volumes[0]["secret"]
        secret_name = mek_volume["secretName"]
        secret_key = mek_volume["items"][0]["key"]
        secret = self._json("get", "secret", secret_name)
        keyring_contents = base64.b64decode(
            secret["data"][secret_key]).decode("utf-8")
        keyring = yaml.safe_load(keyring_contents)
        old_key_id = keyring["currentMek"]

        original_workflow_alerts = self._workflow_alerts_raw()
        self.assertTrue(
            original_workflow_alerts,
            "quick-start must initialize the workflow_alerts config row",
        )
        self.addCleanup(
            self._restore_workflow_alerts, original_workflow_alerts,
        )
        safe_keyring_contents = [keyring_contents]
        self.addCleanup(
            lambda: self._apply_keyring(
                secret_name, secret_key, safe_keyring_contents[0]))

        self._wait(
            "the credential seed to create an authenticated UEK wrapper",
            lambda: (
                old_key_id
                if self._credential_uek_wrapper_mek_id(credential_name) == old_key_id
                else None
            ),
        )
        self.http("PATCH", "/api/configs/workflow").payload({
            "configs_dict": {
                "workflow_alerts": {
                    "slack_token": f"kind-mek-direct-{secrets.token_hex(12)}",
                },
            },
            "description": "OETF MEK direct-config rewrap seed",
        }).expect_ok()
        seeded_workflow_alerts = [""]

        def direct_config_seeded():
            current = self._workflow_alerts_raw()
            if (
                current != original_workflow_alerts
                and self._workflow_alerts_mek_id(current) == old_key_id
            ):
                seeded_workflow_alerts[0] = current
                return old_key_id
            return None

        self._wait(
            "the API seed to persist an authenticated direct-MEK config",
            direct_config_seeded,
        )
        # Verify the two ciphertext domains directly. Aggregate reference
        # counts cannot distinguish a UEK wrapper from a direct-MEK config,
        # and replacing an existing SecretStr correctly leaves that count
        # unchanged.
        self.assertEqual(
            self._credential_uek_wrapper_mek_id(credential_name), old_key_id,
        )
        self.assertEqual(
            self._workflow_alerts_mek_id(seeded_workflow_alerts[0]), old_key_id,
        )

        self._apply_keyring(secret_name, secret_key, "not: an-osmo-keyring\n")
        self._wait(
            "every live consumer to reject the malformed Secret and retain LKG",
            lambda: (
                logs if logs and all(
                    "Rejected mounted MEK Secret update" in output
                    and f"current_kid={old_key_id}" in output
                    for output in logs.values()
                ) else None
            ) if (logs := self._consumer_logs()) else None,
        )

        new_key_id = f"kind-{secrets.token_hex(8)}"
        new_jwk = {
            "k": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii").rstrip("="),
            "kid": new_key_id,
            "kty": "oct",
        }
        keyring["meks"][new_key_id] = base64.b64encode(
            json.dumps(new_jwk, separators=(",", ":")).encode("utf-8")
        ).decode("ascii")
        prepared_keyring = yaml.safe_dump(keyring, sort_keys=False)
        self._apply_keyring(secret_name, secret_key, prepared_keyring)
        safe_keyring_contents[0] = prepared_keyring
        self._kubectl("scale", "deployment", api_deployment, "--replicas=1")
        self._kubectl(
            "rollout", "status", "deployment", api_deployment, "--timeout=5m")
        self._wait(
            "all live consumers to load PREPARE",
            lambda: (
                logs if logs and all(
                    f"current_kid={old_key_id}" in output and new_key_id in output
                    for output in logs.values()
                ) else None
            ) if (logs := self._consumer_logs()) else None,
        )

        keyring["currentMek"] = new_key_id
        activated_keyring = yaml.safe_dump(keyring, sort_keys=False)
        self._apply_keyring(secret_name, secret_key, activated_keyring)
        safe_keyring_contents[0] = activated_keyring
        self._kubectl("scale", "deployment", api_deployment, "--replicas=2")
        self._kubectl(
            "rollout", "status", "deployment", api_deployment, "--timeout=5m")
        self._wait(
            "every live consumer, including the skipped-PREPARE replica, to activate",
            lambda: (
                logs if len(logs) >= 2 and all(
                    f"current_kid={new_key_id}" in output for output in logs.values()
                ) else None
            ) if (logs := self._consumer_logs()) else None,
        )
        new_references = self._wait(
            "UEK and direct-MEK ciphertext to converge away from the old MEK",
            lambda: (0 if 0 in self._reference_counts(
                self._consumer_logs(), old_key_id) else None),
        )
        self.assertEqual(new_references, 0)
        self._wait(
            "the credential UEK wrapper to be rewrapped by the new MEK",
            lambda: (
                new_key_id
                if self._credential_uek_wrapper_mek_id(credential_name) == new_key_id
                else None
            ),
        )
        self._wait(
            "the direct-MEK workflow config to be rewrapped by the new MEK",
            lambda: (
                new_key_id
                if self._workflow_alerts_mek_id() == new_key_id
                else None
            ),
        )


if __name__ == "__main__":
    unittest.main()
