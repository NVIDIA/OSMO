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



Step 1: Create OSMO service access token
-----------------------------------------

Use the OSMO CLI to create a service access token for the backend. This token will be used to authenticate the backend operator with the OSMO service.

.. code-block:: bash

   $ osmo login https://<your-domain>

   $export OSMO_SERVICE_TOKEN=$(osmo token set backend-token --expires-at <insert-date> --description "Backend Operator Token" --service --roles osmo-backend -t json | jq -r '.token')

Save the token in a secure location as it will not be shown again. Export it as an environment variable to use in the next step.

.. note::

  If you get an error like:

  .. code-block:: text

    Connection failed with error: {OSMOUserError: Token is expired, but no refresh token is present}

  Check the ``osmo token list --service`` command to see if the token is expired.
  If it is, you can create a new token using the OSMO CLI following the steps above.


Step 2: Create Kubernetes Namespaces and Secrets
------------------------------------------------

Create Kubernetes namespaces and secrets necessary for the backend deployment.

.. code-block:: bash
  :substitutions:

    # Create namespaces for osmo operator and osmo workflows
    $ kubectl create namespace osmo-operator
    $ kubectl create namespace osmo-workflows

    # Create image pull secret for osmo images
    $ kubectl create secret docker-registry imagepullsecret -n osmo-operator \
        --docker-server="nvcr.io" \
        --docker-username='$oauthtoken' \
        --docker-password= # insert NGC API key here

    # Create the secret used to authenticate with osmo
    $ kubectl create secret generic osmo-operator-token -n osmo-operator \
        --from-literal=token=$OSMO_SERVICE_TOKEN


Step 3: Deploy Backend Operator
-------------------------------

Deploy the backend operator to the backend kubernetes cluster.

Prepare the backend operator values file:

.. code-block:: yaml

   global:
    osmoImageTag: <insert-osmo-image-tag> # insert osmo image tag here
    imagePullSecret: imagepullsecret
    serviceUrl: http://<your-domain>
    agentNamespace: osmo-operator
    backendNamespace: osmo-workflows
    backendName: default # update to reflect the name of your backend
    accountTokenSecret: osmo-operator-token
    loginMethod: token

    services:
    backendListener:
      resources:
        requests:
            cpu: "1"
            memory: "1Gi"
        limits:
            memory: "1Gi"
    backendWorker:
      resources:
        requests:
            cpu: "1"
            memory: "1Gi"
        limits:
            memory: "1Gi"


deploy the backend operator:

.. code-block:: bash

   $ helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo \
     --username \$oauthtoken --password <insert-NGC-API-KEY>

   $ helm repo update

   $ helm upgrade --install osmo-operator osmo/backend-operator \
     -f ./backend_operator_values.yaml \
     --version <insert-chart-version> \
     --namespace osmo-operator

After verifying that the backend operator is running, you should be able to see the backend in the `GET API <backend_config_get_>`_ and see a non-empty list in backend.


Step 4: Configure Scheduler Settings
------------------------------------
We strongly recommend using the KAI scheduler (KAI), if it is not already installed follow :ref:`installing_required_dependencies` to install it.

To configure the workflow backend with the KAI scheduler, use the following `scheduler_settings`:

.. code-block:: bash

  $ echo '{
    "scheduler_settings": {
      "scheduler_type": "kai",
      "scheduler_name": "kai-scheduler",
      "coscheduling": true,
      "scheduler_timeout": 30
    }
  }' > /tmp/scheduler_settings.json


.. note::
  refer to :ref:`scheduler` for more information on the scheduler settings.

Then update the backend configuration using the OSMO CLI. Once the change is applied, the new submissions will use the new scheduler. Old submissions that have already been submitted will continue to use the old scheduler.


.. code-block:: bash
  :substitutions:

  BACKEND_NAME=...
  $ osmo config update BACKEND $BACKEND_NAME --file /tmp/scheduler_settings.json


Step 5: Validate
--------------------------

Use the OSMO CLI to validate the backend configuration.

.. code-block:: bash
  :substitutions:

  BACKEND_NAME=...
  $ osmo config show BACKEND $BACKEND_NAME

Step 6: Setup Image Credentials
-------------------------------

OSMO workflows launches two sidecar containers to support the workflow execution. These sidecar containers need to be able to pull images from the registry.
Setup the credentials for the backend agents with the following command

.. code-block:: bash

  export NGC_API_KEY=...
  $ echo '{
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
  $ osmo config update WORKFLOW --file /tmp/workflow_config.json


Uninstall
----------------------------

Start by uninstalling the helm chart on your backend cluster:

.. code-block:: bash
  :substitutions:

  $ helm uninstall $RELEASE_NAME

Delete the backend configuration using the OSMO CLI.

.. code-block:: bash
  :substitutions:

  BACKEND_NAME=...
  $ osmo config delete BACKEND $BACKEND_NAME

Using the OSMO CLI, run ``osmo config show BACKEND`` to see if the backend is no longer visible.

.. code-block:: bash
  :substitutions:

  $ osmo config show BACKEND
  Key   Value
  ===========



