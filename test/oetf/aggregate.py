"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Aggregator: walks BEP results, extracts per-target outputs.zip into a
# single allure-results staging dir, runs `allure generate`, and uploads
# via the configured S3Sink. Best-effort throughout.

import html
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile
from typing import List, Optional

from test.oetf import reporter
from test.oetf.sinks import S3Sink


def _copy_from_dir(results_dir: str, staging_dir: str) -> List[str]:
    """Copy *-result.json and *-attachment.* files from results_dir into staging_dir.

    Bazel preserves read-only mode bits on its testlog outputs; we strip
    those so the aggregator can append attachment entries to result JSONs
    in a later pass.

    Returns the list of filenames written to staging_dir (results +
    attachments). Caller filters for `-result.json` to derive per-target
    UUIDs without rescanning the entire staging dir.
    """
    written: List[str] = []
    if not os.path.isdir(results_dir):
        return written
    for filename in os.listdir(results_dir):
        if not (filename.endswith('-result.json') or '-attachment.' in filename):
            continue
        src_path = os.path.join(results_dir, filename)
        if not os.path.isfile(src_path):
            continue
        dst_path = os.path.join(staging_dir, filename)
        shutil.copy2(src_path, dst_path)
        os.chmod(dst_path, 0o644)
        written.append(filename)
    return written


def _copy_from_zip(zip_path: str, staging_dir: str) -> List[str]:
    """Extract allure-results/* members from a zip file into staging_dir.

    Returns the list of filenames written (see _copy_from_dir).
    """
    written: List[str] = []
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            if not member.startswith('allure-results/'):
                continue
            if member.endswith('/'):
                continue
            target_name = os.path.basename(member)
            with zf.open(member) as src, open(
                os.path.join(staging_dir, target_name), 'wb'
            ) as dst:
                dst.write(src.read())
            written.append(target_name)
    return written


def _result_uuids(filenames: List[str]) -> List[str]:
    """Filter `*-result.json` from a filename list and return their UUIDs."""
    suffix = '-result.json'
    return [n[:-len(suffix)] for n in filenames if n.endswith(suffix)]


def collect_allure_results(
    testlogs_dir: str, targets: List[str], staging_dir: str
) -> int:
    """Collect allure result files from Bazel test outputs into staging_dir.

    Handles three layouts per target:
    - Plain directory: test.outputs/allure-results/
    - Zipped: test.outputs/outputs.zip (containing allure-results/ entries)
    - Per-attempt (--runs_per_test=N): test.outputs/test_attempts/attempt_*/allure-results/

    A label like //test/oetf/staging/smoke:api-checks maps to
    bazel-testlogs/test_infra/oetf/staging/smoke/api-checks/test.outputs/

    Also copies each target's test.log into staging_dir as an attachment
    and links it from every result.json the target produced — so the
    Allure detail view's Attachments panel surfaces the full Bazel log
    one click away from each test.

    Returns count of result+attachment files copied (excluding test.log
    attachments added separately).
    """
    os.makedirs(staging_dir, exist_ok=True)
    count = 0
    for label in targets:
        if not label.startswith('//') or ':' not in label:
            # Skip non-Bazel labels and bare-package labels (`//pkg`
            # without an explicit target name); we can't derive a
            # testlogs path from the latter without a Bazel query.
            continue
        body = label[2:]
        package, target_name = body.split(':', 1)
        target_root = os.path.join(testlogs_dir, package, target_name)
        outputs_dir = os.path.join(target_root, 'test.outputs')

        target_files: List[str] = []
        target_files.extend(_copy_from_dir(
            os.path.join(outputs_dir, 'allure-results'), staging_dir,
        ))
        zip_path = os.path.join(outputs_dir, 'outputs.zip')
        if os.path.isfile(zip_path):
            target_files.extend(_copy_from_zip(zip_path, staging_dir))
        attempts_dir = os.path.join(outputs_dir, 'test_attempts')
        if os.path.isdir(attempts_dir):
            for attempt in sorted(os.listdir(attempts_dir)):
                target_files.extend(_copy_from_dir(
                    os.path.join(attempts_dir, attempt, 'allure-results'),
                    staging_dir,
                ))
        count += len(target_files)
        if not target_files:
            continue

        log_path = os.path.join(target_root, 'test.log')
        if os.path.isfile(log_path):
            _attach_test_log(log_path, _result_uuids(target_files), staging_dir)
    return count


def _attach_test_log(
    log_path: str, target_uuids: List[str], staging_dir: str,
) -> None:
    """Drop the Bazel test.log into staging_dir and link it as a top-level
    attachment on every result.json the target produced.

    The attachment renders in Allure's Body tab → Attachments panel as a
    'test.log' link with an inline viewer (one click).
    """
    log_uuid = str(uuid.uuid4())
    full_log_dest = os.path.join(staging_dir, f'{log_uuid}-attachment.log')
    shutil.copy2(log_path, full_log_dest)
    attachment_entry = {
        'name': 'test.log',
        'source': f'{log_uuid}-attachment.log',
        'type': 'text/plain',
    }
    for result_uuid in target_uuids:
        result_path = os.path.join(staging_dir, f'{result_uuid}-result.json')
        if not os.path.isfile(result_path):
            continue
        with open(result_path, encoding='utf-8') as fh:
            try:
                data = json.load(fh)
            except json.JSONDecodeError:
                continue
        attachments = data.setdefault('attachments', [])
        if any(a.get('source') == attachment_entry['source'] for a in attachments):
            continue
        attachments.append(attachment_entry)
        with open(result_path, 'w', encoding='utf-8') as fh:
            json.dump(data, fh)


def resolve_allure_bin(override: Optional[str] = None) -> str:
    """Find the allure CLI: explicit override > $ALLURE_BIN > 'allure' on PATH.

    Raises RuntimeError if none works.
    """
    if override:
        return override
    env_bin = os.environ.get('ALLURE_BIN', '')
    if env_bin:
        return env_bin
    found = shutil.which('allure')
    if not found:
        raise RuntimeError(
            'Allure CLI not found. Install via `npm install -g allure` or '
            '`brew install allure`, or set ALLURE_BIN to its path.'
        )
    return found


def _write_allurerc(
    config_dir: str, output_dir: str, history_path: str,
) -> str:
    """Write an allurerc.json into config_dir with output + historyPath +
    awesome plugin. Returns the path to the written file.

    Allure 3 auto-discovers allurerc.{json,js,mjs,yaml} from the cwd of the
    `allure generate` invocation; we run from config_dir so this gets picked
    up. JSON form keeps the config inert (no JS execution).

    The `awesome` plugin is Allure 3's default modern UI — has native theme
    support (auto/light/dark via prefers-color-scheme + ThemeButton toggle),
    historic trends, the works.
    """
    # timeline.minDuration: 0 — Allure 3's awesome plugin defaults to a
    # higher cutoff (~60s typical) which hides every short-running OETF
    # test, leaving the Timeline tab blank. Drop the cutoff so even
    # millisecond-scale steps show up.
    config = {
        'name': 'OETF',
        'output': output_dir,
        'historyPath': history_path,
        'plugins': {
            'awesome': {
                'options': {
                    'reportLanguage': 'en',
                    'reportName': 'OETF',
                    'timeline': {'minDuration': 0},
                },
            },
        },
    }
    config_path = os.path.join(config_dir, 'allurerc.json')
    with open(config_path, 'w', encoding='utf-8') as fh:
        json.dump(config, fh, indent=2)
    return config_path


def run_allure_generate(
    staging_dir: str, output_dir: str, history_path: str,
    allure_bin: Optional[str] = None, config_dir: Optional[str] = None,
) -> None:
    """Run `allure generate <staging>` with output+historyPath wired through
    an allurerc.json in config_dir (defaults to staging_dir's parent).

    Allure 3 reads its config from cwd, so we invoke with cwd=config_dir and
    write allurerc.json there before running.
    """
    bin_path = resolve_allure_bin(allure_bin)
    config_dir = config_dir or os.path.dirname(staging_dir) or '.'
    _write_allurerc(config_dir, output_dir, history_path)
    proc = subprocess.run(
        [bin_path, 'generate', staging_dir],
        cwd=config_dir,
        capture_output=True, text=True, check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f'allure generate failed (exit {proc.returncode}): {proc.stderr}'
        )


def _escape_html(text: str) -> str:
    return html.escape(text, quote=True)


def write_failure_summary(report_dir: str, public_url_base: str) -> str:
    """Walk the generated Allure data dir for failed/broken tests, render a
    static failure summary at <report_dir>/summary.html. Returns the public
    URL to summary.html.

    Allure 3's awesome plugin writes per-test JSON to data/test-results/
    (the Allure-2 layout was data/test-cases/ + a sibling suites.json that
    we used to build deep-link parents — neither exists in Allure 3). The
    awesome UI deep-links to a single result via index.html#/<id>, where
    `id` is the top-level field on each test-result JSON.
    """
    test_cases_dir = os.path.join(report_dir, 'data', 'test-results')
    failures: List[dict] = []
    passes: List[dict] = []
    if os.path.isdir(test_cases_dir):
        for file_name in sorted(os.listdir(test_cases_dir)):
            if not file_name.endswith('.json'):
                continue
            with open(os.path.join(test_cases_dir, file_name), encoding='utf-8') as fh:
                try:
                    data = json.load(fh)
                except json.JSONDecodeError:
                    continue
            status = data.get('status', '')
            entry = _build_summary_entry(data, status, public_url_base)
            if status in ('failed', 'broken'):
                failures.append(entry)
            elif status == 'passed':
                passes.append(entry)

    parts = [
        '<!doctype html><html><head><meta charset="utf-8">',
        '<title>OETF Run Summary</title>',
        '<style>',
        'body { font-family: -apple-system, sans-serif; max-width: 1200px;'
        ' margin: 2em auto; padding: 0 1em; }',
        'table { width: 100%; border-collapse: collapse; table-layout: fixed; }',
        'th, td { padding: 0.6em; text-align: left;'
        ' border-bottom: 1px solid #eee; vertical-align: top; }',
        'col.col-test { width: 22%; }',
        'col.col-status { width: 8%; }',
        'col.col-reason { width: 60%; }',
        'col.col-workflow { width: 10%; }',
        'col.col-test-pass { width: 70%; }',
        'col.col-workflow-pass { width: 30%; }',
        '.failed { color: #d34646; font-weight: bold; }',
        '.broken { color: #cf9c00; font-weight: bold; }',
        '.passed { color: #5e9c00; font-weight: bold; }',
        '.message { font-family: monospace; font-size: 0.9em; '
        'white-space: pre-wrap; word-break: break-word; '
        'overflow-wrap: anywhere; }',
        'td.test-name { word-break: break-word; }',
        'h2 { margin-top: 2em; }',
        '</style></head><body>',
        '<h1>OETF Run Summary</h1>',
        '<p><a href="index.html">← Full Allure report</a></p>',
    ]

    parts.append('<h2>Failures</h2>')
    if not failures:
        parts.append('<p>No failures.</p>')
    else:
        parts.append(f'<p>{len(failures)} test(s) failed or broken.</p>')
        parts.append('<table>')
        parts.append('<colgroup>')
        parts.append('<col class="col-test"><col class="col-status">')
        parts.append('<col class="col-reason"><col class="col-workflow">')
        parts.append('</colgroup>')
        parts.append(
            '<tr><th>Test</th><th>Status</th><th>Reason</th><th>Workflow</th></tr>'
        )
        for failure in failures:
            parts.append(_render_failure_row(failure))
        parts.append('</table>')

    if passes:
        parts.append(f'<h2>Passed ({len(passes)})</h2>')
        parts.append('<table>')
        parts.append('<colgroup>')
        parts.append('<col class="col-test-pass"><col class="col-workflow-pass">')
        parts.append('</colgroup>')
        parts.append('<tr><th>Test</th><th>Workflow</th></tr>')
        for entry in passes:
            parts.append(_render_pass_row(entry))
        parts.append('</table>')

    parts.append('</body></html>')

    summary_path = os.path.join(report_dir, 'summary.html')
    with open(summary_path, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(parts))
    base = public_url_base.rstrip('/')
    return f'{base}/summary.html'


def _build_summary_entry(
    data: dict, status: str, public_url_base: str,
) -> dict:
    workflow_link = ''
    for link in data.get('links', []):
        if link.get('type') == 'tms':
            workflow_link = link.get('url', '')
            break
    # Allure 3's awesome UI deep-links to a single test result via the
    # top-level `id` field: index.html#/<id> (see web-awesome's router).
    test_id = data.get('id', '')
    allure_link = ''
    if test_id and public_url_base:
        base = public_url_base.rstrip('/')
        allure_link = f'{base}/index.html#/{test_id}'
    message = (data.get('statusMessage')
               or data.get('statusDetails', {}).get('message', '')
               or '(no message)')
    return {
        'name': data.get('name', ''),
        'status': status,
        'message': message,
        'workflow_link': workflow_link,
        'allure_link': allure_link,
    }


def _render_failure_row(entry: dict) -> str:
    # Pull dict accesses into locals so the f-strings below can stay
    # single-quoted Python (no nested ' inside the f-expression) and the
    # HTML attributes can stay double-quoted (no escapes either way).
    name = _link_or_text(entry['name'], entry['allure_link'])
    workflow_link = entry['workflow_link']
    workflow = f'<a href="{workflow_link}">Link</a>' if workflow_link else ''
    status = entry['status']
    message = _escape_html(entry['message'])
    return (
        f'<tr><td class="test-name">{name}</td>'
        f'<td><span class="{status}">{status}</span></td>'
        f'<td class="message">{message}</td>'
        f'<td>{workflow}</td></tr>'
    )


def _render_pass_row(entry: dict) -> str:
    name = _link_or_text(entry['name'], entry['allure_link'])
    workflow_link = entry['workflow_link']
    workflow = f'<a href="{workflow_link}">Link</a>' if workflow_link else ''
    return (
        f'<tr><td class="test-name">{name}</td>'
        f'<td>{workflow}</td></tr>'
    )


def _link_or_text(test_name: str, href: str) -> str:
    escaped = _escape_html(test_name)
    return f'<a href="{href}">{escaped}</a>' if href else escaped


def run(
    sink: 'S3Sink',
    source: str,
    env_name: str,
    env_url: str,
    run_id: str,
    actor: str,
    targets: list,
    testlogs_dir: str,
    build_url: Optional[str] = None,
    allure_bin: Optional[str] = None,
    categories_path: Optional[str] = None,
) -> str:
    """Aggregate per-test allure-results into a single Allure HTML bundle and
    upload via sink. Returns the public URL of the run's index.html.

    Every source (prod/staging/ci/users/<actor>) gets its own history.jsonl
    at <source>/history.jsonl, so the trend chart is isolated by source —
    there's no per-actor cross-contamination. Allure 3 consolidated the
    Allure-2 history/<trend>.json fileset into a single JSONL stream.
    """
    public_url_base = sink.public_url('').rstrip('/')
    history_remote_key = f'{source}/history.jsonl'
    with tempfile.TemporaryDirectory() as work:
        staging = os.path.join(work, 'allure-input')
        report = os.path.join(work, 'allure-report')
        history_path = os.path.join(work, 'history.jsonl')
        os.makedirs(staging, exist_ok=True)

        # 1. Pull per-test results from outputs (plain dir, zip, or per-attempt)
        collect_allure_results(testlogs_dir, targets, staging)

        # 2. Pull prior history from sink (best-effort — first run on a new
        # source has no prior history.jsonl, which is fine).
        try:
            sink.download_file(history_remote_key, history_path)
        except Exception as exc:  # pylint: disable=broad-except
            print(f'[oetf-reporter] history download skipped '
                  f'({history_remote_key}): '
                  f'{type(exc).__name__}: {exc}',
                  file=sys.stderr)

        # 3. Write executor.json + environment.properties + categories.json
        # build_url is Optional at the API boundary; normalize to "" before
        # crossing into the reporter (Allure's executor.json schema wants a
        # string buildUrl, never null).
        executor = reporter.build_executor(
            run_id=run_id, env_name=env_name,
            build_url=build_url or '',
            report_url_base=public_url_base,
            source=source,
            start_epoch=int(time.time()),
        )
        with open(os.path.join(staging, 'executor.json'), 'w', encoding='utf-8') as fh:
            json.dump(executor, fh)

        env_props = reporter.build_environment_properties({
            'OSMO.URL': env_url,
            'OETF.Env': env_name,
            'OETF.Source': source,
            'OETF.Actor': actor,
        })
        with open(os.path.join(staging, 'environment.properties'), 'w', encoding='utf-8') as fh:
            fh.write(env_props)

        if categories_path and os.path.exists(categories_path):
            shutil.copy2(categories_path,
                         os.path.join(staging, 'categories.json'))

        # 4. Generate the static HTML bundle. allure 3 reads/appends to
        # history_path in place, so the same path serves as input + output.
        os.makedirs(report, exist_ok=True)
        run_allure_generate(
            staging_dir=staging,
            output_dir=report,
            history_path=history_path,
            allure_bin=allure_bin,
            config_dir=work,
        )

        # 4b. Write failure summary alongside index.html (included in upload below)
        run_public_url = sink.public_url(f'{source}/runs/{run_id}').rstrip('/')
        write_failure_summary(report, run_public_url)

        # 5. Upload bundle to <source>/runs/<run_id>/
        sink.upload_dir(report, f'{source}/runs/{run_id}')

        # 6. Push history.jsonl forward — every source has its own JSONL
        # stream at <source>/history.jsonl.
        if os.path.isfile(history_path):
            sink.upload_file(history_path, history_remote_key)

    return sink.public_url(f'{source}/runs/{run_id}/index.html')
