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

======================
Deploy Compute Backend
======================

Install the unified ``osmo`` Helm chart with its compute-only profile to
connect a Kubernetes cluster to an existing OSMO control plane. The release
contains the backend listener and worker but no control-plane services or
databases.

Prerequisites
-------------

Before continuing:

* Deploy an OSMO control plane.
* Install ``kubectl``, Helm, ``jq``, and OpenSSL.
* Install :ref:`KAI Scheduler <installing_kai>` in the compute cluster.
* Make the control-plane URL reachable from the compute cluster.
* Provide enough CPU, memory, and storage for the compute-plane Pods and the
  workflows you intend to run. GPU workloads also require GPU nodes and the
  NVIDIA GPU Operator.

The examples use one context for each cluster and keep workflow Pods in a
separate namespace:

.. code-block:: bash

   $ export CONTROL_CONTEXT=<control-context>
   $ export CONTROL_NAMESPACE=osmo
   $ export COMPUTE_CONTEXT=<compute-context>
   $ export COMPUTE_NAMESPACE=osmo-compute
   $ export WORKLOAD_NAMESPACE=osmo-workflows

This guide uses ``gb200-01`` as the backend name. Use the same backend name and
workload namespace in every step.

Configure the control plane
---------------------------

The control plane must define the backend before the compute plane connects.
Its ``k8s_namespace`` must exactly match the compute chart's workload
namespace, at least one pool must reference the backend, and workflow Pods
must be able to reach ``configuration.service.service_base_url``. Merge the
following into the complete values used to manage your control-plane release:

.. code-block:: yaml

   configuration:
     service:
       service_base_url: https://osmo.example.com
     backends:
       gb200-01:
         k8s_namespace: osmo-workflows
     pools:
       default:
         backend: gb200-01

.. _provision_backend_secret:

Provision the backend credential
--------------------------------

Generate a backend credential into a protected temporary file and create its
Secret in the control-plane namespace. The commands do not print the token:

.. code-block:: bash

   $ set -o pipefail
   $ TOKEN_FILE=$(mktemp)
   $ chmod 600 "$TOKEN_FILE"
   $ if openssl rand -base64 32 | tr -d '\n=' | tr '/+' '_-' > "$TOKEN_FILE" &&
       [ -s "$TOKEN_FILE" ]; then
       kubectl --context "$CONTROL_CONTEXT" --namespace "$CONTROL_NAMESPACE" \
         create secret generic osmo-gb200-01-backend-token \
         --from-file=token="$TOKEN_FILE"
     else
       echo "Failed to generate backend token" >&2
     fi
   $ rm -f -- "$TOKEN_FILE"

For production, provision the same Secret through your approved secret
manager. As a best practice, use a different token for each backend so that
each credential can be rotated or revoked independently. Then add a bootstrap
identity that references the user-managed Secret to the control-plane values:

.. code-block:: yaml

   authentication:
     bootstrap:
       identities:
         backend-operator-gb200-01:
           enabled: true
           username: backend-operator-gb200-01
           roles:
           - osmo-backend
           tokens:
             primary:
               existingSecret:
                 name: osmo-gb200-01-backend-token
                 key: token

Apply the updated control-plane release before installing the compute plane.
Keep all existing control-plane values in that Helm upgrade.

Copy the Secret to the compute release namespace without decoding or printing
it:

.. code-block:: bash

   $ kubectl --context "$COMPUTE_CONTEXT" create namespace "$COMPUTE_NAMESPACE" \
       --dry-run=client -o yaml | kubectl --context "$COMPUTE_CONTEXT" apply -f -
   $ kubectl --context "$CONTROL_CONTEXT" --namespace "$CONTROL_NAMESPACE" \
       get secret osmo-gb200-01-backend-token -o json \
     | jq --arg namespace "$COMPUTE_NAMESPACE" \
         '.metadata = {"name":"osmo-gb200-01-backend-token","namespace":$namespace}' \
     | kubectl --context "$COMPUTE_CONTEXT" apply --server-side -f -

Prepare compute-plane values
----------------------------

Create ``osmo-compute-values.yaml``. Replace ``osmo.example.com`` with the
control-plane URL that compute-cluster Pods can reach:

.. code-block:: yaml

   externalUrl: https://osmo.example.com

   compute:
     backendName: gb200-01
     workloadNamespace:
       name: osmo-workflows
       create: true
     authentication:
       existingSecret: osmo-gb200-01-backend-token
       tokenKey: token

If you manage the workload namespace separately, create it before deployment
and set ``create: false``.

.. note::

   Group templates that create ConfigMaps, custom resources, or other
   Kubernetes objects need corresponding permissions under
   ``services.backendWorker.extraRBACRules``. See
   :ref:`group_template_permissions`.

Deploy the compute plane
------------------------

Pull the chart so the compute profile always matches the selected chart
version, then install it:

.. code-block:: bash

   $ export OSMO_CHART_VERSION=<chart-version>
   $ helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo
   $ helm repo update osmo
   $ helm pull osmo/osmo --version "$OSMO_CHART_VERSION" \
       --untar
   $ helm --kube-context "$COMPUTE_CONTEXT" upgrade --install osmo-compute \
       ./osmo \
       --namespace "$COMPUTE_NAMESPACE" \
       --values osmo/profiles/split-plane-compute.yaml \
       --values osmo-compute-values.yaml \
       --wait --timeout 10m

.. _configure_pool:

Verify the backend
------------------

Confirm that the backend listener and worker Deployments are available:

.. code-block:: bash

   $ kubectl --context "$COMPUTE_CONTEXT" --namespace "$COMPUTE_NAMESPACE" \
       rollout status deployment \
       --selector app.kubernetes.io/instance=osmo-compute \
       --timeout 10m
   $ kubectl --context "$COMPUTE_CONTEXT" --namespace "$COMPUTE_NAMESPACE" \
       get deployments,pods \
       --selector app.kubernetes.io/instance=osmo-compute

An authenticated OSMO CLI is not required to deploy the backend. Optionally,
use it to confirm that the backend and pool are online and submit a small CPU
workflow for end-to-end verification:

.. code-block:: bash

   $ osmo config show BACKEND gb200-01
   $ osmo pool list
   $ osmo resource list --pool default
   $ osmo workflow submit cookbook/tutorials/hello_world.yaml --pool default

Rotate the backend credential
-----------------------------

Use an overlap window so the control and compute planes can change credentials
without losing registration:

1. Update the control-plane Secret so ``token`` contains the new value and
   ``previous-token`` contains the old value.
2. Wait for every API replica to accept both credentials.
3. Replace ``token`` in the compute-plane Secret with the new value.
4. Restart the backend-listener and backend-worker Deployments and verify that
   they reconnect.
5. Remove ``previous-token`` from the control-plane Secret.
6. Verify that the old credential is rejected by every API replica.

Troubleshooting
---------------

Unknown backend
~~~~~~~~~~~~~~~

If the backend listener reports that the backend is not configured, add the
exact value of ``compute.backendName`` under ``configuration.backends`` in the
control-plane values and apply the control-plane release.

Namespace mismatch
~~~~~~~~~~~~~~~~~~

If registration reports a namespace mismatch, make
``configuration.backends.<backend-name>.k8s_namespace`` identical to
``compute.workloadNamespace.name`` and apply the control-plane release.

Backend authentication error
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Verify that both Secrets contain identical token data without printing the
decoded credential:

.. code-block:: bash

   $ CONTROL_TOKEN=$(kubectl --context "$CONTROL_CONTEXT" \
       --namespace "$CONTROL_NAMESPACE" \
       get secret osmo-gb200-01-backend-token -o jsonpath='{.data.token}')
   $ if [ -n "$CONTROL_TOKEN" ]; then
       printf '%s' "$CONTROL_TOKEN" | sha256sum
     else
       echo "Control-plane Secret has no token data" >&2
     fi
   $ unset CONTROL_TOKEN
   $ COMPUTE_TOKEN=$(kubectl --context "$COMPUTE_CONTEXT" \
       --namespace "$COMPUTE_NAMESPACE" \
       get secret osmo-gb200-01-backend-token -o jsonpath='{.data.token}')
   $ if [ -n "$COMPUTE_TOKEN" ]; then
       printf '%s' "$COMPUTE_TOKEN" | sha256sum
     else
       echo "Compute-plane Secret has no token data" >&2
     fi
   $ unset COMPUTE_TOKEN

If the hashes differ, repeat the Secret-copy step and restart the backend
listener and worker.

Connection errors
~~~~~~~~~~~~~~~~~

From a compute-cluster Pod, verify DNS, TLS trust, firewall rules, and access
to ``externalUrl``. The listener requires a persistent WebSocket connection to
the OSMO gateway.

Workflow remains pending or validation rejects its resources
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Check ``osmo resource list --pool <pool>`` and the workflow events. Account for
the CPU and memory requested by OSMO sidecars as well as the user container.
Confirm that KAI Scheduler is running and that the cluster has a node with
enough available capacity for the complete workflow Pod.

.. seealso::

   See :ref:`backend_config` for backend configuration options and
   :ref:`advanced_pool_configuration` for additional pools and platforms.
