# AWS Infrastructure with Terraform

This Terraform configuration creates a complete AWS infrastructure including:

- **VPC** with public, private, and database subnets across multiple AZs
- **EKS cluster** with managed node groups
- **Application Load Balancer (ALB)** in public subnets for ingress traffic
- **RDS PostgreSQL instance** in private subnets
- **ElastiCache Redis cluster** in private subnets

All resources are deployed in the same VPC and properly networked together.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                           VPC                               │
│  ┌─────────────────────┐ ┌─────────────────────┐            │
│  │   Public Subnets    │ │   Private Subnets   │            │
│  │                     │ │                     │            │
│  │   - ALB             │ │   - EKS Nodes       │            │
│  │   - NAT Gateway     │ │   - Application     │            │
│  │   - Internet GW     │ │                     │            │
│  └─────────────────────┘ └─────────────────────┘            │
│                          ┌─────────────────────┐            │
│                          │  Database Subnets   │            │
│                          │                     │            │
│                          │   - RDS PostgreSQL  │            │
│                          │   - ElastiCache     │            │
│                          └─────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. **AWS CLI** configured with appropriate credentials
2. **Terraform** >= 1.0 installed
3. **kubectl** (optional, for EKS cluster management)

## Quick Start

1. **Clone and navigate to the directory:**
   ```bash
   cd deployments/terraform/aws/example
   ```

2. **Copy and customize the variables:**
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your desired values
   # IMPORTANT: Replace default passwords for RDS and Redis before deployment
   ```

3. **Initialize Terraform:**
   ```bash
   terraform init
   ```

4. **Plan the deployment:**
   ```bash
   terraform plan
   ```

5. **Apply the configuration:**
   ```bash
   terraform apply
   ```

## Configuration

### Key Variables

| Variable | Description | Default | Production Recommendation |
|----------|-------------|---------|---------------------------|
| `aws_region` | AWS region | `us-west-2` | Choose region closest to users |
| `cluster_name` | EKS cluster name | `osmo-cluster` | Use descriptive name |
| `single_nat_gateway` | Use single NAT gateway | `false` | `false` for HA |
| `eks_admin_principal_arns` | IAM ARNs for cluster access | `[]` | Add your admin users/roles |
| `rds_password` | RDS master password | `changeme123!` | **Must change before deploy** |
| `rds_instance_class` | RDS instance type | `db.t3.micro` | `db.r5.large+` |
| `rds_multi_az` | RDS Multi-AZ | `false` | `true` |
| `redis_auth_token` | Redis password (16+ chars) | See tfvars | **Must change before deploy** |
| `redis_node_type` | Redis node type | `cache.t3.micro` | `cache.r5.large+` |
| `alb_enable_deletion_protection` | ALB deletion protection | `false` | `true` |

### Security Considerations

- **RDS Password**: Change the default password in `terraform.tfvars` before deployment. Password is marked as sensitive in Terraform state.
- **Redis Password**: Change `redis_auth_token` in `terraform.tfvars` (minimum 16 characters). Transit encryption is enabled automatically.
- **EKS Access Management**: Uses AWS-native EKS Access Entries (not aws-auth ConfigMap). Node groups authenticate automatically via IAM.
- **Security Groups**: Configured to allow access only from EKS nodes to databases
- **Private Subnets**: EKS nodes and database resources are isolated in private subnets
- **Network Isolation**: Public subnets tagged for ALB discovery only; no worker nodes exposed publicly
- **Dependency Management**: Resources created in proper order with explicit `depends_on` declarations

## Connecting to Resources

### EKS Cluster

After deployment, configure kubectl:

```bash
aws eks update-kubeconfig --region $(terraform output -raw aws_region) --name $(terraform output -raw cluster_name)
```

**EKS Access Management (Module v20.0+)**

This configuration uses AWS-native **EKS Access Entries** instead of the deprecated aws-auth ConfigMap:

1. **Cluster Creator**: Automatically gets admin permissions via `enable_cluster_creator_admin_permissions = true`

2. **Additional Admins**: Add IAM principal ARNs in `terraform.tfvars`:
   ```hcl
   eks_admin_principal_arns = [
     "arn:aws:iam::123456789012:user/alice",
     "arn:aws:iam::123456789012:role/DevOpsTeam"
   ]
   ```

3. **Node Groups**: Authenticate automatically via IAM instance profiles (no manual configuration needed)

**Note**: If you need to grant access after deployment, add the ARN to `eks_admin_principal_arns` and run `terraform apply`.

### RDS Database

Connection details:
- **Endpoint**: `terraform output rds_instance_endpoint`
- **Port**: `terraform output rds_instance_port`
- **Database**: Value of `rds_db_name` variable
- **Username**: Value of `rds_username` variable

Connect from within the VPC (e.g., from a pod in EKS):
```bash
psql -h $(terraform output -raw rds_instance_address) -p $(terraform output -raw rds_instance_port) -U postgres -d osmo
```

### Redis Cache

Connection details:
- **Primary Endpoint**: `terraform output redis_primary_endpoint_address`
- **Port**: `6379`
- **Authentication**: Enabled with `redis_auth_token` (transit encryption enabled)

Connect from within the VPC (e.g., from a pod in EKS):
```bash
# Connect with authentication
redis-cli -h $(terraform output -raw redis_primary_endpoint_address) -p 6379 --tls --insecure -a <your-redis-password>

# Or authenticate after connecting
redis-cli -h $(terraform output -raw redis_primary_endpoint_address) -p 6379 --tls --insecure
> AUTH <your-redis-password>
```

**Note**: Your application must authenticate using the `redis_auth_token` value from your `terraform.tfvars`.

## Terraform Modules Used

This configuration uses the following community modules:

- [`terraform-aws-modules/vpc/aws`](https://github.com/terraform-aws-modules/terraform-aws-vpc) `~> 5.0` - VPC with subnets, NAT gateway, and ALB discovery tags
- [`terraform-aws-modules/eks/aws`](https://github.com/terraform-aws-modules/terraform-aws-eks) `~> 20.0` - EKS cluster with managed node groups and Access Entries
- [`terraform-aws-modules/alb/aws`](https://github.com/terraform-aws-modules/terraform-aws-alb) `~> 9.0` - Application Load Balancer with security groups
- [`terraform-aws-modules/rds/aws`](https://github.com/terraform-aws-modules/terraform-aws-rds) `~> 6.0` - RDS PostgreSQL instance with encryption
- [`terraform-aws-modules/elasticache/aws`](https://github.com/terraform-aws-modules/terraform-aws-elasticache) `~> 1.0` - ElastiCache Redis with auth token and transit encryption

## Cost Optimization

### Development Environment
- Set `single_nat_gateway = true`
- Use `db.t3.micro` for RDS
- Use `cache.t3.micro` for Redis
- Set `node_group_desired_size = 1`

### Production Environment
- Set `single_nat_gateway = false` for high availability
- Use larger instance types (`db.r5.large+`, `cache.r5.large+`)
- Enable Multi-AZ for RDS and Redis
- Scale node groups based on workload

## Outputs

The configuration provides comprehensive outputs including:

- VPC and subnet IDs
- EKS cluster endpoint and security groups
- ALB DNS name and zone ID for Route 53 records
- RDS connection details
- Redis endpoint information
- Security group IDs

Use `terraform output` to view all outputs or `terraform output <output_name>` for specific values.

## Cleanup

To destroy all resources:

```bash
terraform destroy
```

**Important Notes:**
- Resources are configured with explicit `depends_on` declarations for proper deletion order
- You may need to run `terraform destroy` twice due to AWS deletion delays
- EKS cluster and associated resources (node groups, ENIs) may take several minutes to delete
- RDS and ElastiCache snapshots may be retained based on your snapshot retention settings

**Warning**: This will permanently delete all resources. Ensure you have backups if needed.

## Troubleshooting

### Common Issues

1. **Insufficient permissions**: Ensure your AWS credentials have the necessary permissions for EKS, RDS, ElastiCache, and VPC management.

2. **Resource limits**: Check AWS service limits in your region for EKS, RDS, and ElastiCache.

3. **AZ availability**: Some instance types may not be available in all AZs. The configuration automatically selects available AZs.

4. **EKS Access Issues**: If you can't access the cluster after deployment:
   - Verify you're using the AWS identity that created the cluster (automatic admin access)
   - Or ensure your IAM ARN is in the `eks_admin_principal_arns` list
   - Run `terraform apply` after adding your ARN to update access entries

5. **Redis Authentication Errors**: If Redis connections fail:
   - Ensure you're using the `--tls` flag (transit encryption is enabled)
   - Verify you're authenticating with the correct `redis_auth_token`
   - Password must be at least 16 characters


### Getting Help

- Check Terraform logs with `TF_LOG=DEBUG terraform apply`
- Review AWS CloudTrail for API calls and errors
- Consult the terraform-aws-modules documentation for module-specific issues
