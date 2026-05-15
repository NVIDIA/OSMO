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

package taskgroupstatusreceiver

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"

	pb "go.corp.nvidia.com/osmo/proto/operator"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const statusTokenEnv = "OSMO_TASKGROUP_STATUS_TOKEN"

type Server struct {
	pb.UnimplementedTaskGroupStatusServiceServer

	apiEndpoint  string
	client       *http.Client
	token        string
	deduplicator *reportDeduplicator
}

func NewServer(apiEndpoint string, client *http.Client) *Server {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &Server{
		apiEndpoint:  apiEndpoint,
		client:       client,
		token:        os.Getenv(statusTokenEnv),
		deduplicator: newReportDeduplicator(1024, 5*time.Minute),
	}
}

func (s *Server) ReportOTGStatus(
	ctx context.Context,
	request *pb.ReportOTGStatusRequest,
) (*pb.ReportOTGStatusResponse, error) {
	if err := s.authorize(ctx); err != nil {
		return nil, err
	}
	body, err := json.Marshal(reportPayloadFromProto(request))
	if err != nil {
		return nil, fmt.Errorf("marshal status report: %w", err)
	}
	deduplicationKey, err := json.Marshal(stableReportPayloadFromProto(request))
	if err != nil {
		return nil, fmt.Errorf("marshal stable status report key: %w", err)
	}
	if s.deduplicator.Seen(deduplicationKey, time.Now()) {
		return &pb.ReportOTGStatusResponse{Accepted: true}, nil
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		s.apiEndpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("create status report request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	if s.token != "" {
		httpRequest.Header.Set("x-osmo-taskgroup-status-token", s.token)
	}

	response, err := s.client.Do(httpRequest)
	if err != nil {
		return nil, fmt.Errorf("send status report to API server: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		errorBody, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return nil, fmt.Errorf("API server rejected status report: status=%d body=%s",
			response.StatusCode, string(errorBody))
	}
	s.deduplicator.Remember(deduplicationKey, time.Now())
	return &pb.ReportOTGStatusResponse{Accepted: true}, nil
}

func (s *Server) authorize(ctx context.Context) error {
	if s.token == "" {
		return status.Error(codes.PermissionDenied, "taskgroup status token is not configured")
	}
	incomingMetadata, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return status.Error(codes.PermissionDenied, "taskgroup status token is missing")
	}
	values := incomingMetadata.Get("x-osmo-taskgroup-status-token")
	if len(values) != 1 || values[0] != s.token {
		return status.Error(codes.PermissionDenied, "taskgroup status token is invalid")
	}
	return nil
}

type reportDeduplicator struct {
	mutex   sync.Mutex
	ttl     time.Duration
	maxKeys int
	seen    map[string]time.Time
}

func newReportDeduplicator(maxKeys int, ttl time.Duration) *reportDeduplicator {
	return &reportDeduplicator{
		ttl:     ttl,
		maxKeys: maxKeys,
		seen:    map[string]time.Time{},
	}
}

func (d *reportDeduplicator) Seen(body []byte, now time.Time) bool {
	sum := sha256.Sum256(body)
	key := hex.EncodeToString(sum[:])
	d.mutex.Lock()
	defer d.mutex.Unlock()

	expiresAt, ok := d.seen[key]
	if ok && now.Before(expiresAt) {
		return true
	}
	if ok {
		delete(d.seen, key)
	}
	return false
}

func (d *reportDeduplicator) Remember(body []byte, now time.Time) {
	sum := sha256.Sum256(body)
	key := hex.EncodeToString(sum[:])
	d.mutex.Lock()
	defer d.mutex.Unlock()

	if len(d.seen) >= d.maxKeys {
		d.prune(now)
	}
	if len(d.seen) >= d.maxKeys {
		d.dropOldest()
	}
	d.seen[key] = now.Add(d.ttl)
}

func (d *reportDeduplicator) prune(now time.Time) {
	for key, expiresAt := range d.seen {
		if !now.Before(expiresAt) {
			delete(d.seen, key)
		}
	}
}

func (d *reportDeduplicator) dropOldest() {
	oldestKey := ""
	oldestExpiration := time.Time{}
	for key, expiresAt := range d.seen {
		if oldestKey == "" || expiresAt.Before(oldestExpiration) {
			oldestKey = key
			oldestExpiration = expiresAt
		}
	}
	if oldestKey != "" {
		delete(d.seen, oldestKey)
	}
}

type reportPayload struct {
	Namespace         string             `json:"namespace"`
	Name              string             `json:"name"`
	WorkflowUUID      string             `json:"workflow_uuid"`
	GroupUUID         string             `json:"group_uuid"`
	Phase             string             `json:"phase"`
	StatusJSON        string             `json:"status_json"`
	TaskStatusUpdates []taskStatusUpdate `json:"task_status_updates"`
}

type stableReportPayload struct {
	Namespace         string             `json:"namespace"`
	Name              string             `json:"name"`
	WorkflowUUID      string             `json:"workflow_uuid"`
	GroupUUID         string             `json:"group_uuid"`
	Phase             string             `json:"phase"`
	TaskStatusUpdates []taskStatusUpdate `json:"task_status_updates"`
}

type taskStatusUpdate struct {
	WorkflowUUID string      `json:"workflow_uuid"`
	TaskUUID     string      `json:"task_uuid"`
	RetryID      int32       `json:"retry_id"`
	Container    string      `json:"container"`
	Node         string      `json:"node,omitempty"`
	PodIP        string      `json:"pod_ip,omitempty"`
	Message      string      `json:"message,omitempty"`
	Status       string      `json:"status"`
	ExitCode     int32       `json:"exit_code"`
	Backend      string      `json:"backend"`
	Conditions   []condition `json:"conditions,omitempty"`
}

type condition struct {
	Type      string `json:"type"`
	Status    string `json:"status"`
	Reason    string `json:"reason,omitempty"`
	Message   string `json:"message,omitempty"`
	Timestamp string `json:"timestamp,omitempty"`
}

func reportPayloadFromProto(request *pb.ReportOTGStatusRequest) reportPayload {
	updates := taskStatusUpdatesFromProto(request)
	return reportPayload{
		Namespace:         request.GetNamespace(),
		Name:              request.GetName(),
		WorkflowUUID:      request.GetWorkflowUuid(),
		GroupUUID:         request.GetGroupUuid(),
		Phase:             request.GetPhase(),
		StatusJSON:        request.GetStatusJson(),
		TaskStatusUpdates: updates,
	}
}

func stableReportPayloadFromProto(request *pb.ReportOTGStatusRequest) stableReportPayload {
	return stableReportPayload{
		Namespace:         request.GetNamespace(),
		Name:              request.GetName(),
		WorkflowUUID:      request.GetWorkflowUuid(),
		GroupUUID:         request.GetGroupUuid(),
		Phase:             request.GetPhase(),
		TaskStatusUpdates: taskStatusUpdatesFromProto(request),
	}
}

func taskStatusUpdatesFromProto(request *pb.ReportOTGStatusRequest) []taskStatusUpdate {
	updates := make([]taskStatusUpdate, 0, len(request.GetTaskStatusUpdates()))
	for _, update := range request.GetTaskStatusUpdates() {
		conditions := make([]condition, 0, len(update.GetConditions()))
		for _, protoCondition := range update.GetConditions() {
			conditions = append(conditions, condition{
				Type:      protoCondition.GetType(),
				Status:    protoCondition.GetStatus(),
				Reason:    protoCondition.GetReason(),
				Message:   protoCondition.GetMessage(),
				Timestamp: protoCondition.GetTimestamp(),
			})
		}
		updates = append(updates, taskStatusUpdate{
			WorkflowUUID: update.GetWorkflowUuid(),
			TaskUUID:     update.GetTaskUuid(),
			RetryID:      update.GetRetryId(),
			Container:    update.GetContainer(),
			Node:         update.GetNode(),
			PodIP:        update.GetPodIp(),
			Message:      update.GetMessage(),
			Status:       update.GetStatus(),
			ExitCode:     update.GetExitCode(),
			Backend:      update.GetBackend(),
			Conditions:   conditions,
		})
	}
	return updates
}
