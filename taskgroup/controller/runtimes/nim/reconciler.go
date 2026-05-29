// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package nim

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

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

// NIMServiceGVK identifies NVIDIA NIM Operator's NIMService CR.
// The upstream group/version pair has been stable since the operator's v1alpha1
// release; updates would only land in this constant.
var NIMServiceGVK = schema.GroupVersionKind{
	Group:   "apps.nvidia.com",
	Version: "v1alpha1",
	Kind:    "NIMService",
}

// defaultPort is the standard NIM gRPC/HTTP serving port when the user doesn't override.
const defaultPort = int32(8000)

// New constructs a NIM runtime. Conforms to runtimes.Factory.
func New(deps runtimes.Dependencies) (runtimes.Runtime, error) {
	r := &Reconciler{client: deps.Client}
	return runtimes.Runtime{
		Reconciler:   r,
		StatusMapper: &StatusMapper{client: deps.Client},
		Watches:      installWatches,
	}, nil
}

// installWatches attaches the NIMService watch to the OTG controller builder so
// status changes on the NIMService re-enqueue the parent OTG.
func installWatches(b *builder.Builder) *builder.Builder {
	nimSvc := &unstructured.Unstructured{}
	nimSvc.SetGroupVersionKind(NIMServiceGVK)
	return b.Watches(
		nimSvc,
		handler.EnqueueRequestsFromMapFunc(nimServiceToOSMOTaskGroup),
	)
}

// nimServiceToOSMOTaskGroup maps a NIMService event back to its owning OSMOTaskGroup
// via the identity-name convention (NIMService.Name == OSMOTaskGroup.Name).
func nimServiceToOSMOTaskGroup(_ context.Context, obj client.Object) []reconcile.Request {
	name := obj.GetName()
	if name == "" {
		return nil
	}
	return []reconcile.Request{{
		NamespacedName: types.NamespacedName{Name: name, Namespace: obj.GetNamespace()},
	}}
}

// Reconciler implements runtimes.Reconciler for the NIM runtime.
type Reconciler struct {
	client client.Client
}

// Reconcile renders a NIMService CR owned by the OSMOTaskGroup. The NIM Operator
// on this cluster then materializes it into a Deployment + Service. Re-renders are
// idempotent: if the NIMService already exists we leave it alone (NIMService is
// treated as immutable for v1; field updates require a delete+recreate).
func (r *Reconciler) Reconcile(ctx context.Context, otg *v1alpha1.OSMOTaskGroup) (reconcile.Result, error) {
	logger := log.FromContext(ctx)

	cfg, err := unmarshalConfig(otg)
	if err != nil {
		return reconcile.Result{}, fmt.Errorf("invalid nim runtimeConfig: %w", err)
	}
	if cfg.Image == "" {
		return reconcile.Result{}, fmt.Errorf("nim runtimeConfig.image is required")
	}
	if cfg.AuthSecret == "" {
		return reconcile.Result{}, fmt.Errorf("nim runtimeConfig.authSecret is required (Secret holding nvcr.io pull creds + NGC API key)")
	}

	svc := renderNIMService(otg, cfg)
	if err := controllerutil.SetControllerReference(otg, svc, r.client.Scheme()); err != nil {
		return reconcile.Result{}, fmt.Errorf("setting NIMService owner: %w", err)
	}
	if err := r.client.Create(ctx, svc); err != nil {
		if !apierrors.IsAlreadyExists(err) {
			return reconcile.Result{}, fmt.Errorf("creating NIMService %s: %w", svc.GetName(), err)
		}
	} else {
		logger.Info("created NIMService", "name", svc.GetName())
	}
	return reconcile.Result{}, nil
}

// Finalize is a no-op for NIM today. NIMService cleanup is handled by K8s cascade
// delete via the owner reference set in Reconcile.
func (r *Reconciler) Finalize(_ context.Context, _ *v1alpha1.OSMOTaskGroup) error {
	return nil
}

// renderNIMService translates the OSMO config into a NIMService manifest. Encoded
// as Unstructured because we don't import NIM Operator's Go types (keeps the OSMO
// build decoupled from NIM Operator versions).
func renderNIMService(otg *v1alpha1.OSMOTaskGroup, cfg *v1alpha1.NIMRuntimeConfig) *unstructured.Unstructured {
	svc := &unstructured.Unstructured{}
	svc.SetGroupVersionKind(NIMServiceGVK)
	svc.SetName(otg.Name)
	svc.SetNamespace(otg.Namespace)
	svc.SetLabels(map[string]string{
		v1alpha1.LabelWorkflowID:  otg.Spec.WorkflowID,
		v1alpha1.LabelGroupName:   otg.Spec.GroupName,
		v1alpha1.LabelRuntimeType: string(v1alpha1.RuntimeNIM),
	})

	repo, tag := splitImageTag(cfg.Image)
	image := map[string]interface{}{
		"repository": repo,
		"tag":        tag,
	}
	if cfg.ImagePullPolicy != "" {
		image["pullPolicy"] = string(cfg.ImagePullPolicy)
	}
	// NIMService accepts an array of imagePullSecrets under spec.image; the
	// same Secret name is also used for authSecret (model artifact pulls
	// from NGC).
	image["pullSecrets"] = []interface{}{cfg.AuthSecret}

	spec := map[string]interface{}{
		"image":      image,
		"authSecret": cfg.AuthSecret,
	}
	if cfg.Replicas != nil {
		spec["replicas"] = *cfg.Replicas
	} else {
		spec["replicas"] = int32(1)
	}

	if resMap := buildResourceMap(cfg.Resources); len(resMap) > 0 {
		spec["resources"] = resMap
	}

	// NIMService requires exactly one of nimCache / pvc / emptyDir / hostPath
	// under spec.storage. We pick:
	//   - PVC if the user gave a storageClass (durable model cache);
	//   - emptyDir otherwise (ephemeral — model re-downloads each restart;
	//     fine for smoke tests and short-lived inference jobs).
	storageSize := "20Gi"
	if cfg.StorageSize != nil {
		storageSize = cfg.StorageSize.String()
	}
	if cfg.StorageClass != "" {
		spec["storage"] = map[string]interface{}{
			"pvc": map[string]interface{}{
				"create":       true,
				"storageClass": cfg.StorageClass,
				"size":         storageSize,
			},
		}
	} else {
		spec["storage"] = map[string]interface{}{
			"emptyDir": map[string]interface{}{
				"sizeLimit": storageSize,
			},
		}
	}

	if envEntries := buildEnvEntries(cfg.Env, cfg.Credentials); len(envEntries) > 0 {
		spec["env"] = envEntries
	}

	if len(cfg.NodeSelector) > 0 {
		spec["nodeSelector"] = stringMapToInterface(cfg.NodeSelector)
	}
	if len(cfg.Tolerations) > 0 {
		spec["tolerations"] = tolerationsToInterface(cfg.Tolerations)
	}

	port := defaultPort
	if cfg.ExposedPort != nil {
		port = *cfg.ExposedPort
	}
	spec["expose"] = map[string]interface{}{
		"service": map[string]interface{}{
			"type": "ClusterIP",
			"port": port,
		},
	}

	svc.Object["spec"] = spec
	return svc
}

// buildResourceMap renders a corev1.ResourceRequirements-shaped map from
// TaskResources. The NIM Operator expects requests + limits with NVIDIA GPU
// resource names.
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

// buildEnvEntries flattens user-supplied env vars + credential-derived env vars
// into one list. Credentials are rendered as valueFrom.secretKeyRef references.
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
	// Round-trip through JSON to preserve the canonical Toleration shape.
	raw, _ := json.Marshal(ts)
	var out []interface{}
	_ = json.Unmarshal(raw, &out)
	return out
}

// splitImageTag splits "registry/repo:tag" into ("registry/repo", "tag"). If the
// image has no tag, returns the whole string as repo + "latest" as tag (NIMService
// requires a tag value).
func splitImageTag(image string) (string, string) {
	// Find the LAST colon — registry hosts may contain colons for ports
	// (e.g. nvcr.io:443/nim/...). Tags can't contain colons.
	idx := strings.LastIndex(image, ":")
	if idx <= 0 {
		return image, "latest"
	}
	// Ensure we're not splitting on a port colon (e.g. "nvcr.io:443/foo"
	// has no tag). If there's a "/" after the colon, the colon was a port.
	if strings.Contains(image[idx:], "/") {
		return image, "latest"
	}
	return image[:idx], image[idx+1:]
}

func unmarshalConfig(otg *v1alpha1.OSMOTaskGroup) (*v1alpha1.NIMRuntimeConfig, error) {
	raw := otg.Spec.RuntimeConfig.Raw
	if len(raw) == 0 {
		return nil, fmt.Errorf("runtimeConfig is empty")
	}
	var cfg v1alpha1.NIMRuntimeConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("decoding nim runtimeConfig: %w", err)
	}
	return &cfg, nil
}
