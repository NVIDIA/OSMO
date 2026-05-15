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

type conditionReport struct {
	Type      string `json:"type"`
	Status    string `json:"status"`
	Reason    string `json:"reason,omitempty"`
	Message   string `json:"message,omitempty"`
	Timestamp string `json:"timestamp,omitempty"`
}

type taskStatusUpdateReport struct {
	WorkflowUUID string            `json:"workflow_uuid"`
	TaskUUID     string            `json:"task_uuid"`
	RetryID      int32             `json:"retry_id"`
	Container    string            `json:"container"`
	Node         string            `json:"node,omitempty"`
	PodIP        string            `json:"pod_ip,omitempty"`
	Message      string            `json:"message,omitempty"`
	Status       string            `json:"status"`
	ExitCode     int32             `json:"exit_code,omitempty"`
	Backend      string            `json:"backend,omitempty"`
	Conditions   []conditionReport `json:"conditions,omitempty"`
}
