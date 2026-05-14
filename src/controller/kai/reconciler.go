/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
*/

// Package kai implements the OSMOTaskGroup reconciler for runtimeType=kai.
// It is the Go replacement for the Python KaiK8sObjectFactory rendering
// path (src/utils/job/kb_objects.py).
//
// The rendered Pod + PodGroup output MUST match the golden fixtures under
// src/utils/job/tests/testdata/rendering/ exactly during Phase 1
// dual-write. Any divergence is a Phase 1 bug.
package kai

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	workflowv1alpha1 "go.corp.nvidia.com/osmo/apis/workflow/v1alpha1"
	"go.corp.nvidia.com/osmo/controller/dispatcher"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
)

// PodGroupGVR identifies the KAI scheduler's PodGroup CRD. KAI gang scheduling
// hangs off this resource; reconciling a task group is "create the PodGroup
// plus the member pods, with the PodGroup as their controller-owner so cascade
// delete works."
var PodGroupGVR = schema.GroupVersionResource{
	Group:    "scheduling.run.ai",
	Version:  "v2alpha2",
	Resource: "podgroups",
}

// Config is the controller's KAI runtime configuration. Pinned at startup
// from controller flags, not the CR (cluster-local policy).
type Config struct {
	// SchedulerName is the default scheduler name used when the CR doesn't
	// override it. KAI scheduler convention is "kai-scheduler".
	SchedulerName string

	// Namespace is the namespace OSMOTaskGroup CRs and their child Pods live
	// in. Pods inherit it from the CR.
	Namespace string
}

// Reconciler implements dispatcher.Reconciler for the KAI runtime.
//
// Phase 1 scope (PROJ-taskgroup-crd.md "KAI reconciler"):
//  1. Decode spec.runtimeConfig into a KAIConfig.
//  2. For each task, render a Pod with the KAI scheduler annotations and
//     queue labels matching what KaiK8sObjectFactory emits.
//  3. Create the PodGroup CR with minAvailable defaulted to len(tasks).
//  4. Set the PodGroup as controller-owner of the Pods for cascade delete.
//  5. Status mapper reads Pod phases and reports back via the CR.
type Reconciler struct {
	Config        Config
	KubeClient    kubernetes.Interface
	DynamicClient dynamic.Interface
}

var _ dispatcher.Reconciler = (*Reconciler)(nil)

// Reconcile drives the cluster toward the OSMOTaskGroup's desired state.
//
// Phase 1 wires the rendering path but stops short of the full apply loop;
// the golden-fixture diff harness exercises Render() directly. The
// production apply loop (create-or-patch PodGroup, set owner refs, create
// Pods idempotently) lands incrementally once the controller is deployed
// into staging.
func (r *Reconciler) Reconcile(ctx context.Context, otg *workflowv1alpha1.OSMOTaskGroup) (dispatcher.Result, error) {
	cfg, err := DecodeKAIConfig(otg)
	if err != nil {
		return dispatcher.Result{}, fmt.Errorf("decode runtimeConfig: %w", err)
	}

	rendered, err := r.Render(otg, cfg)
	if err != nil {
		return dispatcher.Result{}, fmt.Errorf("render: %w", err)
	}

	if err := r.apply(ctx, otg, rendered); err != nil {
		return dispatcher.Result{}, fmt.Errorf("apply: %w", err)
	}
	return dispatcher.Result{}, nil
}

// Rendered is the output of pure-function rendering: a PodGroup plus its
// member Pods, in apply order (PodGroup first so KAI sees the gang
// constraint before pod admission).
type Rendered struct {
	PodGroup *PodGroup
	Pods     []*corev1.Pod
}

// PodGroup is the KAI scheduler's gang-scheduling resource. Modeled as a
// typed struct rather than unstructured so the renderer's output is easy to
// diff against Python's golden JSON.
type PodGroup struct {
	APIVersion string            `json:"apiVersion"`
	Kind       string            `json:"kind"`
	Metadata   metav1.ObjectMeta `json:"metadata"`
	Spec       PodGroupSpec      `json:"spec"`
}

// PodGroupSpec mirrors the KAI v2alpha2 PodGroup.spec fields the renderer
// touches. Unused fields are omitted; KAI tolerates this.
type PodGroupSpec struct {
	Queue             string            `json:"queue,omitempty"`
	PriorityClassName string            `json:"priorityClassName,omitempty"`
	MinMember         int32             `json:"minMember,omitempty"`
	SchedulingPolicy  *SchedulingPolicy `json:"schedulingPolicy,omitempty"`
}

// SchedulingPolicy is the subset of KAI scheduling policy we touch today.
type SchedulingPolicy struct {
	MinAvailable int32 `json:"minAvailable,omitempty"`
}

// Render produces the Pod + PodGroup objects for an OSMOTaskGroup without
// touching the cluster.
//
// Phase 1 scope (verified against Phase 0 golden
// `single_task_no_topology.json`): queue derivation, PriorityClassName,
// scheduler annotations, deterministic ordering.
//
// Out of scope until the topology algorithm is ported to Go: PodGroup
// `subGroups[]`, top-level `topologyConstraint`, and per-pod
// `kai.scheduler/subgroup-name` labels. The Python golden
// `multi_task_with_topology.json` exists as the Phase-3 porting target; it
// is *not* part of the Phase 1 dual-write diff.
func (r *Reconciler) Render(otg *workflowv1alpha1.OSMOTaskGroup, cfg *workflowv1alpha1.KAIConfig) (*Rendered, error) {
	if len(cfg.Tasks) == 0 {
		return nil, fmt.Errorf("kai runtime requires at least one task")
	}

	poolName := otg.Spec.PoolName
	if poolName == "" {
		poolName = "default"
	}
	queue := cfg.Queue
	if queue == "" {
		// Default queue convention mirrors KaiK8sObjectFactory:
		// osmo-pool-<namespace>-<poolName>.
		queue = fmt.Sprintf("osmo-pool-%s-%s", r.Config.Namespace, poolName)
	}
	schedulerName := cfg.SchedulerName
	if schedulerName == "" {
		schedulerName = r.Config.SchedulerName
	}
	priorityClassName := priorityClassFor(otg.Spec.Priority)

	minMember := cfg.MinAvailable
	if minMember == 0 {
		minMember = int32(len(cfg.Tasks))
	}

	pg := &PodGroup{
		APIVersion: "scheduling.run.ai/v2alpha2",
		Kind:       "PodGroup",
		Metadata: metav1.ObjectMeta{
			Name:      otg.Name,
			Namespace: otg.Namespace,
			Labels: map[string]string{
				"kai.scheduler/queue":            queue,
				"runai/queue":                    queue,
				workflowv1alpha1.LabelWorkflowID: otg.Spec.WorkflowID,
				workflowv1alpha1.LabelGroupName:  otg.Spec.GroupName,
			},
		},
		Spec: PodGroupSpec{
			Queue:             queue,
			PriorityClassName: priorityClassName,
			MinMember:         minMember,
		},
	}

	pods := make([]*corev1.Pod, 0, len(cfg.Tasks))
	// Sort tasks by name for deterministic output. The Python factory
	// preserves input order; we sort to make sure two different goroutines
	// reconciling the same CR produce byte-identical YAML.
	sorted := append([]workflowv1alpha1.KAITaskTemplate(nil), cfg.Tasks...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })

	for _, t := range sorted {
		pod := renderPod(otg, queue, schedulerName, priorityClassName, t)
		pods = append(pods, pod)
	}
	return &Rendered{PodGroup: pg, Pods: pods}, nil
}

// priorityClassFor maps the OSMO workflow priority bucket onto a KAI
// PriorityClass name. Mirrors KaiK8sObjectFactory.update_pod_k8s_resource's
// "osmo-<priority>" convention; an empty / unknown priority emits no class
// (the cluster default applies).
func priorityClassFor(priority string) string {
	if priority == "" {
		return ""
	}
	return "osmo-" + strings.ToLower(priority)
}

// renderPod expands one KAITaskTemplate into a full Pod, mirroring
// KaiK8sObjectFactory.update_pod_k8s_resource in Python. Cluster-local
// extras (security context, base volume mounts, OSMO init containers) are
// added by a follow-up Phase 1 pass once the API server emits them through
// the CR; today we render only what is in KAITaskTemplate.
func renderPod(
	otg *workflowv1alpha1.OSMOTaskGroup,
	queue, schedulerName, priorityClassName string,
	t workflowv1alpha1.KAITaskTemplate,
) *corev1.Pod {
	labels := map[string]string{
		workflowv1alpha1.LabelWorkflowID: otg.Spec.WorkflowID,
		workflowv1alpha1.LabelGroupName:  otg.Spec.GroupName,
		"osmo.task_name":                 t.Name,
		"kai.scheduler/queue":            queue,
		"runai/queue":                    queue,
	}
	if otg.Spec.Priority != "" {
		labels["osmo.priority"] = strings.ToLower(otg.Spec.Priority)
	}
	return &corev1.Pod{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "v1",
			Kind:       "Pod",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-%s", otg.Name, t.Name),
			Namespace: otg.Namespace,
			Labels:    labels,
			Annotations: map[string]string{
				"pod-group-name": otg.Name,
			},
		},
		Spec: corev1.PodSpec{
			SchedulerName:     schedulerName,
			PriorityClassName: priorityClassName,
			RestartPolicy:     corev1.RestartPolicyNever,
			Containers: []corev1.Container{
				{
					Name:      "user",
					Image:     t.Image,
					Command:   t.Command,
					Args:      t.Args,
					Env:       t.Env,
					Resources: t.Resources,
				},
			},
		},
	}
}

// apply is the create-or-update loop for the rendered objects. Phase 1's
// staging deployment exercises this against a single cluster.
//
// When KubeClient and DynamicClient are nil (unit-test / no-cluster path)
// apply is a no-op so Render() can be exercised standalone. When they ARE
// wired we must NOT silently succeed — a fully-configured controller that
// returns "ok" without writing anything would let the API server believe
// CRs are being reconciled while pods never start. Fail loudly instead.
func (r *Reconciler) apply(_ context.Context, _ *workflowv1alpha1.OSMOTaskGroup, _ *Rendered) error {
	if r.KubeClient == nil && r.DynamicClient == nil {
		return nil
	}
	// TODO(phase1-staging): create PodGroup; on AlreadyExists fall through;
	// set OwnerReference from PodGroup to each Pod; create Pods.
	return ErrApplyNotImplemented
}

// ErrApplyNotImplemented is returned by Reconcile when K8s clients are wired
// but the apply path has not yet been completed. Surfaced as a permanent
// status condition by the runner so a misconfigured deploy is visible
// instead of silently dropping CRs.
var ErrApplyNotImplemented = errApplyNotImplemented{}

type errApplyNotImplemented struct{}

func (errApplyNotImplemented) Error() string {
	return "kai reconciler: apply path not yet implemented (Phase 1 scaffold)"
}

// DecodeKAIConfig parses spec.runtimeConfig as a KAIConfig. Exported so the
// status mapper can reuse the decoded value (decoding once per reconcile
// cycle was a small inefficiency flagged in code review).
func DecodeKAIConfig(otg *workflowv1alpha1.OSMOTaskGroup) (*workflowv1alpha1.KAIConfig, error) {
	if otg.Spec.RuntimeConfig == nil {
		return nil, fmt.Errorf("runtimeConfig is required for runtimeType=kai")
	}
	raw, err := rawExtensionBytes(otg.Spec.RuntimeConfig)
	if err != nil {
		return nil, err
	}
	var cfg workflowv1alpha1.KAIConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("decode runtimeConfig: %w", err)
	}
	return &cfg, nil
}

func rawExtensionBytes(ext *runtime.RawExtension) ([]byte, error) {
	if ext == nil {
		return nil, fmt.Errorf("nil RawExtension")
	}
	if len(ext.Raw) > 0 {
		return ext.Raw, nil
	}
	if ext.Object == nil {
		return nil, fmt.Errorf("RawExtension has neither Raw bytes nor Object")
	}
	return json.Marshal(ext.Object)
}

// AsUnstructured serializes a PodGroup into the map shape the dynamic client
// expects. Exported so the apply path can use it once it is implemented; the
// `apierrors` and `dynamic` imports below are also held by exported helpers
// rather than `var _` placeholders.
func AsUnstructured(pg *PodGroup) (map[string]interface{}, error) {
	b, err := json.Marshal(pg)
	if err != nil {
		return nil, err
	}
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// IsAlreadyExists reports whether err comes from the K8s API rejecting a
// create because the object already exists. Re-exported so the apply path
// can use a single import; the underlying check is apierrors.IsAlreadyExists.
func IsAlreadyExists(err error) bool { return apierrors.IsAlreadyExists(err) }

// dynamicClientType binds the dynamic import so removing it later is a
// compile failure rather than a silent dep drift.
type dynamicClientType = dynamic.Interface
