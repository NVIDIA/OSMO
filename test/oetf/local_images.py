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

    The 9 Python service images here all produce ``osmo.local/<svc>:latest-<arch>``
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

    # Cap concurrency at 8: docker load is I/O-bound and `kind load`
    # serializes inside containerd anyway; more workers buy nothing.
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(images), 8)) as pool:
        list(pool.map(_load_one, images, tarball_paths))


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


def image_tag(arch: HostArch | None = None) -> str:
    """Return the tag to use for ``global.osmoImageTag`` when deploying local."""
    return f"latest-{arch or detect_arch()}"


def image_location() -> str:
    """Return the docker registry prefix used by local image tags."""
    return "osmo.local"
