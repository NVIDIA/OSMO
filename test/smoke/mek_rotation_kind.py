"""KIND coverage for Kubernetes-only MEK rotation."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
# SPDX-License-Identifier: Apache-2.0

import base64
import json
import os
import secrets
import subprocess
import time
import unittest

import yaml

from test.oetf.smoke_fixture import SmokeFixture


class MekRotationKind(SmokeFixture):
    """Exercise real Helm phase changes and prove no MEK database state exists."""

    namespace = os.environ.get("OSMO_NAMESPACE", "osmo")
    release = os.environ.get("OSMO_HELM_RELEASE", "osmo")
    timeout_seconds = 600

    def _kubectl(self, *args, input_text=None):
        command = ["kubectl", "--namespace", self.namespace, *args]
        result = subprocess.run(
            command, input=input_text, check=False, capture_output=True, text=True)
        if result.returncode:
            command_text = " ".join(command)
            raise RuntimeError(
                f"{command_text} failed with exit code {result.returncode}: "
                f"{result.stderr.strip()}")
        return result.stdout

    def _json(self, *args):
        return json.loads(self._kubectl(*args, "-o", "json"))

    def _wait(self, description, predicate, timeout_seconds=None):
        deadline = time.monotonic() + (timeout_seconds or self.timeout_seconds)
        while time.monotonic() < deadline:
            value = predicate()
            if value is not None:
                return value
            time.sleep(2)
        self.fail(f"timed out waiting for {description}")

    @staticmethod
    def _run_checked(command, expected_success=True, timeout=900):
        result = subprocess.run(
            command, check=False, capture_output=True, text=True, timeout=timeout)
        if (result.returncode == 0) != expected_success:
            command_text = " ".join(command)
            raise RuntimeError(
                f"{command_text} exited {result.returncode}: {result.stderr.strip()}")
        return result

    @staticmethod
    def _split_image(image):
        repository, tag = image.rsplit(":", maxsplit=1)
        location, image_name = repository.rsplit("/", maxsplit=1)
        return location, image_name, tag

    def _postgres_scalar(self, query, variables=None):
        command = [
            "exec", "-i", "deployment/postgres", "--", "psql",
            "--username=postgres", "--dbname=osmo", "--tuples-only", "--no-align",
            "--set", "ON_ERROR_STOP=1",
        ]
        for name, value in (variables or {}).items():
            command.extend(["--set", f"{name}={value}"])
        return self._kubectl(*command, input_text=f"{query}\n").strip()

    @staticmethod
    def _service_chart_path():
        return os.path.join(
            os.environ["TEST_SRCDIR"], os.environ["TEST_WORKSPACE"],
            "deployments", "charts", "service")

    @staticmethod
    def _quick_start_chart_path():
        chart = os.environ.get("OETF_HELM_CHART_PATH", "")
        if not os.path.isfile(os.path.join(chart, "Chart.yaml")):
            raise RuntimeError(
                "OETF_HELM_CHART_PATH does not identify the quick-start chart "
                "used to install this KIND release")
        return chart

    def _helm_sync(self, *values):
        phase_prefix = "services.masterEncryptionKey.rotation.phase="
        phase = next(
            (value[len(phase_prefix):] for value in values
             if value.startswith(phase_prefix)), "")
        existing_jobs = {
            job["metadata"]["uid"]
            for job in self._json(
                "get", "jobs", "-l",
                "app.kubernetes.io/component=mek-lifecycle")["items"]
        }
        command = [
            "helm", "upgrade", self.release, self._quick_start_chart_path(),
            "--namespace", self.namespace, "--reuse-values", "--wait",
            "--timeout", "10m",
            "--set", "service.services.masterEncryptionKey.bootstrap.enabled=false",
            # The quick-start bucket initializer is unrelated to MEK and has
            # a 30-second TTL. Leaving it in a wait-for-jobs phase upgrade
            # races Helm's waiter against the TTL controller and produces a
            # spurious `Job not found` after successful bucket creation.
            "--set-json", "service.services.localstackS3.buckets=[]",
        ]
        for value in values:
            command.extend(["--set-string", f"service.{value}"])
        result = subprocess.run(
            command, check=False, capture_output=True, text=True, timeout=900)
        if result.returncode:
            command_text = " ".join(command)
            raise RuntimeError(
                f"{command_text} exited {result.returncode}: {result.stderr.strip()}")
        if not phase:
            return

        def lifecycle_job_complete():
            jobs = [
                job for job in self._json(
                    "get", "jobs", "-l",
                    "app.kubernetes.io/component=mek-lifecycle")["items"]
                if job["metadata"]["uid"] not in existing_jobs
            ]
            if len(jobs) > 1:
                raise RuntimeError(
                    f"MEK phase {phase} created an unexpected Job cohort")
            if not jobs:
                return None
            job = jobs[0]
            status = job.get("status", {})
            if status.get("failed"):
                name = job["metadata"]["name"]
                logs = self._kubectl("logs", f"job/{name}")
                raise RuntimeError(
                    f"MEK phase {phase} Job {name} failed: {logs.strip()}")
            return job if status.get("succeeded") else None

        self._wait(
            f"MEK {phase} Job completion", lifecycle_job_complete,
            timeout_seconds=660)

    @staticmethod
    def _jwe_kid(value):
        protected = value.split(".", maxsplit=1)[0]
        protected += "=" * (-len(protected) % 4)
        return json.loads(base64.urlsafe_b64decode(protected))["kid"]

    def _api_deployment(self):
        matches = [
            deployment for deployment in self._json("get", "deployments")["items"]
            if any(
                container.get("command") == ["service"]
                for container in deployment["spec"]["template"]["spec"]["containers"]
            )
        ]
        self.assertEqual(1, len(matches))
        return matches[0]

    def _mek_secret_contract(self):
        deployment = self._api_deployment()
        volume = next(
            volume["secret"]
            for volume in deployment["spec"]["template"]["spec"]["volumes"]
            if volume["name"] == "mek-volume")
        return volume["secretName"], volume["items"][0]["key"]

    def _keyring(self, name, key):
        secret = self._json("get", "secret", name)
        return yaml.safe_load(base64.b64decode(secret["data"][key]))

    def _credential_uek_mek(self, credential_name):
        value = self._postgres_scalar(
            "SELECT u.keys -> (u.keys -> 'current') "
            "FROM ueks u JOIN credential c ON c.user_name = u.uid "
            "WHERE c.cred_name = :'credential_name' LIMIT 1;",
            {"credential_name": credential_name})
        return self._jwe_kid(value) if value else None

    def _workflow_alerts_raw(self):
        return self._postgres_scalar(
            "SELECT value FROM configs "
            "WHERE key = 'workflow_alerts' AND type = 'WORKFLOW';")

    def _workflow_alerts_mek(self):
        raw = self._workflow_alerts_raw()
        token = json.loads(raw).get("slack_token", "") if raw else ""
        return self._jwe_kid(token) if token else None

    def _restore_workflow_alerts(self, raw):
        encoded = base64.b64encode(raw.encode()).decode()
        self._kubectl(
            "exec", "-i", "deployment/postgres", "--", "psql",
            "--username=postgres", "--dbname=osmo", "--set", "ON_ERROR_STOP=1",
            input_text=(
                "UPDATE configs SET value = "
                f"convert_from(decode('{encoded}', 'base64'), 'UTF8') "
                "WHERE key = 'workflow_alerts' AND type = 'WORKFLOW';\n"))

    def _delete_credential(self, name):
        self.http("DELETE", f"/api/credentials/{name}").expect_ok()

    def test_prepare_activate_rollouts_and_rewrap(self):
        secret_name, secret_key = self._mek_secret_contract()
        initial = self._keyring(secret_name, secret_key)
        old_key = initial["currentMek"]
        request = f"kind-{secrets.token_hex(6)}"
        credential = f"kind-mek-{secrets.token_hex(6)}"

        self.http("POST", f"/api/credentials/{credential}").payload({
            "generic_credential": {"credential": {"rotation_probe": "present"}}
        }).expect_ok()
        self.addCleanup(self._delete_credential, credential)
        original_alerts = self._workflow_alerts_raw()
        self.assertTrue(original_alerts)
        self.addCleanup(self._restore_workflow_alerts, original_alerts)
        self.http("PATCH", "/api/configs/workflow").payload({
            "configs_dict": {"workflow_alerts": {
                "slack_token": f"kind-direct-{secrets.token_hex(12)}"}},
            "description": "MEK rotation direct-config seed",
        }).expect_ok()
        self.assertEqual(old_key, self._credential_uek_mek(credential))
        self.assertEqual(old_key, self._workflow_alerts_mek())

        self.assertEqual("", self._postgres_scalar(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' "
            "AND tablename LIKE 'mek_%' ORDER BY tablename;"))
        self.assertEqual("", self._postgres_scalar(
            "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal "
            "AND tgname LIKE '%mek%';"))

        self._helm_sync(
            f"services.masterEncryptionKey.rotation.requestId={request}",
            "services.masterEncryptionKey.rotation.phase=prepare")
        prepared = self._keyring(secret_name, secret_key)
        self.assertEqual(old_key, prepared["currentMek"])
        self.assertEqual(len(initial["meks"]) + 1, len(prepared["meks"]))
        new_key = next(iter(set(prepared["meks"]) - set(initial["meks"])))

        self._helm_sync(
            f"services.masterEncryptionKey.rotation.requestId={request}",
            "services.masterEncryptionKey.rotation.phase=",
            f"services.masterEncryptionKey.rotation.rolloutRevision={request}-prepare")
        self._helm_sync(
            f"services.masterEncryptionKey.rotation.requestId={request}",
            "services.masterEncryptionKey.rotation.phase=activate",
            f"services.masterEncryptionKey.rotation.rolloutRevision={request}-prepare")
        activated = self._keyring(secret_name, secret_key)
        self.assertEqual(new_key, activated["currentMek"])
        self.assertIn(old_key, activated["meks"])

        self._helm_sync(
            f"services.masterEncryptionKey.rotation.requestId={request}",
            "services.masterEncryptionKey.rotation.phase=",
            f"services.masterEncryptionKey.rotation.rolloutRevision={request}-activate")
        self._helm_sync(
            f"services.masterEncryptionKey.rotation.requestId={request}",
            "services.masterEncryptionKey.rotation.phase=rewrap",
            f"services.masterEncryptionKey.rotation.rolloutRevision={request}-activate")
        self.assertEqual(new_key, self._credential_uek_mek(credential))
        self.assertEqual(new_key, self._workflow_alerts_mek())

        self._helm_sync(
            f"services.masterEncryptionKey.rotation.requestId={request}",
            "services.masterEncryptionKey.rotation.phase=",
            f"services.masterEncryptionKey.rotation.rolloutRevision={request}-activate")
        lifecycle_bindings = [
            item for item in self._json("get", "rolebindings")["items"]
            if item.get("metadata", {}).get("labels", {}).get(
                "app.kubernetes.io/instance") == self.release
            and "-mek-" in item.get("metadata", {}).get("name", "")
        ]
        self.assertEqual(lifecycle_bindings, [])
        for deployment in self._json("get", "deployments")["items"]:
            containers = deployment["spec"]["template"]["spec"].get("containers", [])
            if any("--mek_file" in container.get("args", []) for container in containers):
                self.assertEqual(
                    "osmo", deployment["spec"]["template"]["metadata"]["labels"].get(
                        "app.kubernetes.io/part-of"))

    def test_fresh_bootstrap_failed_install_upgrade_and_reinstall_preserve_secret(self):
        """Exercise create-only bootstrap and Helm retry ownership in a fresh namespace."""
        suffix = secrets.token_hex(4)
        namespace = f"mek-bootstrap-{suffix}"
        release = f"mek-bootstrap-{suffix}"
        secret_name = f"{release}-mek"
        database_name = f"mek_bootstrap_{suffix}"
        deployment = self._api_deployment()
        service_container = next(
            container for container in deployment["spec"]["template"]["spec"]["containers"]
            if container.get("command") == ["service"])
        image_location, image_name, image_tag = self._split_image(
            service_container["image"])
        chart = self._service_chart_path()
        quick_start = os.path.join(chart, "quick-start-values.yaml")
        common = [
            "-f", quick_start,
            "--set", f"global.osmoImageLocation={image_location}",
            "--set", f"global.osmoImageTag={image_tag}",
            "--set", f"services.service.imageName={image_name}",
            "--set", f"services.masterEncryptionKey.existingSecret.name={secret_name}",
            "--set", "services.masterEncryptionKey.bootstrap.activeDeadlineSeconds=300",
            # The main KIND release already owns quick-start's fixed,
            # cluster-scoped localstack PV. This isolated lifecycle release
            # does not need object storage and must not collide with it before
            # Helm creates the namespaced bootstrap resources under test.
            "--set", "services.localstackS3.enabled=false",
            # Use a fresh database on the already-ready KIND PostgreSQL. The
            # primary quick-start release exercises embedded bootstrap; this
            # isolated release exercises the external-PostgreSQL Helm
            # failure/retry path without adding a competing stateful pod.
            "--set", "services.postgres.enabled=false",
            "--set", f"services.postgres.db={database_name}",
            # NodePorts are cluster-wide. The main quick-start release owns
            # Redis's development NodePort already; the isolated lifecycle
            # release only needs its namespaced ClusterIP Redis service.
            "--set", "services.redis.enableNodePort=false",
            # This test exercises the MEK lifecycle only. Removing the
            # independent pre-install token hook makes any failed install
            # unambiguously attributable to the intended missing UI image or
            # to the normal MEK resources under test.
            "--set", "services.backendApiTokens.enabled=false",
            "--set", "services.defaultAdmin.enabled=false",
            "--set", "gateway.envoy.service.type=ClusterIP",
            "--set", "gateway.envoy.service.nodePort=null",
        ]

        def kubectl_in(*args, input_text=None):
            result = subprocess.run(
                ["kubectl", "--namespace", namespace, *args], input=input_text,
                check=False, capture_output=True, text=True)
            return result

        def secret_json():
            result = kubectl_in("get", "secret", secret_name, "-o", "json")
            return json.loads(result.stdout) if result.returncode == 0 else None

        failed_install = None

        def secret_or_bootstrap_failure():
            secret = secret_json()
            if secret is not None:
                return secret
            jobs_result = kubectl_in(
                "get", "jobs", "-l", "app.kubernetes.io/component=mek-lifecycle",
                "-o", "json")
            if jobs_result.returncode:
                raise RuntimeError(
                    f"could not inspect MEK bootstrap Jobs: {jobs_result.stderr.strip()}")
            jobs = json.loads(jobs_result.stdout)["items"]
            if not jobs:
                detail = failed_install.stderr.strip() if failed_install else ""
                raise RuntimeError(
                    "failed Helm install did not create the MEK bootstrap Job: " + detail)
            job = jobs[0]
            status = job.get("status", {})
            if status.get("failed"):
                name = job["metadata"]["name"]
                logs = kubectl_in("logs", f"job/{name}")
                pods = kubectl_in(
                    "get", "pods", "-l", f"job-name={name}", "-o", "json")
                events = kubectl_in(
                    "get", "events", "--sort-by=.lastTimestamp")
                pod_statuses = []
                if pods.returncode == 0:
                    for pod in json.loads(pods.stdout)["items"]:
                        pod_statuses.append({
                            "name": pod["metadata"]["name"],
                            "phase": pod.get("status", {}).get("phase"),
                            "reason": pod.get("status", {}).get("reason"),
                            "message": pod.get("status", {}).get("message"),
                            "containerStatuses": pod.get("status", {}).get(
                                "containerStatuses", []),
                        })
                raise RuntimeError(
                    f"MEK bootstrap Job {name} failed: "
                    f"logs={logs.stdout.strip()} {logs.stderr.strip()}; "
                    f"pod_statuses={pod_statuses!r} {pods.stderr.strip()}; "
                    f"events={events.stdout.strip()} {events.stderr.strip()}")
            return None

        self.addCleanup(
            self._kubectl,
            "exec", "deployment/postgres", "--", "psql",
            "--username=postgres", "--dbname=postgres", "--set", "ON_ERROR_STOP=1",
            "--command", f'DROP DATABASE IF EXISTS "{database_name}" WITH (FORCE);')
        self.addCleanup(
            subprocess.run,
            ["kubectl", "delete", "namespace", namespace, "--ignore-not-found=true"],
            check=False, capture_output=True, text=True)
        self._run_checked([
            "kubectl", "create", "namespace", namespace,
        ])
        self._kubectl(
            "exec", "deployment/postgres", "--", "psql",
            "--username=postgres", "--dbname=postgres", "--set", "ON_ERROR_STOP=1",
            "--command", f'CREATE DATABASE "{database_name}";')
        postgres_service = {
            "apiVersion": "v1",
            "kind": "Service",
            "metadata": {"name": "postgres", "namespace": namespace},
            "spec": {
                "type": "ExternalName",
                "externalName": f"postgres.{self.namespace}.svc.cluster.local",
            },
        }
        service_result = kubectl_in(
            "apply", "-f", "-", input_text=yaml.safe_dump(postgres_service))
        if service_result.returncode:
            self.fail(service_result.stderr)
        failed = [
            "helm", "install", release, chart, "--namespace", namespace,
            "--wait", "--wait-for-jobs", "--timeout", "90s",
            *common, "--set", "services.ui.imageName=definitely-missing",
        ]
        failed_install = self._run_checked(
            failed, expected_success=False, timeout=180)
        first = self._wait(
            "create-only bootstrap Secret", secret_or_bootstrap_failure,
            timeout_seconds=330)
        first_uid = first["metadata"]["uid"]
        first_data = first["data"]["mek.yaml"]
        manifest = self._run_checked([
            "helm", "get", "manifest", release, "--namespace", namespace,
        ]).stdout
        manifest_resources = [resource for resource in yaml.safe_load_all(manifest) if resource]
        self.assertFalse(any(
            resource.get("kind") == "Secret"
            and resource.get("metadata", {}).get("name") == secret_name
            for resource in manifest_resources))
        self.assertFalse(any(
            resource.get("kind") == "Lease" for resource in manifest_resources))

        self._run_checked([
            "helm", "upgrade", release, chart, "--namespace", namespace,
            "--reuse-values", "--wait", "--wait-for-jobs", "--timeout", "10m",
            "--set", "services.ui.imageName=web-ui",
            "--set", "services.masterEncryptionKey.bootstrap.activeDeadlineSeconds=899",
            "--set-string", "services.masterEncryptionKey.bootstrap.attempt=2",
        ])
        after_upgrade = secret_json()
        self.assertEqual(first_uid, after_upgrade["metadata"]["uid"])
        self.assertEqual(first_data, after_upgrade["data"]["mek.yaml"])

        self._run_checked([
            "helm", "upgrade", release, chart, "--namespace", namespace,
            "--reuse-values", "--wait", "--timeout", "10m",
            "--set", "services.masterEncryptionKey.bootstrap.enabled=false",
        ])
        lifecycle_bindings = kubectl_in(
            "get", "rolebindings", "-l",
            f"app.kubernetes.io/instance={release},app.kubernetes.io/component=mek-lifecycle",
            "-o", "json")
        self.assertEqual(0, len(json.loads(lifecycle_bindings.stdout)["items"]))
        after_disable = secret_json()
        self.assertEqual(first_uid, after_disable["metadata"]["uid"])
        self.assertEqual(first_data, after_disable["data"]["mek.yaml"])

        self._run_checked(["helm", "uninstall", release, "--namespace", namespace])
        after_uninstall = secret_json()
        self.assertEqual(first_uid, after_uninstall["metadata"]["uid"])
        self.assertEqual(first_data, after_uninstall["data"]["mek.yaml"])
        self._run_checked([
            "helm", "install", release, chart, "--namespace", namespace,
            "--wait", "--wait-for-jobs", "--timeout", "10m", *common,
        ])
        after_reinstall = secret_json()
        self.assertEqual(first_uid, after_reinstall["metadata"]["uid"])
        self.assertEqual(first_data, after_reinstall["data"]["mek.yaml"])


if __name__ == "__main__":
    unittest.main()
