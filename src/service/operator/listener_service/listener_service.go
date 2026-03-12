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
	"encoding/json"
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
	backoff "go.corp.nvidia.com/osmo/utils"
	"go.corp.nvidia.com/osmo/utils/progress_check"
)

const (
	operatorMessagesStream = "{osmo}:{message-queue}:operator_messages"
	redisBlockTimeout      = 5 * time.Second
)

// ListenerService handles workflow listener gRPC streaming operations
type ListenerService struct {
	pb.UnimplementedListenerServiceServer
	logger            *slog.Logger
	redisClient       *redis.Client
	pgPool            *pgxpool.Pool
	serviceHostname   string
	progressWriter    *progress_check.ProgressWriter
	progressInterval  time.Duration
	heartbeatInterval time.Duration
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
		logger:            logger,
		redisClient:       redisClient,
		pgPool:            pgPool,
		serviceHostname:   args.ServiceHostname,
		progressWriter:    progressWriter,
		progressInterval:  time.Duration(args.OperatorProgressFrequencySec) * time.Second,
		heartbeatInterval: time.Duration(args.HeartbeatIntervalSec) * time.Second,
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

// SendListenerMessage handles a single unary listener message and returns an ACK.
func (ls *ListenerService) SendListenerMessage(
	ctx context.Context,
	msg *pb.ListenerMessage,
) (*pb.AckMessage, error) {
	backendName, err := utils.ExtractBackendName(ctx)
	if err != nil {
		ls.logger.ErrorContext(ctx, "failed to extract backend name",
			slog.String("error", err.Error()))
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}

	if err := ls.pushMessageToRedis(ctx, msg, backendName); err != nil {
		ls.logger.ErrorContext(ctx, "failed to push message to Redis stream",
			slog.String("error", err.Error()),
			slog.String("uuid", msg.Uuid),
			slog.String("backend_name", backendName))
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &pb.AckMessage{AckUuid: msg.Uuid}, nil
}

// NodeConditionStream sends initial node conditions from the DB, then streams updates.
// It drains incoming heartbeats from the client to keep the bidirectional stream alive.
func (ls *ListenerService) NodeConditionStream(
	stream pb.ListenerService_NodeConditionStreamServer,
) error {
	ctx := stream.Context()

	backendName, err := utils.ExtractBackendName(ctx)
	if err != nil {
		ls.logger.ErrorContext(ctx, "node condition stream: missing backend name",
			slog.String("error", err.Error()))
		return status.Error(codes.InvalidArgument, err.Error())
	}

	ls.logger.InfoContext(ctx, "opening node condition stream for backend",
		slog.String("backend_name", backendName))
	defer ls.logger.InfoContext(ctx, "closing node condition stream for backend",
		slog.String("backend_name", backendName))

	// Send initial node conditions from DB
	rules, err := utils.FetchBackendNodeConditions(ctx, ls.pgPool, backendName)
	if err != nil {
		ls.logger.ErrorContext(ctx, "failed to fetch backend node conditions",
			slog.String("backend_name", backendName),
			slog.String("error", err.Error()))
		return status.Error(codes.Internal, err.Error())
	}

	if err := stream.Send(&pb.NodeConditionStreamResponse{
		Response: &pb.NodeConditionStreamResponse_NodeConditions{
			NodeConditions: &pb.NodeConditionsMessage{Rules: rules},
		},
	}); err != nil {
		return err
	}
	ls.logger.InfoContext(ctx, "sent initial node conditions to backend",
		slog.String("backend_name", backendName))

	// Drain incoming heartbeats and update last_heartbeat in the DB on each receipt.
	go func() {
		for {
			msg, err := stream.Recv()
			if err != nil {
				ls.logger.InfoContext(ctx, "heartbeat Recv ended",
					slog.String("backend_name", backendName),
					slog.String("error", err.Error()))
				return
			}
			ls.logger.DebugContext(ctx, "received heartbeat",
				slog.String("backend_name", backendName),
				slog.String("time", msg.Time))
			heartbeatTime, err := time.Parse(time.RFC3339, msg.Time)
			if err != nil {
				ls.logger.WarnContext(ctx, "failed to parse heartbeat time, skipping DB update",
					slog.String("backend_name", backendName),
					slog.String("time", msg.Time),
					slog.String("error", err.Error()))
				continue
			}
			if err := utils.UpdateBackendLastHeartbeat(
				ctx, ls.pgPool, backendName, heartbeatTime); err != nil {
				ls.logger.WarnContext(ctx, "failed to update backend last heartbeat",
					slog.String("backend_name", backendName),
					slog.String("error", err.Error()))
			}
		}
	}()

	queueName := utils.BackendActionQueueName(backendName)
	retryCount := 0
	lastHeartbeat := time.Now()

	for {
		result, err := ls.redisClient.BLPop(ctx, redisBlockTimeout, queueName).Result()
		if err == nil && len(result) == 2 {
			retryCount = 0
			payload := result[1]

			ls.logger.InfoContext(ctx, "sending node conditions to backend from queue",
				slog.String("backend_name", backendName),
				slog.String("queue", queueName),
				slog.String("payload", payload))

			var parsed struct {
				Rules map[string]string `json:"rules"`
			}
			if err := json.Unmarshal([]byte(payload), &parsed); err != nil {
				ls.logger.WarnContext(ctx, "failed to parse queue payload, skipping",
					slog.String("backend_name", backendName),
					slog.String("error", err.Error()))
				continue
			}
			if parsed.Rules == nil {
				parsed.Rules = make(map[string]string)
			}

			if err := stream.Send(&pb.NodeConditionStreamResponse{
				Response: &pb.NodeConditionStreamResponse_NodeConditions{
					NodeConditions: &pb.NodeConditionsMessage{Rules: parsed.Rules},
				},
			}); err != nil {
				return err
			}
		} else {
			if ctx.Err() != nil {
				return nil
			}
			if err != redis.Nil {
				retryCount++
				backoffDur := backoff.CalculateBackoff(retryCount, 30*time.Second)
				ls.logger.ErrorContext(ctx, "redis BLPop error, retrying with backoff",
					slog.String("backend_name", backendName),
					slog.String("queue", queueName),
					slog.String("error", err.Error()),
					slog.Duration("backoff", backoffDur))
				time.Sleep(backoffDur)
				continue
			}
			retryCount = 0
		}

		// Send heartbeat if enough time has elapsed since the last one.
		if time.Since(lastHeartbeat) >= ls.heartbeatInterval {
			if err := stream.Send(&pb.NodeConditionStreamResponse{
				Response: &pb.NodeConditionStreamResponse_Heartbeat{
					Heartbeat: &pb.HeartbeatMessage{
						Time: time.Now().UTC().Format(time.RFC3339),
					},
				},
			}); err != nil {
				return err
			}
			lastHeartbeat = time.Now()
		}
	}
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
	isCreate, isUpdate, err := utils.CreateOrUpdateBackend(
		ctx, ls.pgPool, initBody, ls.serviceHostname)
	if err != nil {
		ls.logger.ErrorContext(ctx, "failed to initialize backend",
			slog.String("backend_name", backendName),
			slog.String("error", err.Error()))
		return &pb.InitBackendResponse{
			Success: false,
			Message: fmt.Sprintf("failed to initialize backend: %s", err.Error()),
		}, nil
	}

	// TODO: This should be built-in instead of pushing to Redis
	// Push backend operation notification to Redis for agent_worker to process in Python
	// This triggers update_backend_queues (if create) or create_backend_config_history_entry
	if isCreate || isUpdate {
		operation := "update"
		if isCreate {
			operation = "create"
		}

		// Create a simple protobuf message for backend operation notification
		// Using LoggingBody with a special format that agent can parse
		msg := &pb.ListenerMessage{
			Uuid:      fmt.Sprintf("backend-op-%s-%d", backendName, time.Now().UnixNano()),
			Timestamp: time.Now().Format(time.RFC3339),
			Body: &pb.ListenerMessage_Logging{
				Logging: &pb.LoggingBody{
					Type: pb.LoggingType_INFO,
					Text: fmt.Sprintf("__BACKEND_OP__:%s", operation),
				},
			},
		}

		// Push using the existing function
		if err := ls.pushMessageToRedis(ctx, msg, backendName); err != nil {
			return &pb.InitBackendResponse{
				Success: false,
				Message: fmt.Sprintf("failed to push backend operation notification: %s", err.Error()),
			}, nil
		}
	}

	ls.logger.InfoContext(ctx, "backend initialized successfully",
		slog.String("backend_name", backendName),
		slog.Bool("is_create", isCreate),
		slog.Bool("is_update", isUpdate),
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
