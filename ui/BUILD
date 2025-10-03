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

load("@aspect_rules_js//contrib/nextjs:defs.bzl", "nextjs_standalone_build", "nextjs_standalone_server")
load("@aspect_rules_js//js:defs.bzl", "js_library", "js_image_layer")
load("@npm//:defs.bzl", "npm_link_all_packages")
load("@npm//ui:next/package_json.bzl", next_bin = "bin")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_push", "oci_load")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")
load(":ui.bzl", "ui_runfiles_dir", "ui_standalone_pkg")

# To keep dependencies between package.json and pnpm-lock.yaml synced:
# Run (from this directory): bazel run -- @pnpm//:pnpm --dir $PWD import
# Then check in the pnpm-lock.yaml file (along with the updated package.json and package-lock.json)

npm_link_all_packages(name = "node_modules")

next_bin.next_binary(
    name = "next_js_binary",
    # Add more node toolchains as needed
    node_toolchain = select({
        "@bazel_tools//src/conditions:linux_x86_64": "@nodejs_linux_amd64//:node_toolchain",
        "@bazel_tools//src/conditions:linux_aarch64": "@nodejs_linux_arm64//:node_toolchain",
        "@bazel_tools//src/conditions:darwin_arm64": "@nodejs_darwin_arm64//:node_toolchain",
    }),
)

js_library(
    name = "lib",
    srcs = glob([
        "src/**",
        "public/**",
    ]),
    deps = [
        ":node_modules",
    ],
)

js_library(
    name = "nextjs-css",
    srcs = [
        "postcss.config.mjs",
    ],
    deps = [
        ":node_modules/@tailwindcss/postcss",
        ":node_modules/tailwindcss",
    ],
)

nextjs_standalone_build(
    name = "standalone_build",
    srcs = [
        "tsconfig.json",
        ":lib",
        ":nextjs-css",
    ],
    data = [
        "package-lock.json",
        "package.json",
    ],
    config = "next.standalone.js",
    next_js_binary = ":next_js_binary",
    silent_on_success = False,
    env = {
        "NODE_ENV": "production",
        "SKIP_ENV_VALIDATION": "true",
        "NEXT_PUBLIC_APP_NAME": "OSMO",
    },
)

nextjs_standalone_server(
    name = "standalone_server",
    app = ":standalone_build",
    pkg = ui_standalone_pkg(),
    node_toolchain = select({
        "@bazel_tools//src/conditions:linux_x86_64": "@nodejs_linux_amd64//:node_toolchain",
        "@bazel_tools//src/conditions:linux_aarch64": "@nodejs_linux_arm64//:node_toolchain",
        "@bazel_tools//src/conditions:darwin_arm64": "@nodejs_darwin_arm64//:node_toolchain",
    }),
)

js_image_layer(
    name = "standalone_layers",
    binary = ":standalone_server",
    root = "/app",
    owner = "1000:1000",
)

# This rule exists as a workaround to allow `:standalone_build` to be built in a Bazel sandbox.
# `:node_modules/react` is a symlinked when running `npm run build`, which causes Bazel sandbox
# validation to fail (due to `:node_modules/react` being symlinked outside of the output dir).
#
# As a workaround, we've excluded `:node_modules/react` from the `:standalone_build` rule, and
# instead create a tar of the react package directory to be overlayed during image build.
genrule(
    name = "react_overlay_tar",
    srcs = [":node_modules/react"],
    outs = ["react_overlay.tgz"],
    cmd = """
    DIR=/app/ui/standalone_server.runfiles/{}/standalone_server/standalone/{}/node_modules/
    ROOT="$(@D)/root"
    DEST="$$ROOT$$DIR"
    mkdir -p "$$DEST"

    # Find the actual react package directory among SRCS
    REACT_SRC=
    for s in $(SRCS); do
    case "$$s" in */node_modules/react) REACT_SRC="$$s"; break;; esac
    done
    : "$${{REACT_SRC:?react package dir not found in SRCS}}"

    # Copy, following symlinks, into destination path
    cp -aL "$$REACT_SRC"/ "$$DEST"/

    # Create the tar rooted at /app
    tar -czf "$@" -C "$$ROOT" .
    """.format(
        ui_runfiles_dir(),
        ui_standalone_pkg(),
    ),
)

################
#    x86_64    #
################

oci_image(
    name = "web_ui_image_x86_64",
    base = "@node_22_distroless_linux_amd64",
    tars = [
        ":standalone_layers",
        ":react_overlay_tar",
    ],
    env = {
        "HOSTNAME": "0.0.0.0",
        "NODE_ENV": "production",
        "NEXT_PUBLIC_APP_NAME": "OSMO",
    },
    cmd = [
        "{}/standalone_server/standalone/{}/server.js".format(
            ui_runfiles_dir(),
            ui_standalone_pkg(),
        ),
    ],
    entrypoint = ["node"],
    workdir = "/app/ui/standalone_server.runfiles",
    visibility = ["//visibility:public"],
)

oci_load(
    name = "web_ui_image_load_x86_64",
    image = ":web_ui_image_x86_64",
    repo_tags = ["osmo.local/web-ui:latest-x86_64"],
    tags = ["manual"],
)

oci_push(
    name = "web_ui_push_x86_64",
    image = ":web_ui_image_x86_64",
    repository = BASE_IMAGE_URL + "web-ui",
    remote_tags = [IMAGE_TAG + "-amd64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
)

###############
#    arm64    #
###############

oci_image(
    name = "web_ui_image_arm64",
    base = "@node_22_distroless_linux_arm64_v8",
    tars = [
        ":standalone_layers",
        ":react_overlay_tar",
    ],
    env = {
        "HOSTNAME": "0.0.0.0",
        "NODE_ENV": "production",
        "NEXT_PUBLIC_APP_NAME": "OSMO",
    },
    cmd = [
        "{}/standalone_server/standalone/{}/server.js".format(
            ui_runfiles_dir(),
            ui_standalone_pkg(),
        ),
    ],
    entrypoint = ["node"],
    workdir = "/app/ui/standalone_server.runfiles",
    visibility = ["//visibility:public"],
    tags = ["arm64"],
)

oci_load(
    name = "web_ui_image_load_arm64",
    image = ":web_ui_image_arm64",
    repo_tags = ["osmo.local/web-ui:latest-arm64"],
    tags = ["manual", "arm64"],
)

oci_push(
    name = "web_ui_push_arm64",
    image = ":web_ui_image_arm64",
    repository = BASE_IMAGE_URL + "web-ui",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual", "arm64"],
)
