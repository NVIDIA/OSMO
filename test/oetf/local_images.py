"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Build OSMO service images from local source and load them into a KIND cluster.
#
# Used by ``oetf:deploy --build-local`` to bridge local code changes to a
# local ``osmo/quick-start`` install:
#
#   1. For each service, run the Bazel ``*_image_load_<arch>`` target — this
#      builds the OCI image and loads it into the host docker daemon with tag
#      ``osmo.local/<service>:latest-<arch>``.
#   2. ``kind load docker-image`` each tag into the KIND cluster's nodes.
#
# After this runs, pass ``--image-location=osmo.local`` and
# ``--image-tag=latest-<arch>`` to ``helm upgrade --install osmo/quick-start``
# (the adapter does this automatically in ``--build-local`` mode).
#
# The web-ui build uses a separate docker buildx path (see build_and_load_ui)
# because its Dockerfile is multi-stage Next.js, not bazel oci_image.
# Out of scope: ``init-container`` + ``client`` (CLI) need a docker re-tag step.

import concurrent.futures
import dataclasses
import logging
import os
import platform
import subprocess
import tempfile
from typing import Dict, List, Literal

HostArch = Literal["arm64", "x86_64"]

# Bazel target for the cross-compile transition (Linux/<arch>). Without this,
# rules_python resolves wheels for the bazel host platform, so macOS hosts
# bundle Darwin wheels into the OCI image and fail at container runtime.
LINUX_PLATFORM_PREFIX = "@osmo_workspace//bzl/platforms:linux_"

logger = logging.getLogger(__name__)


@dataclasses.dataclass(frozen=True)
class ImageSpec:
    """A single OSMO image that can be built locally and loaded into KIND."""
    short_name: str            # user-facing selector, e.g., 'service'
    bazel_target: str          # '//src/service/core:service_image_load_{arch}'
    docker_tag: str            # 'osmo.local/service:latest-{arch}'


def _t(tmpl: str, arch: HostArch) -> str:
    return tmpl.format(arch=arch)


def image_specs(arch: HostArch) -> List[ImageSpec]:
    """Return the set of OSMO images that build cleanly with oci_load + repo_tags.

    The 10 Python service images here all produce ``osmo.local/<svc>:latest-<arch>``
    directly, matching the ``global.osmoImageLocation=osmo.local`` +
    ``global.osmoImageTag=latest-<arch>`` overrides quick-start accepts.
    """
    return [
        ImageSpec(
            "service",
            _t("//src/service/core:service_image_load_{arch}", arch),
            _t("osmo.local/service:latest-{arch}", arch),
        ),
        ImageSpec(
            "agent",
            _t("//src/service/agent:agent_service_image_load_{arch}", arch),
            _t("osmo.local/agent:latest-{arch}", arch),
        ),
        ImageSpec(
            "mcp",
            _t("//src/service/mcp:mcp_image_load_{arch}", arch),
            _t("osmo.local/mcp-self-hosted:latest-{arch}", arch),
        ),
        ImageSpec(
            "logger",
            _t("//src/service/logger:logger_image_load_{arch}", arch),
            _t("osmo.local/logger:latest-{arch}", arch),
        ),
        ImageSpec(
            "worker",
            _t("//src/service/worker:worker_image_load_{arch}", arch),
            _t("osmo.local/worker:latest-{arch}", arch),
        ),
        ImageSpec(
            "delayed-job-monitor",
            # pylint: disable-next=line-too-long
            _t("//src/service/delayed_job_monitor:delayed_job_monitor_image_load_{arch}", arch),
            _t("osmo.local/delayed-job-monitor:latest-{arch}", arch),
        ),
        ImageSpec(
            "router",
            _t("//src/service/router:router_image_load_{arch}", arch),
            _t("osmo.local/router:latest-{arch}", arch),
        ),
        ImageSpec(
            "authz-sidecar",
            _t("//src/service/authz_sidecar:authz_sidecar_image_load_{arch}", arch),
            _t("osmo.local/authz-sidecar:latest-{arch}", arch),
        ),
        ImageSpec(
            "backend-listener",
            _t("//src/operator:backend_listener_image_load_{arch}", arch),
            _t("osmo.local/backend-listener:latest-{arch}", arch),
        ),
        ImageSpec(
            "backend-worker",
            _t("//src/operator:backend_worker_image_load_{arch}", arch),
            _t("osmo.local/backend-worker:latest-{arch}", arch),
        ),
    ]


def detect_arch() -> HostArch:
    """Return 'x86_64' or 'arm64' based on the host's processor."""
    machine = platform.machine().lower()
    if machine in ("x86_64", "amd64"):
        return "x86_64"
    if machine in ("arm64", "aarch64"):
        return "arm64"
    raise RuntimeError(f"Unsupported architecture: {machine}")


def _platforms_flag(arch: HostArch) -> str:
    """Return the bazel ``--platforms`` value that targets Linux/<arch>.

    Without this, bazel resolves ``rules_python`` wheels for the host
    platform — on macOS that means ``macosx_11_0_arm64`` wheels with
    Darwin-native ``.so`` files, which fail to load inside Linux containers
    with ``ModuleNotFoundError: No module named 'pydantic_core._pydantic_core'``.
    """
    return f"--platforms={LINUX_PLATFORM_PREFIX}{arch}"


def select_images(specs: List[ImageSpec], selector: str) -> List[ImageSpec]:
    """Filter ``specs`` by short_name; ``"all"`` means no filter.

    Raises ``RuntimeError`` listing unknown names if ``selector`` references
    short_names that aren't in ``specs``.
    """
    if selector == "all":
        return list(specs)
    wanted = {s.strip() for s in selector.split(",") if s.strip()}
    available = {s.short_name for s in specs}
    missing = wanted - available
    if missing:
        sep = ", "
        raise RuntimeError(
            f"Unknown image short_names: {sep.join(sorted(missing))}. "
            f"Available: {sep.join(sorted(available))}"
        )
    return [s for s in specs if s.short_name in wanted]


WEB_UI_SHORT_NAME = "web-ui"


def should_build_ui(image_selector: str) -> bool:
    """Return True if the UI should be built for this --build-images selector.

    ``"all"`` includes UI; an explicit comma-separated list includes UI iff
    ``"web-ui"`` is in the list. Empty/whitespace tokens are ignored to match
    ``select_images``.
    """
    if image_selector == "all":
        return True
    wanted = {s.strip() for s in image_selector.split(",") if s.strip()}
    return WEB_UI_SHORT_NAME in wanted


def build_and_load(
    images: List[ImageSpec],
    cluster_name: str,
    arch: HostArch,
    skip_kind_load: bool = False,
) -> None:
    """Build each image via bazel and load it into the named KIND cluster.

    Cross-compiles to ``linux/<arch>`` regardless of host OS (see
    :func:`_platforms_flag`).

    Uses ``bazel build --output_groups=+tarball`` + ``docker load -i``
    instead of ``bazel run :<target>_image_load`` — the latter's runtime
    script assumes a pre-bzlmod runfiles layout (``$RUNFILES_DIR/_main/
    external/<repo>/...``) that bazel does not materialize when the image
    target lives in an external repo and ``ctx.workspace_name`` resolves
    to ``_main``. Build-then-docker-load sidesteps that entirely.

    All bazel targets are built in a single invocation (parallelized by
    bazel) and the docker/kind loads then run concurrently. Raises on
    first failure. Caller is expected to have docker + bazel + kind
    installed (pre-flight verifies this).
    """
    if not images:
        return
    workspace = os.environ.get("BUILD_WORKSPACE_DIRECTORY", os.getcwd())
    platforms = _platforms_flag(arch)
    targets = [image.bazel_target for image in images]

    logger.info("▶ Building %d image(s): %s",
                len(images), ", ".join(i.short_name for i in images))
    # --remote_download_outputs=all overrides the project's default
    # `build --remote_download_outputs=minimal` in .bazelrc — without it,
    # disk-cache hits leave tarball.tar as a reference-only artifact and
    # the downstream `docker load -i bazel-out/.../tarball.tar` fails with
    # `no such file or directory`. Surfaces only when the disk cache is
    # warm (cold runs execute the action locally and materialize anyway).
    subprocess.run(
        ["bazel", "build", platforms,
         "--remote_download_outputs=all",
         "--output_groups=+tarball", *targets],
        check=True, cwd=workspace,
    )
    tarball_paths = _tarball_paths(targets, platforms, workspace)

    def _load_one(image: ImageSpec, tarball: str) -> None:
        logger.info("▶ docker load -i %s", tarball)
        subprocess.run(["docker", "load", "-i", tarball], check=True, cwd=workspace)
        if skip_kind_load:
            return
        logger.info("▶ kind load %s → cluster '%s'", image.docker_tag, cluster_name)
        subprocess.run(
            ["kind", "load", "docker-image", image.docker_tag, "--name", cluster_name],
            check=True,
        )
        # Each KIND node now owns its own containerd copy; the host's docker
        # daemon copy and the on-disk tarball are redundant. Reclaim them.
        # On hosted CI (e.g. GHA ubuntu-latest 145 GB / volume) the
        # 9 × 6-node duplication crowds out the runner mid-run without
        # this intra-step cleanup. `|| true` is intentional — cleanup
        # failure must not break the build flow.
        subprocess.run(
            ["docker", "rmi", "-f", image.docker_tag],
            check=False, cwd=workspace,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            tarball_abs = (
                tarball if os.path.isabs(tarball) else os.path.join(workspace, tarball)
            )
            if os.path.isfile(tarball_abs):
                os.remove(tarball_abs)
        except OSError:
            pass

    # Cap concurrency at 8: docker load is I/O-bound and `kind load`
    # serializes inside containerd anyway; more workers buy nothing.
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(images), 8)) as pool:
        list(pool.map(_load_one, images, tarball_paths))


# --- Local-registry push path (used when --build-local --use-local-registry) ---
#
# The default build_and_load path uses `kind load docker-image` which copies
# each image into every KIND node's separate containerd content store. With
# the chart's 6-node profile and 9 service images that is 54 image-copies
# of duplicated storage, which exhausts the disk on small CI runners
# (e.g. GitHub Actions ubuntu-latest 145 GB).
#
# The registry path replaces `kind load` with a `docker push` to a host-
# local `registry:2` container. KIND nodes are configured (via
# `containerdConfigPatches` + a per-node `hosts.toml`) to resolve
# `localhost:5001` to that registry. Each node then pulls *only* the images
# its pods schedule — for our chart that's 1-2 nodes per image, dropping
# the on-disk multiplier from 6x to 1-2x.

LOCAL_REGISTRY_NAME = "kind-registry"
LOCAL_REGISTRY_PORT_HOST = 5001
LOCAL_REGISTRY_PORT_CONTAINER = 5000
LOCAL_REGISTRY_HOSTNAME = LOCAL_REGISTRY_NAME  # how KIND nodes reach it via docker network
LOCAL_REGISTRY_IMAGE_LOCATION = f"localhost:{LOCAL_REGISTRY_PORT_HOST}/osmo"


def registry_image_location() -> str:
    """Return the ``global.osmoImageLocation`` value when using the local registry."""
    return LOCAL_REGISTRY_IMAGE_LOCATION


def build_and_push_to_registry(
    images: List[ImageSpec],
    arch: HostArch,
) -> None:
    """Build each image via bazel, retag for the local registry, and docker push.

    Single bazel build (same as :func:`build_and_load`) materializes
    tarballs, docker-loads each, retags from ``osmo.local/<svc>:tag`` to
    ``localhost:5001/osmo/<svc>:tag``, and docker-pushes. The local
    ``registry:2`` container deduplicates layers across images, so the
    on-host registry storage is much smaller than the union of individual
    OCI tarballs would be.

    The host's docker daemon copies + bazel-out tarballs are deleted
    immediately after each successful push — they aren't needed once the
    layer is in the registry, and CI runners with tight disk budgets
    benefit from the intra-step reclaim.
    """
    if not images:
        return
    workspace = os.environ.get("BUILD_WORKSPACE_DIRECTORY", os.getcwd())
    platforms = _platforms_flag(arch)
    targets = [image.bazel_target for image in images]

    logger.info("▶ Building %d image(s) for registry push: %s",
                len(images), ", ".join(i.short_name for i in images))
    subprocess.run(
        ["bazel", "build", platforms,
         "--remote_download_outputs=all",
         "--output_groups=+tarball", *targets],
        check=True, cwd=workspace,
    )
    tarball_paths = _tarball_paths(targets, platforms, workspace)

    def _push_one(image: ImageSpec, tarball: str) -> None:
        # docker_tag is the bazel oci_load tag (osmo.local/<svc>:<arch-tag>).
        registry_tag = image.docker_tag.replace(
            image_location(), LOCAL_REGISTRY_IMAGE_LOCATION,
        )
        logger.info("▶ docker load -i %s", tarball)
        subprocess.run(["docker", "load", "-i", tarball], check=True, cwd=workspace)
        logger.info("▶ docker tag %s %s", image.docker_tag, registry_tag)
        subprocess.run(
            ["docker", "tag", image.docker_tag, registry_tag],
            check=True, cwd=workspace,
        )
        logger.info("▶ docker push %s", registry_tag)
        subprocess.run(
            ["docker", "push", registry_tag],
            check=True, cwd=workspace,
        )
        # Reclaim host docker storage + bazel-out tarball — registry has
        # the layers now. `|| true`-style: cleanup must not break the run.
        for tag in (image.docker_tag, registry_tag):
            subprocess.run(
                ["docker", "rmi", "-f", tag],
                check=False, cwd=workspace,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        try:
            tarball_abs = (
                os.path.join(workspace, tarball)
                if not os.path.isabs(tarball) else tarball
            )
            if os.path.isfile(tarball_abs):
                os.remove(tarball_abs)
        except OSError:
            pass

    # Concurrency cap matches build_and_load: registry pushes are
    # I/O-bound on the same host docker daemon + bazel-out filesystem.
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(images), 8)) as pool:
        list(pool.map(_push_one, images, tarball_paths))


def ensure_local_registry() -> None:
    """Start the ``kind-registry`` container if it isn't already running.

    Idempotent: a no-op when the container already exists. Listens on
    ``127.0.0.1:5001`` so the host can `docker push` to it; KIND nodes
    reach it as ``http://kind-registry:5000`` after the kind docker
    network is connected (see :func:`connect_registry_to_kind`).
    """
    inspect = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", LOCAL_REGISTRY_NAME],
        check=False, capture_output=True, text=True,
    )
    running = inspect.returncode == 0 and inspect.stdout.strip() == "true"
    if running:
        logger.info("▶ kind-registry already running — reusing")
        return
    if inspect.returncode == 0:
        # Exists but stopped — remove so we get a clean port binding.
        subprocess.run(
            ["docker", "rm", "-f", LOCAL_REGISTRY_NAME],
            check=False, capture_output=True,
        )
    logger.info("▶ Starting kind-registry container (registry:2)")
    subprocess.run(
        ["docker", "run", "-d", "--restart=always",
         "-p", f"127.0.0.1:{LOCAL_REGISTRY_PORT_HOST}:{LOCAL_REGISTRY_PORT_CONTAINER}",
         "--network", "bridge",
         "--name", LOCAL_REGISTRY_NAME,
         "registry:2"],
        check=True, capture_output=True,
    )


def connect_registry_to_kind(cluster_name: str) -> None:
    """Connect the registry container to the kind docker network + write per-node
    containerd ``hosts.toml`` so `localhost:5001` resolves to the registry.

    Must run AFTER the KIND cluster is created (the ``kind`` docker network
    only exists once `kind create cluster` has run) and BEFORE helm install
    (kubelet needs the registry mapping in place when it pulls pod images).

    The KIND config must already include a ``containerdConfigPatches:``
    entry enabling ``config_path = "/etc/containerd/certs.d"`` — see
    :func:`patched_kind_config_with_registry`.
    """
    # Connect the registry to the kind network if not already connected. The
    # docker network connect command errors with "already exists in network"
    # if re-run; suppress that idempotently.
    subprocess.run(
        ["docker", "network", "connect", "kind", LOCAL_REGISTRY_NAME],
        check=False, capture_output=True,
    )

    # Per-node containerd hosts.toml: map localhost:5001 -> kind-registry:5000.
    hosts_toml = (
        f'[host."http://{LOCAL_REGISTRY_HOSTNAME}:{LOCAL_REGISTRY_PORT_CONTAINER}"]\n'
    )
    nodes_out = subprocess.run(
        ["kind", "get", "nodes", "--name", cluster_name],
        check=True, capture_output=True, text=True,
    )
    nodes = [n.strip() for n in nodes_out.stdout.splitlines() if n.strip()]
    cert_dir = f"/etc/containerd/certs.d/localhost:{LOCAL_REGISTRY_PORT_HOST}"
    for node in nodes:
        logger.info("▶ Wiring containerd hosts.toml on %s", node)
        subprocess.run(
            ["docker", "exec", node, "mkdir", "-p", cert_dir],
            check=True, capture_output=True,
        )
        subprocess.run(
            ["docker", "exec", "-i", node,
             "sh", "-c", f'cat > {cert_dir}/hosts.toml'],
            check=True, input=hosts_toml, text=True, capture_output=True,
        )


def patched_kind_config_with_registry(source_path: str) -> str:
    """Return a path to a KIND config that adds ``containerdConfigPatches``.

    Reads ``source_path`` (the bundled kind-osmo-cluster-config.yaml), and
    writes a copy to ``$TMPDIR`` with an injected ``containerdConfigPatches``
    block. The original config stays untouched — internal callers that
    don't use the registry are unaffected.

    Uses the standard KIND local-registry patch (config_path mode) so the
    per-node ``hosts.toml`` written by :func:`connect_registry_to_kind`
    takes effect.
    """
    with open(source_path, "r", encoding="utf-8") as src:
        content = src.read()
    patch = (
        "\ncontainerdConfigPatches:\n"
        "  - |-\n"
        '    [plugins."io.containerd.grpc.v1.cri".registry]\n'
        '      config_path = "/etc/containerd/certs.d"\n'
    )
    # Append at end; YAML parses top-level keys in any order.
    out_fd, out_path = tempfile.mkstemp(prefix="kind-osmo-registry-", suffix=".yaml")
    os.close(out_fd)
    with open(out_path, "w", encoding="utf-8") as dst:
        dst.write(content)
        if "containerdConfigPatches" not in content:
            dst.write(patch)
    return out_path


def _tarball_paths(
    bazel_targets: List[str], platforms: str, workspace: str,
) -> List[str]:
    """Resolve each oci_load target's ``tarball.tar`` output path in one cquery.

    Pass the same ``--platforms`` flag the build used so cquery resolves the
    same configured target (otherwise it resolves under the host platform and
    points at a stale or nonexistent tarball.tar). cquery requires the targets
    expressed as a single query — ``a + b + c`` (set union) — not as separate
    positional args. The returned paths preserve ``bazel_targets`` order via a
    label-keyed dict (cquery emits ``//pkg:name (config) /path/to/file`` per
    line, ordered by analysis but not by argv).
    """
    query = " + ".join(bazel_targets)
    result = subprocess.run(
        [
            "bazel", "cquery", platforms, query,
            "--output=files", "--output_groups=+tarball",
        ],
        check=True, cwd=workspace, text=True, capture_output=True,
    )
    by_target_name = _tarballs_by_target_name(result.stdout)
    missing: List[str] = []
    paths: List[str] = []
    for label in bazel_targets:
        target_name = label.rsplit(":", 1)[-1]
        if target_name not in by_target_name:
            missing.append(label)
            continue
        paths.append(by_target_name[target_name])
    if missing:
        raise RuntimeError(
            f"cquery did not return tarball.tar for: {missing}; "
            f"got: {result.stdout!r}"
        )
    return paths


def _tarballs_by_target_name(cquery_files_output: str) -> Dict[str, str]:
    """Parse cquery --output=files lines into a {target_name: tarball_path} map.

    cquery emits one path per line per target. We key each
    ``.../<target_dir>/tarball.tar`` by the parent directory name, which
    bazel-out uses as the target's label name.
    """
    by_name: Dict[str, str] = {}
    for line in cquery_files_output.splitlines():
        path = line.strip()
        if not path.endswith("tarball.tar"):
            continue
        target_name = os.path.basename(os.path.dirname(path))
        by_name[target_name] = path
    return by_name


WEB_UI_DOCKER_TAG_TEMPLATE = "osmo.local/web-ui:latest-{arch}"
# Two layouts are valid: the internal overlay mounts the public OSMO repo at
# external/ (UI lives at external/src/ui), while a standalone public checkout
# has UI directly at src/ui. Tried in order — first existing path wins.
_UI_SOURCE_RELPATH_CANDIDATES = ("external/src/ui", "src/ui")


def _ui_dir(workspace: str) -> str:
    """Resolve the UI source directory for the current workspace layout.

    Internal overlay: ``<workspace>/external/src/ui``.
    Public standalone checkout: ``<workspace>/src/ui``.

    Falls back to the first candidate if neither exists so the downstream
    ``docker buildx build`` produces the same actionable "path not found"
    error a hardcoded path would have produced.
    """
    for candidate in _UI_SOURCE_RELPATH_CANDIDATES:
        path = os.path.join(workspace, candidate)
        if os.path.isdir(path):
            return path
    return os.path.join(workspace, _UI_SOURCE_RELPATH_CANDIDATES[0])


def _buildx_platform(arch: HostArch) -> str:
    """Translate ``HostArch`` to the docker buildx ``--platform`` value.

    Docker buildx uses ``linux/amd64`` for x86_64 (NOT ``linux/x86_64`` —
    that's a kernel arch name, not an OCI platform identifier). ARM64 is
    consistent.
    """
    if arch == "x86_64":
        return "linux/amd64"
    if arch == "arm64":
        return "linux/arm64"
    raise RuntimeError(f"Unsupported architecture: {arch}")


def build_and_load_ui(
    cluster_name: str,
    arch: HostArch,
    skip_kind_load: bool = False,
) -> None:
    """Build the web-ui image via docker buildx and load it into KIND.

    The web-ui build is genuinely different from the 9 Python service
    images: it uses a multi-stage Next.js Dockerfile (deps → builder →
    distroless runner with ``output: 'standalone'``), not bazel's
    ``oci_image``. We invoke ``docker buildx build --load`` directly,
    bypassing both bazel and the existing ``build_push_web_ui_<arch>.sh``
    script (which does ``--push`` to a registry — wrong for local KIND).

    The build picks up Dockerfile defaults for ``NEXT_PUBLIC_BASE_PATH``,
    ``NODE_BUILD_IMAGE``, etc.; CI's push-path uses the same defaults, so
    image content stays identical across local and CI.
    """
    workspace = os.environ.get("BUILD_WORKSPACE_DIRECTORY", os.getcwd())
    ui_dir = _ui_dir(workspace)
    tag = WEB_UI_DOCKER_TAG_TEMPLATE.format(arch=arch)
    buildx_platform = _buildx_platform(arch)

    logger.info("▶ Building web-ui (%s, docker buildx --load)", buildx_platform)
    subprocess.run(
        ["docker", "buildx", "build",
         "--platform", buildx_platform,
         "-t", tag,
         "--load",
         ui_dir],
        check=True, cwd=workspace,
    )
    if skip_kind_load:
        return
    logger.info("▶ kind load %s → cluster '%s'", tag, cluster_name)
    subprocess.run(
        ["kind", "load", "docker-image", tag, "--name", cluster_name],
        check=True,
    )


def build_and_push_ui_to_registry(arch: HostArch) -> None:
    """Build the web-ui image and push to the local registry.

    Mirrors :func:`build_and_load_ui` but skips ``kind load`` in favor of
    a ``docker push`` to ``localhost:5001/osmo/web-ui:latest-<arch>``. The
    chart's ingress-nginx has a hard ``wait-for-web-ui`` init container
    dependency, so the web-ui Deployment must actually come up — scaling
    it to ``replicas=0`` deadlocks the entire stack. Pushing to the
    registry keeps disk impact to a single host-side copy (no 6x KIND-
    node duplication).

    Cleans up host docker storage after push: the registry has the layers
    now, and the built image alone is ~3 GB.
    """
    workspace = os.environ.get("BUILD_WORKSPACE_DIRECTORY", os.getcwd())
    ui_dir = _ui_dir(workspace)
    buildx_platform = _buildx_platform(arch)
    registry_tag = (
        f"{LOCAL_REGISTRY_IMAGE_LOCATION}/web-ui:latest-{arch}"
    )

    logger.info("▶ Building web-ui (%s, docker buildx --load) for registry push",
                buildx_platform)
    subprocess.run(
        ["docker", "buildx", "build",
         "--platform", buildx_platform,
         "-t", registry_tag,
         "--load",
         ui_dir],
        check=True, cwd=workspace,
    )
    logger.info("▶ docker push %s", registry_tag)
    subprocess.run(
        ["docker", "push", registry_tag],
        check=True, cwd=workspace,
    )
    # Reclaim host docker storage — registry has the layers now.
    subprocess.run(
        ["docker", "rmi", "-f", registry_tag],
        check=False, cwd=workspace,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def image_tag(arch: HostArch | None = None) -> str:
    """Return the tag to use for ``global.osmoImageTag`` when deploying local."""
    return f"latest-{arch or detect_arch()}"


def image_location() -> str:
    """Return the docker registry prefix used by local image tags."""
    return "osmo.local"
