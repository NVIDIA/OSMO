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


.. _deploy_service_osmo_values:

Step 3: Prepare values
============================

Create a values file for each OSMO component.

.. seealso::

   See :doc:`../appendix/authentication/identity_provider_setup` for the IdP-specific values you need to configure (client ID, endpoints, JWKS URI) and :doc:`../appendix/authentication/authentication_flow` for the request flow.

Create ``osmo_values.yaml`` for the OSMO service with the following sample. Configure the ``oauth2Proxy``, ``jwt`` providers, and ``services.service.auth`` sections with your IdP's endpoints and client ID:

.. dropdown:: ``osmo_values.yaml``
  :color: info
  :icon: file

  .. code-block:: yaml
    :emphasize-lines: 4, 19-31, 38-46, 57, 148, 156-160, 192-202

    # Global configuration shared across all OSMO services
    global:
      osmoImageLocation: nvcr.io/nvidia/osmo
      osmoImageTag: <version>
      serviceAccountName: osmo

      logs:
        enabled: true
        logLevel: DEBUG
        k8sLogLevel: WARNING

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

      # Default admin (no IdP): enable to create an admin user and access token at startup
      defaultAdmin:
        enabled: false  # Set true when not using an IdP
        username: "admin"
        passwordSecretName: default-admin-secret
        passwordSecretKey: password

        # Ingress configuration
        ingress:
          ingressClass: <your-ingress-class>  # e.g. alb, nginx
          albAnnotations:
            enabled: false  # Set to true if using AWS ALB
            # sslCertArn: <your-ssl-cert-arn> # Set to the ARN of the SSL certificate for the ingress if using AWS ALB
          sslEnabled: false  # Set to true if managing SSL at the ingress level
          annotations:
            ## when using nginx ingress, add the following annotations to handle large OAuth2 response headers from identity providers
            # nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"
            # nginx.ingress.kubernetes.io/proxy-buffers: "8 16k"
            # nginx.ingress.kubernetes.io/proxy-busy-buffers-size: "32k"
            # nginx.ingress.kubernetes.io/large-client-header-buffers: "4 16k"
            ## when using AWS ALB in addtional to the default alb annotations,
            ## add the following annotations to specify the scheme of the ingress rules
            # alb.ingress.kubernetes.io/scheme: internet-facing # set to internal for private subnet ALB
            # alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS":443}]'
            # alb.ingress.kubernetes.io/ssl-redirect: '443'
        # Resource allocation
        resources:
          requests:
            cpu: "1"
            memory: "1Gi"
          limits:
            memory: "1Gi"

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

    # Sidecar container configurations
    sidecars:
      # Global Envoy proxy configuration
      envoy:
        enabled: true
        # Use Kubernetes secrets as reference for the OIDC secrets
        useKubernetesSecrets: true

        # Paths that don't require authentication
        skipAuthPaths:
        - /api/version
        - /api/auth/login
        - /api/auth/keys
        - /api/auth/refresh_token
        - /api/auth/jwt/refresh_token
        - /api/auth/jwt/access_token
        - /client/version

        # Service configuration
        service:
          port: 8000
          hostname: <your-domain>
          address: 127.0.0.1

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
            jwks_uri: http://localhost:8000/api/auth/keys
            user_claim: unique_name
            cluster: service


      # Log agent configuration (optional)
      logAgent:
        enabled: false
        # Uncomment and configure if using AWS CloudWatch
        # cloudwatch:
        #   enabled: true
        #   clusterName: <your-cluster-name>
        #   role: <your-aws-cloudwatch-role>

      # OpenTelemetry configuration (optional)
      otel:
        enabled: false

      # Rate limiting configuration (optional)
      rateLimit:
        enabled: false
        # Uncomment and configure if using rate limiting
        # redis:
        #   serviceName: <your-redis-host>
        #   port: 6379

      # OAuth2 Proxy sidecar configuration
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

  .. code-annotations::

    1. Issuer URL from your IdP. See :doc:`../appendix/authentication/identity_provider_setup` for provider-specific values.
    2. OIDC issuer URL from your IdP (same as the JWT issuer).
    3. Client ID from your IdP application registration.

Create ``router_values.yaml`` for router with the following sample configurations:

.. TODO: Update this link to point to the public registry when we switch to GitHub.

.. dropdown:: ``router_values.yaml``
  :color: info
  :icon: file

  .. code-block:: yaml
    :emphasize-lines: 4, 22, 29, 57-60, 77, 84-88, 99, 111-121

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

        # Ingress configuration
        ingress:
          prefix: /
          ingressClass: <your-ingress-class>  # e.g. alb, nginx
          albAnnotations:
            enabled: false  # Set to true if using AWS ALB
            # sslCertArn: arn:aws:acm:us-west-2:XXXXXXXXX:certificate/YYYYYYYY # (Optional): Set to the ARN of the SSL certificate for the ingress if using AWS ALB
          sslEnabled: false  # Set to true if managing SSL at the ingress level
          sslSecret: osmo-tls
          annotations:
            # when using nginx ingress, add the following annotations to handle large OAuth2 response headers from identity providers
            # nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"
            # nginx.ingress.kubernetes.io/proxy-buffers: "8 16k"
            # nginx.ingress.kubernetes.io/proxy-busy-buffers-size: "32k"
            # nginx.ingress.kubernetes.io/large-client-header-buffers: "4 16k"
            ## when using AWS ALB in addtional to the default alb annotations,
            ## add the following annotations to specify the scheme of the ingress rules
            # alb.ingress.kubernetes.io/scheme: internet-facing # set to internal for private subnet ALB
            # alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS":443}]'
            # alb.ingress.kubernetes.io/ssl-redirect: '443'

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

    # Sidecar container configurations
    sidecars:
      # Envoy proxy configuration
      envoy:
        enabled: true
        useKubernetesSecrets: true

        skipAuthPaths:
        - /api/router/version

        image: envoyproxy/envoy:v1.29.0
        imagePullPolicy: IfNotPresent

        # Service configuration
        service:
          hostname: <your-domain>

        # JWT validation: IdP provider(s) and OSMO-issued tokens
        jwt:
          enabled: true
          user_header: x-osmo-user
          providers:
          - issuer: https://login.microsoftonline.com/<tenant-id>/v2.0
            audience: <client-id>
            jwks_uri: https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys
            user_claim: preferred_username
            cluster: idp
          - issuer: osmo
            audience: osmo
            jwks_uri: http://osmo-service/api/auth/keys
            user_claim: unique_name
            cluster: osmoauth

        # OSMO auth service configuration
        osmoauth:
          enabled: true
          port: 80
          hostname: <your-domain>
          address: osmo-service

        # (Optional): Enable for UI port forwarding
        # routes:
        # - match:
        #     prefix: "/"
        #   route:
        #     cluster: service
        #     timeout: 0s

      # OAuth2 Proxy sidecar configuration
      oauth2Proxy:
        enabled: true
        provider: oidc
        oidcIssuerUrl: https://login.microsoftonline.com/<tenant-id>/v2.0
        clientId: <client-id>
        cookieDomain: .<your-domain>
        scope: "openid email profile"
        useKubernetesSecrets: true
        secretName: oauth2-proxy-secrets
        clientSecretKey: client_secret
        cookieSecretKey: cookie_secret

      # Log agent configuration (optional)
      logAgent:
        enabled: false
        # Uncomment and configure if using AWS CloudWatch
        # cloudwatch:
        #   region: us-west-2
        #   clusterName: <your-cluster-name>
        #   role: <your-aws-cloudwatch-role>


Create ``ui_values.yaml`` for ui with the following sample configurations:

.. TODO: Update this link to point to the public registry when we switch to GitHub.

.. dropdown:: ``ui_values.yaml``
  :color: info
  :icon: file

  .. code-block:: yaml
    :emphasize-lines: 4, 10, 15, 49, 57-61, 64-74

    # Global configuration shared across UI services
    global:
      osmoImageLocation: nvcr.io/nvidia/osmo
      osmoImageTag: <version>

    # UI service configurations
    services:
      # UI service configuration
      ui:
        hostname: <your-domain>

        # Ingress configuration
        ingress:
          prefix: /
          ingressClass: <your-ingress-class>  # e.g. alb, nginx
          albAnnotations:
            enabled: false  # Set to true if using AWS ALB
            # sslCertArn: arn:aws:acm:us-west-2:XXXXXXXXX:certificate/YYYYYYYY # (Optional): Set to the ARN of the SSL certificate for the ingress if using AWS ALB
          sslEnabled: false  # Set to true if managing SSL at the ingress level
          sslSecret: osmo-tls
          annotations:
            # when using nginx ingress, add the following annotations to handle large OAuth2 response headers from identity providers
            # nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"
            # nginx.ingress.kubernetes.io/proxy-buffers: "8 16k"
            # nginx.ingress.kubernetes.io/proxy-busy-buffers-size: "32k"
            # nginx.ingress.kubernetes.io/large-client-header-buffers: "4 16k"
            ## when using AWS ALB in addtional to the default alb annotations,
            ## add the following annotations to specify the scheme of the ingress rules
            # alb.ingress.kubernetes.io/scheme: internet-facing # set to internal for private subnet ALB
            # alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS":443}]'
            # alb.ingress.kubernetes.io/ssl-redirect: '443'

        # Resource allocation
        resources:
          requests:
            cpu: "500m"
            memory: "512Mi"
          limits:
            memory: "512Mi"

    sidecars:
      # Envoy proxy configuration
      envoy:
        enabled: true
        useKubernetesSecrets: true

        # Service configuration
        service:
          hostname: <your-domain>
          address: 127.0.0.1
          port: 8000

        # JWT configuration
        jwt:
          user_header: x-osmo-user
          providers:
          - issuer: https://login.microsoftonline.com/<tenant-id>/v2.0
            audience: <client-id>
            jwks_uri: https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys
            user_claim: preferred_username
            cluster: idp

      # OAuth2 Proxy sidecar configuration
      oauth2Proxy:
        enabled: true
        provider: oidc
        oidcIssuerUrl: https://login.microsoftonline.com/<tenant-id>/v2.0
        clientId: <client-id>
        cookieDomain: .<your-domain>
        scope: "openid email profile"
        useKubernetesSecrets: true
        secretName: oauth2-proxy-secrets
        clientSecretKey: client_secret
        cookieSecretKey: cookie_secret

      # Log agent configuration (optional only used for AWS CloudWatch)
      logAgent:
        enabled: false
        # Uncomment and configure if using AWS CloudWatch
        # aws:
        #   region: us-west-2
        #   clusterName: <your-cluster-name>

.. important::
   Replace all ``<your-*>`` placeholders with your actual values before applying. You can find them in the highlighted sections in all the files above.

.. note::
   Refer to the `README <https://github.com/NVIDIA/OSMO/blob/main/deployments/charts/service/README.md>`_ page for detailed configuration options.

Similar values files should be created for other components (Router, UI) with their specific configurations.

Step 4: Deploy Components
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

Step 5: Verify Deployment
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
      NAME           TYPE        CLUSTER-IP        EXTERNAL-IP   PORT(S)   AGE
      osmo-agent     ClusterIP   xxx               <none>        80/TCP    <age>
      osmo-logger    ClusterIP   xxx               <none>        80/TCP    <age>
      osmo-router    ClusterIP   xxx               <none>        80/TCP    <age>
      osmo-service   ClusterIP   xxx               <none>        80/TCP    <age>
      osmo-ui        ClusterIP   xxx               <none>        80/TCP    <age>

3. Verify ingress configuration:

   .. code-block:: bash

    $ kubectl get ingress -n osmo
    NAME           CLASS   HOSTS                          ADDRESS         PORTS     AGE
    osmo-agent     nginx   <your-domain>                  <lb-ip>        80, 443    <age>
    osmo-logger    nginx   <your-domain>                  <lb-ip>        80, 443    <age>
    osmo-router    nginx   <your-domain>                  <lb-ip>        80, 443    <age>
    osmo-service   nginx   <your-domain>                  <lb-ip>        80, 443    <age>
    osmo-ui        nginx   <your-domain>                  <lb-ip>        80, 443    <age>
    osmo-ui-trpc   nginx   <your-domain>                  <lb-ip>        80, 443    <age>

Step 6: Post-deployment Configuration
=====================================

1. Configure DNS records to point to your load balancer. For example, create a record for ``osmo.example.com`` to point to the load balancer IP.

2. Test authentication flow

3. Configure IdP role mapping to map your IdP groups to OSMO roles: :doc:`../appendix/authentication/idp_role_mapping`

4. Verify access to the UI at https://osmo.example.com through your domain

5. Create and configure data storage to store service data: :ref:`configure_data`


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
   * **Ingress routing problems**: Verify the ingress is configured correctly
   * **Resource constraints**: Verify the resource limits are set correctly
   * **Missing secrets or incorrect configurations**: Verify the secrets are created correctly and the configurations are correct
