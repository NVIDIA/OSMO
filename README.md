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

# NVIDIA OSMO

OSMO is a workflow orchestration platform that provides easy and efficient access to various
types of compute and data storage solutions for robotics developers.

## Why OSMO?

Traditional robotics development faces several challenges:

- **Complex infrastructure setup** - Managing heterogeneous compute resources is difficult
- **Resource sharing bottlenecks** - Teams compete for limited development hardware
- **Scaling difficulties** - Moving from prototype to production-scale testing
- **Hardware-software mismatch** - Testing on different hardware than production targets

OSMO solves these problems by providing:

- **Unified workflow orchestration** - Submit jobs via CLI or web UI
- **Hardware abstraction** - Run the same workflows on different compute backends
- **Resource pooling** - Share expensive hardware resources across teams
- **Cloud-native scalability** - Scale from single jobs to cluster-wide workloads
- **Support both SIL and HIL** - Software-in-the-loop and Hardware-in-the-loop simulation

## Getting Started

The recommended way for CSPs and developers to evaluate OSMO before committing to a full deployment
is with our [Quick Start Guide](QUICK_START.md).

## Building and Running Locally

### Supported Devices

- Ubuntu 22.04+ (x86_64)
- MacOS (arm64)

### Prerequisites

- **[aws-cli](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)** - AWS command-line tool (>=2.24.7)
- **[Bazel](https://bazel.build/install/bazelisk)** - Build tool (>=8.1.1)
- **[Docker](https://docs.docker.com/get-docker/)** - Container runtime (>=28.3.2)
- **[Helm](https://helm.sh/docs/intro/install/)** - Package manager for Kubernetes (>=3.17.1)
- **[KIND](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)** - Kubernetes in Docker (>=0.29.0)
- **[kubectl](https://kubernetes.io/docs/tasks/tools/)** - Kubernetes command-line tool (>=1.32.2)

For developers who want to build/modify OSMO, use our [Local Build Guide](BUILD.md).

Once the changes are done, follow our [Run and Test Guide](RUN_AND_TEST.md) to validate the changes
and push the images.

## Cloud Deployment

To deploy to the cloud, follow these instructions:
- [AWS](deployments/terraform/aws/example/README.md)
- [Azure](deployments/terraform/azure/example/README.md)

## Testing

Follow our documentation below to setup OSMO and run tutorials.

- **[User Guide](docs/user/index.rst)** - Complete guide for OSMO users
- **[Setup Guide](docs/setup/index.rst)** - Deployment and configuration instructions

## CSP Marketplace Deployment

**Coming Soon...**

## 🤝 Support

For support and questions:
- Review our documentation at the links above
