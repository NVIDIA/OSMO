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

package config_service

import (
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "go.corp.nvidia.com/osmo/proto/operator"
	"go.corp.nvidia.com/osmo/service/operator/utils"
	backoff "go.corp.nvidia.com/osmo/utils"
)

const redisBlockTimeout = 5 * time.Second

// ConfigService streams node conditions to workflow backends (DB + Redis queue).
type ConfigService struct {
	pb.UnimplementedConfigServiceServer
	logger *slog.Logger
	redis  *redis.Client
	pgPool *pgxpool.Pool
}

// NewConfigService creates a new config service instance.
func NewConfigService(
	logger *slog.Logger,
	redisClient *redis.Client,
	pgPool *pgxpool.Pool,
) *ConfigService {
	if logger == nil {
		logger = slog.Default()
	}
	return &ConfigService{
		logger: logger,
		redis:  redisClient,
		pgPool: pgPool,
	}
}

// NodeConditionStream sends initial node conditions from the DB, then streams updates
func (cs *ConfigService) NodeConditionStream(
	req *pb.NodeConditionStreamRequest,
	stream pb.ConfigService_NodeConditionStreamServer,
) error {
	_ = req
	ctx := stream.Context()

	backendName, err := utils.ExtractBackendName(ctx)
	if err != nil {
		cs.logger.ErrorContext(ctx, "node condition stream: missing backend name",
			slog.String("error", err.Error()))
		return status.Error(codes.InvalidArgument, err.Error())
	}

	cs.logger.InfoContext(ctx, "opening node condition stream for backend",
		slog.String("backend_name", backendName))
	defer cs.logger.InfoContext(ctx, "closing node condition stream for backend",
		slog.String("backend_name", backendName))

	// Send initial node conditions from DB
	rules, err := utils.FetchBackendNodeConditions(ctx, cs.pgPool, backendName)
	if err != nil {
		cs.logger.ErrorContext(ctx, "failed to fetch backend node conditions",
			slog.String("backend_name", backendName),
			slog.String("error", err.Error()))
		return status.Error(codes.Internal, err.Error())
	}

	if err := stream.Send(&pb.NodeConditionsMessage{Rules: rules}); err != nil {
		return err
	}
	cs.logger.InfoContext(ctx, "sent initial node conditions to backend",
		slog.String("backend_name", backendName))

	queueName := utils.BackendActionQueueName(backendName)
	retryCount := 0

	for {
		result, err := cs.redis.BLPop(ctx, redisBlockTimeout, queueName).Result()
		if err == nil && len(result) == 2 {
			retryCount = 0
			payload := result[1]

			cs.logger.InfoContext(ctx, "sending node conditions to backend from queue",
				slog.String("backend_name", backendName),
				slog.String("queue", queueName),
				slog.String("payload", payload))

			var parsed struct {
				Rules map[string]string `json:"rules"`
			}
			if err := json.Unmarshal([]byte(payload), &parsed); err != nil {
				cs.logger.WarnContext(ctx, "failed to parse queue payload, skipping",
					slog.String("backend_name", backendName),
					slog.String("error", err.Error()))
				continue
			}
			if parsed.Rules == nil {
				parsed.Rules = make(map[string]string)
			}

			if err := stream.Send(&pb.NodeConditionsMessage{Rules: parsed.Rules}); err != nil {
				return err
			}
		} else {
			if ctx.Err() != nil {
				return nil
			}
			backoffDur := redisBlockTimeout
			if err != redis.Nil {
				retryCount++
				backoffDur = backoff.CalculateBackoff(retryCount, 30*time.Second)
				cs.logger.ErrorContext(ctx, "redis BLPop error, retrying with backoff",
					slog.String("backend_name", backendName),
					slog.String("queue", queueName),
					slog.String("error", err.Error()),
					slog.Duration("backoff", backoffDur))
			}
			time.Sleep(backoffDur)
			continue
		}
	}
}

// RegisterServices registers the config service with the gRPC server.
func RegisterServices(grpcServer *grpc.Server, service *ConfigService) {
	pb.RegisterConfigServiceServer(grpcServer, service)
	service.logger.Info("config service registered")
}
