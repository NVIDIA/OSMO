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

.. _register_cb:

================================================
Register Backend
================================================

A compute backend must be created and registered with OSMO to run workflows. Follow below steps to
register your compute backend with OSMO.

Prerequisites
-----------------------------

- :ref:`Create a compute backend <create_cb>`
- `Install the OSMO CLI <../../../docs/getting_started/install.html#install-client>`_


[Optional] Create OSMO backend role
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

By default, OSMO has a preassigned role for backend access called ``osmo-backend``.
This role allows full access to the backend API as any backend name.

If you want to create a role so that the agent only has access to the backend API as a specific
backend name, you can create a new role using the OSMO CLI. Follow the steps in :ref:`config_set`
to create a new backend role.


Create OSMO service access token
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Use the OSMO CLI to create a service access token for the backend.

.. note::

  If you created a new backend role in the previous step, replace ``osmo-backend`` with the
  name of the new role in the command below.

.. code-block:: bash

  $ osmo token set <backend-name>-token --expires-at <date> --description "My Access Token for Backend <backend>" --service --roles osmo-backend
  Note: Save the token in a secure location as it will not be shown again
  Access token: <access-token>

.. note::

  If you get an error like:

  .. code-block:: text

    Connection failed with error: {OSMOUserError: Token is expired, but no refresh token is present}

  Check the `osmo token list --service` command to see if the token is expired.
  If it is, you can create a new token using the OSMO CLI following the steps above.


Create backend agents
~~~~~~~~~~~~~~~~~~~~~

Start by identifying a kubernetes cluster to use as the workflow backend. Then, configure your
``kubectl`` client to connect to the kubernetes cluster.

Populate the following variables

.. code-block:: bash
  :substitutions:

    # The name of the backend (visible to users)
    export BACKEND_NAME=...
    # The service token generated from the step above
    export SERVICE_ACCOUNT_TOKEN=...
    # The name of the ngc organization is fixed to nvidia
    export NGC_ORG=nvidia
    # An NGC api key that is capable of reading images from your NGC private registry
    export NGC_API_KEY=...
    # The OSMO hostname provided by solution architect (ie my-company.osmo.nvidia.com)
    export OSMO_HOSTNAME=...
    # The image tag of OSMO agent dockers to deploy
    export OSMO_TAG=...
    # The namespace to deploy OSMO agent
    export OSMO_NAMESPACE=osmo
    # The namespace to run tests
    export TEST_NAMESPACE=osmo-test
    # The namespace to run workflows
    export WORKFLOW_NAMESPACE=default




Next step, initialize the namespaces and secrets

.. code-block:: bash
  :substitutions:

    # Create namespaces if they don't exist yet
    kubectl create namespace $OSMO_NAMESPACE
    kubectl create namespace $WORKFLOW_NAMESPACE
    kubectl create namespace $TEST_NAMESPACE
    # Create image pull secret for osmo images
    kubectl create secret docker-registry nvcr-secret -n $OSMO_NAMESPACE \
        --docker-server="nvcr.io" \
        --docker-username='$oauthtoken' \
        --docker-password=$NGC_API_KEY

    # Create the secret used to authenticate with osmo
    kubectl create secret generic agent-token -n $OSMO_NAMESPACE \
        --from-literal=token=$SERVICE_ACCOUNT_TOKEN


Finally, deploy the backend manager helm chart

.. code-block:: bash
  :substitutions:


    helm repo add osmo https://helm.ngc.nvidia.com/$NGC_ORG/osmo \
      --username \$oauthtoken --password $NGC_API_KEY
    helm repo update

    helm upgrade --install osmo-operator osmo/backend-operator \
        --namespace osmo \
        --version 0.1.0-$OSMO_TAG \
        --set global.osmoImageTag=$OSMO_TAG \
        --set global.osmoImageLocation=nvcr.io/$NGC_ORG/osmo \
        --set global.serviceUrl=https://$OSMO_HOSTNAME \
        --set global.backendNamespace=$WORKFLOW_NAMESPACE \
        --set global.backendTestNamespace=$TEST_NAMESPACE \
        --set global.backendName=$BACKEND_NAME \
        --set global.accountTokenSecret=agent-token \
        --set global.loginMethod=token \


You can verify that the backend agent is running by running the following command:

.. code-block:: bash
  :substitutions:

    kubectl get pods -n $OSMO_NAMESPACE

After verifying that the backend agent is running, you should be able to see the backend in the `GET API <backend_config_get_>`_ and see a non-empty list in backend.

Configure
---------------------------------------

Configure the backend with the OSMO CLI. First, create the desired backend configuration.

.. code-block:: bash
  :substitutions:

  echo '{
    "description": "...",
    "dashboard_url": "...",
    "grafana_url": "..."
  }' > /tmp/backend_config.json

..  list-table::
    :header-rows: 1
    :widths: auto

    * - **Field**
      - **Description**
    * - description
      - Default empty. Quick explanation of the resources available to this cluster.
    * - dashboard_url
      - Default empty. Link to a browser page to view the running pods.
    * - grafana_url
      - Default empty. Link to a browser page to view the pods resources and cluster status.

Then update the backend configuration using the CLI.

.. code-block:: bash
  :substitutions:

  BACKEND_NAME=...
  osmo config update BACKEND $BACKEND_NAME --file /tmp/backend_config.json

Additional configuration parameters are available beyond those displayed in the image above. These parameters provide extended functionality for backend configuration.

..  list-table::
    :header-rows: 1
    :widths: auto

    * - **Field**
      - **Description**
    * - scheduler_settings [dict]
      - Scheduler settings to be used for the workflow backend. Default is:

        ``{"scheduler_type": "default-scheduler", "scheduler_name": "default-scheduler", "coscheduling": false, "scheduler_timeout": 30}``.
        ``scheduler_type`` specifies the type of scheduler to use.
        ``scheduler_name`` specifies the name of the scheduler.
        ``coscheduling`` enables pod group scheduling.
        ``scheduler_timeout`` specifies the timeout in seconds for scheduling.

        See "Scheduler settings (optional)" below.
    * - node_conditions [dict]
      - Controls how Kubernetes Node conditions determine availability for scheduling and which conditions to ignore. Default is:

        ``{"additional_node_conditions": [], "ignore_node_conditions": [], "prefix": "osmo.nvidia.com/"}``

        See "Node conditions (optional)" below.

Scheduler settings (optional)
-------------------------------
To use a scheduler other than the default (such as the KAI scheduler), you must configure the `scheduler_settings` field in your backend configuration.
This allows you to specify the scheduler type, name, and related options. For more information on supported schedulers and how to install their dependencies, see :doc:`Required dependencies <../dependencies/required/index>` (see the "Option 1: KAI (Recommended)" section).


To configure the workflow backend with the KAI scheduler, use the following `scheduler_settings`:

.. code-block:: bash

  echo '{
    "scheduler_settings": {
      "scheduler_type": "kai",
      "scheduler_name": "kai-scheduler",
      "coscheduling": true,
      "scheduler_timeout": 30
    }
  }' > /tmp/scheduler_settings.json


Then update the backend configuration using the OSMO CLI. Once the change is applied, the new submissions will use the new scheduler. Old submissions that have already been submitted will continue to use the old scheduler.


.. code-block:: bash
  :substitutions:

  BACKEND_NAME=...
  osmo config update BACKEND $BACKEND_NAME --file /tmp/scheduler_settings.json


Node conditions (optional)
----------------------------

``node_conditions`` lets you customize how OSMO evaluates `Kubernetes Node conditions <https://kubernetes.io/docs/reference/node/node-status/#condition>`_ when deciding whether a node is available for scheduling, and which conditions to ignore.
It also controls the label prefix used for the automatic verification label.

- ``additional_node_conditions``: List of condition type names that must be ``True`` (in addition to the default ``Ready``). Supports wildcard suffix ``*`` for prefix matches (e.g. ``nvidia.com/*``).
- ``ignore_node_conditions``: List of condition type names to exclude from evaluation. Supports wildcard suffix ``*`` for prefix matches.
- ``prefix``: String prefix used when OSMO sets the verification label on nodes. The label key will be ``<prefix>verified`` with values ``True``/``False``. Default is ``osmo.nvidia.com/`` and if changed needs to end with ``osmo.nvidia.com/``. This value is configured via the Helm chart (``global.nodeConditionPrefix``) and is read by the backend agent at startup; to change it, update the Helm values and redeploy the agent (it cannot be changed via backend configuration at runtime).

How availability is computed:

- OSMO reads all conditions on a node. For any condition whose type matches an entry in ``ignore_node_conditions`` (exact match or prefix match when the list entry ends with ``*``), that condition is skipped.
- For the remaining conditions:
  - If the condition type matches the default set ``["Ready"]`` or any entry in ``additional_node_conditions`` (exact match or prefix match when the list entry ends with ``*``), the condition must have status ``True``.
  - All other non-ignored conditions must have status ``False``.
- Additionally, nodes marked unschedulable (cordoned) are considered unavailable regardless of conditions.

OSMO will also update a node label ``<prefix>verified`` to reflect availability (``True`` or ``False``). By default, this is disabled. To enable it, set ``services.backendListener.enable_node_label_update`` to ``true`` in the backend configuration.

Example configuration

.. code-block:: bash

  echo '{
    "node_conditions": {
      "additional_node_conditions": ["GpuHealthy"],
      "ignore_node_conditions": ["NetworkUnavailable", "SomeTransient*"],
      "prefix": "osmo.nvidia.com/"
    }
  }' > /tmp/node_conditions.json

  BACKEND_NAME=...
  osmo config update BACKEND $BACKEND_NAME --file /tmp/node_conditions.json

.. note::

  - Wildcards only match as a prefix. For example, ``OSMO*`` matches ``OSMOCheck`` and ``OSMO-Verified``, but not ``MyOSMOCond``.
  - You don't need to include ``Ready`` in ``additional_node_conditions``; it is always required to be ``True`` by default.
  - If you want to ignore an entire family of custom conditions, prefer using a prefix wildcard in ``ignore_node_conditions``.


Validate
--------------------------

Use the OSMO CLI to validate the backend configuration.

.. code-block:: bash
  :substitutions:

  BACKEND_NAME=...
  osmo config show BACKEND $BACKEND_NAME


Uninstall
----------------------------

Start by uninstalling the helm chart on your backend cluster:

.. code-block:: bash
  :substitutions:

    helm uninstall $RELEASE_NAME

Delete the backend configuration using the OSMO CLI.

.. code-block:: bash
  :substitutions:

  BACKEND_NAME=...
  osmo config delete BACKEND $BACKEND_NAME

Using the OSMO CLI, run ``osmo config show BACKEND`` to see if the backend is no longer visible.

.. code-block:: bash
  :substitutions:

  $ osmo config show BACKEND
  Key   Value
  ===========


Assign Image Credentials
----------------------------

Setup the credentials for the backend agents with the following command

.. code-block:: bash

  export NGC_API_KEY=...
  echo '{
    "backend_images": {
      "credential": {
        "registry": "nvcr.io",
        "username": "$oauthtoken",
        "auth": "'$NGC_API_KEY'"
      }
    }
  }' > /tmp/workflow_config.json

Then, update the workflow configuration using the OSMO CLI.

.. code-block:: bash

  BACKEND_NAME=...
  osmo config update WORKFLOW --file /tmp/workflow_config.json
