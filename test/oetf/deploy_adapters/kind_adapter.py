"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# KIND deploy adapter using the ``osmo/quick-start`` umbrella chart.
#
# The adapter follows the public ``deploy_local.html`` guide: create a KIND
# cluster (with port 80 → 30080 mapping for ingress), then install the
# ``osmo/quick-start`` Helm chart which bundles service + web-ui + router +
# backend-operator + ingress-nginx in one operation.
#
# Image source is configurable via ``image_location`` / ``image_tag``. The
# default is the public ``nvcr.io/nvidia/osmo`` registry at tag ``6.2`` (the
# chart's built-in default). For local-built images, pass ``--image-location``
# and ``--image-tag`` and make sure they are loaded into the KIND cluster
# beforehand (``kind load docker-image …``); the local-build loop itself is
# tracked as a follow-up.
#
# The legacy ``run:start_service`` / ``run:start_backend`` path is not used by
# this adapter — it had multiple upstream issues on CPU-only hosts and is
# redundant with the umbrella chart.

import dataclasses
import json
import logging
import os
import shutil
import socket
import subprocess
import sys
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
KIND_HOSTNAME = "quick-start.osmo"

# Public Helm chart defaults.
OSMO_HELM_REPO_NAME = "osmo"
OSMO_HELM_REPO_URL = "https://helm.ngc.nvidia.com/nvidia/osmo"
OSMO_CHART_REF = "osmo/quick-start"
OSMO_NAMESPACE = "osmo"

# kai-scheduler is a soft dependency of osmo/quick-start — its pods have
# schedulerName=kai-scheduler and won't schedule without it installed. Version
# matches the one documented in the public deploy_local.html guide.
KAI_SCHEDULER_CHART = "oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler"
KAI_SCHEDULER_VERSION = "v0.12.10"
KAI_SCHEDULER_NAMESPACE = "kai-scheduler"

# metrics-server is a hidden dependency of osmo/quick-start: the chart creates
# 5 HorizontalPodAutoscalers that require resource metrics. Without it, HPAs
# report `AbleToScale=False`, which makes ``helm --wait`` block forever even
# after every pod is Running. The public deploy_local.html guide doesn't
# mention it — this is chart/docs drift.
METRICS_SERVER_REPO_NAME = "metrics-server"
METRICS_SERVER_REPO_URL = "https://kubernetes-sigs.github.io/metrics-server/"
METRICS_SERVER_CHART = "metrics-server/metrics-server"
METRICS_SERVER_NAMESPACE = "kube-system"

# When ``--build-local`` is set, every osmo container's image points at the
# pseudo-registry ``osmo.local/<svc>:latest-<arch>`` — the chart default
# ``imagePullPolicy: Always`` would force kubelet to round-trip to that
# nonexistent registry on every pod start, ImagePullBackOffing forever.
# Override per-service to ``IfNotPresent`` so kubelet trusts the kind-loaded
# image. Sub-chart paths follow each chart's ``services.<camel>`` tree (the
# router sub-chart's router process lives under ``services.service`` despite
# the chart name — chart-internal naming we don't control).
_BUILD_LOCAL_SERVICES = (
    ("service", "agent"),
    ("service", "service"),
    ("service", "delayedJobMonitor"),
    ("service", "logger"),
    ("service", "worker"),
    ("router", "service"),
    ("backend-operator", "backendListener"),
    ("backend-operator", "backendWorker"),
    ("web-ui", "ui"),
)
_BUILD_LOCAL_PULL_POLICY_OVERRIDES = tuple(
    f"{chart}.services.{svc}.imagePullPolicy=IfNotPresent"
    for chart, svc in _BUILD_LOCAL_SERVICES
)


def _build_local_helm_args() -> List[str]:
    """Helm ``--set``/``--set-json`` args that adapt the chart for kind-loaded images.

    Per-service ``imagePullPolicy=IfNotPresent`` so kubelet trusts the
    kind-loaded image instead of round-tripping to the pseudo-registry
    ``osmo.local``. With the web-ui image now built locally too, the
    chart's UI Deployment runs normally — no need for the prior
    ``replicas=0`` + ``ingress-nginx.controller.extraInitContainers=[]``
    workarounds.
    """
    args: List[str] = []
    for set_arg in _BUILD_LOCAL_PULL_POLICY_OVERRIDES:
        args += ["--set", set_arg]
    return args

# KIND cluster config. Port 80 → 30080 extraPortMapping is required so that
# ingress-nginx (installed as part of quick-start) is reachable at
# http://quick-start.osmo from the host. The bundled single-node config
# matches what osmo/quick-start expects; the external/run 4-worker config
# has node_group labels that fight with the umbrella chart's scheduler.
_KIND_CONFIG_BUNDLED_RELPATH = os.path.join(
    "test", "oetf", "data", "kind-osmo-cluster-config.yaml",
)


def _default_kind_config_path() -> str:
    """Resolve the bundled KIND config path.

    In ``bazel run`` context, the workspace root is exposed via
    ``BUILD_WORKSPACE_DIRECTORY``. When that is unset (unit tests in sandbox),
    fall back to a path relative to this file that works in the source tree.
    """
    workspace = os.environ.get("BUILD_WORKSPACE_DIRECTORY", "")
    if workspace:
        return os.path.join(workspace, _KIND_CONFIG_BUNDLED_RELPATH)
    return os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..",
        "data", "kind-osmo-cluster-config.yaml",
    )


@dataclasses.dataclass
class KindAdapter:
    """Deploy OSMO on a local KIND cluster via the ``osmo/quick-start`` chart.

    Attributes:
        image_location: Override for ``global.osmoImageLocation`` (default:
            chart default, currently ``nvcr.io/nvidia/osmo``).
        image_tag: Override for ``global.osmoImageTag`` (default: chart
            default, currently ``6.2``).
        chart_version: Pin a specific ``osmo/quick-start`` chart version
            (default: latest available in the repo).
        kind_config_path: Path to the KIND cluster config file. Defaults to
            the bundled ``test/oetf/data/kind-osmo-cluster-config.yaml``
            (6-node layout matching the public deploy_local.html CPU guide).
        extra_helm_sets: Additional ``key=value`` pairs for ``helm --set``.
    """

    # 'cpu' (default): 6-node KIND cluster with distinct ``node_group`` labels
    # (kai-scheduler, data, service×2, compute), matching the public
    # deploy_local.html CPU path. The ``osmo/quick-start`` chart installs
    # cleanly with no overrides because every selector has a matching node.
    # Uses ~2–3 GB extra RAM vs a single-node cluster for the 5 worker
    # containers.
    #
    # 'gpu' (not yet implemented): ``nvkind`` + gpu-operator per the public
    # deploy_local.html GPU path. Full fidelity to production shape with
    # real ``nvidia`` RuntimeClass. Requires an NVIDIA GPU on the host.
    mode: DeployMode = "cpu"
    image_location: str = ""                         # empty → chart default (nvcr.io/nvidia/osmo)
    image_tag: str = ""                              # empty → chart default (6.2)
    chart_version: str = ""                          # empty → latest
    kind_config_path: str = ""                       # empty → repo default
    extra_helm_sets: List[str] = dataclasses.field(default_factory=list)
    # metrics-server is OFF by default: the chart's HPAs can't actually scale
    # anyway (3 of 5 target Deployments have no resources.requests set), so it
    # only buys ``kubectl top`` which smoke/router tests don't need. Opt in
    # when testing HPA-dependent features.
    install_metrics_server: bool = False
    # Called after cluster exists but before helm install. Used by --build-local
    # to build + kind-load images. Signature: hook(cluster_name: str) -> None.
    pre_install_hook: Optional[Callable[[str], None]] = None
    # When True, helm install adds overrides that make the chart use
    # kind-loaded images (imagePullPolicy=IfNotPresent so the pseudo-registry
    # ``osmo.local`` isn't actually contacted) and skips the web-ui Deployment
    # (we don't build the UI image locally — only the 9 Python services).
    build_local: bool = False
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
        """CPU-only path. Matches the public deploy_local.html CPU guide.

        The bundled KIND config (``data/kind-osmo-cluster-config.yaml``) is a
        6-node cluster with distinct ``node_group`` labels, and one targeted
        ``--set ingress-nginx.controller.nodeSelector.node_group=service``
        lives in :meth:`_helm_install` (the public config doesn't define a
        ``node_group=ingress`` worker despite the chart defaulting to it).

        Workflow task pods the backend operator generates reference
        ``runtimeClassName: nvidia`` — in production this is provided by
        ``gpu-operator``. On CPU-only KIND we stub it with the default
        ``runc`` handler so pods can be admitted. The stub lives here
        because it's a CPU-mode-specific shim; GPU mode will install the
        real RuntimeClass via gpu-operator.

        Returns True if the cluster pre-existed (i.e., this is a re-deploy
        and ``deploy()`` should run a rollout restart so newly kind-loaded
        images are picked up by running pods).
        """
        cluster_existed = self._create_cluster_if_missing(cluster_name)
        self._install_kai_scheduler()
        if self.install_metrics_server:
            self._install_metrics_server()
        self._apply_nvidia_runtimeclass_stub()
        if self.pre_install_hook is not None:
            self.pre_install_hook(cluster_name)
        self._helm_repo_add()
        self._helm_install()
        return cluster_existed

    def pre_deploy_check(self, params: DeployParams) -> None:
        """Refuse to silently revert a build-local cluster to NGC images.

        Re-deploying without ``--build-local`` over an existing build-local
        release would helm-upgrade ``global.osmoImageLocation`` and
        ``imagePullPolicy`` back to chart defaults, causing every osmo
        Deployment to roll over to ``nvcr.io/nvidia/osmo:6.2`` and
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

        Restarts every Deployment in the ``osmo`` namespace; the wall-clock
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

    def _apply_nvidia_runtimeclass_stub(self) -> None:
        """CPU-mode shim: create stub ``nvidia`` RuntimeClass with runc handler.

        Chart-generated workflow task pods set ``runtimeClassName: nvidia``.
        Without gpu-operator, the k8s admission check rejects the pod with
        ``RuntimeClass "nvidia" not found`` (HTTP 403).
        """
        manifest = (
            "apiVersion: node.k8s.io/v1\n"
            "kind: RuntimeClass\n"
            "metadata:\n"
            "  name: nvidia\n"
            "handler: runc\n"
        )
        runner = self.subprocess_runner or subprocess.run
        logger.info("▶ Applying nvidia RuntimeClass stub (CPU mode)")
        result = runner(
            ["kubectl", "apply", "-f", "-"],
            check=False, input=manifest, text=True,
        )
        if _returncode(result) != 0:
            raise RuntimeError("Failed to apply nvidia RuntimeClass stub")

    def _deploy_gpu(self, cluster_name: str) -> bool:
        """GPU path. Not yet implemented.

        Planned shape (public deploy_local.html Option A):

        * Create the cluster with ``nvkind cluster create --config-template=...``
          (NVIDIA's KIND wrapper that injects the ``nvidia-container-runtime``
          and GPU device mounts).
        * Install ``gpu-operator`` from NGC — this provides the real
          ``nvidia`` RuntimeClass, device plugin, and node labeling.
        * Install ``kai-scheduler`` the same way as CPU path.
        * Install ``osmo/quick-start`` with no overrides (gpu-operator's
          RuntimeClass + multi-node labels satisfy all chart defaults).
        * ``_wait_for_health`` as usual.

        Prerequisites beyond CPU mode:
          - Host has NVIDIA GPU + driver installed
          - ``nvkind`` installed (``go install github.com/nvidia/nvkind@...``)
          - ``gpu-operator`` values file tailored to ``driver.enabled=false``
            (the host driver is used, not a container-installed one)
        """
        del cluster_name
        raise NotImplementedError(
            "GPU mode is not yet implemented. Planned path: nvkind + "
            "gpu-operator per nvidia.github.io/OSMO/deployment_guide/"
            "appendix/deploy_local.html (Option A). Use --mode cpu for "
            "CPU-only hosts."
        )

    def configure(self, env: EnvironmentConfig) -> None:
        # Multi-node KIND config matches the chart's node_group defaults, so
        # no post-install patching is needed — the chart installs clean.
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
            return True
        config_path = self.kind_config_path or _default_kind_config_path()
        # Don't pre-check ``os.path.isfile(config_path)``: kind's own error
        # message ("could not find a config file…") is already actionable,
        # and a TOCTOU pre-check duplicates the failure mode without adding
        # information.
        self._run(
            ["kind", "create", "cluster", "--name", cluster_name, "--config", config_path],
            "Creating KIND cluster",
        )
        return False

    def _helm_repo_add(self) -> None:
        """Ensure the osmo helm repo is registered and up to date."""
        self._ensure_helm_repo(OSMO_HELM_REPO_NAME, OSMO_HELM_REPO_URL)
        self._run(["helm", "repo", "update", OSMO_HELM_REPO_NAME], "Updating osmo helm repo")

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

    def _install_kai_scheduler(self) -> None:
        """Install kai-scheduler if it isn't already present.

        osmo/quick-start schedules pods with ``schedulerName: kai-scheduler``;
        without it they stay ``Pending`` forever. The public deploy_local.html
        guide lists this as a pre-install step.
        """
        if self._helm_release_installed("kai-scheduler", KAI_SCHEDULER_NAMESPACE):
            logger.info("▶ kai-scheduler already installed — skipping")
            return
        # Note: intentionally not passing ``--wait`` here. kai-scheduler's
        # ``SchedulingShard`` custom resource can stay in the ``Reconciling``
        # phase for 10+ minutes on CPU-only hosts even after all pods are
        # Ready — helm's ``--wait`` checks the CR status condition, so it
        # gives up with ``context deadline exceeded``. Instead we install
        # and then block on pod readiness via ``kubectl wait``.
        # Match the public deploy_local.html guide exactly — pin kai-scheduler
        # pods to the dedicated ``node_group=kai-scheduler`` worker defined in
        # our KIND config.
        self._run(
            [
                "helm", "upgrade", "--install", "kai-scheduler",
                KAI_SCHEDULER_CHART, "--version", KAI_SCHEDULER_VERSION,
                "--create-namespace", "-n", KAI_SCHEDULER_NAMESPACE,
                "--set", "global.nodeSelector.node_group=kai-scheduler",
                "--set", "scheduler.additionalArgs[0]=--default-staleness-grace-period=-1s",
                "--set", "scheduler.additionalArgs[1]=--update-pod-eviction-condition=true",
            ],
            "Installing kai-scheduler (without --wait; pod readiness checked separately)",
        )
        self._run(
            [
                "kubectl", "wait", "--for=condition=Ready", "pods", "--all",
                "-n", KAI_SCHEDULER_NAMESPACE, "--timeout=10m",
            ],
            "Waiting for kai-scheduler pods to be Ready",
        )

    def _install_metrics_server(self) -> None:
        """Install metrics-server so quick-start's HPAs can reach Ready.

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
        # Note: intentionally not passing ``--wait``. The chart's HPAs target
        # CPU/memory utilization but the referenced Deployments don't all set
        # ``resources.requests`` — so HPA status stays ``ScalingActive=False``
        # forever, and ``helm --wait`` blocks indefinitely even with
        # metrics-server installed. We use ``kubectl wait`` on the actual
        # Deployments (more meaningful anyway).
        args = [
            "helm", "upgrade", "--install", "osmo", OSMO_CHART_REF,
            "--namespace", OSMO_NAMESPACE, "--create-namespace",
            # First-run image pulls on CPU hosts can easily exceed 15 min;
            # subsequent runs re-use the docker image cache and are much faster.
            "--timeout", "25m",
            # The public deploy_local.html CPU config has no ``node_group=ingress``
            # worker — the ingress NodePort is mapped on the port-80 ``service``
            # node. Current chart (1.2.1) pins ingress-nginx to
            # ``node_group=ingress`` by default, so we retarget it to the
            # correct node.
            "--set", "ingress-nginx.controller.nodeSelector.node_group=service",
            # Bump osmo-agent memory: chart default is 500Mi, but post-Python-3.14
            # the agent OOMKills under workflow scheduling load (kubelet exit 137,
            # workflows stick in PENDING/PROCESSING because the agent isn't reachable
            # to bridge to the compute backend). Upstream chart fix is pending; this
            # is the minimum override that keeps KIND deploys stable.
            "--set", "service.services.agent.resources.requests.memory=1Gi",
            "--set", "service.services.agent.resources.limits.memory=1Gi",
        ]
        if self.chart_version:
            args += ["--version", self.chart_version]
        if self.image_location:
            args += ["--set", f"global.osmoImageLocation={self.image_location}"]
        if self.image_tag:
            args += ["--set", f"global.osmoImageTag={self.image_tag}"]
        if self.build_local:
            args += _build_local_helm_args()
        for extra in self.extra_helm_sets:
            args += ["--set", extra]
        self._run(args, "Installing osmo/quick-start (without --wait)")
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


def list_chart_versions(chart_ref: str = OSMO_CHART_REF) -> List[Dict[str, str]]:
    """Return the list of available ``osmo/quick-start`` chart versions.

    Each entry is ``{name, version, app_version, description}``. Requires
    the helm binary and that ``helm repo add osmo …`` has been run at least
    once. Runs ``helm repo update`` first so results are fresh.
    """
    subprocess.run(
        ["helm", "repo", "update", OSMO_HELM_REPO_NAME],
        check=False, capture_output=True,
    )
    result = subprocess.run(
        ["helm", "search", "repo", chart_ref, "--versions", "--output", "json"],
        check=False, capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"helm search failed (exit {result.returncode}): {result.stderr[:200]}"
        )
    if not result.stdout.strip():
        return []
    return json.loads(result.stdout)


def print_chart_versions() -> int:
    """Print the available osmo/quick-start chart versions; return an exit code.

    Shared by ``oetf:deploy --list-versions`` and ``oetf:deploy_and_run
    --list-versions``. Returns 0 on success (even with no versions found),
    non-zero only if the helm-side query fails.
    """
    try:
        versions = list_chart_versions()
    except Exception as error:  # pylint: disable=broad-except
        print(f"ERROR: {error}", file=sys.stderr)
        print("NEXT:  run 'helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo' first",
              file=sys.stderr)
        return 1
    if not versions:
        print("No versions found for osmo/quick-start.")
        return 0
    chart_col = "CHART VERSION"
    app_col = "APP VERSION"
    header = f"{chart_col:<18}{app_col:<14}DESCRIPTION"
    print(header)
    print("-" * len(header))
    for entry in versions:
        version = entry.get("version", "")
        app_version = entry.get("app_version", "")
        description = entry.get("description", "")
        print(f"{version:<18}{app_version:<14}{description}")
    return 0


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
