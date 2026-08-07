..
  SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

Deploying the backend operator will register your compute backend with OSMO, making its resources available for running workflows. Follow these steps to deploy and connect your backend to OSMO.

.. admonition:: Prerequisites
  :class: important

  - Install :ref:`OSMO CLI <cli_install>` before you begin
  - Replace ``osmo.example.com`` with your domain name in the commands below

.. _provision_backend_secret:

Step 1: Provision Backend Bootstrap Secret
-------------------------------------------

Provision the backend bootstrap credential as a Kubernetes Secret. This flow
does not log in to OSMO or call the user or access-token APIs.

Generate a 43-character credential into a protected temporary file and create
the control-plane Secret:

.. code-block:: bash

   $ TOKEN_FILE=$(mktemp)
   $ chmod 600 "$TOKEN_FILE"
   $ openssl rand -base64 32 | tr -d '\n=' | tr '/+' '_-' > "$TOKEN_FILE"
   $ kubectl --context <control-context> create secret generic osmo-backend-token-default \
       --namespace <control-namespace> \
       --from-file=token="$TOKEN_FILE"
   $ rm -f "$TOKEN_FILE"

Configure the control-plane service chart to consume the Secret:

.. code-block:: yaml

   services:
     backendApiTokens:
       enabled: true
       credentials:
       - name: default
         existingSecret:
           name: osmo-backend-token-default

.. note::

  For production, materialize the Secret through your approved external-secret
  integration instead of generating it on an administrator workstation.

For single-cluster development, the service chart can generate the Secret on
the initial install:

.. code-block:: yaml

   services:
     backendApiTokens:
       enabled: true
       credentials:
       - name: default
         managedSecret:
           name: osmo-backend-token-default

The backend operator can consume that Secret directly when it runs in the same
namespace. A pre-install kubectl hook generates the credential inside Kubernetes; the
token is not included in Helm output or release state. A pre-upgrade hook
preserves and validates it, and fails rather than replacing a missing Secret.
The Secret persists independently of Helm uninstall and rollback. This mode
does not synchronize the token to another cluster, so use ``existingSecret``
with an external secret manager for production and multi-cluster deployments.
Managed credentials must be configured during the initial install. Add later
credentials by provisioning them explicitly and using ``existingSecret``.
Chart-bootstrap Secrets persist after Helm uninstall; delete them explicitly
when they are no longer needed.

.. tip::

  The service always maps this credential to the ``osmo-backend`` role. The
  role cannot be changed through Helm values or Secret data.

.. seealso::

  Personal access tokens and other service-account tokens continue to use the
  OSMO token APIs. This Secret contract is specific to backend bootstrap.


Step 2: Create K8s Namespaces and Secrets
------------------------------------------------

Create Kubernetes namespaces and secrets necessary for the backend deployment.

.. code-block:: bash
  :substitutions:

    # Create namespaces for osmo operator and osmo workflows
    $ kubectl --context <compute-context> create namespace osmo-operator
    $ kubectl --context <compute-context> create namespace osmo-workflows

    # Stream the bootstrap Secret to the compute cluster without printing it.
    $ kubectl --context <control-context> get secret osmo-backend-token-default \
        --namespace <control-namespace> -o json \
      | jq '.metadata = {"name":"osmo-backend-token-default","namespace":"osmo-operator"}' \
      | kubectl --context <compute-context> apply --server-side -f -


Step 3: Deploy Backend Operator
-------------------------------

Deploy the backend operator to the backend kubernetes cluster.

Prepare the ``backend_operator_values.yaml`` file:

.. dropdown:: ``backend_operator_values.yaml``
  :color: info
  :icon: file

  .. code-block:: yaml
    :emphasize-lines: 2, 6

    global:
      osmoImageTag: <insert-osmo-image-tag>  # REQUIRED: Update with OSMO image tag
      serviceUrl: https://osmo.example.com
      agentNamespace: osmo-operator
      backendNamespace: osmo-workflows
      backendName: default  # REQUIRED: Update with your backend name
      accountTokenSecret: osmo-backend-token-default
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

.. note::

   If you plan to use group templates that create ConfigMaps, CRDs, or other Kubernetes objects,
   you must grant the backend worker permission for those resource kinds via
   ``services.backendWorker.extraRBACRules``. See :ref:`group_template_permissions` for details and examples.

Deploy the backend operator:

.. code-block:: bash

   $ helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo

   $ helm repo update

   $ helm upgrade --install osmo-operator osmo/backend-operator \
     -f ./backend_operator_values.yaml \
     --version <insert-chart-version> \
     --namespace osmo-operator \
     --kube-context <compute-context>

Step 4: Validate Deployment
----------------------------

Use the OSMO CLI to validate the backend configuration

.. code-block:: bash
  :substitutions:

  $ export BACKEND_NAME=default  # Update with your backend name

  $ osmo config show BACKEND $BACKEND_NAME

Alternatively, visit http://osmo.example.com/api/configs/backend in your browser.

Ensure the backend is online (see the highlighted line in the JSON output):

.. code-block:: json
  :emphasize-lines: 25

  {
    "backends": [
        {
            "name": "default",
            "description": "Default backend",
            "version": "6.0.0",
            "k8s_uid": "6bae3562-6d32-4ff1-9317-09dd973c17a2",
            "k8s_namespace": "osmo-workflows",
            "dashboard_url": "",
            "grafana_url": "",
            "tests": [],
            "scheduler_settings": {
                "scheduler_type": "kai",
                "scheduler_name": "kai-scheduler",
                "scheduler_timeout": 30
            },
            "node_conditions": {
                "rules": null,
                "prefix": "osmo.example.com/"
            },
            "last_heartbeat": "2025-11-15T02:35:17.957569",
            "created_date": "2025-09-03T19:48:21.969688",
            "router_address": "wss://osmo.example.com",
            "online": true
        }
    ]
  }

.. seealso::

  See :ref:`backend_config` for more information

.. _configure_pool:

Step 5: Default Pool Is Ready
------------------------------

The Helm chart ships with a default pool wired to a backend named ``default``. If your backend is named ``default`` (as used throughout this guide), the default pool will automatically link to it as soon as the backend shows as online in the previous step — no additional configuration is needed.

Verify:

.. code-block:: bash

  $ osmo pool list
  Pool      Description    Status    GPU [#]
                                   Quota Used   Quota Limit   Total Usage   Total Capacity
  =============================================================================================
  default   Default pool   ONLINE    N/A          N/A           0             24
  =============================================================================================
                                                                0             24

If the pool shows ``OFFLINE``, wait a few seconds for the backend heartbeat or re-check Step 4.

If you chose a different backend name, update the default pool in ``osmo_values.yaml`` to point at it:

.. code-block:: yaml

  services:
    configs:
      pools:
        default:
          backend: <your-backend-name>

Re-apply with ``helm upgrade``. To add additional pools or platforms, see :ref:`advanced_pool_configuration`.


Rotate the Backend Bootstrap Secret
-----------------------------------

Use an overlap window so every API replica and backend operator can move to the
new credential without losing registration:

1. Update the control-plane Secret so ``token`` contains the new value and
   ``previous-token`` contains the old value.
2. Wait for every API replica to accept both credentials.
3. Replace ``token`` in the compute-plane Secret with the new value.
4. Restart both the backend-listener and backend-worker Deployments and verify
   that they reconnect.
5. Remove ``previous-token`` from the control-plane Secret.
6. Verify the old credential is rejected by every API replica.

Kubernetes updates projected Secret directories automatically. Explicitly
restart the backend Deployments because an established WebSocket may otherwise
continue running without rereading the credential file.

Troubleshooting
---------------

Backend Authentication Error
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Verify that the control- and compute-plane Secrets have identical ``token``
data without printing the decoded credential:

.. code-block:: bash

   $ kubectl --context <control-context> get secret osmo-backend-token-default \
       -n <control-namespace> -o jsonpath='{.data.token}' | sha256sum
   $ kubectl --context <compute-context> get secret osmo-backend-token-default \
       -n osmo-operator -o jsonpath='{.data.token}' | sha256sum

If the hashes differ, repeat the Secret-transfer step and restart the backend
listener and worker.
