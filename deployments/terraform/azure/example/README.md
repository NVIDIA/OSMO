# Azure Infrastructure with Terraform

This Terraform configuration creates a complete Azure infrastructure using Azure Verified Modules including:

- **Existing Resource Group** (references your existing resource group)
- **Virtual Network (VNet)** with private and database subnets using Azure Verified Module
- **AKS cluster** with auto-scaling node pools and Container Insights monitoring
- **PostgreSQL Flexible Server** in private subnets with delegation
- **Azure Redis Enterprise Cluster** in private subnets
- **Log Analytics Workspace** with Container Insights solution for AKS monitoring

All resources are deployed in the same VNet and properly networked together.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Virtual Network                      │
│  ┌─────────────────────┐ ┌─────────────────────┐            │
│  │   Private Subnets   │ │  Database Subnets   │            │
│  │                     │ │                     │            │
│  │   - AKS Nodes       │ │   - PostgreSQL      │            │
│  │   - Applications    │ │   - Redis Cache     │            │
│  │   - NAT Gateway     │ │                     │            │
│  └─────────────────────┘ └─────────────────────┘            │
│                                                             │
│  🌐 Azure Load Balancer (Managed) provides public access    │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. **Azure CLI** installed and authenticated
2. **Terraform** >= 1.9 (recommended for latest Azure Verified Modules)
3. **kubectl** (optional, for AKS cluster management)
4. **Azure subscription** with appropriate permissions
5. **Existing Azure Resource Group** where resources will be deployed

## Quick Start

1. **Clone and navigate to the directory:**

2. **Copy and customize the variables:**
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your desired values
   ```

3. **Login to Azure:**
   ```bash
   az login
   ```

4. **Initialize Terraform:**
   ```bash
   terraform init
   ```

5. **Plan the deployment:**
   ```bash
   terraform plan
   ```

6. **Apply the configuration:**
   ```bash
   terraform apply
   ```

## Configuration

### Key Variables

| Variable | Description | Default | Production Recommendation |
|----------|-------------|---------|---------------------------|
| `azure_region` | Azure region | `East US` | Choose region closest to users |
| `resource_group_name` | Existing resource group | *(required)* | Must exist before running Terraform |
| `cluster_name` | AKS cluster name | `osmo-test` | Use descriptive name |
| `aks_private_cluster_enabled` | Private AKS cluster | `true` | `true` for security |
| `aks_service_cidr` | Kubernetes service CIDR | `192.168.0.0/16` | Must not overlap with VNet |
| `aks_dns_service_ip` | Kubernetes DNS service IP | `192.168.0.10` | Must be within service CIDR |
| `node_instance_type` | AKS node VM size | `Standard_D2s_v3` | `Standard_D4s_v3+` |
| `postgres_sku_name` | PostgreSQL SKU | `GP_Standard_D2s_v3` | `GP_Standard_D4s_v3+` |
| `redis_sku_name` | Redis SKU | `Enterprise_E10-2` | Enterprise tier for VNet integration |

### Security Considerations

- **PostgreSQL Password**: Change the default password in `terraform.tfvars`
- **Network Security Groups**: Configured to allow access only from AKS subnets
- **Private Subnets**: Database resources are isolated in private subnets
- **AKS Cluster Access**:
  - **Private Cluster** (`aks_private_cluster_enabled = true`): API server has private IP, accessible only from VNet
  - **Public Cluster** (`aks_private_cluster_enabled = false`): API server has public IP, controlled by `authorized_ip_ranges`
- **Network Isolation**:
  - **VNet CIDR**: `10.0.0.0/16` for your infrastructure
  - **Service CIDR**: `192.168.0.0/16` for Kubernetes internal services (isolated from VNet)
  - **DNS Service**: `192.168.0.10` for CoreDNS within service CIDR
- **Private DNS**: PostgreSQL uses private DNS zones for secure access

## Connecting to Resources

### AKS Cluster

After deployment, configure kubectl:

```bash
# Get AKS credentials
az aks get-credentials --resource-group $(terraform output -raw resource_group_name) --name $(terraform output -raw aks_cluster_name)

# Verify connection
kubectl get nodes
```

### PostgreSQL Database

Connection details:
- **Server**: `terraform output postgres_server_fqdn`
- **Database**: Value of `postgres_db_name` variable
- **Username**: Value of `postgres_username` variable

Connect from within the VNet (e.g., from a pod in AKS):
```bash
psql -h $(terraform output -raw postgres_server_fqdn) -U postgres -d osmo
```

### Redis Cache

Connection details:
- **Hostname**: `terraform output redis_cache_hostname`
- **SSL Port**: `terraform output redis_cache_ssl_port`

Connect from within the VNet:
```bash
redis-cli -h $(terraform output -raw redis_cache_hostname) -p $(terraform output -raw redis_cache_ssl_port) --tls
```

### Container Insights (Azure Monitor)

The AKS cluster is configured with Container Insights for comprehensive monitoring:

- **Log Analytics Workspace**: Centralized logging and monitoring
- **Container Insights Solution**: Monitors container performance, logs, and health
- **MSI Authentication**: Secure authentication using managed service identity

#### Accessing Container Insights

1. **Azure Portal**: Navigate to your AKS cluster → Monitoring → Insights
2. **Log Analytics Workspace**: `terraform output log_analytics_workspace_name`
3. **Workspace ID**: `terraform output log_analytics_workspace_workspace_id`

#### Common Monitoring Queries

Access these via Azure Portal → Log Analytics Workspaces → your workspace → Logs:

```kusto
// Container CPU usage
Perf
| where ObjectName == "K8SContainer" and CounterName == "cpuUsageNanoCores"
| summarize AvgCPU = avg(CounterValue) by bin(TimeGenerated, 5m), InstanceName

// Pod restarts
KubePodInventory
| where PodStatus == "Running"
| summarize RestartCount = max(PodRestartCount) by Name, Namespace

// Node capacity
KubeNodeInventory
| summarize by Computer, Capacity = todynamic(Capacity)
```

## Azure Terraform Modules Used

This configuration uses the following components:

- [`Azure/avm-res-network-virtualnetwork/azurerm`](https://github.com/Azure/terraform-azurerm-avm-res-network-virtualnetwork) - Azure Verified Module for Virtual Network
- **Direct AzureRM resources** for AKS cluster

## Cost Optimization

### Development Environment
- Use `Standard_D2s_v3` for AKS nodes
- Use `GP_Standard_D2s_v3` for PostgreSQL
- Use `Standard` Redis with capacity 1
- Set `node_group_desired_size = 1`

### Production Environment
- Use larger VM sizes (`Standard_D4s_v3+`, `GP_Standard_D4s_v3+`)
- Enable geo-redundant backup for PostgreSQL
- Use `Premium` Redis with clustering
- Scale node pools based on workload
- Enable availability zones

## Outputs

The configuration provides comprehensive outputs including:

- Resource group and VNet information
- AKS cluster endpoint and credentials
- PostgreSQL connection details
- Redis connection information
- Network security group IDs

Use `terraform output` to view all outputs or `terraform output <output_name>` for specific values.

## Authentication & Authorization

### AKS Access

The AKS cluster is configured with Azure AD integration. To grant admin access:

1. Create an Azure AD group for AKS admins
2. Get the group's object ID: `az ad group show --group <group-name> --query id -o tsv`
3. Add the object ID to `aks_admin_group_object_ids` in `terraform.tfvars`

### PostgreSQL Access

PostgreSQL is configured with password authentication. For production:

1. Consider using Azure AD authentication
2. Enable SSL enforcement
3. Configure firewall rules as needed

### Monitoring Configuration

Container Insights can be customized via variables:

- `log_analytics_sku`: SKU for Log Analytics Workspace (default: `PerGB2018`)
- `log_analytics_retention_days`: Data retention period in days (default: 30)
- `aks_msi_auth_for_monitoring_enabled`: Enable MSI authentication (default: `true`)

For production environments:
- Increase retention to 90+ days for compliance
- Consider using `Commitment` SKUs for cost optimization with predictable workloads
- Enable additional monitoring solutions as needed

## Cleanup

To destroy all resources:

```bash
terraform destroy
```

**Warning**: This will permanently delete all resources. Ensure you have backups if needed.

## Troubleshooting

### Common Issues

1. **Insufficient permissions**: Ensure your Azure account has Contributor role on the subscription
2. **Resource limits**: Check Azure service limits in your subscription
3. **AZ availability**: Some VM sizes may not be available in all availability zones

### Getting Help

- Check Terraform logs with `TF_LOG=DEBUG terraform apply`
- Review Azure Activity Log for resource creation errors
- Consult the Azure Terraform modules documentation for module-specific issues

## Networking Details

- **Public subnets**: Used for load balancers and public-facing resources
- **Private subnets**: Used for AKS nodes and application workloads
- **Database subnets**: Used for PostgreSQL and Redis (delegated subnets)
- **NAT Gateway**: Provides outbound internet access for private subnets
- **Network Security Groups**: Control traffic flow between subnets

## Monitoring & Logging

The configuration includes:

- **Log Analytics Workspace**: For AKS monitoring and logging
- **Azure Monitor**: For resource monitoring and alerting
- **PostgreSQL Logs**: Configurable logging levels
- **Redis Metrics**: Available through Azure Monitor
