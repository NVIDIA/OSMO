"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Adapter construction for the deploy + teardown entry-point binaries.
#
# Registry-based dispatch (`_DEPLOY_BUILDERS` / `_TEARDOWN_BUILDERS`) so that
# overlay packages can call `register_adapter()` to add their own DeployAdapter
# implementations. The internal `dev_adapter` module is imported optionally so
# the same factory.py works whether or not dev_adapter is present in the build
# (public OETF distributions ship without it).

import argparse
import concurrent.futures
import logging
from typing import Callable, Dict, Tuple

from test.oetf import local_images
from test.oetf.deploy_adapters.base import DeployAdapter
from test.oetf.deploy_adapters.kind_adapter import KindAdapter
from test.oetf.deploy_adapters.noop_adapter import NoopAdapter
from test.oetf.models import EnvironmentConfig
from test.oetf.preflight import PreflightError

logger = logging.getLogger(__name__)


# Optional dev adapter + its dev_argocd companion module — present only when
# a downstream overlay package adds them to the runfiles tree. In the public
# copy of OETF these imports fail (dev_adapter.py / dev_argocd.py are not
# shipped); the "dev" env type then becomes unavailable with a clear error at
# build_adapter() time. Overlay packages register it via `register_adapter()`
# from a plugin.py shim. Any exception other than ModuleNotFoundError logs a
# WARNING so silent ImportError swallowing doesn't hide real bugs.
try:
    # type-ignored: mypy correctly observes that these modules don't exist in
    # the public tree (the optional-import block exists precisely so they can
    # be absent). They DO exist when a downstream overlay package adds them
    # to the runfiles tree; the runtime try/except handles both cases.
    from test.oetf import dev_argocd  # type: ignore[attr-defined]
    from test.oetf.deploy_adapters.dev_adapter import DevAdapter  # type: ignore[import-not-found]
    _DEV_ADAPTER_AVAILABLE = True
except ImportError:
    # Catches both:
    # - ModuleNotFoundError: the module/file is absent (public-OETF case).
    # - ImportError: the name doesn't exist as an attribute of the package
    #   (e.g. `from test.oetf import dev_argocd` when test/oetf/dev_argocd.py
    #   isn't shipped — the package is a PEP 420 namespace package and the
    #   missing-attribute case lands here, not in ModuleNotFoundError).
    # Both are silent-and-expected; exotic failures fall through to below.
    dev_argocd = None  # type: ignore[assignment]
    DevAdapter = None  # type: ignore[assignment, misc]  # pylint: disable=invalid-name
    _DEV_ADAPTER_AVAILABLE = False
except Exception as _exc:  # pylint: disable=broad-except
    logger.warning(
        "Unexpected error importing dev_adapter; dev env type will be "
        "unavailable: %s: %s", type(_exc).__name__, _exc,
    )
    dev_argocd = None  # type: ignore[assignment]
    DevAdapter = None  # type: ignore[assignment, misc]  # pylint: disable=invalid-name
    _DEV_ADAPTER_AVAILABLE = False


_KIND_ONLY_FLAGS: Tuple[Tuple[str, str], ...] = (
    # (argparse_dest, user-facing flag name)
    ("mode", "--mode"),
    ("cluster_name", "--cluster-name"),
    ("chart_version", "--chart-version"),
    ("build_images", "--build-images"),
    ("with_metrics_server", "--with-metrics-server"),
    ("extra_sets", "--extra-set"),
    ("list_versions", "--list-versions"),
)
_DEV_ONLY_FLAGS: Tuple[Tuple[str, str], ...] = (
    ("target_arch", "--target-arch"),
)


# Per-env-type flags that are inapplicable when env.type is the registered key.
# build_adapter() rejects flags from other env types as a cross-type bleed guard.
_OTHER_TYPES_FLAGS_FOR: Dict[str, Tuple[Tuple[Tuple[str, str], ...], str]] = {
    # When env.type is X, reject flags belonging to non-X env types.
    "kind": (_DEV_ONLY_FLAGS, "DEV"),
    "dev": (_KIND_ONLY_FLAGS, "KIND"),
}


DeployBuilder = Callable[[argparse.Namespace, EnvironmentConfig], DeployAdapter]
TeardownBuilder = Callable[[EnvironmentConfig], DeployAdapter]

_DEPLOY_BUILDERS: Dict[str, DeployBuilder] = {}
_TEARDOWN_BUILDERS: Dict[str, TeardownBuilder] = {}


def register_adapter(
    name: str,
    deploy_builder: DeployBuilder = None,  # type: ignore[assignment]
    teardown_builder: TeardownBuilder = None,  # type: ignore[assignment]
) -> None:
    """Register an adapter under ``name`` for deploy and/or teardown.

    Overlay packages call this from a plugin shim to inject their own
    DeployAdapter implementations into the factory. Pass ``deploy_builder``
    if the adapter supports deploy via ``oetf:{deploy,deploy_and_run}``;
    pass ``teardown_builder`` if it supports teardown via ``oetf:teardown``.
    Most adapters register both.

    Idempotent: re-registering the same ``name`` replaces the prior entry.
    """
    if deploy_builder is not None:
        _DEPLOY_BUILDERS[name] = deploy_builder
    if teardown_builder is not None:
        _TEARDOWN_BUILDERS[name] = teardown_builder


def registered_deploy_types() -> Tuple[str, ...]:
    """Return env types currently supported by deploy. Used for error messages."""
    return tuple(sorted(_DEPLOY_BUILDERS.keys()))


def registered_teardown_types() -> Tuple[str, ...]:
    """Return env types currently supported by teardown."""
    return tuple(sorted(_TEARDOWN_BUILDERS.keys()))


def build_adapter(args: argparse.Namespace, env: EnvironmentConfig) -> DeployAdapter:
    """Construct the right ``DeployAdapter`` for ``env.type`` from CLI args."""
    if env.type not in _DEPLOY_BUILDERS:
        raise ValueError(
            f"Unsupported env.type {env.type!r} for deploy. "
            f"Registered: {registered_deploy_types()}. "
            f"If you expected {env.type!r} to be available, ensure the "
            f"corresponding adapter package is registered via register_adapter()."
        )
    other_only_flags, other_kind = _OTHER_TYPES_FLAGS_FOR.get(env.type, ((), ""))
    if other_only_flags:
        _reject_inapplicable_flags(args, other_only_flags, env, other_kind)
    return _DEPLOY_BUILDERS[env.type](args, env)


def build_teardown_adapter(env: EnvironmentConfig) -> DeployAdapter:
    """Construct a ``DeployAdapter`` for tearing down ``env``.

    No CLI args: teardown is driven by env config + breadcrumb (cluster name
    overrides happen at the caller). For env types that map to a no-op
    teardown (e.g. ``custom``), this returns ``NoopAdapter``.
    """
    if env.type not in _TEARDOWN_BUILDERS:
        raise ValueError(
            f"Unsupported env.type {env.type!r} for teardown. "
            f"Registered: {registered_teardown_types()}."
        )
    return _TEARDOWN_BUILDERS[env.type](env)


def _reject_inapplicable_flags(
    args: argparse.Namespace,
    inapplicable: Tuple[Tuple[str, str], ...],
    env: EnvironmentConfig,
    flag_kind: str,
) -> None:
    """Raise ``PreflightError`` if any ``flag_kind``-only flag was passed.

    A flag is "passed" iff its parsed value differs from the argparse
    default (empty string / False / [] / "all"). ``--build-images`` defaults
    to ``"all"`` so we treat that as "not passed"; everything else is the
    natural empty/false default.
    """
    passed = []
    for dest, name in inapplicable:
        value = getattr(args, dest, None)
        if value in (None, "", False, [], "all"):
            continue
        passed.append(name)
    if not passed:
        return
    sep = ", "
    raise PreflightError(
        f"{flag_kind}-only flag(s) {sep.join(passed)} passed to env "
        f"'{env.name}' (type={env.type!r}); these have no effect on "
        f"{env.type} deploys and would silently be ignored.",
        f"drop the flag(s) for this env, or pass --env <a {flag_kind.lower()} env>",
    )


def _build_dev_adapter(args: argparse.Namespace, env: EnvironmentConfig):
    """Deploy-time builder for the dev adapter. Internal-only.

    Only registered when ``dev_adapter`` is importable (i.e. in internal
    OETF builds). Public copies of factory.py never reach this function.
    """
    if DevAdapter is None:
        raise ValueError(
            "Internal dev_adapter not available — register via overlay "
            "plugin.py before building a dev adapter."
        )
    image_registry = (
        getattr(args, "image_location", "")
        or env.image_registry
        or dev_argocd.DEFAULT_IMAGE_REGISTRY
    )
    raw_arch = getattr(args, "target_arch", "")
    target_arches = [a.strip() for a in raw_arch.split(",") if a.strip()]
    return DevAdapter(
        dev_user=env.dev_user,
        image_registry=image_registry,
        image_tag=getattr(args, "image_tag", ""),
        build_local=getattr(args, "build_local", False),
        target_arches=target_arches,
        argocd_branch=env.argocd_branch,
    )


def _build_kind_adapter(args: argparse.Namespace, env: EnvironmentConfig) -> KindAdapter:
    image_location = getattr(args, "image_location", "")
    image_tag = getattr(args, "image_tag", "")
    pre_install_hook = None
    build_local = getattr(args, "build_local", False)
    use_local_registry = getattr(args, "use_local_registry", False) and build_local
    if build_local:
        # Registry mode publishes images to localhost:5001/osmo and the
        # chart pulls from there; legacy --build-local stays on osmo.local
        # (pseudo-prefix never actually contacted thanks to IfNotPresent).
        image_location = (
            local_images.registry_image_location()
            if use_local_registry
            else local_images.image_location()
        )
        image_tag = local_images.image_tag()
        pre_install_hook = _make_build_local_hook(
            getattr(args, "build_images", "all"),
            use_local_registry=use_local_registry,
        )
    return KindAdapter(
        mode=getattr(args, "mode", None) or env.mode,
        image_location=image_location,
        image_tag=image_tag,
        chart_version=getattr(args, "chart_version", ""),
        extra_helm_sets=list(getattr(args, "extra_sets", []) or []),
        install_metrics_server=getattr(args, "with_metrics_server", False),
        pre_install_hook=pre_install_hook,
        build_local=build_local,
        use_local_registry=use_local_registry,
    )


def _build_kind_teardown_adapter(env: EnvironmentConfig) -> KindAdapter:
    del env
    return KindAdapter()


def _build_dev_teardown_adapter(env: EnvironmentConfig):
    if DevAdapter is None:
        raise ValueError(
            "Internal dev_adapter not available — register via overlay "
            "plugin.py before tearing down a dev env."
        )
    return DevAdapter(dev_user=env.dev_user)


def _build_custom_teardown_adapter(env: EnvironmentConfig) -> NoopAdapter:
    del env
    return NoopAdapter()


def _make_build_local_hook(image_selector: str, use_local_registry: bool = False):
    """Return a pre_install_hook callable that builds + ships local images.

    The 9 Python services build via bazel + oci_load + tarball; the web-ui
    builds via docker buildx (multi-stage Next.js Dockerfile). Independent
    pipelines, run concurrently for ~halved wall-clock vs. sequential.

    Two delivery paths:
      - default: ``kind load docker-image`` into every KIND node.
      - ``use_local_registry=True``: docker push to a host-side ``registry:2``
        container that the KIND nodes pull from on-demand. The 6x node-side
        containerd duplication is replaced with single-copy registry
        storage; required on disk-constrained CI runners.
    """
    def _hook(cluster_name: str) -> None:
        arch = local_images.detect_arch()
        all_specs = local_images.image_specs(arch)
        selected_services = local_images.select_images(all_specs, image_selector)
        build_ui = local_images.should_build_ui(image_selector)

        tasks = []
        if selected_services:
            if use_local_registry:
                tasks.append(("services", lambda: local_images.build_and_push_to_registry(
                    selected_services, arch=arch,
                )))
            else:
                tasks.append(("services", lambda: local_images.build_and_load(
                    selected_services, cluster_name, arch=arch,
                )))
        if build_ui:
            if use_local_registry:
                tasks.append(("web-ui", lambda: local_images.build_and_push_ui_to_registry(
                    arch=arch,
                )))
            else:
                tasks.append(("web-ui", lambda: local_images.build_and_load_ui(
                    cluster_name, arch=arch,
                )))

        if not tasks:
            return
        if len(tasks) == 1:
            tasks[0][1]()
            return

        # Both buckets non-empty: run concurrently. ThreadPoolExecutor is
        # fine — both tasks are subprocess-bound (bazel + docker buildx),
        # GIL not contended.
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = {pool.submit(fn): name for name, fn in tasks}
            try:
                for fut in concurrent.futures.as_completed(futures):
                    fut.result()  # raises on first failure
            finally:
                # Cancel any not-yet-started futures and wait for in-flight
                # ones to wind down, so a build-and-load failure doesn't leave
                # a runaway bazel/docker subprocess consuming CPU while
                # DeploySession is rolling back.
                pool.shutdown(wait=True, cancel_futures=True)
    return _hook


# --- Default registrations ---------------------------------------------------
# KindAdapter and NoopAdapter are always shipped with the framework.
# DevAdapter is registered only when its module imported successfully above
# (internal builds). External overlay packages call register_adapter("dev", ...)
# from a plugin.py shim to add it back when ship-time conditions differ.

register_adapter(
    "kind",
    deploy_builder=_build_kind_adapter,
    teardown_builder=_build_kind_teardown_adapter,
)
register_adapter(
    "custom",
    teardown_builder=_build_custom_teardown_adapter,
)
if _DEV_ADAPTER_AVAILABLE:
    register_adapter(
        "dev",
        deploy_builder=_build_dev_adapter,
        teardown_builder=_build_dev_teardown_adapter,
    )
