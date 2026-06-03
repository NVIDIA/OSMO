"""
Copyright (c) 2023, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""
exports_files(glob(["*.yaml"]))

filegroup(
    name = "all_workflow_yamls",
    # `scripts/` and `input/` subdirs are KEEP-only (they contain script blobs +
    # uploaded dataset trees referenced by non-kind-tagged scenarios — see
    # migration plan). Glob with allow_empty=True so the filegroup loads in the
    # public repo even when those dirs are absent.
    srcs = glob(
        [
            "*.yaml",
            "scripts/**",
            "input/**",
        ],
        allow_empty = True,
    ),
    visibility = ["//visibility:public"],
)
