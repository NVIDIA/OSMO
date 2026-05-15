// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package taskgroup

import (
	"context"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type DynamicReconciler struct {
	client client.Client
}

func NewDynamicReconciler(client client.Client) *DynamicReconciler {
	return &DynamicReconciler{client: client}
}

func (r *DynamicReconciler) Apply(
	ctx context.Context,
	objects []unstructured.Unstructured,
) error {
	for index := range objects {
		object := objects[index]
		if err := r.client.Create(ctx, &object); err != nil && !apierrors.IsAlreadyExists(err) {
			return err
		}
	}
	return nil
}
