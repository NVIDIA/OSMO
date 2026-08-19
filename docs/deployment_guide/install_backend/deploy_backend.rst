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

  - Install ``kubectl`` and Helm
  - Replace ``osmo.example.com`` with your domain name in the commands below

.. _provision_backend_secret:

Step 1: Provision Backend Bootstrap Secret
-------------------------------------------

Provision the backend bootstrap credential as a Kubernetes Secret before
installing the chart. Start with a protected file containing a 43- or
64-character URL-safe token. If your secret-management integration already
materializes the Secret, skip the ``kubectl create`` command.

.. code-block:: bash

   $ kubectl --context <control-context> create secret generic \
       osmo-backend-token-default \
       --namespace <control-namespace> \
       --from-file=token=/secure/path/backend-token

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

  For production and multi-cluster deployments, materialize synchronized
  copies through your approved external-secret integration. The Helm chart is
  a consumer and never creates or modifies credential data.

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

    # Create the compute-plane copy from the same protected token file.
    # Skip this when your secret-management integration creates it.
    $ kubectl --context <compute-context> create secret generic \
        osmo-backend-token-default \
        --namespace osmo-operator \
        --from-file=token=/secure/path/backend-token


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
     --kube-context <compute-context> \
     --wait

Step 4: Validate Deployment
----------------------------

Use ``kubectl`` to verify that both operator Deployments rolled out and the
pods are ready:

.. code-block:: bash
  :substitutions:

  $ kubectl --context <compute-context> --namespace osmo-operator \
      rollout status deployment/osmo-operator-osmo-backend-listener
  $ kubectl --context <compute-context> --namespace osmo-operator \
      rollout status deployment/osmo-operator-osmo-backend-worker
  $ kubectl --context <compute-context> --namespace osmo-operator get pods

Then visit ``https://osmo.example.com/api/configs/backend`` in your browser.

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

Verify in the OSMO UI that the ``default`` pool is online.

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
data without printing the decoded credential. Capture each value only after a
successful, nonempty ``kubectl`` read so connection or authorization failures
cannot produce matching hashes of empty input:

.. code-block:: bash

   $ CONTROL_TOKEN_B64=$(kubectl --context <control-context> get secret \
       osmo-backend-token-default -n <control-namespace> \
       -o jsonpath='{.data.token}') || exit 1
   $ test -n "$CONTROL_TOKEN_B64" || { echo 'Control-plane token is empty.' >&2; exit 1; }
   $ COMPUTE_TOKEN_B64=$(kubectl --context <compute-context> get secret \
       osmo-backend-token-default -n osmo-operator \
       -o jsonpath='{.data.token}') || exit 1
   $ test -n "$COMPUTE_TOKEN_B64" || { echo 'Compute-plane token is empty.' >&2; exit 1; }
   $ CONTROL_TOKEN_SHA256=$(printf %s "$CONTROL_TOKEN_B64" | sha256sum | awk '{print $1}')
   $ COMPUTE_TOKEN_SHA256=$(printf %s "$COMPUTE_TOKEN_B64" | sha256sum | awk '{print $1}')
   $ printf 'control: %s\ncompute: %s\n' \
       "$CONTROL_TOKEN_SHA256" "$COMPUTE_TOKEN_SHA256"
   $ unset CONTROL_TOKEN_B64 COMPUTE_TOKEN_B64 CONTROL_TOKEN_SHA256 COMPUTE_TOKEN_SHA256

If the hashes differ, update both Secret objects from the same source and
restart the backend listener and worker.
