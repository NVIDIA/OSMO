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

.. _deploy_local:

================
Local Deployment
================

Install OSMO on an existing local Kubernetes cluster with the same umbrella
Helm chart used for cloud and on-premises clusters. The development
``single-node`` profile includes PostgreSQL, Redis, LocalStack S3, generated
Kubernetes Secrets, the OSMO control plane, and one compute backend.

.. warning::

   The single-node profile is for development and evaluation. It disables
   production authentication and uses generated credentials and embedded data
   services.

Prerequisites
=============

Install:

* `Docker <https://docs.docker.com/get-started/get-docker/>`_
* `KIND <https://kind.sigs.k8s.io/docs/user/quick-start/#installation>`_
* `kubectl <https://kubernetes.io/docs/tasks/tools/>`_
* `Helm <https://helm.sh/docs/intro/install/>`_
* Git

Step 1: Create a Local Cluster
==============================

Create a small CPU cluster with one schedulable worker:

.. code-block:: bash

   $ kind create cluster --name osmo --config=-
   kind: Cluster
   apiVersion: kind.x-k8s.io/v1alpha4
   nodes:
     - role: control-plane
     - role: worker

For GPU evaluation, create a GPU-capable cluster with
`nvkind <https://github.com/NVIDIA/nvkind>`_ and install NVIDIA GPU Operator.
Confirm that the compute node reports allocatable ``nvidia.com/gpu`` before
submitting GPU workflows. OSMO does not install or configure GPU drivers.

KAI Scheduler is optional. The local profile uses the standard Kubernetes
scheduler and requires no scheduler CRDs.

Step 2: Install OSMO
====================

Clone OSMO, build the local chart dependencies, render the profile, and install
one Helm release:

.. code-block:: bash

   $ git clone https://github.com/NVIDIA/OSMO.git
   $ cd OSMO
   $ helm dependency build --skip-refresh deployments/charts/osmo
   $ helm lint deployments/charts/osmo \
       --values deployments/charts/osmo/profiles/single-node.yaml
   $ helm template osmo deployments/charts/osmo \
       --namespace osmo-system \
       --values deployments/charts/osmo/profiles/single-node.yaml \
       > /tmp/osmo-rendered.yaml
   $ helm upgrade --install osmo deployments/charts/osmo \
       --namespace osmo-system \
       --create-namespace \
       --values deployments/charts/osmo/profiles/single-node.yaml \
       --wait \
       --rollback-on-failure \
       --timeout 15m

The chart performs preflight and postflight checks during installation.
Re-run the retained checks at any time:

.. code-block:: bash

   $ helm test osmo --namespace osmo-system --logs

Step 3: Configure Local Access
==============================

Forward the gateway and LocalStack services in separate terminals:

.. code-block:: bash

   $ kubectl --namespace osmo-system port-forward service/osmo-gateway 8080:80
   $ kubectl --namespace osmo-system port-forward service/localstack-s3 4566:4566

OSMO is now available at ``http://localhost:8080``.

Step 4: Install and Configure the CLI
=====================================

.. code-block:: bash

   $ curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh | bash
   $ osmo login http://localhost:8080 --method=dev --username=testuser
   $ osmo profile set pool default
   $ osmo credential set osmo --type DATA --payload \
       access_key_id=test \
       access_key=test \
       endpoint=s3://osmo \
       override_url=http://localhost:4566 \
       addressing_style=path \
       region=us-east-1

Step 5: Run a Workflow
======================

Submit the reusable CPU smoke workflow:

.. code-block:: bash

   $ osmo workflow submit deployments/workflows/verify-hello.yaml --pool default

Use ``osmo workflow query`` and ``osmo workflow logs`` to confirm that it
reaches ``COMPLETED`` and prints ``Hello from OSMO``.

Cleanup
=======

Delete the KIND cluster and all embedded data:

.. code-block:: bash

   $ kind delete cluster --name osmo

Troubleshooting
===============

Check the release and pods:

.. code-block:: bash

   $ helm status osmo --namespace osmo-system
   $ kubectl get pods --all-namespaces
   $ helm test osmo --namespace osmo-system --logs

Preflight failures identify missing Kubernetes APIs, RBAC, storage, Secrets, or
optional scheduler CRDs. Correct the prerequisite instead of disabling the
checks.
