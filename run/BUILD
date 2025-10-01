"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

load("@osmo_workspace//bzl:py.bzl", "osmo_py_binary", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", "requirement")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
load("@aspect_bazel_lib//lib:copy_file.bzl", "copy_file")

package(default_visibility = ["//visibility:public"])

osmo_py_library(
    name = "utils",
    srcs = [
        "kind_utils.py",
        "run_command.py",
        "check_tools.py",
        "print_next_steps.py",
        "host_ip.py",
        "localstack.py",
    ],
    deps = [
        requirement("pyyaml"),
        requirement("tqdm"),
        "@bazel_tools//tools/python/runfiles",
        "@osmo_workspace//src/lib/utils:client_configs",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "start_service",
    main = "start_service.py",
    srcs = [
        "start_service.py",
        "start_service_kind.py",
        "start_service_bazel.py",
    ],
    data = [
        "kind-osmo-cluster-config.yaml",
        "//deployments/charts:osmo",
        "//deployments/charts:ui",
        "//deployments/charts:router",
        "//run/minimal:minimal",
    ],
    deps = [
        ":utils",
        "@bazel_tools//tools/python/runfiles",
        "@osmo_workspace//src/lib/utils:logging",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "start_backend",
    main = "start_backend.py",
    srcs = [
        "start_backend.py",
        "start_backend_kind.py",
        "start_backend_bazel.py",
    ],
    data = [
        "kind-osmo-cluster-config.yaml",
        "//deployments/charts:backend-operator",
        "//run/minimal:minimal",
    ],
    deps = [
        ":utils",
        "@osmo_workspace//src/lib/utils:logging",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "update_configs",
    main = "update_configs.py",
    srcs = [
        "update_configs.py",
    ],
    data = [
        "@osmo_workspace//src/cli",
    ],
    deps = [
        ":utils",
        "@osmo_workspace//src/lib/utils:logging",
    ],
    visibility = ["//visibility:public"],
)

genrule(
    name = "ca_certs_entrypoint_script",
    outs = ["entrypoint-ca-certs.sh"],
    cmd = """
cat > $@ << 'EOF'
#!/bin/bash
set -e
if [ ! -f /etc/ca-certificates.conf ]; then
    find /usr/share/ca-certificates -name '*.crt' | sed 's|/usr/share/ca-certificates/||' | sort > /etc/ca-certificates.conf
fi
update-ca-certificates
exec "$${@:-/bin/bash}"
EOF
chmod +x $@
    """,
    visibility = ["//visibility:private"],
)

pkg_tar(
    name = "ca_certs_entrypoint_tar",
    srcs = [":ca_certs_entrypoint_script"],
    mode = "0755",
    package_dir = "/usr/local/bin",
    visibility = ["//visibility:private"],
)


################
#    x86_64    #
################

copy_file(
    name = "bazelisk_amd64_binary",
    src = "@bazelisk_linux_amd64//file",
    out = "bazelisk-amd64",
    visibility = ["//visibility:private"],
)

pkg_tar(
    name = "bazelisk_amd64_tar",
    srcs = [":bazelisk_amd64_binary"],
    mode = "0755",
    package_dir = "/usr/local/bin",
    symlinks = {
        "/usr/local/bin/bazel": "/usr/local/bin/bazelisk-amd64",
    },
    visibility = ["//visibility:private"],
)

# bazel build \
#  --platforms=@io_bazel_rules_go//go/toolchain:linux_amd64 \
#  @osmo_workspace//run/builder:builder_image_x86_64
oci_image(
    name = "builder_image_x86_64",
    base = "@ubuntu_22_04_linux_amd64",
    tars = [
        "@dev_builder_debian_packages_x86_64//:dev_builder_debian_packages_x86_64",
        ":ca_certs_entrypoint_tar",
        ":bazelisk_amd64_tar",
    ],
    env = {
        "PYTHONUNBUFFERED": "1",
    },
    cmd = ["/usr/local/bin/entrypoint-ca-certs.sh"],
    workdir = "/workspace",
    visibility = ["//visibility:public"],
    tags = ["manual"],
)

oci_load(
    name = "builder_image_load_x86_64",
    image = ":builder_image_x86_64",
    repo_tags = ["dev-builder:latest-x86_64"],
    tags = ["manual"],
)

###############
#    arm64    #
###############

copy_file(
    name = "bazelisk_arm64_binary",
    src = "@bazelisk_linux_arm64//file",
    out = "bazelisk-arm64",
    visibility = ["//visibility:private"],
)

pkg_tar(
    name = "bazelisk_arm64_tar",
    srcs = [":bazelisk_arm64_binary"],
    mode = "0755",
    package_dir = "/usr/local/bin",
    symlinks = {
        "/usr/local/bin/bazel": "/usr/local/bin/bazelisk-arm64",
    },
    visibility = ["//visibility:private"],
)

# bazel build \
#  --platforms=@io_bazel_rules_go//go/toolchain:linux_arm64 \
#  @osmo_workspace//run/builder:builder_image_load_arm64
oci_image(
    name = "builder_image_arm64",
    base = "@ubuntu_22_04_linux_arm64",
    tars = [
        "@dev_builder_debian_packages_arm64//:dev_builder_debian_packages_arm64",
        ":ca_certs_entrypoint_tar",
        ":bazelisk_arm64_tar",
    ],
    env = {
        "PYTHONUNBUFFERED": "1",
    },
    cmd = ["/usr/local/bin/entrypoint-ca-certs.sh"],
    workdir = "/workspace",
    visibility = ["//visibility:public"],
    tags = ["manual", "arm64"],
)

oci_load(
    name = "builder_image_load_arm64",
    image = ":builder_image_arm64",
    repo_tags = ["dev-builder:latest-arm64"],
    tags = ["manual", "arm64"],
)

