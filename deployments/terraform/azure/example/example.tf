# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

# Configure the Azure Provider
terraform {
  required_version = ">= 1.9"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 3.69.0"
    }
    azapi = {
      source  = "azure/azapi"
      version = ">= 1.4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.5.0"
    }
  }
}

# 5-char lowercase alphanumeric suffix for resources whose names must be
# globally unique (e.g. storage accounts). Only consumed by gated optional
# resources today; kept top-level so additional resources can reuse it.
resource "random_string" "suffix" {
  length  = 5
  special = false
  upper   = false
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

# Local variables for common tags and naming
locals {
  name = var.cluster_name
  tags = {
    Environment = var.environment
    Project     = var.project_name
    Owner       = var.owner
  }
}

# Data sources
data "azurerm_client_config" "current" {}

################################################################################
# Resource Group (Data Source - using existing RG)
################################################################################

data "azurerm_resource_group" "main" {
  name = var.resource_group_name
}

################################################################################
# Virtual Network
################################################################################

module "vnet" {
  source  = "Azure/avm-res-network-virtualnetwork/azurerm"
  version = "~> 0.10"

  name          = "${local.name}-vnet"
  parent_id     = data.azurerm_resource_group.main.id
  location      = data.azurerm_resource_group.main.location
  address_space = [var.vnet_cidr]

  subnets = {}

  tags = local.tags
}

# Additional subnets for private and database tiers
resource "azurerm_subnet" "private" {
  count                = length(var.private_subnets)
  name                 = "private-${count.index + 1}"
  resource_group_name  = data.azurerm_resource_group.main.name
  virtual_network_name = module.vnet.name
  address_prefixes     = [var.private_subnets[count.index]]

  # Microsoft.Storage service endpoint is required when the optional NFS
  # Storage Account (gated on var.nfs_storage_account_enabled) is enabled — NFS
  # Azure Files shares are reachable only over VNet endpoints when the SA has
  # `public_network_access_enabled = false`. Declared unconditionally so the
  # subnet doesn't churn on toggle and so additional VNet-restricted SAs
  # (logs, datasets, etc.) can attach without further subnet changes.
  service_endpoints = ["Microsoft.Storage"]
}

resource "azurerm_subnet" "database" {
  count                = length(var.database_subnets)
  name                 = "database-${count.index + 1}"
  resource_group_name  = data.azurerm_resource_group.main.name
  virtual_network_name = module.vnet.name
  address_prefixes     = [var.database_subnets[count.index]]

  # Delegation for PostgreSQL Flexible Server
  dynamic "delegation" {
    for_each = count.index == 0 ? [1] : []
    content {
      name = "postgres-delegation"
      service_delegation {
        name = "Microsoft.DBforPostgreSQL/flexibleServers"
        actions = [
          "Microsoft.Network/virtualNetworks/subnets/join/action",
        ]
      }
    }
  }
}

# NAT Gateway for private subnets
resource "azurerm_public_ip" "nat" {
  name                = "${local.name}-nat-pip"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.tags
}

resource "azurerm_nat_gateway" "main" {
  name                = "${local.name}-nat-gateway"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name
  sku_name            = "Standard"
  tags                = local.tags
}

resource "azurerm_nat_gateway_public_ip_association" "main" {
  nat_gateway_id       = azurerm_nat_gateway.main.id
  public_ip_address_id = azurerm_public_ip.nat.id
}

# Associate NAT Gateway with private subnets
resource "azurerm_subnet_nat_gateway_association" "private" {
  count          = length(var.private_subnets)
  subnet_id      = azurerm_subnet.private[count.index].id
  nat_gateway_id = azurerm_nat_gateway.main.id
}

################################################################################
# Log Analytics Workspace for Container Insights
################################################################################

resource "azurerm_log_analytics_workspace" "main" {
  name                = "${local.name}-logs"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name
  sku                 = var.log_analytics_sku
  retention_in_days   = var.log_analytics_retention_days

  tags = local.tags
}

resource "azurerm_log_analytics_solution" "container_insights" {
  solution_name         = "ContainerInsights"
  location              = data.azurerm_resource_group.main.location
  resource_group_name   = data.azurerm_resource_group.main.name
  workspace_resource_id = azurerm_log_analytics_workspace.main.id
  workspace_name        = azurerm_log_analytics_workspace.main.name

  plan {
    publisher = "Microsoft"
    product   = "OMSGallery/ContainerInsights"
  }

  tags = local.tags
}

################################################################################
# AKS Cluster
################################################################################

resource "azurerm_kubernetes_cluster" "main" {
  name                = local.name
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name
  dns_prefix          = local.name
  kubernetes_version  = var.kubernetes_version

  private_cluster_enabled = var.aks_private_cluster_enabled

  # Only configure authorized IP ranges for public clusters
  dynamic "api_server_access_profile" {
    for_each = var.aks_private_cluster_enabled ? [] : [1]
    content {
      authorized_ip_ranges = var.aks_public_network_access_enabled ? ["0.0.0.0/0"] : []
    }
  }

  default_node_pool {
    name                 = "system"
    min_count            = var.node_group_min_size
    max_count            = var.node_group_max_size
    vm_size              = var.node_instance_type
    type                 = "VirtualMachineScaleSets"
    zones                = var.availability_zones
    auto_scaling_enabled = true
    vnet_subnet_id       = azurerm_subnet.private[0].id
    max_pods             = 30
    os_disk_size_gb      = 50
  }

  # Ignore changes to node count since auto-scaling manages this
  lifecycle {
    ignore_changes = [
      default_node_pool[0].node_count
    ]
  }

  network_profile {
    network_plugin    = "azure"
    network_policy    = "azure"
    load_balancer_sku = "standard"
    outbound_type     = "loadBalancer"
    service_cidr      = var.aks_service_cidr
    dns_service_ip    = var.aks_dns_service_ip
  }

  azure_active_directory_role_based_access_control {
    azure_rbac_enabled     = true
    admin_group_object_ids = var.aks_admin_group_object_ids
  }

  identity {
    type = "SystemAssigned"
  }

  oms_agent {
    log_analytics_workspace_id      = azurerm_log_analytics_workspace.main.id
    msi_auth_for_monitoring_enabled = var.aks_msi_auth_for_monitoring_enabled
  }

  tags = local.tags

  depends_on = [
    azurerm_subnet_nat_gateway_association.private
  ]
}

################################################################################
# Optional GPU node pool (gated on var.gpu_node_pool_enabled)
#
# Adds a separate AKS node pool with `sku=gpu:NoSchedule` taint so non-GPU
# workloads don't schedule there. deploy-k8s.sh detects nodes labeled
# `nvidia.com/gpu=present` (set below via `node_labels`) and renders a matching
# nodeSelector + toleration into Helm values for the OSMO pool.
################################################################################

resource "azurerm_kubernetes_cluster_node_pool" "gpu" {
  count                 = var.gpu_node_pool_enabled ? 1 : 0
  name                  = "gpu"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size               = var.gpu_vm_size
  min_count             = var.gpu_node_pool_min_size
  max_count             = var.gpu_node_pool_max_size
  auto_scaling_enabled  = true
  vnet_subnet_id        = azurerm_subnet.private[0].id
  zones                 = var.availability_zones
  os_disk_size_gb       = 100
  priority              = var.gpu_node_pool_priority
  eviction_policy       = var.gpu_node_pool_priority == "Spot" ? "Delete" : null
  spot_max_price        = var.gpu_node_pool_priority == "Spot" ? -1 : null

  # Use the NVIDIA-standard taint key. GPU Operator (clusterpolicy.spec.
  # daemonsets.tolerations), NFD worker DaemonSet, NIM Operator's NIMService
  # pods, and KAI Scheduler's mutating webhook all default-tolerate
  # `nvidia.com/gpu:NoSchedule`. Non-standard taint keys (e.g. `sku=gpu`)
  # require extending tolerations across every NVIDIA chart and break the
  # GPU Operator's GPU-detection cascade when the NFD worker can't land on
  # the GPU node.
  node_taints = ["nvidia.com/gpu=present:NoSchedule"]
  node_labels = {
    "nvidia.com/gpu" = "present"
  }

  tags = local.tags
}

################################################################################
# Optional Storage Account for OSMO workflow data (gated on var.storage_account_enabled)
#
# When enabled, configure-storage.sh --backend azure-blob reads the outputs
# (storage_account, storage_account_key) directly. Disable to BYO an existing
# Storage Account; pass STORAGE_ACCOUNT/STORAGE_KEY as env vars instead.
################################################################################

resource "azurerm_storage_account" "osmo" {
  count                    = var.storage_account_enabled ? 1 : 0
  name                     = replace("${local.name}osmo", "-", "")
  resource_group_name      = data.azurerm_resource_group.main.name
  location                 = data.azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
  tags                     = local.tags
}

resource "azurerm_storage_container" "osmo_workflows" {
  count                 = var.storage_account_enabled ? 1 : 0
  name                  = "osmo-workflows"
  storage_account_id    = azurerm_storage_account.osmo[0].id
  container_access_type = "private"
}

################################################################################
# PostgreSQL Flexible Server
################################################################################

resource "azurerm_private_dns_zone" "postgres" {
  name                = "${local.name}.postgres.database.azure.com"
  resource_group_name = data.azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "${local.name}-postgres-dns-link"
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = module.vnet.resource_id
  resource_group_name   = data.azurerm_resource_group.main.name
  tags                  = local.tags
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                          = "${local.name}-postgres"
  resource_group_name           = data.azurerm_resource_group.main.name
  location                      = data.azurerm_resource_group.main.location
  version                       = var.postgres_version
  delegated_subnet_id           = azurerm_subnet.database[0].id
  private_dns_zone_id           = azurerm_private_dns_zone.postgres.id
  administrator_login           = var.postgres_username
  administrator_password        = var.postgres_password
  zone                          = "1"
  public_network_access_enabled = false

  storage_mb = var.postgres_storage_mb

  sku_name = var.postgres_sku_name

  backup_retention_days        = var.postgres_backup_retention_days
  geo_redundant_backup_enabled = var.postgres_geo_redundant_backup_enabled

  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]

  tags = local.tags
}

resource "azurerm_postgresql_flexible_server_database" "main" {
  name      = var.postgres_db_name
  server_id = azurerm_postgresql_flexible_server.main.id
  collation = "en_US.utf8"
  charset   = "utf8"
}

# Disable SSL requirement for OSMO compatibility
resource "azurerm_postgresql_flexible_server_configuration" "ssl_off" {
  name      = "require_secure_transport"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "off"
}

# Enable PostgreSQL extensions
resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  count     = length(var.postgres_extensions) > 0 ? 1 : 0
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = join(",", var.postgres_extensions)

  depends_on = [azurerm_postgresql_flexible_server_configuration.ssl_off]
}

################################################################################
# Azure Managed Redis (required for Redis 7+)
#
# OSMO requires Redis 7. The standard `azurerm_redis_cache` resource caps at
# Redis 6, and `azurerm_redis_enterprise_cluster` was retired by Azure
# (creations of new Enterprise resources return BadRequest as of 2025).
# Azure Managed Redis is the current path forward — same cluster+database
# split, Balanced/MemoryOptimized/ComputeOptimized SKU families, port 10000
# by convention.
################################################################################

resource "azurerm_managed_redis" "main" {
  name                = "${local.name}-redis"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name
  sku_name            = var.redis_sku_name

  default_database {
    client_protocol = "Encrypted"
    # EnterpriseCluster (not OSSCluster): exposes a SINGLE proxy endpoint that
    # hides multi-shard routing from clients. OSMO uses standard non-cluster
    # redis-py / kombu clients (no RedisCluster awareness), so they can't
    # follow `MOVED` redirects that OSSCluster sends when a key lives on a
    # different shard. With multi-shard SKUs like ComputeOptimized_X3 +
    # OSSCluster, `osmo workflow submit` fails on the first sharded LLEN with
    # `MOVED 11355 <other-node>:<port>`. EnterpriseCluster avoids this by
    # routing all client commands through the front-door proxy.
    #
    # IMPORTANT: clustering_policy is IMMUTABLE post-create — Azure rejects
    # in-place changes with BadRequest. The resource must be replaced to change
    # this. Earlier osmo-cluster Redis used OSSCluster + Enterprise tier (now
    # retired), which proxies internally regardless; that's why it worked
    # there but fails here on the new Managed Redis SKU families.
    clustering_policy = "EnterpriseCluster"
    eviction_policy   = "VolatileLRU"
    # Required to surface primary_access_key / secondary_access_key as
    # computed outputs. When this is unset (default: Disabled), the keys
    # exist on Azure side (callable via REST listKeys) but the Terraform
    # provider returns empty strings, so the redis-secret in K8s gets
    # created with an empty password and every Redis-using pod fails
    # AUTH with "Authentication required". Setting this true at create
    # time ensures the keys are visible to TF immediately.
    access_keys_authentication_enabled = true
  }

  tags = local.tags
}

################################################################################
# Network Security Groups
################################################################################

# Network Security Group for AKS
resource "azurerm_network_security_group" "aks" {
  name                = "${local.name}-aks-nsg"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name

  security_rule {
    name                       = "AllowHTTPS"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  tags = local.tags
}

# Associate NSG with AKS subnet
resource "azurerm_subnet_network_security_group_association" "aks" {
  subnet_id                 = azurerm_subnet.private[0].id # First private subnet
  network_security_group_id = azurerm_network_security_group.aks.id
}

# Network Security Group for Database subnets
resource "azurerm_network_security_group" "database" {
  name                = "${local.name}-database-nsg"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name

  security_rule {
    name                       = "AllowPostgreSQL"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "5432"
    source_address_prefixes    = var.private_subnets
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowRedis"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "10000"
    source_address_prefixes    = var.private_subnets
    destination_address_prefix = "*"
  }

  tags = local.tags
}

# Associate NSG with database subnets
resource "azurerm_subnet_network_security_group_association" "database" {
  count                     = length(var.database_subnets)
  subnet_id                 = azurerm_subnet.database[count.index].id
  network_security_group_id = azurerm_network_security_group.database.id
}

################################################################################
# Optional NFS Premium FileStorage SA (gated on var.nfs_storage_account_enabled)
#
# Enabled via `--with-nfs-storage` on deploy-osmo-minimal.sh, which exports
# TF_NFS_STORAGE_ACCOUNT_ENABLED=true so the heredoc in azure/terraform.sh
# flips this var. Provides a Premium FileStorage SA + the 4 AKS role
# assignments file.csi.azure.com needs to dynamically provision NFS shares.
#
# Scope boundary: osmo only owns the SA + role grants. The StorageClass
# manifest (with protocol: nfs + nconnect=4 etc.) and the default-SC swap
# belong to the downstream consumer skill (e.g. NIM Operator), which reads
# the SA name from `terraform output -raw nfs_storage_account` and renders
# its own StorageClass against it.
#
# Required when the cluster hosts RWX workloads (e.g. NIM Operator multi-node
# inference: https://docs.nvidia.com/nim-operator/latest/multi-node.html).
# Without the consumer's SC, RWX PVCs created later sit Pending forever
# because Azure's stock `managed-csi` / `default` classes only support RWO.
################################################################################

# NFS-backed Premium FileStorage SA hosting dynamic PVCs from
# `file.csi.azure.com`. Pre-created so TF owns the lifecycle end-to-end;
# `terraform destroy` removes it (and all shares inside). Without a
# pre-created SA the driver auto-provisions one with prefix `f<hex>` in
# whatever RG the StorageClass points at — that SA is outside TF state and
# blocks RG deletion.
#   Driver default-account behavior:
#     https://github.com/kubernetes-sigs/azurefile-csi-driver/blob/master/docs/driver-parameters.md
#   NFS on Azure Files requires Premium + FileStorage:
#     https://learn.microsoft.com/en-us/azure/storage/files/storage-files-how-to-mount-nfs-shares
resource "azurerm_storage_account" "nfs" {
  count = var.nfs_storage_account_enabled ? 1 : 0
  # Azure storage account names: 3-24 chars, lowercase alphanumeric only.
  # Defensively normalize cluster_name (lower + strip non-alphanumerics) before
  # clamping to a 19-char prefix budget so the trailing 5-char random suffix
  # keeps the total at <=24. environment intentionally omitted from the name
  # (still carried in tags) so overrides can't blow the budget.
  name                          = "${substr(lower(replace("stnfs${var.cluster_name}", "/[^0-9a-z]/", "")), 0, 19)}${random_string.suffix.result}"
  location                      = data.azurerm_resource_group.main.location
  resource_group_name           = data.azurerm_resource_group.main.name
  account_tier                  = "Premium"     # FileStorage requires Premium
  account_kind                  = "FileStorage" # NFS shares require FileStorage kind
  account_replication_type      = "LRS"
  # Azure Files NFS over service endpoints requires the SA's public endpoint to
  # remain reachable; with PNA=false the public endpoint is blocked and NFS
  # mounts fail. Keep PNA enabled and rely on the VNet-scoped network_rules
  # below to restrict access. Consumers wanting fully-private access can layer
  # an azurerm_private_endpoint + privatelink.file.core.windows.net DNS zone
  # in their own skill and flip PNA to false there.
  public_network_access_enabled = true
  https_traffic_only_enabled    = false # NFS does not use HTTPS; enabling blocks NFS mounts
  tags                          = local.tags

  network_rules {
    default_action             = "Deny"
    bypass                     = ["AzureServices"]
    virtual_network_subnet_ids = azurerm_subnet.private[*].id
  }
}

# AKS CP identity roles so the Azure File CSI driver can:
#   1. Network Contributor on the VNet — add Microsoft.Storage service
#      endpoint to the subnet (NFS shares are private-VNet-only).
#   2. Storage Account Contributor scoped to stnfs*  — create file shares
#      inside the pre-provisioned NFS SA via ARM. Scoped to this SA only; does
#      NOT grant rights to create new SAs in the RG.
#   3. Network Contributor on each NSG — `subnets/write` (granted by #1) is
#      not enough when the target subnet has an NSG attached: the ARM call
#      validates `Microsoft.Network/networkSecurityGroups/join/action` on
#      the linked NSG too, and that's a separate scope from the VNet. The
#      file.csi.azure.com driver iterates ALL VNet subnets to add the
#      Microsoft.Storage service endpoint when provisioning a PVC, so it
#      needs join on every NSG attached to a sibling subnet, not just the
#      one its own pods land in. Without these grants, PVC provisioning
#      fails with `LinkedAuthorizationFailed: ...does not have permission
#      to perform action(s) Microsoft.Network/networkSecurityGroups/
#      join/action on the linked scope...`.
resource "azurerm_role_assignment" "aks_vnet_net_contrib" {
  count                = var.nfs_storage_account_enabled ? 1 : 0
  scope                = module.vnet.resource_id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_kubernetes_cluster.main.identity[0].principal_id
}

resource "azurerm_role_assignment" "aks_nsg_aks_net_contrib" {
  count                = var.nfs_storage_account_enabled ? 1 : 0
  scope                = azurerm_network_security_group.aks.id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_kubernetes_cluster.main.identity[0].principal_id
}

resource "azurerm_role_assignment" "aks_nsg_database_net_contrib" {
  count                = var.nfs_storage_account_enabled ? 1 : 0
  scope                = azurerm_network_security_group.database.id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_kubernetes_cluster.main.identity[0].principal_id
}

resource "azurerm_role_assignment" "aks_nfs_sa_contrib" {
  count                = var.nfs_storage_account_enabled ? 1 : 0
  scope                = azurerm_storage_account.nfs[0].id
  role_definition_name = "Storage Account Contributor"
  principal_id         = azurerm_kubernetes_cluster.main.identity[0].principal_id
}
