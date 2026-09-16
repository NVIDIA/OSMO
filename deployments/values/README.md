<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Deployment values

The old minimal service/backend-operator values and generated storage fragments have
been retired with the two-chart installer. Use the unified chart's
[values](../charts/osmo/values.yaml) and [profiles](../charts/osmo/profiles/README.md),
then pass site-specific overrides to `deploy-osmo.sh --helm-values FILE` or Helm.

Existing two-chart deployments still need explicit configuration, release ownership,
and Secret/data migration. The unified installer rejects legacy values keys instead
of silently ignoring them. See the [migration notes](../scripts/README.md#existing-releases-and-teardown).
