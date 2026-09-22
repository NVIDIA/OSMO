..
  SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

.. _deploy_self_contained:

===========================
Self-contained Deployment
===========================

A self-contained deployment runs the OSMO control plane, compute plane, and
stateful dependencies in one Kubernetes cluster. It is intended for edge
sites, labs, and evaluation environments that must keep the complete OSMO
stack together while retaining data and service availability across Pod or
node failures.

Choose this deployment model when you need more durability and availability
than the :ref:`Quickstart <quickstart>` can provide and the independently
managed dependencies of a single-plane or split-plane deployment are not
appropriate. The ``self-contained.yaml`` profile installs the control and
compute planes together and provides multiple replicas for critical OSMO
services, a synchronously replicated PostgreSQL cluster, persistent Valkey
replicas, distributed RustFS with erasure coding, PodDisruptionBudgets,
topology rules, OIDC authentication, authorization, internal TLS, and network
isolation.

.. important::

   A highly available deployment still requires highly available nodes,
   networking, and persistent storage. The Kubernetes cluster, storage system,
   network, and site remain shared failure domains. Replication does not replace
   tested backups and recovery procedures.

.. _self_contained_prerequisites:

Prerequisites
=============

Run the commands in this guide from the root of an OSMO repository clone. Set
your current kubectl context to the Kubernetes cluster where you want to
install OSMO before continuing.

The cluster must provide:

* Kubernetes 1.30 or newer;
* at least four nodes labeled
  ``osmo.nvidia.com/node-pool=control-plane``, with enough failure-domain
  and aggregate CPU capacity for three PostgreSQL Pods, three Valkey Pods,
  four RustFS Pods, and the OSMO services;
* at least one node labeled ``osmo.nvidia.com/node-pool=compute`` for workflow
  Pods;
* a default dynamic ``StorageClass`` backed by durable storage;
* a CNI that enforces Kubernetes ``NetworkPolicy`` resources;
* the IPv4 Pod and Service CIDRs used by the cluster network;
* network access to the OSMO and dependency image registries; and
* DNS and time synchronization across the nodes.

Install ``kubectl``, Helm, Docker, and the OSMO CLI. Confirm cluster access,
node capacity, and the default ``StorageClass``:

.. code-block:: bash

   kubectl version
   kubectl get nodes
   kubectl get storageclass

Label the nodes that will host the OSMO platform and the nodes that will run
workflows. The ``control-plane`` value identifies OSMO platform nodes; these do
not need to be Kubernetes control-plane nodes.

.. code-block:: bash

   kubectl label node \
     <platform-node-1> <platform-node-2> \
     <platform-node-3> <platform-node-4> \
     osmo.nvidia.com/node-pool=control-plane
   kubectl label node <compute-node-1> \
     osmo.nvidia.com/node-pool=compute
   kubectl get nodes --label-columns=osmo.nvidia.com/node-pool

The profile creates three 20 GiB PostgreSQL volumes and four 100 GiB RustFS
volumes in addition to persistent Valkey storage. Account for storage-provider
overhead, backups, and the resources requested by concurrent workflows.

Identity, Secrets, and edge requirements
----------------------------------------

For a simple test or evaluation, keep the chart defaults. The chart bootstraps
retained Kubernetes Secrets and an embedded Dex identity with a generated
administrator password. Embedded Dex uses volatile memory storage and is not
suitable for production. Production deployments must follow the canonical
:ref:`external IdP guidance <deploy_service_external_idp>`.

If you manage the master encryption key, service authentication, or dependency
credentials yourself, configure them before installation as described in the
canonical :ref:`Secret ownership guidance <deploy_service_secret_ownership>`.

The profile creates a ``ClusterIP`` gateway. For local evaluation, use the
port-forward described later. For production, configure an operator-managed
edge to terminate public TLS and route the public URL to the ``osmo-gateway``
Service on port 80. Validate the edge and the CNI's NetworkPolicy enforcement
before exposing OSMO to users.

Install Cluster Dependencies
============================

Install KAI Scheduler v0.15.3 using the checked common values file first and
the shared converged-cluster placement file second, as in :ref:`the compute
deployment guide <installing_kai>`:

.. code-block:: bash

   helm upgrade --install kai-scheduler \
     https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.15.3/kai-scheduler-v0.15.3.tgz \
     --namespace kai-scheduler \
     --create-namespace \
     --values deployments/charts/osmo/examples/kai-values.yaml \
     --values deployments/charts/osmo/examples/kai-selectors.yaml \
     --wait \
     --timeout 10m
   kubectl --namespace kai-scheduler wait \
     --for=condition=Available=True \
     --timeout=10m config.kai.scheduler/kai-config
   kubectl wait --for=condition=Available \
     --timeout=10m schedulingshard/default
   kubectl --namespace kai-scheduler wait \
     --for=condition=Available \
     --timeout=10m deployment --all

Install CloudNativePG chart 0.29.0. The operator manages the PostgreSQL cluster
created by the OSMO release:

.. code-block:: bash

   helm repo add cnpg https://cloudnative-pg.github.io/charts
   helm repo update cnpg
   helm upgrade --install cnpg cnpg/cloudnative-pg \
     --version 0.29.0 \
     --namespace cnpg-system \
     --create-namespace \
     --set-string 'nodeSelector.osmo\.nvidia\.com/node-pool=control-plane' \
     --wait \
     --timeout 10m

Prepare Values and Secrets
==========================

Copy the YAML displayed below into a file named
``self-contained-environment-values.yaml``:

.. literalinclude:: ../../../deployments/charts/osmo/examples/self-contained-environment-values.yaml
   :language: yaml

Review the environment settings in that file:

* Keep ``externalUrl: http://127.0.0.1:8080`` for the local evaluation path, or
  replace it with the public HTTPS URL for an operator-managed edge.
* Replace ``compute.workflowNetworkPolicy.clusterCIDRs`` with every IPv4 Pod
  and Service CIDR used by the cluster. Omit duplicate entries when both
  networks are covered by one CIDR.

The checked ``node-selectors.yaml`` overlay places OSMO services, bootstrap
Jobs, embedded Dex, PostgreSQL, Valkey, and RustFS on platform nodes. It places
the built-in workflow Pod templates on compute nodes. If your cluster uses
different labels, copy and update that file consistently. Apply the same
compute-node selector to additional workflow Pod templates.

Configure an External IdP
=========================

Embedded Dex is suitable only for evaluation. Before a production install,
follow the canonical :ref:`external IdP guidance
<deploy_service_external_idp>`. Add its ``embeddedDependencies.dex`` and
``authentication`` blocks to ``self-contained-environment-values.yaml`` and
create the referenced OIDC Secret before installing OSMO.

Install OSMO
============

Register the HTTP chart repositories and build the local unified chart's
pinned dependencies from ``Chart.lock`` before installing OSMO.

The command below uses Helm 4's ``--wait=legacy`` strategy because its default
watcher can leave the release ``pending-install`` after operator-managed custom
resources report Ready. With Helm 3, replace ``--wait=legacy`` with ``--wait``.

.. code-block:: bash

   kubectl create namespace osmo
   helm repo add osmo-dex https://charts.dexidp.io
   helm repo add cnpg https://cloudnative-pg.github.io/charts
   helm repo add osmo-rustfs https://charts.rustfs.com
   helm dependency build deployments/charts/osmo
   helm upgrade --install osmo deployments/charts/osmo \
     --namespace osmo \
     --values deployments/charts/osmo/profiles/self-contained.yaml \
     --values deployments/charts/osmo/examples/node-selectors.yaml \
     --values self-contained-environment-values.yaml \
     --wait=legacy \
     --wait-for-jobs \
     --timeout 30m

The chart uses its application version for OSMO images and the cluster's
default ``StorageClass``. The self-contained profile enables the service-auth
step in the shared bootstrap Job, which creates the service identity during
installation.
The chart also creates the local database, cache, object storage, required
buckets, workflow namespace, configuration, backend bootstrap credential, and
retained master encryption key.

Log In
======

For the local evaluation path, start a port-forward in a separate terminal:

.. code-block:: bash

   kubectl --namespace osmo port-forward service/osmo-gateway 8080:80

To validate with the OSMO CLI, read the bootstrapped ``admin`` token into a
protected temporary file:

.. code-block:: bash

   OSMO_URL=http://127.0.0.1:8080
   set -o pipefail
   umask 077
   OSMO_TOKEN_FILE="$(mktemp)" &&
   kubectl --namespace osmo get secret osmo-admin-token \
     --output jsonpath='{.data.token}' \
     | base64 --decode > "$OSMO_TOKEN_FILE" &&
   osmo login "$OSMO_URL" --method token --token-file "$OSMO_TOKEN_FILE"
   OSMO_LOGIN_STATUS=$?
   rm -f -- "${OSMO_TOKEN_FILE:-}" || OSMO_LOGIN_STATUS=$?
   unset OSMO_TOKEN_FILE
   test "$OSMO_LOGIN_STATUS" -eq 0

To use the browser UI, retrieve the embedded-Dex password:

.. code-block:: bash

   kubectl --namespace osmo get secret osmo-embedded-dex-admin \
     --output jsonpath='{.data.password}' | base64 --decode
   printf '\n'

Visit ``$OSMO_URL`` and sign in as ``admin@osmo.local`` with that
password. Embedded Dex is for testing and evaluation; use the configured
external IdP and public HTTPS URL in production.

Verify the Deployment
=====================

Confirm that the release, OSMO Deployments, stateful dependencies, PostgreSQL,
KAI, and the API are ready. Then submit both CPU verification workflows:

.. code-block:: bash

   # Verify the Helm release and Kubernetes workloads
   helm status osmo --namespace osmo
   kubectl --namespace osmo wait --for=condition=Available \
     deployment --all --timeout=10m
   kubectl --namespace osmo rollout status \
     statefulset/osmo-valkey --timeout=10m
   kubectl --namespace osmo rollout status \
     statefulset/osmo-rustfs --timeout=10m
   kubectl --namespace osmo wait --for=condition=Ready \
     cluster/osmo-pg --timeout=10m
   kubectl --namespace kai-scheduler wait --for=condition=Available \
     deployment --all --timeout=10m
   kubectl --namespace osmo get pods,services,pvc,jobs

   # Verify API availability
   curl --fail "$OSMO_URL/api/version"

.. code-block:: bash

   # Verify pools and resources
   osmo pool list
   osmo resource list --pool default

   # Verify workflow submission and operation
   osmo workflow submit deployments/workflows/verify-hello.yaml \
     --pool default \
     --format-type json
   osmo workflow submit deployments/workflows/verify-object-storage.yaml \
     --pool default \
     --format-type json
   OSMO_WORKFLOW_ID=<returned-workflow-id>
   osmo workflow query "$OSMO_WORKFLOW_ID" --format-type json

For each submission, set ``OSMO_WORKFLOW_ID`` to the returned workflow ID and
repeat the query until its status is ``COMPLETED``. A ``FAILED``, ``CANCELLED``,
or timed-out workflow is a validation failure. Inspect its logs and Kubernetes
events before retrying.

Troubleshooting
===============

Start with release status, workloads, PVCs, and recent events:

.. code-block:: bash

   helm status osmo --namespace osmo
   kubectl --namespace osmo get pods,statefulsets,pvc,jobs
   kubectl --namespace osmo get events --sort-by=.lastTimestamp
   kubectl --namespace osmo-workflows get pods,networkpolicy

Common causes include:

* During initial startup, the backend worker and listener Pods may briefly enter
  ``CrashLoopBackOff`` while they wait for the API Pods to become Ready. They
  should recover automatically after the API is available. If the restarts
  continue, inspect their logs and confirm that the API Pods and Service are
  healthy.
* A ``Pending`` PostgreSQL, Valkey, or RustFS PVC means the default
  ``StorageClass`` is absent, lacks capacity, or cannot bind on an eligible
  node.
* Unschedulable PostgreSQL or RustFS Pods usually mean fewer than four platform
  nodes are available, CPU is exhausted, or required hostname
  anti-affinity cannot be satisfied. Inspect Pod events for ``Insufficient
  cpu`` before adding replicas or increasing node size.
* A workflow that remains queued usually means KAI Scheduler is not Ready or no
  eligible node has the requested CPU, memory, GPU, or ephemeral storage.
* If Helm 4 reports an operator custom resource as ``InProgress`` after its
  Ready or Available condition is true, use the documented explicit
  ``kubectl wait`` checks and Helm's ``--wait=legacy`` strategy.
* If the CLI reports ``Connection refused`` after the local port-forward was
  working, restart ``kubectl port-forward``. The command exits if its selected
  gateway Pod restarts.
* An OAuth redirect loop or rejected token usually means ``externalUrl`` does
  not exactly match the URL used by the browser and CLI. With an external IdP,
  also check the issuer, audience, JWKS URL, client Secret, redirect URI, and
  role claim.
* ``ImagePullBackOff`` means the image registry, tag, credentials, proxy, or
  mirror configuration is incorrect.
* For maximum recovery robustness, keep each production credential's source of
  truth in your organization's secret manager and provision its Kubernetes
  Secret before installation. The chart's bootstrap mechanism remains
  available as a convenience when external provisioning is not used.

Durability and availability
===========================

The self-contained profile supplies persistent, replicated dependencies and
multiple replicas for critical stateless services:

* PostgreSQL runs three instances and requires synchronous acknowledgment from
  one standby;
* Valkey runs one persistent primary and two persistent replicas with
  write-safety checks; and
* RustFS runs four instances with erasure coding and required hostname
  anti-affinity.

Valkey replication adds data redundancy, but the embedded chart has a fixed
primary and no automatic promotion. Use an external Valkey service when
automatic primary promotion or managed multi-zone recovery is required.

The profile improves availability within one cluster. Use split-plane
infrastructure and externally managed stateful services when control-plane
isolation, multi-site recovery, or independent scaling is required.

Upgrade and Recovery
====================

Before an upgrade, back up PostgreSQL, RustFS, Valkey, and all retained
credential Secrets. Keep the master encryption key with the database backup.
Review the rendered change, then reuse the installed profile and environment
values. The command uses Helm 4; with Helm 3, replace ``--wait=legacy`` with
``--wait``:

.. code-block:: bash

   helm upgrade osmo deployments/charts/osmo \
     --namespace osmo \
     --values deployments/charts/osmo/profiles/self-contained.yaml \
     --values deployments/charts/osmo/examples/node-selectors.yaml \
     --values self-contained-environment-values.yaml \
     --wait=legacy \
     --wait-for-jobs \
     --timeout 30m

Do not replace ``osmo-master-encryption-key``, ``osmo-backend-token``, or the
stateful-service credentials while retaining their data. Embedded backup and
restore are not managed by the OSMO chart. Follow CloudNativePG and storage
provider procedures, and test full recovery on a separate cluster.

Cleanup
========

Uninstall the OSMO release when you want to remove its active workloads:

.. code-block:: bash

   helm uninstall osmo --namespace osmo --wait
   kubectl --namespace osmo get pvc,secrets
   kubectl get namespace osmo-workflows

Generated credentials, stateful PVCs, the ``osmo-workflows`` namespace, and its
NetworkPolicy can be retained. CloudNativePG data retention follows the
operator and ``Cluster`` settings. Back up and inspect retained resources before
deleting them.

For a disposable installation, delete both namespaces and all remaining local
data only after confirming that recovery is not required:

.. code-block:: bash

   kubectl delete namespace osmo osmo-workflows \
     --wait=true \
     --timeout=10m

Remove the prerequisite operators only when no other workloads use them and no
CloudNativePG ``Cluster`` resources remain:

.. code-block:: bash

   helm uninstall kai-scheduler --namespace kai-scheduler --wait
   helm uninstall cnpg --namespace cnpg-system --wait

Remove the operator-managed public edge separately when it is no longer used.
