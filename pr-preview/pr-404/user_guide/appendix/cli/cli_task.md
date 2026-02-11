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

<a id="cli-reference-task"></a>

# osmo task

```default
usage: osmo task [-h] {list} ...
```

## Positional Arguments

* **command**: 

Possible choices: list

## Sub-commands

### list

List tasks with different filters.

```default
osmo task list [-h] [--status STATUS [STATUS ...]] [--workflow-id WORKFLOW_ID]
               [--user USER [USER ...] | --all-users] [--pool POOL [POOL ...]
               | --node NODE [NODE ...]] [--started-after STARTED_AFTER]
               [--started-before STARTED_BEFORE] [--count COUNT]
               [--offset OFFSET] [--order {asc,desc}] [--verbose | --summary]
               [--aggregate-by-workflow]
               [--priority {HIGH,NORMAL,LOW} [{HIGH,NORMAL,LOW} ...]]
               [--format-type {json,text}]
```

#### Named Arguments

* **--status, -s**: 

Possible choices: WAITING, PROCESSING, SCHEDULING, INITIALIZING, RUNNING, FAILED, COMPLETED, FAILED_EXEC_TIMEOUT, FAILED_START_ERROR, FAILED_START_TIMEOUT, FAILED_SERVER_ERROR, FAILED_BACKEND_ERROR, FAILED_QUEUE_TIMEOUT, FAILED_IMAGE_PULL, FAILED_UPSTREAM, FAILED_EVICTED, FAILED_PREEMPTED, FAILED_CANCELED

Display all tasks with the given status(es). Users can pass multiple values to this flag. Defaults to PROCESSING, SCHEDULING, INITIALIZING and RUNNING. Acceptable values: WAITING, PROCESSING, SCHEDULING, INITIALIZING, RUNNING, FAILED, COMPLETED, FAILED_EXEC_TIMEOUT, FAILED_START_ERROR, FAILED_START_TIMEOUT, FAILED_SERVER_ERROR, FAILED_BACKEND_ERROR, FAILED_QUEUE_TIMEOUT, FAILED_IMAGE_PULL, FAILED_UPSTREAM, FAILED_EVICTED, FAILED_PREEMPTED, FAILED_CANCELED.

Default: `['PROCESSING', 'SCHEDULING', 'INITIALIZING', 'RUNNING']`
* **--workflow-id, -w**: 

Display workflows which contains the string.
* **--user, -u**: 

Display all tasks by this user. Users can pass multiple values to this flag.

Default: `[]`
* **--all-users, -a**: 

Display all tasks with no filtering on users.

Default: `False`
* **--pool, -p**: 

Display all tasks by this pool. Users can pass multiple values to this flag. If not specified, all pools will be selected.

Default: `[]`
* **--node, -n**: 

Display all tasks which ran on this node. Users can pass multiple values to this flag. If not specified, all nodes will be selected.

Default: `[]`
* **--started-after**: 

Filter for tasks that were started after AND including this date. Must be in format YYYY-MM-DD.
Example: –started-after 2023-05-03.
* **--started-before**: 

Filter for tasks that were started before (NOT including) this date. Must be in format YYYY-MM-DD.
Example: –started-after 2023-05-02 –started-before 2023-05-04 includes all tasks that were started any time on May 2nd and May 3rd only.
* **--count, -c**: 

Display the given count of tasks. Default value is 20. Max value of 1000.

Default: `20`
* **--offset, -f**: 

Used for pagination. Returns starting tasks from the offset index.

Default: `0`
* **--order, -o**: 

Possible choices: asc, desc

Display in the order in which tasks were started. asc means latest at the bottom. desc means latest at the top.

Default: `'asc'`
* **--verbose, -v**: 

Display storage, cpu, memory, and gpu request.

Default: `False`
* **--summary, -S**: 

Displays resource request grouped by user and pool.

Default: `False`
* **--aggregate-by-workflow, -W**: 

Aggregate resource request by workflow.

Default: `False`
* **--priority**: 

Possible choices: HIGH, NORMAL, LOW

Filter tasks by priority levels.
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`
