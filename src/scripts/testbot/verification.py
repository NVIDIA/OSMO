# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Independent checks and a content-bound handoff to PR creation."""

import difflib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

from src.scripts.testbot.agent_runner import stop_process_group
from src.scripts.testbot.guardrails import is_allowed_change
from src.scripts.testbot import verify_coverage


def git(*args: str) -> str:
    """Read repository state, failing closed on git errors."""
    return subprocess.run(['git', *args], capture_output=True, text=True,
                          check=True).stdout


def changed_files() -> list[str]:
    """Include staged changes, deletions, and new files in the review boundary."""
    paths = set(git('diff', 'HEAD', '--name-only', '-z').split('\0'))
    paths.update(git('ls-files', '--others', '--exclude-standard', '-z').split('\0'))
    return sorted(path for path in paths if path and not path.startswith('.claude/'))


def fingerprint(paths: list[str]) -> dict[str, str | None]:
    """Bind verification to exact file contents, including deletions."""
    result = {}
    for name in paths:
        path = Path(name)
        if path.is_symlink():
            raise ValueError(f'Symlink changes are not supported: {name}')
        result[name] = (f'{path.stat().st_mode & 0o111:o}:'
                        + hashlib.sha256(path.read_bytes()).hexdigest()) if path.exists() else None
    return result


def save_patch(path: Path) -> None:
    """Preserve tracked and untracked edits even when an agent fails."""
    with path.open('wb') as output:
        subprocess.run(['git', 'diff', 'HEAD', '--binary'], stdout=output, check=True)
        for name in git('ls-files', '--others', '--exclude-standard', '-z').split('\0'):
            if name and not name.startswith('.claude/'):
                result = subprocess.run(['git', 'diff', '--no-index', '--binary',
                                         '--', '/dev/null', name], stdout=output, check=False)
                if result.returncode not in (0, 1):
                    raise RuntimeError(f'Could not save patch for {name}')


def retain_generated_tests() -> None:
    """Apply the generator's test-only contract before the reviewer gets control."""
    paths = changed_files()
    tracked = set(git('ls-files', '-z').split('\0'))
    for name in paths:
        if not is_allowed_change(name, set(paths)):
            if name in tracked:
                git('restore', '--source=HEAD', '--staged', '--worktree', '--', name)
            else:
                Path(name).unlink()


def check_change_scope(paths: list[str]) -> None:
    """Keep workflow and harness code out of agent patches transferred between jobs."""
    for name in paths:
        if (not name.startswith('src/') or '..' in Path(name).parts
                or name.startswith('src/scripts/testbot/')):
            raise ValueError(f'Change is outside test/source repair scope: {name}')


def load_verified_changes(path: Path) -> list[str]:
    """Reject stale approval if anything changed after independent verification."""
    manifest = json.loads(path.read_text(encoding='utf-8'))
    paths = changed_files()
    check_change_scope(paths)
    if (manifest.get('verified') is not True
            or manifest.get('base_commit') != git('rev-parse', 'HEAD').strip()
            or manifest.get('files') != fingerprint(paths)):
        raise ValueError('Reviewed changes differ from the independently verified changes')
    return paths


def run_check(command: list[str], output: Path, deadline: float) -> None:
    """Run a check with a shared deadline and terminate descendants on timeout."""
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('Independent verification time budget exhausted')
    environment = {name: value for name, value in os.environ.items() if name not in {
        'NVIDIA_API_KEY', 'ANTHROPIC_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN',
    }}
    with output.open('w', encoding='utf-8') as log:
        with subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                              start_new_session=True, env=environment) as process:
            try:
                status = process.wait(timeout=remaining)
            except subprocess.TimeoutExpired as error:
                raise TimeoutError(f'Verification timed out: {command[0]}') from error
            finally:
                stop_process_group(process)
    if status:
        raise RuntimeError(f'Verification failed ({status}); see {output}')


def package_for(name: str) -> str:
    """Find the enclosing Bazel package for source and test files."""
    directory = Path(name).parent
    while True:
        if (directory / 'BUILD').exists() or (directory / 'BUILD.bazel').exists():
            return '' if directory == Path('.') else directory.as_posix()
        if directory == Path('.'):
            raise ValueError(f'No Bazel package for {name}')
        directory = directory.parent


def coverage_on_original_lines(meta: list[dict], coverage: dict[str, dict[int, int]],
                               base_commit: str) -> tuple[dict[str, dict[int, int]], list[str]]:
    """Map unchanged source lines after reviewer fixes; never miscredit shifted lines.

    Replaced/deleted original lines remain uncovered. The original denominator
    is preserved, and the report explicitly calls out this conservative mapping.
    """
    mapped = dict(coverage)
    edited = []
    for target in meta:
        name = target['file_path']
        original = git('show', f'{base_commit}:{name}').splitlines()
        current = Path(name).read_text(encoding='utf-8').splitlines() if Path(name).exists() else []
        if original == current or name not in coverage:
            continue
        edited.append(name)
        mapped[name] = {}
        for block in difflib.SequenceMatcher(a=original, b=current, autojunk=False).get_matching_blocks():
            for offset in range(block.size):
                mapped[name][block.a + offset + 1] = coverage[name].get(block.b + offset + 1, 0)
    return mapped, edited


def verify(meta: list[dict], artifacts: Path, base_commit: str, timeout: int) -> list[dict]:
    """Re-run tests after the reviewer edits, then record actual coverage."""
    deadline = time.monotonic() + timeout
    paths = changed_files()
    check_change_scope(paths)
    before = fingerprint(paths)
    if not paths:
        raise ValueError('No changes remain after review')
    if git('rev-parse', 'HEAD').strip() != base_commit:
        raise ValueError('An agent changed the baseline commit')
    selected = [target['file_path'] for target in meta]
    ui = any(name.startswith('src/ui/') for name in paths + selected)
    non_ui = [name for name in paths + selected if not name.startswith('src/ui/')]
    coverage: dict[str, dict[int, int]] = {}
    if non_ui:
        packages = sorted({package_for(name) for name in non_ui})
        patterns = ' union '.join(f'//{package}/...' if package else '//...' for package in packages)
        production = [name for name in paths if not is_allowed_change(name, set(paths))
                      and not name.startswith('src/ui/')]
        if production:
            roots = ' '.join(f'//{package_for(name)}:all' for name in production)
            patterns += f' union rdeps(//src/..., set({roots}))'
        query = f'kind(".*_test rule", {patterns})'
        query = f'({query}) except attr("tags", "manual", ({query}))'
        query_log = artifacts / 'bazel-query.log'
        run_check(['bazel', 'query', query, '--output=label'], query_log, deadline)
        targets = [line for line in query_log.read_text(encoding='utf-8').splitlines() if line.startswith('//')]
        if not targets:
            raise ValueError('No Bazel tests discovered for the reviewed changes')
        # Verify that every added/edited test is actually wired into a test rule.
        for index, name in enumerate(paths):
            if not name.endswith(('.py', '.go')) or not is_allowed_change(name, set(paths)):
                continue
            if not Path(name).exists():
                continue
            package = package_for(name)
            relative = Path(name).relative_to(package or '.').as_posix()
            pattern = f'//{package}/...' if package else '//...'
            wiring = f'kind(".*_test rule", rdeps({pattern}, //{package}:{relative}))'
            wiring = f'({wiring}) except attr("tags", "lint", ({wiring}))'
            wiring_log = artifacts / f'wiring-{index}.log'
            run_check(['bazel', 'query', wiring, '--output=label'], wiring_log, deadline)
            if not any(line in targets for line in wiring_log.read_text(encoding='utf-8').splitlines()):
                raise ValueError(f'Test is not wired into the verification targets: {name}')
        lcov = Path('bazel-out/_coverage/_coverage_report.dat')
        lcov.unlink(missing_ok=True)
        run_check(['bazel', 'coverage', '--test_output=errors', *targets],
                  artifacts / 'bazel-coverage.log', deadline)
        if not lcov.is_file():
            raise ValueError('Bazel produced no fresh LCOV report')
        coverage.update(verify_coverage.parse_lcov(lcov))
        (artifacts / 'bazel-coverage.dat').write_bytes(lcov.read_bytes())
    if ui:
        lcov = Path('src/ui/coverage/lcov.info')
        lcov.unlink(missing_ok=True)
        run_check(['pnpm', '--dir', 'src/ui', 'validate:coverage'],
                  artifacts / 'ui-validation.log', deadline)
        if not lcov.is_file():
            raise ValueError('UI validation produced no fresh LCOV report')
        for name, hits in verify_coverage.parse_lcov(lcov).items():
            path = Path(name)
            normalized = (path.relative_to(Path.cwd()).as_posix() if path.is_absolute()
                          else 'src/ui/' + name)
            coverage[normalized] = hits
        (artifacts / 'ui-coverage.dat').write_bytes(lcov.read_bytes())
    mapped, edited = coverage_on_original_lines(meta, coverage, base_commit)
    reports = verify_coverage.build_reports(meta, mapped)
    (artifacts / 'coverage_report.json').write_text(verify_coverage.render_json(reports), encoding='utf-8')
    markdown = verify_coverage.render_markdown(reports)
    if edited:
        markdown += ('\nSource fixes shifted selected ranges in: ' + ', '.join(edited)
                     + '. Coverage is mapped to unchanged original lines; replaced/deleted '
                     'original lines count as uncovered. The original denominator is preserved.\n')
    (artifacts / 'coverage_report.md').write_text(markdown, encoding='utf-8')
    if any(not report.lcov_seen for report in reports):
        raise ValueError('Coverage is missing for a selected target')
    if before != fingerprint(changed_files()):
        raise ValueError('Files changed during independent verification')
    return json.loads(verify_coverage.render_json(reports))
