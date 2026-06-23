"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

load("//test/oetf/bzl:oetf.bzl", "oetf_scenario_test")

package(default_visibility = ["//visibility:public"])

oetf_scenario_test(
    name = "logger-connectivity",
    test_dir = "logger_connectivity",
    tags = ["logger", "positive", "kind"],
)

oetf_scenario_test(
    name = "task-runtime-environment",
    test_dir = "task_runtime_environment",
    tags = ["task-env", "positive", "kind"],
)

oetf_scenario_test(
    name = "router-connectivity",
    test_dir = "router_connectivity",
    tags = ["router", "positive", "kind"],
)

# --- Plain workflow scenarios (no in-task code) ---
#
# Fast files (< ~120s total) stay as a single target — running their 2-4
# methods serially is cheap. Slow files are split one target per test
# method so Bazel can run them in parallel; see the loops below.

# `privileged` and `credentials` scenario targets stay internal.
# `privileged` needs Jetson agx-orin-jp6; `credentials` needs internal
# credential content. The internal overlay package owns these.

oetf_scenario_test(
    name = "exec-portforward",
    src = "exec_portforward.py",
    tags = ["exec", "portforward"],
)

# `kind` tag = test passes against an `oetf:deploy --env kind` cluster.
# These four are submission-time validation checks (server rejects bad
# specs without scheduling) so they don't depend on the cluster's
# platforms/credentials/registry.
oetf_scenario_test(
    name = "resource-validation",
    src = "resource_validation.py",
    tags = ["resource", "negative", "kind"],
)

oetf_scenario_test(
    name = "command-validation",
    src = "command_validation.py",
    tags = ["command", "negative", "kind"],
)

oetf_scenario_test(
    name = "mount-validation",
    src = "mount_validation.py",
    tags = ["mount", "negative", "kind"],
)

oetf_scenario_test(
    name = "templates",
    src = "templates.py",
    tags = ["template", "negative", "kind"],
)

# --- Split slow files: one Bazel target per test method.
# Each target runs exactly one unittest method (via args=[<Class.test_*>])
# so `bazel test` can parallelize them. Target name = sluggified test name.

# test_serial_workflow_nonroot (a non-root container image image) and
# test_serial_workflow_multi_arch (heterogeneous pool) stay internal.
_SERIAL = [
    "test_serial_workflow",
    "test_serial_workflow_mounting",
    "test_serial_workflow_update_dataset",
    "test_regex_workflow",
]

# Tests in this set additionally get the `kind` tag — verified to pass
# against `oetf:deploy --env kind` (host-arch only, no NVIDIA-only
# platforms or registry credentials needed).
_KIND_RUNNABLE_SERIAL = ["test_serial_workflow_mounting"]

[
    oetf_scenario_test(
        name = t.removeprefix("test_").replace("_", "-"),
        src = "serial.py",
        test_filter = "SerialWorkflows." + t,
        tags = ["serial"] + (["kind"] if t in _KIND_RUNNABLE_SERIAL else []),
    )
    for t in _SERIAL
]

_PARALLEL = [
    "test_parallel_workflow_v2",
    "test_serial_workflow_templated_with_files",
    "test_parallel_workflow_templated_with_files_v2",
    "test_parallel_workflow_multi_groups",
    "test_parallel_workflow_leader_exits",
]

[
    oetf_scenario_test(
        name = t.removeprefix("test_").replace("_", "-"),
        src = "parallel.py",
        test_filter = "ParallelWorkflows." + t,
        tags = ["parallel"],
    )
    for t in _PARALLEL
]

# test_data_storage_provider (internal git clone) and test_checkpoint_data
# (an internal object-storage backend-specific code path) stay internal.
_DATA_STORAGE = [
    "test_data_cli",
    "test_workflow_cli",
    "test_app_cli",
]

[
    oetf_scenario_test(
        name = t.removeprefix("test_").replace("_", "-"),
        src = "data_storage.py",
        test_filter = "DataStorageWorkflows." + t,
        tags = ["data", "cli"],
    )
    for t in _DATA_STORAGE
]

_EXIT_ACTIONS = [
    "test_exit_actions",
    "test_exit_actions_failed",
    "test_group_actions",
    "test_ignore_group_actions",
    "test_restart_reschedule",
]

[
    oetf_scenario_test(
        name = t.removeprefix("test_").replace("_", "-"),
        src = "exit_actions.py",
        test_filter = "ExitActionsWorkflows." + t,
        tags = ["exit", "group"],
    )
    for t in _EXIT_ACTIONS
]

# test_catch_start_error (a deliberately-failing container image image) stays internal.
_ERROR_HANDLING = [
    "test_exec_timeout",
    "test_resource_as_byte",
    "test_osmo_client_test",
]

[
    oetf_scenario_test(
        name = t.removeprefix("test_").replace("_", "-"),
        src = "error_handling.py",
        test_filter = "ErrorHandlingWorkflows." + t,
        tags = ["error"],
    )
    for t in _ERROR_HANDLING
]

# test_python_library_data_test (internal Artifactory), test_multi_arch_containers
# (heterogeneous pool), and test_transfer_service_workflow (internal
# transfer_service runfiles) stay internal.
_ADVANCED = [
    "test_folder_input",
]

[
    oetf_scenario_test(
        name = t.removeprefix("test_").replace("_", "-"),
        src = "advanced.py",
        test_filter = "AdvancedWorkflows." + t,
        tags = ["advanced"],
    )
    for t in _ADVANCED
]
