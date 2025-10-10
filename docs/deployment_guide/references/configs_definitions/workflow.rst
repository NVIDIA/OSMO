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
Workflow Config
===========================

Workflow config is used to configure workflow execution and management.

Top-Level Configuration
========================

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``workflow_data``
     - `Workflow Data`_
     - Cloud storage configuration for workflow artifacts, such as workflow spec and Kubernetes pod spec.
   * - ``workflow_log``
     - `Workflow Log`_
     - Cloud storage configuration for workflow logs and error logs.
   * - ``workflow_app``
     - `Workflow App`_
     - Cloud storage configuration for OSMO apps.
   * - ``workflow_info``
     - `Workflow Information`_
     - Miscellaneous workflow configurations.
   * - ``backend_images``
     - `Backend Images`_
     - Container images used by the workflow (i.e. init and osmo-ctrl containers).
   * - ``workflow_alerts``
     - `Workflow Alerts`_
     - Configuration for workflow alerts.
   * - ``credential_config``
     - `Credential Configuration`_
     - Settings for credential validation.
   * - ``user_workflow_limits``
     - `User Workflow Limits`_
     - Limits and constraints for users and their workflows.
   * - ``plugins_config``
     - `Plugins`_
     - Configuration for workflow plugins.
   * - ``max_num_tasks``
     - Integer
     - Maximum number of tasks allowed in a workflow. Default is 20.
   * - ``max_num_ports_per_task``
     - Integer
     - Maximum number of ports allowed per task to be forwarded at a time. Default is 30.
   * - ``max_retry_per_task``
     - Integer
     - Maximum number of retries allowed per task. Default is 0.
   * - ``max_retry_per_job``
     - Integer
     - Maximum number of retries allowed per job. Default is 5.
   * - ``default_schedule_timeout``
     - Integer
     - Default timeout for task scheduling in seconds. Default is 30.
   * - ``default_exec_timeout``
     - String
     - Default timeout for task execution. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d). Default is 60d.
   * - ``default_queue_timeout``
     - String
     - Default timeout for tasks in queue. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d). Default is 60d.
   * - ``max_exec_timeout``
     - String
     - Maximum allowed execution timeout. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d). Default is 60d.
   * - ``max_queue_timeout``
     - String
     - Maximum allowed queue timeout. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d). Default is 60d.
   * - ``force_cleanup_delay``
     - String
     - Amount of time after a workflow has failed to force cleanup of resources. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d). Default is 1h.
   * - ``max_log_lines``
     - Integer
     - Maximum number of log lines to retain for a workflow. Default is 10000.
   * - ``max_task_log_lines``
     - Integer
     - Maximum number of log lines per task. Default is 1000.
   * - ``max_error_log_lines``
     - Integer
     - Maximum number of error log lines to retain. Default is 100.
   * - ``max_event_log_lines``
     - Integer
     - Maximum number of event log lines to retain. Default is 100.
   * - ``task_heartbeat_frequency``
     - String
     - Frequency of task heartbeat signals. Default is 10m.

Workflow Data
=============

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``credential``
     - `Credential`_
     - Credentials for accessing workflow data storage.
   * - ``base_url``
     - String
     - Base URL for workflow data access, enabling users to view their intermediate output data from workflows on the browser.
   * - ``websocket_timeout``
     - Integer
     - Timeout for websocket connections in seconds.
   * - ``data_timeout``
     - Integer
     - Timeout for data operations in seconds.


Workflow Log
============

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``credential``
     - `Credential`_
     - Credentials for accessing workflow logs and error logs in cloud storage.

Workflow App
============

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``credential``
     - `Credential`_
     - Credentials for accessing OSMO apps in cloud storage.

Credential
===========

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``access_key_id``
     - String
     - Access key ID for cloud storage authentication.
   * - ``access_key``
     - String
     - Access key for cloud storage authentication.
   * - ``endpoint``
     - String
     - Cloud storage endpoint URI including protocol, container, and prefix (if any).
   * - ``region``
     - String
     - Cloud storage region.

Workflow Information
=====================

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``tags``
     - Array[String]
     - The list contains the available tags the user can mark their workflow
   * - ``max_name_length``
     - Integer
     - Maximum allowed length for workflow names.

Backend Images
==============

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``init``
     - `Container Image Architecture`_
     - Container images for osmo-init.
   * - ``client``
     - `Container Image Architecture`_
     - Container images for osmo-ctrl.
   * - ``credential``
     - `Registry Credentials`_
     - Registry credentials for pulling container images.

Container Image Architecture
============================

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``amd64``
     - String
     - Container image for AMD64 architecture.
   * - ``arm64``
     - String
     - Container image for ARM64 architecture.

Registry Credentials
====================

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``registry``
     - String
     - Container registry hostname.
   * - ``username``
     - String
     - Registry username for authentication.
   * - ``auth``
     - String
     - Registry authentication token or password.

Workflow Alerts
===============

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``slack_token``
     - String
     - Slack API token for notifications.
   * - ``smtp_settings``
     - `SMTP Settings Configuration`_
     - SMTP configuration for email notifications.

SMTP Settings Configuration
===========================

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``host``
     - String
     - SMTP server hostname.
   * - ``sender``
     - String
     - Email address for sending notifications.
   * - ``password``
     - String
     - SMTP server authentication password.

Credential Configuration
========================

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``disable_registry_validation``
     - Array[String]
     - List of registries to skip validation for.
   * - ``disable_data_validation``
     - Array[String]
     - List of data sources to skip validation for.

User Workflow Limits
====================

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``max_num_workflows``
     - Optional[Integer]
     - Maximum number of workflows per user. If not set, there is no limit.
   * - ``max_num_tasks``
     - Optional[Integer]
     - Maximum number of tasks per user. If not set, there is no limit.
   * - ``jinja_sandbox_workers``
     - Integer
     - Number of worker processes for Jinja template sandbox.
   * - ``jinja_sandbox_max_time``
     - Float
     - Maximum execution time for Jinja template rendering in seconds.
   * - ``jinja_sandbox_memory_limit``
     - Integer
     - Memory limit for Jinja template rendering in bytes.

.. note::

  The Jinja template sandbox is used to safely render Jinja templates in a sandboxed worker subprocess.
  It is used to prevent the execution of unsafe usage in the Jinja template, such as unrolling an infinite loop.

Plugins
=======

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``rsync``
     - `Rsync Plugin`_
     - Configuration for the rsync plugin.

Rsync Plugin
============

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``enabled``
     - Boolean
     - Whether the rsync plugin is enabled.
   * - ``enable_telemetry``
     - Boolean
     - Whether to enable telemetry for rsync operations.
   * - ``read_bandwidth_limit``
     - Integer
     - Read bandwidth limit in bytes per second.
   * - ``write_bandwidth_limit``
     - Integer
     - Write bandwidth limit in bytes per second.
   * - ``allowed_paths``
     - `Rsync Allowed Paths`_
     - Configuration for allowed file system paths.
   * - ``daemon_debounce_delay``
     - Float
     - Delay in seconds before processing file changes.
   * - ``daemon_poll_interval``
     - Float
     - Interval in seconds for polling file changes.
   * - ``daemon_reconcile_interval``
     - Float
     - Interval in seconds for reconciling file states.
   * - ``client_upload_rate_limit``
     - Integer
     - Upload rate limit for clients in bytes per second.

Rsync Allowed Paths
===================

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``path``
     - String
     - File system path that is allowed for rsync operations.
   * - ``writable``
     - Boolean
     - Whether the path is writable for rsync operations.
