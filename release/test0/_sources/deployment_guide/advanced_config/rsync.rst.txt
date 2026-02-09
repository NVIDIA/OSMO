..
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


.. _rsync_setup:

=======================================================
Rsync Configuration
=======================================================

Enable rsync integration to sync files between user workstations and running workflow tasks. This configuration is optional but enables live code editing and real-time collaboration during development on a remote machine.


Why Use Rsync?
==============

Rsync integration provides seamless file synchronization during workflow execution:

✓ **Live Development**
  Edit code locally and sync changes to running tasks in real-time without restarting workflows.

✓ **Bandwidth Control**
  Prevent network saturation with configurable rate limits for uploads and downloads.

✓ **Flexible Sync Paths**
  Define custom mount points beyond the default ``/osmo/run/workspace`` for specialized workflows.


How It Works
============

Sync Flow
---------

.. grid:: 3
    :gutter: 2

    .. grid-item-card::
        :class-header: sd-bg-info sd-text-white

        **1. Local Edit** ✏️
        ^^^

        Modify files

        +++

        Change code locally

    .. grid-item-card::
        :class-header: sd-bg-primary sd-text-white

        **2. Daemon Detects** 👁️
        ^^^

        Monitor changes

        +++

        Wait for debounce delay

    .. grid-item-card::
        :class-header: sd-bg-success sd-text-white

        **3. Auto Sync** 🔄
        ^^^

        Transfer files

        +++

        Push to running task

Key Settings
------------

- **Bandwidth Limits**: Control upload/download rates to prevent network congestion
- **Debounce Delay**: Wait period after file changes before syncing (batches rapid edits)
- **Poll Interval**: How often to check task status
- **Allowed Paths**: Additional directories accessible for sync operations

.. note::

   For detailed configuration fields and defaults, see :ref:`rsync_plugin`.


Practical Guide
===============

Enabling Rsync
--------------

**Step 1: Update Workflow Configuration**

Enable the rsync plugin in your OSMO configuration:

.. code-block:: bash

  $ osmo config update WORKFLOW

Edit the ``plugins_config.rsync`` section:

.. code-block:: json

  {
    "plugins_config": {
      "rsync": {
        "enabled": true,
        "enable_telemetry": false,
        "read_bandwidth_limit": 2621440,
        "write_bandwidth_limit": 2621440,
        "allowed_paths": {},
        "daemon_debounce_delay": 30,
        "daemon_poll_interval": 120,
        "daemon_reconcile_interval": 60,
        "client_upload_rate_limit": 2097152
      }
    }
  }

**Step 2: Configure Settings**

.. dropdown:: **Bandwidth Configuration**
    :color: info
    :icon: meter

    Control network usage with rate limits (bytes per second):

    .. code-block:: json

      {
        "read_bandwidth_limit": 5242880,
        "write_bandwidth_limit": 5242880,
        "client_upload_rate_limit": 4194304
      }

    **Limits:**

    - ``read_bandwidth_limit``: 5 MB/s container read (5242880 bytes/sec)
    - ``write_bandwidth_limit``: 5 MB/s container write (5242880 bytes/sec)
    - ``client_upload_rate_limit``: 4 MB/s client upload (4194304 bytes/sec)

    **Recommended Values:**

    - Low-bandwidth: 1 MB/s (1048576)
    - Medium-bandwidth: 5 MB/s (5242880)
    - High-bandwidth: 10 MB/s (10485760)

.. dropdown:: **Timing Configuration**
    :color: info
    :icon: clock

    Adjust sync timing for your workflow patterns:

    .. code-block:: json

      {
        "daemon_debounce_delay": 10,
        "daemon_poll_interval": 60,
        "daemon_reconcile_interval": 30
      }

    **Timing Values:**

    - ``daemon_debounce_delay``: 10 seconds (faster sync)
    - ``daemon_poll_interval``: 60 seconds (check status every minute)
    - ``daemon_reconcile_interval``: 30 seconds (reconcile uploads)

    **Guidelines:**

    - **Debounce Delay**: Lower for rapid iteration (10s), higher for stability (60s)
    - **Poll Interval**: Balance between responsiveness and API load
    - **Reconcile Interval**: How often to verify sync consistency

.. dropdown:: **Remote Path Configuration**
    :color: info
    :icon: file-directory

    Add additional sync destinations beyond ``/osmo/run/workspace``:

    .. code-block:: json
      :emphasize-lines: 4,7

      {
        "allowed_paths": {
          "dataset": {
            "path": "/mnt/shared/datasets/",
            "writable": true
          },
          "models": {
            "path": "/mnt/models/",
            "writable": false
          }
        }
      }

    Users can then sync to new remote paths

    .. code-block:: bash

      $ osmo workflow rsync wf-id ~/my/path:/mnt/shared/datasets/
      $ osmo workflow rsync wf-id ~/my/path:/mnt/models/

Troubleshooting
---------------

**Rsync Not Working**
- Verify ``enabled: true`` in configuration
- Check workflow was started AFTER configuration update
- Confirm rsync daemon is running: ``osmo rsync status``

**Slow Sync Performance**
- Increase bandwidth limits if network capacity allows
- Reduce debounce delay for faster detection
- Check for network congestion or firewall rules

**File Conflicts**
- Review reconcile interval (lower = more frequent consistency checks)
- Ensure only one user is syncing to each task
- Check file permissions on remote paths

**Path Not Accessible**
- Verify path exists in ``allowed_paths`` configuration
- Confirm path has correct permissions (``writable: true/false``)
- Remember ``/osmo/run/workspace`` is always available

.. tip::

   **Best Practices**

   - Start with default settings and adjust based on usage patterns
   - Set bandwidth limits appropriate to your network capacity
   - Use higher debounce delays (30-60s) for production to reduce API calls
   - Enable telemetry initially to monitor sync behavior
   - Test rsync with small files before large datasets
   - Document custom paths in team onboarding materials

.. warning::

   Rsync changes apply only to workflows started after the configuration update. Restart running workflows to pick up new settings.

.. seealso::

  - Learn more about Rsync in OSMO at :ref:`Interactive Workflows <workflow_interactive_rsync>`
