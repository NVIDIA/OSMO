// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package controller

import (
	"fmt"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	"github.com/nvidia/osmo/taskgroup/controller/runtimes"
)

// Dispatcher maps a RuntimeType to its registered Runtime. The set of registered runtimes
// is fixed at controller startup; runtimes are not added or removed at runtime.
//
// To plug in a new runtime, register a Factory in cmd/controller/main.go before starting
// the manager. The rest of the controller code is unaware of which runtimes exist.
type Dispatcher struct {
	runtimes map[v1alpha1.RuntimeType]runtimes.Runtime
}

// NewDispatcher returns a dispatcher with no runtimes registered. Use Register to add them.
func NewDispatcher() *Dispatcher {
	return &Dispatcher{runtimes: make(map[v1alpha1.RuntimeType]runtimes.Runtime)}
}

// Register adds a runtime implementation. A second call with the same RuntimeType replaces
// the previous registration; this is intentional to support test overrides.
func (d *Dispatcher) Register(t v1alpha1.RuntimeType, r runtimes.Runtime) {
	d.runtimes[t] = r
}

// Resolve returns the registered Runtime for the given RuntimeType.
// Returns ErrUnknownRuntime if no runtime is registered for that type.
func (d *Dispatcher) Resolve(t v1alpha1.RuntimeType) (runtimes.Runtime, error) {
	r, ok := d.runtimes[t]
	if !ok {
		return runtimes.Runtime{}, &UnknownRuntimeError{Type: t}
	}
	return r, nil
}

// Registered returns the list of currently registered runtime types. Used for health
// reporting and CR validation.
func (d *Dispatcher) Registered() []v1alpha1.RuntimeType {
	out := make([]v1alpha1.RuntimeType, 0, len(d.runtimes))
	for t := range d.runtimes {
		out = append(out, t)
	}
	return out
}

// UnknownRuntimeError indicates the controller does not have a registered Runtime for the
// requested RuntimeType. The reconciler surfaces this as a condition on the CR with
// Status=False and a message explaining which type was requested.
type UnknownRuntimeError struct {
	Type v1alpha1.RuntimeType
}

func (e *UnknownRuntimeError) Error() string {
	return fmt.Sprintf("no reconciler registered for runtimeType=%q", e.Type)
}
