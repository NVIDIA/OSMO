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

[![ Click here to deploy.](https://brev-assets.s3.us-west-1.amazonaws.com/nv-lb-dark.svg)](https://brev.nvidia.com/launchable/deploy?launchableID=env-36a6a7qnkOMOP2vgiBRaw2e3jpW)

The OSMO Brev deployment provides a pre-configured OSMO instance running in the cloud, allowing you to quickly try OSMO without setting up local infrastructure. This deployment uses a [Brev.dev](https://brev.dev) cloud instance with the [OSMO local deployment](https://nvidia.github.io/OSMO/main/deployment_guide/appendix/deploy_local.html) pre-installed.

> The Brev deployment is for evaluation purposes only and is not recommended for production use as it lacks authentication and has limited resources.

## Compute requirements

- NVIDIA Container Toolkit (>=1.18.1)
- NVIDIA Driver Version (>=575)

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

Follow instructions [here](https://docs.nvidia.com/brev/latest/brev-cli.html#installation-instructions). Be sure to `brev login`.

### Step 2: Set Up Port Forwarding

Forward port 8000 from your Brev instance to local port 80. This port will need to be forwarded for you to use the OSMO CLI from your workstation.

You can find your instance's IP address at the top of the deployment page.

```bash
# Find your instance name with brev ls
sudo ssh -i ~/.brev/brev.pem -p 22 -L 80:localhost:8000 shadeform@[your instance IP]
```

If you see `Permission denied (publickey)` it may be because:

- You did not log in using `brev auth`
- The username is different than `shadeform`

You can see your username in the Brev Console:

1. Log in to your Brev console at https://console.brev.dev
2. Navigate to your OSMO instance
3. Select "Logs"
4. Look at the output of "Script Logs". You should see `Current user: [brev instance username]`

Use the Brev instance username in the above ssh command instead of `shadeform`.

### Step 3: Set Up Networking

Add a host entry to access OSMO from your browser:

```bash
echo "127.0.0.1 quick-start.osmo" | sudo tee -a /etc/hosts
```

This allows you to visit `http://quick-start.osmo` in your web browser.

### Step 4: Install OSMO CLI

Download and install the OSMO command-line interface:

```bash
curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh | bash
```

### Step 5: Log In to OSMO

Authenticate with the OSMO instance through your port forward:

```bash
osmo login http://quick-start.osmo --method=dev --username=testuser
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
kill -9 $(lsof -ti:8000)
```

Delete your Brev instance through the Brev console or CLI:

```bash
brev delete [your instance name]
```
