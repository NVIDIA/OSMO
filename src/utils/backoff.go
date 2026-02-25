/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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

package utils

import (
	"math/rand"
	"time"
)

// CalculateBackoff returns exponential backoff duration with a max cap and random jitter.
// Sequence: 1s, 2s, 4s, 8s, 16s, then capped at maxBackoff.
// A random jitter in [0, 1min] is added to the base duration, then capped at maxBackoff.
func CalculateBackoff(retryCount int, maxBackoff time.Duration) time.Duration {
	if retryCount <= 0 {
		return 0
	}
	d := time.Duration(1<<uint(retryCount-1)) * time.Second
	if d > maxBackoff {
		d = maxBackoff
	}
	jitter := time.Duration(rand.Float64() * float64(time.Minute))
	result := d + jitter
	if result > maxBackoff {
		result = maxBackoff
	}
	return result
}
