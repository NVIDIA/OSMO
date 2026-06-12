"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

load("//test/oetf/bzl:oetf.bzl", "oetf_smoke_test")

package(default_visibility = ["//visibility:public"])

oetf_smoke_test(
    name = "api-checks",
    src = "api_checks.py",
    tags = ["api", "kind"],
)

# auth-checks stays internal — public quick-start chart ships no JWT issuer
# (only oauth2Proxy). Re-enable here once the public chart adds one.

oetf_smoke_test(
    name = "cli-checks",
    src = "cli_checks.py",
    # No `kind` tag: cli-checks invokes `osmo login` which requires the
    # full JWT auth flow; quick-start with auth.disabled=true (the kind
    # default) doesn't satisfy that. Re-add `kind` here when the chart
    # ships a working dev-mode login (or the test fixture switches to
    # passing --auth-method=dev through to the CLI).
    tags = ["cli"],
)

oetf_smoke_test(
    name = "websocket-checks",
    src = "websocket_checks.py",
    tags = ["websocket", "kind"],
)
