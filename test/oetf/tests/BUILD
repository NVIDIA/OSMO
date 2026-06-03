"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

load("@osmo_workspace//bzl:py.bzl", "osmo_py_test")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_test(
    name = "test_models",
    srcs = ["test_models.py"],
    deps = ["//test/oetf:models"],
)

osmo_py_test(
    name = "test_log_summary",
    srcs = ["test_log_summary.py"],
    deps = ["//test/oetf:log_summary"],
)

osmo_py_test(
    name = "test_models_env",
    srcs = ["test_models_env.py"],
    main = "test_models_env.py",
    deps = ["//test/oetf:models"],
)

osmo_py_test(
    name = "test_cli_args",
    srcs = ["test_cli_args.py"],
    main = "test_cli_args.py",
    deps = ["//test/oetf:cli_args"],
)

osmo_py_test(
    name = "test_runner_fixture",
    srcs = ["test_runner_fixture.py"],
    deps = [
        "//test/oetf:models",
        "//test/oetf:runner_fixture",
        requirement("pyyaml"),
    ],
)

osmo_py_test(
    name = "test_environments",
    srcs = ["test_environments.py"],
    main = "test_environments.py",
    deps = [
        "//test/oetf:environments",
        "//test/oetf:models",
        "//test/oetf:preflight",
        requirement("pyyaml"),
    ],
)

osmo_py_test(
    name = "test_deploy",
    srcs = ["test_deploy.py"],
    main = "test_deploy.py",
    deps = [
        "//test/oetf:breadcrumb",
        "//test/oetf:deploy_adapters_factory",
        "//test/oetf:deploy_adapters_kind",
        "//test/oetf:deploy_adapters_base",
        "//test/oetf:environments",
        "//test/oetf:local_images",
        "//test/oetf:models",
        "//test/oetf:teardown_main",
    ],
)

osmo_py_test(
    name = "test_local_images",
    srcs = ["test_local_images.py"],
    main = "test_local_images.py",
    deps = ["//test/oetf:local_images"],
)

osmo_py_test(
    name = "test_reporter",
    srcs = ["test_reporter.py"],
    deps = ["//test/oetf:reporter"],
)

osmo_py_test(
    name = "test_fixture_emitter",
    srcs = ["test_fixture_emitter.py"],
    deps = [
        "//test/oetf:fixture_base",
        "//test/oetf:reporter",
    ],
)

osmo_py_test(
    name = "test_smoke_recording",
    srcs = ["test_smoke_recording.py"],
    deps = [
        "//test/oetf:reporter",
        "//test/oetf:smoke_fixture",
        "//src/lib/utils:osmo_errors",
    ],
)

osmo_py_test(
    name = "test_runner_recording",
    srcs = ["test_runner_recording.py"],
    deps = [
        "//test/oetf:reporter",
        "//test/oetf:runner_fixture",
        "//src/lib/utils:osmo_errors",
    ],
)

osmo_py_test(
    name = "test_sinks",
    srcs = ["test_sinks.py"],
    deps = [
        "//test/oetf:sinks",
        requirement("boto3"),
    ],
)

osmo_py_test(
    name = "test_aggregate",
    srcs = ["test_aggregate.py"],
    deps = [
        "//test/oetf:aggregate",
        "//test/oetf:sinks",
    ],
)

osmo_py_test(
    name = "test_cli_args_report",
    srcs = ["test_cli_args_report.py"],
    deps = ["//test/oetf:cli_args"],
)

osmo_py_test(
    name = "test_main_reporter_dispatch",
    srcs = ["test_main_reporter_dispatch.py"],
    deps = ["//test/oetf:run_lib"],
)

# test_dev_adapter stays internal — dev_adapter.py is not shipped in the public
# OETF distribution; the internal overlay package owns its tests.
