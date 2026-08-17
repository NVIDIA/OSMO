"""KIND-only HA coverage for kubelet-projected MEK Secret rotation."""

import ast
import base64
import json
import os
import re
import secrets
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

    def _kubectl(self, *args, input_text=None):
        result = subprocess.run(
            ["kubectl", "--namespace", self.namespace, *args],
            input=input_text,
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout

    def _json(self, *args):
        return json.loads(self._kubectl(*args, "-o", "json"))

    def _mek_consumers(self):
        consumers = {}
        for pod in self._json("get", "pods")["items"]:
            ready = any(
                condition["type"] == "Ready" and condition["status"] == "True"
                for condition in pod.get("status", {}).get("conditions", [])
            )
            if not ready:
                continue
            for container in pod["spec"]["containers"]:
                if "--mek_file" in container.get("args", []):
                    consumers[pod["metadata"]["name"]] = container["name"]
        return consumers

    def _consumer_logs(self):
        return {
            pod: self._kubectl("logs", pod, "--container", container)
            for pod, container in self._mek_consumers().items()
        }

    def _wait(self, description, predicate):
        deadline = time.monotonic() + self.timeout_seconds
        last_value = None
        while time.monotonic() < deadline:
            last_value = predicate()
            if last_value:
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
            if deployment["metadata"].get("labels", {}).get(
                "app.kubernetes.io/component") == "api"
        ]
        self.assertEqual(len(matches), 1, f"expected one API deployment, found {matches}")
        return matches[0]

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
        hook_name = f"{release_name}-mek-bootstrap"
        diagnostic_name = f"{hook_name}-diagnostic"
        missing_secret = f"{release_name}-missing"
        install = subprocess.run(
            [
                "helm", "install", release_name, self._service_chart_path(),
                "--namespace", self.namespace,
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

        try:
            self.assertNotEqual(
                install.returncode,
                0,
                "invalid bootstrap image unexpectedly completed Helm install",
            )
            for resource in ("rolebinding", "role", "serviceaccount", "job"):
                retained = subprocess.run(
                    [
                        "kubectl", "--namespace", self.namespace,
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
                self._json("get", "configmap", diagnostic_name)["data"][
                    "recovery"],
            )
        finally:
            subprocess.run(
                [
                    "helm", "uninstall", release_name,
                    "--namespace", self.namespace,
                    "--ignore-not-found",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self._kubectl(
                "delete", "configmap", diagnostic_name,
                "--ignore-not-found=true", "--wait=true",
            )

    def test_projected_secret_ha_rotation_and_rewrap(self):
        self.http("POST", "/api/credentials/kind-mek-test").payload({
            "generic_credential": {"credential": {"rotation_probe": "present"}}
        }).expect_ok()

        api_deployment = self._api_deployment()
        self._kubectl("scale", "deployment", api_deployment, "--replicas=2")
        self._kubectl(
            "rollout", "status", "deployment", api_deployment, "--timeout=5m")
        consumers = self._wait(
            "at least two ready MEK consumers",
            lambda: (current if len(current := self._mek_consumers()) >= 2 else None),
        )
        pod = self._json("get", "pod", next(iter(consumers)))
        mek_volume = next(
            volume["secret"] for volume in pod["spec"]["volumes"]
            if volume["name"] == "mek-volume"
        )
        secret_name = mek_volume["secretName"]
        secret_key = mek_volume["items"][0]["key"]
        secret = self._json("get", "secret", secret_name)
        original = base64.b64decode(secret["data"][secret_key]).decode("utf-8")
        keyring = yaml.safe_load(original)
        old_key_id = keyring["currentMek"]

        uek_references = self._wait(
            "the credential seed to create an authenticated UEK wrapper",
            lambda: (max(counts) if (counts := self._reference_counts(
                self._consumer_logs(), old_key_id)) and max(counts) >= 1 else None),
        )
        self.http("PATCH", "/api/configs/workflow").payload({
            "configs_dict": {
                "workflow_alerts": {
                    "slack_token": f"kind-mek-direct-{secrets.token_hex(12)}",
                },
            },
            "description": "OETF MEK direct-config rewrap seed",
        }).expect_ok()
        old_references = self._wait(
            "the direct-config seed to add an authenticated old-MEK reference",
            lambda: (max(counts) if (counts := self._reference_counts(
                self._consumer_logs(), old_key_id))
                    and max(counts) >= uek_references + 1 else None),
        )
        # The API-created credential proves the UEK domain is non-vacuous. The
        # subsequent workflow SecretStr PATCH must independently increase the
        # authenticated reference count, proving the direct-MEK config domain.
        self.assertGreaterEqual(old_references, uek_references + 1)

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
        self._apply_keyring(secret_name, secret_key, yaml.safe_dump(keyring, sort_keys=False))
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
        self._apply_keyring(secret_name, secret_key, yaml.safe_dump(keyring, sort_keys=False))
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


if __name__ == "__main__":
    unittest.main()
