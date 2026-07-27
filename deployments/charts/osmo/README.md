# OSMO Kubernetes-native installer

This umbrella chart is the supported entry point for installing OSMO into any
conformant Kubernetes cluster. It composes the control-plane `service` chart and
the compute-plane `backend-operator` chart without provisioning cloud
infrastructure or requiring a Terraform provider.

## Quick start

Build local dependencies once when working from a source checkout:

```bash
helm dependency build --skip-refresh deployments/charts/osmo
```

Render and inspect the single-node profile without contacting a cluster:

```bash
helm template osmo deployments/charts/osmo \
  --namespace osmo-system \
  --values deployments/charts/osmo/profiles/single-node.yaml
```

Install the packaged chart or source checkout:

```bash
helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo-system \
  --create-namespace \
  --values deployments/charts/osmo/profiles/single-node.yaml \
  --wait
```

Run the retained post-install checks at any time:

```bash
helm test osmo --namespace osmo-system --logs
```

The single-node profile is for development and evaluation. It generates and
retains credentials in Kubernetes Secrets. Production installations should
start from `profiles/minimal.yaml` or the split-plane profiles and use existing
Secrets or External Secrets backed by NVault.

## Deployment profiles

| Profile | Control plane | Compute plane | Secret mode | Intended use |
| --- | --- | --- | --- | --- |
| `single-node.yaml` | Local | Local | Generated | Laptop, MicroK8s, and evaluation |
| `minimal.yaml` | Local | Local | Existing Secret | Small production-shaped cluster |
| `split-control.yaml` | Local | Remote | External Secrets | Hub/control cluster |
| `split-compute.yaml` | Remote | Local | External Secrets | Worker/compute cluster |

The split files are installed as independent releases in their respective
clusters. The compute profile's `computePlane.global.serviceUrl` must point at
the control-plane gateway, and both planes must resolve the same backend token
from NVault.

## Secret contract

OSMO consumes ordinary Kubernetes Secrets. The chart does not know which cloud
or external provider stores the source material.

The default `osmo-control-secrets` contract is:

| Key | Consumer |
| --- | --- |
| `db-password` | PostgreSQL and OSMO services |
| `redis-password` | Redis and OSMO services |
| `backend-token` | API bootstrap reconciler and backend operator |
| `mek.yaml` | OSMO Master Encryption Key |

In `external-secrets` mode the chart renders `external-secrets.io/v1`
`ExternalSecret` resources. Configure
`secretManagement.externalSecrets.secretStoreRef` to reference the
NVault-backed `SecretStore` or `ClusterSecretStore` installed by the platform
team. The chart intentionally does not create the store or embed provider
credentials.

## Verification

Pre-install and pre-upgrade hooks check:

- Kubernetes API access and read permissions;
- a usable StorageClass when in-cluster PostgreSQL is enabled;
- KAI CRDs when the optional KAI scheduler is selected;
- the External Secrets CRD when that mode is selected; and
- required existing Secrets.

Post-install, post-upgrade, and `helm test` checks wait for External Secrets and
the selected OSMO control/compute deployments to become ready, request the API
version through the gateway, verify that workflow runtime callbacks have a
valid service URL, and wait for the compute backend heartbeat to report online.
The backend check exchanges the configured backend token for a short-lived JWT
without logging either credential. The checks use a read-only temporary
ClusterRole during preflight and a release-owned read-only ClusterRole for
postflight and `helm test`; neither check modifies cluster resources. Successful
postflight Pods are retained until the next hook run so `helm test --logs` can
return their output, and the release-owned test RBAC is removed by
`helm uninstall`.

## Scheduler portability

The default backend scheduler is `kubernetes`, which emits only core Pod
resources and lets the cluster's default scheduler place them. Set both:

```yaml
controlPlane:
  services:
    configs:
      backends:
        default:
          scheduler_settings:
            scheduler_type: kai
            scheduler_name: kai-scheduler

computePlane:
  global:
    scheduler:
      type: kai
      name: kai-scheduler
```

to retain KAI gang scheduling, priority, and topology behavior. The chart only
renders KAI RBAC and PriorityClasses in that mode.

## Scope boundary

The chart owns OSMO resources inside Kubernetes. It does not create Kubernetes
clusters, VPCs, managed databases, object stores, DNS zones, or cloud IAM
principals. Those are optional external dependencies connected through values,
Kubernetes ServiceAccounts, and Secret references.
