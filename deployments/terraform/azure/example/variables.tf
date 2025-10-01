# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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
    condition = can(regex("^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}$", var.aks_dns_service_ip))
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
  default     = 32768  # 32 GB
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
  description = "PostgreSQL admin password"
  type        = string
  sensitive   = true
  default     = "changeme123!"
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

# Redis Enterprise Variables
variable "redis_sku_name" {
  description = "Redis Enterprise SKU name with capacity (e.g., Enterprise_E10-2, Enterprise_E20-4)"
  type        = string
  default     = "Enterprise_E10-2"
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
