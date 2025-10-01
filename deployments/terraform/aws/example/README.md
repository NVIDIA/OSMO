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
   cd deployment/aws/example
   ```

2. **Copy and customize the variables:**
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your desired values
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
| `rds_instance_class` | RDS instance type | `db.t3.micro` | `db.r5.large+` |
| `rds_multi_az` | RDS Multi-AZ | `false` | `true` |
| `redis_node_type` | Redis node type | `cache.t3.micro` | `cache.r5.large+` |
| `alb_enable_deletion_protection` | ALB deletion protection | `false` | `true` |

### Security Considerations

- **RDS Password**: Change the default password in `terraform.tfvars`
- **Security Groups**: Configured to allow access only from EKS nodes
- **Private Subnets**: Database resources are isolated in private subnets
- **Network ACLs**: Default VPC NACLs provide additional security layer

## Connecting to Resources

### EKS Cluster

After deployment, configure kubectl:

```bash
aws eks update-kubeconfig --region $(terraform output -raw aws_region) --name $(terraform output -raw cluster_name)
```

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

Connect from within the VPC:
```bash
redis-cli -h $(terraform output -raw redis_primary_endpoint_address) -p 6379
```

### Application Load Balancer

Connection details:
- **DNS Name**: `terraform output alb_dns_name`
- **Zone ID**: `terraform output alb_hosted_zone_id` (for Route 53 alias records)

The ALB is configured to work with the AWS Load Balancer Controller in your EKS cluster. Create Kubernetes Ingress resources to automatically configure routing:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/load-balancer-name: your-cluster-name-alb
    alb.ingress.kubernetes.io/target-type: ip
spec:
  rules:
  - host: my-app.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-app-service
            port:
              number: 80
```

## Terraform Modules Used

This configuration uses the following community modules:

- [`terraform-aws-modules/vpc/aws`](https://github.com/terraform-aws-modules/terraform-aws-vpc) - VPC with subnets, NAT gateway, etc.
- [`terraform-aws-modules/eks/aws`](https://github.com/terraform-aws-modules/terraform-aws-eks) - EKS cluster with managed node groups
- [`terraform-aws-modules/alb/aws`](https://github.com/terraform-aws-modules/terraform-aws-alb) - Application Load Balancer with security groups
- [`terraform-aws-modules/rds/aws`](https://github.com/terraform-aws-modules/terraform-aws-rds) - RDS instance with proper configuration
- [`terraform-aws-modules/elasticache/aws`](https://github.com/terraform-aws-modules/terraform-aws-elasticache) - ElastiCache Redis cluster

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

**Warning**: This will permanently delete all resources. Ensure you have backups if needed.

## Troubleshooting

### Common Issues

1. **Insufficient permissions**: Ensure your AWS credentials have the necessary permissions for EKS, RDS, ElastiCache, and VPC management.

2. **Resource limits**: Check AWS service limits in your region for EKS, RDS, and ElastiCache.

3. **AZ availability**: Some instance types may not be available in all AZs. The configuration automatically selects available AZs.

### Getting Help

- Check Terraform logs with `TF_LOG=DEBUG terraform apply`
- Review AWS CloudTrail for API calls and errors
- Consult the terraform-aws-modules documentation for module-specific issues
