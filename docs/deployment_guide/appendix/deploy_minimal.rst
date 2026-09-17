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

.. _deploy_minimal:

==================
Minimal Deployment
==================

Deploy the unified ``osmo`` chart on an existing development Kubernetes cluster.
The chart defaults install the control plane, backend operator, embedded
PostgreSQL, Valkey, RustFS, and authenticated browser and CLI access through
embedded Dex. A bootstrap operation creates the managed credentials; no manual
MEK, service-auth, administrator, or backend-token Secret creation is required.

For a local KIND cluster, follow :ref:`quickstart`. For production, use
:ref:`deploy_self_contained` or the unified chart's external-dependency profiles.
Embedded Dex uses memory-only sessions and signing keys and is intended for
development and evaluation.

.. _deploy_minimal_prerequisites:

Prerequisites
=============

Run from an OSMO repository clone with kubectl pointing to the target cluster.
Use Kubernetes 1.30 or newer, Helm 3.19 or newer, a default dynamic
``StorageClass``, KAI Scheduler, and the CloudNativePG operator. GPU workflows
additionally require GPU-capable nodes and the NVIDIA GPU Operator.

Install any missing operators before installing OSMO. These commands use the
cluster's normal scheduling policy and do not require the node labels used by
the KIND Quickstart:

.. code-block:: bash

   helm upgrade --install kai-scheduler \
     https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.14.0/kai-scheduler-v0.14.0.tgz \
     --namespace kai-scheduler \
     --create-namespace \
     --wait --timeout 10m

   helm repo add cnpg https://cloudnative-pg.github.io/charts
   helm repo update cnpg
   helm upgrade --install cnpg cnpg/cloudnative-pg \
     --version 0.29.0 \
     --namespace cnpg-system \
     --create-namespace \
     --wait --timeout 10m

Install OSMO
============

Choose the URL that the browser and CLI will use. This example uses a local
port-forward. The chart creates the release and workflow namespaces and wires
the backend to its managed token Secret in the release namespace.

Use a unique, non-secret initialization ID for this fresh installation.

.. code-block:: bash

   helm dependency build deployments/charts/osmo
   helm upgrade --install osmo deployments/charts/osmo \
     --set-string bootstrap.initializationId=my-new-osmo-installation \
     --namespace osmo \
     --create-namespace \
     --set-string externalUrl=http://127.0.0.1:9000 \
     --wait --wait-for-jobs --timeout 140m

After successful installation, complete
:ref:`deployment_secrets_cleanup` to disable the install-only MEK and
service-auth creation steps while preserving the generated credentials.

.. note::

   The ``single-plane.yaml`` profile is an alternative for externally managed
   PostgreSQL, Valkey, and object storage. It also expects existing backend,
   MEK, and service-auth Secrets. Do not apply that profile to this example
   without supplying its external dependencies and credential references; see
   :ref:`deployment_secrets`.

Validate and sign in
====================

Check workload and bootstrap status, then keep the port-forward running:

.. code-block:: bash

   kubectl --namespace osmo get pods,jobs,pvc
   kubectl --namespace osmo port-forward service/osmo-gateway 9000:80

In another private terminal, retrieve the generated administrator password:

.. code-block:: bash

   kubectl --namespace osmo get secret osmo-embedded-dex-admin \
     --output jsonpath='{.data.password}' | base64 --decode
   printf '\n'

Open http://127.0.0.1:9000 and sign in as ``admin@osmo.local``. Install the
:ref:`OSMO CLI <cli_install>` and validate a workflow:

.. code-block:: bash

   osmo login http://127.0.0.1:9000
   osmo profile set pool default
   osmo workflow submit deployments/workflows/verify-hello.yaml
   osmo workflow query <workflow-id>

Wait for ``COMPLETED``. For failures, inspect workload logs and Kubernetes
events; see :ref:`validate_osmo` and :ref:`deployment_secrets`.

Cleanup
=======

Uninstall workloads when finished:

.. code-block:: bash

   helm uninstall osmo --namespace osmo --wait
   kubectl --namespace osmo get pvc,secrets

Secrets, data volumes, and the workflow namespace may be retained. Delete the
``osmo`` and ``osmo-workflows`` namespaces only for a disposable installation
whose credentials and data are no longer needed.
