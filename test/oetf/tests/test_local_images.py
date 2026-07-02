"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Unit tests for oetf.local_images.

import unittest
from unittest.mock import patch

from test.oetf import local_images


class TestImageSpecs(unittest.TestCase):
    """image_specs produces sensibly-named entries for each arch."""

    def test_arm64_tags_end_with_arm64(self):
        specs = local_images.image_specs("arm64")
        self.assertGreaterEqual(len(specs), 10)
        for spec in specs:
            self.assertTrue(
                spec.docker_tag.endswith(":latest-arm64"),
                f"{spec.short_name} has unexpected tag {spec.docker_tag}",
            )
            self.assertTrue(
                spec.bazel_target.endswith("_arm64"),
                f"{spec.short_name} has unexpected target {spec.bazel_target}",
            )
            self.assertTrue(
                spec.docker_tag.startswith("osmo.local/"),
                f"{spec.short_name} must use osmo.local prefix",
            )

    def test_x86_64_tags_end_with_x86_64(self):
        specs = local_images.image_specs("x86_64")
        for spec in specs:
            self.assertTrue(spec.docker_tag.endswith(":latest-x86_64"))
            self.assertTrue(spec.bazel_target.endswith("_x86_64"))

    def test_short_names_unique(self):
        specs = local_images.image_specs("arm64")
        names = [spec.short_name for spec in specs]
        self.assertEqual(len(names), len(set(names)), msg="duplicated short_name")

    def test_core_services_present(self):
        """The 10 service images for the quick-start chart must all be included."""
        specs = local_images.image_specs("arm64")
        names = {spec.short_name for spec in specs}
        for required in (
            "service", "agent", "mcp", "logger", "worker",
            "delayed-job-monitor", "router", "authz-sidecar",
            "backend-listener", "backend-worker",
        ):
            self.assertIn(required, names)

    def test_mcp_image_matches_chart_image_name(self):
        specs = local_images.image_specs("arm64")
        mcp = next(spec for spec in specs if spec.short_name == "mcp")
        self.assertEqual(
            mcp.bazel_target,
            "//src/service/mcp:mcp_image_load_arm64",
        )
        self.assertEqual(
            mcp.docker_tag,
            "osmo.local/mcp-self-hosted:latest-arm64",
        )


class TestDetectArch(unittest.TestCase):
    """detect_arch maps platform.machine to the canonical arch string."""

    def test_x86_64(self):
        with patch("platform.machine", return_value="x86_64"):
            self.assertEqual(local_images.detect_arch(), "x86_64")

    def test_amd64_alias(self):
        with patch("platform.machine", return_value="AMD64"):
            self.assertEqual(local_images.detect_arch(), "x86_64")

    def test_arm64(self):
        with patch("platform.machine", return_value="arm64"):
            self.assertEqual(local_images.detect_arch(), "arm64")

    def test_aarch64_alias(self):
        with patch("platform.machine", return_value="aarch64"):
            self.assertEqual(local_images.detect_arch(), "arm64")

    def test_unknown_raises(self):
        with patch("platform.machine", return_value="mips"):
            with self.assertRaises(RuntimeError):
                local_images.detect_arch()


class TestShouldBuildUi(unittest.TestCase):
    """should_build_ui returns True iff the selector includes web-ui."""

    def test_all_includes_ui(self):
        self.assertTrue(local_images.should_build_ui("all"))

    def test_explicit_web_ui_in_list_includes_ui(self):
        self.assertTrue(local_images.should_build_ui("service,web-ui"))
        self.assertTrue(local_images.should_build_ui("web-ui"))

    def test_other_explicit_list_excludes_ui(self):
        self.assertFalse(local_images.should_build_ui("service,agent"))
        self.assertFalse(local_images.should_build_ui("service"))

    def test_whitespace_tolerated(self):
        self.assertTrue(local_images.should_build_ui("  service , web-ui "))


class TestBuildAndLoad(unittest.TestCase):
    """build_and_load invokes bazel then kind-load for each image."""

    def _fake_run(self, calls, specs):
        """subprocess.run mock: appends calls; returns tarball paths from cquery.

        Mocked cquery output follows bazel-out's actual convention — the target's
        label name is the parent directory of the tarball.tar file:
          ``bazel-out/.../bin/external/<repo>+/<pkg>/<name>/tarball.tar``
        """
        def fake_run(args, **_kwargs):
            calls.append(list(args))
            if "cquery" in args:
                stdout = "".join(
                    f'/fake/bazel-bin/{s.bazel_target.split(":")[-1]}/tarball.tar\n'
                    for s in specs
                )
                return _FakeCompleted(stdout=stdout)
            return _FakeCompleted()
        return fake_run

    def test_one_bazel_build_then_cquery_then_concurrent_docker_kind_loads(self):
        specs = local_images.image_specs("arm64")[:2]
        calls: list[list[str]] = []
        with patch("subprocess.run", side_effect=self._fake_run(calls, specs)):
            local_images.build_and_load(specs, cluster_name="osmo", arch="arm64")

        # 1 batched bazel build + 1 batched cquery + (docker load + kind load
        # + docker rmi) per image. The trailing docker rmi reclaims host disk
        # after each kind-load — important on disk-constrained CI runners.
        self.assertEqual(calls[0][:2], ["bazel", "build"])
        self.assertIn("--platforms=@osmo_workspace//bzl/platforms:linux_arm64", calls[0])
        self.assertIn("--output_groups=+tarball", calls[0])
        for s in specs:
            self.assertIn(s.bazel_target, calls[0])
        self.assertEqual(calls[1][:2], ["bazel", "cquery"])
        self.assertIn("--platforms=@osmo_workspace//bzl/platforms:linux_arm64", calls[1])
        rest = calls[2:]
        self.assertEqual(sum(1 for c in rest if c[:3] == ["docker", "load", "-i"]), 2)
        self.assertEqual(sum(1 for c in rest if c[:3] == ["kind", "load", "docker-image"]), 2)
        # Per-image host-docker cleanup so the host's image storage doesn't
        # grow alongside the KIND-node containerd copies.
        self.assertEqual(sum(1 for c in rest if c[:3] == ["docker", "rmi", "-f"]), 2)

    def test_x86_64_uses_linux_x86_64_platforms_flag(self):
        specs = local_images.image_specs("x86_64")[:1]
        calls: list[list[str]] = []
        with patch("subprocess.run", side_effect=self._fake_run(calls, specs)):
            local_images.build_and_load(specs, cluster_name="osmo", arch="x86_64")
        self.assertIn("--platforms=@osmo_workspace//bzl/platforms:linux_x86_64", calls[0])

    def test_skip_kind_load_omits_kind_step(self):
        specs = local_images.image_specs("arm64")[:2]
        calls: list[list[str]] = []
        with patch("subprocess.run", side_effect=self._fake_run(calls, specs)):
            local_images.build_and_load(
                specs, cluster_name="osmo", arch="arm64", skip_kind_load=True,
            )
        # 1 bazel build + 1 bazel cquery + 1 docker load per image. No kind load.
        self.assertEqual(len(calls), 4)
        self.assertFalse(any(c[:2] == ["kind", "load"] for c in calls))


class TestSelectImages(unittest.TestCase):
    """select_images filters by short_name and rejects unknown names."""

    def test_all_returns_full_list(self):
        specs = local_images.image_specs("arm64")
        self.assertEqual(local_images.select_images(specs, "all"), specs)

    def test_subset_filters_by_short_name(self):
        specs = local_images.image_specs("arm64")
        selected = local_images.select_images(specs, "service,agent")
        self.assertEqual(sorted(s.short_name for s in selected), ["agent", "service"])

    def test_unknown_name_raises(self):
        specs = local_images.image_specs("arm64")
        with self.assertRaisesRegex(RuntimeError, "bogus"):
            local_images.select_images(specs, "service,bogus")


class TestBuildAndLoadUi(unittest.TestCase):
    """build_and_load_ui invokes docker buildx --load + kind load."""

    def test_invokes_buildx_load_then_kind_load_arm64(self):
        calls: list[list[str]] = []

        def fake_run(args, **_kwargs):
            calls.append(list(args))
            return _FakeCompleted()

        with patch("subprocess.run", side_effect=fake_run):
            local_images.build_and_load_ui(cluster_name="osmo", arch="arm64")

        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][:3], ["docker", "buildx", "build"])
        self.assertIn("--platform", calls[0])
        platform_idx = calls[0].index("--platform")
        self.assertEqual(calls[0][platform_idx + 1], "linux/arm64")
        self.assertIn("--load", calls[0])
        self.assertIn("-t", calls[0])
        tag_idx = calls[0].index("-t")
        self.assertEqual(calls[0][tag_idx + 1], "osmo.local/web-ui:latest-arm64")
        # Last positional is the build context (UI source dir)
        self.assertTrue(
            calls[0][-1].endswith("external/src/ui"),
            f"build context should end with external/src/ui, got: {calls[0][-1]!r}",
        )

        self.assertEqual(calls[1][:3], ["kind", "load", "docker-image"])
        self.assertIn("osmo.local/web-ui:latest-arm64", calls[1])
        self.assertIn("--name", calls[1])
        self.assertIn("osmo", calls[1])

    def test_x86_64_uses_amd64_platform(self):
        """docker buildx uses 'linux/amd64' (not 'linux/x86_64') for x86_64."""
        calls: list[list[str]] = []

        def fake_run(args, **_kwargs):
            calls.append(list(args))
            return _FakeCompleted()

        with patch("subprocess.run", side_effect=fake_run):
            local_images.build_and_load_ui(cluster_name="osmo", arch="x86_64")

        platform_idx = calls[0].index("--platform")
        self.assertEqual(calls[0][platform_idx + 1], "linux/amd64")
        tag_idx = calls[0].index("-t")
        self.assertEqual(calls[0][tag_idx + 1], "osmo.local/web-ui:latest-x86_64")

    def test_skip_kind_load_omits_kind_step(self):
        calls: list[list[str]] = []

        def fake_run(args, **_kwargs):
            calls.append(list(args))
            return _FakeCompleted()

        with patch("subprocess.run", side_effect=fake_run):
            local_images.build_and_load_ui(
                cluster_name="osmo", arch="arm64", skip_kind_load=True,
            )

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][:3], ["docker", "buildx", "build"])


class TestImageTagHelpers(unittest.TestCase):
    """image_location and image_tag produce the chart overrides the adapter sets."""

    def test_image_location(self):
        self.assertEqual(local_images.image_location(), "osmo.local")

    def test_image_tag_default_uses_detected_arch(self):
        with patch("platform.machine", return_value="arm64"):
            self.assertEqual(local_images.image_tag(), "latest-arm64")

    def test_image_tag_with_explicit_arch(self):
        self.assertEqual(local_images.image_tag("x86_64"), "latest-x86_64")


class _FakeCompleted:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = ""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


if __name__ == "__main__":
    unittest.main()
