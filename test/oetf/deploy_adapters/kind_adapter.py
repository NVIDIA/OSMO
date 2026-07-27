"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# KIND deploy adapter using the repository's canonical ``osmo`` umbrella chart.
#
# The adapter creates a small KIND cluster (with port 80 → 30080 mapping for
# the gateway), then installs ``deployments/charts/osmo`` with the
# ``single-node`` profile. This is the same Helm entry point documented for
# users, so OETF validates the branch under test instead of a separately
# published compatibility chart.
#
# Image source is configurable via ``image_location`` / ``image_tag``. The
# default is the public ``nvcr.io/nvidia/osmo`` registry at the chart's app
# version. For local-built images, pass ``--image-location``
# and ``--image-tag`` and make sure they are loaded into the KIND cluster
# beforehand (``kind load docker-image …``).
import dataclasses
import json
import logging
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional

from test.oetf import local_images
from test.oetf.deploy_adapters.base import DeployParams
from test.oetf.environments import resolve_environment
from test.oetf.models import DeployMode, EnvironmentConfig
from test.oetf.preflight import PreflightError

logger = logging.getLogger(__name__)

DEFAULT_CLUSTER_NAME = "osmo"
# Public URL (mapped to 127.0.0.1 in /etc/hosts) used for tests + CLI access.
KIND_HOSTNAME = "local.osmo"

OSMO_NAMESPACE = "osmo-system"

# metrics-server remains opt-in for OETF scenarios that exercise HPA behavior.
# It is not an installation dependency of the single-node profile.
METRICS_SERVER_REPO_NAME = "metrics-server"
METRICS_SERVER_REPO_URL = "https://kubernetes-sigs.github.io/metrics-server/"
METRICS_SERVER_CHART = "metrics-server/metrics-server"
METRICS_SERVER_NAMESPACE = "kube-system"

# When ``--build-local`` is set, every osmo container's image points at the
# pseudo-registry ``osmo.local/<svc>:latest-<arch>`` — the chart default
# ``imagePullPolicy: Always`` would force kubelet to round-trip to that
# nonexistent registry on every pod start, ImagePullBackOffing forever.
# Override per-service to ``IfNotPresent`` so kubelet trusts the kind-loaded
# image. Paths are rooted at the umbrella chart's control and compute aliases.
_BUILD_LOCAL_SERVICES = (
    ("controlPlane", "agent"),
    ("controlPlane", "service"),
    ("controlPlane", "delayedJobMonitor"),
    ("controlPlane", "logger"),
    ("controlPlane", "worker"),
    ("controlPlane", "router"),
    ("computePlane", "backendListener"),
    ("computePlane", "backendWorker"),
    ("controlPlane", "ui"),
)
_BUILD_LOCAL_PULL_POLICY_OVERRIDES = tuple(
    f"{plane}.services.{service}.imagePullPolicy=IfNotPresent"
    for plane, service in _BUILD_LOCAL_SERVICES
)


def _build_local_helm_args() -> List[str]:
    """Helm ``--set``/``--set-json`` args that adapt the chart for kind-loaded images.

    Per-service ``imagePullPolicy=IfNotPresent`` so kubelet trusts the
    kind-loaded image instead of round-tripping to the pseudo-registry
    ``osmo.local``. The web-ui image is built locally as well.
    """
    args: List[str] = []
    for set_arg in _BUILD_LOCAL_PULL_POLICY_OVERRIDES:
        args += ["--set", set_arg]
    return args

# KIND cluster config. Port 80 → 30080 extraPortMapping makes the OSMO gateway
# reachable at http://local.osmo from the host.


def _default_kind_config_path() -> str:
    """Resolve the bundled KIND config path.

    The config ships as a ``data=`` dep of the deploy_adapters_kind py_library
    so it sits in the runfiles tree next to this file in any caller context —
    external standalone (``bazel run`` from NVIDIA/OSMO), internal overlay
    (``bazel run`` from the internal repo that mounts NVIDIA/OSMO as a
    submodule), and unit tests under the sandbox. Resolving from ``__file__``
    works uniformly; ``$BUILD_WORKSPACE_DIRECTORY`` does not, because the
    overlay caller's workspace root is the internal repo (where the config
    lives under ``external/test/oetf/data/``, not ``test/oetf/data/``).
    """
    return os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..",
        "data", "kind-osmo-cluster-config.yaml",
    )


def _default_chart_root() -> str:
    """Resolve the chart source root from Bazel runfiles or a checkout."""
    return os.path.normpath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "..", "..", "deployments", "charts",
    ))


@dataclasses.dataclass
class KindAdapter:
    """Deploy OSMO on KIND through the repository's ``osmo`` umbrella chart.

    Attributes:
        image_location: Override for ``global.osmoImageLocation``.
        image_tag: Override for ``global.osmoImageTag``.
        kind_config_path: Path to the KIND cluster config file. Defaults to
            ``test/oetf/data/kind-osmo-cluster-config.yaml``.
        chart_root: Directory containing the ``osmo``, ``service``, and
            ``backend-operator`` charts. Defaults to ``deployments/charts`` in
            the current runfiles tree.
        extra_helm_sets: Additional ``key=value`` pairs for ``helm --set``.
    """

    # 'cpu' (default): compact KIND cluster with the Kubernetes scheduler.
    # 'gpu' (not yet implemented): a GPU-enabled KIND implementation that
    # still uses the same umbrella chart after platform prerequisites exist.
    mode: DeployMode = "cpu"
    image_location: str = ""
    image_tag: str = ""
    kind_config_path: str = ""
    chart_root: str = ""
    extra_helm_sets: List[str] = dataclasses.field(default_factory=list)
    # metrics-server is off by default; opt in for HPA-focused scenarios.
    install_metrics_server: bool = False
    # Called after cluster exists but before helm install. Used by --build-local
    # to build + kind-load images. Signature: hook(cluster_name: str) -> None.
    pre_install_hook: Optional[Callable[[str], None]] = None
    # When True, Helm uses kind-loaded images with IfNotPresent pull policy.
    build_local: bool = False
    # When True (paired with build_local), publish locally-built images to a
    # host-side ``registry:2`` container that KIND nodes pull from on-demand
    # via containerdConfigPatches. Replaces `kind load docker-image` (which
    # duplicates each image into every node's containerd content store) and
    # is required on disk-constrained CI runners — see local_images for the
    # full rationale.
    use_local_registry: bool = False
    # Injected for tests — callables matching subprocess.run / urllib.request.urlopen.
    subprocess_runner: Optional[Callable[..., Any]] = None
    url_opener: Optional[Callable[..., Any]] = None

    # --- Lifecycle -------------------------------------------------------- #

    def deploy(self, params: DeployParams) -> EnvironmentConfig:
        if self.mode not in ("cpu", "gpu"):
            raise ValueError(
                f"Unsupported mode '{self.mode}'. Use 'cpu' (default) or 'gpu'."
            )

        cluster_name = params.cluster_name or DEFAULT_CLUSTER_NAME

        if params.fresh:
            logger.info("--fresh set, deleting existing cluster '%s' if any", cluster_name)
            self._kind_delete(cluster_name)

        if self.mode == "gpu":
            cluster_existed = self._deploy_gpu(cluster_name)  # pylint: disable=assignment-from-no-return
        else:
            cluster_existed = self._deploy_cpu(cluster_name)

        if cluster_existed and self.build_local:
            self._rollout_restart_osmo()

        env = resolve_environment(params.env_name or "kind")
        self._wait_for_health(env.url)
        return env

    def _deploy_cpu(self, cluster_name: str) -> bool:
        """Install the single-node profile after creating or reusing KIND."""
        cluster_existed = self._create_cluster_if_missing(cluster_name)
        if self.install_metrics_server:
            self._install_metrics_server()
        if self.pre_install_hook is not None:
            self.pre_install_hook(cluster_name)
        self._helm_install()
        return cluster_existed

    def pre_deploy_check(self, params: DeployParams) -> None:
        """Refuse to silently revert a build-local cluster to NGC images.

        Re-deploying without ``--build-local`` over an existing build-local
        release would helm-upgrade ``global.osmoImageLocation`` and
        ``imagePullPolicy`` back to chart defaults, causing every OSMO
        Deployment to roll over to the configured registry and
        orphaning the local-built images. The reverse direction is
        non-destructive so we just log it.

        Called by deploy_main BEFORE ``DeploySession`` opens — abort here
        does not trigger rollback teardown of the existing cluster.
        Skipped when ``params.fresh`` (cluster will be recreated anyway).
        """
        if params.fresh:
            return
        existing = self._existing_release_global_values()
        if existing is None:
            return  # No existing release; helm install will create it fresh.
        existing_location = existing.get("osmoImageLocation", "")
        existing_tag = existing.get("osmoImageTag", "")
        existing_is_build_local = existing_location == "osmo.local"
        if existing_is_build_local and not self.build_local:
            raise RuntimeError(
                "ERROR: existing osmo release was deployed with --build-local "
                "(global.osmoImageLocation=osmo.local). Re-deploying without "
                "--build-local would helm-upgrade pods back to NGC images and "
                "discard local-built work.\n"
                "NEXT:  pass --build-local to keep local images, or --fresh "
                "to recreate the cluster from scratch with NGC defaults."
            )
        if existing_is_build_local and self.build_local:
            # Both are build-local: also catch tag drift (e.g. user previously
            # deployed on x86_64, now re-runs on arm64). Without this, helm
            # would silently upgrade osmoImageTag and pods ImagePullBackOff
            # against the missing arch.
            expected_tag = local_images.image_tag()
            if existing_tag and existing_tag != expected_tag:
                raise RuntimeError(
                    f"ERROR: existing build-local release uses "
                    f"global.osmoImageTag={existing_tag!r}, but this host "
                    f"would build for {expected_tag!r} (arch mismatch). "
                    f"Pods would ImagePullBackOff after the helm upgrade.\n"
                    f"NEXT:  pass --fresh to recreate the cluster, or run "
                    f"this command on the same architecture as the existing "
                    f"release."
                )
        if not existing_is_build_local and self.build_local:
            logger.info(
                "▶ Existing osmo release uses chart-default images; "
                "switching to --build-local will helm-upgrade to "
                "osmo.local/* and rollout-restart.",
            )

    def _existing_release_global_values(self) -> Optional[Dict[str, str]]:
        """Return the existing release's ``global:`` section, or ``None`` if no release.

        Reads user-supplied values only (``helm get values`` without ``-a``)
        — chart defaults are not part of the user's intent. Robust to
        missing release / unreachable cluster: any failure → None.
        """
        values = self._helm_json(
            ["helm", "get", "values", "osmo", "-n", OSMO_NAMESPACE, "-o", "json"],
            description="Reading existing osmo release values",
        )
        if values is None:
            return None
        return values.get("global") or {}

    def _rollout_restart_osmo(self) -> None:
        """Re-deploy: make running osmo pods pick up freshly kind-loaded images.

        ``kind load docker-image`` updates the named image on KIND nodes, but
        already-running pods keep using the image they were originally
        scheduled with. ``kubectl rollout restart`` patches each Deployment's
        pod template (an annotation bump) so the ReplicaSet creates fresh
        pods, and kubelet — with ``imagePullPolicy: IfNotPresent`` — uses
        the kind-loaded image.

        Restarts every Deployment in the OSMO control-plane namespace; the wall-clock
        cost (~15-30s) is rounding error vs. a typical bazel re-build.
        """
        # ``kubectl rollout restart`` doesn't accept ``--all``; omitting the
        # resource name restarts every deployment in the namespace. (Different
        # from ``kubectl wait``, which does take ``--all``.)
        self._run(
            ["kubectl", "rollout", "restart", "deployment",
             "-n", OSMO_NAMESPACE],
            description="Re-deploy: rollout restart osmo deployments",
        )
        self._run(
            ["kubectl", "rollout", "status", "deployment",
             "-n", OSMO_NAMESPACE, "--timeout=10m"],
            description="Waiting for rolled-out pods to become Available",
        )

    def _deploy_gpu(self, cluster_name: str) -> bool:
        """GPU path. Not yet implemented.

        Planned shape:

        * Create the cluster with ``nvkind cluster create --config-template=...``
          (NVIDIA's KIND wrapper that injects the ``nvidia-container-runtime``
          and GPU device mounts).
        * Validate the GPU Operator or equivalent platform integration.
        * Install the same ``osmo`` chart and ``single-node`` profile with
          GPU pool values.
        * ``_wait_for_health`` as usual.

        Prerequisites beyond CPU mode:
          - Host has NVIDIA GPU + driver installed
          - ``nvkind`` installed (``go install github.com/nvidia/nvkind@...``)
          - A working Kubernetes GPU runtime and device plugin
        """
        del cluster_name
        raise NotImplementedError(
            "GPU mode is not yet implemented. Planned path: nvkind + "
            "GPU platform prerequisites followed by the same OSMO umbrella "
            "chart. Use --mode cpu for "
            "CPU-only hosts."
        )

    def configure(self, env: EnvironmentConfig) -> None:
        # The chart owns all installation configuration.
        del env

    def teardown(self, params: DeployParams) -> None:
        cluster_name = params.cluster_name or DEFAULT_CLUSTER_NAME
        self._kind_delete(cluster_name)

    # --- Steps ------------------------------------------------------------ #

    def _create_cluster_if_missing(self, cluster_name: str) -> bool:
        """Create the KIND cluster if missing. Return True if it pre-existed."""
        existing = self._run_capture(
            ["kind", "get", "clusters"], description="Listing KIND clusters",
        )
        if cluster_name in existing.splitlines():
            logger.info("▶ KIND cluster '%s' already exists — reusing", cluster_name)
            if self.use_local_registry and self.build_local:
                # Make sure the per-node hosts.toml is in place even when
                # we're reusing an existing cluster (defensive: a previous
                # run may have failed before wiring).
                local_images.ensure_local_registry()
                local_images.connect_registry_to_kind(cluster_name)
            return True
        config_path = self.kind_config_path or _default_kind_config_path()
        if self.use_local_registry and self.build_local:
            # Start the registry container BEFORE the cluster comes up so
            # the post-create wiring can connect it to the kind network.
            local_images.ensure_local_registry()
            # Inject containerdConfigPatches so each node's containerd looks
            # under /etc/containerd/certs.d/ — the per-node hosts.toml we
            # write next must be backed by this config-path mode.
            config_path = local_images.patched_kind_config_with_registry(config_path)
        # Don't pre-check ``os.path.isfile(config_path)``: kind's own error
        # message ("could not find a config file…") is already actionable,
        # and a TOCTOU pre-check duplicates the failure mode without adding
        # information.
        self._run(
            ["kind", "create", "cluster", "--name", cluster_name, "--config", config_path],
            "Creating KIND cluster",
        )
        if self.use_local_registry and self.build_local:
            local_images.connect_registry_to_kind(cluster_name)
        return False

    def _ensure_helm_repo(self, name: str, url: str) -> None:
        """Idempotent ``helm repo add`` — a no-op if ``name`` is already registered."""
        repos = self._helm_json(
            ["helm", "repo", "list", "-o", "json"],
            description=f"Checking helm repos for {name}",
        )
        if repos and any(repo.get("name") == name for repo in repos):
            return
        self._run(
            ["helm", "repo", "add", name, url],
            f"Adding helm repo {name}",
        )

    def _helm_release_installed(self, release: str, namespace: str) -> bool:
        """Return True if a helm release with ``release`` exists in ``namespace``.

        Used by the idempotent ``_install_*`` helpers to skip work on
        re-deploys. ``allow_failure=True`` because the namespace may not
        exist yet — that's "not installed", not an error.
        """
        out = self._run_capture(
            ["helm", "list", "-n", namespace, "-o", "json"],
            description=f"Checking {release}", allow_failure=True,
        )
        return release in out

    def _install_metrics_server(self) -> None:
        """Install metrics-server for HPA-focused OETF scenarios.

        KIND nodes use self-signed kubelet certs; ``--kubelet-insecure-tls``
        tells metrics-server to skip cert verification when scraping them.
        Skipped if metrics-server is already installed in kube-system.
        """
        if self._helm_release_installed("metrics-server", METRICS_SERVER_NAMESPACE):
            logger.info("▶ metrics-server already installed — skipping")
            return
        self._ensure_helm_repo(METRICS_SERVER_REPO_NAME, METRICS_SERVER_REPO_URL)
        self._run(
            ["helm", "repo", "update", METRICS_SERVER_REPO_NAME],
            "Updating metrics-server helm repo",
        )
        self._run(
            [
                "helm", "upgrade", "--install", "metrics-server", METRICS_SERVER_CHART,
                "-n", METRICS_SERVER_NAMESPACE,
                "--set", "args[0]=--kubelet-insecure-tls",
                "--wait", "--timeout", "5m",
            ],
            "Installing metrics-server",
        )

    def _helm_install(self) -> None:
        chart_root = self.chart_root or _default_chart_root()
        with tempfile.TemporaryDirectory(prefix="oetf-osmo-chart-") as workspace:
            for chart_name in ("osmo", "service", "backend-operator"):
                shutil.copytree(
                    os.path.join(chart_root, chart_name),
                    os.path.join(workspace, chart_name),
                )
            chart_path = os.path.join(workspace, "osmo")
            profile_path = os.path.join(chart_path, "profiles", "single-node.yaml")
            self._run(
                ["helm", "dependency", "build", "--skip-refresh", chart_path],
                "Building local OSMO chart dependencies",
            )
            args = [
                "helm", "upgrade", "--install", "osmo", chart_path,
                "--namespace", OSMO_NAMESPACE, "--create-namespace",
                "--values", profile_path,
                "--timeout", "25m",
                "--set", "controlPlane.gateway.envoy.service.type=NodePort",
                "--set", "controlPlane.gateway.envoy.service.nodePort=30080",
                "--set-json", "controlPlane.gateway.envoy.service.httpsPort=null",
                "--set", "controlPlane.services.agent.resources.requests.memory=1Gi",
                "--set", "controlPlane.services.agent.resources.limits.memory=1Gi",
            ]
            if self.image_location:
                args += ["--set", f"global.osmoImageLocation={self.image_location}"]
            if self.image_tag:
                args += ["--set", f"global.osmoImageTag={self.image_tag}"]
            if self.build_local:
                args += _build_local_helm_args()
            for extra in self.extra_helm_sets:
                args += ["--set", extra]
            self._run(args, "Installing the local OSMO umbrella chart")
        # Wait for all Deployments to reach Available=True. This is the
        # meaningful readiness signal for the cluster being usable.
        self._run(
            [
                "kubectl", "wait", "--for=condition=Available", "deployment",
                "--all", "-n", OSMO_NAMESPACE, "--timeout=25m",
            ],
            "Waiting for osmo Deployments to be Available",
        )

    def _kind_delete(self, cluster_name: str) -> None:
        """Idempotent ``kind delete cluster`` — swallows 'not found'."""
        runner = self.subprocess_runner or subprocess.run
        logger.info("▶ Deleting KIND cluster '%s' (idempotent)", cluster_name)
        result = runner(
            ["kind", "delete", "cluster", "--name", cluster_name],
            check=False,
        )
        returncode = _returncode(result)
        if returncode != 0:
            logger.warning(
                "kind delete returned %d — cluster may not have existed", returncode,
            )

    def _wait_for_health(
        self,
        base_url: str,
        timeout_seconds: int = 180,
        required_consecutive_ok: int = 3,
    ) -> None:
        """Block until ``<base_url>/health`` returns 200 a few times in a row.

        helm ``--wait`` only checks pod readiness. The service can still return
        ``RemoteDisconnected`` for a few seconds while it warms up, so we poll
        until we see ``required_consecutive_ok`` successes back-to-back.
        """
        url = base_url.rstrip("/") + "/health"
        opener = self.url_opener or urllib.request.urlopen
        logger.info("▶ Waiting for %s to stabilize (up to %ds)", url, timeout_seconds)
        deadline = time.monotonic() + timeout_seconds
        consecutive_ok = 0
        last_error = ""
        while time.monotonic() < deadline:
            try:
                with opener(url, timeout=5) as response:
                    if response.status == 200:
                        consecutive_ok += 1
                        if consecutive_ok >= required_consecutive_ok:
                            logger.info("  health OK after %d consecutive 200s", consecutive_ok)
                            return
                    else:
                        consecutive_ok = 0
                        last_error = f"HTTP {response.status}"
            except (urllib.error.URLError, urllib.error.HTTPError, OSError) as error:
                consecutive_ok = 0
                last_error = str(error)[:120]
            time.sleep(2)
        raise RuntimeError(
            f"{url} did not stabilize within {timeout_seconds}s "
            f"(last error: {last_error})"
        )

    # --- Subprocess helpers ---------------------------------------------- #

    def _run(self, args: List[str], description: str) -> None:
        runner = self.subprocess_runner or subprocess.run
        logger.info("▶ %s", description)
        logger.info("  $ %s", " ".join(args))
        result = runner(args, check=False)
        returncode = _returncode(result)
        if returncode != 0:
            raise RuntimeError(
                f"{description} failed with exit code {returncode}"
            )

    def _run_capture(
        self,
        args: List[str],
        description: str,
        allow_failure: bool = False,
    ) -> str:
        """Run ``args`` and return stdout as a string. On failure, raise or return ''."""
        runner = self.subprocess_runner or subprocess.run
        logger.debug("▶ %s", description)
        logger.debug("  $ %s", " ".join(args))
        result = runner(args, check=False, capture_output=True, text=True)
        returncode = _returncode(result)
        stdout = getattr(result, "stdout", "") or ""
        if returncode != 0:
            if allow_failure:
                return ""
            stderr = getattr(result, "stderr", "") or ""
            raise RuntimeError(
                f"{description} failed with exit code {returncode}: {stderr[:200]}"
            )
        return stdout

    def _helm_json(self, args: List[str], description: str) -> Optional[Any]:
        """Run a JSON-emitting helm command and return the parsed payload, or None.

        Tolerant: any non-zero exit, empty output, or JSON parse failure
        returns ``None`` (the caller treats that as "no information"). Used
        by the idempotency checks (does this release exist? what values
        does it have?) which must not fail the deploy.
        """
        out = self._run_capture(args, description=description, allow_failure=True)
        if not out:
            return None
        try:
            return json.loads(out)
        except json.JSONDecodeError:
            return None


# --- Utilities ------------------------------------------------------------ #


def _returncode(result: Any) -> int:
    """Normalize a subprocess.run result for test mocks that omit ``returncode``."""
    return getattr(result, "returncode", 0)


# --- Pre-flight ----------------------------------------------------------- #


def check_kind_prereqs() -> List[PreflightError]:
    """Enumerate every missing KIND prereq.

    Returns a list of :class:`PreflightError` rather than raising on the first
    failure so the user sees all problems at once (D11). Caller checks length.

    NVCR credentials are no longer required — ``nvcr.io/nvidia/osmo`` is a
    public registry for pulls.
    """
    errors: List[PreflightError] = []

    for tool, fix in [
        ("docker", "install Docker Desktop (macOS/Windows) or docker-ce (Linux): "
                   "https://docs.docker.com/engine/install/"),
        ("kind",   "brew install kind (macOS) / 'go install sigs.k8s.io/kind@latest' "
                   "or see https://kind.sigs.k8s.io/docs/user/quick-start/#installation"),
        ("kubectl", "brew install kubectl (macOS) or see "
                    "https://kubernetes.io/docs/tasks/tools/#kubectl"),
        ("helm",   "brew install helm (macOS) or see "
                   "https://helm.sh/docs/intro/install/"),
    ]:
        if shutil.which(tool) is None:
            errors.append(PreflightError(
                f"{tool} is not installed",
                fix,
            ))

    # ``docker`` binary present but daemon not running is the most common
    # failure mode on dev machines (Docker Desktop quit, colima not started).
    # ``docker info`` is the canonical "is the daemon reachable" probe — it
    # exits non-zero with a clear "Cannot connect to the Docker daemon"
    # message when the daemon is down.
    if shutil.which("docker") is not None:
        result = subprocess.run(
            ["docker", "info"],
            check=False, capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            errors.append(PreflightError(
                "docker daemon is not running",
                "start the daemon: 'open -a Docker' (macOS) or "
                "'sudo systemctl start docker' (Linux), then re-run",
            ))

    # The KIND ingress only listens on 127.0.0.1 (extraPortMapping). If the
    # hostname resolves to anything else (corp DNS, leftover hosts entry from
    # another env), preflight would pass but ``_wait_for_health`` fails ~3min
    # later with a confusing "did not stabilize" error. Catch the wrong-IP
    # case at the same time as the no-resolution case.
    try:
        resolved = socket.gethostbyname(KIND_HOSTNAME)
    except socket.gaierror:
        resolved = None
    if resolved is None:
        errors.append(PreflightError(
            f"{KIND_HOSTNAME} does not resolve — KIND tests cannot reach the ingress",
            f'echo "127.0.0.1 {KIND_HOSTNAME}" | sudo tee -a /etc/hosts',
        ))
    elif resolved != "127.0.0.1":
        errors.append(PreflightError(
            f"{KIND_HOSTNAME} resolves to {resolved} (expected 127.0.0.1) — "
            f"KIND ingress only listens on loopback",
            f"edit /etc/hosts to point '{KIND_HOSTNAME}' at 127.0.0.1, or remove "
            f"the conflicting entry",
        ))

    return errors
