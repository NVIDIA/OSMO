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

.. _deploy_service:

============================
Deploy Service
============================

This guide provides step-by-step instructions for deploying OSMO service components on a Kubernetes cluster.

Components Overview
====================

OSMO deployment consists of several main components:

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Component
     - Description
   * - API Service
     - Workflow operations and API endpoints
   * - Router Service
     - Routing traffic to the API Service
   * - Web UI Service
     - Web interface for users
   * - Worker Service
     - Background job processing
   * - Logger Service
     - Log collection and streaming
   * - Agent Service
     - Client communication and status updates
   * - Delayed Job Monitor
     - Monitoring and managing delayed background jobs

.. image:: service_components.svg
   :width: 80%
   :align: center

Step 1: Configure PostgreSQL
============================

Create a database for OSMO using the following command. Omit ``export OSMO_PGPASSWORD=...``
and ``PGPASSWORD=$OSMO_PGPASSWORD`` if PostgreSQL was configured without a password.

.. code-block:: bash

  $ export OSMO_DB_HOST=<your-db-host>
  $ export OSMO_PGPASSWORD=<your-postgres-password>
  $ kubectl apply -f - <<EOF
  apiVersion: v1
  kind: Pod
  metadata:
    name: osmo-db-ops
  spec:
    containers:
      - name: osmo-db-ops
        image: alpine/psql:17.5
        command: ["/bin/sh", "-c"]
        args:
          - "PGPASSWORD=$OSMO_PGPASSWORD psql -U postgres -h $OSMO_DB_HOST -p 5432 -d postgres -c 'CREATE DATABASE osmo;'"
    restartPolicy: Never
  EOF

Check that the process ``Completed`` with ``kubectl get pod osmo-db-ops``. Then delete the pod with:

.. code-block:: bash

   $ kubectl delete pod osmo-db-ops

Step 2: Create namespace and secrets
====================================

Before creating secrets, register OSMO as an OAuth2/OIDC application in your identity provider and obtain the client ID, client secret, and endpoints (token, authorize, JWKS, issuer). See :doc:`../appendix/authentication/identity_provider_setup` for provider-specific steps.

Create a namespace to deploy OSMO:

.. code-block:: bash

   $ kubectl create namespace osmo


Create secrets for the database and Redis:

.. code-block:: bash

   $ kubectl create secret generic db-secret --from-literal=db-password=<your-db-password> --namespace osmo
   $ kubectl create secret generic redis-secret --from-literal=redis-password=<your-redis-password> --namespace osmo


Create the secret used by OAuth2 Proxy for the client secret and session cookie encryption. Use the client secret from your IdP application registration:

.. code-block:: bash

   $ kubectl create secret generic oauth2-proxy-secrets \
     --from-literal=client_secret=<your-idp-client-secret> \
     --from-literal=cookie_secret=$(openssl rand -base64 32) \
     --namespace osmo


**Workflow storage credentials (skip if using workload identity)**

OSMO needs to read/write two storage buckets for workflow logs and workflow data. If you plan to use cloud workload identity (AWS IRSA, Azure Workload Identity, GCP Workload Identity) — covered in :ref:`configure_storage_access` — skip this subsection and come back only if workload identity is not an option for your deployment.

Create the workflow log credentials Secret:

.. code-block:: bash

   $ kubectl create secret generic osmo-workflow-log-cred --namespace osmo \
       --from-literal=endpoint=s3://my-bucket/workflow-logs \
       --from-literal=region=us-east-1 \
       --from-literal=access_key_id=<your-access-key-id> \
       --from-literal=access_key=<your-secret-access-key>

Create the workflow data credentials Secret (you can use the same bucket or a different one):

.. code-block:: bash

   $ kubectl create secret generic osmo-workflow-data-cred --namespace osmo \
       --from-literal=endpoint=s3://my-bucket/workflow-data \
       --from-literal=region=us-east-1 \
       --from-literal=access_key_id=<your-access-key-id> \
       --from-literal=access_key=<your-secret-access-key>

.. note::

   For non-AWS S3-compatible services (MinIO, Ceph, LocalStack), add an
   ``--from-literal=override_url=http://minio:9000`` flag. Leave it out for
   standard AWS S3.


Create the master encryption key (MEK) for database encryption:

1. **Generate a new master encryption key**:

   The MEK should be a JSON Web Key (JWK) with the following format:

   .. code-block:: json

      {"k":"<base64-encoded-32-byte-key>","kid":"key1","kty":"oct"}

2. **Generate the key using OpenSSL**:

   .. code-block:: bash

      # Generate a 32-byte (256-bit) random key and base64 encode it
      $ export RANDOM_KEY=$(openssl rand -base64 32 | tr -d '\n')

      # Create the JWK format
      $ export JWK_JSON="{\"k\":\"$RANDOM_KEY\",\"kid\":\"key1\",\"kty\":\"oct\"}"

3. **Base64 encode the entire JWK**:

   .. code-block:: bash

      $ export ENCODED_JWK=$(echo -n "$JWK_JSON" | base64 | tr -d '\n')
      $ echo $ENCODED_JWK

4. **Create the ConfigMap with your generated MEK**:

   .. code-block:: bash

      $ kubectl apply -f - <<EOF
      apiVersion: v1
      kind: ConfigMap
      metadata:
        name: mek-config
        namespace: osmo
      data:
        mek.yaml: |
          currentMek: key1
          meks:
            key1: $ENCODED_JWK
      EOF

.. warning::
   **Security Considerations**:

   - Store the original JWK securely as you'll need it for backups and recovery
   - Never commit the MEK to version control
   - Use a secure key management system, such as Vault or secrets manager in production
   - The MEK is used to encrypt sensitive data in the database

**Example MEK generation script**:

.. code-block:: bash

   #!/bin/bash
   # Generate MEK for OSMO

   # Generate random 32-byte key
   $ export RANDOM_KEY=$(openssl rand -base64 32 | tr -d '\n')

   # Create JWK
   $ export JWK_JSON="{\"k\":\"$RANDOM_KEY\",\"kid\":\"key1\",\"kty\":\"oct\"}"

   # Base64 encode the JWK
   $ export ENCODED_JWK=$(echo -n "$JWK_JSON" | base64 | tr -d '\n')
   $ echo "Encoded JWK: $ENCODED_JWK"

   # Create ConfigMap
   $ kubectl apply -f - <<EOF
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: mek-config
     namespace: osmo
   data:
     mek.yaml: |
       currentMek: key1
       meks:
         key1: $ENCODED_JWK
   EOF


.. _configure_storage_access:
.. _configure_data:

Step 3: Configure Storage Access
=================================

OSMO needs credentials to access two buckets: ``workflow_log`` and ``workflow_data``. The **service** and **worker** pods read/write both buckets (uploading logs, checkpointing task specs, etc.). Pick one of the two approaches below.

.. note::

   ``workflow_log`` and ``workflow_data`` are OSMO-managed buckets for internal workflow logs, task specs, and intermediate outputs passed between task groups. They are distinct from **user data buckets** referenced in workflow task ``inputs`` / ``outputs`` (the S3/Swift/GCS paths users name in their specs). User data is accessed via per-workflow credentials by default; for teams that share a pool and want pool-wide cloud access without supplying credentials each time, see :ref:`workflow_pod_workload_identity` as a follow-up.

Workload Identity (recommended on AWS, Azure, GCP)
---------------------------------------------------

With workload identity, the service and worker pods assume a cloud IAM role via their Kubernetes ServiceAccount — no long-lived access keys or Kubernetes Secrets required.

**1. Set up workload identity in your cloud and grant bucket access**

Follow your cloud provider's guide to enable workload identity on your cluster, create a cloud identity (IAM role / managed identity / Google Service Account), and grant it read/write access to your workflow log and data buckets:

- AWS (EKS): `IAM Roles for Service Accounts <https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html>`__
- Azure (AKS): `Azure AD Workload Identity <https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview>`__
- GCP (GKE): `Workload Identity <https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity>`__

When setting up the federation/binding, the subject is the OSMO ServiceAccount the chart deploys by default: ``system:serviceaccount:osmo:osmo``.

**2. Note what goes in your values file**

The Helm chart deploys a ServiceAccount named ``osmo`` (configurable via ``global.serviceAccountName``). You do **not** need to create a new ServiceAccount — the chart annotates it for you via ``serviceAccount.annotations`` in ``osmo_values.yaml``.

See the ``serviceAccount`` and ``services.configs.workflow`` sections of the sample in :ref:`Step 4 <deploy_service_osmo_values>`.

Static credentials
------------------

Use the two Kubernetes Secrets you created in Step 2 (``osmo-workflow-log-cred`` and ``osmo-workflow-data-cred``). In the next step, reference them by ``secretName`` and list them under ``secretRefs`` so the chart mounts them. No ServiceAccount annotations are needed.

In Step 4, follow the ``# static credentials`` comments inline in the ``osmo_values.yaml`` sample to flip the sample from workload identity to static credentials.


.. _deploy_service_osmo_values:

Step 4: Prepare values
============================

Create a values file for each OSMO component.

.. seealso::

   See :doc:`../appendix/authentication/identity_provider_setup` for the IdP-specific values you need to configure (client ID, endpoints, JWKS URI) and :doc:`../appendix/authentication/authentication_flow` for the request flow.

Create ``osmo_values.yaml`` for the OSMO service with the following sample.

.. dropdown:: ``osmo_values.yaml``
  :color: info
  :icon: file

  .. code-block:: yaml
    :emphasize-lines: 4, 21-23, 34, 36, 42, 51, 54-59, 134-135, 139-140, 146, 150, 164-166, 181-183

    # Global configuration shared across all OSMO services
    global:
      osmoImageLocation: nvcr.io/nvidia/osmo
      osmoImageTag: <version>                        # chart version
      serviceAccountName: osmo

      logs:
        enabled: true
        logLevel: DEBUG
        k8sLogLevel: WARNING

    # ServiceAccount the chart deploys. Uncomment ONE annotation below
    # for your cloud provider.
    #
    # For static credentials: delete this whole serviceAccount block —
    # the default ServiceAccount needs no cloud annotation. # (4)
    serviceAccount:
      create: true
      annotations:
        # Uncomment ONE line for your cloud provider:
        # eks.amazonaws.com/role-arn: arn:aws:iam::<account-id>:role/<role-name>       # AWS (EKS + IRSA)
        # azure.workload.identity/client-id: <managed-identity-client-id>              # Azure (AKS Workload Identity)
        # iam.gke.io/gcp-service-account: <gsa>@<project>.iam.gserviceaccount.com      # GCP (GKE Workload Identity)

    # Individual service configurations
    services:
      # Configuration file service settings
      configFile:
        enabled: true

      # PostgreSQL database configuration
      postgres:
        enabled: false
        serviceName: <your-postgres-host>
        port: 5432
        db: <your-database-name>
        user: postgres

      # Redis cache configuration
      redis:
        enabled: false  # Set to false when using external Redis
        serviceName: <your-redis-host>
        port: 6379
        tlsEnabled: true  # Set to false if your Redis does not require TLS

      # Main API service configuration
      service:
        scaling:
          minReplicas: 1
          maxReplicas: 3
        hostname: <your-domain>
        auth:
          enabled: true
          device_endpoint: <idp-device-auth-url>
          device_client_id: <client-id>
          browser_endpoint: <idp-authorize-url>
          browser_client_id: <client-id>
          token_endpoint: <idp-token-url>
          logout_endpoint: <idp-logout-url>

        # Resource allocation
        resources:
          requests:
            cpu: "1"
            memory: "1Gi"
          limits:
            memory: "1Gi"

      # Default admin (no IdP): enable to create an admin user and access token at startup
      defaultAdmin:
        enabled: false  # Set true when not using an IdP
        username: "admin"
        passwordSecretName: default-admin-secret
        passwordSecretKey: password

      # Worker service configuration
      worker:
        scaling:
          minReplicas: 1
          maxReplicas: 3
        resources:
          requests:
            cpu: "500m"
            memory: "400Mi"
          limits:
            memory: "800Mi"

      # Logger service configuration
      logger:
        scaling:
          minReplicas: 1
          maxReplicas: 3
        resources:
          requests:
            cpu: "200m"
            memory: "256Mi"
          limits:
            memory: "512Mi"

      # Agent service configuration
      agent:
        scaling:
          minReplicas: 1
          maxReplicas: 1
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            memory: "256Mi"

      # Delayed job monitor configuration
      delayedJobMonitor:
        replicas: 1
        resources:
          requests:
            cpu: "200m"
            memory: "512Mi"
          limits:
            memory: "512Mi"

      # OSMO configs (storage credentials for the service and worker pods).
      # Pods get cloud credentials via the annotated ServiceAccount above.
      configs:
        enabled: true
        # Static credentials path: # (4)
        # secretRefs:
        #   - secretName: osmo-workflow-log-cred
        #   - secretName: osmo-workflow-data-cred

        workflow:
          workflow_log:
            credential:
              endpoint: s3://my-bucket/workflow-logs
              region: us-east-1
              # secretName: osmo-workflow-log-cred         # static credentials (replaces endpoint + region) # (4)
          workflow_data:
            credential:
              endpoint: s3://my-bucket/workflow-data
              region: us-east-1
              # secretName: osmo-workflow-data-cred        # static credentials (replaces endpoint + region) # (4)

    # Gateway — deploys Envoy, OAuth2 Proxy, and Authz as separate services
    gateway:
      envoy:
        hostname: <your-domain>

        # IDP hostname for JWT JWKS fetching
        idp:
          host: login.microsoftonline.com  # hostname from jwt.providers.jwks_uri

        # Internal JWKS cluster — points to osmo-service for OSMO-issued JWTs
        internalJwks:
          enabled: true
          cluster: osmo-service-jwks
          host: osmo-service
          port: 80

        # JWT validation: configure providers for your IdP and (if using access tokens) for OSMO-issued tokens
        jwt:
          user_header: x-osmo-user
          providers:
          # Example: Microsoft Entra ID. Add or replace with your IdP (see identity_provider_setup).
          - issuer: https://login.microsoftonline.com/<tenant-id>/v2.0  # (1)
            audience: <client-id>
            jwks_uri: https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys
            user_claim: preferred_username
            cluster: idp
          # OSMO-issued JWTs (e.g. for access-token-based access)
          - issuer: osmo
            audience: osmo
            jwks_uri: http://osmo-service/api/auth/keys
            user_claim: unique_name
            cluster: osmo-service-jwks

      # OAuth2 Proxy configuration
      # Set OIDC issuer URL and client ID from your IdP (e.g. Microsoft Entra ID, Google). See identity_provider_setup.
      oauth2Proxy:
        enabled: true
        provider: oidc
        oidcIssuerUrl: https://login.microsoftonline.com/<tenant-id>/v2.0  # (2)
        clientId: <client-id>  # (3)
        cookieDomain: .<your-domain>
        scope: "openid email profile"
        useKubernetesSecrets: true
        secretName: oauth2-proxy-secrets
        clientSecretKey: client_secret
        cookieSecretKey: cookie_secret

      # Upstream services that the gateway routes to
      upstreams:
        service:
          host: osmo-service
          port: 80
        router:
          host: osmo-router
          port: 80
        ui:
          host: osmo-ui
          port: 80

  .. code-annotations::

    1. Issuer URL from your IdP. See :doc:`../appendix/authentication/identity_provider_setup` for provider-specific values.
    2. OIDC issuer URL from your IdP (same as the JWT issuer).
    3. Client ID from your IdP application registration.
    4. Static credentials path: see :ref:`Step 3 <configure_storage_access>`.

Create ``router_values.yaml`` for router with the following sample configurations:

.. TODO: Update this link to point to the public registry when we switch to GitHub.

.. dropdown:: ``router_values.yaml``
  :color: info
  :icon: file

  .. code-block:: yaml
    :emphasize-lines: 4, 22, 36

    # Global configuration shared across router services
    global:
      osmoImageLocation: nvcr.io/nvidia/osmo
      osmoImageTag: <version>

      logs:
        enabled: true
        logLevel: DEBUG
        k8sLogLevel: WARNING

    # Router service configurations
    services:
      # Configuration file service settings
      configFile:
        enabled: true

      # Router service configuration
      service:
        scaling:
          minReplicas: 1
          maxReplicas: 2
        hostname: <your-domain>
        # webserverEnabled: true  # (Optional): Enable for UI port forwarding
        serviceAccountName: router

        # Resource allocation
        resources:
          requests:
            cpu: "500m"
            memory: "512Mi"
          limits:
            memory: "512Mi"

      # PostgreSQL database configuration
      postgres:
        serviceName: <your-postgres-hostname>
        port: 5432
        db: osmo
        user: postgres

Create ``ui_values.yaml`` for ui with the following sample configurations:

.. TODO: Update this link to point to the public registry when we switch to GitHub.

.. dropdown:: ``ui_values.yaml``
  :color: info
  :icon: file

  .. code-block:: yaml
    :emphasize-lines: 4, 10-11

    # Global configuration shared across UI services
    global:
      osmoImageLocation: nvcr.io/nvidia/osmo
      osmoImageTag: <version>

    # UI service configurations
    services:
      # UI service configuration
      ui:
        hostname: <your-domain>
        apiHostname: osmo-gateway:80

        # Resource allocation
        resources:
          requests:
            cpu: "500m"
            memory: "512Mi"
          limits:
            memory: "512Mi"

.. important::
   Replace all ``<your-*>`` placeholders with your actual values before applying. You can find them in the highlighted sections in all the files above.

.. note::
   Refer to the `README <https://github.com/NVIDIA/OSMO/blob/main/deployments/charts/service/README.md>`_ page for detailed configuration options, including gateway configuration.


.. seealso::

   **Datasets (Optional)**

   To configure storage buckets for users to store OSMO datasets, see :ref:`dataset_buckets` in the Advanced Configuration section.


Step 5: Deploy Components
=========================

Deploy the components in the following order:

1. Deploy **API Service**:

.. code-block:: bash

   # add the helm repository
   $ helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo
   $ helm repo update

   # deploy the service
   $ helm upgrade --install service osmo/service -f ./osmo_values.yaml -n osmo

2. Deploy **Router**:

.. code-block:: bash

   $ helm upgrade --install router osmo/router -f ./router_values.yaml -n osmo

3. Deploy **UI**:

.. code-block:: bash

   $ helm upgrade --install ui osmo/web-ui -f ./ui_values.yaml -n osmo

Step 6: Verify Deployment
=========================

1. Verify all pods are running:

   .. code-block:: bash

    $ kubectl get pods -n osmo
    NAME                            READY   STATUS    RESTARTS       AGE
    osmo-agent-xxx                  2/2     Running   0              <age>
    osmo-delayed-job-monitor-xxx    1/1     Running   0              <age>
    osmo-logger-xxx                 2/2     Running   0              <age>
    osmo-router-xxx                 2/2     Running   0              <age>
    osmo-service-xxx                2/2     Running   0              <age>
    osmo-ui-xxx                     2/2     Running   0              <age>
    osmo-worker-xxx                 1/1     Running   0              <age>

2. Verify all services are running:

   .. code-block:: bash

    $ kubectl get services -n osmo
      NAME                TYPE           CLUSTER-IP        EXTERNAL-IP   PORT(S)           AGE
      osmo-agent          ClusterIP      xxx               <none>        80/TCP            <age>
      osmo-gateway        LoadBalancer   xxx               <external>    80/TCP,443/TCP    <age>
      osmo-logger         ClusterIP      xxx               <none>        80/TCP            <age>
      osmo-router         ClusterIP      xxx               <none>        80/TCP            <age>
      osmo-service        ClusterIP      xxx               <none>        80/TCP            <age>
      osmo-ui             ClusterIP      xxx               <none>        80/TCP            <age>

3. Verify gateway service:

   .. code-block:: bash

    $ kubectl get services -n osmo | grep gateway
      osmo-gateway        LoadBalancer   xxx               <external>    80/TCP,443/TCP    <age>

Step 7: Post-deployment Configuration
=====================================

1. Configure DNS records to point to the ``osmo-gateway`` service's external IP or hostname. For example, create a CNAME record for ``osmo.example.com`` pointing to the LoadBalancer hostname shown in ``kubectl get svc osmo-gateway -n osmo``.

2. Test authentication flow

3. Configure IdP role mapping to map your IdP groups to OSMO roles: :doc:`../appendix/authentication/idp_role_mapping`

4. Verify access to the UI at https://osmo.example.com through your domain


Troubleshooting
===============

1. Check pod status and logs:

   .. code-block:: bash

     kubectl get pods -n <namespace>

     # check if all pods are running, if not, check the logs for more details
     kubectl logs -f <pod-name> -n <namespace>

2. Common issues and their resolutions:

   * **Database connection failures**: Verify the database is running and accessible
   * **Authentication configuration issues**: Verify the authentication configuration is correct
   * **Gateway routing problems**: Verify the gateway pods are running and the ``osmo-gateway`` service has an external IP (``kubectl get svc osmo-gateway -n osmo``)
   * **Resource constraints**: Verify the resource limits are set correctly
   * **Missing secrets or incorrect configurations**: Verify the secrets are created correctly and the configurations are correct
