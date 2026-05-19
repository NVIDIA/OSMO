// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package workflow

import (
	"fmt"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

// resolveReady returns the names of groups whose dependencies are all Succeeded and that
// have not yet been dispatched (no entry in status.groups or entry with no taskGroupRef).
// This is the core DAG primitive: at each reconcile, walk the graph and pick the next
// frontier.
//
// Returns an error if the DAG contains a cycle or references an unknown group.
func resolveReady(wf *v1alpha1.OSMOWorkflow) ([]string, error) {
	if err := validateGraph(wf); err != nil {
		return nil, err
	}

	dispatched := dispatchedSet(wf)
	succeeded := succeededSet(wf)

	var ready []string
	for _, g := range wf.Spec.Groups {
		if dispatched[g.Name] {
			continue
		}
		if depsSatisfied(g.DependsOn, succeeded) {
			ready = append(ready, g.Name)
		}
	}
	return ready, nil
}

// depsSatisfied is true iff every name in deps is present in succeeded.
func depsSatisfied(deps []string, succeeded map[string]bool) bool {
	for _, d := range deps {
		if !succeeded[d] {
			return false
		}
	}
	return true
}

// dispatchedSet returns the set of group names that already have a TaskGroupRef recorded
// in status. Used to avoid double-dispatching.
func dispatchedSet(wf *v1alpha1.OSMOWorkflow) map[string]bool {
	out := make(map[string]bool, len(wf.Status.Groups))
	for name, s := range wf.Status.Groups {
		if s.TaskGroupRef.Name != "" {
			out[name] = true
		}
	}
	return out
}

// succeededSet returns the set of group names whose underlying TaskGroup has reached the
// Succeeded phase. Drives DAG progression.
func succeededSet(wf *v1alpha1.OSMOWorkflow) map[string]bool {
	out := make(map[string]bool, len(wf.Status.Groups))
	for name, s := range wf.Status.Groups {
		if s.Phase == v1alpha1.PhaseSucceeded {
			out[name] = true
		}
	}
	return out
}

// validateGraph checks that:
//   - Every group name is unique
//   - Every DependsOn reference points to a known group
//   - There are no cycles
//
// This runs on every reconcile because Spec is immutable but we want to surface
// validation errors via the status condition rather than silently doing nothing.
func validateGraph(wf *v1alpha1.OSMOWorkflow) error {
	names := make(map[string]bool, len(wf.Spec.Groups))
	for _, g := range wf.Spec.Groups {
		if names[g.Name] {
			return fmt.Errorf("duplicate group name %q", g.Name)
		}
		names[g.Name] = true
	}

	for _, g := range wf.Spec.Groups {
		for _, dep := range g.DependsOn {
			if !names[dep] {
				return fmt.Errorf("group %q depends on unknown group %q", g.Name, dep)
			}
		}
	}

	// Cycle detection: standard depth-first search with a recursion stack.
	state := make(map[string]int8, len(wf.Spec.Groups)) // 0=unvisited 1=in-progress 2=done
	graph := make(map[string][]string, len(wf.Spec.Groups))
	for _, g := range wf.Spec.Groups {
		graph[g.Name] = g.DependsOn
	}

	var visit func(name string, path []string) error
	visit = func(name string, path []string) error {
		switch state[name] {
		case 1:
			return fmt.Errorf("cycle detected: %v → %s", path, name)
		case 2:
			return nil
		}
		state[name] = 1
		for _, dep := range graph[name] {
			if err := visit(dep, append(path, name)); err != nil {
				return err
			}
		}
		state[name] = 2
		return nil
	}
	for _, g := range wf.Spec.Groups {
		if err := visit(g.Name, nil); err != nil {
			return err
		}
	}
	return nil
}

// rollupPhase computes the workflow-level phase from per-group statuses.
//
// Rules:
//   - Failed if any group is Failed
//   - Succeeded if all groups are Succeeded
//   - Running if any group is Running
//   - Pending otherwise
func rollupPhase(wf *v1alpha1.OSMOWorkflow) v1alpha1.Phase {
	total := len(wf.Spec.Groups)
	if total == 0 {
		return v1alpha1.PhaseSucceeded
	}
	succeeded := 0
	failed := 0
	running := 0
	for _, g := range wf.Spec.Groups {
		switch wf.Status.Groups[g.Name].Phase {
		case v1alpha1.PhaseFailed:
			failed++
		case v1alpha1.PhaseSucceeded:
			succeeded++
		case v1alpha1.PhaseRunning:
			running++
		}
	}
	switch {
	case failed > 0:
		return v1alpha1.PhaseFailed
	case succeeded == total:
		return v1alpha1.PhaseSucceeded
	case running > 0 || succeeded > 0:
		return v1alpha1.PhaseRunning
	default:
		return v1alpha1.PhasePending
	}
}
