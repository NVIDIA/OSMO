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
	"encoding/json"
	"fmt"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"

	taskgroupv1alpha1 "go.corp.nvidia.com/osmo/apis/taskgroup/v1alpha1"
	pb "go.corp.nvidia.com/osmo/proto/operator"
)

const DefaultStatusReportTimeout = 10 * time.Second
const statusTokenEnv = "OSMO_TASKGROUP_STATUS_TOKEN"

type StatusReporter interface {
	ReportStatus(
		ctx context.Context,
		otg *taskgroupv1alpha1.OSMOTaskGroup,
		status taskgroupv1alpha1.OSMOTaskGroupStatus,
	) error
}

type GRPCStatusReporter struct {
	client  pb.TaskGroupStatusServiceClient
	timeout time.Duration
	token   string
}

func NewGRPCStatusReporter(
	address string,
	timeout time.Duration,
) (*GRPCStatusReporter, func() error, error) {
	if address == "" {
		return nil, func() error { return nil }, nil
	}
	if timeout == 0 {
		timeout = DefaultStatusReportTimeout
	}
	connection, err := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, nil, fmt.Errorf("create status reporter grpc client: %w", err)
	}
	return &GRPCStatusReporter{
		client:  pb.NewTaskGroupStatusServiceClient(connection),
		timeout: timeout,
		token:   os.Getenv(statusTokenEnv),
	}, connection.Close, nil
}

func (r *GRPCStatusReporter) ReportStatus(
	ctx context.Context,
	otg *taskgroupv1alpha1.OSMOTaskGroup,
	status taskgroupv1alpha1.OSMOTaskGroupStatus,
) error {
	statusBytes, err := json.Marshal(status)
	if err != nil {
		return fmt.Errorf("marshal OSMOTaskGroup status: %w", err)
	}
	taskStatusUpdates, err := extractTaskStatusUpdates(status)
	if err != nil {
		return fmt.Errorf("extract OSMOTaskGroup task status updates: %w", err)
	}
	reportContext, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	if r.token != "" {
		reportContext = metadata.AppendToOutgoingContext(
			reportContext,
			"x-osmo-taskgroup-status-token",
			r.token,
		)
	}
	_, err = r.client.ReportOTGStatus(reportContext, &pb.ReportOTGStatusRequest{
		Namespace:         otg.Namespace,
		Name:              otg.Name,
		WorkflowUuid:      otg.Spec.WorkflowUUID,
		GroupUuid:         otg.Spec.GroupUUID,
		Phase:             string(status.Phase),
		StatusJson:        string(statusBytes),
		TaskStatusUpdates: taskStatusUpdates,
	})
	if err != nil {
		return fmt.Errorf("report OSMOTaskGroup status: %w", err)
	}
	return nil
}

func extractTaskStatusUpdates(
	status taskgroupv1alpha1.OSMOTaskGroupStatus,
) ([]*pb.TaskStatusUpdate, error) {
	if len(status.RuntimeStatus.Raw) == 0 {
		return nil, nil
	}
	var runtimeStatus struct {
		TaskStatusUpdates []taskStatusUpdateReport `json:"task_status_updates"`
	}
	if err := json.Unmarshal(status.RuntimeStatus.Raw, &runtimeStatus); err != nil {
		return nil, err
	}
	return taskStatusUpdateReportsToProto(runtimeStatus.TaskStatusUpdates), nil
}
