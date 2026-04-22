# OSMO Deployment Guide — URL Index

**Base URL:** `https://nvidia.github.io/OSMO/main/deployment_guide/`

**URL rule:** any `.html` page URL → replace with `.md` to get fetchable Markdown.

**Usage:** Read this file to find the exact fetch URL before calling WebFetch on any deployment guide page. Append the path below to the base URL.

---

## Introduction

| Topic | Path |
|-------|------|
| Guide overview | `index.md` |
| Architecture (control/compute planes, component roles) | `introduction/architecture.md` |

## Requirements

| Topic | Path |
|-------|------|
| Cloud prerequisites (K8s, PostgreSQL, Redis, VPC) | `requirements/prereqs.md` |
| Required tools (Helm, kubectl, psql, OSMO CLI) | `requirements/tools.md` |
| Networking (FQDN, SSL/TLS, DNS, load balancer) | `requirements/networking.md` |
| Instance sizing (CPU, RAM, storage) | `requirements/system_reqs.md` |

## Getting Started

| Topic | Path |
|-------|------|
| Infrastructure setup (Terraform / manual cloud setup) | `getting_started/infrastructure_setup.md` |
| Deploy service — full guide with complete Helm values | `getting_started/deploy_service.md` |
| Configure data storage (workflow logs, datasets) | `getting_started/configure_data.md` |
| Storage: AWS S3 | `getting_started/create_storage/s3/index.md` |
| Storage: Azure Blob | `getting_started/create_storage/azure/index.md` |
| Storage: GCP Cloud Storage | `getting_started/create_storage/gcp/index.md` |
| Storage: TOS (Torch Object Storage) | `getting_started/create_storage/tos/index.md` |

## Install Backend

| Topic | Path |
|-------|------|
| Backend overview (cloud vs. on-prem) | `install_backend/create_backend/index.md` |
| Cloud cluster setup (EKS, AKS, GKE) | `install_backend/create_backend/cloud_setup.md` |
| On-prem cluster setup (kubeadm) | `install_backend/create_backend/onprem_setup.md` |
| Dependencies (KAI scheduler, GPU Operator) | `install_backend/dependencies/dependencies.md` |
| Deploy backend operator | `install_backend/deploy_backend.md` |
| Configure resource pool | `install_backend/configure_pool.md` |
| Validate (run sample workflows) | `install_backend/validate_osmo.md` |
| Observability (Grafana dashboards, alerts) | `install_backend/observability.md` |

## Advanced Configuration

| Topic | Path |
|-------|------|
| Resource pools (multi-pool, platforms, topology) | `advanced_config/pool.md` |
| Pod templates | `advanced_config/pod_template.md` |
| Group templates (CRDs alongside pods) | `advanced_config/group_template.md` |
| Resource validation rules | `advanced_config/resource_validation.md` |
| KAI scheduler (preemption, fair sharing, GPU allocation) | `advanced_config/scheduler.md` |
| Rsync (live file sync during workflows) | `advanced_config/rsync.md` |
| Dataset buckets (external cloud storage registration) | `advanced_config/dataset_buckets.md` |

## Appendix

| Topic | Path |
|-------|------|
| Local deployment (KIND / nvkind) | `appendix/deploy_local.md` |
| Minimal deployment (single cluster) | `appendix/deploy_minimal.md` |
| Workflow execution (3-container pod architecture) | `appendix/workflow_execution.md` |
| Authentication overview | `appendix/authentication/index.md` |
| Authentication flow (with / without IdP) | `appendix/authentication/authentication_flow.md` |
| Roles and policies (full reference) | `appendix/authentication/roles_policies.md` |
| Managing users | `appendix/authentication/managing_users.md` |
| IdP setup (Microsoft Entra ID, Google, AWS) | `appendix/authentication/identity_provider_setup.md` |
| IdP role mapping | `appendix/authentication/idp_role_mapping.md` |
| Service accounts (access tokens, backend operators) | `appendix/authentication/service_accounts.md` |
| Keycloak setup (self-hosted IdP broker) | `appendix/keycloak_setup.md` |

## Config Schema Reference

| Topic | Path |
|-------|------|
| Backend config schema | `references/configs_definitions/backend.md` |
| Pool config schema | `references/configs_definitions/pool.md` |
| Pod template schema | `references/configs_definitions/pod_template.md` |
| Group template schema | `references/configs_definitions/group_template.md` |
| Resource validation schema | `references/configs_definitions/resource_validation.md` |
| Workflow config schema | `references/configs_definitions/workflow.md` |
| Dataset config schema | `references/configs_definitions/dataset.md` |
| Roles config schema | `references/configs_definitions/roles.md` |
| Service config schema | `references/configs_definitions/service.md` |

## Config CLI Reference

| Command | Path |
|---------|------|
| `osmo config show` | `references/config_cli/config_show.md` |
| `osmo config list` | `references/config_cli/config_list.md` |
| `osmo config update` | `references/config_cli/config_update.md` |
| `osmo config get` | `references/config_cli/config_get.md` |
| `osmo config set` | `references/config_cli/config_set.md` |
| `osmo config delete` | `references/config_cli/config_delete.md` |
| `osmo config diff` | `references/config_cli/config_diff.md` |
| `osmo config history` | `references/config_cli/config_history.md` |
| `osmo config tag` | `references/config_cli/config_tag.md` |
| `osmo config rollback` | `references/config_cli/config_rollback.md` |

## User CLI Reference

| Command | Path |
|---------|------|
| `osmo user create` | `references/user_cli/user_create.md` |
| `osmo user list` | `references/user_cli/user_list.md` |
| `osmo user get` | `references/user_cli/user_get.md` |
| `osmo user update` | `references/user_cli/user_update.md` |
| `osmo user delete` | `references/user_cli/user_delete.md` |
| `osmo token set` | `references/user_cli/token_set.md` |
| `osmo token list` | `references/user_cli/token_list.md` |
| `osmo token delete` | `references/user_cli/token_delete.md` |
| `osmo token roles` | `references/user_cli/token_roles.md` |
