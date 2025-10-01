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

# Resource Group Outputs
output "resource_group_name" {
  description = "Name of the resource group"
  value       = data.azurerm_resource_group.main.name
}

output "resource_group_location" {
  description = "Location of the resource group"
  value       = data.azurerm_resource_group.main.location
}

# Virtual Network Outputs
output "vnet_id" {
  description = "ID of the VNet"
  value       = module.vnet.resource_id
}

output "vnet_name" {
  description = "Name of the VNet"
  value       = module.vnet.name
}

output "vnet_address_space" {
  description = "Address space of the VNet"
  value       = [var.vnet_cidr]
}

output "private_subnet_ids" {
  description = "List of IDs of private subnets"
  value       = azurerm_subnet.private[*].id
}

output "database_subnet_ids" {
  description = "List of IDs of database subnets"
  value       = azurerm_subnet.database[*].id
}

output "nat_gateway_id" {
  description = "ID of the NAT Gateway"
  value       = azurerm_nat_gateway.main.id
}

# AKS Outputs
output "aks_cluster_id" {
  description = "ID of the AKS cluster"
  value       = azurerm_kubernetes_cluster.main.id
}

output "aks_cluster_name" {
  description = "Name of the AKS cluster"
  value       = azurerm_kubernetes_cluster.main.name
}

output "aks_cluster_fqdn" {
  description = "FQDN of the AKS cluster"
  value       = azurerm_kubernetes_cluster.main.fqdn
}

output "aks_cluster_endpoint" {
  description = "Endpoint for AKS control plane"
  value       = azurerm_kubernetes_cluster.main.kube_config.0.host
  sensitive   = true
}

output "aks_cluster_ca_certificate" {
  description = "Base64 encoded certificate data required to communicate with the cluster"
  value       = azurerm_kubernetes_cluster.main.kube_config.0.cluster_ca_certificate
  sensitive   = true
}

output "aks_kube_config" {
  description = "Raw kube config for AKS cluster"
  value       = azurerm_kubernetes_cluster.main.kube_config_raw
  sensitive   = true
}

output "aks_node_resource_group" {
  description = "The auto-generated resource group which contains the resources for this managed Kubernetes cluster"
  value       = azurerm_kubernetes_cluster.main.node_resource_group
}

output "aks_system_assigned_identity" {
  description = "The system assigned identity of the AKS cluster"
  value       = azurerm_kubernetes_cluster.main.identity
}

# PostgreSQL Outputs
output "postgres_server_id" {
  description = "The ID of the PostgreSQL Flexible Server"
  value       = azurerm_postgresql_flexible_server.main.id
}

output "postgres_server_name" {
  description = "The name of the PostgreSQL Flexible Server"
  value       = azurerm_postgresql_flexible_server.main.name
}

output "postgres_server_fqdn" {
  description = "The FQDN of the PostgreSQL Flexible Server"
  value       = azurerm_postgresql_flexible_server.main.fqdn
}

output "postgres_database_id" {
  description = "The database resource ID"
  value       = azurerm_postgresql_flexible_server_database.main.id
}

output "postgres_database_name" {
  description = "The database name"
  value       = azurerm_postgresql_flexible_server_database.main.name
}

output "postgres_admin_username" {
  description = "The administrator username for the PostgreSQL server"
  value       = var.postgres_username
  sensitive   = true
}

# Redis Outputs
output "redis_cache_id" {
  description = "The ID of the Redis Enterprise Cluster"
  value       = azurerm_redis_enterprise_cluster.main.id
}

output "redis_cache_name" {
  description = "The name of the Redis Enterprise Cluster"
  value       = azurerm_redis_enterprise_cluster.main.name
}

output "redis_cache_hostname" {
  description = "The hostname of the Redis Enterprise Cluster"
  value       = azurerm_redis_enterprise_cluster.main.hostname
}

output "redis_cache_ssl_port" {
  description = "The port of the Redis Enterprise Database"
  value       = azurerm_redis_enterprise_database.main.port
}

output "redis_cache_port" {
  description = "The port of the Redis Enterprise Database (encrypted by default)"
  value       = azurerm_redis_enterprise_database.main.port
}

output "redis_cache_primary_access_key" {
  description = "The primary access key for the Redis Enterprise Database"
  value       = azurerm_redis_enterprise_database.main.primary_access_key
  sensitive   = true
}

output "redis_cache_secondary_access_key" {
  description = "The secondary access key for the Redis Enterprise Database"
  value       = azurerm_redis_enterprise_database.main.secondary_access_key
  sensitive   = true
}

# Network Security Group Outputs
output "aks_nsg_id" {
  description = "The ID of the AKS Network Security Group"
  value       = azurerm_network_security_group.aks.id
}

output "database_nsg_id" {
  description = "The ID of the Database Network Security Group"
  value       = azurerm_network_security_group.database.id
}

# Private DNS Zone Outputs
output "postgres_private_dns_zone_id" {
  description = "The ID of the PostgreSQL private DNS zone"
  value       = azurerm_private_dns_zone.postgres.id
}

output "postgres_private_dns_zone_name" {
  description = "The name of the PostgreSQL private DNS zone"
  value       = azurerm_private_dns_zone.postgres.name
}

# Log Analytics Workspace Outputs
output "log_analytics_workspace_id" {
  description = "The ID of the Log Analytics Workspace"
  value       = azurerm_log_analytics_workspace.main.id
}

output "log_analytics_workspace_name" {
  description = "The name of the Log Analytics Workspace"
  value       = azurerm_log_analytics_workspace.main.name
}

output "log_analytics_workspace_primary_shared_key" {
  description = "The primary shared key for the Log Analytics Workspace"
  value       = azurerm_log_analytics_workspace.main.primary_shared_key
  sensitive   = true
}

output "log_analytics_workspace_workspace_id" {
  description = "The workspace ID of the Log Analytics Workspace"
  value       = azurerm_log_analytics_workspace.main.workspace_id
}

output "container_insights_solution_id" {
  description = "The ID of the Container Insights solution"
  value       = azurerm_log_analytics_solution.container_insights.id
}
