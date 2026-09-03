# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Non-secret Terraform inputs for this deployment example.
cluster_name                             = "osmo-cluster"
postgres_password                        = null
object_storage_workload_identity_enabled = true
postgres_password_generation_enabled     = true
storage_account_enabled                  = false
nfs_storage_account_enabled              = false
gpu_node_pool_enabled                    = false
aks_private_cluster_enabled              = false
node_instance_type                       = "Standard_D8s_v3"
