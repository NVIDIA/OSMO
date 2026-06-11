"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

package(default_visibility = ["//visibility:public"])

load("@osmo_workspace//bzl:py.bzl", "osmo_py_binary", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_library(
    name = "models",
    srcs = ["models.py"],
)

osmo_py_library(
    name = "local_images",
    srcs = ["local_images.py"],
)

osmo_py_library(
    name = "environments",
    srcs = ["environments.py"],
    data = ["data/oetf.default.yaml"],
    deps = [
        ":models",
        requirement("pyyaml"),
    ],
)

osmo_py_library(
    name = "preflight",
    srcs = ["preflight.py"],
    deps = [":models"],
)

osmo_py_library(
    name = "breadcrumb",
    srcs = ["breadcrumb.py"],
    deps = [":models"],
)

osmo_py_library(
    name = "cli_args",
    srcs = ["cli_args.py"],
)

osmo_py_library(
    name = "deploy_adapters_base",
    srcs = [
        "deploy_adapters/base.py",
        "deploy_adapters/noop_adapter.py",
    ],
    deps = [
        ":environments",
        ":models",
    ],
)

osmo_py_library(
    name = "deploy_adapters_kind",
    srcs = ["deploy_adapters/kind_adapter.py"],
    data = [
        "data/kind-osmo-cluster-config.yaml",
    ],
    deps = [
        ":deploy_adapters_base",
        ":environments",
        ":local_images",
        ":models",
        ":preflight",
        ":breadcrumb",
        requirement("pyyaml"),
    ],
)

# Internal-only `dev_argocd` and `deploy_adapters_dev` libraries are NOT
# shipped in the public OETF distribution. Internal overlay packages register
# `DevAdapter` via `register_adapter()` from a plugin.py shim. See
# `deploy_adapters/factory.py` for the optional-import pattern.

osmo_py_library(
    name = "deploy_adapters_factory",
    srcs = ["deploy_adapters/factory.py"],
    deps = [
        ":deploy_adapters_base",
        ":deploy_adapters_kind",
        ":local_images",
        ":models",
        ":preflight",
    ],
)

# Shared validation + adapter-build pipeline for the deploy / deploy_and_run
# entry-point binaries. Keeps the two main()s thin and consistent.
osmo_py_library(
    name = "deploy_pipeline",
    srcs = ["deploy_pipeline.py"],
    deps = [
        ":deploy_adapters_base",
        ":deploy_adapters_factory",
        ":deploy_adapters_kind",
        ":environments",
        ":models",
        ":preflight",
    ],
)

osmo_py_library(
    name = "auth",
    srcs = ["auth.py"],
    deps = [
        ":models",
        "//src/lib/utils:client",
        "//src/lib/utils:login",
    ],
)

osmo_py_library(
    name = "task_fixture",
    srcs = ["task_fixture.py"],
)

osmo_py_library(
    name = "osmo_cli",
    srcs = ["osmo_cli.py"],
    deps = [":models"],
)

osmo_py_library(
    name = "log_summary",
    srcs = ["log_summary.py"],
)

osmo_py_library(
    name = "reporter",
    srcs = ["reporter.py"],
)

osmo_py_library(
    name = "sinks",
    srcs = ["sinks.py"],
    deps = [requirement("boto3")],
)

osmo_py_library(
    name = "aggregate",
    srcs = ["aggregate.py"],
    deps = [
        ":reporter",
        ":sinks",
    ],
)

osmo_py_library(
    name = "fixture_base",
    srcs = ["fixture_base.py"],
    deps = [
        ":auth",
        ":models",
        ":reporter",
        "//src/lib/utils:client",
    ],
)

osmo_py_library(
    name = "smoke_fixture",
    srcs = ["smoke_fixture.py"],
    deps = [
        ":fixture_base",
        ":osmo_cli",
        "//src/lib/utils:client",
        "//src/lib/utils:osmo_errors",
    ],
)

osmo_py_library(
    name = "runner_fixture",
    srcs = ["runner_fixture.py"],
    data = ["task_fixture.py"],
    deps = [
        ":fixture_base",
        ":models",
        ":osmo_cli",
        ":task_fixture",
        "//src/cli",
        "//src/lib/utils:client",
        "//src/lib/utils:osmo_errors",
        requirement("pyyaml"),
        requirement("requests"),
    ],
)

# `run_lib`: the library form of main.py. Split from the binary so tests
# can import and patch individual functions without re-invoking __main__.
osmo_py_library(
    name = "run_lib",
    srcs = ["main.py"],
    data = ["data/oetf.default.yaml"],
    deps = [
        ":aggregate",
        ":auth",
        ":cli_args",
        ":environments",
        ":log_summary",
        ":models",
        ":osmo_cli",
        ":reporter",
        ":sinks",
        "//src/lib/utils:client",
    ],
)

# `oetf:run` wrapper: invokes `bazel test` via subprocess, parses the BEP
# stream, and prints a [PASS]/[FAIL] summary. Env config comes from
# data/oetf.default.yaml (canonical) + ~/.config/osmo/oetf.yaml (user
# overlay) + CLI flags.
osmo_py_binary(
    name = "run",
    main = "main.py",
    srcs = ["main.py"],
    data = [
        "data/categories.json",
        "data/oetf.default.yaml",
    ],
    deps = [
        ":aggregate",
        ":auth",
        ":cli_args",
        ":environments",
        ":log_summary",
        ":models",
        ":osmo_cli",
        ":reporter",
        ":sinks",
        "//src/lib/utils:client",
    ],
    tags = ["manual"],
)

# Deploy-only binary: spin up a KIND cluster and leave it running.
osmo_py_library(
    name = "deploy_main_lib",
    srcs = ["deploy_main.py"],
    deps = [
        ":breadcrumb",
        ":cli_args",
        ":deploy_adapters_base",
        ":deploy_adapters_kind",
        ":deploy_pipeline",
    ],
)

# Deploy-only binary: spin up a KIND cluster and leave it running.
# (Other DeployAdapter implementations register via factory.register_adapter
# in a downstream package.)
osmo_py_binary(
    name = "deploy",
    srcs = ["deploy_main.py"],
    main = "deploy_main.py",
    tags = ["manual"],
    deps = [":deploy_main_lib"],
)

osmo_py_library(
    name = "teardown_main",
    srcs = ["teardown_main.py"],
    deps = [
        ":breadcrumb",
        ":deploy_adapters_base",
        ":deploy_adapters_factory",
        ":environments",
    ],
)

# Teardown binary: read breadcrumb and destroy a deployed env.
osmo_py_binary(
    name = "teardown",
    srcs = ["teardown_main.py"],
    main = "teardown_main.py",
    tags = ["manual"],
    deps = [":teardown_main"],
)

osmo_py_library(
    name = "deploy_and_run_main_lib",
    srcs = ["deploy_and_run_main.py"],
    deps = [
        ":breadcrumb",
        ":cli_args",
        ":deploy_adapters_base",
        ":deploy_adapters_kind",
        ":deploy_pipeline",
        ":models",
    ],
)

# Compose: deploy → oetf:run → teardown.
osmo_py_binary(
    name = "deploy_and_run",
    srcs = ["deploy_and_run_main.py"],
    main = "deploy_and_run_main.py",
    tags = ["manual"],
    deps = [":deploy_and_run_main_lib"],
)
