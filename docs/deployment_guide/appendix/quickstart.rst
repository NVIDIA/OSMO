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

.. _quick_start:

============================
Minimal Deployment
============================

This guide provides instructions for deploying OSMO in a minimal configuration suitable for testing, development, and evaluation purposes. This setup of OSMO creates the service and backend operator in the same kubernetes cluster, is suitable for single-tenant, has no authentication, and is designed for quick setup and experimentation.

.. warning::
   Minimal deployment is not recommended for production use as it lacks authentication and security features.

Overview
========

.. image:: osmo_minimal.png
   :alt: Minimal Deployment
   :width: 100%

The minimal deployment includes:

* OSMO Service
* OSMO Web UI
* OSMO Router
* External PostgreSQL database (configurable)
* External Redis cache (configurable)
* No authentication or authorization
* Single namespace deployment
* Minimal resource requirements

Prerequisites
=============

see :ref:`prerequisites` for the prerequisites.

Step 1: Create Namespace
========================

Create a dedicated namespace for OSMO:

.. code-block:: bash

   $ kubectl create namespace osmo-minimal

Step 2: Add OSMO Helm Repository
==================================

Add the NVIDIA OSMO Helm repository using your NGC token:

.. code-block:: bash

   $ helm repo add osmo https://helm.ngc.nvidia.com/nvidian/osmo \
     --username \$oauthtoken \
     --password <ngc-token>

   $ helm repo update

Step 3: Create Kubernetes Secret
=================================

Create a secret for pulling images from NVIDIA's container registry:

.. code-block:: bash

   $ kubectl create secret docker-registry imagepullsecret \
     --docker-server=nvcr.io \
     --docker-username=\$oauthtoken \
     --docker-password=<ngc-token> \
     --namespace osmo-minimal

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
             - "PGPASSWORD=$OSMO_PGPASSWORD psql -U postgres -h $OSMO_DB_HOST -p 5432 -d postgres -c 'CREATE DATABASE osmo_db;'"
       restartPolicy: Never
     EOF

Check that the process ``Completed`` with ``kubectl get pod osmo-db-ops``. Then delete the pod with:

.. code-block:: bash

   $ kubectl delete pod osmo-db-ops

Step 5: Prepare Service Values Files
====================================

Create the following values files for the minimal deployment:

**OSMO Service Values** (``osmo_values.yaml``):

.. code-block:: yaml

   global:
     osmoImageLocation: <insert-osmo-image-registry>
     osmoImageTag: <insert-osmo-image-tag>

   services:
     configFile:
       enabled: true

     postgres:
       enabled: false
       serviceName: <your-postgres-host>
       db: <your-database-name>

     redis:
       enabled: false # Set to false if using external Redis
       serviceName: <your-redis-host>
       port: 6379
       tlsEnabled: false

     service:
       scaling:
         minReplicas: 1
         maxReplicas: 1
       hostname: <your-domain>  # Set your domain for ingress
       ingress:
         enabled: false  # Set to true if you want to enable ingress for external access
         # only set the following if you want to enable ingress for external access
         # ingressClass: alb  # Set your ingress class (nginx, alb, etc.)
         # sslEnabled: false
         # albAnnotations:  # Set to true if using AWS ALB
         #   enabled: false
         #   # sslCertArn: <your-ssl-cert-arn> # Set to the ARN of the SSL certificate for the ingress if using AWS ALB
         # annotations:
         #   # when using nginx ingress, add the following annotations to handle large OAuth2 response headers from identity providers
         #   # nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"
         #   # nginx.ingress.kubernetes.io/proxy-buffers: "8 16k"
         #   # nginx.ingress.kubernetes.io/proxy-busy-buffers-size: "32k"
         #   # nginx.ingress.kubernetes.io/large-client-header-buffers: "4 16k"

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

.. code-block:: yaml

   global:
     osmoImageLocation: <insert-osmo-image-registry>
     osmoImageTag: <insert-osmo-image-tag>

   services:
     ui:
       skipAuth: true
       hostname: <your-domain>  # Set your domain for UI ingress
       ingress:
         enabled: false  # Set to true if you want to enable ingress for external access
         # only set the following if you want to enable ingress for external access
         # ingressClass: alb  # Set your ingress class (nginx, alb, etc.)
         # sslEnabled: false
         # albAnnotations:  # Set to true if using AWS ALB
         #   enabled: false
         #   # sslCertArn: <your-ssl-cert-arn> # Set to the ARN of the SSL certificate for the ingress if using AWS ALB
         # annotations:
         #   # when using nginx ingress, add the following annotations to handle large OAuth2 response headers from identity providers
         #   # nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"
         #   # nginx.ingress.kubernetes.io/proxy-buffers: "8 16k"
         #   # nginx.ingress.kubernetes.io/proxy-busy-buffers-size: "32k"
         #   # nginx.ingress.kubernetes.io/large-client-header-buffers: "4 16k"

   sidecars:
     envoy:
       enabled: false

**Router Service Values** (``router_values.yaml``):

.. code-block:: yaml

   global:
     osmoImageLocation: <insert-osmo-image-registry>
     osmoImageTag: <insert-osmo-image-tag>

   services:
     configFile:
       enabled: true

     postgres:
       serviceName: <your-postgres-host>

     service:
       scaling:
         minReplicas: 1
         maxReplicas: 1
       hostname: <your-domain>  # Set your domain for router ingress
       ingress:
         enabled: false  # Set to true if you want to enable ingress for external access
         # only set the following if you want to enable ingress for external access
         # ingressClass: alb  # Set your ingress class (nginx, alb, etc.)
         # sslEnabled: false
         # albAnnotations:  # Set to true if using AWS ALB
         #   enabled: false
         #   # sslCertArn: <your-ssl-cert-arn> # Set to the ARN of the SSL certificate for the ingress if using AWS ALB
         # annotations:
         #   # when using nginx ingress, add the following annotations to handle large OAuth2 response headers from identity providers
         #   # nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"
         #   # nginx.ingress.kubernetes.io/proxy-buffers: "8 16k"
         #   # nginx.ingress.kubernetes.io/proxy-busy-buffers-size: "32k"
         #   # nginx.ingress.kubernetes.io/large-client-header-buffers: "4 16k"

   sidecars:
     envoy:
       enabled: false

     logAgent:
       enabled: false

     otel:
       enabled: false

.. note::
   - Replace ``<insert-osmo-image-tag>`` with the actual OSMO version you want to deploy
   - Replace ``<your-domain>`` with your actual domain name (e.g., ``osmo.example.com``)
   - Update the ``serviceName`` for postgres and redis to match your external services
   - Update ``ingressClass`` to match your cluster's ingress controller (nginx, alb, etc.)
   - The ``--skip_auth=true`` flag disables authentication for minimal setup
   - Ensure your DNS points to the ingress controller's load balancer

Step 6: Deploy OSMO Components
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

3. **Deploy Router Service**:

.. code-block:: bash

   $ helm upgrade --install router-minimal osmo/router \
     -f ./router_values.yaml \
     --namespace osmo-minimal

Step 7: Verify Deployment
==========================

1. Check that all pods are running:

.. code-block:: bash

   $ kubectl get pods -n osmo-minimal

You should see pods similar to:

.. code-block:: text

   NAME                                    READY   STATUS    RESTARTS   AGE
   osmo-agent-xxx                          1/1     Running   0          2m
   osmo-delayed-job-monitor-xxx            1/1     Running   0          2m
   osmo-service-xxx                        1/1     Running   0          2m
   osmo-worker-xxx                         1/1     Running   0          2m
   osmo-logger-xxx                         1/1     Running   0          2m
   osmo-ui-xxx                             1/1     Running   0          2m
   osmo-router-xxx                         1/1     Running   0          2m

2. Check services:

.. code-block:: bash

   $ kubectl get services -n osmo-minimal

3. Check ingress configuration:

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

4. Visualize the OSMO UI:

.. code-block:: bash

   $ kubectl port-forward service/osmo-ui 3000:80 -n osmo-minimal

Then access the OSMO UI at ``http://localhost:3000`` in your web browser. You should be able to see the OSMO UI dashboard as a guest user.

Step 8: Setup OSMO Backend Operator
===================================

1. prepare the backend operator values file:

.. code-block:: yaml

   global:
    osmoImageLocation: <insert-osmo-image-registry>
    osmoImageTag: <insert-osmo-image-tag>
    serviceUrl: http://osmo-agent.osmo-minimal.svc.cluster.local # update to the actual service URL if you have enabled ingress for external access
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



2. create the account token secret:

When ingress is disabled, you can port forward to the OSMO API server and login to OSMO using the CLI:

.. code-block:: bash

   $ kubectl port-forward service/osmo-service 9000:80 -n osmo-minimal

   $ osmo login http://localhost:9000 --method=dev --username=testuser


Otherwise, you can login to OSMO through your domain:

.. code-block:: bash

   $ osmo login https://<your-domain> --method=dev --username=testuser


Generate a token for the backend operator with OSMO CLI:

.. code-block:: bash

   $ export BACKEND_TOKEN=$(osmo token set backend-token --expires-at <insert-date> --description "Backend Operator Token" --service --roles osmo-backend -t json | jq -r '.token')

   $ kubectl create secret generic osmo-operator-token --from-literal=token=$BACKEND_TOKEN --namespace osmo-operator


3. deploy the backend operator:

.. code-block:: bash

   $ helm upgrade --install osmo-operator osmo/backend-operator \
     -f ./backend_operator_values.yaml \
     --namespace osmo-operator


Step 9: Access OSMO
====================

With ingress enabled, you can access OSMO directly through your domain:

1. **Access OSMO Service API**:

   Visit ``https://<your-domain>/api/docs`` in your web browser to access the OSMO API.

2. **Access OSMO UI**:

   Visit ``https://<your-domain>`` in your web browser to access the OSMO UI.

.. note::
   - Replace ``<your-domain>`` with your actual domain name or use port forwarding if DNS is not configured
   - Ensure your DNS is configured to point to your ingress controller's load balancer
   - If you need to test without DNS setup, you can use port forwarding as an alternative

**Alternative: Port Forwarding (if DNS not configured)**:

If you haven't set up DNS yet, you can still access OSMO using port forwarding:

1. **Access OSMO Service API**:

.. code-block:: bash

   $ kubectl port-forward service/osmo-service 9000:80 -n osmo-minimal

Then access the OSMO API at ``http://localhost:9000`` in your web browser.
You can interact with the API using the OSMO CLI.

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

Then access the OSMO UI at ``http://localhost:3000`` in your web browser. You should be able to see the OSMO UI dashboard as a guest user.

Step 10: Basic Configuration
============================

After deployment, you need to configure a central storage for workflow spec, workflow logs, and task's artifacts data before you can start running workflows:

1. Setup data storage:

follow the :ref:`configure_data` guide to setup data storage.


Testing Your Deployment
========================

You can now test basic OSMO functionality following the :ref:`validate_osmo` guide.

.. note::
   Since there's no authentication in minimal deployment, all operations will be performed as an anonymous user.

Next Steps
==========

Once you have tested OSMO with the minimal deployment and are ready for production use:

1. Consider upgrading to :ref:`deploy_service` for single-tenant production use
2. Or :ref:`deploy_multitenant` for multi-tenant scenarios
3. Set up proper authentication and authorization
4. Configure persistent storage solutions
5. Implement monitoring and logging

Cleanup
=======

To remove the minimal deployment:

.. code-block:: bash

   # Uninstall all Helm releases
   # Uninstall all Helm releases
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
2. **Database connection issues**: Verify PostgreSQL pod is running and accessible
3. **Port forwarding issues**: Ensure no other services are using the same port
