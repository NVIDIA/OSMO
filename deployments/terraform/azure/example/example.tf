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
  }
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
# `nvidia.com/gpu.present` (set by the NVIDIA GPU Operator's device plugin)
# and renders a matching toleration into Helm values for the OSMO pool.
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

  node_taints = ["sku=gpu:NoSchedule"]
  node_labels = {
    "nvidia.com/gpu" = "present"
    "sku"            = "gpu"
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
    # OSSCluster (not EnterpriseCluster): standard Redis OSS Cluster wire
    # protocol that redis-py / kombu / and other typical Redis client
    # libraries understand. EnterpriseCluster is a proprietary multi-shard
    # protocol that requires Redis Enterprise–aware clients. Empirically
    # validated against an existing osmo-cluster Redis (working in prior
    # deploys) which uses OSSCluster.
    clustering_policy = "OSSCluster"
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
