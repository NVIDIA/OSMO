// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package workflow

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	"github.com/nvidia/osmo/taskgroup/operator"
)

// StartRemoteStatusBridge subscribes to the operator's StatusBus and projects every
// OTGStatusEvent into the corresponding OSMOWorkflow.Status.Groups[name] entry. Returns
// immediately after starting a background goroutine that runs until ctx is cancelled.
//
// Without this subscriber, remote groups stay Pending forever — only the local-watch
// path in refreshLocalStatuses sees state changes for local groups.
func StartRemoteStatusBridge(ctx context.Context, c client.Client, bus *operator.StatusBus) {
	logger := log.FromContext(ctx).WithName("remote-status-bridge")
	events := make(chan operator.StatusEvent, 64)
	cancel := bus.Subscribe(events)

	go func() {
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				return
			case ev := <-events:
				if err := applyRemoteStatus(ctx, c, ev); err != nil {
					logger.Info("apply remote status failed", "error", err.Error(),
						"cluster", ev.ClusterID, "otg", ev.Event.GetName())
				}
			}
		}
	}()
}

// applyRemoteStatus locates the parent OSMOWorkflow for one remote OTG and updates its
// Status.Groups entry. The lookup matches OTG name + cluster against each workflow's
// group definitions; mismatches are dropped silently (cross-namespace traffic, foreign
// workflow, etc.).
func applyRemoteStatus(ctx context.Context, c client.Client, ev operator.StatusEvent) error {
	if ev.Event == nil || ev.Event.GetStatus() == nil {
		return nil
	}
	otgName := ev.Event.GetName()
	otgNamespace := ev.Event.GetNamespace()

	var wfs v1alpha1.OSMOWorkflowList
	if err := c.List(ctx, &wfs, client.InNamespace(otgNamespace)); err != nil {
		return err
	}
	var wf *v1alpha1.OSMOWorkflow
	var matchedGroup string
	for i := range wfs.Items {
		w := &wfs.Items[i]
		for _, g := range w.Spec.Groups {
			if otgName == otgNameFor(w.Name, g.Name) && g.Cluster == ev.ClusterID {
				wf = w
				matchedGroup = g.Name
				break
			}
		}
		if wf != nil {
			break
		}
	}
	if wf == nil {
		return nil
	}

	// Re-fetch the workflow so the status update lands on the latest resourceVersion. A
	// conflict here is benign — the next event re-attempts.
	wfFresh := &v1alpha1.OSMOWorkflow{}
	if err := c.Get(ctx, types.NamespacedName{Name: wf.Name, Namespace: wf.Namespace}, wfFresh); err != nil {
		return err
	}
	if wfFresh.Status.Groups == nil {
		wfFresh.Status.Groups = map[string]v1alpha1.WorkflowGroupStatus{}
	}
	prev := wfFresh.Status.Groups[matchedGroup]
	now := metav1.Now()
	wfFresh.Status.Groups[matchedGroup] = v1alpha1.WorkflowGroupStatus{
		Phase:        coercePhase(ev.Event.GetStatus().GetPhase()),
		TaskGroupRef: prev.TaskGroupRef,
		LastUpdated:  &now,
		Message:      ev.Event.GetStatus().GetMessage(),
	}
	return c.Status().Update(ctx, wfFresh)
}

// coercePhase maps a wire-side phase string to a known v1alpha1.Phase. Unknown values
// fall back to PhasePending — the next event from the controller will overwrite.
func coercePhase(s string) v1alpha1.Phase {
	switch v1alpha1.Phase(s) {
	case v1alpha1.PhasePending,
		v1alpha1.PhaseRunning,
		v1alpha1.PhaseSucceeded,
		v1alpha1.PhaseFailed,
		v1alpha1.PhaseTerminating:
		return v1alpha1.Phase(s)
	}
	return v1alpha1.PhasePending
}

// otgNameFor matches the naming dispatcher.go uses. Re-declared here to avoid a circular
// import — kept in sync by convention.
func otgNameFor(workflowName, groupName string) string {
	return workflowName + "-" + groupName
}
