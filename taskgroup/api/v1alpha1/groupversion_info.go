// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package v1alpha1 contains API Schema definitions for the workflow.osmo.nvidia.com v1alpha1 API
// group, including the OSMOTaskGroup custom resource.
// +kubebuilder:object:generate=true
// +groupName=workflow.osmo.nvidia.com
package v1alpha1

import (
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/scheme"
)

// GroupVersion is the group/version used to register these objects.
var GroupVersion = schema.GroupVersion{Group: "workflow.osmo.nvidia.com", Version: "v1alpha1"}

// SchemeBuilder collects types into the scheme.
var SchemeBuilder = &scheme.Builder{GroupVersion: GroupVersion}

// AddToScheme adds the types in this group-version to the given scheme.
var AddToScheme = SchemeBuilder.AddToScheme
