<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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

# OSMO Brev Deployment

[![ Click here to deploy.](https://brev-assets.s3.us-west-1.amazonaws.com/nv-lb-dark.svg)](https://brev.nvidia.com/launchable/deploy?launchableID=env-36GS9OFgl7TesV00OHiU8d5XHKl)

The OSMO Brev deployment provides a pre-configured OSMO instance running in the cloud, allowing you to quickly try OSMO without setting up local infrastructure. This deployment uses a [Brev.dev](https://brev.dev) cloud instance with the [OSMO local deployment](https://nvidia.github.io/OSMO/main/deployment_guide/appendix/deploy_local.html) pre-installed.

> ![IMPORTANT]
> Compute requirements:
> - NVIDIA Container Toolkit (>=1.18.1)
> - NVIDIA Driver Version (>=575)

> ![NOTE]
> The Brev deployment is for evaluation purposes only and is not recommended for production use as it lacks authentication and has limited resources.

## Accessing the Brev Deployment

### Web UI Access

The OSMO Web UI is available through a secure Brev link exposed from your instance:

1. Log in to your Brev console at https://console.brev.dev
2. Navigate to your OSMO instance
3. Select "Access"
4. Click on the "Secure Link" for port `8000`

## [Optional] Local CLI Setup

To use the OSMO CLI and UI from your local machine, you'll need to set up port forwarding and install the necessary tools.

### Step 1: Install Brev CLI

Follow instructions [here](https://docs.nvidia.com/brev/latest/brev-cli.html#installation-instructions).

### Step 2: Set Up Port Forwarding

Forward port 8000 from your Brev instance to local port 80:

```bash
# Find your instance name with brev ls
brev port-forward <your-instance-name> --port 8000:8000
```

> **Tip:** Keep this terminal window open while you work with OSMO. The port forward will remain active as long as this session is running.

### Step 4: Install OSMO CLI

Download and install the OSMO command-line interface:

```bash
curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh | bash
```

### Step 5: Log In to OSMO

Authenticate with the OSMO instance through your port forward:

```bash
osmo login http://localhost:8000 --method=dev --username=testuser
```

### Step 6: Update the service URL

```bash

```

## Next Steps

Now that you have OSMO running locally, explore the platform:

1. Run Your First Workflow: Visit the [User Guide](https://nvidia.github.io/OSMO/main/user_guide/getting_started/next_steps.html#getting-started-next-steps) for tutorials on submitting workflows, interactive development, distributed training, and more.

2. Explore the Web UI: Visit the exposed [Brev Secure Link](#web-ui-access) to access the OSMO dashboard.

3. Test Your Own Workflows: Use your own Docker images and datasets to validate OSMO for your use case.

## Additional Resources

- [User Guide](https://nvidia.github.io/OSMO/main/user_guide/)
- [Deployment Guide](https://nvidia.github.io/OSMO/main/deployment_guide/)
- [Brev Documentation](https://docs.brev.dev)

## Cleanup

Close the port-forward session with:

```bash
kill -9 $(lsof -ti:8000)
```

Delete your Brev instance through the Brev console or CLI:

```bash
brev delete <your-instance-name>
```
