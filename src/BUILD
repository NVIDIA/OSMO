# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0
load("@io_bazel_rules_docker//contrib:passwd.bzl", "passwd_entry", "passwd_file")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

package(default_visibility = ["//visibility:public"])

genrule(
    name = "osmo_group",
    outs = ["group"],
    cmd = "echo 'osmo:x:1001:' > $@",
)

pkg_tar(
    name = "group_tar",
    srcs = [":osmo_group"],
    mode = "0o644",
    package_dir = "etc",
)

passwd_entry(
    name = 'osmo_user',
    username = 'osmo',
    uid = 1001,
    gid = 1001,
)

passwd_file(
    name = "passwd",
    entries = [
        ":osmo_user",
    ]
)

pkg_tar(
    name = "passwd_tar",
    srcs = [":passwd"],
    mode = "0o644",
    package_dir = "etc",
)

genrule(
    name = "empty",
    outs = ["empty.txt"],
    cmd = "touch \"$@\""
)

# pkg_tar will create /var/run with permisions so the osmo user can access it
pkg_tar(
    name = "osmo_run_tar",
    srcs = [":empty"],
    mode = "0o644",
    package_dir = "/var/run/osmo",
    owner = "1001.1001",
)

pkg_tar(
    name = "osmo_home_tar",
    srcs = [":empty"],
    mode = "0o644",
    package_dir = "/home",
    owner = "1001.1001",
)

# Create symlinks for python and python3
pkg_tar(
    name = "python_symlinks_tar",
    symlinks = {
        "/usr/bin/python": "/usr/local/bin/python",
        "/usr/bin/python3": "/usr/local/bin/python3",
    },
)

# Create /osmo directory with 777 permissions for client images
genrule(
    name = "osmo_dir_marker",
    outs = ["osmo_marker.txt"],
    cmd = "touch $@",
)

pkg_tar(
    name = "osmo_client_dir_tar",
    srcs = [":osmo_dir_marker"],
    mode = "0o777",
    package_dir = "/osmo",
)

oci_image(
    name = "osmo_docker_distroless_image_amd64",
    base = "@distroless_python3_10_linux_amd64",
    tars = [
        "//src:group_tar",
        "//src:passwd_tar",
        "//src:osmo_run_tar",
        "//src:python_symlinks_tar",
    ],
    env = {
        "PYTHONUNBUFFERED": "1",
    },
    workdir = "/app",
    user = "osmo",
    visibility = ["//visibility:public"],
)

oci_image(
    name = "osmo_docker_distroless_image_arm64",
    base = "@distroless_python3_10_linux_arm64_v8",
    tars = [
        "//src:group_tar",
        "//src:passwd_tar",
        "//src:osmo_run_tar",
        "//src:python_symlinks_tar",
    ],
    env = {
        "PYTHONUNBUFFERED": "1",
    },
    workdir = "/app",
    user = "osmo",
    visibility = ["//visibility:public"],
    tags = ["arm64"],
)

oci_image(
    name = "osmo_docker_client_image_amd64",
    base = "@distroless_python3_10_linux_amd64",
    tars = [
        # Client base packages (tree, ca-certificates, /osmo dir)
        "@debian_packages//tree/amd64:data",
        "@debian_packages//ca-certificates/amd64:data",
        "//src:osmo_client_dir_tar",
        # User and system setup
        "//src:group_tar",
        "//src:passwd_tar",
        "//src:osmo_run_tar",
        "//src:osmo_home_tar",
        "//src:python_symlinks_tar",
    ],
    env = {
        "PYTHONUNBUFFERED": "1",
    },
    workdir = "/home/osmo",
    user = "osmo",
    visibility = ["//visibility:public"],
)

# Local testing for the optimized client image
# Uncomment to enable local testing:
# oci_load(
#     name = "osmo_docker_client_image_amd64_load",
#     image = ":osmo_docker_client_image_amd64",
#     repo_tags = ["osmo_client_amd64:test"],
# )
# Usage: bazel run //src:osmo_docker_client_image_amd64_load
# Test: docker run --rm osmo_client_amd64:test tree --version

oci_image(
    name = "osmo_docker_client_image_arm64",
    base = "@distroless_python3_10_linux_arm64_v8",
    tars = [
        # Client base packages (tree, ca-certificates, /osmo dir)
        "@debian_packages_arm64//tree/arm64:data",
        "@debian_packages_arm64//ca-certificates/arm64:data",
        "//src:osmo_client_dir_tar",
        # User and system setup
        "//src:group_tar",
        "//src:passwd_tar",
        "//src:osmo_run_tar",
        "//src:osmo_home_tar",
        "//src:python_symlinks_tar",
    ],
    env = {
        "PYTHONUNBUFFERED": "1",
    },
    workdir = "/home/osmo",
    user = "osmo",
    visibility = ["//visibility:public"],
    tags = ["arm64"],
)

# Local testing for the optimized client image (arm64)
# Uncomment to enable local testing:
# oci_load(
#     name = "osmo_docker_client_image_arm64_load",
#     image = ":osmo_docker_client_image_arm64",
#     repo_tags = ["osmo_client_arm64:test"],
# )
# Usage: bazel run //src:osmo_docker_client_image_arm64_load
# Test: docker run --rm --platform linux/arm64 osmo_client_arm64:test tree --version
