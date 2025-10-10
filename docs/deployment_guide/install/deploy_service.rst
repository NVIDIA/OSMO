..
  SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
Service Deployment
============================

This guide provides step-by-step instructions for deploying OSMO on a Kubernetes cluster.

Prerequisites
==============

* Kubernetes cluster with version 1.27 or higher

  * Sample terraform setup for AWS or Azure is available in our repository at ``/deployments/terraform/aws/example`` or ``/deployments/terraform/azure/example`` directory

  .. TODO: Update this link to point to the GitHub repository when we switch to GitHub.

* Helm 3.x installed
* Access to the NGC container registry: ``nvcr.io/nvidia/osmo/``
* Kubernetes load balancer (see the `Kubernetes Ingress Controllers <https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/>`_) installed in your Kubernetes cluster
* Fully Qualified Domain Name (FQDN) and a certificate for your domain (i.e., ``osmo.my-domain.com``). When using keycloak as the SSO provider, an additional FQDN and certificate for the keycloak instance (i.e., ``auth-osmo.my-domain.com``) is required.
* (Optional) FQDN and a certificate for wildcard subdomain (i.e., ``*.osmo.my-domain.com``) for UI port forwarding


Components Overview
====================

OSMO deployment consists of several main components:

1. OSMO Service
2. Router Service
3. Web UI Service

Step 1: Configure Dependencies
===============================

Database Setup
--------------

1. Set up a PostgreSQL database instance (minimum version 15)
2. Note down the following details:

   * Host address
   * Database name
   * Username
   * Password

3. Create a database for OSMO

.. code-block:: bash

   $ psql -U postgres -h your-db-host -p 5432 -d postgres
   $ CREATE DATABASE osmo_db;

Redis Setup
-----------

1. Set up a Redis instance (minimum version 7.0)
2. Note down the following details:

   * Host address
   * Port (default: 6379)
   * Password

.. note::
   A sample terraform setup including a PostgreSQL and Redis is available in our repository at ``/deployments/terraform/aws/example`` or ``/deployments/terraform/azure/example`` directory

  .. TODO: Update this link to point to the GitHub repository when we switch to GitHub.

Step 2: Configure SSO Authentication
=====================================

Set up Keycloak or an OAuth SSO service to control access for OSMO:

Keycloak
--------

For more details of keycloak
setup see the `Keycloak Documentation <https://github.com/bitnami/charts/blob/main/bitnami/keycloak/values.yaml>`_
and follow the steps below to set up Keycloak.

Learn more at :ref:`authentication_flow_with_keycloak`.

A sample values file for deploying Keycloak is available on NGC resources.

1. Set up Keycloak using Bitnami Helm chart:

   a. Add the Bitnami Helm repository:

   .. code-block:: bash

      helm repo add bitnami https://charts.bitnami.com/bitnami
      helm repo update

   b. Create a ``keycloak-values.yaml`` file with the following configuration:

   .. code-block:: yaml

      # Override the default image to use our own registry to not rely on the bitnami registry
      global:
        security:
          allowInsecureImages: true

      image:
        registry: docker.io
        repository: bitnamilegacy/keycloak
        tag: 26.1.1-debian-12-r0

      # Hostname configuration
      hostname: auth-[your-domain]
      proxy: edge

      # Production mode
      production: true

      # Admin user credentials
      auth:
        adminUser: admin
        adminPassword: your-secure-password  # Change this!

      # Ingress configuration
      ingress:
        enabled: true
        tls: true
        ingressClassName: [your-ingress-class]  # e.g., nginx, alb
        hostname: auth-[your-domain]
        annotations:
          # Add your ingress-specific annotations here
        path: /
        pathType: Prefix
        servicePort: 80

      # Autoscaling configuration
      autoscaling:
        enabled: true
        minReplicas: 2
        maxReplicas: 3
        targetCPU: 80
        targetMemory: 80

      # Resource allocation
      resources:
        requests:
          cpu: "500m"
          memory: "512Mi"
        limits:
          cpu: "2"
          memory: "1Gi"

      # Database configuration
      # Option 1: Built-in PostgreSQL (for testing)
      postgresql:
        enabled: true  # Set to false if using external database

      # Option 2: External Database
      # postgresql:
      #   enabled: false
      # externalDatabase:
      #   host: "[your-db-host]"
      #   port: 5432
      #   user: "[your-db-user]"
      #   database: "keycloak"
      #   existingSecret: "keycloak-db-secret"
      #   existingSecretPasswordKey: "postgres-password"

      # Additional environment variables
      extraEnvVars:
        - name: KC_HOSTNAME_STRICT_HTTPS
          value: "true"
        - name: KC_PROXY
          value: "edge"

   c. If using an external database, create a secret for the database password:

   .. code-block:: bash

      $ kubectl create secret generic keycloak-db-secret \
        --namespace [your-namespace] \
        --from-literal=postgres-password='[your-db-password]'

   d. Create the Keycloak database in PostgreSQL if using an external database:

   .. code-block:: bash

      $ psql -U postgres -h [your-db-host] -p 5432 -d postgres
      $ CREATE DATABASE keycloak;

   e. Install Keycloak using Helm:

   .. code-block:: bash

      $ helm install keycloak bitnami/keycloak \
        --namespace [your-namespace] \
        --create-namespace \
        -f keycloak-values.yaml

   f. Verify the installation:

   .. code-block:: bash

      $ kubectl get pods -n [your-namespace]
      $ kubectl get ingress -n [your-namespace]

2. Post-Installation Keycloak Configuration:

   a. Access your Keycloak instance at ``https://auth-<example.com>``
   b. Log in with the admin credentials specified in the values file
   c. Create a new realm for OSMO using the example realm file: :download:`sample_osmo_realm.json <sample_osmo_realm.json>`
   d. Update client settings for ``osmo-browser-flow`` and ``osmo-device`` in keycloak for OSMO application:

      * Client ID: osmo-browser-flow and osmo-device
      * Root URL: https://<example.com>
      * Home URL: https://<example.com>
      * Admin URL: https://<example.com>
      * Valid Redirect URIs: https://<example.com>/*
      * Web Origins: https://<example.com>

   e. Configure the client secret from the Credentials tab to use when deploying OSMO, this will be used as a secret when deploying OSMO.

3. Creating Users:

 * Users can be created directly in the Keycloak admin console. There are two options to create users:

   * Creating user and with their email and temporary password, during first login, they will be prompted to reset their password.
      1. Go to the Users tab
      2. Click on the "Add User" button
      3. Fill in the user details, add the user to the group "User" and save the user
      4. Click on the user's ID to access their settings, in the Credentials tab enter a password and confirm it with the temporary password setting enabled
      5. When the temporary password setting is enabled, the user will be forced to change their password upon their first login

   * Creating user and allowing them self-service password reset via email. This requires a smtp email server to be configured in the Keycloak realm configuration.
      1. Go to the Users tab
      2. Click on the "Add User" button
      3. Fill in the user details, add the user to the group "User" and save the user
      4. In the realm settings, under login, enable the "Forgot password" option.
      5. Users will be able to reset their password upon their first login.

 * Keycloak can also be configured to log in with an identity provider. Follow the `official Keycloak documentation <https://www.keycloak.org/docs/latest/server_admin/index.html#_identity_broker>`__.

..
   Identity Provider (IdP)
   -----------------------

   Learn more at :ref:`authentication_flow_with_idp`.

   1. Fetch your IdP application details. For example, if you are using Microsoft Azure AD, you can follow the steps below:

      a. Go to the Azure portal and go to App registrations.
      b. Click on the application you want to use for OSMO.
      c. Click on the "Overview" tab.
      d. Note down the following details:

         * Application (client) ID
         * Directory (tenant) ID

   2. Configure the auth URL in your OSMO values file:

      .. code-block:: yaml

         auth:
           enabled: true
           device_endpoint: <device code endpoint>
           device_client_id: <application-id>
           browser_endpoint: <authorization endpoint>
           browser_client_id: <application-id>
           token_endpoint: <token endpoint>
           logout_endpoint: <logout endpoint>

   For example, if you are using Microsoft Azure AD, you can follow the steps below:

      .. code-block:: yaml

         auth:
           enabled: true
           device_endpoint: https://login.microsoftonline.com/<directory-id>/oauth2/v2.0/devicecode
           device_client_id: <application-id>
           browser_endpoint: https://login.microsoftonline.com/<directory-id>/oauth2/v2.0/authorize
           browser_client_id: <application-id>
           token_endpoint: https://login.microsoftonline.com/<directory-id>/oauth2/v2.0/token
           logout_endpoint: https://login.microsoftonline.com/<directory-id>/oauth2/v2.0/logout

No Authentication
-----------------

.. important::

  This is not recommended for production environments. When auth is disabled, if your dns is accessible from the internet, all users will be able to access all OSMO APIs.

During the values file creation, you can disable envoy sidecar to disable authentication. For example:

.. code-block:: yaml

  sidecars:
    envoy:
      enabled: false

Step 3: Prepare Secrets
========================

Create a secret for pulling images from NVIDIA's container registry:

.. code-block:: bash

   $ kubectl create secret docker-registry imagepullsecret \
     --docker-server=nvcr.io \
     --docker-username=\$oauthtoken \
     --docker-password=<ngc-token> \
     --namespace osmo

Create secret for database and redis passwords:

.. code-block:: bash

   $ kubectl create secret generic db-secret --from-literal=db-password=<your-db-password> --namespace osmo
   $ kubectl create secret generic redis-secret --from-literal=redis-password=<your-redis-password> --namespace osmo

Create a secret with Keycloak client secret and HMAC secret to use with OSMO envoy sidecar:

.. code-block:: bash

   $ kubectl create secret generic oidc-secrets \
     --from-literal=client_secret=<keycloak-client-secret> \
     --from-literal=hmac_secret=$(head -c32 /dev/urandom | base64) \
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

   # Take the JWK output from step 2 and base64 encode it
   $ export JWK_JSON='{"k":"<your-base64-key>","kid":"key1","kty":"oct"}'
   $ export ENCODED_JWK=$(echo -n "$JWK_JSON" | base64 | tr -d '\n')
   echo $ENCODED_JWK

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
   - Use a secure key management system, such as Vault in production
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

   $ echo "Generated JWK: $JWK_JSON"
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


Step 4: Prepare Values
============================
Create a values files for each OSMO component

.. note::

   - README page for all of our values files is also available in our helm chart repo.
   - A sample values file for each OSMO component is available on NGC resources.

Create ``osmo_values.yaml`` for osmo with the following sample configurations:

.. TODO: Update this link to point to the public registry when we switch to GitHub.

.. code-block:: yaml

  # Global configuration shared across all OSMO services
  global:
    osmoImageLocation: nvcr.io/nvidia/osmo
    osmoImageTag: <version>
    imagePullSecret: imagepullsecret
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
      path: /opt/osmo/config.yaml # (1)

    # PostgreSQL database configuration
    postgres:
      enabled: false  # Set to false if using external PostgreSQL
      serviceName: <your-postgres-host>
      port: 5432
      db: <your-database-name>
      user: <your-database-user>

    # Redis cache configuration
    redis:
      enabled: false  # Set to false when using external Redis
      serviceName: <your-redis-host>
      port: 6379
      tlsEnabled: false  # Set to true if your Redis requires TLS

    # Main API service configuration
    service:
      scaling:
        minReplicas: 1
        maxReplicas: 3
        hpaTarget: 80
      hostname: <your-domain>

      # Ingress configuration
      ingress:
        ingressClass: <your-ingress-class>  # e.g. alb, nginx
        albAnnotations:
          enabled: false  # Set to true if using AWS ALB
        sslEnabled: false  # Set to true if managing SSL at the ingress level
        annotations: {}

      # Resource allocation
      resources:
        requests:
          cpu: "1"
          memory: "1Gi"
        limits:
          memory: "2Gi"

    # Worker service configuration
    worker:
      scaling:
        minReplicas: 1
        maxReplicas: 3
        hpaTarget: 80
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
        hpaTarget: 80
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
        hpaTarget: 80
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
      useKubernetesSecrets: true # (2)

      # Paths that don't require authentication
      skipAuthPaths:
      - /api/version
      - /api/auth/login
      - /api/auth/keys
      - /api/auth/refresh_token
      - /api/auth/jwt/refresh_token
      - /api/auth/jwt/access_token
      - /client/osmo_client
      - /client/install.sh
      - /client/version
      - /client/pypi/simple

      # Service configuration
      service:
        port: 8000
        hostname: <your-domain>
        address: 127.0.0.1

      # OAuth2 filter configuration
      oauth2Filter:
        enabled: true
        tokenEndpoint: https://auth-<your-domain>/realms/osmo/protocol/openid-connect/token # (3)
        authEndpoint: https://auth-<your-domain>/realms/osmo/protocol/openid-connect/auth
        clientId: osmo-browser-flow
        authProvider: auth-<your-domain>
        secretName: oidc-secrets
        clientSecretKey: client_secret
        hmacSecretKey: hmac_secret

      # JWT configuration
      jwt:
        user_header: x-osmo-user
        providers:
        - issuer: https://auth-<your-domain>/realms/osmo
          audience: osmo-device
          jwks_uri: https://auth-<your-domain>/realms/osmo/protocol/openid-connect/certs
          user_claim: preferred_username
          cluster: oauth
        - issuer: https://auth-<your-domain>/realms/osmo
          audience: osmo-browser-flow
          jwks_uri: https://auth-<your-domain>/realms/osmo/protocol/openid-connect/certs
          user_claim: preferred_username
          cluster: oauth
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

.. code-annotations::

   (1) This is the path to the MEK configuration file.
   (2) This is specifically used for using Kubernetes secrets for the OIDC secrets.
   (3) This example is used when keycloak is configured with and oidc provider.

Create ``router_values.yaml`` for router with the following sample configurations:

.. TODO: Update this link to point to the public registry when we switch to GitHub.

.. code-block:: yaml

    # Global configuration shared across router services
    global:
      osmoImageLocation: nvcr.io/nvidia/osmo
      osmoImageTag: <version>
      imagePullSecret: imagepullsecret

      logs:
        enabled: true
        logLevel: DEBUG
        k8sLogLevel: WARNING

    # Router service configurations
    services:
      # Configuration file service settings
      configFile:
        enabled: true
        path: /opt/osmo/config.yaml

      # Router service configuration
      service:
        scaling:
          minReplicas: 3
          maxReplicas: 5
          memoryTarget: 80
        hostname: <your-domain>
        # webserverEnabled: true  # (Optional): Enable for UI port forwarding
        serviceAccountName: router

        # Ingress configuration
        ingress:
          prefix: /
          ingressClass: <your-ingress-class>  # e.g. alb, nginx
          albAnnotations:
            enabled: false  # Set to true if using AWS ALB
            sslCertArn: arn:aws:acm:us-west-2:XXXXXXXXX:certificate/YYYYYYYY
          sslEnabled: false  # Set to true if managing SSL at the ingress level
          sslSecret: osmo-tls
          annotations: {}

        # Resource allocation
        resources:
          requests:
            cpu: "500m"
            memory: "512Mi"
          limits:
            cpu: "1000m"
            memory: "1Gi"

      # PostgreSQL database configuration
      postgres:
        serviceName: <your-postgres-hostname>
        port: 5432
        db: <your-postgres-db>
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
        listenerPort: 80
        maxHeadersSizeKb: 128
        logLevel: info

        # Service configuration
        service:
          port: 8000
          hostname: <your-domain>
          address: 127.0.0.1

        # OAuth2 filter configuration
        oauth2Filter:
          enabled: true
          forwardBearerToken: true
          tokenEndpoint: https://auth-<your-domain>/realms/osmo/protocol/openid-connect/token
          authEndpoint: https://auth-<your-domain>/realms/osmo/protocol/openid-connect/auth
          clientId: osmo-browser-flow
          authProvider: auth-<your-domain>
          redirectPath: api/auth/getAToken
          logoutPath: logout
          secretName: oidc-secrets
          clientSecretKey: client_secret
          hmacSecretKey: hmac_secret

        # JWT configuration
        jwt:
          enabled: true
          user_header: x-osmo-user
          providers:
          - issuer: https://auth-<your-domain>/realms/osmo
            audience: osmo-device
            jwks_uri: https://auth-<your-domain>/realms/osmo/protocol/openid-connect/certs
            user_claim: preferred_username
            cluster: oauth
          - issuer: https://auth-<your-domain>/realms/osmo
            audience: osmo-browser-flow
            jwks_uri: https://auth-<your-domain>/realms/osmo/protocol/openid-connect/certs
            user_claim: preferred_username
            cluster: oauth
          - issuer: osmo
            audience: osmo
            jwks_uri: http://localhost:8000/api/auth/keys
            user_claim: unique_name
            cluster: service

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

        # Resource allocation for Envoy
        resources:
          requests:
            cpu: "100m"
            memory: "64Mi"
          limits:
            memory: "128Mi"

      # Log agent configuration (optional)
      logAgent:
        enabled: false
        # Uncomment and configure if using AWS CloudWatch
        # image: fluent/fluent-bit:4.0.8-debug
        # cloudwatch:
        #   region: us-west-2
        #   clusterName: <your-cluster-name>
        #   role: <your-aws-cloudwatch-role>


Create ``ui_values.yaml`` for ui with the following sample configurations:

.. TODO: Update this link to point to the public registry when we switch to GitHub.

.. code-block:: yaml

    # Global configuration shared across UI services
    global:
      osmoImageLocation: nvcr.io/nvidia/osmo
      osmoImageTag: <version>
      imagePullSecret: imagepullsecret
      nodeSelector:
        kubernetes.io/arch: amd64
      logs:
        enabled: true

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
            sslCertArn: arn:aws:acm:us-west-2:XXXXXXXXX:certificate/YYYYYYYY
          sslEnabled: false  # Set to true if managing SSL at the ingress level
          sslSecret: osmo-tls
          annotations: {}

        # Resource allocation
        resources:
          requests:
            cpu: "500m"
            memory: "512Mi"
          limits:
            cpu: "1000m"
            memory: "1Gi"

      # Envoy proxy configuration
      envoy:
        enabled: true
        useKubernetesSecrets: true

        # Resource allocation for Envoy
        resources:
          requests:
            cpu: "100m"
            memory: "64Mi"
          limits:
            memory: "128Mi"

        # Service configuration
        service:
          port: 8000
          hostname: <your-domain>
          address: 127.0.0.1

        # OAuth2 filter configuration
        oauth2Filter:
          enabled: true
          tokenEndpoint: https://auth-<your-domain>/realms/osmo/protocol/openid-connect/token
          authEndpoint: https://auth-<your-domain>/realms/osmo/protocol/openid-connect/auth
          redirectPath: getAToken
          clientId: osmo-browser-flow
          authProvider: auth-<your-domain>
          logoutPath: logout
          secretName: oidc-secrets
          clientSecretKey: client_secret
          hmacSecretKey: hmac_secret

        # JWT configuration
        jwt:
          user_header: x-osmo-user
          providers:
          - issuer: https://auth-<your-domain>/realms/osmo
            audience: osmo-device
            jwks_uri: https://auth-<your-domain>/realms/osmo/protocol/openid-connect/certs
            user_claim: unique_name
            cluster: oauth
          - issuer: https://auth-<your-domain>/realms/osmo
            audience: osmo-browser-flow
            jwks_uri: https://auth-<your-domain>/realms/osmo/protocol/openid-connect/certs
            user_claim: preferred_username
            cluster: oauth

      # Log agent configuration (optional only used for AWS CloudWatch)
      logAgent:
        enabled: false
        # Uncomment and configure if using AWS CloudWatch
        # aws:
        #   region: us-west-2
        #   clusterName: <your-cluster-name>

.. note::
   Replace all ``<your-*>`` placeholders with your actual values before applying.

For full configurations, please refer to the helm chart README page or the sample values files.

Similar values files should be created for other components (Router, UI, Docs) with their specific configurations.

Step 4: Deploy Components
=========================

Deploy the components in the following order:

1. Create namespace:

.. code-block:: bash

   kubectl create namespace osmo

2. Create secrets:

.. code-block:: bash

   # Postgres
   kubectl create secret generic db-secret --from-literal=db-password=<your-database-password> -n osmo

   # Redis
   kubectl create secret generic redis-secret --from-literal=redis-password=<your-redis-password> -n osmo

   # Image pull secrets
   kubectl create secret docker-registry imagepullsecret --docker-server=nvcr.io --docker-username=<your-username> --docker-password=<your-password> -n osmo

3. Deploy OSMO Service:

.. code-block:: bash

   # add the helm repository
   helm repo add osmo https://helm.ngc.nvidia.com/nvidian/osmo \
     --username \$oauthtoken \
     --password <ngc-token>
   helm repo update

   # deploy the service
   helm upgrade --install service osmo/service -f ./osmo_values.yaml -n osmo

5. Deploy Router:

.. code-block:: bash

   helm upgrade --install router osmo/router -f ./router_values.yaml -n osmo

6. Deploy UI:

.. code-block:: bash

   helm upgrade --install ui osmo/web-ui -f ./ui_values.yaml -n osmo

Step 5: Verify Deployment
=========================

1. Check pod status:

.. code-block:: bash

   kubectl get pods -n osmo

2. Verify services are running:

.. code-block:: bash

   kubectl get services -n osmo

3. Check ingress configuration:

.. code-block:: bash

   kubectl get ingress -n osmo

Step 6: Post-deployment Configuration
=====================================

1. Configure DNS records to point to your load balancer

2. Test authentication flow

3. Verify access to the UI through your domain

4. Configure osmo service to register compute backends, pools and data backends

   - :ref:`register_cb` - Register compute backends with OSMO
   - :ref:`register_pool` - Register pools for user access control
   - :ref:`ds_bucket` - Register data storage buckets


Troubleshooting
===============

1. Check pod status and logs:

.. code-block:: bash

   kubectl get pods -n <namespace>
   # check if all pods are running, if not, check the logs for more details
   kubectl logs -f <pod-name> -n <namespace>

2. Common issues:

   * Database connection failures
   * Authentication configuration issues
   * Ingress routing problems
   * Resource constraints
   * Missing secrets or incorrect configurations
