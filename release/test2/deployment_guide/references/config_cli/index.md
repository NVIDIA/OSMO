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

# Configuration CLI

This section describes how to configure OSMO using the `osmo config` commands.

## Management

OSMO maintains a history of all configuration changes. Each change to a config is tracked as a new “revision”, allowing you to:

* Track who made changes and when
* View previous configurations
* Roll back to previous revisions if needed

You can use `--description` and `--tags` to add additional information about configuration changes made with `osmo config update`, `osmo config delete`, and `osmo config rollback`.

All configuration changes require admin privileges and may affect running workflows.

## Command overview

Show help docs with `osmo config --help`.

The `osmo config` command provides the following sub-commands:

* [osmo config show](config_show.md)
* [osmo config update](config_update.md)
* [osmo config list](config_list.md)
* [osmo config history](config_history.md)
* [osmo config diff](config_diff.md)
* [osmo config delete](config_delete.md)
* [osmo config set](config_set.md)
* [osmo config rollback](config_rollback.md)
* [osmo config tag](config_tag.md)
