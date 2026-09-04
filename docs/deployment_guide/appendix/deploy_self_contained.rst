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
stateful dependencies in one non-cloud Kubernetes cluster. It is intended for
edge sites, labs, and other environments that must keep the complete OSMO stack
local while retaining data and service availability across Pod or node
failures.

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

Prerequisites
=============

Run the commands in this guide from the root of an OSMO repository clone. Set
your current kubectl context to the Kubernetes cluster where you want to
install OSMO before continuing.

The cluster must provide:

* Kubernetes 1.30 or newer;
* at least four nodes labeled
  ``osmo.nvidia.com/node-pool=control-plane``, with enough failure-domain
  capacity for three PostgreSQL Pods, three Valkey Pods, and four RustFS Pods;
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
     <platform-node-1> <platform-node-2> <platform-node-3> <platform-node-4> \
     osmo.nvidia.com/node-pool=control-plane
   kubectl label node <compute-node-1> \
     osmo.nvidia.com/node-pool=compute
   kubectl get nodes --label-columns=osmo.nvidia.com/node-pool

The profile creates three 20 GiB PostgreSQL volumes and four 100 GiB RustFS
volumes in addition to persistent Valkey storage. Account for storage-provider
overhead, backups, and the resources requested by concurrent workflows.

Identity and edge requirements
------------------------------

Register a confidential browser client and a public device-flow CLI client with
an identity provider reachable by users and the OSMO gateway. The provider can
run inside or outside the cluster. Its tokens must contain an array-valued
``roles`` claim and the audience expected by OSMO. Assign trusted operators the
``osmo-admin`` role and workflow users the ``osmo-user`` role.

Prepare these non-secret OIDC values before installation:

* the issuer URL, browser client ID, browser authorization and logout
  endpoints, audience, and JWKS URL;
* the CLI client ID, device authorization endpoint, and token endpoint;
* the identity-provider host reachable from the gateway;
* the token claim that contains the user name; and
* the public HTTPS URL for OSMO.

The profile creates a ``ClusterIP`` gateway. Configure an operator-managed edge
to terminate public TLS and route the public URL to the ``osmo-gateway`` Service
on port 80. Validate the edge and the CNI's NetworkPolicy enforcement before
exposing OSMO to users.

Install cluster dependencies
============================

Install KAI Scheduler v0.12.10 for OSMO workflow scheduling:

.. code-block:: bash

   helm upgrade --install kai-scheduler \
     oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler \
     --version v0.12.10 \
     --create-namespace -n kai-scheduler \
     --set-string 'global.nodeSelector.osmo\.nvidia\.com/node-pool=control-plane' \
     --set "scheduler.additionalArgs[0]=--default-staleness-grace-period=-1s" \
     --set "scheduler.additionalArgs[1]=--update-pod-eviction-condition=true" \
     --wait

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

Create the OAuth Secret
=======================

Create the release namespace. Prepare files that contain the OIDC client Secret
and a 32-byte random cookie Secret without trailing newlines, then create the
OAuth Secret without putting either value in Helm values or shell arguments:

.. code-block:: bash

   kubectl create namespace osmo
   kubectl --namespace osmo create secret generic osmo-oauth2-proxy \
     --from-file=client_secret=/secure/path/oidc-client-secret \
     --from-file=cookie_secret=/secure/path/oauth-cookie-secret

Install OSMO
============

Helm profiles are values overlays, not a ``profile`` setting. Copy the provided
self-contained environment example and replace every example identity,
network, and URL value for the target environment. Keep this environment file
separate from the production profile so that upgrades can reuse it.

The ``clusterCIDRs`` list must cover every IPv4 Pod and Service CIDR used by the
cluster. Add entries when the cluster uses more than one CIDR.

The dependency commands place KAI Scheduler and the PostgreSQL operator on
nodes with the ``control-plane`` label. The example environment overlay applies
the same selector to OSMO services and bootstrap Jobs, PostgreSQL, Valkey, and
RustFS. It also adds the ``compute`` selector to the default workflow Pod
templates. If you add pool-specific Pod templates or replace the default
templates, retain the compute-node selector so workflows do not run on OSMO
platform nodes.

.. code-block:: bash

   cp deployments/charts/osmo/examples/self-contained-environment-values.yaml \
     self-contained-environment-values.yaml
   # Edit self-contained-environment-values.yaml for the target environment.

   helm dependency build deployments/charts/osmo
   helm upgrade --install osmo deployments/charts/osmo \
     --namespace osmo \
     --values deployments/charts/osmo/profiles/self-contained.yaml \
     --values self-contained-environment-values.yaml \
     --wait \
     --wait-for-jobs \
     --timeout 30m

The chart uses its application version for OSMO images and the cluster's
default ``StorageClass``. The self-contained profile enables the service-auth
bootstrap Job, which creates the shared service identity during installation.
The chart also creates the local database, cache, object storage, required
buckets, workflow namespace, configuration, backend bootstrap credential, and
retained master encryption key.

Validate the deployment
=======================

Verify the public edge and log in through the configured identity provider:

.. code-block:: bash

   curl --fail https://osmo.edge.example.com/api/version
   osmo login https://osmo.edge.example.com --method=code
   osmo profile set pool default
   osmo workflow submit deployments/workflows/verify-hello.yaml \
     --pool default \
     --format-type json
   osmo workflow query <workflow-id> --format-type json

Repeat the query until the workflow status is ``COMPLETED``. A ``FAILED``,
``CANCELLED``, or timed-out workflow is a validation failure. Inspect its logs
and Kubernetes events before retrying.

Troubleshooting
===============

Start with release status, workloads, PVCs, and recent events:

.. code-block:: bash

   helm status osmo --namespace osmo
   kubectl --namespace osmo get pods,statefulsets,pvc,jobs
   kubectl --namespace osmo get events --sort-by=.lastTimestamp
   kubectl --namespace osmo-workflows get pods,networkpolicy

Common causes include:

* A ``Pending`` PostgreSQL, Valkey, or RustFS PVC means the default
  ``StorageClass`` is absent, lacks capacity, or cannot bind on an eligible
  node.
* Unschedulable PostgreSQL or RustFS Pods usually mean fewer than four eligible
  nodes are available or required hostname anti-affinity cannot be satisfied.
* A workflow that remains queued usually means KAI Scheduler is not Ready or no
  eligible node has the requested CPU, memory, GPU, or ephemeral storage.
* An OAuth redirect loop or rejected token usually means the public URL, issuer,
  audience, JWKS URL, client Secret, redirect URI, or role claim is inconsistent
  between OSMO and the identity provider.
* ``ImagePullBackOff`` means the image registry, tag, credentials, proxy, or
  mirror configuration is incorrect.
* A missing retained backend token, master encryption key, or stateful-service
  credential blocks safe recovery. Restore the original Secret instead of
  generating a replacement against retained data.

Durability and availability
===========================

Quickstart is designed for a disposable workstation cluster with small
single-node dependencies and one replica for each OSMO component. The
self-contained profile instead supplies persistent, replicated dependencies and
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

Upgrade and recovery
====================

Before an upgrade, back up PostgreSQL, RustFS, Valkey, and all retained
credential Secrets. Keep the master encryption key with the database backup.
Review the rendered change, then reuse the installed profile and environment
values:

.. code-block:: bash

   helm upgrade osmo deployments/charts/osmo \
     --namespace osmo \
     --values deployments/charts/osmo/profiles/self-contained.yaml \
     --values self-contained-environment-values.yaml \
     --wait \
     --wait-for-jobs \
     --timeout 30m

Do not replace ``osmo-master-encryption-key``, ``osmo-backend-token``, or the
stateful-service credentials while retaining their data. Embedded backup and
restore are not managed by the OSMO chart. Follow CloudNativePG and storage
provider procedures, and test full recovery on a separate cluster.

Clean up resources
==================

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
