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
OSMO Rsync Setup
=======================================================

This appendix describes how to setup rsync for OSMO.

.. note::

    Rsync is a file synchronization tool that allows you to sync files between a source and a destination.
    OSMO has integrated rsync into user workflows and the OSMO CLI to allow for seamless file synchronization
    between a user workstation and remote tasks.

Configuration Process Overview
-------------------------------

Use the configuration CLI (:doc:`../references/config_cli/config_update`) to configure the rsync plugin:

.. code-block:: bash

  $ osmo config update WORKFLOW

Navigate to ``plugins_config`` section and update the ``rsync`` configuration:

.. code-block:: json

  "plugins_config": {
    "rsync": {
      "enabled": false,
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

Adjust the ``rsync`` properties as needed:

.. warning::

   Set these values based on your network and storage performance requirements.
   Setting bandwidth limits can help prevent network saturation and ensure fair resource usage.

.. list-table:: Rsync Plugin Configuration Options
   :header-rows: 1
   :widths: 25 100 50

   * - Option
     - Description
     - Examples
   * - ``enabled``
     - Enable or disable the rsync plugin.
     - ``true`` or ``false``
   * - ``enable_telemetry``
     - Enable telemetry collection for rsync operations.
     - ``true`` or ``false``
   * - ``read_bandwidth_limit``
     - **Maximum** workflow container rsync read bandwidth in bytes per second. Default is 2.5MB/s.
     - ``2621440``
   * - ``write_bandwidth_limit``
     - **Maximum** workflow container rsync write bandwidth in bytes per second. Default is 2.5MB/s.
     - ``2621440``
   * - ``allowed_paths``
     - Dictionary of allowed source/destination paths for rsync operations. Default is empty.
       ``/osmo/run/workspace`` is always available as a remote path.
     - .. code-block:: json

          {
            "path_1": {
              "path": "/path/to/dest/1/",
              "writable": true
            },
            "path_2": {
              "path": "/path/to/dest/2/",
              "writable": true
            }
          }
   * - ``daemon_debounce_delay``
     - Client daemon's **minimum** time in seconds to wait after a file change before uploading. Default is 30 seconds.
     - ``30.0``
   * - ``daemon_poll_interval``
     - Client daemon's **minimum** interval in seconds for polling task status. Default is 120 seconds.
     - ``120.0``
   * - ``daemon_reconcile_interval``
     - Client daemon's **minimum** interval in seconds for reconciling uploads. Default is 60 seconds.
     - ``60.0``
   * - ``client_upload_rate_limit``
     - Client's **maximum** upload rate in bytes per second. Default is 2MB/s.
     - ``2097152``

.. note::

    Changes will apply for any workflow tasks that are started after the configuration update.
