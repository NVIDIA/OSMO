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

.. _credentials_registry:

================================================
Registry
================================================

Fetch registry credentials
================================================

OSMO supports users to run containers from various registries. Below are supported container registries.

* `Nvidia GPU Cloud(NGC) <https://catalog.ngc.nvidia.com/?filters=&orderBy=weightPopularDESC&query=>`_
* `Docker Hub <https://hub.docker.com/_/registry>`_
* `Github <https://ghcr.io/>`_
* `Gitlab <https://docs.gitlab.com/ee/user/packages/container_registry/>`_

To run any workflow, users are required to set credential for at minimum one of the above registries.

`Nvidia GPU Cloud <http://ngc.nvidia.com>`_ (NGC) is an online catalog of GPU accelerated cloud applications (docker containers, helm charts, and models). It also provides private registries for teams to upload their own docker containers.  NGC access is required to upload and manage containerized applications.

Please refer to `<https://org.ngc.nvidia.com/setup/personal-keys>`_ and generate a personal API key. Ensure that while creating the key,
in ``Services Included*`` drop down, select ``Private Registry``.

.. note::

  Please make sure to save your API key to a file, it will never be displayed to you again. If you lose your API key, you can always generate a new one, but the old one will be invalidated, and applications that have logged in with it will have to log back in.

You may also use NGC to browse docker containers that have been uploaded to the team’s private registry `<https://ngc.nvidia.com/containers>`_


Setup the registry credentials
================================================

To set up registry credentials:

.. code-block:: bash

  $ osmo credential set <registry_cred_name> --type REGISTRY --payload registry=<registry> username=<username> auth=<registry_token>

To set up credentials for NGC:

.. code-block:: bash

  $ osmo credential set <registry_cred_name> --type REGISTRY --payload registry=nvcr.io username='$oauthtoken' auth=<ngc_token>
