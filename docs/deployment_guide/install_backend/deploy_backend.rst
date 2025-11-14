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

.. _deploy_backend:

================================================
Deploy Backend Operator
================================================

A compute backend must be created and registered with OSMO to run workflows. Follow below steps to
deploy the backend operator with OSMO.

Prerequisites
-----------------------------

- :ref:`Create an on-premises backend <onprem_cb>` or :ref:`Create a cloud-based backend <cloud_cb>`
- `Install the OSMO CLI <https://nvidia.github.io/OSMO/user_guide/getting_started/install>`_

Step 1: Create OSMO service access token
-----------------------------------------

Use the OSMO CLI to create a service access token for the backend. This token will be used to
authenticate the backend operator with the OSMO service.

.. code-block:: bash

   $ osmo login https://<your-domain>

   $export OSMO_SERVICE_TOKEN=$(osmo token set backend-token --expires-at <insert-date> --description "Backend Operator Token" --service --roles osmo-backend -t json | jq -r '.token')

Save the token in a secure location as it will not be shown again. Export it as an environment
variable to use in the next step.

.. note::

  ``expires-at`` is based on UTC time and has the format: YYYY-MM-DD

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

    # Create the secret used to authenticate with osmo
    $ kubectl create secret generic osmo-operator-token -n osmo-operator \
        --from-literal=token=$OSMO_SERVICE_TOKEN


Step 3: Deploy Backend Operator
-------------------------------

Deploy the backend operator to the backend kubernetes cluster.

Prepare the ``backend_operator_values.yaml`` file:

.. dropdown:: ``backend_operator_values.yaml``
  :color: info
  :icon: file

  .. code-block:: yaml

    global:
      osmoImageTag: <insert-osmo-image-tag> # insert osmo image tag here
      imagePullSecret: imagepullsecret
      serviceUrl: https://<your-domain>
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

Deploy the backend operator:

.. code-block:: bash

   $ helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo

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

  $ export BACKEND_NAME=default # update to reflect the name of your backend specified in the backend_operator_values.yaml file
  $ osmo config update BACKEND $BACKEND_NAME --file /tmp/scheduler_settings.json


Step 5: Validate
--------------------------

Use the OSMO CLI to validate the backend configuration.

.. code-block:: bash
  :substitutions:

  $ export BACKEND_NAME=default # update to reflect the name of your backend specified in the backend_operator_values.yaml file
  $ osmo config show BACKEND $BACKEND_NAME | grep "online"
    "online": true,


Next Steps
----------
You can now start submitting workflows to the backend to test the deployment. Refer to :ref:`validate_osmo` for more information on how to submit workflows.
If you want to configure complex pool configurations, you can do so by following the steps in :ref:`configure_pool`.
