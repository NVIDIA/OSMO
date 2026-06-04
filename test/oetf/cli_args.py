"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Shared argparse builders for the OETF entry-point binaries.
#
# Why this module exists: ``oetf:run``, ``oetf:deploy``, and
# ``oetf:deploy_and_run`` are three independent ``py_binary`` targets with
# their own ``parse_arguments`` functions. Without a shared source of truth,
# adding a flag to one drifts the others — historically this caused
# regressions like ``--auth-method`` (was in run, dropped in deploy
# refactor), ``--list-versions`` (was in deploy, missed in deploy_and_run),
# and ``--set`` vs ``--extra-set`` divergence.
#
# Three add_* functions, one per concern. Each entry-point composes the
# subset it needs:
#
#   oetf:run            → add_env_args + add_run_args
#   oetf:deploy         → add_env_args + add_deploy_args
#   oetf:deploy_and_run → add_env_args + add_deploy_args + add_run_args
#                         (+ a couple of compose-only flags like ``--keep``)
#
# Plus forwarding helpers so deploy_and_run can serialize the run-side
# subset of its parsed namespace into the argv it shells out to oetf:run —
# any new run flag is automatically forwarded by virtue of being declared
# here.

import argparse
from typing import List


# --- Public flag builders --------------------------------------------------


def add_env_args(parser: argparse.ArgumentParser) -> None:
    """Args for env resolution / auth / connection — common to all 3 binaries."""
    parser.add_argument(
        "--env", default="",
        help="Named environment (from oetf.default.yaml + ~/.config/osmo/oetf.yaml). "
             "Resolves --url, --auth-method, --auth-token/username, and --pool.",
    )
    parser.add_argument("--url", default="", help="Override env URL.")
    parser.add_argument(
        "--auth-method", default="", choices=("", "token", "dev"),
        help="Override env auth strategy. 'token' uses --auth-token / "
             "${env.auth.token_env}; 'dev' uses --auth-username with no JWT.",
    )
    parser.add_argument("--auth-token", default="", help="Override env auth token.")
    parser.add_argument(
        "--auth-username", default="",
        help="Username for --auth-method=dev.",
    )
    parser.add_argument("--pool", default="", help="Override env pool.")
    parser.add_argument(
        "--verbose", action="store_true", help="Enable debug logging.",
    )


def add_deploy_args(parser: argparse.ArgumentParser) -> None:
    """Args consumed by the deploy phase — used by ``oetf:deploy`` and
    ``oetf:deploy_and_run``."""
    parser.add_argument(
        "--mode", default="", choices=("", "cpu", "gpu"),
        help="KIND only: override env.mode. Default: env-defined.",
    )
    parser.add_argument(
        "--cluster-name", default="",
        help="KIND only: override env.cluster_name (default: 'osmo').",
    )
    parser.add_argument(
        "--fresh", action="store_true",
        help="KIND: delete + recreate cluster from scratch.",
    )
    parser.add_argument(
        "--image-location", default="",
        help="Override global.osmoImageLocation (e.g. 'osmo.local' for build-local).",
    )
    parser.add_argument(
        "--image-tag", default="",
        help="Override global.osmoImageTag.",
    )
    parser.add_argument(
        "--chart-version", default="",
        help="KIND: pin osmo/quick-start chart version (default: latest).",
    )
    parser.add_argument(
        "--build-local", action="store_true",
        help="KIND: build OSMO images from local source and kind-load them "
             "instead of pulling from the chart-default registry.",
    )
    parser.add_argument(
        "--build-images", default="all",
        help="KIND --build-local: comma-separated short_names to build "
             "(default: all).",
    )
    parser.add_argument(
        "--with-metrics-server", action="store_true",
        help="KIND only: install metrics-server (opt-in; adds ~1min to deploy).",
    )
    parser.add_argument(
        "--extra-set", dest="extra_sets", action="append", default=[],
        help="KIND only: extra 'key=value' to pass to helm --set (repeatable).",
    )
    parser.add_argument(
        "--keep-on-failure", action="store_true",
        help="Keep partial deploy state on failure (for debugging).",
    )
    parser.add_argument(
        "--list-versions", action="store_true",
        help="List available osmo/quick-start chart versions and exit.",
    )
    parser.add_argument(
        "--target-arch", default="",
        help="DEV only: image arch for ``ci:push_images``. Accepts "
             "``x86_64``, ``arm64``, or a comma-separated list like "
             "``x86_64,arm64`` for multi-arch manifest builds (matches "
             "Jenkins ``osmo_dev`` parallel x86_64+arm64 stages plus "
             "``ci:push_multiarch_manifests``). Default: host arch only.",
    )


def add_report_args(parser: argparse.ArgumentParser) -> None:
    """Args for the optional reporting / dashboard layer.

    Reporter is a no-op unless --report-s3 is set. Scalar args default to
    None (not "") so consumers can distinguish "not provided" from
    "explicitly empty" — e.g. `--report-source ""` is a programming error,
    while not passing the flag at all means "default to users/<actor>".
    """
    parser.add_argument(
        "--report-s3", default=None,
        help="Enable upload to S3-compatible storage. Form: s3://<bucket>/<prefix>",
    )
    parser.add_argument(
        "--report-source", default=None,
        help="Where in the bucket to write. Trended sources prod/staging/ci must "
             "be passed explicitly. Default: users/<actor>.",
    )
    parser.add_argument(
        "--report-actor", default=None,
        help="Override actor identity (default: OSMO username, then $USER@<host>).",
    )
    parser.add_argument(
        "--report-s3-endpoint", default=None,
        help="S3 endpoint URL (env: OETF_REPORT_S3_ENDPOINT, then SWIFT_ENDPOINT).",
    )
    parser.add_argument(
        "--report-s3-access-key-id", default=None,
        help="S3 access key id (env: OETF_REPORT_S3_ACCESS_KEY_ID, then SWIFT_ACCESS_KEY_ID).",
    )
    parser.add_argument(
        "--report-s3-secret-key", default=None,
        help="S3 secret key (env: OETF_REPORT_S3_SECRET_KEY, then SWIFT_ACCESS_KEY).",
    )
    parser.add_argument(
        "--report-s3-region", default=None,
        help="S3 region (env: OETF_REPORT_S3_REGION, then SWIFT_REGION).",
    )
    parser.add_argument(
        "--report-public-url-base", default=None,
        help="Override the public URL base (custom domain / relay).",
    )
    parser.add_argument(
        "--report-categories", default=None,
        help="Path to a custom categories.json (default: bundled data/categories.json).",
    )
    parser.add_argument(
        "--report-strict", action="store_true",
        help="Raise on reporter failures. Default: best-effort (warning only).",
    )


def add_run_args(parser: argparse.ArgumentParser) -> None:
    """Args consumed by the run phase — used by ``oetf:run`` and
    ``oetf:deploy_and_run``."""
    parser.add_argument(
        "--tags", default="",
        help="Comma-separated tags to include (e.g. 'smoke', 'kind', 'router'). "
             "'smoke' / 'scenario' translate to 'oetf-smoke' / 'oetf-scenario'.",
    )
    parser.add_argument(
        "--name", default="",
        help="Run a single test method. Accepts 'test_foo' or 'ClassName.test_foo'.",
    )
    parser.add_argument(
        "--jobs", type=int, default=3,
        help="Parallelism (→ --local_test_jobs). Default 3 (staging sweet spot).",
    )
    parser.add_argument(
        "--output-json", default="",
        help="Write a JSON results file to this path after the run.",
    )
    parser.add_argument(
        "--local-osmo", default="/usr/local/bin/osmo",
        help="Path to the osmo CLI binary used by scenarios.",
    )
    parser.add_argument(
        "--data-cred-access-key-id", default="",
        help="Data-backend access key ID (swift/S3 user).",
    )
    parser.add_argument(
        "--data-cred-access-key", default="",
        help="Data-backend access key (swift/S3 secret).",
    )
    parser.add_argument(
        "--data-cred-endpoint", default="",
        help="Data-backend endpoint (e.g. s3://my-bucket).",
    )
    parser.add_argument(
        "--data-cred-region", default="",
        help="Data-backend region (e.g. us-east-1).",
    )
    parser.add_argument(
        "--bazel-arg", action="append", default=[],
        help="Extra arg passed verbatim to `bazel test`. Repeat for multiple.",
    )
    parser.add_argument(
        "--target-pattern", action="append", default=[],
        help="Bazel target pattern(s) to discover OETF tests from. Repeat OR "
             "comma-join to combine (e.g. `--target-pattern A,B --target-pattern C`). "
             "Default: `//test/...`. Used post-migration to "
             "combine internal overlay paths with public framework paths.",
    )


def parse_target_patterns(raw: List[str], default: str) -> List[str]:
    """Flatten ``raw`` (a list of comma-joined --target-pattern argv values)
    into a deduped, order-preserving pattern list. Returns ``[default]`` when
    nothing was supplied.

    Examples (default='//x/...'): ``[]`` → ``['//x/...']``;
    ``['A,B','C']`` → ``['A','B','C']``; ``['A','A']`` → ``['A']``.
    """
    flat = list(dict.fromkeys(
        p.strip() for entry in raw for p in entry.split(",") if p.strip()
    ))
    return flat or [default]


# --- Forwarding helpers ----------------------------------------------------
#
# These map the parsed-namespace attribute names (set by argparse from
# ``add_*_args``) back to argv lists, so deploy_and_run can pass run-side
# args to its ``oetf:run`` subprocess without hand-maintaining the list.
# Every new flag added to ``add_run_args`` / ``add_env_args`` is forwarded
# automatically as long as its dest matches the table here.


# (flag, dest, kind) — kind is one of "value", "bool", "list".
_RUN_ARG_TABLE = (
    ("--tags", "tags", "value"),
    ("--name", "name", "value"),
    ("--jobs", "jobs", "value"),
    ("--output-json", "output_json", "value"),
    ("--local-osmo", "local_osmo", "value"),
    ("--data-cred-access-key-id", "data_cred_access_key_id", "value"),
    ("--data-cred-access-key", "data_cred_access_key", "value"),
    ("--data-cred-endpoint", "data_cred_endpoint", "value"),
    ("--data-cred-region", "data_cred_region", "value"),
    ("--bazel-arg", "bazel_arg", "list"),
    ("--target-pattern", "target_pattern", "list"),
    ("--report-s3", "report_s3", "value"),
    ("--report-source", "report_source", "value"),
    ("--report-actor", "report_actor", "value"),
    ("--report-s3-endpoint", "report_s3_endpoint", "value"),
    ("--report-s3-access-key-id", "report_s3_access_key_id", "value"),
    ("--report-s3-secret-key", "report_s3_secret_key", "value"),
    ("--report-s3-region", "report_s3_region", "value"),
    ("--report-public-url-base", "report_public_url_base", "value"),
    ("--report-categories", "report_categories", "value"),
    ("--report-strict", "report_strict", "bool"),
)

_ENV_ARG_TABLE = (
    ("--url", "url", "value"),
    ("--auth-method", "auth_method", "value"),
    ("--auth-token", "auth_token", "value"),
    ("--auth-username", "auth_username", "value"),
    ("--pool", "pool", "value"),
    ("--verbose", "verbose", "bool"),
)


def _forward(args: argparse.Namespace, table) -> List[str]:
    """Walk ``table`` and emit ``--flag value`` for each set attribute on ``args``.

    Skips attributes that are unset (``""``, ``None``, empty list, ``False``)
    or fall back to the argparse default.
    """
    cmd: List[str] = []
    for flag, dest, kind in table:
        val = getattr(args, dest, None)
        if val is None:
            continue
        if kind == "bool":
            if val:
                cmd.append(flag)
        elif kind == "list":
            for item in val:
                cmd.extend([flag, str(item)])
        else:  # "value"
            if val in ("", 0):
                continue
            cmd.extend([flag, str(val)])
    return cmd


def forward_run_args(args: argparse.Namespace) -> List[str]:
    """Serialize the run-side subset of a parsed namespace back to argv.

    Used by ``oetf:deploy_and_run`` to pass through to the ``oetf:run``
    subprocess.
    """
    return _forward(args, _RUN_ARG_TABLE)


def forward_env_args(args: argparse.Namespace) -> List[str]:
    """Serialize the env-side subset of a parsed namespace back to argv.

    Used by ``oetf:deploy_and_run`` for the env/auth pieces that shouldn't
    be derived from the deployed_env (e.g. ``--verbose``).
    """
    return _forward(args, _ENV_ARG_TABLE)
