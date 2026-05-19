// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package k8s holds small helpers for setting up Kubernetes clients consistently across
// the controller and Operator Service binaries. Nothing here is OSMO-specific.
package k8s

import (
	"fmt"

	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	ctrl "sigs.k8s.io/controller-runtime"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

// Scheme returns a runtime.Scheme registered with all types this module needs to
// serialize/deserialize. Both the controller and the Operator Service share this.
func Scheme() *runtime.Scheme {
	s := runtime.NewScheme()
	utilruntime.Must(clientgoscheme.AddToScheme(s))
	utilruntime.Must(v1alpha1.AddToScheme(s))
	return s
}

// Config returns a rest.Config from the standard sources: in-cluster service account,
// $KUBECONFIG, or ~/.kube/config. Passing a non-empty kubeconfig path overrides the search.
func Config(kubeconfig string) (*rest.Config, error) {
	if kubeconfig == "" {
		cfg, err := ctrl.GetConfig()
		if err != nil {
			return nil, fmt.Errorf("loading default kubeconfig: %w", err)
		}
		return cfg, nil
	}
	cfg, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
	if err != nil {
		return nil, fmt.Errorf("loading %s: %w", kubeconfig, err)
	}
	return cfg, nil
}
