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

# General Variables
variable "azure_region" {
  description = "Azure region"
  type        = string
  default     = "East US"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "osmo"
}

variable "subscription_id" {
  description = "Subscription ID"
  type        = string
  default     = null
}

variable "owner" {
  description = "Owner of the resources"
  type        = string
  default     = "platform-team"
}

variable "cluster_name" {
  description = "Name of the AKS cluster"
  type        = string
  default     = "osmo-cluster"
}

variable "resource_group_name" {
  description = "Name of the existing resource group"
  type        = string
}

# Virtual Network Variables
variable "vnet_cidr" {
  description = "CIDR block for VNet"
  type        = string
  default     = "10.0.0.0/16"
}

variable "private_subnets" {
  description = "Private subnets CIDR blocks"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "database_subnets" {
  description = "Database subnets CIDR blocks"
  type        = list(string)
  default     = ["10.0.201.0/24", "10.0.202.0/24"]
}

variable "availability_zones" {
  description = "Availability zones for AKS nodes"
  type        = list(string)
  default     = ["1", "2"]
}

# AKS Variables
variable "kubernetes_version" {
  description = "Kubernetes version"
  type        = string
  default     = "1.31.1"
}

variable "node_instance_type" {
  description = "Instance type for AKS node pool"
  type        = string
  default     = "Standard_D2s_v3"
}

variable "node_group_min_size" {
  description = "Minimum number of nodes in AKS node pool"
  type        = number
  default     = 1
}

variable "node_group_max_size" {
  description = "Maximum number of nodes in AKS node pool"
  type        = number
  default     = 5
}

variable "node_group_desired_size" {
  description = "Desired number of nodes in AKS node pool (not used with auto-scaling, kept for compatibility)"
  type        = number
  default     = 3
}

variable "aks_private_cluster_enabled" {
  description = "Enable private AKS cluster"
  type        = bool
  default     = true
}

variable "aks_public_network_access_enabled" {
  description = "Enable public network access to AKS API server"
  type        = bool
  default     = true
}

variable "aks_admin_group_object_ids" {
  description = "Azure AD group object IDs for AKS cluster admin access"
  type        = list(string)
  default     = []
}

variable "aks_msi_auth_for_monitoring_enabled" {
  description = "Enable MSI authentication for monitoring (Container Insights)"
  type        = bool
  default     = true
}

variable "aks_service_cidr" {
  description = "CIDR range for Kubernetes services (must not overlap with VNet)"
  type        = string
  default     = "192.168.0.0/16"

  validation {
    condition     = can(cidrhost(var.aks_service_cidr, 0))
    error_message = "The service CIDR must be a valid CIDR block."
  }
}

variable "aks_dns_service_ip" {
  description = "IP address for DNS service (must be within service CIDR and not be the network/broadcast address)"
  type        = string
  default     = "192.168.0.10"

  validation {
    condition     = can(regex("^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}$", var.aks_dns_service_ip))
    error_message = "The DNS service IP must be a valid IPv4 address."
  }
}

# PostgreSQL Variables
variable "postgres_version" {
  description = "PostgreSQL version"
  type        = string
  default     = "15"
}

variable "postgres_sku_name" {
  description = "PostgreSQL SKU name"
  type        = string
  default     = "GP_Standard_D2s_v3"
}

variable "postgres_storage_mb" {
  description = "PostgreSQL storage in MB"
  type        = number
  default     = 32768 # 32 GB
}

variable "postgres_db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "osmo"
}

variable "postgres_username" {
  description = "PostgreSQL admin username"
  type        = string
  default     = "postgres"
}

variable "postgres_password" {
  description = "PostgreSQL admin password — required, no default. Pass via --postgres-password to deploy-osmo-minimal.sh or set TF_VAR_postgres_password."
  type        = string
  sensitive   = true
}

variable "postgres_backup_retention_days" {
  description = "PostgreSQL backup retention period in days"
  type        = number
  default     = 7
}

variable "postgres_geo_redundant_backup_enabled" {
  description = "Enable geo-redundant backup for PostgreSQL"
  type        = bool
  default     = false
}

variable "postgres_extensions" {
  description = "List of PostgreSQL extensions to enable"
  type        = list(string)
  default     = ["hstore", "uuid-ossp", "pg_stat_statements"]
}

# Azure Managed Redis Variables (OSMO requires Redis 7+).
# SKU families: Balanced (default), MemoryOptimized, ComputeOptimized,
#               FlashOptimized (RAM-on-NVMe, cheaper at scale).
# Sizes: B0 (~250MB) → B1000 (~10TB+ on Flash). B0 is the smallest dev/test SKU.
variable "redis_sku_name" {
  description = "Azure Managed Redis SKU (e.g. Balanced_B0, MemoryOptimized_M10)."
  type        = string
  default     = "Balanced_B0"

  validation {
    condition     = can(regex("^(Balanced|MemoryOptimized|ComputeOptimized|FlashOptimized)_[BMC][0-9]+$", var.redis_sku_name))
    error_message = "redis_sku_name must be a Managed Redis SKU (e.g. Balanced_B0)."
  }
}

variable "redis_version" {
  description = "Redis version. OSMO requires Redis 7+, which on Azure is only available via Redis Enterprise (azurerm_redis_enterprise_cluster). The basic azurerm_redis_cache resource caps at 6."
  type        = string
  default     = "7"

  validation {
    condition     = tonumber(var.redis_version) >= 7
    error_message = "OSMO requires Redis 7 or higher (Azure Redis Enterprise)."
  }
}

# Log Analytics Variables
variable "log_analytics_sku" {
  description = "The SKU of the Log Analytics Workspace"
  type        = string
  default     = "PerGB2018"
}

variable "log_analytics_retention_days" {
  description = "The workspace data retention in days"
  type        = number
  default     = 30
}

# Optional GPU node pool — disabled by default to keep `example` minimal.
variable "gpu_node_pool_enabled" {
  description = "Provision an optional GPU node pool tainted with sku=gpu:NoSchedule"
  type        = bool
  default     = false
}

variable "gpu_vm_size" {
  description = "Azure VM size for GPU nodes (e.g. Standard_NC24ads_A100_v4, Standard_NC40ads_H100_v5)"
  type        = string
  default     = "Standard_NC24ads_A100_v4"
}

variable "gpu_node_pool_min_size" {
  description = "Minimum number of nodes in the GPU pool"
  type        = number
  default     = 0
}

variable "gpu_node_pool_max_size" {
  description = "Maximum number of nodes in the GPU pool"
  type        = number
  default     = 4
}

variable "gpu_node_pool_priority" {
  description = "Node pool priority: Regular (default) or Spot"
  type        = string
  default     = "Regular"

  validation {
    condition     = contains(["Regular", "Spot"], var.gpu_node_pool_priority)
    error_message = "gpu_node_pool_priority must be 'Regular' or 'Spot'."
  }
}

# Optional Storage Account for OSMO workflow data — disabled by default.
# When false, BYO an existing Storage Account by setting STORAGE_ACCOUNT and
# STORAGE_KEY env vars before running configure-storage.sh --backend azure-blob.
variable "storage_account_enabled" {
  description = "Provision an Azure Storage Account for OSMO workflow data"
  type        = bool
  default     = false
}
