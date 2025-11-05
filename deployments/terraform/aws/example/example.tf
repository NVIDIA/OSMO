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

# Configure the AWS Provider
terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
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
data "aws_availability_zones" "available" {
  state = "available"
}

################################################################################
# VPC Module
################################################################################

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${local.name}-vpc"
  cidr = var.vpc_cidr

  azs             = slice(data.aws_availability_zones.available.names, 0, 3)
  private_subnets = var.private_subnets
  public_subnets  = var.public_subnets
  database_subnets = var.database_subnets
  elasticache_subnets = var.elasticache_subnets

  # Tags for public subnets to enable ALB discovery by AWS Load Balancer Controller
  public_subnet_tags = {
    "kubernetes.io/role/elb"             = "1"
    "kubernetes.io/cluster/${local.name}" = "shared"
  }

  enable_nat_gateway     = true
  single_nat_gateway     = var.single_nat_gateway
  enable_vpn_gateway     = false
  enable_dns_hostnames   = true
  enable_dns_support     = true

  # Database subnet group
  create_database_subnet_group = true
  database_subnet_group_name   = "${local.name}-db-subnet-group"

  # ElastiCache subnet group
  create_elasticache_subnet_group = true
  elasticache_subnet_group_name   = "${local.name}-elasticache-subnet-group"

  tags = local.tags
}

################################################################################
# EKS Cluster
################################################################################

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 19.21"

  cluster_name    = local.name
  cluster_version = var.kubernetes_version

  vpc_id                          = module.vpc.vpc_id
  # Control plane needs access to both public and private subnets for ALB integration
  subnet_ids                      = concat(module.vpc.private_subnets, module.vpc.public_subnets)
  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true

  # EKS Managed Node Group(s)
  eks_managed_node_group_defaults = {
    instance_types = var.node_instance_types

    attach_cluster_primary_security_group = true
  }

  eks_managed_node_groups = {
    main = {
      name = "${local.name}-nodes"

      # Node groups should only be in private subnets for security
      subnet_ids = module.vpc.private_subnets

      min_size     = var.node_group_min_size
      max_size     = var.node_group_max_size
      desired_size = var.node_group_desired_size

      instance_types = var.node_instance_types
      capacity_type  = "ON_DEMAND"

      k8s_labels = {
        NodeGroup   = "${local.name}-nodes"
      }

      update_config = {
        max_unavailable_percentage = 33
      }

      tags = local.tags
    }
  }

  # aws-auth configmap to be set manually
  manage_aws_auth_configmap = false

  tags = local.tags

  depends_on = [module.vpc]
}

# IAM role for EKS admin
resource "aws_iam_role" "eks_admin_role" {
  name = "${local.name}-eks-admin-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "eks.amazonaws.com"
        }
      },
    ]
  })

  tags = local.tags
}

################################################################################
# RDS Instance
################################################################################

module "rds" {
  source  = "terraform-aws-modules/rds/aws"
  version = "~> 6.0"

  identifier = "${local.name}-database"

  engine               = var.rds_engine
  engine_version       = var.rds_engine_version
  family               = var.rds_family
  major_engine_version = var.rds_major_engine_version
  instance_class       = var.rds_instance_class

  allocated_storage     = var.rds_allocated_storage
  max_allocated_storage = var.rds_max_allocated_storage

  db_name  = var.rds_db_name
  username = var.rds_username
  password = var.rds_password
  port     = var.rds_port

  multi_az               = var.rds_multi_az
  publicly_accessible    = false
  vpc_security_group_ids = [aws_security_group.rds.id]

  db_subnet_group_name   = module.vpc.database_subnet_group_name
  backup_retention_period = var.rds_backup_retention_period
  backup_window          = "03:00-04:00"
  maintenance_window     = "Sun:04:00-Sun:05:00"

  # Enhanced Monitoring
  monitoring_interval = "30"
  monitoring_role_name = "${local.name}-rds-monitoring-role"
  create_monitoring_role = true

  tags = local.tags

  depends_on = [module.vpc, aws_security_group.rds]
}

# Security group for RDS
resource "aws_security_group" "rds" {
  name_prefix = "${local.name}-rds"
  vpc_id      = module.vpc.vpc_id
  description = "Security group for RDS instance"

  ingress {
    from_port       = var.rds_port
    to_port         = var.rds_port
    protocol        = "tcp"
    security_groups = [module.eks.cluster_primary_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${local.name}-rds" })

  depends_on = [module.eks]
}

################################################################################
# ElastiCache Redis Instance
################################################################################

module "elasticache" {
  source  = "terraform-aws-modules/elasticache/aws"
  version = "~> 1.0"

  # Replication group
  replication_group_id       = "${local.name}-redis"
  description                = "${local.name} Redis cluster"

  node_type                  = var.redis_node_type
  port                       = 6379
  parameter_group_name       = "default.redis7"

  num_cache_clusters         = var.redis_num_cache_nodes
  automatic_failover_enabled = var.redis_automatic_failover_enabled
  multi_az_enabled          = var.redis_multi_az_enabled

  engine_version = var.redis_engine_version

  # Security - Enable auth token (password)
  transit_encryption_enabled = true
  auth_token                 = var.redis_auth_token

  # Network
  create_subnet_group = false
  subnet_group_name = module.vpc.elasticache_subnet_group_name

  create_security_group = false
  security_group_ids = [aws_security_group.redis.id]

  # Backup
  snapshot_retention_limit = var.redis_snapshot_retention_limit
  snapshot_window         = "03:00-05:00"

  tags = local.tags

  depends_on = [module.vpc, aws_security_group.redis]
}

# Security group for Redis
resource "aws_security_group" "redis" {
  name_prefix = "${local.name}-redis"
  vpc_id      = module.vpc.vpc_id
  description = "Security group for Redis ElastiCache"

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [module.eks.cluster_primary_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${local.name}-redis" })

  depends_on = [module.eks]
}

################################################################################
# Application Load Balancer
################################################################################

module "alb" {
  source  = "terraform-aws-modules/alb/aws"
  version = "~> 9.0"

  name               = "${local.name}-alb"
  load_balancer_type = "application"

  vpc_id  = module.vpc.vpc_id
  subnets = module.vpc.public_subnets

  # ALB Configuration
  enable_deletion_protection = var.alb_enable_deletion_protection
  idle_timeout              = var.alb_idle_timeout
  enable_http2              = var.alb_enable_http2
  ip_address_type           = var.alb_ip_address_type

  # Security Group
  security_group_ingress_rules = {
    all_http = {
      from_port   = 80
      to_port     = 80
      ip_protocol = "tcp"
      cidr_ipv4   = "0.0.0.0/0"
    }
    all_https = {
      from_port   = 443
      to_port     = 443
      ip_protocol = "tcp"
      cidr_ipv4   = "0.0.0.0/0"
    }
  }

  security_group_egress_rules = {
    all = {
      ip_protocol = "-1"
      cidr_ipv4   = "0.0.0.0/0"
    }
  }

  # No listeners or target groups defined here
  # The AWS Load Balancer Controller will create these automatically
  # based on your Kubernetes Ingress resources

  tags = local.tags

  depends_on = [module.vpc, module.eks]
}

# Security group for ALB to EKS communication
resource "aws_security_group_rule" "alb_to_eks" {
  type                     = "ingress"
  from_port                = 0
  to_port                  = 65535
  protocol                 = "tcp"
  source_security_group_id = module.alb.security_group_id
  security_group_id        = module.eks.cluster_primary_security_group_id
  description              = "Allow ALB to communicate with EKS nodes"

  depends_on = [module.alb, module.eks]
}
