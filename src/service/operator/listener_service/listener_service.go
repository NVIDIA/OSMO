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

package listener_service

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"

	pb "go.corp.nvidia.com/osmo/proto/operator"
	"go.corp.nvidia.com/osmo/service/operator/utils"
	"go.corp.nvidia.com/osmo/utils/progress_check"
)

const (
	operatorMessagesStream = "{osmo}:{message-queue}:operator_messages"
)

// ListenerService handles workflow listener gRPC streaming operations
type ListenerService struct {
	pb.UnimplementedListenerServiceServer
	logger           *slog.Logger
	redisClient      *redis.Client
	pgPool           *pgxpool.Pool
	serviceHostname  string
	progressWriter   *progress_check.ProgressWriter
	progressInterval time.Duration
}

// NewListenerService creates a new listener service instance
func NewListenerService(
	logger *slog.Logger,
	redisClient *redis.Client,
	pgPool *pgxpool.Pool,
	args *utils.OperatorArgs,
) *ListenerService {
	if logger == nil {
		logger = slog.Default()
	}

	// Construct progress file path
	progressFile := filepath.Join(args.OperatorProgressDir, "last_progress_listener")

	// Initialize progress writer
	progressWriter, err := progress_check.NewProgressWriter(progressFile)
	if err != nil {
		logger.Error("failed to create progress writer",
			slog.String("error", err.Error()),
			slog.String("progress_file", progressFile))
		// Continue without progress writer rather than failing
		progressWriter = nil
	} else {
		logger.Info("progress writer initialized",
			slog.String("progress_file", progressFile))
	}

	return &ListenerService{
		logger:           logger,
		redisClient:      redisClient,
		pgPool:           pgPool,
		serviceHostname:  args.ServiceHostname,
		progressWriter:   progressWriter,
		progressInterval: time.Duration(args.OperatorProgressFrequencySec) * time.Second,
	}
}

// pushMessageToRedis pushes the received message to Redis Stream
func (ls *ListenerService) pushMessageToRedis(
	ctx context.Context,
	msg *pb.ListenerMessage,
	backendName string,
) error {
	// Convert the protobuf message to JSON
	// UseProtoNames ensures field names match the .proto file (snake_case)
	// EmitDefaultValues ensures bool fields with false values are included
	messageJSON, err := protojson.MarshalOptions{
		UseProtoNames:     true,
		EmitDefaultValues: true,
	}.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message to JSON: %w", err)
	}

	// Add message to Redis Stream with backend name
	err = ls.redisClient.XAdd(ctx, &redis.XAddArgs{
		Stream: operatorMessagesStream,
		Values: map[string]interface{}{
			"message": string(messageJSON),
			"backend": backendName,
		},
	}).Err()
	if err != nil {
		return fmt.Errorf(
			"failed to add message to Redis stream %s: %w",
			operatorMessagesStream,
			err,
		)
	}

	return nil
}

// handleListenerStream processes messages from a bidirectional gRPC stream.
// It handles receiving messages, pushing to Redis, sending ACK responses, and reporting progress.
func (ls *ListenerService) handleListenerStream(
	stream pb.ListenerService_ListenerStreamServer,
) error {
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

	ls.logger.InfoContext(ctx, "listener stream opened",
		slog.String("backend_name", backendName))
	defer ls.logger.InfoContext(ctx, "listener stream closed",
		slog.String("backend_name", backendName))

	lastProgressReport := time.Now()

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

		// Push message to Redis Stream before sending ACK
		if err := ls.pushMessageToRedis(ctx, msg, backendName); err != nil {
			ls.logger.ErrorContext(ctx, "failed to push message to Redis stream",
				slog.String("error", err.Error()),
				slog.String("uuid", msg.Uuid))
			return err
		}

		// Send ACK response
		ack := &pb.AckMessage{
			AckUuid: msg.Uuid, // Acknowledge the received message UUID
		}

		if err := stream.Send(ack); err != nil {
			ls.logger.ErrorContext(ctx, "failed to send ACK", slog.String("error", err.Error()))
			return err
		}

		// Report progress after successfully processing message
		now := time.Now()
		if ls.progressWriter != nil && now.Sub(lastProgressReport) >= ls.progressInterval {
			if err := ls.progressWriter.ReportProgress(); err != nil {
				ls.logger.WarnContext(ctx, "failed to report progress",
					slog.String("error", err.Error()))
			}
			lastProgressReport = now
		}
	}
}

// ListenerStream handles bidirectional streaming for backend communication.
// It receives all types of messages (update_pod, logging, resource, resource_usage) and sends ACK responses.
func (ls *ListenerService) ListenerStream(
	stream pb.ListenerService_ListenerStreamServer) error {
	return ls.handleListenerStream(stream)
}

// InitBackend handles backend initialization requests
func (ls *ListenerService) InitBackend(
	ctx context.Context,
	req *pb.InitBackendRequest,
) (*pb.InitBackendResponse, error) {
	initBody := req.GetInitBody()
	if initBody == nil {
		ls.logger.ErrorContext(ctx, "init body is missing")
		return &pb.InitBackendResponse{
			Success: false,
			Message: "init body is required",
		}, nil
	}

	backendName := initBody.Name
	if backendName == "" {
		ls.logger.ErrorContext(ctx, "backend name is missing in init body")
		return &pb.InitBackendResponse{
			Success: false,
			Message: "backend name is required",
		}, nil
	}

	// Store backend initialization information in postgres database
	err := utils.CreateOrUpdateBackend(ctx, ls.pgPool, initBody, ls.serviceHostname)
	if err != nil {
		ls.logger.ErrorContext(ctx, "failed to initialize backend",
			slog.String("backend_name", backendName),
			slog.String("error", err.Error()))
		return &pb.InitBackendResponse{
			Success: false,
			Message: fmt.Sprintf("failed to initialize backend: %s", err.Error()),
		}, nil
	}

	ls.logger.InfoContext(ctx, "backend initialized successfully",
		slog.String("backend_name", backendName),
		slog.String("k8s_uid", initBody.K8SUid))

	// Report progress after successful backend initialization
	if ls.progressWriter != nil {
		if err := ls.progressWriter.ReportProgress(); err != nil {
			ls.logger.WarnContext(ctx, "failed to report progress",
				slog.String("error", err.Error()))
		}
	}

	return &pb.InitBackendResponse{
		Success: true,
		Message: "backend initialized successfully",
	}, nil
}

// RegisterServices registers the listener service with the gRPC server.
func RegisterServices(grpcServer *grpc.Server, service *ListenerService) {
	pb.RegisterListenerServiceServer(grpcServer, service)
	service.logger.Info("listener service registered")
}
