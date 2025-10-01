<!--
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
-->

# NVIDIA OSMO - Run and Test Guide

Once changes have been made, this guide will show you how to run OSMO and test it locally.

## Prerequisites

Set the following environment variables:

```sh
export CONTAINER_REGISTRY_PASSWORD="<NGC API key>"
export HOST_IP=$(ifconfig | grep "inet " | grep -Fv 127.0.0.1 | grep 10. | awk '{print $2}' | head -1)
```

## Running OSMO

These commands run OSMO within a KIND cluster, providing an environment similar to a
deployed environment.

### Start OSMO Services

```sh
bazel run @osmo_workspace//run:start_service -- --container-registry-password="$CONTAINER_REGISTRY_PASSWORD" --mode kind
```

This command:
- Creates a KIND cluster if it does not exist
- Sets up the OSMO namespace and image pull secrets
- Installs ingress-nginx controller
- Generates the Master Encryption Key (MEK)
- Installs core OSMO services (osmo, ui, router)

Add the following line to your `/etc/hosts` file. If you are SSH-ing into a remote workstation
you must add this line to `/etc/hosts` on both your local and remote hosts.

```text
127.0.0.1 ingress-nginx-controller.ingress-nginx.svc.cluster.local
```

If you are SSH-ing into a remote workstation, you must also forward port `:80` from your
remote workstation to your local host.

The OSMO UI and APIs for the core service can now be accessed on your local machine at: http://ingress-nginx-controller.ingress-nginx.svc.cluster.local

Next, login into OSMO using the CLI:

```sh
bazel run @osmo_workspace//src/cli -- login http://ingress-nginx-controller.ingress-nginx.svc.cluster.local --method=dev --username=testuser
```

### Start OSMO Backend

```sh
bazel run @osmo_workspace//run:start_backend -- --container-registry-password="$CONTAINER_REGISTRY_PASSWORD" --mode kind
```

This command:
- Creates a KIND cluster if it does not exist
- Configures worker nodes with required labels
- Creates test namespace
- Generates backend operator token
- Installs backend operator

### Update Configuration

```sh
bazel run @osmo_workspace//run:update_configs -- --container-registry-password="$CONTAINER_REGISTRY_PASSWORD"
```

This command:
- Updates workflow configuration with local development settings
- Configures object storage endpoints and credentials
- Sets up backend image configurations
- Sets the default pool for the user profile

### Access OSMO

The OSMO UI and APIs can be accessed at: http://ingress-nginx-controller.ingress-nginx.svc.cluster.local

Log into OSMO using the CLI:

```sh
bazel run @osmo_workspace//src/cli -- login http://ingress-nginx-controller.ingress-nginx.svc.cluster.local --method=dev --username=testuser
```

## Next steps

Test your setup with:

```sh
bazel run @osmo_workspace//src/cli -- workflow submit ~/path/to/osmo/docs/samples/hello_world/hello_world.yaml
```

The workflow should successfully submit and run to a "completed" state.

## Deleting the KIND cluster

You can run this command to cleanup the KIND cluster. This will also delete all persistent volumes,
including the postgres database that was created.

```sh
kind delete cluster --name osmo
```

Note: If you used a different `--cluster-name` than the default `osmo`, delete the cluster with `kind delete cluster --name <your cluster name>`.

## [Optional] Push OSMO Container Images

### For building on **MACOS** or in a containerized environment

For building NVIDIA OSMO using MACOS or in a containerized environment, run the commands below to
build multi-architecture container images (linux/arm64 and linux/amd64) using Bazel and
rules_distroless.

#### Loading Images to Docker

These commands will build and load the images directly into your local Docker daemon:

##### AMD64 Image Load

```bash
bazel run --platforms=@io_bazel_rules_go//go/toolchain:linux_amd64 @osmo_workspace//run/builder:builder_image_load_x86_64
```

##### ARM64 Image Load

```bash
bazel run --platforms=@io_bazel_rules_go//go/toolchain:linux_arm64 @osmo_workspace//run/builder:builder_image_load_arm64
```

**Note:** Platform flags are required due to rules_distroless debian package select() conditions.

Both commands will load the image into your Docker daemon with the tag for the respective
architecture: `dev-builder:latest-amd64` or `dev-builder:latest-arm64`.

#### Using the Builder Image

Once loaded, you can run the builder container:

```bash
docker run --rm -it \
  -v "$(pwd)":/workspace -w /workspace \
  -v /var/run/docker.sock:/var/run/docker.sock \
  dev-builder:latest-arm64
```

**Note:** The `/var/run/docker.sock` volume mount is important to allow `oci_load` operations from
inside the container.

### Prerequisite: Configuring Your Container Registry

To push images to your own container registry, you need to modify the `BASE_IMAGE_URL` constant.
This is configured in the root `MODULE.bazel` file:

1. **Edit the MODULE.bazel file** in the repository root:
   ```bash
   # Open the file
   vim MODULE.bazel
   ```

2. **Find and modify the BASE_IMAGE_URL line** (around line 12):
   ```bazel
   # Change this line:
   BASE_IMAGE_URL = "nvcr.io/nvidia/osmo/"

   # To your registry:
   BASE_IMAGE_URL = "your-registry.com/your-namespace/osmo/"
   ```

3. **Ensure you're authenticated** to your registry. For example, for dockerhub:
   ```bash
   # Docker Hub
   docker login
   ```

After modifying the `BASE_IMAGE_URL`, all subsequent `bazel run` commands will push images to your
configured registry.

### Build and Push

The commands will build and push the images:

#### AMD64

```bash
# OSMO Services
bazel run @osmo_workspace//src/service/agent:agent_service_push_x86_64                     # Image name: agent
bazel run @osmo_workspace//src/service/core:service_push_x86_64                            # Image name: service
bazel run @osmo_workspace//src/service/delayed_job_monitor:delayed_job_monitor_push_x86_64 # Image name: delayed-job-monitor
bazel run @osmo_workspace//src/service/logger:logger_push_x86_64                           # Image name: logger
bazel run @osmo_workspace//src/service/router:router_push_x86_64                           # Image name: router
bazel run @osmo_workspace//src/service/worker:worker_push_x86_64                           # Image name: worker
# OSMO Backend Operators
bazel run @osmo_workspace//src/operator:backend_listener_push_x86_64                       # Image name: backend-listener
bazel run @osmo_workspace//src/operator:backend_worker_push_x86_64                         # Image name: backend-worker
# OSMO UI
bazel run @osmo_workspace//ui:web_ui_push_x86_64                                           # Image name: web-ui
# OSMO Docs
bazel run @osmo_workspace//docs/service:doc_service_push_x86_64                            # Image name: docs
```

#### ARM64

```bash
# OSMO Services
bazel run @osmo_workspace//src/service/agent:agent_service_push_arm64                     # Image name: agent
bazel run @osmo_workspace//src/service/core:service_push_arm64                            # Image name: service
bazel run @osmo_workspace//src/service/delayed_job_monitor:delayed_job_monitor_push_arm64 # Image name: delayed-job-monitor
bazel run @osmo_workspace//src/service/logger:logger_push_arm64                           # Image name: logger
bazel run @osmo_workspace//src/service/router:router_push_arm64                           # Image name: router
bazel run @osmo_workspace//src/service/worker:worker_push_arm64                           # Image name: worker
# OSMO Backend Operators
bazel run @osmo_workspace//src/operator:backend_listener_push_arm64                       # Image name: backend-listener
bazel run @osmo_workspace//src/operator:backend_worker_push_arm64                         # Image name: backend-worker
# OSMO UI
bazel run @osmo_workspace//ui:web_ui_push_arm64                                           # Image name: web-ui
# OSMO Docs
bazel run @osmo_workspace//docs/service:doc_service_push_arm64                            # Image name: docs
```

## FAQ

### How do I resolve the issue where `start_service` fails to install helm charts such as `ingress-nginx`?

This is likely caused by running out of [inotify](https://linux.die.net/man/7/inotify) resources. Follow [these instructions](https://kind.sigs.k8s.io/docs/user/known-issues/#pod-errors-due-to-too-many-open-files) to raise the limits.
