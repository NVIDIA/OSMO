<!-- SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0 -->

<a id="workflow-config"></a>

# /api/configs/workflow

Workflow config is used to configure workflow execution and management.

## Top-Level Configuration

| **Field**                  | **Type**                     | **Description**                                                                                                                                | **Default Values**    |
|----------------------------|------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------|
| `workflow_data`            | [Workflow Data]()            | Cloud storage configuration for workflow artifacts, such as workflow spec and Kubernetes pod spec.                                             | Default configuration |
| `workflow_log`             | [Workflow Log]()             | Cloud storage configuration for workflow logs and error logs.                                                                                  | Default configuration |
| `workflow_app`             | [Workflow App]()             | Cloud storage configuration for OSMO apps.                                                                                                     | Default configuration |
| `workflow_info`            | [Workflow Information]()     | Miscellaneous workflow configurations.                                                                                                         | Default configuration |
| `backend_images`           | [Backend Images]()           | Container images used by the workflow (i.e. init and osmo-ctrl containers).                                                                    | Default configuration |
| `workflow_alerts`          | [Workflow Alerts]()          | Configuration for workflow alerts.                                                                                                             | Default configuration |
| `credential_config`        | [Credential Configuration]() | Settings for credential validation.                                                                                                            | Default configuration |
| `user_workflow_limits`     | [User Workflow Limits]()     | Limits and constraints for users and their workflows.                                                                                          | Default configuration |
| `plugins_config`           | [Plugins]()                  | Configuration for workflow plugins.                                                                                                            | See Plugins section   |
| `max_num_tasks`            | Integer                      | Maximum number of tasks allowed in a workflow.                                                                                                 | `20`                  |
| `max_num_ports_per_task`   | Integer                      | Maximum number of ports allowed per task to be forwarded at a time.                                                                            | `30`                  |
| `max_retry_per_task`       | Integer                      | Maximum number of retries allowed per task.                                                                                                    | `0`                   |
| `max_retry_per_job`        | Integer                      | Maximum number of retries allowed per job.                                                                                                     | `5`                   |
| `default_schedule_timeout` | Integer                      | Default timeout for task scheduling in seconds.                                                                                                | `30`                  |
| `default_exec_timeout`     | String                       | Default timeout for task execution. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d).                                       | `60d`                 |
| `default_queue_timeout`    | String                       | Default timeout for tasks in queue. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d).                                       | `60d`                 |
| `max_exec_timeout`         | String                       | Maximum allowed execution timeout. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d).                                        | `60d`                 |
| `max_queue_timeout`        | String                       | Maximum allowed queue timeout. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d).                                            | `60d`                 |
| `force_cleanup_delay`      | String                       | Amount of time after a workflow has failed to force cleanup of resources. Must be in the format of <integer><unit> (for example, 10m, 1h, 1d). | `1h`                  |
| `max_log_lines`            | Integer                      | Maximum number of log lines to retain for a workflow.                                                                                          | `10000`               |
| `max_task_log_lines`       | Integer                      | Maximum number of log lines per task.                                                                                                          | `1000`                |
| `max_error_log_lines`      | Integer                      | Maximum number of error log lines to retain.                                                                                                   | `100`                 |
| `max_event_log_lines`      | Integer                      | Maximum number of event log lines to retain.                                                                                                   | `100`                 |
| `task_heartbeat_frequency` | String                       | Frequency of task heartbeat signals.                                                                                                           | `10m`                 |

## Workflow Data

| **Field**           | **Type**       | **Description**                                                                                                         | **Default Values**   |
|---------------------|----------------|-------------------------------------------------------------------------------------------------------------------------|----------------------|
| `credential`        | [Credential]() | Credentials for accessing workflow data storage.                                                                        | `None`               |
| `base_url`          | String         | Base URL for workflow data access, enabling users to view their intermediate output data from workflows on the browser. | `None`               |
| `websocket_timeout` | Integer        | Timeout for websocket connections in seconds.                                                                           | `1440`               |
| `data_timeout`      | Integer        | Timeout for data operations in seconds.                                                                                 | `10`                 |

## Workflow Log

| **Field**    | **Type**       | **Description**                                                          | **Default Values**   |
|--------------|----------------|--------------------------------------------------------------------------|----------------------|
| `credential` | [Credential]() | Credentials for accessing workflow logs and error logs in cloud storage. | `None`               |

## Workflow App

| **Field**    | **Type**       | **Description**                                       | **Default Values**   |
|--------------|----------------|-------------------------------------------------------|----------------------|
| `credential` | [Credential]() | Credentials for accessing OSMO apps in cloud storage. | `None`               |

## Credential

| **Field**       | **Type**   | **Description**                                                                | **Default Values**   |
|-----------------|------------|--------------------------------------------------------------------------------|----------------------|
| `access_key_id` | String     | Access key ID for cloud storage authentication.                                | `None`               |
| `access_key`    | String     | Access key for cloud storage authentication.                                   | `None`               |
| `endpoint`      | String     | Cloud storage endpoint URI including protocol, container, and prefix (if any). | `None`               |
| `region`        | String     | Cloud storage region.                                                          | `None`               |

## Workflow Information

| **Field**         | **Type**      | **Description**                                                       | **Default Values**   |
|-------------------|---------------|-----------------------------------------------------------------------|----------------------|
| `tags`            | Array[String] | The list contains the available tags the user can mark their workflow | `[]`                 |
| `max_name_length` | Integer       | Maximum allowed length for workflow names.                            | `64`                 |

## Backend Images

| **Field**    | **Type**                 | **Description**                                    | **Default Values**    |
|--------------|--------------------------|----------------------------------------------------|-----------------------|
| `init`       | String                   | Container images for osmo-init.                    | `None`                |
| `client`     | String                   | Container images for osmo-ctrl.                    | `None`                |
| `credential` | [Registry Credentials]() | Registry credentials for pulling container images. | Default configuration |

## Registry Credentials

| **Field**   | **Type**   | **Description**                            | **Default Values**   |
|-------------|------------|--------------------------------------------|----------------------|
| `registry`  | String     | Container registry hostname.               | `None`               |
| `username`  | String     | Registry username for authentication.      | `None`               |
| `auth`      | String     | Registry authentication token or password. | `None`               |

## Workflow Alerts

| **Field**       | **Type**                        | **Description**                             | **Default Values**    |
|-----------------|---------------------------------|---------------------------------------------|-----------------------|
| `slack_token`   | String                          | Slack API token for notifications.          | `None`                |
| `smtp_settings` | [SMTP Settings Configuration]() | SMTP configuration for email notifications. | Default configuration |

## SMTP Settings Configuration

| **Field**   | **Type**   | **Description**                          | **Default Values**   |
|-------------|------------|------------------------------------------|----------------------|
| `host`      | String     | SMTP server hostname.                    | `None`               |
| `sender`    | String     | Email address for sending notifications. | `None`               |
| `password`  | String     | SMTP server authentication password.     | `None`               |

## Credential Configuration

| **Field**                     | **Type**      | **Description**                              | **Default Values**   |
|-------------------------------|---------------|----------------------------------------------|----------------------|
| `disable_registry_validation` | Array[String] | List of registries to skip validation for.   | `[]`                 |
| `disable_data_validation`     | Array[String] | List of data sources to skip validation for. | `[]`                 |

## User Workflow Limits

| **Field**                    | **Type**          | **Description**                                                      | **Default Values**   |
|------------------------------|-------------------|----------------------------------------------------------------------|----------------------|
| `max_num_workflows`          | Optional[Integer] | Maximum number of workflows per user. If not set, there is no limit. | `None`               |
| `max_num_tasks`              | Optional[Integer] | Maximum number of tasks per user. If not set, there is no limit.     | `None`               |
| `jinja_sandbox_workers`      | Integer           | Number of worker processes for Jinja template sandbox.               | `2`                  |
| `jinja_sandbox_max_time`     | Float             | Maximum execution time for Jinja template rendering in seconds.      | `0.5`                |
| `jinja_sandbox_memory_limit` | Integer           | Memory limit for Jinja template rendering in bytes.                  | `104857600`          |

> **Note**
>
> The Jinja template sandbox is used to safely render Jinja templates in a sandboxed worker subprocess.
> It is used to prevent the execution of unsafe usage in the Jinja template, such as unrolling an infinite loop.

## Plugins

| **Field**   | **Type**         | **Description**                     | **Default Values**       |
|-------------|------------------|-------------------------------------|--------------------------|
| `rsync`     | [Rsync Plugin]() | Configuration for the rsync plugin. | See Rsync Plugin section |

<a id="rsync-plugin"></a>

## Rsync Plugin

| **Field**                   | **Type**                | **Description**                                    | **Default Values**   |
|-----------------------------|-------------------------|----------------------------------------------------|----------------------|
| `enabled`                   | Boolean                 | Whether the rsync plugin is enabled.               | `False`              |
| `enable_telemetry`          | Boolean                 | Whether to enable telemetry for rsync operations.  | `False`              |
| `read_bandwidth_limit`      | Integer                 | Read bandwidth limit in bytes per second.          | `2621440`            |
| `write_bandwidth_limit`     | Integer                 | Write bandwidth limit in bytes per second.         | `2621440`            |
| `allowed_paths`             | [Rsync Allowed Paths]() | Configuration for allowed file system paths.       | `{}`                 |
| `daemon_debounce_delay`     | Float                   | Delay in seconds before processing file changes.   | `30.0`               |
| `daemon_poll_interval`      | Float                   | Interval in seconds for polling file changes.      | `120.0`              |
| `daemon_reconcile_interval` | Float                   | Interval in seconds for reconciling file states.   | `60.0`               |
| `client_upload_rate_limit`  | Integer                 | Upload rate limit for clients in bytes per second. | `2097152`            |

## Rsync Allowed Paths

| **Field**   | **Type**   | **Description**                                        | **Default Values**   |
|-------------|------------|--------------------------------------------------------|----------------------|
| `path`      | String     | File system path that is allowed for rsync operations. | Required field       |
| `writable`  | Boolean    | Whether the path is writable for rsync operations.     | Required field       |
