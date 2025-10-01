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

# VPC Outputs
output "vpc_id" {
  description = "ID of the VPC"
  value       = module.vpc.vpc_id
}

output "vpc_cidr_block" {
  description = "The CIDR block of the VPC"
  value       = module.vpc.vpc_cidr_block
}

output "private_subnets" {
  description = "List of IDs of private subnets"
  value       = module.vpc.private_subnets
}

output "public_subnets" {
  description = "List of IDs of public subnets"
  value       = module.vpc.public_subnets
}

output "database_subnets" {
  description = "List of IDs of database subnets"
  value       = module.vpc.database_subnets
}

output "nat_gateway_ids" {
  description = "List of IDs of the NAT Gateways"
  value       = module.vpc.natgw_ids
}

# EKS Outputs
output "cluster_endpoint" {
  description = "Endpoint for EKS control plane"
  value       = module.eks.cluster_endpoint
}

output "cluster_security_group_id" {
  description = "Security group ids attached to the cluster control plane"
  value       = module.eks.cluster_security_group_id
}

output "cluster_iam_role_name" {
  description = "IAM role name associated with EKS cluster"
  value       = module.eks.cluster_iam_role_name
}

output "cluster_iam_role_arn" {
  description = "IAM role ARN associated with EKS cluster"
  value       = module.eks.cluster_iam_role_arn
}

output "cluster_certificate_authority_data" {
  description = "Base64 encoded certificate data required to communicate with the cluster"
  value       = module.eks.cluster_certificate_authority_data
  sensitive   = true
}

output "cluster_primary_security_group_id" {
  description = "The cluster primary security group ID created by the EKS cluster"
  value       = module.eks.cluster_primary_security_group_id
}

output "eks_managed_node_groups" {
  description = "Map of attribute maps for all EKS managed node groups created"
  value       = module.eks.eks_managed_node_groups
}

output "eks_managed_node_groups_autoscaling_group_names" {
  description = "List of the autoscaling group names created by EKS managed node groups"
  value       = module.eks.eks_managed_node_groups_autoscaling_group_names
}

# RDS Outputs
output "rds_instance_id" {
  description = "The RDS instance ID"
  value       = module.rds.db_instance_identifier
}

output "rds_instance_endpoint" {
  description = "The connection endpoint"
  value       = module.rds.db_instance_endpoint
}

output "rds_instance_hosted_zone_id" {
  description = "The canonical hosted zone ID of the DB instance (to be used in a Route 53 Alias record)"
  value       = module.rds.db_instance_hosted_zone_id
}

output "rds_instance_address" {
  description = "The hostname of the RDS instance"
  value       = module.rds.db_instance_address
}

output "rds_instance_port" {
  description = "The database port"
  value       = module.rds.db_instance_port
}

output "rds_subnet_group_id" {
  description = "The db subnet group name"
  value       = module.rds.db_subnet_group_id
}

output "rds_parameter_group_id" {
  description = "The db parameter group id"
  value       = module.rds.db_parameter_group_id
}

# Redis Outputs
output "redis_replication_group_id" {
  description = "The ID of the ElastiCache replication group"
  value       = module.elasticache.replication_group_id
}

output "redis_replication_group_arn" {
  description = "The Amazon Resource Name (ARN) of the replication group"
  value       = module.elasticache.replication_group_arn
}

output "redis_primary_endpoint_address" {
  description = "The address of the endpoint for the primary node in the replication group"
  value       = module.elasticache.replication_group_primary_endpoint_address
}

output "redis_reader_endpoint_address" {
  description = "The address of the endpoint for the reader node in the replication group"
  value       = module.elasticache.replication_group_reader_endpoint_address
}

output "redis_member_clusters" {
  description = "The identifiers of all the nodes that are part of this replication group"
  value       = module.elasticache.replication_group_member_clusters
}

# Security Group Outputs
output "rds_security_group_id" {
  description = "The ID of the security group for RDS"
  value       = aws_security_group.rds.id
}

output "redis_security_group_id" {
  description = "The ID of the security group for Redis"
  value       = aws_security_group.redis.id
}

# ALB Outputs
output "alb_id" {
  description = "The ID and ARN of the load balancer"
  value       = module.alb.id
}

output "alb_arn" {
  description = "The ARN of the load balancer"
  value       = module.alb.arn
}

output "alb_dns_name" {
  description = "The DNS name of the load balancer"
  value       = module.alb.dns_name
}

output "alb_hosted_zone_id" {
  description = "The canonical hosted zone ID of the load balancer (to be used in a Route 53 Alias record)"
  value       = module.alb.zone_id
}

output "alb_security_group_id" {
  description = "The ID of the security group for ALB"
  value       = module.alb.security_group_id
}
