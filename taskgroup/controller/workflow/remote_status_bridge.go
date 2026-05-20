// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package workflow

import (
	"context"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	"github.com/nvidia/osmo/taskgroup/operator"
)

// StartRemoteStatusBridge subscribes to the operator's StatusBus and projects every
// OTGStatusEvent into the corresponding OSMOWorkflow.Status.Groups[name] entry.
//
// This is the "bus subscriber" side of the cross-cluster status flow. Without this,
// remote groups stay Pending forever (only the local-watch path in
// refreshLocalStatuses gets executed for local groups).
//
// Returns immediately after starting a background goroutine that runs until ctx is
// cancelled.
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
// Status.Groups entry. The lookup uses the conventional naming applied by
// RemoteDispatcher: OTG name = "<workflow>-<group>".
//
// If the OTG isn't from one of our workflows (no recognizable workflow prefix) we drop
// the event silently — could be cross-namespace traffic or another tenant.
func applyRemoteStatus(ctx context.Context, c client.Client, ev operator.StatusEvent) error {
	if ev.Event == nil || ev.Event.GetStatus() == nil {
		return nil
	}
	otgName := ev.Event.GetName()
	otgNamespace := ev.Event.GetNamespace()

	// Reconstruct workflow name from OTG name. Since OTG names are deterministic
	// ("<workflow>-<group>") we can search for the matching workflow, but to keep it
	// simple we expect the workflow name to be a prefix. List workflows in the OTG's
	// namespace and find the one whose name + group concatenation matches.
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
		return nil // unknown event; drop
	}

	// Update the matching group's status entry, preserving the TaskGroupRef.
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
		Phase:        v1alpha1.Phase(ev.Event.GetStatus().GetPhase()),
		TaskGroupRef: prev.TaskGroupRef, // keep
		LastUpdated:  &now,
		Message:      ev.Event.GetStatus().GetMessage(),
	}
	return c.Status().Update(ctx, wfFresh)
}

// otgNameFor matches the naming dispatcher.go uses. Re-declared here to avoid a circular
// import — kept in sync by convention.
func otgNameFor(workflowName, groupName string) string {
	return workflowName + "-" + groupName
}

// matchPrefix is a small string helper; exists for tests.
func matchPrefix(name, prefix string) bool { return strings.HasPrefix(name, prefix) }

// Silence the unused import warning if otgNameFor + matchPrefix end up unused.
var _ = time.Now
var _ = matchPrefix
