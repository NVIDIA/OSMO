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

def _osmo_constants_impl(ctx):
    ctx.file("BUILD.bazel", "")
    ctx.file("constants.bzl", """
BASE_IMAGE_URL = "{base_image_url}"
IMAGE_TAG = "{image_tag}"
""".format(
    base_image_url = ctx.attr.base_image_url,
    image_tag = ctx.attr.image_tag,
))

osmo_constants = repository_rule(
    implementation = _osmo_constants_impl,
    attrs = {
        "base_image_url": attr.string(mandatory = True),
        "image_tag": attr.string(mandatory = True),
    },
)
