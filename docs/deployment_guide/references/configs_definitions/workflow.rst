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

.. _workflow_config:

===========================
/api/configs/workflow
===========================

Workflow config is used to configure workflow execution and management.

Top-Level Configuration
========================

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``workflow_data``
     - `Workflow Data`_
     - Cloud storage configuration for workflow artifacts, such as workflow spec and Kubernetes pod spec.
     - Default configuration
   * - ``workflow_log``
     - `Workflow Log`_
     - Cloud storage configuration for workflow logs and error logs.
     - Default configuration
   * - ``workflow_app``
     - `Workflow App`_
     - Cloud storage configuration for OSMO apps.
     - Default configuration
   * - ``workflow_info``
     - `Workflow Information`_
     - Miscellaneous workflow configurations.
     - Default configuration
   * - ``backend_images``
     - `Backend Images`_
     - Container images used by the workflow (i.e. init and osmo-ctrl containers).
     - Default configuration
   * - ``workflow_alerts``
     - `Workflow Alerts`_
     - Configuration for workflow alerts.
     - Default configuration
   * - ``credential_config``
     - `Credential Configuration`_
     - Settings for credential validation.
     - Default configuration
   * - ``user_workflow_limits``
     - `User Workflow Limits`_
     - Limits and constraints for users and their workflows.
     - Default configuration
   * - ``plugins_config``
     - `Plugins`_
     - Configuration for workflow plugins.
     - See Plugins section
   * - ``labels_config``
     - `Workflow Labels`_
     - Workflow-label policies, accepted values, and staged enforcement.
     - ``policy: []``
   * - ``max_num_tasks``
     - Integer
     - Maximum number of tasks allowed in a workflow.
     - ``20``
   * - ``max_num_ports_per_task``
     - Integer
     - Maximum number of ports allowed per task to be forwarded at a time.
     - ``30``
   * - ``max_retry_per_task``
     - Integer
     - Maximum number of retries allowed per task.
     - ``0``
   * - ``max_retry_per_job``
     - Integer
     - Maximum number of retries allowed per job.
     - ``5``
   * - ``default_schedule_timeout``
     - Integer
     - Default timeout for task scheduling in seconds.
     - ``30``
   * - ``default_exec_timeout``
     - String
     - Default per-group execution timeout, applied independently to each group's RUNNING phase. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d).
     - ``60d``
   * - ``default_queue_timeout``
     - String
     - Default per-group queue timeout, measured from when each group enters ``SCHEDULING`` until it is assigned a node (enters ``INITIALIZING``). Must be in the format of <integer><unit> (for example, 10m, 1h, 1d).
     - ``60d``
   * - ``max_exec_timeout``
     - String
     - Maximum allowed per-group execution timeout. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d).
     - ``60d``
   * - ``max_queue_timeout``
     - String
     - Maximum allowed per-group queue timeout. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d).
     - ``60d``
   * - ``force_cleanup_delay``
     - String
     - Amount of time after a workflow has failed to force cleanup of resources. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d).
     - ``1h``
   * - ``max_log_lines``
     - Integer
     - Maximum number of log lines to retain for a workflow.
     - ``10000``
   * - ``max_task_log_lines``
     - Integer
     - Maximum number of log lines per task.
     - ``1000``
   * - ``max_error_log_lines``
     - Integer
     - Maximum number of error log lines to retain.
     - ``100``
   * - ``max_event_log_lines``
     - Integer
     - Maximum number of event log lines to retain.
     - ``100``
   * - ``task_heartbeat_frequency``
     - String
     - Frequency of task heartbeat signals.
     - ``10m``

Workflow Data
=============

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``credential``
     - `Credential`_
     - Credentials for accessing workflow data storage.
     - ``None``
   * - ``base_url``
     - String
     - Base URL for workflow data access, enabling users to view their intermediate output data from workflows on the browser.
     - ``None``
   * - ``websocket_timeout``
     - Integer
     - Timeout for websocket connections in seconds.
     - ``1440``
   * - ``data_timeout``
     - Integer
     - Timeout for data operations in seconds.
     - ``10``


Workflow Log
============

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``credential``
     - `Credential`_
     - Credentials for accessing workflow logs and error logs in cloud storage.
     - ``None``

Workflow App
============

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``credential``
     - `Credential`_
     - Credentials for accessing OSMO apps in cloud storage.
     - ``None``

Credential
===========

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``access_key_id``
     - String
     - Access key ID for cloud storage authentication.
     - ``None``
   * - ``access_key``
     - String
     - Access key for cloud storage authentication.
     - ``None``
   * - ``endpoint``
     - String
     - Cloud storage endpoint URI including protocol, container, and prefix (if any).
     - ``None``
   * - ``region``
     - String
     - Cloud storage region.
     - ``None``

Workflow Information
=====================

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``tags``
     - Array[String]
     - The list contains the available tags the user can mark their workflow
     - ``[]``
   * - ``max_name_length``
     - Integer
     - Maximum allowed length for workflow names.
     - ``64``

Workflow Labels
===============

Workflow labels are optional and format-checked even when no label is required.
The default configuration applies no label policies:

.. code-block:: yaml

   labels_config:
     policy: []

Each entry in ``policy`` controls one key independently. Use ``off`` or omit a
key from ``policy`` to disable both warnings and enforcement for that key:

.. code-block:: yaml

   labels_config:
     policy:
     - key: team
       allow_list:
       - robotics
       - simulation
       enforcement: warn
     - key: cost-center
       allow_list: []
       enforcement: enforce

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``key``
     - String
     - Kubernetes label key to check. Duplicate policy keys are rejected,
       and at most 16 keys can be configured.
     - Required
   * - ``allow_list``
     - List of Strings
     - Exact accepted values. An empty list accepts any well-formed value.
     - ``[]``
   * - ``enforcement``
     - String (``"off"``, ``warn``, ``enforce``)
     - ``off`` accepts without policy warnings. ``warn`` accepts but warns
       when the key is missing or its value is outside a non-empty allow-list.
       ``enforce`` rejects those violations.
     - ``"off"``

The same policy applies to new submissions, resubmission by ID, restart, and
validation-only requests. An ``enforcement: enforce`` rejection creates
neither a workflow row nor a stored specification. Submit responses carry
warnings from that admission check. Warnings are not stored with the
workflow: detail responses recompute warn-mode violations from the stored
labels and the current configuration, so displayed warnings track policy
changes even for completed workflows.

To roll back enforcement immediately, use ``enforcement: warn``. To disable both
warnings and enforcement, use ``enforcement: "off"`` (quoted: unquoted YAML
``off`` parses as boolean false) or remove the policy entry.
Existing and in-flight workflows are not modified, although their detail-page
warnings always reflect the current warn policy. In ConfigMap mode, an invalid
edit is rejected and the previous valid snapshot remains active.

Only configured policy keys become workflow-label dimensions on
``osmo_tasks_count``. Attribute names start with ``workflow_label_``. Letters
and numbers are unchanged; ``_``, ``-``, ``.``, and ``/`` are encoded as
``__``, ``_dash_``, ``_dot_``, and ``_slash_`` respectively. For example,
``project`` is exported as ``workflow_label_project``. Values in the configured
allow-list are exported verbatim; a present value outside that list is clamped
to ``<other>``, and a missing key is reported as ``<missing>``. Angle
brackets are not valid in label values, so the sentinels never collide with
real values. An empty allow-list exports every present value as ``<other>``.
This keeps the number of series bounded to the allow-list plus two sentinels
per key.

Admission also emits
``osmo_label_validation_total{key, outcome}``, where ``outcome`` is ``ok``,
``missing``, ``invalid``, or ``rejected``. The counter covers rejected
submissions that do not create a workflow row. Keep the policy list small to
control metric cardinality. Exporting a Pod label through ``kube_pod_labels`` is a
separate kube-state-metrics allow-list decision; see
:ref:`adding_observability`.

Backend Images
==============

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``init``
     - String
     - Container images for osmo-init.
     - ``None``
   * - ``client``
     - String
     - Container images for osmo-ctrl.
     - ``None``
   * - ``credential``
     - `Registry Credentials`_
     - Registry credentials for pulling container images.
     - Default configuration

Registry Credentials
====================

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``registry``
     - String
     - Container registry hostname.
     - ``None``
   * - ``username``
     - String
     - Registry username for authentication.
     - ``None``
   * - ``auth``
     - String
     - Registry authentication token or password.
     - ``None``

Workflow Alerts
===============

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``slack_token``
     - String
     - Slack API token for notifications.
     - ``None``
   * - ``smtp_settings``
     - `SMTP Settings Configuration`_
     - SMTP configuration for email notifications.
     - Default configuration

SMTP Settings Configuration
===========================

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``host``
     - String
     - SMTP server hostname.
     - ``None``
   * - ``sender``
     - String
     - Email address for sending notifications.
     - ``None``
   * - ``password``
     - String
     - SMTP server authentication password.
     - ``None``

Credential Configuration
========================

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``disable_registry_validation``
     - Array[String]
     - List of registries to skip validation for.
     - ``[]``
   * - ``disable_data_validation``
     - Array[String]
     - List of data sources to skip validation for.
     - ``[]``

User Workflow Limits
====================

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``max_num_workflows``
     - Optional[Integer]
     - Maximum number of workflows per user. If not set, there is no limit.
     - ``None``
   * - ``max_num_tasks``
     - Optional[Integer]
     - Maximum number of tasks per user. If not set, there is no limit.
     - ``None``
   * - ``jinja_sandbox_workers``
     - Integer
     - Number of worker processes for Jinja template sandbox.
     - ``2``
   * - ``jinja_sandbox_max_time``
     - Float
     - Maximum execution time for Jinja template rendering in seconds.
     - ``0.5``
   * - ``jinja_sandbox_memory_limit``
     - Integer
     - Memory limit for Jinja template rendering in bytes.
     - ``104857600``

.. note::

  The Jinja template sandbox is used to safely render Jinja templates in a sandboxed worker subprocess.
  It is used to prevent the execution of unsafe usage in the Jinja template, such as unrolling an infinite loop.

Plugins
=======

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``rsync``
     - `Rsync Plugin`_
     - Configuration for the rsync plugin.
     - See Rsync Plugin section

.. _rsync_plugin:

Rsync Plugin
============

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``enabled``
     - Boolean
     - Whether the rsync plugin is enabled.
     - ``False``
   * - ``enable_telemetry``
     - Boolean
     - Whether to enable telemetry for rsync operations.
     - ``False``
   * - ``read_bandwidth_limit``
     - Integer
     - Read bandwidth limit in bytes per second.
     - ``2621440``
   * - ``write_bandwidth_limit``
     - Integer
     - Write bandwidth limit in bytes per second.
     - ``2621440``
   * - ``allowed_paths``
     - `Rsync Allowed Paths`_
     - Configuration for allowed file system paths.
     - ``{}``
   * - ``daemon_debounce_delay``
     - Float
     - Delay in seconds before processing file changes.
     - ``30.0``
   * - ``daemon_poll_interval``
     - Float
     - Interval in seconds for polling file changes.
     - ``120.0``
   * - ``daemon_reconcile_interval``
     - Float
     - Interval in seconds for reconciling file states.
     - ``60.0``
   * - ``client_upload_rate_limit``
     - Integer
     - Upload rate limit for clients in bytes per second.
     - ``2097152``

Rsync Allowed Paths
===================

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``path``
     - String
     - File system path that is allowed for rsync operations.
     - Required field
   * - ``writable``
     - Boolean
     - Whether the path is writable for rsync operations.
     - Required field
