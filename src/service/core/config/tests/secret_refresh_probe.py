"""Isolated probe of packaged loader code, driven by the Kubernetes integration test.

SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

import dataclasses
import hashlib
import json
import os
from pathlib import Path
import threading
import time

from src.service.core.config import configmap_loader
from src.utils import auth, configmap_state, connectors
from src.utils.job import task


def main():
    config_path = Path('/probe/config.yaml')
    watcher = configmap_loader.ConfigMapWatcher(str(config_path))
    # An isolated signing identity: no live database, service auth, or storage access.
    watcher._stable_service_auth = auth.AuthenticationConfig.generate_default()
    if os.environ.get('DISABLE_DEPENDENCY_POLLING') == '1':
        # Negative control is confined to this disposable probe process.
        watcher._check_dependencies = lambda: None
    if configmap_loader._DEPENDENCY_CHECK_INTERVAL_S != 30:
        raise RuntimeError('Probe requires the production 30-second interval')
    watcher.start()
    deadline = time.monotonic() + 900
    try:
        while time.monotonic() < deadline:
            snapshot = configmap_state.get_snapshot()
            workflow = connectors.WorkflowConfig(**snapshot['workflow'])
            resolved = []
            for name in ('workflow_data', 'workflow_log', 'workflow_app'):
                credential = getattr(workflow, name).credential
                serialized = task.create_config_dict({'s3://test-bucket': credential})
                fields = serialized['auth']['data']['s3://test-bucket']
                matches = [revision for revision in ('A', 'B', 'C')
                           if fields['access_key_id'] == f'fake-id-{revision}'
                           and fields['access_key'] == f'fake-key-{revision}']
                resolved.append(matches[0] if matches else 'invalid')
            projected_path = Path('/etc/osmo/secrets/probe-storage/cred.yaml')
            try:
                projected = json.loads(projected_path.read_text())
                projected_revision = next((revision for revision in ('A', 'B', 'C')
                                           if projected.get('access_key_id') ==
                                           f'fake-id-{revision}'), 'invalid')
            except (ValueError, OSError):
                projected_revision = 'invalid'
            status = {
                'resolved': resolved,
                'startup_setting': snapshot['service']['max_pod_restart_limit'],
                'projected': projected_revision,
                'refresh': dataclasses.asdict(watcher.refresh_status),
                'config_hash': hashlib.sha256(config_path.read_bytes()).hexdigest(),
                'loader_hash': hashlib.sha256(
                    Path(configmap_loader.__file__).read_bytes()).hexdigest(),
                'pid': os.getpid(),
            }
            temporary = Path('/tmp/status-next.json')
            temporary.write_text(json.dumps(status))
            temporary.replace('/tmp/status.json')
            threading.Event().wait(1)
    finally:
        watcher.stop()


if __name__ == '__main__':
    main()
