// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package ray

import (
	"context"
	"encoding/json"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/builder"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	"github.com/nvidia/osmo/taskgroup/controller/runtimes"
)

// RayJobGVK identifies KubeRay's RayJob CR.
var RayJobGVK = schema.GroupVersionKind{
	Group:   "ray.io",
	Version: "v1",
	Kind:    "RayJob",
}

// defaultRayVersion is used when the OTG config doesn't pin one.
const defaultRayVersion = "2.9.0"

// New constructs a Ray runtime. Conforms to runtimes.Factory.
func New(deps runtimes.Dependencies) (runtimes.Runtime, error) {
	r := &Reconciler{client: deps.Client}
	return runtimes.Runtime{
		Reconciler:   r,
		StatusMapper: &StatusMapper{client: deps.Client},
		Watches:      installWatches,
	}, nil
}

// installWatches attaches the RayJob watch to the OTG controller builder so
// status changes on the RayJob re-enqueue the parent OTG.
func installWatches(b *builder.Builder) *builder.Builder {
	rj := &unstructured.Unstructured{}
	rj.SetGroupVersionKind(RayJobGVK)
	return b.Watches(
		rj,
		handler.EnqueueRequestsFromMapFunc(rayJobToOSMOTaskGroup),
	)
}

func rayJobToOSMOTaskGroup(_ context.Context, obj client.Object) []reconcile.Request {
	name := obj.GetName()
	if name == "" {
		return nil
	}
	return []reconcile.Request{{
		NamespacedName: types.NamespacedName{Name: name, Namespace: obj.GetNamespace()},
	}}
}

// Reconciler implements runtimes.Reconciler for the Ray runtime.
type Reconciler struct {
	client client.Client
}

// Reconcile renders a RayJob CR owned by the OSMOTaskGroup. KubeRay on this
// cluster then materializes it into a RayCluster + submitter Pod and runs the
// entrypoint. Re-renders are idempotent: if the RayJob already exists we leave
// it alone (RayJob is treated as immutable for v1; spec updates require a
// delete+recreate).
func (r *Reconciler) Reconcile(ctx context.Context, otg *v1alpha1.OSMOTaskGroup) (reconcile.Result, error) {
	logger := log.FromContext(ctx)

	cfg, err := unmarshalConfig(otg)
	if err != nil {
		return reconcile.Result{}, fmt.Errorf("invalid ray runtimeConfig: %w", err)
	}
	if cfg.Entrypoint == "" {
		return reconcile.Result{}, fmt.Errorf("ray runtimeConfig.entrypoint is required")
	}
	if cfg.HeadGroup.Image == "" {
		return reconcile.Result{}, fmt.Errorf("ray runtimeConfig.headGroup.image is required")
	}

	rj := renderRayJob(otg, cfg)
	if err := controllerutil.SetControllerReference(otg, rj, r.client.Scheme()); err != nil {
		return reconcile.Result{}, fmt.Errorf("setting RayJob owner: %w", err)
	}
	if err := r.client.Create(ctx, rj); err != nil {
		if !apierrors.IsAlreadyExists(err) {
			return reconcile.Result{}, fmt.Errorf("creating RayJob %s: %w", rj.GetName(), err)
		}
	} else {
		logger.Info("created RayJob", "name", rj.GetName())
	}
	return reconcile.Result{}, nil
}

// Finalize is a no-op for Ray today. RayJob + embedded RayCluster cleanup is
// handled by K8s cascade delete via the owner reference set in Reconcile.
func (r *Reconciler) Finalize(_ context.Context, _ *v1alpha1.OSMOTaskGroup) error {
	return nil
}

// renderRayJob translates the OSMO config into a RayJob manifest.
func renderRayJob(otg *v1alpha1.OSMOTaskGroup, cfg *v1alpha1.RayRuntimeConfig) *unstructured.Unstructured {
	rj := &unstructured.Unstructured{}
	rj.SetGroupVersionKind(RayJobGVK)
	rj.SetName(otg.Name)
	rj.SetNamespace(otg.Namespace)
	rj.SetLabels(map[string]string{
		v1alpha1.LabelWorkflowID:  otg.Spec.WorkflowID,
		v1alpha1.LabelGroupName:   otg.Spec.GroupName,
		v1alpha1.LabelRuntimeType: string(v1alpha1.RuntimeRay),
	})

	rayVersion := cfg.RayVersion
	if rayVersion == "" {
		rayVersion = defaultRayVersion
	}

	shutdownAfter := true
	if cfg.ShutdownAfterJobFinishes != nil {
		shutdownAfter = *cfg.ShutdownAfterJobFinishes
	}

	spec := map[string]interface{}{
		"entrypoint":               cfg.Entrypoint,
		"shutdownAfterJobFinishes": shutdownAfter,
		"rayClusterSpec": map[string]interface{}{
			"rayVersion":      rayVersion,
			"headGroupSpec":   renderHeadGroup(cfg.HeadGroup),
			"workerGroupSpecs": renderWorkerGroups(cfg.WorkerGroups),
		},
	}
	if cfg.RuntimeEnv != "" {
		spec["runtimeEnvYAML"] = cfg.RuntimeEnv
	}
	if cfg.SubmitterPodTemplate != nil {
		raw, _ := json.Marshal(cfg.SubmitterPodTemplate)
		var tmpl map[string]interface{}
		_ = json.Unmarshal(raw, &tmpl)
		spec["submitterPodTemplate"] = tmpl
	}

	rj.Object["spec"] = spec
	return rj
}

func renderHeadGroup(g v1alpha1.RayGroupSpec) map[string]interface{} {
	startParams := mergeStartParams(g.RayStartParams, map[string]string{
		"dashboard-host": "0.0.0.0",
	})
	return map[string]interface{}{
		"rayStartParams": startParams,
		"template":       renderPodTemplate(g, "ray-head"),
	}
}

func renderWorkerGroups(groups []v1alpha1.RayGroupSpec) []interface{} {
	out := make([]interface{}, 0, len(groups))
	for _, g := range groups {
		entry := map[string]interface{}{
			"groupName":      g.GroupName,
			"replicas":       g.Replicas,
			"rayStartParams": mergeStartParams(g.RayStartParams, nil),
			"template":       renderPodTemplate(g, "ray-worker"),
		}
		if g.MinReplicas != nil {
			entry["minReplicas"] = *g.MinReplicas
		}
		if g.MaxReplicas != nil {
			entry["maxReplicas"] = *g.MaxReplicas
		}
		out = append(out, entry)
	}
	return out
}

// renderPodTemplate produces the embedded PodTemplateSpec map for a Ray group.
// The container name "ray-head" / "ray-worker" matches KubeRay's expected name.
func renderPodTemplate(g v1alpha1.RayGroupSpec, containerName string) map[string]interface{} {
	container := map[string]interface{}{
		"name":  containerName,
		"image": g.Image,
	}
	if g.ImagePullPolicy != "" {
		container["imagePullPolicy"] = string(g.ImagePullPolicy)
	}
	if resMap := buildResourceMap(g.Resources); len(resMap) > 0 {
		container["resources"] = resMap
	}
	if envEntries := buildEnvEntries(g.Env, g.Credentials); len(envEntries) > 0 {
		container["env"] = envEntries
	}

	podSpec := map[string]interface{}{
		"containers": []interface{}{container},
	}
	if len(g.NodeSelector) > 0 {
		podSpec["nodeSelector"] = stringMapToInterface(g.NodeSelector)
	}
	if len(g.Tolerations) > 0 {
		podSpec["tolerations"] = tolerationsToInterface(g.Tolerations)
	}

	return map[string]interface{}{
		"spec": podSpec,
	}
}

// mergeStartParams overlays user-supplied params on top of KubeRay-defaults.
// User wins on key collisions.
func mergeStartParams(user, defaults map[string]string) map[string]interface{} {
	out := make(map[string]interface{}, len(user)+len(defaults))
	for k, v := range defaults {
		out[k] = v
	}
	for k, v := range user {
		out[k] = v
	}
	return out
}

func buildResourceMap(r v1alpha1.TaskResources) map[string]interface{} {
	requests := map[string]interface{}{}
	limits := map[string]interface{}{}
	if !r.CPU.IsZero() {
		requests["cpu"] = r.CPU.String()
		limits["cpu"] = r.CPU.String()
	}
	if !r.Memory.IsZero() {
		requests["memory"] = r.Memory.String()
		limits["memory"] = r.Memory.String()
	}
	if !r.GPU.IsZero() {
		limits["nvidia.com/gpu"] = r.GPU.String()
	}
	for name, qty := range r.Custom {
		limits[string(name)] = qty.String()
	}
	out := map[string]interface{}{}
	if len(requests) > 0 {
		out["requests"] = requests
	}
	if len(limits) > 0 {
		out["limits"] = limits
	}
	return out
}

func buildEnvEntries(env []corev1.EnvVar, creds []v1alpha1.CredentialRef) []interface{} {
	out := make([]interface{}, 0, len(env)+len(creds))
	for _, e := range env {
		out = append(out, map[string]interface{}{
			"name":  e.Name,
			"value": e.Value,
		})
	}
	for _, c := range creds {
		for envName, secretKey := range c.KeyMap {
			out = append(out, map[string]interface{}{
				"name": envName,
				"valueFrom": map[string]interface{}{
					"secretKeyRef": map[string]interface{}{
						"name": c.SecretName,
						"key":  secretKey,
					},
				},
			})
		}
	}
	return out
}

func stringMapToInterface(m map[string]string) map[string]interface{} {
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func tolerationsToInterface(ts []corev1.Toleration) []interface{} {
	raw, _ := json.Marshal(ts)
	var out []interface{}
	_ = json.Unmarshal(raw, &out)
	return out
}

func unmarshalConfig(otg *v1alpha1.OSMOTaskGroup) (*v1alpha1.RayRuntimeConfig, error) {
	raw := otg.Spec.RuntimeConfig.Raw
	if len(raw) == 0 {
		return nil, fmt.Errorf("runtimeConfig is empty")
	}
	var cfg v1alpha1.RayRuntimeConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("decoding ray runtimeConfig: %w", err)
	}
	return &cfg, nil
}
