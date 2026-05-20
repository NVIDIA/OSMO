// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package kai

import (
	"context"
	"encoding/json"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
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

// New constructs a KAI runtime. Conforms to runtimes.Factory.
func New(deps runtimes.Dependencies) (runtimes.Runtime, error) {
	r := &Reconciler{client: deps.Client}
	return runtimes.Runtime{
		Reconciler:   r,
		StatusMapper: &StatusMapper{client: deps.Client},
		Watches:      installWatches,
	}, nil
}

// installWatches adds the KAI-specific watches to the controller builder. The OSMOTaskGroup
// owns its Pods directly (cascade delete on Pod), and we also watch KAI PodGroup objects
// via unstructured because their status changes drive OTG phase transitions.
func installWatches(b *builder.Builder) *builder.Builder {
	podGroup := &unstructured.Unstructured{}
	podGroup.SetGroupVersionKind(PodGroupGVK)
	return b.
		Owns(&corev1.Pod{}).
		Watches(
			podGroup,
			handler.EnqueueRequestsFromMapFunc(podGroupToOSMOTaskGroup),
		)
}

// podGroupToOSMOTaskGroup maps a PodGroup back to its owning OSMOTaskGroup via the
// identity-name convention (PodGroup.Name == OSMOTaskGroup.Name).
func podGroupToOSMOTaskGroup(_ context.Context, obj client.Object) []reconcile.Request {
	name := obj.GetName()
	if name == "" {
		return nil
	}
	return []reconcile.Request{{
		NamespacedName: types.NamespacedName{Name: name, Namespace: obj.GetNamespace()},
	}}
}

// Reconciler implements runtimes.Reconciler for the KAI runtime.
type Reconciler struct {
	client client.Client
}

// Reconcile renders the PodGroup (if gang scheduling is on) and Pods for the task group.
// Existing children are not modified — both Pod and PodGroup are treated as immutable
// once created, since the workload semantics don't permit in-place changes.
func (r *Reconciler) Reconcile(ctx context.Context, otg *v1alpha1.OSMOTaskGroup) (reconcile.Result, error) {
	logger := log.FromContext(ctx)

	cfg, err := unmarshalConfig(otg)
	if err != nil {
		return reconcile.Result{}, fmt.Errorf("invalid kai runtimeConfig: %w", err)
	}
	if len(cfg.Tasks) == 0 {
		return reconcile.Result{}, fmt.Errorf("kai runtimeConfig.tasks must be non-empty")
	}

	// 1) PodGroup (owned by the OSMOTaskGroup so cascade delete removes the gang
	//    plus its pods).
	var podGroupRef *unstructured.Unstructured
	if gangScheduling(cfg) {
		pg := renderPodGroup(otg, cfg)
		if err := controllerutil.SetControllerReference(otg, pg, r.client.Scheme()); err != nil {
			return reconcile.Result{}, fmt.Errorf("setting PodGroup owner: %w", err)
		}
		if err := r.ensure(ctx, pg); err != nil {
			return reconcile.Result{}, fmt.Errorf("ensuring PodGroup: %w", err)
		}
		// Fetch the live PodGroup so we have its UID for Pod owner references.
		live := &unstructured.Unstructured{}
		live.SetGroupVersionKind(PodGroupGVK)
		if err := r.client.Get(ctx, types.NamespacedName{Name: pg.GetName(), Namespace: pg.GetNamespace()}, live); err != nil {
			return reconcile.Result{}, fmt.Errorf("reading back PodGroup: %w", err)
		}
		podGroupRef = live
	}

	// 2) Pods. Each is parented either to the PodGroup (if gang scheduling) or to the
	//    OSMOTaskGroup directly.
	for _, t := range cfg.Tasks {
		pod := renderPod(otg, cfg, t)
		if podGroupRef != nil {
			pod.OwnerReferences = []metav1.OwnerReference{podOwnerRefToGroup(podGroupRef)}
			// KAI matches pods to a PodGroup by annotation.
			if pod.Annotations == nil {
				pod.Annotations = map[string]string{}
			}
			pod.Annotations["pod-group.scheduling.kai.run.ai"] = podGroupRef.GetName()
		} else {
			if err := controllerutil.SetControllerReference(otg, pod, r.client.Scheme()); err != nil {
				return reconcile.Result{}, fmt.Errorf("setting Pod owner: %w", err)
			}
		}
		if err := r.ensure(ctx, pod); err != nil {
			return reconcile.Result{}, fmt.Errorf("ensuring Pod %s: %w", pod.Name, err)
		}
		logger.V(1).Info("reconciled pod", "name", pod.Name)
	}

	return reconcile.Result{}, nil
}

// ensure creates an object if it does not exist. Existing objects are left alone — Pods
// are immutable, and a re-render with the same input would produce an identical object.
// Use a delete-and-recreate to apply changes.
func (r *Reconciler) ensure(ctx context.Context, obj client.Object) error {
	if err := r.client.Create(ctx, obj); err != nil {
		if apierrors.IsAlreadyExists(err) {
			return nil
		}
		return err
	}
	return nil
}

// Finalize would flush logs to object storage on delete. Phase 1 leaves this as a no-op
// hook; Phase 4 wires in the actual log sink. Returning nil here unblocks cascade delete
// immediately for KAI runtime.
func (r *Reconciler) Finalize(_ context.Context, _ *v1alpha1.OSMOTaskGroup) error {
	return nil
}

// unmarshalConfig decodes the raw RuntimeConfig bytes into the typed KAI config. The
// CRD declares runtimeConfig as a Schemaless / PreserveUnknownFields field, so the
// apiserver stores whatever JSON the client submitted verbatim. This decoder is the only
// place that interprets it for the KAI runtime.
func unmarshalConfig(otg *v1alpha1.OSMOTaskGroup) (*v1alpha1.KAIRuntimeConfig, error) {
	raw := otg.Spec.RuntimeConfig.Raw
	if len(raw) == 0 {
		return nil, fmt.Errorf("runtimeConfig is empty")
	}
	var cfg v1alpha1.KAIRuntimeConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("decoding kai runtimeConfig: %w", err)
	}
	return &cfg, nil
}

// Compile-time interface checks.
var (
	_ runtimes.Reconciler   = (*Reconciler)(nil)
	_ runtimes.StatusMapper = (*StatusMapper)(nil)
)
