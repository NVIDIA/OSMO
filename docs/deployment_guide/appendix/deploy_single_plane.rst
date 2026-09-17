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

.. _deploy_single_plane:

=======================
Single-plane Deployment
=======================

A single-plane deployment runs the OSMO control plane and compute plane in one
Kubernetes cluster. PostgreSQL, Valkey or Redis, and object storage remain
external to the Helm release. This profile is useful for development,
evaluation, and small installations that do not need independent control and
compute clusters.

The unified ``osmo`` chart installs both planes in one Helm release. Do not
install the legacy ``service`` or ``backend-operator`` charts for this model.

.. image:: deploy_single_plane.svg
   :align: center
   :width: 80%

This guide uses a ``ClusterIP`` gateway and local port forwarding. Before a
production deployment, add a TLS ingress or HTTPRoute, use an external identity
provider, set a reachable HTTPS ``externalUrl``, and apply the availability,
backup, and monitoring requirements for your site.

Infrastructure prerequisites
============================

Prepare the following before installing OSMO:

* A Kubernetes 1.30 or newer cluster with at least three schedulable CPU nodes
  and at least four vCPUs per node.
* KAI Scheduler 0.12.10.
* PostgreSQL 15 or newer with an empty database for OSMO.
* Valkey or Redis 7 or newer.
* One private object-storage container or bucket for workflow state, logs, and
  application bundles.
* ``kubectl``, Helm, OpenSSL, ``jq``, and the OSMO CLI on the administrator
  workstation.

The Kubernetes nodes and OSMO pods must be able to resolve and reach the three
external services. Keep credentials in a secret manager or private files, not
in values files or shell history.

Azure Blob Storage must have account-level anonymous Blob access explicitly
disabled, and every container must be private. For example, the authoritative
Terraform resources must include both settings:

.. code-block:: terraform

   resource "azurerm_storage_account" "osmo" {
     # ...
     allow_nested_items_to_be_public = false
   }

   resource "azurerm_storage_container" "osmo_workflows" {
     # ...
     container_access_type = "private"
   }

After provisioning, verify the live resources. Accept only ``false`` for the
account and no containers with a non-``None`` public-access setting:

.. code-block:: bash

   STORAGE_ACCOUNT_ID=$(az storage account show \
     --resource-group <resource-group> \
     --name <storage-account> \
     --query id --output tsv)
   test "$(az storage account show --ids "$STORAGE_ACCOUNT_ID" \
     --query allowBlobPublicAccess --output tsv)" = false
   test "$(az rest --method get \
     --url "https://management.azure.com${STORAGE_ACCOUNT_ID}/blobServices/default/containers?api-version=2023-05-01" \
     --query 'length(value[?properties.publicAccess != null])' \
     --output tsv)" = 0

Provision Azure infrastructure only
-----------------------------------

The repository helper supports an infrastructure-only mode. The following
example provisions a CPU-only AKS cluster, PostgreSQL, Azure Managed Redis, and
a private Blob container, but does not install OSMO. Use a private directory
because Terraform state contains credentials. Install Azure CLI and Terraform
before running this example.

.. code-block:: bash

   install -d -m 0700 "$HOME/.local/state/osmo/single-plane-azure"
   export AZURE_TERRAFORM_DIR="$HOME/.local/state/osmo/single-plane-azure"
   cp deployments/terraform/azure/example/*.tf "$AZURE_TERRAFORM_DIR/"

   read -rsp 'PostgreSQL password: ' TF_POSTGRES_PASSWORD
   printf '\n'
   export TF_POSTGRES_PASSWORD

   bash deployments/scripts/deploy-osmo.sh \
     --provider azure \
     --skip-osmo \
     --no-gpu \
     --non-interactive \
     --subscription-id <subscription-id> \
     --resource-group <existing-resource-group> \
     --cluster-name <cluster-name> \
     --region <azure-region> \
     --storage-backend azure-blob
   unset TF_POSTGRES_PASSWORD

The example Terraform enables cluster autoscaling from three to five CPU nodes.
Use the equivalent infrastructure workflow for another cloud or for existing
services. The remaining steps are provider-independent except for the
object-storage credential document and endpoint format.

Install KAI Scheduler
=====================

Install the scheduler before OSMO:

.. code-block:: bash

   helm upgrade --install kai-scheduler \
     oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler \
     --version v0.12.10 \
     --create-namespace \
     --namespace kai-scheduler \
     --timeout 10m

   kubectl wait --namespace kai-scheduler --for=condition=available \
     deployment --all --timeout=10m
   helm list --namespace kai-scheduler
   kubectl get pods --namespace kai-scheduler

Create the OSMO Secrets
=======================

Create the namespace and a private directory for temporary credential files:

.. code-block:: bash

   kubectl create namespace osmo
   SECRET_DIRECTORY=$(mktemp -d)
   chmod 700 "$SECRET_DIRECTORY"
   trap 'rm -rf -- "$SECRET_DIRECTORY"' EXIT INT TERM

PostgreSQL
----------

Create ``osmo-postgresql`` with keys named ``username`` and ``db-password``:

.. code-block:: bash

   printf '%s' '<postgres-username>' >"$SECRET_DIRECTORY/postgres-username"
   printf '%s' '<postgres-password>' >"$SECRET_DIRECTORY/postgres-password"
   chmod 600 "$SECRET_DIRECTORY"/postgres-*
   kubectl create secret generic osmo-postgresql --namespace osmo \
     --from-file=username="$SECRET_DIRECTORY/postgres-username" \
     --from-file=db-password="$SECRET_DIRECTORY/postgres-password"

Valkey or Redis
---------------

Create ``osmo-valkey`` with the key ``redis-password``:

.. code-block:: bash

   printf '%s' '<valkey-or-redis-password>' >"$SECRET_DIRECTORY/redis-password"
   chmod 600 "$SECRET_DIRECTORY/redis-password"
   kubectl create secret generic osmo-valkey --namespace osmo \
     --from-file=redis-password="$SECRET_DIRECTORY/redis-password"

Object storage
--------------

For static Azure Blob credentials, create a JSON document, which is also valid
YAML, under the Secret key ``object-storage.yaml``. Use the full connection
string as ``access_key``; ``access_key_id`` is a non-secret label.

.. code-block:: bash

   STORAGE_ACCOUNT=<storage-account>
   printf '%s' '<azure-storage-connection-string>' \
     >"$SECRET_DIRECTORY/storage-connection-string"
   chmod 600 "$SECRET_DIRECTORY/storage-connection-string"
   jq --null-input \
     --arg access_key_id "$STORAGE_ACCOUNT" \
     --rawfile access_key "$SECRET_DIRECTORY/storage-connection-string" \
     '{access_key_id: $access_key_id, access_key: $access_key}' \
     >"$SECRET_DIRECTORY/object-storage.yaml"
   chmod 600 "$SECRET_DIRECTORY/object-storage.yaml"
   kubectl create secret generic osmo-object-storage --namespace osmo \
     --from-file=object-storage.yaml="$SECRET_DIRECTORY/object-storage.yaml"

For Azure Workload Identity, do not create this Secret. Select
``externalDependencies.objectStorage.authentication.type: sdkDefault`` and
configure the API, worker, and workflow ServiceAccounts as described in
:ref:`configure_storage_access`.

Backend authentication
----------------------

The profile expects ``osmo-backend-token`` with key ``token``. Generate it
independently of the API so the compute plane can authenticate during startup:

.. code-block:: bash

   openssl rand -base64 32 | tr -d '\n=' | tr '/+' '_-' \
     >"$SECRET_DIRECTORY/backend-token"
   chmod 600 "$SECRET_DIRECTORY/backend-token"
   kubectl create secret generic osmo-backend-token --namespace osmo \
     --from-file=token="$SECRET_DIRECTORY/backend-token"

The chart safely bootstraps the initial administrator credentials, master
encryption key, and service signing identity into retained Kubernetes Secrets;
their values never enter Helm release state. To use externally managed MEK or
service-auth Secrets instead, create the exact Secret names and keys configured
under ``secrets.masterEncryptionKey.existingSecret`` and
``secrets.serviceAuth.existingSecret``, then leave their bootstrap Jobs
disabled. See :ref:`authentication_authorization` for identity lifecycle and
external IdP configuration.

Prepare the site values
=======================

Create ``single-plane-values.yaml`` with non-secret endpoints. This file layers
after ``profiles/single-plane.yaml``:

.. code-block:: yaml

   externalUrl: http://127.0.0.1:9000

   externalDependencies:
     postgresql:
       host: <postgres-host>
       port: 5432
       database: <postgres-database>
       username: <postgres-username>
       tls:
         enabled: false
     valkey:
       host: <valkey-or-redis-host>
       port: <tls-port>
       database: 0
       tls:
         enabled: true
     objectStorage:
       authentication:
         type: static
       locations:
         workflows: azure://<storage-account>/<container>/workflows
         logs: azure://<storage-account>/<container>/logs
         apps: azure://<storage-account>/<container>/apps

   secrets:
     objectStorage:
       generate: false
       existingSecret: osmo-object-storage
     masterEncryptionKey:
       managementMode: osmo
       bootstrap:
         enabled: true
     serviceAuth:
       managementMode: osmo
       bootstrap:
         enabled: true

   configuration:
     service:
       service_base_url: http://osmo-gateway.osmo.svc:80

Set PostgreSQL TLS to match the server. For ``sslMode: verify-full``, also
create the CA Secret and set ``caExistingSecret`` and ``caKey``. Set Valkey TLS
to ``false`` only when the trusted endpoint does not provide TLS.

Install the unified chart
=========================

Use a chart version and OSMO images from the same release. When installing from
a source checkout, build its dependencies and install the local unified chart:

.. code-block:: bash

   helm dependency build deployments/charts/osmo
   helm upgrade --install osmo deployments/charts/osmo \
     --namespace osmo \
     --values deployments/charts/osmo/profiles/single-plane.yaml \
     --values single-plane-values.yaml \
     --wait \
     --wait-for-jobs \
     --timeout 30m

After both bootstrap Jobs succeed, disable them in
``single-plane-values.yaml`` and apply one cleanup transaction. Retain the
generated Secrets; they are required for upgrades and database recovery.

.. code-block:: yaml

   secrets:
     masterEncryptionKey:
       managementMode: osmo
       bootstrap:
         enabled: false
     serviceAuth:
       managementMode: osmo
       bootstrap:
         enabled: false

.. code-block:: bash

   helm upgrade osmo deployments/charts/osmo \
     --namespace osmo \
     --values deployments/charts/osmo/profiles/single-plane.yaml \
     --values single-plane-values.yaml \
     --wait \
     --wait-for-jobs \
     --timeout 30m

Log in
======

Forward the gateway in a dedicated terminal:

.. code-block:: bash

   kubectl --namespace osmo port-forward service/osmo-gateway 9000:80

The profile uses embedded Dex by default. Run the standard browser login and
sign in as ``admin@osmo.local`` with the password stored in
``osmo-embedded-dex-admin``:

.. code-block:: bash

   export OSMO_URL=http://127.0.0.1:9000
   kubectl get secret osmo-embedded-dex-admin --namespace osmo \
     --output jsonpath='{.data.password}' | base64 --decode
   printf '\n'
   osmo login "$OSMO_URL"

The password command writes the credential to the terminal. Run it only in a
private terminal and do not paste its output into logs or issue trackers.

For non-interactive validation, read the chart-managed administrator token into
a mode-0600 file without printing it, then use token login:

.. code-block:: bash

   ADMIN_TOKEN_FILE="$SECRET_DIRECTORY/admin-token"
   chmod 600 "$ADMIN_TOKEN_FILE"
   kubectl get secret osmo-admin-token --namespace osmo \
     --output jsonpath='{.data.token}' | base64 --decode >"$ADMIN_TOKEN_FILE"
   osmo login "$OSMO_URL" --method token --token-file "$ADMIN_TOKEN_FILE"
   rm -f -- "$ADMIN_TOKEN_FILE"

For production, configure ``authentication.provider: externalOidc`` instead.
Follow :ref:`identity_provider_setup`; the default ``osmo login`` uses browser
authorization-code flow with PKCE, and ``osmo login --method code`` explicitly
selects device authorization.

Verify the deployment
=====================

Confirm that the control-plane, gateway, and compute-plane Deployments are
available and that the backend reports resources:

.. code-block:: bash

   kubectl get deployments --namespace osmo
   kubectl get pods --namespace osmo
   kubectl wait --namespace osmo --for=condition=available deployment --all \
     --timeout=10m
   osmo pool list
   osmo resource list --pool default

Submit the CPU and object-storage smoke workflows from the repository:

.. code-block:: bash

   osmo workflow submit deployments/workflows/verify-hello.yaml \
     --pool default --format-type json
   osmo workflow submit deployments/workflows/verify-object-storage.yaml \
     --pool default --format-type json
   osmo workflow query <workflow-name> --format-type json

Repeat the query until each workflow reports ``COMPLETED``. The first workflow
validates CPU scheduling and compute-plane status reporting. The second also
validates upload and download through the configured object storage.

Troubleshooting
===============

* **A bootstrap Job fails:** inspect ``kubectl get jobs,pods -n osmo`` and the
  failed Job logs. Correct the dependency or Secret, increment that bootstrap
  block's ``attempt`` value, and run ``helm upgrade`` again.
* **Database connection fails:** verify host, database, username, Secret key
  ``db-password``, TLS mode, DNS, and network reachability from an OSMO pod.
* **Valkey connection fails:** verify the endpoint, TLS port, Secret key
  ``redis-password``, and CA configuration.
* **Object storage fails:** verify all three URI prefixes, the
  ``object-storage.yaml`` credential document, provider permissions, and Blob
  account/container privacy settings.
* **Workflows remain pending:** verify KAI 0.12.10 is running, inspect
  ``osmo workflow events <workflow-name>``, and check node capacity with
  ``osmo resource list --pool default``.
* **Images cannot be pulled:** use released chart and image versions that
  match. Keep private registry overrides and pull credentials in a private
  site values file and Kubernetes Secret, never in the published guide.

Cleanup
========

Uninstalling the chart preserves retained Secrets. Back them up before deleting
the namespace or external database:

.. code-block:: bash

   helm uninstall osmo --namespace osmo --wait
   helm uninstall kai-scheduler --namespace kai-scheduler --wait

Destroy cloud infrastructure only when its data is no longer needed. Reuse the
same private Terraform directory and the same scoped cloud inputs used during
provisioning.
