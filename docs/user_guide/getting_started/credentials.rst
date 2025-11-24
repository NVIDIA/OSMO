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

.. _credentials:

=================
Setup Credentials
=================

Credentials are secrets required to run workflows or perform data operations in OSMO.

OSMO supports the following types of credentials:

* :ref:`Registry <credentials_registry>` - for accessing private container registries where Docker images are stored
* :ref:`Data <credentials_data>` - for accessing data storage solutions to read/write data in your workflows
* :ref:`Generic <credentials_generic>` - for storing and dereferencing generic key value pairs in the workflows

.. _credentials_registry:

Registry
========

.. hint::

   If you are using **public** container registries, you can skip this step.

.. important::

   If you are using a private container registry, you are **required** to
   set up registry credentials in order to pull container images for your workflows.

.. tab-set::

    .. tab-item:: NVIDIA GPU Cloud (NGC)

        .. dropdown:: What is NGC?
            :color: primary
            :icon: question

            `NVIDIA GPU Cloud <https://catalog.ngc.nvidia.com>`__ (NGC) is an online catalog of GPU accelerated
            cloud applications (docker containers, helm charts, and models). It also provides **private
            registries** for teams to upload their own docker containers.

            Please refer to `<https://org.ngc.nvidia.com/setup/api-keys>`__ to generate a personal
            API Key. Ensure that while creating the key, in ``Services Included*`` drop down,
            select ``Private Registry``.

            .. important::

                Please make sure to save your API key to a file, it will never be displayed to you
                again. If you lose your API key, you can always generate a new one, but the old one will
                be invalidated, and applications will have to be re-authenticated.

        To setup a registry credential for NGC, run the following command with your NGC API key:

        .. code-block:: bash

            $ osmo credential set my-ngc-cred \
                    --type REGISTRY \
                    --payload registry=nvcr.io \
                    username='$oauthtoken' \
                    auth=<ngc_api_key>

    .. tab-item:: Docker Hub

        Authenticated access to `Docker Hub <https://hub.docker.com/>`__ is supported.

        .. seealso::

            Please refer to `Docker Documentation <https://docs.docker.com/>`__ for more information
            on username/password and Personal Access Token (PAT) authentication.

        To setup a registry credential for Docker Hub, run the following command:

        .. code-block:: bash

            $ osmo credential set my-docker-hub-cred \
                    --type REGISTRY \
                    --payload registry=docker.io \
                    username=<docker_hub_username> \
                    auth=<docker_hub_password or PAT>

    .. tab-item:: Github

        Authenticated access to `Github Container Registry <https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry>`__ is supported.

        .. seealso::

            Please refer to `Github Documentation <https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry>`__
            for more information on registry authentication.

        To setup a registry credential for GHCR, run the following command:

        .. code-block:: bash

            $ osmo credential set my-ghcr-cred \
                    --type REGISTRY \
                    --payload registry=ghcr.io \
                    username=<github_username> \
                    auth=<github_token>

    .. tab-item:: Gitlab

        Authenticated access to `Gitlab Container Registry <https://docs.gitlab.com/user/packages/container_registry/>`__ is supported.

        .. seealso::

            Please refer to `Gitlab Documentation <https://docs.gitlab.com/user/packages/container_registry/authenticate_with_container_registry/>`__
            for more information on registry authentication.

        To setup a registry credential for Gitlab, run the following command:

        .. code-block:: bash

            $ osmo credential set my-gitlab-cred \
                    --type REGISTRY \
                    --payload registry=<gitlab_registry_url> \
                    username=<gitlab_username> \
                    auth=<gitlab_password_or_token>

.. _credentials_data:

Data
====

OSMO integrates with the following data storage solutions:

.. auto-include:: supported_storage.in.rst

To access your data storage within workflows, you'll need to set the appropriate credentials.

.. important::

    For assistance with **creating credentials** for your data storage provider, please
    contact your OSMO administrator.

.. tab-set::

    .. auto-include:: data_credentials_examples.in.rst

    .. tab-item:: AWS S3

        To set a credential for S3, run the following command:

        .. code-block:: bash

            $ osmo credential set my-s3-cred \
                --type DATA \
                --payload \
                endpoint=s3://<bucket> \
                region=us-east-1 \
                access_key_id=<access_key_id> \
                access_key=<access_key> \

        .. seealso::

            Please refer to `AWS Access Key Documentation <https://docs.aws.amazon.com/IAM/latest/UserGuide/access-key-self-managed.html>`_
            for additional information on managing AWS access keys.

    .. tab-item:: GCP Cloud Storage

        To set a credential for GCP Cloud Storage (GCS), run the following command:

        .. code-block:: bash

            $ osmo credential set my-gcs-cred \
                --type DATA \
                --payload \
                endpoint=gs://<bucket> \
                region=<region> \
                access_key_id=<access_key_id> \
                access_key=<access_key> \

        **Field Mappings:**

            - ``access_key_id`` → **Access Key** in GCP
            - ``access_key`` → **Secret** in GCP

        .. seealso::

            Please refer to `GCS HMAC Keys Documentation <https://docs.cloud.google.com/storage/docs/authentication/managing-hmackeys#console>`_
            for additional information on managing **interoperable** access keys.

    .. tab-item:: Azure Blob Storage

        To set a credential for Azure Blob Storage, run the following command:

        .. code-block:: bash

            $ osmo credential set my-azure-cred \
                --type DATA \
                --payload \
                endpoint=azure://<storage-account>/<container> \
                region=<region> \
                access_key_id=<access_key_id> \
                access_key=<access_key>

        **Field Mappings:**

            - ``access_key`` → **Connection String** in Azure
            - ``access_key_id`` → can be **ANY** string value (e.g. ``<storage-account>`` or ``<username>``)
            - ``region`` → **OPTIONAL** (defaults to ``eastus``)

        .. seealso::

            Please refer to `Azure Storage Connection String Documentation <https://learn.microsoft.com/en-us/azure/storage/common/storage-configure-connection-string>`_
            for additional information on managing Azure Storage Connection Strings.

    .. tab-item:: Torch Object Storage

        To set a credential for Torch Object Storage, run the following command:

        .. code-block:: bash

            $ osmo credential set my-tos-cred \
                --type DATA \
                --payload \
                endpoint=tos://<endpoint>/<bucket> \
                region=<region> \
                access_key_id=<access_key_id> \
                access_key=<access_key>

        **Field Mappings:**

            - ``access_key_id`` → **Access Key ID (AK)** in TOS
            - ``access_key`` → **Secret Access Key (SK)** in TOS
            - ``region`` → **Region** in TOS (e.g. ``cn-beijing``, ``cn-shanghai``, etc.)

        .. seealso::

           Please refer to `TOS Access Keys Documentation <https://docs.byteplus.com/en/docs/byteplus-platform/docs-creating-an-accesskey>`_
           for additional information on managing access keys.

.. _credentials_generic:

Generic Secrets
===============

Any other secrets unrelated to registry and data can be stored as generic credentials (``type=GENERIC``).

For example, to access the Omniverse Nucleus server:

.. code-block:: bash

  $ osmo credential set omni-auth \
        --type GENERIC \
        --payload omni_user='$omni-api-token' \
        omni_pass=<token>

Another example is to access Weights and Biases (W&B) for logging and tracking your experiments:

.. code-block:: bash

  $ osmo credential set wb-auth \
        --type GENERIC \
        --payload wb_api_key=<api_key>

.. seealso::

  Your registry and data credentials are picked up automatically when you submit a workflow.
  To specify a generic credential in the workflow, refer to :ref:`workflow_spec_secrets`.

.. _credentials_cli:

CLI Reference
=============

.. seealso::

   See :ref:`here <cli_reference_credential>` for the full CLI reference for ``osmo credential``.
