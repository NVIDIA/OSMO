"""KIND coverage for the unified chart's generated OAuth cookie Secret."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
# SPDX-License-Identifier: Apache-2.0

import base64
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile
import unittest

from cryptography import x509

from test.oetf.smoke_fixture import SmokeFixture


class OauthCookieKind(SmokeFixture):
    """Exercise Helm lookup, retention, and old-release compatibility."""

    @staticmethod
    def _run(command, expected_success=True):
        result = subprocess.run(
            command, check=False, capture_output=True, text=True, timeout=180)
        if (result.returncode == 0) != expected_success:
            command_text = " ".join(command)
            raise RuntimeError(
                f"{command_text} exited {result.returncode}: "
                f"{result.stderr.strip()}")
        return result

    @staticmethod
    def _chart_path():
        return os.path.join(
            os.environ["TEST_SRCDIR"], os.environ["TEST_WORKSPACE"],
            "deployments", "charts", "osmo")

    def test_generated_oauth_cookie_helm_lifecycle(self):
        suffix = secrets.token_hex(4)
        namespace = f"oauth-cookie-{suffix}"
        release = f"oauth-cookie-{suffix}"
        legacy_release = f"oauth-existing-{suffix}"
        chart = self._chart_path()
        profile = os.path.join(chart, "profiles", "split-plane-control.yaml")
        external = os.path.join(chart, "tests", "control-external-values.yaml")
        generated_secret = f"{release}-osmo-oauth-cookie"

        def kubectl(*args, expected_success=True):
            return self._run(
                ["kubectl", "--namespace", namespace, *args], expected_success)

        def helm_apply(target_release, *extra, reuse_values=False,
                       expected_success=True, chart_path=None):
            command = [
                "helm", "upgrade", target_release, chart_path or chart,
                "--namespace", namespace, "--no-hooks",
            ]
            if reuse_values:
                command.append("--reuse-values")
            else:
                command.extend([
                    "--install", "-f", profile, "-f", external,
                    "--set", "gateway.oauth2Proxy.enabled=true",
                    "--set",
                    "secrets.oauthClientSecret.existingSecret=operator-oauth-client",
                ])
            command.extend(extra)
            return self._run(command, expected_success)

        def secret():
            return json.loads(kubectl(
                "get", "secret", generated_secret, "-o", "json").stdout)

        self.addCleanup(
            subprocess.run,
            ["kubectl", "delete", "namespace", namespace,
             "--ignore-not-found=true", "--wait=true", "--timeout=45s"],
            check=False, capture_output=True, text=True)
        self._run(["kubectl", "create", "namespace", namespace])

        helm_apply(
            release,
            "--set", "secrets.oauthCookieSecret.generate=true",
            "--set-string", "secrets.oauthCookieSecret.existingSecret=")
        initial = secret()
        initial_uid = initial["metadata"]["uid"]
        initial_data = initial["data"]["cookie_secret"]
        mounted = base64.b64decode(initial_data).decode("ascii")
        self.assertRegex(mounted, re.compile(r"^[A-Za-z0-9_-]{43}=$"))
        self.assertEqual(32, len(base64.urlsafe_b64decode(mounted)))

        helm_apply(release, reuse_values=True)
        upgraded = secret()
        self.assertEqual(initial_uid, upgraded["metadata"]["uid"])
        self.assertEqual(initial_data, upgraded["data"]["cookie_secret"])

        self._run(["helm", "uninstall", release, "--namespace", namespace])
        retained = secret()
        self.assertEqual(initial_uid, retained["metadata"]["uid"])
        self.assertEqual(initial_data, retained["data"]["cookie_secret"])
        helm_apply(
            release,
            "--set", "secrets.oauthCookieSecret.generate=true",
            "--set-string", "secrets.oauthCookieSecret.existingSecret=")
        reinstalled = secret()
        self.assertEqual(initial_uid, reinstalled["metadata"]["uid"])
        self.assertEqual(initial_data, reinstalled["data"]["cookie_secret"])

        kubectl(
            "label", "secret", generated_secret,
            "app.kubernetes.io/instance=another-release", "--overwrite")
        foreign = helm_apply(release, reuse_values=True, expected_success=False)
        self.assertIn("is not owned by this release", foreign.stderr)
        kubectl(
            "label", "secret", generated_secret,
            f"app.kubernetes.io/instance={release}", "--overwrite")

        kubectl(
            "annotate", "secret", generated_secret,
            "meta.helm.sh/release-name=another-release", "--overwrite")
        foreign_annotation = helm_apply(
            release, reuse_values=True, expected_success=False)
        self.assertIn("is not owned by this release", foreign_annotation.stderr)
        kubectl(
            "annotate", "secret", generated_secret,
            f"meta.helm.sh/release-name={release}", "--overwrite")

        kubectl(
            "patch", "secret", generated_secret, "--type=merge",
            "--patch", json.dumps({"type": "example.com/foreign"}))
        invalid_type = helm_apply(
            release, reuse_values=True, expected_success=False)
        self.assertIn("has an invalid type", invalid_type.stderr)
        kubectl(
            "patch", "secret", generated_secret, "--type=merge",
            "--patch", json.dumps({"type": "Opaque"}))

        sentinel = base64.b64encode(b"OAUTH-COOKIE-DO-NOT-LOG").decode("ascii")
        kubectl(
            "patch", "secret", generated_secret, "--type=merge",
            "--patch", json.dumps({"data": {"cookie_secret": sentinel}}))
        malformed = helm_apply(release, reuse_values=True, expected_success=False)
        self.assertIn("key cookie_secret is invalid", malformed.stderr)
        self.assertNotIn(sentinel, malformed.stderr)

        kubectl("delete", "secret", generated_secret)
        missing = helm_apply(release, reuse_values=True, expected_success=False)
        self.assertIn("is missing during upgrade; restore it", missing.stderr)

        with tempfile.TemporaryDirectory() as temporary_directory:
            legacy_chart = os.path.join(temporary_directory, "osmo")
            shutil.copytree(chart, legacy_chart)
            values_path = Path(legacy_chart, "values.yaml")
            legacy_values, replacements = re.subn(
                r"(  oauthCookieSecret:\n(?:    #[^\n]*\n)*)"
                r"    generate: false\n",
                r"\1", values_path.read_text(encoding="utf-8"), count=1)
            self.assertEqual(1, replacements)
            values_path.write_text(legacy_values, encoding="utf-8")
            helm_apply(
                legacy_release,
                "--set", "secrets.oauthCookieSecret.existingSecret=operator-cookie",
                chart_path=legacy_chart)
            stored = json.loads(self._run([
                "helm", "get", "values", legacy_release,
                "--namespace", namespace, "-o", "json",
            ]).stdout)
            self.assertNotIn("generate", stored["secrets"]["oauthCookieSecret"])
        helm_apply(legacy_release, reuse_values=True)
        oauth_deployment = json.loads(kubectl(
            "get", "deployment",
            f"{legacy_release}-osmo-gateway-oauth2-proxy",
            "-o", "json").stdout)
        cookie_volume = next(
            volume for volume in oauth_deployment["spec"]["template"]["spec"]["volumes"]
            if volume["name"] == "oauth-cookie-secret")
        self.assertEqual(
            "operator-cookie", cookie_volume["secret"]["secretName"])

    def test_unified_generated_and_existing_secret_modes(self):
        """Install the unified chart in both supported OAuth/TLS modes."""
        suffix = secrets.token_hex(4)
        generated_namespace = f"secret-generated-{suffix}"
        existing_namespace = f"secret-existing-{suffix}"
        generated_release = f"secret-generated-{suffix}"
        existing_release = f"secret-existing-{suffix}"
        chart = self._chart_path()
        profile = os.path.join(chart, "profiles", "split-plane-control.yaml")
        external = os.path.join(chart, "tests", "control-external-values.yaml")
        osmo_namespace = os.environ.get("OSMO_NAMESPACE", "osmo")

        deployments = json.loads(self._run([
            "kubectl", "--namespace", osmo_namespace,
            "get", "deployments", "-o", "json",
        ]).stdout)["items"]
        service_images = [
            container["image"]
            for deployment in deployments
            for container in deployment["spec"]["template"]["spec"]["containers"]
            if container.get("command") == ["service"]
        ]
        self.assertEqual(1, len(service_images))
        bootstrap_image = service_images[0]

        for namespace in (generated_namespace, existing_namespace):
            self.addCleanup(
                subprocess.run,
                ["kubectl", "delete", "namespace", namespace,
                 "--ignore-not-found=true", "--wait=true", "--timeout=45s"],
                check=False, capture_output=True, text=True)
            self._run(["kubectl", "create", "namespace", namespace])

        generated_client = f"{generated_release}-oauth-client"
        self._run([
            "kubectl", "--namespace", generated_namespace,
            "create", "secret", "generic", generated_client,
            "--from-literal=client_secret=generated-mode-client",
        ])
        self._run([
            "helm", "install", generated_release, chart,
            "--namespace", generated_namespace,
            "-f", profile, "-f", external,
            "--set", "gateway.oauth2Proxy.enabled=true",
            "--set-string",
            f"secrets.oauthClientSecret.existingSecret={generated_client}",
            "--set", "secrets.oauthCookieSecret.generate=true",
            "--set-string", "secrets.oauthCookieSecret.existingSecret=",
            "--set", "gateway.tls.enabled=true",
            "--set", "gateway.tls.generated.enabled=true",
            "--set-string",
            f"gateway.tls.generated.bootstrap.image={bootstrap_image}",
            "--set", "gateway.tls.generated.bootstrap.imagePullPolicy=IfNotPresent",
            "--timeout", "5m",
        ])
        generated_status = json.loads(self._run([
            "helm", "status", generated_release,
            "--namespace", generated_namespace, "-o", "json",
        ]).stdout)
        self.assertEqual("deployed", generated_status["info"]["status"])

        generated_prefix = f"{generated_release}-osmo"
        ca_secret = json.loads(self._run([
            "kubectl", "--namespace", generated_namespace,
            "get", "secret", f"{generated_prefix}-internal-tls-ca",
            "-o", "json",
        ]).stdout)
        ca_certificate = x509.load_pem_x509_certificate(
            base64.b64decode(ca_secret["data"]["ca.crt"]))
        self.assertEqual(ca_certificate.subject, ca_certificate.issuer)
        self.assertTrue(ca_secret["data"]["ca.key"])

        trust_secret = json.loads(self._run([
            "kubectl", "--namespace", generated_namespace,
            "get", "secret", f"{generated_prefix}-internal-tls-trust",
            "-o", "json",
        ]).stdout)
        self.assertEqual(
            ca_secret["data"]["ca.crt"], trust_secret["data"]["ca.crt"])
        for component in ("api", "router", "agent", "logger"):
            leaf_secret = json.loads(self._run([
                "kubectl", "--namespace", generated_namespace,
                "get", "secret", f"{generated_prefix}-internal-tls-{component}",
                "-o", "json",
            ]).stdout)
            leaf_certificate = x509.load_pem_x509_certificate(
                base64.b64decode(leaf_secret["data"]["tls.crt"]))
            self.assertEqual(ca_certificate.subject, leaf_certificate.issuer)
            self.assertTrue(leaf_secret["data"]["tls.key"])

        generated_cookie = json.loads(self._run([
            "kubectl", "--namespace", generated_namespace,
            "get", "secret", f"{generated_prefix}-oauth-cookie", "-o", "json",
        ]).stdout)
        mounted_cookie = base64.b64decode(
            generated_cookie["data"]["cookie_secret"]).decode("ascii")
        self.assertRegex(mounted_cookie, re.compile(r"^[A-Za-z0-9_-]{43}=$"))
        self.assertEqual(32, len(base64.urlsafe_b64decode(mounted_cookie)))

        generated_api = json.loads(self._run([
            "kubectl", "--namespace", generated_namespace,
            "get", "deployment", f"{generated_prefix}-api", "-o", "json",
        ]).stdout)
        generated_api_secrets = {
            volume["secret"]["secretName"]
            for volume in generated_api["spec"]["template"]["spec"]["volumes"]
            if "secret" in volume
        }
        self.assertIn(
            f"{generated_prefix}-internal-tls-api", generated_api_secrets)
        generated_oauth = json.loads(self._run([
            "kubectl", "--namespace", generated_namespace,
            "get", "deployment", f"{generated_prefix}-gateway-oauth2-proxy",
            "-o", "json",
        ]).stdout)
        generated_oauth_secrets = {
            volume["secret"]["secretName"]
            for volume in generated_oauth["spec"]["template"]["spec"]["volumes"]
            if "secret" in volume
        }
        self.assertIn(generated_client, generated_oauth_secrets)
        self.assertIn(f"{generated_prefix}-oauth-cookie", generated_oauth_secrets)
        missing_generated_rbac = self._run([
            "kubectl", "--namespace", generated_namespace,
            "get", "rolebinding", f"{generated_prefix}-internal-tls-bootstrap",
        ], expected_success=False)
        self.assertIn("NotFound", missing_generated_rbac.stderr)

        existing_client = f"{existing_release}-oauth-client"
        existing_cookie = f"{existing_release}-oauth-cookie"
        existing_trust = f"{existing_release}-tls-trust"
        existing_leaves = {
            component: f"{existing_release}-tls-{component}"
            for component in ("api", "router", "agent", "logger")
        }
        operator_secrets = {
            existing_client: ["--from-literal=client_secret=existing-mode-client"],
            existing_cookie: [
                "--from-literal=cookie_secret="
                + base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii")
            ],
            existing_trust: ["--from-literal=ca.crt=operator-ca"],
        }
        for leaf_name in existing_leaves.values():
            operator_secrets[leaf_name] = [
                "--from-literal=tls.crt=operator-certificate",
                "--from-literal=tls.key=operator-private-key",
            ]
        before = {}
        for secret_name, literal_args in operator_secrets.items():
            self._run([
                "kubectl", "--namespace", existing_namespace,
                "create", "secret", "generic", secret_name, *literal_args,
            ])
            before[secret_name] = json.loads(self._run([
                "kubectl", "--namespace", existing_namespace,
                "get", "secret", secret_name, "-o", "json",
            ]).stdout)

        existing_command = [
            "helm", "install", existing_release, chart,
            "--namespace", existing_namespace,
            "-f", profile, "-f", external,
            "--set", "gateway.oauth2Proxy.enabled=true",
            "--set-string",
            f"secrets.oauthClientSecret.existingSecret={existing_client}",
            "--set", "secrets.oauthCookieSecret.generate=false",
            "--set-string",
            f"secrets.oauthCookieSecret.existingSecret={existing_cookie}",
            "--set", "gateway.tls.enabled=true",
            "--set", "gateway.tls.generated.enabled=false",
            "--set-string", f"gateway.tls.caSecret={existing_trust}",
        ]
        for component, secret_name in existing_leaves.items():
            existing_command.extend([
                "--set-string",
                f"gateway.tls.upstreamCerts.{component}={secret_name}",
            ])
        existing_command.extend(["--timeout", "5m"])
        self._run(existing_command)

        existing_status = json.loads(self._run([
            "helm", "status", existing_release,
            "--namespace", existing_namespace, "-o", "json",
        ]).stdout)
        self.assertEqual("deployed", existing_status["info"]["status"])
        for secret_name, original in before.items():
            observed = json.loads(self._run([
                "kubectl", "--namespace", existing_namespace,
                "get", "secret", secret_name, "-o", "json",
            ]).stdout)
            self.assertEqual(original["metadata"]["uid"], observed["metadata"]["uid"])
            self.assertEqual(original["data"], observed["data"])

        existing_prefix = f"{existing_release}-osmo"
        existing_api = json.loads(self._run([
            "kubectl", "--namespace", existing_namespace,
            "get", "deployment", f"{existing_prefix}-api", "-o", "json",
        ]).stdout)
        existing_api_secrets = {
            volume["secret"]["secretName"]
            for volume in existing_api["spec"]["template"]["spec"]["volumes"]
            if "secret" in volume
        }
        self.assertIn(existing_leaves["api"], existing_api_secrets)
        existing_envoy = json.loads(self._run([
            "kubectl", "--namespace", existing_namespace,
            "get", "deployment", f"{existing_prefix}-gateway-envoy", "-o", "json",
        ]).stdout)
        existing_envoy_secrets = {
            volume["secret"]["secretName"]
            for volume in existing_envoy["spec"]["template"]["spec"]["volumes"]
            if "secret" in volume
        }
        self.assertIn(existing_trust, existing_envoy_secrets)
        unexpected_ca = self._run([
            "kubectl", "--namespace", existing_namespace,
            "get", "secret", f"{existing_prefix}-internal-tls-ca",
        ], expected_success=False)
        self.assertIn("NotFound", unexpected_ca.stderr)


if __name__ == "__main__":
    unittest.main()
