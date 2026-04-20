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

=======================================================
Workload Identity for Workflow Pods
=======================================================

.. include:: ../_shared/configmap_banner.rst

Workload identity on the **service cluster** (covered in :ref:`configure_storage_access`) gives the OSMO service and worker pods cloud credentials to read/write the ``workflow_log`` and ``workflow_data`` buckets. During workflow execution, the **workflow pods** themselves also need access to ``workflow_data`` — but they run on your **backend cluster**, not the service cluster. That access is configured separately, here.

.. note::

   If you chose the static credentials path in :ref:`Step 3 <configure_storage_access>` and workflow pods mount the bucket via the credentials stored in the ``osmo-workflow-data-cred`` Secret, you can skip this page — static credentials already cover workflow pods.


Why it's a separate configuration
=================================

- **Different cluster.** Workflow pods run on the backend cluster that's registered as an OSMO backend. That cluster has its own OIDC provider, its own namespaces, and its own ServiceAccounts. Annotations on the service cluster don't transfer.
- **Possibly different cloud.** The service cluster and backend cluster can be in different cloud accounts or even different providers. Each needs its own workload identity binding.
- **Different access scope.** Workflow pods need read/write access to ``workflow_data`` for task inputs/outputs. They don't need access to ``workflow_log``, admin APIs, etc.


Configuration
=============

**1. Set up workload identity in your cloud and grant bucket access**

Follow your cloud provider's guide on the backend cluster to create a cloud identity (IAM role / managed identity / Google Service Account) with read/write access to the ``workflow_data`` bucket:

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
       # Pick ONE annotation for your cloud provider:
       eks.amazonaws.com/role-arn: arn:aws:iam::<account-id>:role/<role-name>       # AWS (EKS + IRSA)
       # azure.workload.identity/client-id: <managed-identity-client-id>            # Azure (AKS Workload Identity)
       # iam.gke.io/gcp-service-account: <gsa>@<project>.iam.gserviceaccount.com    # GCP (GKE Workload Identity)

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

Re-apply the service Helm release. New workflows submitted to those pools will run under the annotated ServiceAccount and pick up cloud credentials automatically.


Verification
============

Submit a simple workflow to one of the updated pools and check the pod spec on the backend cluster:

.. code-block:: bash

   $ kubectl describe pod <workflow-pod> -n <workflow-namespace> --context <backend-cluster-context>

Look for:

- ``Service Account: osmo-workflow`` — pod runs under the annotated SA
- Injected environment variables depending on the provider:
   - AWS: ``AWS_ROLE_ARN``, ``AWS_WEB_IDENTITY_TOKEN_FILE``
   - Azure: ``AZURE_CLIENT_ID``, ``AZURE_FEDERATED_TOKEN_FILE``
   - GCP: projected token under ``/var/run/secrets/tokens/gcp-ksa/``

If the env vars are missing, the cloud admission controller didn't match — double check the ServiceAccount annotation, namespace, and (for Azure) the federated credential subject.
