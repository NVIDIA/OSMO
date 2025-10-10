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

.. _workflow_containers:

=======================================================
Workflow Containers
=======================================================

For each task defined in a workflow, the service creates a corresponding pod in Kubernetes.
The pod consists of three containers:

- **osmo-init**: The init container for the Kubernetes pod
- **osmo-ctrl**: The sidecar container that coordinates between the user container and the service
- **User Container**: The container that uses the image and command defined in the workflow spec, which uses the name defined for the task in the workflow spec

osmo-init
~~~~~~~~~

The osmo-init container is the init container for the Kubernetes pod.
It is responsible for:

- Setting up the directories and their permissions for data operations in the task
- Exposing OSMO CLI to the user container
- Populating the login directory with the necessary files in user container and osmo-ctrl

osmo-ctrl
~~~~~~~~~

The osmo-ctrl container is the sidecar container that coordinates between the user container and the service.
It is responsible for:

- Managing WebSocket connections to the core service to send logs and metrics, and receive actions (such as exec, port-forward, and rsync) from the user
- Downloading data at the beginning before user container starts running the user's command
- Initiating the user container to start running the user's command
- Notifying the user container of user requests to start exec, port-forward, and rsync
- Uploading data in the output directory after the user container finishes

.. note::

  This container is able to upload data that is generated from the
  user container because they share the same volume mount.

User Container
~~~~~~~~~~~~~~

The user container is the container that uses the image and command defined in the workflow spec.
The user container communicates with `osmo-ctrl` through a Unix socket.
It is responsible for:

- Running the user's command
- Reading and writing data to the user when the user initiates exec, port-forward, and rsync
