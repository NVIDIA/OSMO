# Standalone Workflow and OSMOTaskGroup Phase 1 Reference

This module is intentionally isolated from the OSMO repo. It models a control-plane
Workflow API, a dispatcher, reverse-connected compute agents, and compute-cluster
`OSMOTaskGroup` controllers.

Normal user flow:

```bash
helm upgrade --install workflow-controller ./charts/workflow-controller \
  --namespace osmo-control \
  --create-namespace \
  --set image.repository=example/workflow-controller \
  --set image.tag=latest \
  --set dispatcherImage.repository=example/dispatcher \
  --set dispatcherImage.tag=latest \
  --set controller.clusterID=compute-a \
  --set controller.dispatcherURL=http://workflow-controller-dispatcher:8090

helm upgrade --install taskgroup-controller ./charts/taskgroup-controller \
  --namespace osmo-compute \
  --create-namespace \
  --set image.repository=example/taskgroup-controller \
  --set image.tag=latest \
  --set computeAgentImage.repository=example/compute-agent \
  --set computeAgentImage.tag=latest \
  --set computeAgent.clusterID=compute-a \
  --set computeAgent.dispatcherURL=http://<control-plane-dispatcher-url>:8090

kubectl --context control-plane apply -f samples/kai-smoke-workflow.yaml
kubectl --context control-plane get workflows.workflow.osmo.nvidia.com
kubectl --context control-plane describe workflow kai-smoke
```

Phase 1A compiled OSMO + Ray flow:

```bash
# Requires KAI for the resolved OSMO container-group Pod and KubeRay CRDs
# for the Ray runtime group.
kubectl --context control-plane apply -f samples/phase1a-osmo-ray-workflow.yaml
kubectl --context control-plane get workflows.workflow.osmo.nvidia.com phase1a-osmo-ray -o yaml
kubectl --context compute-a -n osmo-vpan get osmotaskgroups.workflow.osmo.nvidia.com
kubectl --context compute-a -n osmo-vpan get rayjobs.ray.io
```

Debug-only compute-cluster flow:

```bash
kubectl --context compute-a apply -f manifests/crd-osmotaskgroup.yaml
kubectl --context compute-a -n osmo-vpan apply -f samples/otg-smoke.yaml
```

Architecture boundary:

- `Workflow` exists only in the control-plane cluster.
- `OSMOTaskGroup` exists only in compute clusters.
- The workflow reconciler converts each workflow task group into an OTG command.
- The dispatcher is an HTTP command broker in the control-plane cluster.
- The compute agent runs in the compute cluster and reaches outbound to the
  dispatcher. The control plane does not need a compute-cluster kubeconfig.
- The compute OTG controller dispatches by `spec.runtimeType` through
  `RuntimeReconciler`. This phase registers `kai`, `osmo-container-group`,
  and `ray`.
- `osmo-container-group` is the Phase 1A compatibility runtime. It consumes
  submit-time resolved objects from existing OSMO pool/platform/pod-template
  policy and creates those Kubernetes objects under an `OSMOTaskGroup`.
- `ray` is the Phase 1A Ray runtime shape. It renders KubeRay `RayCluster` or
  `RayJob` objects from `runtimeConfig.ray`, while workflow DAG, dispatch,
  status rollup, and cleanup remain owned by the OSMO workflow controllers.
- `cmd/workflow-controller` runs in the control-plane cluster and writes OTG
  commands to the dispatcher.
- `cmd/taskgroup-controller` runs in a compute cluster and renders runtime
  resources for OTGs in that cluster.
- `cmd/compute-agent` runs in a compute cluster, polls dispatcher commands,
  creates/updates/deletes OTGs locally, and reports OTG status back.
- `charts/workflow-controller` installs the control-plane `Workflow` CRD,
  dispatcher, controller deployment, service account, RBAC, and metrics service.
- `charts/taskgroup-controller` installs the compute-cluster `OSMOTaskGroup`
  CRD, taskgroup controller, compute agent, service account, RBAC, and metrics
  service.

For separate clusters, expose the dispatcher through the network path your
compute cluster can reach, for example by setting
`dispatcher.service.type=LoadBalancer` in the control-plane chart and passing the
resulting URL to `computeAgent.dispatcherURL` in the compute chart.

Verify locally:

```bash
GOCACHE=/private/tmp/taskgroup-phase1-go-cache go test ./...
helm template workflow-controller ./charts/workflow-controller
helm template taskgroup-controller ./charts/taskgroup-controller
```
