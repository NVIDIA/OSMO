<!--
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION. All rights reserved.

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

# OSMO Brev Deployment (Kubernetes Mode)

[![NVIDIA-OSMO](https://img.shields.io/badge/NVIDIA-OSMO-76b900?logo=nvidia)](https://github.com/NVIDIA/OSMO)

An alternative to the [VM mode deployment](README.md) that uses Brev's **Single-node Kubernetes** mode. Instead of installing Docker, KIND, and nvkind inside a VM, this mode launches a MicroK8s cluster with GPU support pre-configured, and the setup script installs only OSMO and the KAI scheduler on top.

> The Brev deployment is for evaluation purposes only and is not recommended for production use as it lacks authentication and has limited resources.

## How it works

Brev's Single-node Kubernetes mode provides a ready-to-use cluster with:

- **MicroK8s** — lightweight Kubernetes distribution
- **GPU Operator** — NVIDIA GPU support via `microk8s enable gpu`
- **DNS** — cluster DNS addon
- **Hostpath Storage** — local storage provisioner (`microk8s-hostpath`)
- **kubectl + Helm 3** — pre-installed and configured

The setup script (`setup-k8s.sh`) labels the single node as `node_group=compute`, installs the KAI scheduler and OSMO Helm chart with all nodeSelectors unified to that label, then configures the OSMO CLI.

## Compute requirements

- NVIDIA L40S or L40 GPU (1x)
- Brev instance type: `massedcompute_L40S` or equivalent

## Creating the instance

Create a Brev instance in Kubernetes mode, then run the setup script:

```bash
brev create osmo-quick-start -m k8s --type massedcompute_L40S
brev exec osmo-quick-start @deployments/brev/setup-k8s.sh
```

Setup takes approximately 5-10 minutes.

## Accessing the deployment

### Web UI Access

The OSMO Web UI is available through a secure Brev link exposed from your instance:

1. Log in to your Brev console at https://console.brev.dev
2. Navigate to your OSMO instance
3. Select "Access"
4. Under `Using Secure Links`, click `Share a Service` and enter port `30080`
5. Click on the "Shareable URL" for port `30080`

## [Optional] Local CLI Setup

To use the OSMO CLI and UI from your local machine, set up port forwarding and install the necessary tools.

### Step 1: Install Brev CLI

Follow instructions [here](https://docs.nvidia.com/brev/latest/brev-cli.html#installation-instructions). Be sure to `brev login`.

### Step 2: Set Up Port Forwarding

Forward ports from your Brev instance to your local machine. Port 30080 provides access to the OSMO API and Web UI.

You can find your instance's IP address at the top of the deployment page.

```bash
sudo ssh -i ~/.brev/brev.pem -p 22 -L 80:localhost:30080 <username>@[your instance IP]
```

### Step 3: Set Up Networking

Add host entries so that the OSMO CLI and browser can reach the cluster services via localhost:

```bash
echo "127.0.0.1 quick-start.osmo" | sudo tee -a /etc/hosts
echo "127.0.0.1 localstack-s3.osmo" | sudo tee -a /etc/hosts
```

### Step 4: Install OSMO CLI

```bash
curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh | bash
```

### Step 5: Log In to OSMO

```bash
osmo login http://quick-start.osmo --method=dev --username=testuser
```

### Step 6: Set Dataset Credential

In a separate terminal, retrieve and run the credential script:

```bash
ssh -i ~/.brev/brev.pem <username>@[your instance IP] 'cat ~/osmo-deployment/set-credential.sh' | bash
```

## Next Steps

Visit the [User Guide](https://nvidia.github.io/OSMO/main/user_guide/getting_started/next_steps.html#getting-started-next-steps) for tutorials on submitting workflows, interactive development, distributed training, and more.

## Additional Resources

- [User Guide](https://nvidia.github.io/OSMO/main/user_guide/)
- [Deployment Guide](https://nvidia.github.io/OSMO/main/deployment_guide/)
- [OSMO GitHub Repository](https://github.com/nvidia/osmo)
- [Brev Documentation](https://docs.brev.dev)

## Cleanup

Close the port-forward session with:

```bash
sudo kill -9 $(sudo lsof -ti:80)
```

Delete your Brev instance through the Brev console or CLI:

```bash
brev delete [your instance name]
```

## Deploying Custom OSMO Chart

1. Build and push your quick-start chart to the registry.

2. Create a Brev instance in Kubernetes mode:

   ```bash
   brev create my-osmo -m k8s --type massedcompute_L40S
   ```

3. Wait for the instance to finish building, then shell in:

   ```bash
   brev shell my-osmo
   ```

4. Download the setup script:

   ```bash
   curl -o setup-k8s.sh https://raw.githubusercontent.com/NVIDIA/OSMO/main/deployments/brev/setup-k8s.sh && chmod +x setup-k8s.sh
   ```

5. Edit `setup-k8s.sh` to install your version and use your registry key.

6. Run the setup script:

   ```bash
   ./setup-k8s.sh
   ```
