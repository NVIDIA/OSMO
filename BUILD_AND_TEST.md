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

# NVIDIA OSMO - Build and Test Guide

If you are trying to develop OSMO on your host machine, follow the [Dev Guide](./DEV.md) instead.

After you've made your desired changes, you can test your changes in an environment similar to a
deployed environment like [AWS EKS](https://aws.amazon.com/eks/) or
[Azure AKS](https://azure.microsoft.com/en-us/products/kubernetes-service). This guide will first
show you how to build container images and push them to a container registry. Then, this guide will
show you how to test those images by using them in a [KIND cluster](https://kind.sigs.k8s.io/),
similar to a deployed environment.

## Prerequisites

Install the [required tools](./CONTRIBUTING.md#prerequisites) for developing OSMO.

You can push container images to your preferred container registry such as
[NVIDIA NGC](https://www.nvidia.com/en-us/gpu-cloud/) (`nvcr.io`),
[Docker Hub](https://hub.docker.com/) (`docker.io`), or
[GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
(`ghcr.io`). Set the following environment variables for your container registry of choice:

```sh
export CONTAINER_REGISTRY="<container registry>"
export CONTAINER_REGISTRY_USERNAME="<container registry username>"
export CONTAINER_REGISTRY_PASSWORD="<container registry password>"
```

## Push OSMO Container Images

### Building in a containerized environment

Build OSMO in a containerized environment to produce OSMO container images that are compatible with
your environment. OSMO supports both `linux/amd64` and `linux/arm64` images in containerized
environments on your host machine or in a Kubernetes cluster. OSMO _does not_ support running with
emulation for a host that has a different architecture than the image.

This containerized environment also makes it possible to build `linux/arm64` images on MacOS
(`darwin/arm64`) that are compatible with containerized `linux/arm64` environments.

Follow [these instructions](#push-osmo-container-images) twice if you need to support both
`linux/amd64` and `linux/arm64` architectures using multi-architecture image manifests.

#### Loading Images to Docker

These commands will build and load the builder images directly into your local Docker daemon:

##### AMD64 Image Load

```bash
# Image: osmo-builder:latest-amd64
bazel run --platforms=@io_bazel_rules_go//go/toolchain:linux_amd64 @osmo_workspace//run:builder_image_load_x86_64
```

##### ARM64 Image Load

```bash
# Image: osmo-builder:latest-arm64
bazel run --platforms=@io_bazel_rules_go//go/toolchain:linux_arm64 @osmo_workspace//run:builder_image_load_arm64
```

**Note:** Platform flags are required due to rules_distroless debian package select() conditions.

Both commands will load the image into your Docker daemon with the tag for the respective
architecture: `osmo-builder:latest-amd64` or `osmo-builder:latest-arm64`.

#### Using the Builder Image

Once loaded, you can run the builder container:

```bash
echo "CONTAINER_REGISTRY=${CONTAINER_REGISTRY}
CONTAINER_REGISTRY_USERNAME=${CONTAINER_REGISTRY_USERNAME}
CONTAINER_REGISTRY_PASSWORD=${CONTAINER_REGISTRY_PASSWORD}" > /tmp/osmo-env
chmod 600 /tmp/osmo-env

docker run --rm -it \
  -v "$(pwd)":/workspace -w /workspace \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --env-file /tmp/osmo-env \
  osmo-builder:latest-amd64 # or osmo-builder:latest-arm64

rm -f /tmp/osmo-env
```

**Note:** The `/var/run/docker.sock` volume mount is important to allow `oci_load` operations from
inside the container.

### Configuring Your Container Registry

To push images to your own container registry, you need to modify the `BASE_IMAGE_URL` and
`IMAGE_TAG` constants. These are configured in the root `MODULE.bazel` file:

1. **Update the BASE_IMAGE_URL and IMAGE_TAG**:

   ```bash
   BASE_IMAGE_URL="your-registry.com/your-namespace/osmo"
   IMAGE_TAG="your-image-tag"

   sed -i "s|BASE_IMAGE_URL = \"nvcr.io/nvidia/osmo/\"|BASE_IMAGE_URL = \"${BASE_IMAGE_URL}/\"|" MODULE.bazel
   sed -i "s|IMAGE_TAG = \"\"|IMAGE_TAG = \"${IMAGE_TAG}\"|" MODULE.bazel
   ```

2. **Ensure you're authenticated** to your registry from within the builder environment.

   ```bash
   echo $CONTAINER_REGISTRY_PASSWORD | docker login -u "$CONTAINER_REGISTRY_USERNAME" --password-stdin "$CONTAINER_REGISTRY"
   ```

After modifying the `BASE_IMAGE_URL` and `IMAGE_TAG`, all subsequent `bazel run` commands will push
images to your configured registry with your specified tag.

### Build and Push

The commands will build and push the images for the designated architecture.

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
# OSMO Runtime
bazel run @osmo_workspace//src/runtime:init_push_x86_64                                    # Image name: init-container
# OSMO Client
bazel run @osmo_workspace//src/cli:cli_push_x86_64                                         # Image name: client
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
# OSMO Runtime
bazel run @osmo_workspace//src/runtime:init_push_arm64                                    # Image name: init-container
# OSMO Client
bazel run @osmo_workspace//src/cli:cli_push_arm64                                         # Image name: client
```

#### [Optional] Push Multiarchitecture Image Manifests

After pushing both `amd64` and `arm64` images, you can optionally push a multiarchitecture image
manifest. A multiarchitecture image manifest means users of your images can use the same image tag
regardless of their architecture. This step is not necessary if you only need to support a single
architecture.

Use the Bazel target to create multiarch manifests for all OSMO images:

```bash
BASE_IMAGE_URL=$(grep 'BASE_IMAGE_URL = ' MODULE.bazel | sed 's/.*= "\(.*\)"/\1/')
IMAGE_TAG=$(grep 'IMAGE_TAG = ' MODULE.bazel | sed 's/.*= "\(.*\)"/\1/')

bazel run @osmo_workspace//run:push_multiarch_manifests -- \
    --registry_path "${BASE_IMAGE_URL%/}" \
    --tag "${IMAGE_TAG}" \
    --images \
        agent \
        service \
        delayed-job-monitor \
        logger \
        router \
        worker \
        backend-listener \
        backend-worker \
        web-ui \
        docs \
        init-container \
        client
```

## Test OSMO Images in a KIND Cluster

Once you have built OSMO container images you can test that the images work as expected. These
commands run OSMO within a KIND cluster, providing an environment similar to a deployed environment.

Follow these instructions from your host machine, not the containerized builder environment.

### Start OSMO Services

```sh
# If you followed steps to push images, use the image url and tag from MODULE.bazel
# Otherwise set your desired image url and tag
BASE_IMAGE_URL=$(grep 'BASE_IMAGE_URL = ' MODULE.bazel | sed 's/.*= "\(.*\)"/\1/' | sed 's:/*$::')
IMAGE_TAG=$(grep 'IMAGE_TAG = ' MODULE.bazel | sed 's/.*= "\(.*\)"/\1/')

bazel run @osmo_workspace//run:start_service --  \
  --mode kind \
  --container-registry="$CONTAINER_REGISTRY" \
  --container-registry-username="$CONTAINER_REGISTRY_USERNAME" \
  --container-registry-password="$CONTAINER_REGISTRY_PASSWORD" \
  --image-tag="$IMAGE_TAG" \
  --image-location="$BASE_IMAGE_URL"
```

This command:

- Creates a KIND cluster if it does not exist
- Sets up the OSMO namespace and image pull secrets
- Installs ingress-nginx controller
- Generates the Master Encryption Key (MEK)
- Installs core OSMO services (osmo, ui, router)

Add the following line to your `/etc/hosts` file. If you are SSH-ing into a remote workstation you
must add this line to `/etc/hosts` on both your local and remote hosts.

```text
127.0.0.1 ingress-nginx-controller.ingress-nginx.svc.cluster.local
```

If you are SSH-ing into a remote workstation, you must also forward port `:80` from your remote
workstation to your local host.

The OSMO UI and APIs for the core service can now be accessed on your local machine at:
http://ingress-nginx-controller.ingress-nginx.svc.cluster.local

### Start OSMO Backend

```sh
# If you followed steps to push images, use the image url and tag from MODULE.bazel
# Otherwise set your desired image url and tag
BASE_IMAGE_URL=$(grep 'BASE_IMAGE_URL = ' MODULE.bazel | sed 's/.*= "\(.*\)"/\1/' | sed 's:/*$::')
IMAGE_TAG=$(grep 'IMAGE_TAG = ' MODULE.bazel | sed 's/.*= "\(.*\)"/\1/')

bazel run @osmo_workspace//run:start_backend --  \
  --mode kind \
  --container-registry="$CONTAINER_REGISTRY" \
  --container-registry-username="$CONTAINER_REGISTRY_USERNAME" \
  --container-registry-password="$CONTAINER_REGISTRY_PASSWORD" \
  --image-tag="$IMAGE_TAG" \
  --image-location="$BASE_IMAGE_URL"
```

This command:

- Creates a KIND cluster if it does not exist
- Configures worker nodes with required labels
- Creates test namespace
- Generates backend operator token
- Installs backend operator

### Update Configuration

```sh
# If you followed steps to push images, use the image url and tag from MODULE.bazel
# Otherwise set your desired image url and tag
BASE_IMAGE_URL=$(grep 'BASE_IMAGE_URL = ' MODULE.bazel | sed 's/.*= "\(.*\)"/\1/' | sed 's:/*$::')
IMAGE_TAG=$(grep 'IMAGE_TAG = ' MODULE.bazel | sed 's/.*= "\(.*\)"/\1/')

bazel run @osmo_workspace//run:update_configs --  \
  --container-registry="$CONTAINER_REGISTRY" \
  --container-registry-username="$CONTAINER_REGISTRY_USERNAME" \
  --container-registry-password="$CONTAINER_REGISTRY_PASSWORD" \
  --image-tag="$IMAGE_TAG" \
  --image-location="$BASE_IMAGE_URL"
```

This command:

- Updates workflow configuration with local development settings
- Configures object storage endpoints and credentials
- Sets up backend image configurations
- Sets the default pool for the user profile

### Access OSMO

The OSMO UI and APIs can be accessed at:
http://ingress-nginx-controller.ingress-nginx.svc.cluster.local

Log into OSMO using the CLI:

```sh
bazel run @osmo_workspace//src/cli -- login http://ingress-nginx-controller.ingress-nginx.svc.cluster.local --method=dev --username=testuser
```

## Next steps

Test your setup with:

```sh
bazel run @osmo_workspace//src/cli -- workflow submit ~/path/to/osmo/workflows/basics/hello_world/hello_world.yaml
```

The workflow should successfully submit and run to a "completed" state.

## Deleting the KIND cluster

You can run this command to cleanup the KIND cluster. This will also delete all persistent volumes,
including the postgres database that was created.

```sh
kind delete cluster --name osmo
```

Note: If you used a different `--cluster-name` than the default `osmo`, delete the cluster with
`kind delete cluster --name <your cluster name>`.

## FAQ

### How do I resolve the issue where `start_service` fails to install helm charts such as `ingress-nginx`?

This is likely caused by running out of [inotify](https://linux.die.net/man/7/inotify) resources.
Follow
[these instructions](https://kind.sigs.k8s.io/docs/user/known-issues/#pod-errors-due-to-too-many-open-files)
to raise the limits.
