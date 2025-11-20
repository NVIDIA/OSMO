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

.. _deploy_minimal:

============================
Minimal Deployment
============================

This guide provides instructions for deploying OSMO in a minimal configuration suitable for testing, development, and evaluation purposes. This setup of OSMO creates the service and backend operator in the same kubernetes cluster, is suitable for single-tenant, has no authentication, and is designed for quick setup and experimentation.

.. warning::
   Minimal deployment is **not** recommended for production use as it lacks authentication and has limited features.

Overview
========

The minimal OSMO deployment includes:

* API Service
* Web UI
* Router
* External PostgreSQL database (configurable)
* External Redis cache (configurable)
* No authentication or authorization
* Single namespace deployment
* Single replica per service
* Minimal resource requirements

.. image:: deploy_minimal.svg
   :align: center
   :width: 80%

Prerequisites
=============

Refer to :ref:`prerequisites` for the setup of the Kubernetes cluster, PostgreSQL database, and Redis instance.

.. note::

  Ingress must be installed as part of networking setup to use exec or port forwarding features in OSMO workflows.

Step 1: Create Namespace
========================

Create a dedicated namespace to deploy OSMO service:

.. code-block:: bash

   $ kubectl create namespace osmo-minimal

Step 2: Add Helm Repository
==================================

Add the NVIDIA OSMO Helm repository:

.. code-block:: bash

   $ helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo

   $ helm repo update

Step 3: Create K8s Secrets
=================================

Create secret for database and redis passwords:

.. code-block:: bash

   $ kubectl create secret generic db-secret --from-literal=db-password=<your-db-password> --namespace osmo-minimal
   $ kubectl create secret generic redis-secret --from-literal=redis-password=<your-redis-password> --namespace osmo-minimal

Create the master encryption key (MEK) for database encryption:

1. **Generate a new master encryption key**:

   The MEK should be a JSON Web Key (JWK) with the following format:

   .. code-block:: json

     {"k":"<base64-encoded-32-byte-key>","kid":"key1","kty":"oct"}

2. **Generate the key using OpenSSL**:

   .. code-block:: bash

      # Generate a 32-byte (256-bit) random key and base64 encode it
      RANDOM_KEY=$(openssl rand -base64 32 | tr -d '\n')

      # Create the JWK format
      echo "{\"k\":\"$RANDOM_KEY\",\"kid\":\"key1\",\"kty\":\"oct\"}"

3. **Base64 encode the entire JWK**:

   .. code-block:: bash

      # Take the JWK output from step 2 and base64 encode it
      JWK_JSON='{"k":"<your-base64-key>","kid":"key1","kty":"oct"}'
      ENCODED_JWK=$(echo -n "$JWK_JSON" | base64 | tr -d '\n')
      echo $ENCODED_JWK

4. **Create the ConfigMap with your generated MEK**:

   .. code-block:: bash

     $ kubectl apply -f - <<EOF
     apiVersion: v1
     kind: ConfigMap
     metadata:
       name: mek-config
       namespace: osmo-minimal
     data:
       mek.yaml: |
         currentMek: key1
         meks:
           key1: $ENCODED_JWK
     EOF

.. admonition:: Security Considerations
  :class: important

  - Store the original JWK securely as you'll need it for backups and recovery
  - Never commit the MEK to version control
  - Use a secure key management system, such as Vault in production
  - The MEK is used to encrypt sensitive data in the database

**Example MEK generation script**:

.. code-block:: bash

   #!/bin/bash
   # Generate MEK for OSMO

   # Generate random 32-byte key
   RANDOM_KEY=$(openssl rand -base64 32 | tr -d '\n')

   # Create JWK
   JWK_JSON="{\"k\":\"$RANDOM_KEY\",\"kid\":\"key1\",\"kty\":\"oct\"}"

   # Base64 encode the JWK
   ENCODED_JWK=$(echo -n "$JWK_JSON" | base64 | tr -d '\n')

   echo "Generated JWK: $JWK_JSON"
   echo "Encoded JWK: $ENCODED_JWK"

   # Create ConfigMap
   $ kubectl apply -f - <<EOF
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: mek-config
     namespace: osmo-minimal
   data:
     mek.yaml: |
       currentMek: key1
       meks:
         key1: $ENCODED_JWK
   EOF

Step 4: Configure PostgreSQL
============================

Create a database for OSMO using the following command.

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
             - "PGPASSWORD=$OSMO_PGPASSWORD psql -U postgres -h $OSMO_DB_HOST -p 5432 -d postgres -c 'CREATE DATABASE osmo_db;'"
       restartPolicy: Never
     EOF

.. note::

   Ignore ``export OSMO_PGPASSWORD=<your-postgres-password>`` and ``PGPASSWORD=$OSMO_PGPASSWORD`` if your PostgreSQL was configured without a password.

Verify that the process ``Completed`` with ``kubectl get pod osmo-db-ops``. Then delete the pod with:

.. code-block:: bash

   $ kubectl delete pod osmo-db-ops

Step 5: Prepare Service Values
====================================

Create the following values files for the minimal deployment:

**API Service Values** (``osmo_values.yaml``):

.. dropdown:: ``osmo_values.yaml``
  :color: info
  :icon: file

  .. code-block:: yaml
    :emphasize-lines: 2,3,14,17,24

    global:
      osmoImageLocation: <insert-osmo-image-registry>
      osmoImageTag: <insert-osmo-image-tag>

    services:
      configFile:
        enabled: true

      postgres:
        # Set to true if you want Postgres to be deployed as
        # part of the OSMO install, otherwise set to false to
        # use an external Postgres database
        enabled: false
        serviceName: <your-postgres-host>

        # This should match the database name in the prior configuration step
        db: osmo_db

      redis:
        # Set to true if you want Redis to be deployed as
        # part of the OSMO install, otherwise set to false to
        # use an external Redis cache
        enabled: false
        serviceName: <your-redis-host>
        port: 6379
        tlsEnabled: true # Set to false if your Redis does not require TLS

      service:
        scaling:
          minReplicas: 1
          maxReplicas: 1

        # Set your domain for ingress if you want to enable ingress for external access
        # hostname: <your-domain>
        ingress:
          enabled: false  # Set to true if you want to enable ingress for external access

          # Example: Using alb as ingress
          # ingress:
          #   enabled: true
          #   ingressClass: alb
          #   sslEnabled: true
          #   albAnnotations:
          #     enabled: true
          #     sslCertArn: <your-ssl-cert-arn>
          #   annotations:
          #     ## the alb scheme is used to specify the scheme of the ingress rule, internet-facing for public ALB and internal for private ALB
          #     # alb.ingress.kubernetes.io/scheme: internet-facing

          # Example: Using nginx as ingress
          # ingress:
          #   enabled: true
          #   ingressClass: nginx
          #   annotations:
          #     nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"
          #     nginx.ingress.kubernetes.io/proxy-buffers: "8 16k"
          #     nginx.ingress.kubernetes.io/proxy-busy-buffers-size: "32k"
          #     nginx.ingress.kubernetes.io/large-client-header-buffers: "4 16k"

      agent:
        scaling:
          minReplicas: 1
          maxReplicas: 1

      worker:
        scaling:
          minReplicas: 1
          maxReplicas: 1

      logger:
        scaling:
          minReplicas: 1
          maxReplicas: 1

    sidecars:
      envoy:
        enabled: false

      logAgent:
        enabled: false

        logrotate:
          enabled: false

      otel:
        enabled: false

      rateLimit:
        enabled: false

**UI Service Values** (``ui_values.yaml``):

.. dropdown:: ``ui_values.yaml``
  :color: info
  :icon: file

  .. code-block:: yaml
    :emphasize-lines: 2,3,8

    global:
      osmoImageLocation: <insert-osmo-image-registry>
      osmoImageTag: <insert-osmo-image-tag>

    services:
      ui:
        # Set your domain for UI ingress if you want to enable ingress for external access
        # hostname: <your-domain>

        apiHostname: osmo-service.osmo-minimal.svc.cluster.local:80 # update to your namespace if not using osmo-minimal namespace

        ingress:
          enabled: false  # Set to true if you want to enable ingress for external access

        # Example: Using alb as ingress
        # ingress:
        #   enabled: true
        #   ingressClass: alb
        #   sslEnabled: true
        #   albAnnotations:
        #     enabled: true
        #     sslCertArn: <your-ssl-cert-arn>
        #   annotations:
        #     ## the alb scheme is used to specify the scheme of the ingress rule, internet-facing for public ALB and internal for private ALB
        #     # alb.ingress.kubernetes.io/scheme: internet-facing

        # Example: Using nginx as ingress
        # ingress:
        #   enabled: true
        #   ingressClass: nginx
        #   annotations:
        #     nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"
        #     nginx.ingress.kubernetes.io/proxy-buffers: "8 16k"
        #     nginx.ingress.kubernetes.io/proxy-busy-buffers-size: "32k"
        #     nginx.ingress.kubernetes.io/large-client-header-buffers: "4 16k"

    sidecars:
      envoy:
        enabled: false

**Router Service Values** (``router_values.yaml``):

.. dropdown:: ``router_values.yaml``
  :color: info
  :icon: file

  .. code-block:: yaml
    :emphasize-lines: 2,3,10,13

    global:
      osmoImageLocation: <insert-osmo-image-registry>
      osmoImageTag: <insert-osmo-image-tag>

    services:
      configFile:
        enabled: true

      postgres:
        serviceName: <your-postgres-host>

        # This should match the database name in the prior configuration step
        db: osmo_db

      service:
        scaling:
          minReplicas: 1
          maxReplicas: 1
        # Set your domain for router ingress if you want to enable ingress for external access
        # hostname: <your-domain>
        ingress:
          enabled: false  # Set to true if you want to enable ingress for external access

          # Example: Using alb as ingress
          # ingress:
          #   enabled: true
          #   ingressClass: alb
          #   sslEnabled: true
          #   albAnnotations:
          #     enabled: true
          #     sslCertArn: <your-ssl-cert-arn>
          #   annotations:
          #     ## the alb scheme is used to specify the scheme of the ingress rule, internet-facing for public ALB and internal for private ALB
          #     # alb.ingress.kubernetes.io/scheme: internet-facing

          # Example: Using nginx as ingress
          # ingress:
          #   enabled: true
          #   ingressClass: nginx
          #   annotations:
          #     nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"
          #     nginx.ingress.kubernetes.io/proxy-buffers: "8 16k"
          #     nginx.ingress.kubernetes.io/proxy-busy-buffers-size: "32k"
          #     nginx.ingress.kubernetes.io/large-client-header-buffers: "4 16k"

    sidecars:
      envoy:
        enabled: false

      logAgent:
        enabled: false

      otel:
        enabled: false

.. important::

   1. Replace ``<insert-osmo-image-tag>`` with the desired OSMO version you want to deploy
   2. Replace ``<your-domain>`` with your domain name (e.g., ``osmo.example.com``) if you want to enable ingress for external access
   3. Update the ``serviceName`` for postgres and redis to match your external services
   4. Update ``ingressClass`` and ``ingress`` to match your cluster's ingress controller and ingress configuration
   5. Ensure your DNS points to the ingress controller's load balancer if you want to enable ingress for external access

Step 6: Helm Deploy
===============================

Deploy the OSMO components using the minimal configuration:

1. **Deploy OSMO Service**:

   .. code-block:: bash

      $ helm upgrade --install osmo-minimal osmo/service \
        -f ./osmo_values.yaml \
        --namespace osmo-minimal

2. **Deploy OSMO UI**:

   .. code-block:: bash

      $ helm upgrade --install ui-minimal osmo/web-ui \
        -f ./ui_values.yaml \
        --namespace osmo-minimal

3. **Deploy OSMO Router**:

   .. code-block:: bash

      $ helm upgrade --install router-minimal osmo/router \
        -f ./router_values.yaml \
        --namespace osmo-minimal

Step 7: Verify Deployment
==========================

1. Verify that all pods are running:

   .. code-block:: bash

      $ kubectl get pods -n osmo-minimal

   You should see pods similar to the following example:

   .. code-block:: text

      NAME                                    READY   STATUS    RESTARTS   AGE
      osmo-agent-xxx                          1/1     Running   0          2m
      osmo-delayed-job-monitor-xxx            1/1     Running   0          2m
      osmo-service-xxx                        1/1     Running   0          2m
      osmo-worker-xxx                         1/1     Running   0          2m
      osmo-logger-xxx                         1/1     Running   0          2m
      osmo-ui-xxx                             1/1     Running   0          2m
      osmo-router-xxx                         1/1     Running   0          2m

2. Verify that all services are running:

   .. code-block:: bash

      $ kubectl get services -n osmo-minimal

3. Verify that ingress configuration is set up correctly:

   .. note::

      If you have enabled ingress for external access, you should see ingress resources similar to the following:

   .. code-block:: bash

      $ kubectl get ingress -n osmo-minimal

   You should see ingress resources similar to:

   .. code-block:: text

      NAME                     CLASS   HOSTS              ADDRESS         PORTS   AGE
      osmo-agent-ingress       nginx   <your-domain>      <lb-ip>         80      2m
      osmo-service-ingress     nginx   <your-domain>      <lb-ip>         80      2m
      osmo-logger-ingress      nginx   <your-domain>      <lb-ip>         80      2m
      osmo-ui-ingress          nginx   <your-domain>      <lb-ip>         80      2m
      osmo-router-ingress      nginx   <your-domain>      <lb-ip>         80      2m

4. Port forward to access the OSMO UI:

   .. code-block:: bash

      $ kubectl port-forward service/osmo-ui 3000:80 -n osmo-minimal

   Visit http://localhost:3000 in your web browser to access the OSMO UI dashboard as a guest user.

Step 8: Install Backend Operator
===================================

1. Prepare ``backend_operator_values.yaml`` file:

   .. dropdown:: ``backend_operator_values.yaml``
     :color: info
     :icon: file

     .. code-block:: yaml
       :emphasize-lines: 2,3,5

       global:
         osmoImageLocation: <insert-osmo-image-registry>
         osmoImageTag: <insert-osmo-image-tag>
         # update to the actual service URL if you have enabled ingress for external access
         serviceUrl: http://osmo-agent.osmo-minimal.svc.cluster.local
         agentNamespace: osmo-operator
         backendNamespace: osmo-workflows
         backendName: default
         accountTokenSecret: osmo-operator-token
         loginMethod: token

       services:
         backendListener:
           resources:
             requests:
               cpu: "125m"
               memory: "128Mi"
             limits:
               cpu: "250m"
               memory: "256Mi"
         backendWorker:
           resources:
             requests:
               cpu: "125m"
               memory: "128Mi"
             limits:
               cpu: "250m"
               memory: "256Mi"

       sidecars:
         otel:
           enabled: false


2. Login to OSMO:


   If ingress is disabled, you can port forward the OSMO API server and login to OSMO

   .. code-block:: bash

      $ kubectl port-forward service/osmo-service 9000:80 -n osmo-minimal

      $ osmo login http://localhost:9000 --method=dev --username=testuser


   If ingress is enabled, you can login to OSMO through your domain:

   .. code-block:: bash

      $ osmo login https://<your-domain> --method=dev --username=testuser


3. Create the account token secret:

   Generate a token for the backend operator with OSMO CLI:

   .. code-block:: bash

      $ export BACKEND_TOKEN=$(osmo token set backend-token --expires-at <insert-date> --description "Backend Operator Token" --service --roles osmo-backend -t json | jq -r '.token')

      $ kubectl create secret generic osmo-operator-token --from-literal=token=$BACKEND_TOKEN --namespace osmo-operator


4. Deploy the backend operator:

   .. code-block:: bash

      $ helm upgrade --install osmo-operator osmo/backend-operator \
        -f ./backend_operator_values.yaml \
        --namespace osmo-operator


Step 9: Access OSMO
====================

With Ingress
-------------

1. **Access OSMO Service API**:

   Visit https://<your-domain>/api/docs in your web browser to access the OSMO API.

2. **Access OSMO UI**:

   Visit https://<your-domain> in your web browser to access the OSMO UI.

.. note::
   1. Replace ``<your-domain>`` with your domain name or use the alternative approach below
   2. Ensure your DNS is configured to point to your ingress controller's load balancer
   3. If you need to test without DNS setup, you can use port forwarding as an alternative as well

Without Ingress
-------------------

If you haven't set up DNS yet, you can access OSMO using port forwarding as an alternative:

1. **Access OSMO Service API**:

   .. code-block:: bash

      $ kubectl port-forward service/osmo-service 9000:80 -n osmo-minimal

   Then access the OSMO API at http://localhost:9000/api/docs in your web browser. You can interact with the API using the OSMO CLI.

   .. code-block:: bash

      $ osmo login http://localhost:9000 --method=dev --username=testuser

      $ osmo resource list -p default
      Node             Pool      Platform      Storage [Gi]   CPU [#]   Memory [Gi]   GPU [#]
      ========================================================================================
      <node-name>       default   default        0/2028         0/2       1/32         0/8
      ========================================================================================

2. **Access OSMO UI** (in a separate terminal):

   .. code-block:: bash

      $ kubectl port-forward service/osmo-ui 3000:80 -n osmo-minimal

   Then access the OSMO UI at http://localhost:3000 in your web browser. You should be able to see the OSMO UI dashboard as a guest user.

.. important::

   - If you are accessing OSMO with port forwarding, the router service will not be accessible
   - Consequently, ``osmo workflow port-forward`` or ``osmo workflow exec`` commands are not expected to work


Step 10: Basic Configuration
============================

After deployment, you need to configure a central storage for workflow spec, workflow logs, and task's artifacts data before you can start running workflows:

1. Follow the :ref:`configure_data` guide to setup data storage.

2. Follow the :ref:`installing_required_dependencies` guide to install the KAI scheduler for running workflows.

3. **(Optional)** If you your ingress is not configured, you will need to set the following config with OSMO CLI for workflows to run:

   .. code-block:: bash

      $ cat << EOF > /tmp/osmo_logger_config.json
      {
      "service_base_url": "http://osmo-logger.osmo-minimal.svc.cluster.local:80"
      }
      EOF

      $ osmo config update SERVICE --file /tmp/osmo_logger_config.json

Testing Your Deployment
========================

Follow the :ref:`validate_osmo` guide to test basic OSMO functionality.

.. warning::

   When accessing OSMO through port forwarding, you will not be able to run interactive workflows involving ``port-forwarding`` or ``exec`` functionality.

What's Next
============

Once you have tested OSMO with the minimal deployment and are ready for production use, consider the following steps:

1. Consider upgrading to production deployment (:ref:`deploy_service`)
2. Setup SSO authentication and authorization (:ref:`authentication_flow_sso`)
3. Configure persistent storage (:ref:`configure_data`)
4. Add observability and monitoring solutions (:ref:`adding_observability`)

Cleanup
=======

To remove the minimal deployment:

.. code-block:: bash

   # Uninstall all helm releases
   $ helm uninstall osmo-minimal --namespace osmo-minimal
   $ helm uninstall ui-minimal --namespace osmo-minimal
   $ helm uninstall router-minimal --namespace osmo-minimal
   $ helm uninstall osmo-operator --namespace osmo-operator

   # Delete the namespace
   $ kubectl delete namespace osmo-minimal
   $ kubectl delete namespace osmo-operator

Troubleshooting
===============

Common Issues
-------------

1. **Pods not starting**: Check resource availability and image pull secrets
2. **Database connection issues**: Verify PostgreSQL database is accessible from the OSMO service and you have the correct credentials
3. **Redis connection issues**: Verify Redis is accessible from the OSMO service and you have the correct credentials, common issues are:

   - TLS is enabled but `tlsEnabled` is set to false in the values file

4. **Port forwarding issues**: Ensure no other services are using the same port
