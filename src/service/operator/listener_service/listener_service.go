/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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

package listener_service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"

	pb "go.corp.nvidia.com/osmo/proto/operator"
	"go.corp.nvidia.com/osmo/service/operator/utils"
)

const (
	operatorMessagesStream = "{osmo}:{message-queue}:operator_messages"
)

// ListenerService handles workflow listener gRPC streaming operations
type ListenerService struct {
	pb.UnimplementedListenerServiceServer
	logger      *slog.Logger
	redisClient *redis.Client
}

// NewListenerService creates a new listener service instance
func NewListenerService(
	logger *slog.Logger,
	redisClient *redis.Client,
) *ListenerService {
	if logger == nil {
		logger = slog.Default()
	}
	return &ListenerService{
		logger:      logger,
		redisClient: redisClient,
	}
}

// pushMessageToRedis pushes the received message to Redis Stream
func (ls *ListenerService) pushMessageToRedis(
	ctx context.Context,
	msg *pb.ListenerMessage,
) error {
	// Convert the protobuf message to JSON
	messageJSON, err := protojson.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message to JSON: %w", err)
	}

	// Add message to Redis Stream
	err = ls.redisClient.XAdd(ctx, &redis.XAddArgs{
		Stream: operatorMessagesStream,
		Values: map[string]interface{}{
			"message": string(messageJSON),
		},
	}).Err()
	if err != nil {
		return fmt.Errorf(
			"failed to add message to Redis stream %s: %w",
			operatorMessagesStream,
			err,
		)
	}

	ls.logger.InfoContext(ctx, "pushed message to Redis stream",
		slog.String("stream", operatorMessagesStream),
		slog.String("uuid", msg.Uuid))

	return nil
}

// WorkflowListenerStream handles bidirectional streaming for workflow backend communication
//
// Protocol flow:
// 1. Backend connects and sends backend-name via gRPC metadata (required)
// 2. Server receives messages and sends ACK responses
// 3. Continues until stream is closed
func (ls *ListenerService) WorkflowListenerStream(
	stream pb.ListenerService_WorkflowListenerStreamServer) error {
	ctx := stream.Context()

	// Extract backend name from gRPC metadata (required)
	backendName, err := utils.ExtractBackendName(ctx)
	if err != nil {
		ls.logger.ErrorContext(
			ctx,
			"failed to extract backend name",
			slog.String("error", err.Error()),
		)
		return status.Error(codes.InvalidArgument, err.Error())
	}

	ls.logger.InfoContext(ctx, "workflow listener stream opened",
		slog.String("backend_name", backendName))
	defer ls.logger.InfoContext(ctx, "workflow listener stream closed",
		slog.String("backend_name", backendName))

	// Handle bidirectional streaming
	for {
		// Receive message from backend
		msg, err := stream.Recv()
		if err != nil {
			if utils.IsExpectedClose(err) {
				return nil
			}
			ls.logger.ErrorContext(
				ctx, "failed to receive message", slog.String("error", err.Error()))
			return err
		}

		// Calculate latency from message timestamp
		var latencyMs float64
		if msgTime, err := time.Parse(time.RFC3339Nano, msg.Timestamp); err == nil {
			latencyMs = float64(time.Since(msgTime).Microseconds()) / 1000.0
		}

		ls.logger.InfoContext(ctx, "received message",
			slog.String("backend_name", backendName),
			slog.String("type", msg.Type.String()),
			slog.String("uuid", msg.Uuid),
			slog.Float64("latency_ms", latencyMs),
			slog.String("timestamp", msg.Timestamp))

		// Push message to Redis Stream before sending ACK
		if err := ls.pushMessageToRedis(ctx, msg); err != nil {
			ls.logger.ErrorContext(ctx, "failed to push message to Redis stream",
				slog.String("error", err.Error()),
				slog.String("uuid", msg.Uuid))
			return err
		}

		// Send ACK response
		ack := &pb.ListenerMessage{
			Type:      pb.ListenerMessage_ack,
			Uuid:      msg.Uuid,      // ACK uses the same UUID as the original message
			Timestamp: msg.Timestamp, // Echo back the original timestamp
			Body:      "",            // ACK doesn't need body
		}

		if err := stream.Send(ack); err != nil {
			ls.logger.ErrorContext(ctx, "failed to send ACK", slog.String("error", err.Error()))
			return err
		}

		ls.logger.InfoContext(ctx, "sent ACK", slog.String("for_uuid", msg.Uuid))
	}
}

// RegisterServices registers the listener service with the gRPC server.
func RegisterServices(grpcServer *grpc.Server, service *ListenerService) {
	pb.RegisterListenerServiceServer(grpcServer, service)
	service.logger.Info("listener service registered")
}
