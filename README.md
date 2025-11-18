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


# Welcome to NVIDIA OSMO

OSMO is an open framework for end-to-end robotics development scaled across heterogenous compute​ nodes.

OSMO enables robotics developers to scale the AI development seamlessly from PC or workstations to large sized compute clusters in the cloud

<img src="Intro.png" width="600" />

## What's new​

* Available Now as Open-Source on Github​
* Run OSMO locally before scaling to the cloud​
​
## Key benefits​

* Unify simultaneous execution across diverse compute nodes specialized for AI model training, simulation or physical AI runtime.​
* Simple zero-code YAML based workflow configuration scalable with custom build systems or AI agents​
* Connect any Kubernetes compute backend ​
* Integrate with to your existing services with open standards - identity provider, container registries and storage ​
* Deploy in air-gapped environments


## Try OSMO

Deploy OSMO on your laptop or any workstation with a [Quick Start Guide](QUICK_START.md).

## Deploy on Cloud

Follow these steps for cloud deployment

* Create required resources in the cloud for hosting OSMO using Terraform

  * [AWS](deployments/terraform/aws/example/README.md)
  * [Azure](deployments/terraform/azure/example/README.md)

* Deploy and configure OSMO using our [Deployment Guide](https://nvidia.github.io/OSMO/deployment_guide)

## Documentation

If you are an AI / ML /robotics developer, follow our [User Guide](https://nvidia.github.io/OSMO/user_guide) to run OSMO workflows


## 🤝 Support

For support and questions:

* Review our documentation at the links above
* Create issues on Github for support

## Contribute to OSMO

To develop features in OSMO, you will need one of the below supported devices to build and run the service

### System Requirements

- Ubuntu 22.04+ (x86_64)
- MacOS (arm64)

### Install Prerequisites

- **[Bazel](https://bazel.build/install/bazelisk)** - Build tool (>=8.1.1)
- **[Docker](https://docs.docker.com/get-docker/)** - Container runtime (>=28.3.2)
- **[Helm](https://helm.sh/docs/intro/install/)** - Package manager for Kubernetes (>=3.17.1)
- **[KIND](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)** - Kubernetes in Docker
  (>=0.29.0)
- **[kubectl](https://kubernetes.io/docs/tasks/tools/)** - Kubernetes command-line tool (>=1.32.2)
- **[aws-cli](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)** - AWS
  command-line tool (>=2.24.7)
- **[npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)** - Package manager for Node.js (>=11.6.2)

### Develop

Follow [Dev Guide](DEV.md) to develop and test features on your local workstation.

Follow [Build and Test Guide](BUILD_AND_TEST.md) to containerize your features, push them to desired registry and test the container images.
