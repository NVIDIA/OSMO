"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# OETF runner: wrapper around `bazel test //test/oetf/staging/...`.
#
# Resolves --env to OETF_* env vars, invokes Bazel, parses the per-method
# JUnit XML files from bazel-testlogs/, and renders the [PASS]/[FAIL] summary
# the team is used to.

import argparse
import datetime
import getpass
import json
import os
import re
import socket
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, NoReturn, Optional, Tuple

from test.oetf import aggregate
from test.oetf import reporter
from test.oetf.auth import create_service_client
from test.oetf import cli_args
from test.oetf.cli_args import add_env_args, add_report_args, add_run_args
from test.oetf.environments import (
    resolve_environment,
    resolve_token,
)
from test.oetf.log_summary import summarize_log_path
from test.oetf.models import OetfConfig
from test.oetf.osmo_cli import login_cli_to, resolve_osmo_cli
from test.oetf.sinks import S3Sink
from src.lib.utils.client import RequestMethod


# --- Environment resolution ------------------------------------------------

# User-friendly tag → Bazel tag filter.
TAG_ALIASES = {
    "smoke": "oetf-smoke",
    "scenario": "oetf-scenario",
}

TARGET_PATTERN = "//test/oetf/staging/..."


# --- Env config ------------------------------------------------------------
#
#   Loaded by environments.py from:
#   Layer 1: test/oetf/data/oetf.default.yaml  (canonical, in-repo)
#   Layer 2: ~/.config/osmo/oetf.yaml                (user overlay)
#   + CLI flags on oetf:run win over both.


def _add_env_hint(name: str) -> str:
    """Return a NEXT: hint for adding a new named environment to the user overlay."""
    user_overlay = os.path.expanduser("~/.config/osmo/oetf.yaml")
    return (
        f"Add an entry to {user_overlay}:\n"
        f"    environments:\n"
        f"      {name}:\n"
        f"        url: https://...\n"
        f"        auth:\n"
        f"          strategy: token\n"
        f"          token_env: OSMO_<YOUR>_TOKEN\n"
        f"        type: custom\n"
        f"        pool: <pool-name>"
    )


# --- CLI ------------------------------------------------------------------


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="oetf:run",
        description="OETF test runner — wraps `bazel test //test/oetf/staging/...`.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_env_args(parser)
    add_run_args(parser)
    add_report_args(parser)
    # ``--env`` defaults differ per binary; override the shared helper's empty
    # default with ``staging`` for backwards-compatible run UX.
    parser.set_defaults(env="staging")
    return parser.parse_args(argv)


# --- Resolve env to concrete config ---------------------------------------


def resolve_env(args: argparse.Namespace) -> Dict[str, str]:
    """Resolve --env to concrete config via environments.py.

    Hard-errors on any missing required field with an ERROR:/NEXT: hint —
    no silent defaults.
    """
    try:
        env = resolve_environment(args.env)
    except KeyError as key_error:
        _config_error(str(key_error), _add_env_hint(args.env))

    url = args.url or env.url
    pool = args.pool or env.pool
    if not pool:
        _config_error(
            f"--env {args.env!r} has no pool.",
            f"Pass --pool, or add pool: under `{args.env}` in the env file.",
        )

    auth_method = args.auth_method or env.auth.strategy
    auth_username = args.auth_username or env.auth.username
    auth_token = args.auth_token
    if not auth_token and auth_method == "token":
        auth_token = resolve_token(env)
        if not auth_token:
            _config_error(
                f"--env {args.env!r} auth.token_env={env.auth.token_env} is not set.",
                f"Export {env.auth.token_env} (or pass --auth-token).",
            )
    if auth_method == "dev" and not auth_username:
        _config_error(
            "--auth-method dev requires a username.",
            "Pass --auth-username <name> (or set auth.username under the env in oetf.yaml).",
        )

    # When the user picks dev auth (no JWT issuer), the `auth` smoke suite
    # cannot authenticate against /auth/jwt — auto-exclude it so a quick
    # local run doesn't surface a confusing AUTH failure. The `kind` env
    # already has this exclusion baked in; this covers the custom-URL +
    # --auth-method=dev override path.
    exclude_tags = list(env.exclude_tags)
    if auth_method == "dev" and "auth" not in exclude_tags:
        exclude_tags.append("auth")

    return {
        "url": url,
        "auth_method": auth_method,
        "auth_token": auth_token,
        "auth_username": auth_username,
        "pool": pool,
        "local_osmo": args.local_osmo,
        "exclude_tags": ",".join(exclude_tags),
    }


def _config_error(message: str, next_step: str) -> NoReturn:
    """Print an ERROR:/NEXT: block and exit 2."""
    print(f"ERROR: {message}", file=sys.stderr)
    for i, line in enumerate(next_step.splitlines()):
        prefix = "NEXT:  " if i == 0 else "       "
        print(f"{prefix}{line}", file=sys.stderr)
    sys.exit(2)


# --- Seed data credential (for CLI-mode localpath uploads) ----------------


def seed_data_credential(args: argparse.Namespace, env: Dict[str, str]) -> None:
    """Populate the osmo CLI's DATA cred cache with the supplied key pair.

    Scenarios that submit via CLI with `localpath:` datasets (e.g.
    folder_input, data-io) upload files to the dataset backend and need a
    stored credential keyed by endpoint. Without this, Jenkins's fresh
    sandbox fails with `Data credential not found for <endpoint>`.

    Mirrors ci/workflow_runner.py's pre-run credential setup.
    """
    fields = (
        args.data_cred_access_key_id, args.data_cred_access_key,
        args.data_cred_endpoint, args.data_cred_region,
    )
    if not all(fields):
        if any(fields):
            _config_error(
                "--data-cred-* flags must all be set together.",
                "Provide --data-cred-access-key-id, --data-cred-access-key, "
                "--data-cred-endpoint, and --data-cred-region (or none).",
            )
        return

    config = OetfConfig(
        url=env["url"], auth_method=env["auth_method"],
        auth_token=env["auth_token"], auth_username=env["auth_username"],
        pool=env["pool"], local_osmo=env["local_osmo"],
    )
    login_cli_to(config)
    cli_path = resolve_osmo_cli(config)
    cmd = [
        cli_path, "credential", "set", "osmo_cred",
        "--type", "DATA", "--payload",
        f"access_key_id={args.data_cred_access_key_id}",
        f"access_key={args.data_cred_access_key}",
        f"endpoint={args.data_cred_endpoint}",
        f"region={args.data_cred_region}",
    ]
    print(f"+ osmo credential set osmo_cred --type DATA --payload "
          f"access_key_id=*** endpoint={args.data_cred_endpoint} "
          f"region={args.data_cred_region}", file=sys.stderr)
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        _config_error(
            f"failed to seed data credential (exit {result.returncode}): "
            f"{result.stderr[:500].strip()}",
            "Check that --data-cred-* values are correct and that the osmo "
            "API is reachable (token auth + endpoint).",
        )


# --- Build the bazel test invocation --------------------------------------


def build_bazel_command(
    args: argparse.Namespace, env: Dict[str, str], bep_path: str,
) -> List[str]:
    test_args: List[str] = []

    if args.name:
        target, qualified_name = resolve_name_target(args.name)
        targets = [target]
        if qualified_name:
            # Combined target — unittest needs a test selector argv.
            test_args.append(f"--test_arg={qualified_name}")
    else:
        # OETF test targets are `manual`-tagged (to keep them out of
        # `bazel test //...` expansion); wildcards skip them. Resolve the
        # actual targets via `bazel query` honoring the user's --tags filter.
        patterns = cli_args.parse_target_patterns(
            getattr(args, "target_pattern", []) or [],
            default=TARGET_PATTERN,
        )
        targets = _resolve_targets_via_query(
            args.tags, env["exclude_tags"], patterns,
        )
        if not targets:
            sys.exit(
                f"ERROR: no OETF test targets matched --tags={args.tags!r} "
                f"(after excluding {env["exclude_tags"]!r})."
            )

    cmd = [
        "bazel", "test", *targets,
        f"--test_env=OETF_URL={env["url"]}",
        f"--test_env=OETF_AUTH_METHOD={env["auth_method"]}",
        f"--test_env=OETF_AUTH_TOKEN={env["auth_token"]}",
        f"--test_env=OETF_AUTH_USERNAME={env["auth_username"]}",
        f"--test_env=OETF_POOL={env["pool"]}",
        f"--test_env=OETF_LOCAL_OSMO={env["local_osmo"]}",
        f"--test_env=OETF_ENV={args.env}",
        "--cache_test_results=no",
        f"--local_test_jobs={args.jobs}",
        "--test_output=errors",
        "--test_summary=terse",
        f"--build_event_json_file={bep_path}",
    ]
    cmd.extend(test_args)
    cmd.extend(args.bazel_arg)
    return cmd


def _resolve_targets_via_query(
    tags_arg: str,
    exclude_tags_arg: str = "",
    patterns: List[str] | None = None,
) -> List[str]:
    """Return the list of OETF test targets to run, resolved via bazel query.

    Applies the user's --tags filter server-side, subtracts any env-level
    exclude_tags, drops `-pylint` sidecars, and includes `manual`-tagged
    targets (which wildcard expansion would skip).

    ``patterns`` is the list of bazel target patterns to discover from. Each
    pattern is `tests()`-wrapped and unioned. Defaults to `[TARGET_PATTERN]`
    (today's behavior).
    """
    if not patterns:
        patterns = [TARGET_PATTERN]
    # Union of tests() over every pattern. Wrap each in tests() so that
    # pattern-level dedup works (bazel does the dedupe inside `+`).
    tests_union = " + ".join(f"tests({p})" for p in patterns)
    pylint_union = " + ".join(f'filter("-pylint$", tests({p}))' for p in patterns)
    tag_filter = _resolve_tag_filter(tags_arg)
    if tag_filter:
        tag_parts = tag_filter.split(",")
        # Keep only targets whose tags include ANY of the requested tags.
        # bazel query `attr` uses regex on the concatenated tag list.
        tag_regex = "|".join(re.escape(tag) for tag in tag_parts)
        expr = (
            f'attr(tags, "({tag_regex})", {tests_union}) '
            f'except ({pylint_union})'
        )
    else:
        expr = (
            f'({tests_union}) '
            f'except ({pylint_union})'
        )
    if exclude_tags_arg:
        exclude_parts = [t.strip() for t in exclude_tags_arg.split(",") if t.strip()]
        if exclude_parts:
            exclude_regex = "|".join(re.escape(t) for t in exclude_parts)
            expr = (
                f'({expr}) '
                f'except attr(tags, "({exclude_regex})", {tests_union})'
            )
    output = subprocess.check_output(
        ["bazel", "query", expr, "--output=label"],
        text=True,
        cwd=_workspace_root(),
    )
    return [line.strip() for line in output.splitlines() if line.strip()]


def _resolve_tag_filter(tags_arg: str) -> str:
    if not tags_arg:
        return ""
    parts = [p.strip() for p in tags_arg.split(",") if p.strip()]
    return ",".join(TAG_ALIASES.get(p, p) for p in parts)


# --- --name target resolution ---------------------------------------------


def resolve_name_target(name: str) -> Tuple[str, Optional[str]]:
    """Find the Bazel target that owns the given test method.

    `name` is accepted as either `test_foo`, `foo`, `TestClass.test_foo`, or
    the manifest-era `foo-bar` (hyphens auto-converted).

    Returns (target_label, test_arg_or_None). Files that have been split
    into per-test Bazel targets filter via the target's own `args`
    attribute, so no extra --test_arg is needed (returns None for the
    second tuple field).
    """
    class_hint, method = _parse_name(name)
    workspace = _workspace_root()
    staging = Path(workspace) / "test" / "oetf" / "staging"
    for py_file in staging.rglob("*.py"):
        text = py_file.read_text(encoding="utf-8")
        if f"def {method}" not in text:
            continue
        class_name = _find_class_containing_method(text, method)
        if class_hint and class_name != class_hint:
            continue
        package, file_stem = _package_and_stem(py_file, workspace)
        slug = method.removeprefix("test_").replace("_", "-")
        split_target = f"//{package}:{slug}"
        if _bazel_target_exists(split_target):
            return split_target, None
        combined_target = f"//{package}:{file_stem}"
        return combined_target, f"{class_name}.{method}"
    raise SystemExit(f"ERROR: no test matching --name={name!r} found under {staging}")


def _bazel_target_exists(label: str) -> bool:
    """Return True if `bazel query <label>` resolves to an existing target."""
    result = subprocess.run(
        ["bazel", "query", label, "--output=label"],
        cwd=_workspace_root(),
        capture_output=True, text=True, check=False,
    )
    return result.returncode == 0 and bool(result.stdout.strip())


def _parse_name(name: str) -> Tuple[str, str]:
    if "." in name:
        cls, method = name.rsplit(".", 1)
        method = method if method.startswith("test_") else f"test_{method.replace("-", "_")}"
        return cls, method
    method = name if name.startswith("test_") else f"test_{name.replace("-", "_")}"
    return "", method


def _find_class_containing_method(text: str, method: str) -> Optional[str]:
    class_name = None
    for line in text.splitlines():
        match = re.match(r"class (\w+)\(", line)
        if match:
            class_name = match.group(1)
        if class_name and re.search(rf"\s+def {method}\b", line):
            return class_name
    return None


def _package_and_stem(py_file: Path, workspace: str) -> Tuple[str, str]:
    """Return (bazel_package, file_stem_slug) for a scenario source file.

    Convention used by oetf_{smoke,scenario}_test macros:
      - src = "api_checks.py" → stem "api-checks" in the package.
      - test_dir = "router_connectivity" → stem "router-connectivity".
    """
    rel = py_file.relative_to(workspace)
    parts = rel.parts
    if rel.name == "test_runner.py":
        return "/".join(parts[:-2]), parts[-2].replace("_", "-")
    return "/".join(parts[:-1]), rel.stem.replace("_", "-")


# --- bazel-testlogs parsing -----------------------------------------------


def bazel_testlogs_dir() -> Optional[str]:
    """Absolute path to Bazel's testlogs dir (per workspace)."""
    try:
        output = subprocess.check_output(
            ["bazel", "info", "bazel-testlogs"], text=True,
            cwd=_workspace_root(),
        )
        return output.strip()
    except subprocess.CalledProcessError:
        return None


def parse_bep_test_results(bep_path: str) -> List[Dict]:
    """Parse Bazel's Build Event Protocol stream for per-target test outcomes.

    BEP emits one `testResult` event per target (or per attempt). Each event
    carries the target label, overall status (PASSED/FAILED/...), cached flag,
    wall-clock duration, and the paths of any test outputs (log, test.xml).

    This is the authoritative per-invocation record — unlike bazel-testlogs/,
    it is not polluted by previous runs.
    """
    results: List[Dict] = []
    if not os.path.isfile(bep_path):
        return results
    with open(bep_path, "r", encoding="utf-8") as bep_file:
        for line in bep_file:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            test_result = event.get("testResult")
            if not test_result:
                continue
            target = _label_from_bep_id(event.get("id", {}))
            if target.endswith("-pylint"):
                continue
            status = test_result.get("status", "UNKNOWN")
            duration_ms = int(test_result.get("testAttemptDurationMillis", 0))
            cached = test_result.get("cachedLocally", False) or test_result.get(
                "executionInfo", {}
            ).get("cachedRemotely", False)
            message = ""
            if status != "PASSED":
                message = _extract_failure_from_bep(test_result)
            results.append({
                "target": target,
                "classname": "",
                "name": target.rsplit(":", 1)[-1] if ":" in target else target,
                "time": duration_ms / 1000.0,
                "status": _bep_status_to_status(status),
                "message": message,
                "cached": cached,
            })
    results.sort(key=lambda r: r["target"])
    return results


def _label_from_bep_id(event_id: Dict) -> str:
    test_result = event_id.get("testResult") or {}
    return test_result.get("label", "")


def _bep_status_to_status(bazel_status: str) -> str:
    return {
        "PASSED": "pass",
        "FLAKY": "pass",
        "FAILED": "fail",
        "TIMEOUT": "fail",
        "INCOMPLETE": "error",
        "REMOTE_FAILURE": "error",
        "FAILED_TO_BUILD": "error",
        "TOOL_HALTED_BEFORE_TESTING": "skip",
        "NO_STATUS": "skip",
    }.get(bazel_status, "error")


def _extract_failure_from_bep(test_result: Dict) -> str:
    status = test_result.get("status", "")
    if status == "TIMEOUT":
        return "test timed out"
    log_path = _bep_log_path(test_result)
    if log_path:
        summary = summarize_log_path(log_path)
        if summary:
            return summary
    return status


def _bep_log_path(test_result: Dict) -> str:
    """Return the on-disk path to the `test.log` from a BEP testResult, or ''."""
    for output in test_result.get("testActionOutput", []):
        if not output.get("name", "").endswith(".log"):
            continue
        uri = output.get("uri", "")
        if uri.startswith("file://"):
            return uri[len("file://"):]
    return ""


def _iter_testsuites(root):
    if root.tag == "testsuites":
        return root.findall("testsuite")
    if root.tag == "testsuite":
        return [root]
    return []


def _parse_testcase(testcase, target: str) -> Dict:
    status = "pass"
    message = ""
    for child in testcase:
        if child.tag == "failure":
            status = "fail"
            message = child.get("message", "") or (child.text or "").strip().split("\n")[-1]
            break
        if child.tag == "error":
            status = "error"
            message = child.get("message", "") or (child.text or "").strip().split("\n")[-1]
            break
        if child.tag == "skipped":
            status = "skip"
            message = child.get("message", "")
            break
    return {
        "target": target,
        "classname": testcase.get("classname", ""),
        "name": testcase.get("name", ""),
        "time": float(testcase.get("time", "0") or 0),
        "status": status,
        "message": message[:500],
    }


def _target_from_xml_path(xml_path: str, testlogs_dir: str) -> str:
    rel = os.path.relpath(xml_path, testlogs_dir)
    parts = rel.split(os.sep)
    if not parts or parts[-1] != "test.xml":
        return rel
    # Bazel layout: <package_path>/<target_name>/test.xml
    package = "/".join(parts[:-2])
    target_name = parts[-2]
    return f"//{package}:{target_name}" if package else f"//:{target_name}"


# --- Summary rendering ----------------------------------------------------


def render_summary(
    env: Dict[str, str], args: argparse.Namespace, results: List[Dict],
) -> str:
    by_status: Dict[str, int] = {"pass": 0, "fail": 0, "error": 0, "skip": 0}
    lines: List[str] = []
    lines.append(f"OETF Run: {env["url"]}")
    lines.append(f"Env:      {args.env}")
    if args.tags:
        lines.append(f"Tags:     {args.tags}")
    if args.name:
        lines.append(f"Name:     {args.name}")
    lines.append(f"Time:     {_now_iso()}")
    lines.append("")
    if not results:
        lines.append("(no test results reported by Bazel)")
    else:
        width = max(len(_short_label(r)) for r in results)
        for result in results:
            status_tag = {
                "pass": "[PASS]", "fail": "[FAIL]", "error": "[ERR ]", "skip": "[SKIP]",
            }.get(result["status"], "[?]")
            by_status[result["status"]] += 1
            line = (
                f"  {status_tag} {_short_label(result):<{width}}  "
                f"{result["time"]:6.2f}s"
            )
            if result["message"]:
                line += f"  -- {result["message"]}"
            lines.append(line)
    lines.append("")
    total = sum(by_status.values())
    lines.append(
        f"Total: {total}  Passed: {by_status["pass"]}  "
        f"Failed: {by_status["fail"]}  Errors: {by_status["error"]}  "
        f"Skipped: {by_status["skip"]}"
    )
    lines.append("")
    lines.append(
        "RESULT: PASS" if (by_status["fail"] == 0 and by_status["error"] == 0)
        else "RESULT: FAIL"
    )
    return "\n".join(lines)


def _short_label(result: Dict) -> str:
    # Bazel's auto-generated test.xml uses the full target path as classname AND
    # name (one testcase per target). Prefer the Bazel label for readability.
    if result["target"]:
        return result["target"].lstrip("/").replace("test/oetf/staging/", "")
    class_name = result["classname"].rsplit(".", 1)[-1]
    return f"{class_name}.{result["name"]}" if class_name else result["name"]


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


# --- JSON output ----------------------------------------------------------


def write_json(path: str, env: Dict[str, str], args: argparse.Namespace,
               results: List[Dict]) -> None:
    payload = {
        "url": env["url"],
        "env": args.env,
        "tags": args.tags,
        "name": args.name,
        "timestamp": _now_iso(),
        "total": len(results),
        "passed": sum(1 for r in results if r["status"] == "pass"),
        "failed": sum(1 for r in results if r["status"] == "fail"),
        "errored": sum(1 for r in results if r["status"] == "error"),
        "skipped": sum(1 for r in results if r["status"] == "skip"),
        "results": results,
    }
    with open(path, "w", encoding="utf-8") as output_file:
        json.dump(payload, output_file, indent=2)


# --- Workspace discovery --------------------------------------------------


def _workspace_root() -> str:
    return os.environ.get("BUILD_WORKSPACE_DIRECTORY") or os.getcwd()


# --- Reporter dispatch ----------------------------------------------------


def maybe_publish_report(
    args: argparse.Namespace, env: Dict[str, str], targets: List[str],
) -> None:
    """Invoke the reporter when --report-s3 is set. No-op otherwise."""
    if not args.report_s3:
        return
    try:
        actor = _resolve_actor(args, env)
        source = args.report_source or f"users/{actor}"
        run_id = _resolve_run_id()
        sink = _build_sink(args)
        report_url = aggregate.run(
            sink=sink,
            source=source,
            env_name=args.env,
            env_url=env.get("url", ""),
            run_id=run_id,
            actor=actor,
            targets=targets,
            testlogs_dir=bazel_testlogs_dir() or "",
            build_url=os.environ.get("BUILD_URL") or None,
            categories_path=args.report_categories or _default_categories_path(),
        )
        # Prints follow the bazel-stage [PASS]/[FAIL] summary so the
        # user reads: results → blank line → links. All on stdout so
        # ordering is stable when piping.
        summary_url = report_url.replace("/index.html", "/summary.html")
        print()
        print(f"Summary: {summary_url}")
        print(f"Report:  {report_url}")
    except Exception as exc:  # pylint: disable=broad-except
        if args.report_strict:
            raise
        print(f"[reporter] upload skipped: {type(exc).__name__}: {exc}",
              file=sys.stderr)


def _resolve_actor(args: argparse.Namespace, env: Dict[str, str]) -> str:
    if args.report_actor:
        return args.report_actor
    # Try OSMO profile — best-effort; swallow all errors and fall through.
    try:
        config = OetfConfig(
            url=env.get("url", ""),
            auth_method=env.get("auth_method", "token"),
            auth_token=env.get("auth_token", ""),
            auth_username=env.get("auth_username", ""),
            pool=env.get("pool", ""),
        )
        client = create_service_client(config)
        profile = client.request(method=RequestMethod.GET,
                                 endpoint="api/profile/settings")
        username = profile.get("username") if isinstance(profile, dict) else None
        if username:
            return username
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[oetf-reporter] OSMO profile lookup failed, falling back to "
              f"$USER@$HOSTNAME: {type(exc).__name__}: {exc}",
              file=sys.stderr)
    return f"{getpass.getuser()}@{socket.gethostname()}"


def _resolve_run_id() -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    return reporter.compute_run_id(now=now, git_sha=_git_short_sha())


def _git_short_sha() -> Optional[str]:
    """Return the 7-char git short SHA, or None if git isn't usable.

    None lets reporter.compute_run_id substitute its non-hex sentinel
    (`XXXXXXX`) — passing back a 7-hex literal here would risk colliding
    with a real SHA in run-id slugs.
    """
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short=7", "HEAD"],
            cwd=_workspace_root(), text=True,
        ).strip()
        return out or None
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[oetf-reporter] git short-sha lookup failed: "
              f"{type(exc).__name__}: {exc}",
              file=sys.stderr)
        return None


def _credential(
    arg_value: Optional[str], oetf_env: str, swift_env: str, default: str = "",
) -> str:
    """Resolve a credential through the standard fallback chain:
    explicit CLI flag > $OETF_REPORT_X > $SWIFT_X > default.

    arg_value is Optional[str]: None means "not provided", which falls
    through to the env vars. Consumers needing a non-empty string should
    check the return and raise — see _build_sink's endpoint check.
    """
    return (arg_value
            or os.environ.get(oetf_env, "")
            or os.environ.get(swift_env, "")
            or default)


def _build_sink(args: argparse.Namespace) -> "S3Sink":
    # _build_sink is only reached when args.report_s3 is set (caller
    # short-circuits on its absence). Defensive against internal misuse.
    if not args.report_s3:
        raise ValueError("args.report_s3 must be set before building a sink")
    bucket, prefix = _parse_s3_url(args.report_s3)
    endpoint = _credential(
        args.report_s3_endpoint, "OETF_REPORT_S3_ENDPOINT", "SWIFT_ENDPOINT",
    )
    if not endpoint:
        raise RuntimeError(
            "S3 endpoint required: pass --report-s3-endpoint or set "
            "$SWIFT_ENDPOINT / $OETF_REPORT_S3_ENDPOINT"
        )
    return S3Sink(
        bucket=bucket, prefix=prefix, endpoint_url=endpoint,
        access_key_id=_credential(
            args.report_s3_access_key_id,
            "OETF_REPORT_S3_ACCESS_KEY_ID", "SWIFT_ACCESS_KEY_ID"),
        secret_key=_credential(
            args.report_s3_secret_key,
            "OETF_REPORT_S3_SECRET_KEY", "SWIFT_ACCESS_KEY"),
        region=_credential(
            args.report_s3_region,
            "OETF_REPORT_S3_REGION", "SWIFT_REGION", default="us-east-1"),
        public_url_base=args.report_public_url_base or "",
    )


def _parse_s3_url(url: str) -> Tuple[str, str]:
    """s3://bucket/prefix -> ('bucket', 'prefix')."""
    if not url.startswith("s3://"):
        raise ValueError(f"Expected s3:// URL, got {url!r}")
    rest = url[len("s3://"):]
    if "/" in rest:
        bucket, prefix = rest.split("/", 1)
        return bucket, prefix.rstrip("/")
    return rest, ""


def _default_categories_path() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "data", "categories.json")


# --- main -----------------------------------------------------------------


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    env = resolve_env(args)
    seed_data_credential(args, env)
    bep_path = _bep_path()
    cmd = build_bazel_command(args, env, bep_path)

    print("+ " + " ".join(_redact(arg, env) for arg in cmd), file=sys.stderr)
    proc = subprocess.run(cmd, cwd=_workspace_root(), check=False)
    bazel_exit = proc.returncode

    results = parse_bep_test_results(bep_path)
    print(render_summary(env, args, results))

    targets = [r["target"] for r in results if r.get("target")]
    maybe_publish_report(args, env, targets)

    if args.output_json:
        write_json(args.output_json, env, args, results)
        print(f"Results JSON written to {args.output_json}", file=sys.stderr)

    failed_or_errored = any(r["status"] in {"fail", "error"} for r in results)
    return 1 if (bazel_exit != 0 or failed_or_errored) else 0


def _bep_path() -> str:
    """Path to write the Build Event Protocol JSON stream to.

    Write inside the workspace root so we can read it back from this
    process's TMPDIR (bazel run sets TMPDIR to a per-run sandbox dir that
    disappears when the binary exits).
    """
    return os.path.join(_workspace_root(), ".oetf-bep.json")


def _redact(arg: str, env: Dict[str, str]) -> str:
    token = env.get("auth_token", "")
    if token and token in arg:
        return arg.replace(token, "***")
    return arg


if __name__ == "__main__":
    sys.exit(main())
