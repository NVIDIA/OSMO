// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
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

package utils

import (
	"log"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// StatusAttrs holds pre-computed metric attribute sets keyed by status string.
// It avoids allocating a new attribute set on every metric call for known status values.
type StatusAttrs struct {
	byStatus map[string]metric.MeasurementOption
}

// NewStatusAttrs pre-computes one metric.MeasurementOption per status string.
func NewStatusAttrs(statuses []string) StatusAttrs {
	m := make(map[string]metric.MeasurementOption, len(statuses))
	for _, s := range statuses {
		m[s] = metric.WithAttributeSet(attribute.NewSet(attribute.String("status", s)))
	}
	return StatusAttrs{byStatus: m}
}

// Get returns the pre-computed MeasurementOption for the given status.
// If status is not in the pre-computed map (unexpected value), it logs a warning
// and falls back to constructing the attribute set on the fly.
func (sa StatusAttrs) Get(status string) metric.MeasurementOption {
	if attr, ok := sa.byStatus[status]; ok {
		return attr
	}
	log.Printf("Warning: unexpected task status %q, not in pre-computed attribute map", status)
	return metric.WithAttributeSet(attribute.NewSet(attribute.String("status", status)))
}
