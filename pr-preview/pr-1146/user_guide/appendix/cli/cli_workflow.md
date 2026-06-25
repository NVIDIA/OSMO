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

<a id="cli-reference-workflow"></a>

# osmo workflow

<!-- CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst -->
<!-- cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=workflow | ref-prefix=cli_reference_workflow | flags=argument-anchor,markdown -->
```text
usage: osmo workflow [-h]
                     {submit,restart,validate,logs,cancel,query,list,tag,exec,spec,port-forward,rsync}
                     ...
```

<a id="cli-reference-workflow-positional-arguments"></a>

## Positional Arguments

`command`
: Possible choices: submit, restart, validate, logs, cancel, query, list, tag, exec, spec, port-forward, rsync

## Sub-commands

<a id="cli-reference-workflow-submit"></a>

### submit

Submit a workflow to the workflow service.

```text
osmo workflow submit [-h] [--format-type {json,text}]
                     [--set SET [SET ...]]
                     [--set-string SET_STRING [SET_STRING ...]]
                     [--set-env SET_ENV [SET_ENV ...]]
                     [--dry-run] [--pool POOL] [--rsync RSYNC]
                     [--priority {HIGH,NORMAL,LOW}]
                     workflow_file
```

<a id="cli-reference-workflow-submit-positional-arguments"></a>

#### Positional Arguments

`workflow_file`
: The workflow file to submit, or the spec of a workflow ID to submit. If using a workflow ID, –dry-run and –set are not supported.

<a id="cli-reference-workflow-submit-named-arguments"></a>

#### Named Arguments

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

`--set`
: Assign fields in the workflow file with desired elements in the form “<field>=<value>”. These values will override values set in the “default-values” section. Overridden fields in the yaml file should be in the form {{ field }}. Values will be cast as int or float if applicable
  <br/>
  Default: `[]`

`--set-string`
: Assign fields in the workflow file with desired elements in the form “<field>=<value>”. These values will override values set in the “default-values” section. Overridden fields in the yaml file should be in the form {{ field }}. All values will be cast as string
  <br/>
  Default: `[]`

`--set-env`
: Assign environment variables to the workflow. The value should be in the format <key>=<value>. Multiple key-value pairs can be passed. If an environment variable passed here is already defined in the workflow, the value declared here will override the value in the workflow.
  <br/>
  Default: `[]`

`--dry-run`
: Does not submit the workflow and prints the workflow into the console.
  <br/>
  Default: `False`

`--pool, -p`
: The target pool to run the workflow with. If no pool is specified, the default pool assigned in the profile will be used.

`--rsync`
: Start a background rsync daemon to continuously upload data from local machine to the lead task of the workflow. The value should be in the format <local_path>:<remote_path>. The daemon process will automatically exit when the workflow is terminated.

`--priority`
: Possible choices: HIGH, NORMAL, LOW
  <br/>
  The priority to use when scheduling the workflow. If none is provided, NORMAL will be used. The scheduler will prioritize scheduling workflows in the order of HIGH, NORMAL, LOW. LOW workflows may be preempted to allow a higher priority workflow to run.

<a id="cli-reference-workflow-restart"></a>

### restart

Restart a failed workflow.

```text
osmo workflow restart [-h] [--format-type {json,text}]
                      [--pool POOL]
                      workflow_id
```

<a id="cli-reference-workflow-restart-positional-arguments"></a>

#### Positional Arguments

`workflow_id`
: The workflow ID or UUID to restart.

<a id="cli-reference-workflow-restart-named-arguments"></a>

#### Named Arguments

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

`--pool, -p`
: The target pool to run the workflow with.

<a id="cli-reference-workflow-validate"></a>

### validate

validate a workflow to the workflow server.

```text
osmo workflow validate [-h] [--set SET [SET ...]]
                       [--set-string SET_STRING [SET_STRING ...]]
                       [--pool POOL]
                       workflow_file
```

<a id="cli-reference-workflow-validate-positional-arguments"></a>

#### Positional Arguments

`workflow_file`
: The workflow file to submit.

<a id="cli-reference-workflow-validate-named-arguments"></a>

#### Named Arguments

`--set`
: Assign fields in the workflow file with desired elements in the form “<field>=<value>”. These values will override values set in the “default-values” section. Overridden fields in the yaml file should be in the form {{ field }}. Values will be cast as int or float if applicable
  <br/>
  Default: `[]`

`--set-string`
: Assign fields in the workflow file with desired elements in the form “<field>=<value>”. These values will override values set in the “default-values” section. Overridden fields in the yaml file should be in the form {{ field }}. All values will be cast as string
  <br/>
  Default: `[]`

`--pool, -p`
: The target pool to run the workflow with. If no pool is specified, the default pool assigned in the profile will be used.

<a id="cli-reference-workflow-logs"></a>

### logs

Get the logs from a workflow.

```text
osmo workflow logs [-h] [--task TASK] [--retry-id RETRY_ID]
                   [--error] [-n LAST_N_LINES]
                   workflow_id
```

<a id="cli-reference-workflow-logs-positional-arguments"></a>

#### Positional Arguments

`workflow_id`
: The workflow ID or UUID for which to fetch the logs.

<a id="cli-reference-workflow-logs-named-arguments"></a>

#### Named Arguments

`--task, -t`
: The task name for which to fetch the logs.

`--retry-id, -r`
: The retry ID for the task which to fetch the logs. If not provided, the latest retry ID will be used.

`--error`
: Show task error logs instead of regular logs
  <br/>
  Default: `False`

`-n`
: Show last n lines of logs

<a id="cli-reference-workflow-cancel"></a>

### cancel

Cancel a queued or running workflow.

```text
osmo workflow cancel [-h] [--message MESSAGE] [--force]
                     [--format-type {json,text}]
                     workflow_ids [workflow_ids ...]
```

<a id="cli-reference-workflow-cancel-positional-arguments"></a>

#### Positional Arguments

`workflow_ids`
: The workflow IDs or UUIDs to cancel. Multiple IDs or UUIDs can be passed.

<a id="cli-reference-workflow-cancel-named-arguments"></a>

#### Named Arguments

`--message, -m`
: Additional message describing reason for cancelation.

`--force, -f`
: Force cancel task group pods in the cluster.
  <br/>
  Default: `False`

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

<a id="cli-reference-workflow-query"></a>

### query

Query the status of a running workflow.

```text
osmo workflow query [-h] [--verbose] [--format-type {json,text}]
                    workflow_id
```

<a id="cli-reference-workflow-query-positional-arguments"></a>

#### Positional Arguments

`workflow_id`
: The workflow ID or UUID to query the status of.

<a id="cli-reference-workflow-query-named-arguments"></a>

#### Named Arguments

`--verbose, -v`
: Whether to show all retried tasks.
  <br/>
  Default: `False`

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

<a id="cli-reference-workflow-list"></a>

### list

List workflows with different filters. Without the –pool flag, workflows from all pools will be listed.

```text
osmo workflow list [-h] [--count COUNT] [--name NAME]
                   [--order {asc,desc}]
                   [--status STATUS [STATUS ...]]
                   [--format-type {json,text}]
                   [--submitted-after SUBMITTED_AFTER]
                   [--submitted-before SUBMITTED_BEFORE]
                   [--tags TAGS [TAGS ...]]
                   [--priority {HIGH,NORMAL,LOW} [{HIGH,NORMAL,LOW} ...]]
                   [--user USER [USER ...] | --all-users]
                   [--pool POOL [POOL ...]] [--app APP]
```

<a id="cli-reference-workflow-list-named-arguments"></a>

#### Named Arguments

`--count, -c`
: Display the given count of workflows. Default value is 20.
  <br/>
  Default: `20`

`--name, -n`
: Display workflows which contains the string.

`--order, -o`
: Possible choices: asc, desc
  <br/>
  Display in the order in which workflows were submitted. asc means latest at the bottom. desc means latest at the top. Default is asc.
  <br/>
  Default: `'asc'`

`--status, -s`
: Possible choices: RUNNING, FAILED, COMPLETED, PENDING, WAITING, FAILED_EXEC_TIMEOUT, FAILED_SERVER_ERROR, FAILED_QUEUE_TIMEOUT, FAILED_SUBMISSION, FAILED_CANCELED, FAILED_BACKEND_ERROR, FAILED_IMAGE_PULL, FAILED_EVICTED, FAILED_START_ERROR, FAILED_START_TIMEOUT, FAILED_PREEMPTED
  <br/>
  Display all workflows with the given status(es). Users can pass multiple values to this flag. Acceptable values: RUNNING, FAILED, COMPLETED, PENDING, WAITING, FAILED_EXEC_TIMEOUT, FAILED_SERVER_ERROR, FAILED_QUEUE_TIMEOUT, FAILED_SUBMISSION, FAILED_CANCELED, FAILED_BACKEND_ERROR, FAILED_IMAGE_PULL, FAILED_EVICTED, FAILED_START_ERROR, FAILED_START_TIMEOUT, FAILED_PREEMPTED

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

`--submitted-after`
: Filter for workflows that were submitted after AND including this date. Must be in format YYYY-MM-DD.
  Example: –submitted-after 2023-05-03

`--submitted-before`
: Filter for workflows that were submitted before (NOT including) this date. Must be in format YYYY-MM-DD.
  Example: –submitted-after 2023-05-02 –submitted-before 2023-05-04 includes all workflows that were submitted any time on May 2nd and May 3rd only.

`--tags`
: Filter for workflows that contain the tag(s).

`--priority`
: Possible choices: HIGH, NORMAL, LOW
  <br/>
  Filter workflows by priority levels.

`--user, -u`
: Display all workflows by this user. Users can pass multiple values to this flag.
  <br/>
  Default: `[]`

`--all-users, -a`
: Display all workflows with no filtering on users.
  <br/>
  Default: `False`

`--pool, -p`
: Display all workflows by this pool. Users can pass multiple values to this flag.
  <br/>
  Default: `[]`

`--app, -P`
: Display all workflows created by this app. For a specific app or app version, use the format <app>:<version>.

<a id="cli-reference-workflow-tag"></a>

### tag

List or change tags from workflow(s) if no workflow is specified. Remove is applied before add

```text
osmo workflow tag [-h] [--workflow WORKFLOW [WORKFLOW ...]]
                  [--add ADD [ADD ...]]
                  [--remove REMOVE [REMOVE ...]]
```

<a id="cli-reference-workflow-tag-named-arguments"></a>

#### Named Arguments

`--workflow, -w`
: List of workflows to update. If not set, the CLI will return the list of available tags to assign.

`--add, -a`
: List of tags to add.
  <br/>
  Default: `[]`

`--remove, -r`
: List of tags to remove.
  <br/>
  Default: `[]`

<a id="cli-reference-workflow-exec"></a>

### exec

Exec into a task of a workflow.

```text
osmo workflow exec [-h] [--group GROUP]
                   [--entry EXEC_ENTRY_COMMAND]
                   [--connect-timeout CONNECT_TIMEOUT]
                   [--keep-alive]
                   workflow_id [task]
```

<a id="cli-reference-workflow-exec-positional-arguments"></a>

#### Positional Arguments

`workflow_id`
: The workflow ID or UUID to exec in.

`task`
: The task name to exec into.

<a id="cli-reference-workflow-exec-named-arguments"></a>

#### Named Arguments

`--group`
: Send command to all tasks in the group.

`--entry`
: Specify the entry point for exec (Default /bin/bash).
  <br/>
  Default: `'/bin/bash'`

`--connect-timeout`
: The connection timeout period in seconds. Default is 60 seconds.
  <br/>
  Default: `60`

`--keep-alive`
: Restart the exec command if connection is lost.
  <br/>
  Default: `False`

<a id="cli-reference-workflow-spec"></a>

### spec

Get workflow spec.

```text
osmo workflow spec [-h] [--template] workflow_id
```

<a id="cli-reference-workflow-spec-positional-arguments"></a>

#### Positional Arguments

`workflow_id`
: The workflow ID or UUID to query the status of.

<a id="cli-reference-workflow-spec-named-arguments"></a>

#### Named Arguments

`--template`
: Show the original templated spec
  <br/>
  Default: `False`

<a id="cli-reference-workflow-port-forward"></a>

### port-forward

Port-forward data from workflow to local machine.

```text
osmo workflow port-forward [-h] [--host HOST] --port PORT [--udp]
                           [--connect-timeout CONNECT_TIMEOUT]
                           workflow_id task
```

<a id="cli-reference-workflow-port-forward-positional-arguments"></a>

#### Positional Arguments

`workflow_id`
: The ID or UUID of the workflow to port forward from

`task`
: Name of the task in the workflow to port forward from

<a id="cli-reference-workflow-port-forward-named-arguments"></a>

#### Named Arguments

`--host`
: The hostname used to bind the local port. Default value is localhost.
  <br/>
  Default: `'localhost'`

`--port`
: Port forward from task in the pool. Input value should be in format local_port[:task_port], or in range port1-port2,port3-port4 (right end inclusive). e.g. “8000:2000”, “8000”, “8000-8010:9000-9010,8015-8016”. If using a single port value or range, the client will use that port value for both local port and task port.

`--udp`
: Use UDP port forward.
  <br/>
  Default: `False`

`--connect-timeout`
: The connection timeout period in seconds. Default is 60 seconds.
  <br/>
  Default: `60`

### Examples

Forward UDP traffic from a task to your local machine:

```default
osmo workflow port-forward wf-1 sim-task --port 47995-48012,49000-49007 --udp
```

<a id="cli-reference-workflow-rsync"></a>

### rsync

Syncs data from local machine to a remote workflow task via a persistent background daemon. It will continuously monitors the source path and automatically upload any changes to the remote task.

/osmo/run/workspace is always available as a remote path.

```text
osmo workflow rsync [-h] [--status] [--stop] [--timeout TIMEOUT]
                    [--upload-rate-limit UPLOAD_RATE_LIMIT]
                    [--poll-interval POLL_INTERVAL]
                    [--debounce-delay DEBOUNCE_DELAY]
                    [--reconcile-interval RECONCILE_INTERVAL]
                    [--max-log-size MAX_LOG_SIZE] [--verbose]
                    [--once]
                    [workflow_id] [task] [path]
```

<a id="cli-reference-workflow-rsync-positional-arguments"></a>

#### Positional Arguments

`workflow_id`
: The ID or UUID of the workflow to rsync to/from

`task`
: (Optional) The task to rsync upload to. If not provided, the upload will be to the lead task of the first group.

`path`
: The src:dst path to rsync between.

<a id="cli-reference-workflow-rsync-named-arguments"></a>

#### Named Arguments

`--status, -s`
: Show the status of all rsync daemons
  <br/>
  Default: `False`

`--stop`
: Stop one or more rsync daemons
  <br/>
  Default: `False`

`--timeout`
: The connection timeout period in seconds. Default is 10 seconds.
  <br/>
  Default: `10`

`--upload-rate-limit`
: Rate limit the upload speed in bytes per second. The upload speed is also subjected to admin configured rate-limit.

`--poll-interval`
: The amount of time (seconds) between polling the task for changes in daemon mode. If not provided, the admin-configured default will be used.

`--debounce-delay`
: The amount of time (seconds) of inactivity after last file change before a sync is triggered in daemon mode. If not provided, the admin-configured default will be used.

`--reconcile-interval`
: The amount of time (seconds) between reconciling the upload in daemon mode. This is used to ensure that failed uploads during network interruptions will resume after connection is restored. If not provided, the admin-configured default will be used.

`--max-log-size`
: The maximum log size in bytes for the daemon before log rotation. Default is 2MB.
  <br/>
  Default: `2097152`

`--verbose`
: Enable verbose logging for the daemon.
  <br/>
  Default: `False`

`--once`
: Run a single rsync upload to the workflow. The upload will be done in the foreground and will automatically exit once the upload completes.
  <br/>
  Default: `False`

### Examples

Upload to a task:

```default
osmo workflow rsync <workflow_id> <task_name> <local_path>:<remote_path>
```

Upload to lead task:

```default
osmo workflow rsync <workflow_id> <local_path>:<remote_path>
```

Run a single upload:

```default
osmo workflow rsync <workflow_id> <local_path>:<remote_path> --once
```

Get the status of daemons:

```default
osmo workflow rsync --status
```

Stop all daemons:

```default
osmo workflow rsync --stop
```

Stop a specific daemon:

```default
osmo workflow rsync <workflow_id> --stop
```
