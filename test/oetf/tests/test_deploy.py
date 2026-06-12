"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Unit tests for oetf.deploy.base + oetf.deploy.kind_adapter + oetf.breadcrumb.

import dataclasses
import json
import os
import tempfile
import unittest
import unittest.mock
from typing import List

from test.oetf import breadcrumb, local_images, teardown_main
from test.oetf.deploy_adapters import factory
from test.oetf.deploy_adapters.base import (
    DeployParams,
    DeploySession,
)
from test.oetf.deploy_adapters.kind_adapter import KindAdapter, check_kind_prereqs
from test.oetf.deploy_adapters.noop_adapter import NoopAdapter
from test.oetf.models import DeployMode, EnvironmentAuth, EnvironmentConfig


@dataclasses.dataclass
class _FakeAdapter:
    """Records method call order for DeploySession tests."""
    calls: List[str] = dataclasses.field(default_factory=list)
    deploy_raises: Exception | None = None
    configure_raises: Exception | None = None
    teardown_raises: Exception | None = None

    def pre_deploy_check(self, params: DeployParams) -> None:
        del params

    def deploy(self, params: DeployParams) -> EnvironmentConfig:
        self.calls.append("deploy")
        if self.deploy_raises is not None:
            raise self.deploy_raises
        return EnvironmentConfig(
            name=params.env_name or "fake",
            url="http://fake",
            auth=EnvironmentAuth(strategy="dev", username="testuser"),
        )

    def configure(self, env: EnvironmentConfig) -> None:
        del env
        self.calls.append("configure")
        if self.configure_raises is not None:
            raise self.configure_raises

    def teardown(self, params: DeployParams) -> None:
        del params
        self.calls.append("teardown")
        if self.teardown_raises is not None:
            raise self.teardown_raises


class _FakeCompleted:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = ""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class TestDeploySession(unittest.TestCase):
    """Lifecycle + cleanup behavior."""

    def test_happy_path_calls_deploy_then_configure(self):
        adapter = _FakeAdapter()
        session = DeploySession(adapter, DeployParams(type="custom"))
        env = session.start()
        self.assertEqual(adapter.calls, ["deploy", "configure"])
        self.assertEqual(env.url, "http://fake")

    def test_deploy_failure_triggers_teardown(self):
        adapter = _FakeAdapter(deploy_raises=RuntimeError("boom"))
        session = DeploySession(adapter, DeployParams(type="custom"))
        with self.assertRaises(RuntimeError):
            session.start()
        self.assertEqual(adapter.calls, ["deploy", "teardown"])

    def test_configure_failure_triggers_teardown(self):
        adapter = _FakeAdapter(configure_raises=RuntimeError("boom"))
        session = DeploySession(adapter, DeployParams(type="custom"))
        with self.assertRaises(RuntimeError):
            session.start()
        self.assertEqual(adapter.calls, ["deploy", "configure", "teardown"])

    def test_keep_on_failure_skips_rollback(self):
        adapter = _FakeAdapter(deploy_raises=RuntimeError("boom"))
        session = DeploySession(
            adapter, DeployParams(type="custom"), keep_on_failure=True,
        )
        with self.assertRaises(RuntimeError):
            session.start()
        self.assertEqual(adapter.calls, ["deploy"])

    def test_teardown_error_during_rollback_is_swallowed(self):
        adapter = _FakeAdapter(
            deploy_raises=RuntimeError("boom"),
            teardown_raises=RuntimeError("teardown too"),
        )
        session = DeploySession(adapter, DeployParams(type="custom"))
        with self.assertRaises(RuntimeError) as ctx:
            session.start()
        self.assertIn("boom", str(ctx.exception))
        self.assertEqual(adapter.calls, ["deploy", "teardown"])

    def test_context_manager_cleanup_on_exit(self):
        adapter = _FakeAdapter()
        with DeploySession(
            adapter, DeployParams(type="custom"), cleanup_on_exit=True,
        ):
            pass
        self.assertEqual(adapter.calls, ["deploy", "configure", "teardown"])

    def test_context_manager_no_cleanup_when_cleanup_on_exit_false(self):
        adapter = _FakeAdapter()
        with DeploySession(
            adapter, DeployParams(type="custom"), cleanup_on_exit=False,
        ):
            pass
        self.assertEqual(adapter.calls, ["deploy", "configure"])

    def test_test_phase_exception_does_not_trigger_cleanup_if_cleanup_on_exit_false(self):
        adapter = _FakeAdapter()
        session = DeploySession(adapter, DeployParams(type="custom"))
        session.start()
        # Simulate tests — no exception path through __exit__ since we used .start().
        self.assertEqual(adapter.calls, ["deploy", "configure"])


class _FakeHealthResponse:
    """Minimal urlopen-compatible response for _wait_for_health tests."""

    def __init__(self, status: int):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _always_ok_opener(*_args, **_kwargs):
    return _FakeHealthResponse(200)


class TestKindAdapter(unittest.TestCase):
    """KindAdapter drives kind + helm with correct flags via osmo/quick-start."""

    def _adapter(
        self,
        calls: List[List[str]] | None = None,
        capture_stdouts: List[str] | None = None,
        returncodes: List[int] | None = None,
        mode: DeployMode = "cpu",
        build_local: bool = False,
    ):
        """Build a KindAdapter with a fake subprocess runner.

        ``capture_stdouts`` supplies stdout for ``_run_capture`` calls in order
        (e.g. ``kind get clusters`` then ``helm repo list``). ``returncodes``
        overrides exit codes per call.
        """
        if calls is None:
            calls = []
        capture_stdouts = list(capture_stdouts or [])
        returncodes = list(returncodes or [])
        idx = [0]
        capture_idx = [0]

        def fake_run(args, capture_output=False, **_kwargs):
            calls.append(args)
            i = idx[0]
            idx[0] += 1
            code = returncodes[i] if i < len(returncodes) else 0
            stdout = ""
            if capture_output and capture_idx[0] < len(capture_stdouts):
                stdout = capture_stdouts[capture_idx[0]]
                capture_idx[0] += 1
            return _FakeCompleted(returncode=code, stdout=stdout)

        return KindAdapter(
            image_tag="ci-123",
            subprocess_runner=fake_run,
            url_opener=_always_ok_opener,
            mode=mode,
            build_local=build_local,
        ), calls

    def test_deploy_creates_cluster_then_helm_installs(self):
        adapter, calls = self._adapter(capture_stdouts=["", "", ""])
        env = adapter.deploy(DeployParams(type="kind", env_name="kind"))

        by_prefix = [tuple(call[:3]) for call in calls]
        # Public CPU path: kind get + kind create + kai-scheduler install +
        # kubectl wait + helm repo add + osmo upgrade + kubectl wait.
        self.assertIn(("kind", "get", "clusters"), by_prefix)
        self.assertIn(("kind", "create", "cluster"), by_prefix)
        self.assertIn(("helm", "list", "-n"), by_prefix)
        kai_calls = [c for c in calls if "kai-scheduler" in c and c[1] == "upgrade"]
        self.assertTrue(kai_calls, msg="kai-scheduler install missing")
        self.assertTrue(
            any("global.nodeSelector.node_group=kai-scheduler" in c for c in kai_calls),
            msg="kai-scheduler pin to node_group=kai-scheduler missing",
        )
        osmo_calls = [c for c in calls if "osmo/quick-start" in c]
        self.assertTrue(osmo_calls, msg="osmo/quick-start install missing")
        self.assertIn("global.osmoImageTag=ci-123", osmo_calls[0])
        # One remap only: ingress-nginx → node_group=service (public config
        # has no node_group=ingress worker; chart 1.2.1 expects ingress pool).
        self.assertIn(
            "ingress-nginx.controller.nodeSelector.node_group=service",
            osmo_calls[0],
        )
        # Sub-charts should NOT be remapped — our 6-node config has the
        # native data/compute/etc labels. Only ingress-nginx needs overriding.
        for arg in osmo_calls[0]:
            for sub in ("postgres.nodeSelector", "redis.nodeSelector",
                        "localstackS3.nodeSelector"):
                self.assertNotIn(
                    sub, arg,
                    msg=f"{sub} should not be remapped on multi-node CPU path",
                )
        self.assertEqual(env.auth.strategy, "dev")

    def test_deploy_reuses_existing_cluster(self):
        # kind get clusters returns 'osmo' → no create call
        adapter, calls = self._adapter(capture_stdouts=["osmo\n", "", ""])
        adapter.deploy(DeployParams(type="kind", env_name="kind", cluster_name="osmo"))
        # First call = kind get clusters; there must NOT be a kind create call.
        self.assertEqual(calls[0][:3], ["kind", "get", "clusters"])
        create_calls = [c for c in calls if c[:3] == ["kind", "create", "cluster"]]
        self.assertEqual(create_calls, [])

    def test_fresh_forces_delete_first(self):
        adapter, calls = self._adapter(capture_stdouts=["", "", ""])
        adapter.deploy(DeployParams(type="kind", env_name="kind", fresh=True))
        # First call should be kind delete
        self.assertEqual(calls[0][:4], ["kind", "delete", "cluster", "--name"])

    def test_helm_repo_add_skipped_when_already_present(self):
        existing_repos = '[{"name":"osmo","url":"https://helm.ngc.nvidia.com/nvidia/osmo"}]'
        # Captures: kind get, helm list kai, helm repo list (osmo present).
        adapter, calls = self._adapter(capture_stdouts=["", "", existing_repos])
        adapter.deploy(DeployParams(type="kind", env_name="kind"))
        repo_add_calls = [c for c in calls if c[:3] == ["helm", "repo", "add"]]
        self.assertEqual(repo_add_calls, [],
                         msg="helm repo add should be skipped when already present")

    def test_kai_scheduler_install_skipped_when_already_present(self):
        existing_kai = '[{"name":"kai-scheduler","namespace":"kai-scheduler"}]'
        # Captures: kind get, helm list kai (found), helm repo list (osmo).
        adapter, calls = self._adapter(capture_stdouts=["", existing_kai, ""])
        adapter.deploy(DeployParams(type="kind", env_name="kind"))
        kai_installs = [
            c for c in calls
            if c[:2] == ["helm", "upgrade"] and "kai-scheduler" in c
        ]
        self.assertEqual(kai_installs, [],
                         msg="kai-scheduler upgrade should be skipped when already present")

    def test_metrics_server_installed_when_requested(self):
        """--with-metrics-server opts into metrics-server install."""
        calls: List[List[str]] = []

        def fake_run(args, **_kwargs):
            calls.append(list(args))
            return _FakeCompleted(returncode=0, stdout="")

        adapter = KindAdapter(
            subprocess_runner=fake_run,
            url_opener=_always_ok_opener,
            install_metrics_server=True,
        )
        adapter.deploy(DeployParams(type="kind", env_name="kind"))
        metrics_installs = [
            c for c in calls
            if c[:2] == ["helm", "upgrade"] and "metrics-server" in c
        ]
        self.assertEqual(len(metrics_installs), 1,
                         msg="metrics-server should be installed with the flag")

    def test_metrics_server_not_installed_by_default(self):
        """Default behavior skips metrics-server."""
        adapter, calls = self._adapter(capture_stdouts=["", "", ""])
        adapter.deploy(DeployParams(type="kind", env_name="kind"))
        metrics_installs = [
            c for c in calls
            if c[:2] == ["helm", "upgrade"] and "metrics-server" in c
        ]
        self.assertEqual(metrics_installs, [],
                         msg="metrics-server should be skipped by default")

    def test_gpu_mode_raises_not_implemented(self):
        """GPU mode is a placeholder for the future nvkind + gpu-operator path."""
        adapter = KindAdapter(mode="gpu")
        with self.assertRaises(NotImplementedError) as ctx:
            adapter.deploy(DeployParams(type="kind", env_name="kind"))
        self.assertIn("nvkind", str(ctx.exception))

    def test_invalid_mode_raises(self):
        adapter = KindAdapter(mode="xpu")  # type: ignore[arg-type]
        with self.assertRaises(ValueError):
            adapter.deploy(DeployParams(type="kind", env_name="kind"))

    def test_configure_is_noop(self):
        """With the public multi-node KIND config, configure() is a no-op."""
        calls: List[List[str]] = []

        def runner(args, **_kw):
            calls.append(args)
            return _FakeCompleted()

        adapter = KindAdapter(subprocess_runner=runner)
        env = EnvironmentConfig(
            name="kind", url="http://quick-start.osmo",
            auth=EnvironmentAuth(strategy="dev", username="testuser"),
        )
        adapter.configure(env)
        self.assertEqual(calls, [])

    def test_deploy_raises_on_helm_failure(self):
        # 10 calls in CPU multi-node happy path (no fresh, no existing
        # repos/kai/metrics):
        #   1 kind get, 2 kind create, 3 helm list kai, 4 helm upgrade kai,
        #   5 kubectl wait kai, 6 helm repo list, 7 helm repo add,
        #   8 helm repo update, 9 helm upgrade osmo, 10 kubectl wait osmo.
        # Make helm upgrade osmo (call 9, index 8) fail.
        adapter, _ = self._adapter(
            capture_stdouts=["", "", ""],
            returncodes=[0] * 8 + [1],
        )
        with self.assertRaises(RuntimeError):
            adapter.deploy(DeployParams(type="kind", env_name="kind"))

    def test_teardown_is_idempotent_on_missing_cluster(self):
        calls: List[List[str]] = []

        def runner(args, **_kw):
            calls.append(args)
            return _FakeCompleted(returncode=1)

        # kind delete returns nonzero when cluster missing, but we swallow it
        adapter = KindAdapter(subprocess_runner=runner)
        adapter.teardown(DeployParams(type="kind", cluster_name="missing"))
        self.assertEqual(len(calls), 1)
        self.assertIn("delete", calls[0])

    def test_wait_for_health_retries_until_stable(self):
        """_wait_for_health recovers from transient 5xx / RemoteDisconnected."""
        statuses = [503, 500, 200, 200, 200]
        idx = [0]

        def flaky_opener(*_a, **_kw):
            i = idx[0]
            idx[0] += 1
            code = statuses[i] if i < len(statuses) else 200
            return _FakeHealthResponse(code)

        adapter = KindAdapter(
            subprocess_runner=lambda *_a, **_kw: _FakeCompleted(),
            url_opener=flaky_opener,
        )
        adapter._wait_for_health(  # pylint: disable=protected-access
            "http://kind.test", timeout_seconds=30, required_consecutive_ok=3,
        )
        # Expect 5 attempts: 503, 500, then 3 consecutive 200s
        self.assertEqual(idx[0], 5)

    def test_wait_for_health_raises_on_timeout(self):
        """_wait_for_health gives up with a clear error when health never stabilizes."""

        def always_error(*_a, **_kw):
            raise OSError("connection refused")

        adapter = KindAdapter(
            subprocess_runner=lambda *_a, **_kw: _FakeCompleted(),
            url_opener=always_error,
        )
        with self.assertRaises(RuntimeError) as ctx:
            adapter._wait_for_health(  # pylint: disable=protected-access
                "http://kind.test", timeout_seconds=1, required_consecutive_ok=3,
            )
        self.assertIn("did not stabilize", str(ctx.exception))

    def test_redeploy_with_build_local_rollout_restarts_osmo(self):
        """Cluster pre-exists + build_local=True → rollout restart fires."""
        adapter, calls = self._adapter(
            mode="cpu",
            build_local=True,
            capture_stdouts=["osmo"],  # `kind get clusters` says cluster already exists
        )
        adapter.deploy(DeployParams(type="kind", env_name="kind"))
        cmds = [tuple(c) for c in calls]
        self.assertIn(
            ("kubectl", "rollout", "restart", "deployment", "-n", "osmo"),
            cmds,
            f"expected rollout restart on re-deploy, got: {cmds}",
        )
        self.assertIn(
            ("kubectl", "rollout", "status", "deployment",
             "-n", "osmo", "--timeout=10m"),
            cmds,
        )
        # Build-local helm overrides include UI's pull policy (UI now built locally).
        helm_args_concat = " ".join(
            arg for cmd in cmds for arg in cmd
            if isinstance(arg, str) and arg.startswith("web-ui.")
        )
        self.assertIn(
            "web-ui.services.ui.imagePullPolicy=IfNotPresent",
            helm_args_concat,
            f"expected web-ui pull policy override, got: {helm_args_concat}",
        )
        self.assertNotIn(
            "web-ui.services.ui.replicas=0",
            helm_args_concat,
            "build-local should NO LONGER scale UI to 0; we build it locally now",
        )

    def test_first_deploy_with_build_local_does_not_rollout_restart(self):
        """Cluster does NOT pre-exist → no rollout restart (helm install just made fresh pods)."""
        adapter, calls = self._adapter(
            mode="cpu",
            build_local=True,
            capture_stdouts=[""],  # `kind get clusters` returns empty: cluster missing
        )
        adapter.deploy(DeployParams(type="kind", env_name="kind"))
        rollout_calls = [c for c in calls if c[:3] == ["kubectl", "rollout", "restart"]]
        self.assertEqual(
            rollout_calls, [],
            f"expected no rollout restart on first deploy, got: {rollout_calls}",
        )

    def test_redeploy_without_build_local_does_not_rollout_restart(self):
        """Cluster pre-exists but build_local=False → no rollout restart (chart-default deploy)."""
        adapter, calls = self._adapter(
            mode="cpu",
            build_local=False,
            capture_stdouts=["osmo"],
        )
        adapter.deploy(DeployParams(type="kind", env_name="kind"))
        rollout_calls = [c for c in calls if c[:3] == ["kubectl", "rollout", "restart"]]
        self.assertEqual(
            rollout_calls, [],
            f"expected no rollout restart without --build-local, got: {rollout_calls}",
        )

    def test_pre_deploy_check_aborts_when_existing_is_build_local_and_new_is_not(self):
        """Existing release uses osmo.local images + new invocation lacks
        --build-local → pre_deploy_check raises, signalling the entry-point
        to abort BEFORE DeploySession (so the cluster isn't rolled back)."""
        existing_build_local_values = json.dumps({
            "global": {"osmoImageLocation": "osmo.local", "osmoImageTag": "latest-arm64"},
        })
        adapter, _ = self._adapter(
            mode="cpu",
            build_local=False,
            capture_stdouts=[existing_build_local_values],
        )
        with self.assertRaises(RuntimeError) as ctx:
            adapter.pre_deploy_check(DeployParams(type="kind", env_name="kind"))
        self.assertIn("--build-local", str(ctx.exception))
        self.assertIn("--fresh", str(ctx.exception))

    def test_pre_deploy_check_passes_when_both_invocations_are_build_local(self):
        """Existing release is build-local + new invocation also has
        --build-local → no abort (consistent intent)."""
        existing_build_local_values = json.dumps({
            "global": {"osmoImageLocation": "osmo.local"},
        })
        adapter, _ = self._adapter(
            mode="cpu",
            build_local=True,
            capture_stdouts=[existing_build_local_values],
        )
        adapter.pre_deploy_check(DeployParams(type="kind", env_name="kind"))

    def test_pre_deploy_check_allows_switching_from_ngc_to_build_local(self):
        """Existing release is NGC + new invocation adds --build-local →
        non-destructive switch, no abort."""
        existing_ngc_values = json.dumps({})  # no overrides = chart defaults (NGC)
        adapter, _ = self._adapter(
            mode="cpu",
            build_local=True,
            capture_stdouts=[existing_ngc_values],
        )
        adapter.pre_deploy_check(DeployParams(type="kind", env_name="kind"))

    def test_pre_deploy_check_aborts_on_arch_mismatch_in_build_local(self):
        """Both invocations are --build-local but the existing release was
        deployed on a different arch (e.g. x86_64 → arm64). The helm upgrade
        would silently flip ``osmoImageTag`` and pods would ImagePullBackOff
        against the missing arch."""
        # Existing release built for the OPPOSITE arch from this host.
        host_tag = local_images.image_tag()
        other_tag = "latest-x86_64" if host_tag.endswith("arm64") else "latest-arm64"
        existing_other_arch = json.dumps({
            "global": {"osmoImageLocation": "osmo.local", "osmoImageTag": other_tag},
        })
        adapter, _ = self._adapter(
            mode="cpu",
            build_local=True,
            capture_stdouts=[existing_other_arch],
        )
        with self.assertRaises(RuntimeError) as ctx:
            adapter.pre_deploy_check(DeployParams(type="kind", env_name="kind"))
        self.assertIn("arch mismatch", str(ctx.exception))
        self.assertIn(other_tag, str(ctx.exception))
        self.assertIn("--fresh", str(ctx.exception))

    def test_pre_deploy_check_skipped_when_fresh(self):
        """``--fresh`` deletes the cluster anyway; consistency check is moot."""
        adapter, _ = self._adapter(
            mode="cpu",
            build_local=False,
            capture_stdouts=[json.dumps({"global": {"osmoImageLocation": "osmo.local"}})],
        )
        # Even with build-local existing values, --fresh skips the check.
        adapter.pre_deploy_check(DeployParams(type="kind", env_name="kind", fresh=True))


class TestKindPreflight(unittest.TestCase):
    """check_kind_prereqs enumerates rather than raising."""

    def test_returns_list(self):
        # Don't assert contents — depends on local machine state.
        result = check_kind_prereqs()
        self.assertIsInstance(result, list)

    def test_no_nvcr_requirement(self):
        """NVCR creds are no longer needed for pulls from public nvcr.io/nvidia/osmo."""
        saved = {k: os.environ.pop(k, None)
                 for k in ("NVCR_PASSWORD", "CONTAINER_REGISTRY_PASSWORD")}
        try:
            errors = check_kind_prereqs()
            self.assertFalse(
                any("NVCR_PASSWORD" in e.error for e in errors),
                "quick-start uses public nvcr.io — NVCR creds should not be required",
            )
        finally:
            for key, value in saved.items():
                if value is not None:
                    os.environ[key] = value


class TestBreadcrumb(unittest.TestCase):
    """Breadcrumb upsert / read_all / find / remove / clear semantics."""

    def test_upsert_appends_new_envs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "sub", "breadcrumb.json")
            kind_crumb = breadcrumb.Breadcrumb.now(
                type="kind", env_name="local-kind", cluster_name="osmo",
            )
            dev_crumb = breadcrumb.Breadcrumb.now(
                type="dev", env_name="testuser-dev",
            )
            breadcrumb.upsert(kind_crumb, path)
            breadcrumb.upsert(dev_crumb, path)
            crumbs = breadcrumb.read_all(path)
            # Newest last so caller can take crumbs[-1] for "most recent".
            self.assertEqual([c.env_name for c in crumbs],
                             ["local-kind", "testuser-dev"])

    def test_upsert_replaces_same_env(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "breadcrumb.json")
            old = breadcrumb.Breadcrumb.now(
                type="kind", env_name="local-kind", cluster_name="osmo",
            )
            breadcrumb.upsert(old, path)
            new = breadcrumb.Breadcrumb.now(
                type="kind", env_name="local-kind", cluster_name="osmo-2",
            )
            breadcrumb.upsert(new, path)
            crumbs = breadcrumb.read_all(path)
            self.assertEqual(len(crumbs), 1)
            self.assertEqual(crumbs[0].cluster_name, "osmo-2")

    def test_upsert_replace_moves_entry_to_newest(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "breadcrumb.json")
            breadcrumb.upsert(breadcrumb.Breadcrumb.now(
                type="kind", env_name="A", cluster_name="a",
            ), path)
            breadcrumb.upsert(breadcrumb.Breadcrumb.now(
                type="kind", env_name="B", cluster_name="b",
            ), path)
            # Re-deploying A should bump A to the newest position.
            breadcrumb.upsert(breadcrumb.Breadcrumb.now(
                type="kind", env_name="A", cluster_name="a",
            ), path)
            crumbs = breadcrumb.read_all(path)
            self.assertEqual([c.env_name for c in crumbs], ["B", "A"])

    def test_find_returns_matching_entry(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "breadcrumb.json")
            breadcrumb.upsert(breadcrumb.Breadcrumb.now(
                type="dev", env_name="testuser-dev",
            ), path)
            found = breadcrumb.find("testuser-dev", path)
            self.assertIsNotNone(found)
            assert found is not None  # mypy narrowing
            self.assertEqual(found.env_name, "testuser-dev")
            self.assertIsNone(breadcrumb.find("nope", path))

    def test_remove_returns_false_when_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "breadcrumb.json")
            breadcrumb.upsert(breadcrumb.Breadcrumb.now(
                type="kind", env_name="A", cluster_name="a",
            ), path)
            self.assertFalse(breadcrumb.remove("nope", path))
            self.assertEqual(len(breadcrumb.read_all(path)), 1)

    def test_remove_last_entry_deletes_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "breadcrumb.json")
            breadcrumb.upsert(breadcrumb.Breadcrumb.now(
                type="kind", env_name="A", cluster_name="a",
            ), path)
            self.assertTrue(breadcrumb.remove("A", path))
            self.assertFalse(os.path.exists(path))

    def test_read_all_missing_returns_empty(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "nope.json")
            self.assertEqual(breadcrumb.read_all(path), [])

    def test_clear_missing_file_is_noop(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "nope.json")
            breadcrumb.clear(path)  # should not raise

    def test_read_all_migrates_v1_legacy_format(self):
        """Older breadcrumb files were a single-dict, not a versioned
        list. Migration path: a v1 file is read as a one-element list."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "breadcrumb.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({
                    "type": "kind",
                    "env_name": "local-kind",
                    "cluster_name": "osmo",
                    "deployed_at": "2026-01-01T00:00:00+00:00",
                }, handle)
            crumbs = breadcrumb.read_all(path)
            self.assertEqual(len(crumbs), 1)
            self.assertEqual(crumbs[0].env_name, "local-kind")
            # Re-upserting on a legacy file rewrites it as v2.
            breadcrumb.upsert(breadcrumb.Breadcrumb.now(
                type="dev", env_name="testuser-dev",
            ), path)
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            self.assertEqual(data["version"], 2)
            self.assertEqual(len(data["deploys"]), 2)


class TestTeardownArgs(unittest.TestCase):
    """``oetf:teardown`` argparse + dispatch policy."""

    def test_no_args_errors_with_helpful_message(self):
        with self.assertLogs("test.oetf.teardown_main", "ERROR") as ctx:
            rc = teardown_main.main([])
        self.assertEqual(rc, teardown_main.EXIT_FRAMEWORK_ERROR)
        joined = "\n".join(ctx.output)
        self.assertIn("--env <name> is required", joined)
        self.assertIn("--list", joined)

    def test_list_and_env_are_mutually_exclusive(self):
        with self.assertLogs("test.oetf.teardown_main", "ERROR") as ctx:
            rc = teardown_main.main(["--list", "--env", "anything"])
        self.assertEqual(rc, teardown_main.EXIT_FRAMEWORK_ERROR)
        self.assertIn("mutually exclusive", "\n".join(ctx.output))

    def test_list_when_breadcrumb_missing_succeeds(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "missing.json")
            with unittest.mock.patch.object(
                breadcrumb, "DEFAULT_PATH", path,
            ):
                with self.assertLogs("test.oetf.teardown_main", "INFO") as ctx:
                    rc = teardown_main.main(["--list"])
        self.assertEqual(rc, teardown_main.EXIT_SUCCESS)
        self.assertIn("No active deploys", "\n".join(ctx.output))

    def test_list_prints_each_active_deploy(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "breadcrumb.json")
            breadcrumb.upsert(breadcrumb.Breadcrumb.now(
                type="kind", env_name="local-kind", cluster_name="osmo",
            ), path)
            with unittest.mock.patch.object(
                breadcrumb, "DEFAULT_PATH", path,
            ):
                with self.assertLogs("test.oetf.teardown_main", "INFO") as ctx:
                    rc = teardown_main.main(["--list"])
        self.assertEqual(rc, teardown_main.EXIT_SUCCESS)
        joined = "\n".join(ctx.output)
        self.assertIn("local-kind", joined)
        self.assertIn("cluster=osmo", joined)


class TestFactoryRegistry(unittest.TestCase):
    """Plugin-registry surface in deploy_adapters.factory.

    The registry is what lets overlay packages add adapters (e.g. an internal
    'dev' adapter shipped outside the public OETF tree) without modifying
    framework code. These tests pin the public API contract: register_adapter,
    build_adapter, build_teardown_adapter, registered_* enumerators.
    """

    def setUp(self):
        self.factory = factory
        # Snapshot existing registry state so each test's mutations are reverted.
        self._deploy_snapshot = dict(factory._DEPLOY_BUILDERS)  # pylint: disable=protected-access
        self._teardown_snapshot = dict(factory._TEARDOWN_BUILDERS)  # pylint: disable=protected-access

    def tearDown(self):
        self.factory._DEPLOY_BUILDERS.clear()  # pylint: disable=protected-access
        self.factory._DEPLOY_BUILDERS.update(self._deploy_snapshot)  # pylint: disable=protected-access
        self.factory._TEARDOWN_BUILDERS.clear()  # pylint: disable=protected-access
        self.factory._TEARDOWN_BUILDERS.update(self._teardown_snapshot)  # pylint: disable=protected-access

    def test_kind_registered_for_both_deploy_and_teardown(self):
        self.assertIn("kind", self.factory.registered_deploy_types())
        self.assertIn("kind", self.factory.registered_teardown_types())

    def test_custom_registered_for_teardown_only(self):
        # custom envs have no deploy (externally managed) but accept teardown
        # (no-op via NoopAdapter).
        self.assertIn("custom", self.factory.registered_teardown_types())
        self.assertNotIn("custom", self.factory.registered_deploy_types())

    def test_register_adapter_makes_deploy_type_available(self):
        called = {"deploy": False}

        def fake_deploy(args, env):
            del args, env
            called["deploy"] = True
            return _FakeAdapter()

        self.factory.register_adapter("synthetic", deploy_builder=fake_deploy)
        self.assertIn("synthetic", self.factory.registered_deploy_types())
        # Build an EnvironmentConfig with type="synthetic" so the registry
        # dispatch path is exercised. KIND-only flag rejection should NOT
        # fire because "synthetic" is not in _OTHER_TYPES_FLAGS_FOR.
        env = EnvironmentConfig(
            name="syn", url="http://syn", type="synthetic",  # type: ignore[arg-type]
            auth=EnvironmentAuth(strategy="dev", username="testuser"),
        )
        args = unittest.mock.Mock()
        self.factory.build_adapter(args, env)
        self.assertTrue(called["deploy"])

    def test_register_adapter_makes_teardown_type_available(self):
        captured = {}

        def fake_teardown(env):
            captured["env_name"] = env.name
            return _FakeAdapter()

        self.factory.register_adapter("synthetic", teardown_builder=fake_teardown)
        env = EnvironmentConfig(
            name="syn-env", url="http://syn", type="synthetic",  # type: ignore[arg-type]
            auth=EnvironmentAuth(strategy="dev", username="testuser"),
        )
        self.factory.build_teardown_adapter(env)
        self.assertEqual(captured["env_name"], "syn-env")

    def test_register_adapter_idempotent_replaces_prior(self):
        first_called = {"v": False}
        second_called = {"v": False}

        def first(args, env):
            del args, env
            first_called["v"] = True
            return _FakeAdapter()

        def second(args, env):
            del args, env
            second_called["v"] = True
            return _FakeAdapter()

        self.factory.register_adapter("syn", deploy_builder=first)
        self.factory.register_adapter("syn", deploy_builder=second)
        env = EnvironmentConfig(
            name="x", url="http://x", type="syn",  # type: ignore[arg-type]
            auth=EnvironmentAuth(strategy="dev", username="testuser"),
        )
        self.factory.build_adapter(unittest.mock.Mock(), env)
        self.assertFalse(first_called["v"], "first registration should be replaced")
        self.assertTrue(second_called["v"])

    def test_build_adapter_raises_on_unregistered_type(self):
        env = EnvironmentConfig(
            name="x", url="http://x", type="not-a-real-type",  # type: ignore[arg-type]
            auth=EnvironmentAuth(strategy="dev", username="testuser"),
        )
        with self.assertRaises(ValueError) as ctx:
            self.factory.build_adapter(unittest.mock.Mock(), env)
        # Error message must include the unrecognized type so the user can
        # spot a typo, plus the registered set so they see what IS available.
        self.assertIn("not-a-real-type", str(ctx.exception))
        self.assertIn("Registered", str(ctx.exception))

    def test_build_teardown_adapter_raises_on_unregistered_type(self):
        env = EnvironmentConfig(
            name="x", url="http://x", type="not-a-real-type",  # type: ignore[arg-type]
            auth=EnvironmentAuth(strategy="dev", username="testuser"),
        )
        with self.assertRaises(ValueError):
            self.factory.build_teardown_adapter(env)

    def test_build_teardown_adapter_custom_returns_noop(self):
        env = EnvironmentConfig(
            name="ext", url="http://ext", type="custom",
            auth=EnvironmentAuth(strategy="dev", username="testuser"),
        )
        adapter = self.factory.build_teardown_adapter(env)
        self.assertIsInstance(adapter, NoopAdapter)


if __name__ == "__main__":
    unittest.main()
