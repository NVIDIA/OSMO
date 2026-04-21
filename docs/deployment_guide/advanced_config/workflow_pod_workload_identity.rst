..
  SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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


.. _workflow_pod_workload_identity:

======================================
Workload Identity for Workflow Pods
======================================

.. include:: ../_shared/configmap_banner.rst

By default, when a user submits a workflow that reads or writes their own cloud buckets, they supply credentials per workflow (via ``osmo credential`` or embedded in the task spec). That's fine for one-off cases. But when a team shares a pool and everyone needs access to the same set of buckets, having each user manage the same credentials over and over is tedious and error-prone.

This page covers an alternative: **grant pool-wide bucket access via cloud workload identity**. You configure a Kubernetes ServiceAccount on the backend cluster with a cloud IAM role that can read/write the shared team buckets, then attach it to the pool via a pod template. Every workflow submitted to that pool runs under that ServiceAccount and inherits the cloud identity — no per-workflow credentials needed.

**Good fit:**

- A team shares one pool and everyone needs access to the same cloud bucket(s).
- You want to grant bucket access through cloud IAM (audited, revocable, no long-lived keys in specs) rather than distribute keys to every user.
- Your backend cluster runs on a cloud that supports workload identity (EKS, AKS, GKE).

**Not a fit:**

- Per-user bucket access — workload identity is applied at the pool/SA level and covers every workflow in the pool equally. If User A should access bucket X and User B should access bucket Y in the same pool, use per-workflow credentials instead (or split into separate pools).
- One-off access — if only a few workflows need a bucket, supplying credentials per workflow is simpler.

.. note::

   This page is about **user data** buckets referenced in workflow task inputs/outputs. It is unrelated to OSMO's internal ``workflow_log`` and ``workflow_data`` buckets, which are configured on the service cluster — see :ref:`configure_storage_access`.


Configuration
=============

**1. Set up workload identity in your cloud and grant bucket access**

Follow your cloud provider's guide on the backend cluster to create a cloud identity (IAM role / managed identity / Google Service Account) with read/write access to the **user data buckets** you want workflow pods to reach:

- AWS (EKS): `IAM Roles for Service Accounts <https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html>`__
- Azure (AKS): `Azure AD Workload Identity <https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview>`__
- GCP (GKE): `Workload Identity <https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity>`__

When setting up the federation/binding, the subject is the Kubernetes ServiceAccount you'll create in step 2.

**2. Create an annotated ServiceAccount in the backend cluster's workflow namespace**

OSMO runs workflow pods in a namespace on the backend cluster (typically ``osmo-workflows`` or a per-user/team namespace). Create a ServiceAccount in that namespace with your provider's annotation:

.. code-block:: yaml

   apiVersion: v1
   kind: ServiceAccount
   metadata:
     name: osmo-workflow
     namespace: osmo-workflows    # replace with your workflow namespace
     annotations:
       # Uncomment ONE line for your cloud provider:
       # eks.amazonaws.com/role-arn: arn:aws:iam::<account-id>:role/<role-name>       # AWS (EKS + IRSA)
       # azure.workload.identity/client-id: <managed-identity-client-id>              # Azure (AKS Workload Identity)
       # iam.gke.io/gcp-service-account: <gsa>@<project>.iam.gserviceaccount.com      # GCP (GKE Workload Identity)

Apply it on the backend cluster:

.. code-block:: bash

   $ kubectl apply -f workflow-sa.yaml --context <backend-cluster-context>

**3. Add a pod template referencing the ServiceAccount**

Add a pod template to ``services.configs.podTemplates`` in your OSMO service Helm values. The template sets ``serviceAccountName`` so OSMO schedules workflow pods under the annotated ServiceAccount:

.. code-block:: yaml

   services:
     configs:
       podTemplates:
         workflow_workload_identity:
           spec:
             serviceAccountName: osmo-workflow

**4. Reference the pod template from the pools that should use workload identity**

Add the template name to each pool's ``common_pod_template`` list:

.. code-block:: yaml

   services:
     configs:
       pools:
         default:
           common_pod_template:
             - default_user
             - default_ctrl
             - workflow_workload_identity

Re-apply the service Helm release. New workflows submitted to those pools run under the annotated ServiceAccount and pick up cloud credentials automatically when accessing user data buckets in task inputs/outputs.


Verification
============

Submit a workflow that references a user data bucket covered by the IAM role and check the pod spec on the backend cluster:

.. code-block:: bash

   $ kubectl describe pod <workflow-pod> -n <workflow-namespace> --context <backend-cluster-context>

Look for:

- ``Service Account: osmo-workflow`` — pod runs under the annotated SA
- Injected environment variables depending on the provider:
   - AWS: ``AWS_ROLE_ARN``, ``AWS_WEB_IDENTITY_TOKEN_FILE``
   - Azure: ``AZURE_CLIENT_ID``, ``AZURE_FEDERATED_TOKEN_FILE``
   - GCP: projected token under ``/var/run/secrets/tokens/gcp-ksa/``

If the env vars are missing, the cloud admission controller didn't match — double check the ServiceAccount annotation, namespace, and (for Azure) the federated credential subject.
