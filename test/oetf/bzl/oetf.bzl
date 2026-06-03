"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

"""Bazel macros for OETF test targets.

Each macro wraps osmo_py_test with the right deps, default tags, and
timeout classes for tests that hit a live OSMO instance.
"""

load("@osmo_workspace//bzl:py.bzl", "osmo_py_test")
load("@osmo_python_deps//:requirements.bzl", "requirement")

# Tags applied to every OETF target:
#   external         — Bazel disables caching and remote cache; always re-run.
#   requires-network — Bazel allows network access for the test.
#   no-sandbox       — runs outside the sandbox so the osmo CLI can write
#                      its state dir (~/.local/state/osmo) and tests can
#                      reach in-cluster services without sandbox restrictions.
#   manual           — excluded from `bazel test //...` default expansion;
#                      only runs via explicit target or oetf:run wrapper.
_COMMON_TAGS = ["external", "requires-network", "no-sandbox", "manual"]


def oetf_smoke_test(name, src, tags = [], extra_deps = [], size = "medium", timeout = "moderate"):
    """A smoke test — one py_test making HTTP/CLI/WebSocket probes against OSMO.

    Args:
      name: Bazel target name.
      src: the single .py file (a SmokeFixture subclass with test_* methods).
      tags: additional filter tags (e.g. ["health", "auth"]).
      extra_deps: additional Bazel labels the test needs (e.g. a requirement
        only this test uses).
      size: Bazel size (small/medium/large/enormous). Default medium.
      timeout: Bazel timeout class (short/moderate/long/eternal). Default moderate.
    """
    osmo_py_test(
        name = name,
        srcs = [src],
        main = src,
        deps = [
            "//test/oetf:smoke_fixture",
            "//test/oetf:fixture_base",
            "//test/oetf:auth",
            "//test/oetf:models",
            "//src/lib/utils:client",
            "//src/lib/utils:osmo_errors",
            requirement("requests"),
        ] + extra_deps,
        tags = _COMMON_TAGS + ["oetf-smoke"] + tags,
        size = size,
        timeout = timeout,
    )


def oetf_scenario_test(
        name,
        src = None,
        test_dir = None,
        data = [],
        workflow_data = ["//test/workflow:all_workflow_yamls"],
        tags = [],
        test_filter = None,
        size = "large",
        timeout = "long"):
    """A scenario test — submits a workflow and asserts outcome.

    Two shapes:
      - Plain scenario: one Python file. Pass `src = "file.py"`. The class
        subclasses RunnerFixture and uses self.workflow(...)... to submit
        workflows.
      - Scenario with in-task code: a directory with spec.yaml + task.py +
        test_runner.py. Pass `test_dir = "name"` (relative to the BUILD file).
        The macro picks up all three files automatically and adds spec.yaml
        and task.py as data.

    Args:
      name: Bazel target name.
      src: single .py file for plain scenarios. Mutually exclusive with test_dir.
      test_dir: dir containing test_runner.py + spec.yaml + task.py.
      data: extra runfiles (e.g. other specs referenced via self.workflow()).
      workflow_data: label(s) of the test/workflow filegroup(s) bundled
        as runfiles so self.workflow("test/workflow/...") resolves.
        Default `["//test/workflow:all_workflow_yamls"]` (today's
        behavior). Post-migration overlay packages pass their own internal
        filegroup label (e.g. `["//test/workflow:all_internal_yamls"]`).
      tags: additional filter tags (e.g. ["router", "load"]).
      test_filter: optional "ClassName.test_method" — emitted as an argv arg
        so `unittest` only runs the one method. Used to split slow files
        into per-test Bazel targets for parallelism.
      size: Bazel size. Default large (workflows take minutes).
      timeout: Bazel timeout class. Default long (900s). Use "eternal" for load tests.
    """
    if (src == None) == (test_dir == None):
        fail("oetf_scenario_test: pass exactly one of `src` or `test_dir` (got src=%r, test_dir=%r)" % (src, test_dir))

    if test_dir:
        srcs = ["%s/test_runner.py" % test_dir]
        main = "%s/test_runner.py" % test_dir
        data = data + ["%s/spec.yaml" % test_dir, "%s/task.py" % test_dir]
    else:
        srcs = [src]
        main = src

    # Bundle the chosen test/workflow filegroup(s) so that
    # self.workflow("test/workflow/...") resolves to a real file in
    # runfiles. Internal repo default is //test/workflow:all_workflow_yamls;
    # overlay packages override via the workflow_data arg.
    data = data + workflow_data

    osmo_py_test(
        name = name,
        srcs = srcs,
        main = main,
        data = data,
        args = [test_filter] if test_filter else [],
        deps = [
            "//test/oetf:runner_fixture",
            "//test/oetf:fixture_base",
            "//test/oetf:models",
            "//src/lib/utils:client",
            "//src/lib/utils:osmo_errors",
            requirement("pyyaml"),
            requirement("requests"),
        ],
        tags = _COMMON_TAGS + ["oetf-scenario"] + tags,
        size = size,
        timeout = timeout,
    )
