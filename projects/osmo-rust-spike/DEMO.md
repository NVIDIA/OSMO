# OSMO Rust Spike Demo

This demo shows the validated Phase 1A Rust spike path. It is meant for a design/demo review, not as a replacement for the E2E script.

The demo proves:

- existing OSMO YAML can submit through the API
- existing templated OSMO YAML with top-level `default-values` can submit through the API
- native `OSMOWorkflow` CRDs reconcile through the control/backend path
- RayJob runtime works through the `rayJob` runtime type
- cleanup/finalizers remove control desired state, backend mirrors, and runtime objects
- pool placement resolves through `OSMOPool -> OSMOCluster`

## Environment

Use the staging and backend contexts:

```bash
export KUBECONFIG="$HOME/.kube/clusters/aws-prod:$HOME/.kube/clusters/aws-stg:$HOME/.kube/clusters/isaac:$HOME/.kube/clusters/h100-test:$HOME/.kube/clusters/groot-02"
export CONTROL_CONTEXT=osmo-stg
export BACKEND_CONTEXT=osmo-backend
export CONTROL_NAMESPACE=osmo-exp
export BACKEND_NAMESPACE=osmo-phase1a
```

Validated image:

```text
nvcr.io/nvstaging/osmo/osmo-rust-spike:phase1-hardened-20260624-0105
```

## One Command Validation

Run the full validated path:

```bash
cd projects/osmo-rust-spike
./deploy/e2e-validate.sh
```

Expected final line:

```text
OSMO Rust spike E2E validation passed
```

The script deploys CRDs/controllers, submits workflows, waits for runtime success, deletes workflows, and verifies cleanup. The port-forward cleanup message at the end is expected because the script terminates its background port-forward.

## Demo Flow

### 1. Show CRDs and Pool Mapping

```bash
kubectl --context "$CONTROL_CONTEXT" -n "$CONTROL_NAMESPACE" get osmoclusters,osmopools
```

Expected relationship:

```text
OSMOPool/default
  -> spec.clusterRef
  -> OSMOCluster/<clusterRef>.spec.clusterID=osmo-backend
  -> spec.namespace=osmo-phase1a
```

The native workflow demo verifies this by checking the desired `OSMOTaskGroup` fields:

```bash
kubectl --context "$CONTROL_CONTEXT" -n "$CONTROL_NAMESPACE" get osmotaskgroups \
  -l 'spike.osmo.nvidia.com/workflow=osmo-rust-spike-e2e,spike.osmo.nvidia.com/role=desired' \
  -o jsonpath='{.items[0].spec.clusterID}{" "}{.items[0].spec.targetNamespace}{" "}{.items[0].spec.poolRef}{"\n"}'
```

Expected values while the workflow is running:

```text
osmo-backend osmo-phase1a default
```

### 2. Native OSMOWorkflow CRD

The native CRD sample is:

```bash
cat deploy/sample-workflow.yaml
```

Submit it:

```bash
kubectl --context "$CONTROL_CONTEXT" -n "$CONTROL_NAMESPACE" apply -f deploy/sample-workflow.yaml
```

Show workflow status:

```bash
kubectl --context "$CONTROL_CONTEXT" -n "$CONTROL_NAMESPACE" get osmoworkflow osmo-rust-spike-e2e \
  -o jsonpath='{.status.phase}{" "}{.status.message}{"\n"}'
```

Show backend runtime object:

```bash
kubectl --context "$BACKEND_CONTEXT" -n "$BACKEND_NAMESPACE" get configmap osmo-rust-spike-e2e-hello \
  -o jsonpath='{.data.status}{"\n"}'
```

Expected runtime value:

```text
rendered-object-applied
```

### 3. Existing OSMO YAML Through API

The existing workflow is:

```bash
cat ../../cookbook/tutorials/hello_world.yaml
```

The E2E submits it through:

```text
POST /api/pool/default/workflow
```

Expected control object:

```bash
kubectl --context "$CONTROL_CONTEXT" -n "$CONTROL_NAMESPACE" get osmoworkflow hello-osmo
```

Expected backend runtime:

```bash
kubectl --context "$BACKEND_CONTEXT" -n "$BACKEND_NAMESPACE" get job hello-osmo-hello
```

The workflow should reach `Succeeded`, and the Job should report one successful completion.

### 4. Existing Templated OSMO YAML With Top-Level Default Values

The existing templated workflow is:

```bash
cat ../../cookbook/tutorials/template_hello_world.yaml
```

The E2E submits it through the API with:

```text
set_variables=["workflow_name=hello-osmo-template"]
```

Expected objects:

```bash
kubectl --context "$CONTROL_CONTEXT" -n "$CONTROL_NAMESPACE" get osmoworkflow hello-osmo-template
kubectl --context "$BACKEND_CONTEXT" -n "$BACKEND_NAMESPACE" get job hello-osmo-template-hello
```

This proves top-level `default-values` and Jinja rendering work for the supported Phase 1A YAML subset.

### 5. RayJob Runtime

The RayJob sample is:

```bash
cat deploy/sample-ray-workflow.yaml
```

Submit it:

```bash
kubectl --context "$CONTROL_CONTEXT" -n "$CONTROL_NAMESPACE" apply -f deploy/sample-ray-workflow.yaml
```

Show workflow and RayJob status:

```bash
kubectl --context "$CONTROL_CONTEXT" -n "$CONTROL_NAMESPACE" get osmoworkflow osmo-rust-spike-ray-e2e \
  -o jsonpath='{.status.phase}{"\n"}'

kubectl --context "$BACKEND_CONTEXT" -n "$BACKEND_NAMESPACE" get rayjob osmo-rust-spike-ray-hello \
  -o jsonpath='{.status.jobStatus}{"\n"}'
```

Expected RayJob status:

```text
SUCCEEDED
```

### 6. Cleanup and Finalizers

Delete a workflow:

```bash
kubectl --context "$CONTROL_CONTEXT" -n "$CONTROL_NAMESPACE" delete osmoworkflow osmo-rust-spike-ray-e2e
```

Then verify all layers are gone:

```bash
kubectl --context "$CONTROL_CONTEXT" -n "$CONTROL_NAMESPACE" get osmoworkflows,osmotaskgroups \
  -o name | rg 'osmo-rust-spike-ray-e2e|osmo-rust-spike-ray-hello'

kubectl --context "$BACKEND_CONTEXT" -n "$BACKEND_NAMESPACE" get osmotaskgroups,rayjobs.ray.io \
  -o name | rg 'osmo-rust-spike-ray-e2e|osmo-rust-spike-ray-hello'
```

Expected result: no matches.

That proves the control finalizer waited for backend cleanup ack before the workflow disappeared.

## Cleanup Check

After the E2E run, no demo workflow resources should remain:

```bash
kubectl --context "$CONTROL_CONTEXT" -n "$CONTROL_NAMESPACE" get osmoworkflows,osmotaskgroups \
  -o name | rg 'osmo-rust-spike|hello-osmo|osmo-jinja'

kubectl --context "$BACKEND_CONTEXT" -n "$BACKEND_NAMESPACE" get osmotaskgroups,configmaps,jobs,rayjobs.ray.io \
  -o name | rg 'osmo-rust-spike|hello-osmo|osmo-jinja'
```

Expected result: no matches.

## What This Demo Does Not Claim

This demo does not claim full OSMO 7.0 parity. The unsupported areas remain:

- datasets, inputs, and outputs
- credentials and ExternalSecrets integration
- full pod template behavior
- full existing pool execution behavior
- Kueue/KAI scheduling
- NIM Service runtime
- multi-cluster scheduling
- PostgreSQL history projection
- UI
