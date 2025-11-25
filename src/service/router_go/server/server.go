/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

package server

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"time"

	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "go.corp.nvidia.com/osmo/proto/router"
)

// RouterServer implements the router gRPC services
type RouterServer struct {
	store  *SessionStore
	logger *slog.Logger
	pb.UnimplementedRouterClientServiceServer
	pb.UnimplementedRouterAgentServiceServer
	pb.UnimplementedRouterControlServiceServer
}

// NewRouterServer creates a new router server
func NewRouterServer(store *SessionStore, logger *slog.Logger) *RouterServer {
	if logger == nil {
		logger = slog.Default()
	}
	return &RouterServer{
		store:  store,
		logger: logger,
	}
}

// RegisterRouterServices registers all router services with the gRPC server
func RegisterRouterServices(s *grpc.Server, rs *RouterServer) {
	pb.RegisterRouterClientServiceServer(s, rs)
	pb.RegisterRouterAgentServiceServer(s, rs)
	pb.RegisterRouterControlServiceServer(s, rs)
}

// Tunnel handles the unified bidirectional stream for all operations (Exec, PortForward, Rsync)
func (rs *RouterServer) Tunnel(stream pb.RouterClientService_TunnelServer) error {
	ctx := stream.Context()

	req, err := stream.Recv()
	if err != nil {
		return status.Error(codes.InvalidArgument, "failed to receive init message")
	}

	init := req.GetInit()
	if init == nil {
		return status.Error(codes.InvalidArgument, "first message must be init")
	}

	operationType := deriveOperationLabel(init.Operation, init.Protocol)
	logger := rs.sessionLogger(init.SessionKey, operationType)

	logger.InfoContext(ctx, "client tunnel started",
		slog.String("workflow_id", init.WorkflowId),
		slog.String("cookie", init.Cookie),
	)

	// Create or get session
	session, existed, err := rs.store.CreateSession(init.SessionKey, init.Cookie, init.WorkflowId, operationType)
	if err != nil {
		return err
	}

	// Note: existed can be true if agent connected first - this is OK
	// The rendezvous mechanism ensures proper coordination
	_ = existed

	defer rs.store.DeleteSession(init.SessionKey)

	// Wait for agent to connect
	if err := rs.store.WaitForRendezvous(ctx, session, true); err != nil {
		logger.ErrorContext(ctx, "client tunnel rendezvous failed",
			slog.String("error", err.Error()),
		)
		return err
	}

	logger.InfoContext(ctx, "client tunnel rendezvous successful")

	// Start bidirectional streaming (direct to session channels)
	// Use errgroup.WithContext to get cancellable context that stops all goroutines
	// when any one completes or errors
	g, gctx := errgroup.WithContext(ctx)

	flowTimeout := rs.store.config.FlowControlTimeout

	g.Go(func() error {
		defer session.ClientToAgent.CloseWriter()

		return pumpStreamToPipe(streamPumpConfig{
			ctx:       gctx,
			pipe:      session.ClientToAgent,
			timeout:   flowTimeout,
			logger:    logger,
			direction: "client->agent",
			recv: func() ([]byte, *pb.TunnelClose, error) {
				req, err := stream.Recv()
				if err != nil {
					return nil, nil, err
				}
				switch msg := req.Message.(type) {
				case *pb.TunnelRequest_Data:
					if msg.Data == nil || msg.Data.Payload == nil {
						return []byte{}, nil, nil
					}
					return msg.Data.Payload, nil, nil
				case *pb.TunnelRequest_Close:
					logger.DebugContext(gctx, "client sent close message")
					return nil, msg.Close, nil
				default:
					return nil, nil, nil
				}
			},
		})
	})

	g.Go(func() error {
		return drainPipeToStream(pipeDrainConfig{
			ctx:       gctx,
			pipe:      session.AgentToClient,
			logger:    logger,
			direction: "agent->client",
			sendData: func(payload []byte) error {
				resp := &pb.TunnelResponse{
					Message: &pb.TunnelResponse_Data{
						Data: &pb.TunnelData{Payload: payload},
					},
				}
				return stream.Send(resp)
			},
			sendClose: func(closeInfo *pb.TunnelClose) error {
				resp := &pb.TunnelResponse{
					Message: &pb.TunnelResponse_Close{Close: closeInfo},
				}
				if err := stream.Send(resp); err != nil {
					logger.WarnContext(gctx, "failed to send final close to client",
						slog.String("error", err.Error()),
					)
				}
				return nil
			},
		})
	})

	// Wait for both goroutines to complete
	if err := g.Wait(); err != nil && err != io.EOF {
		logger.ErrorContext(ctx, "client tunnel stream error",
			slog.String("error", err.Error()),
			slog.String("code", codeToString(status.Code(err))),
		)
		return err
	}

	return nil
}

// RegisterTunnel handles the unified agent registration for all operations
func (rs *RouterServer) RegisterTunnel(stream pb.RouterAgentService_RegisterTunnelServer) error {
	ctx := stream.Context()

	// Receive init message from agent
	resp, err := stream.Recv()
	if err != nil {
		return status.Error(codes.InvalidArgument, "failed to receive init message from agent")
	}

	init := resp.GetInit()
	if init == nil {
		return status.Error(codes.InvalidArgument, "first message from agent must be init")
	}

	operationType := deriveOperationLabel(init.Operation, init.Protocol)
	logger := rs.sessionLogger(init.SessionKey, operationType)

	logger.InfoContext(ctx, "agent tunnel registration started",
		slog.String("workflow_id", init.WorkflowId),
	)

	// Create or get session
	session, _, err := rs.store.CreateSession(init.SessionKey, init.Cookie, init.WorkflowId, operationType)
	if err != nil {
		return err
	}

	// Note: We don't check 'existed' here because rendezvous works regardless of who creates the session first

	defer rs.store.DeleteSession(init.SessionKey)

	// Wait for client to connect
	if err := rs.store.WaitForRendezvous(ctx, session, false); err != nil {
		logger.ErrorContext(ctx, "agent tunnel rendezvous failed",
			slog.String("error", err.Error()),
		)
		return err
	}

	logger.InfoContext(ctx, "agent tunnel rendezvous successful")

	flowTimeout := rs.store.config.FlowControlTimeout

	// Start bidirectional streaming (direct to session channels)
	// Use errgroup.WithContext to get cancellable context that stops all goroutines
	// when any one completes or errors
	g, gctx := errgroup.WithContext(ctx)

	g.Go(func() error {
		defer session.AgentToClient.CloseWriter()

		return pumpStreamToPipe(streamPumpConfig{
			ctx:       gctx,
			pipe:      session.AgentToClient,
			timeout:   flowTimeout,
			logger:    logger,
			direction: "agent->client",
			recv: func() ([]byte, *pb.TunnelClose, error) {
				resp, err := stream.Recv()
				if err != nil {
					return nil, nil, err
				}
				switch msg := resp.Message.(type) {
				case *pb.TunnelResponse_Data:
					if msg.Data == nil || msg.Data.Payload == nil {
						return []byte{}, nil, nil
					}
					return msg.Data.Payload, nil, nil
				case *pb.TunnelResponse_Close:
					logger.DebugContext(gctx, "agent sent close message")
					return nil, msg.Close, nil
				default:
					return nil, nil, nil
				}
			},
		})
	})

	g.Go(func() error {
		return drainPipeToStream(pipeDrainConfig{
			ctx:       gctx,
			pipe:      session.ClientToAgent,
			logger:    logger,
			direction: "client->agent",
			sendData: func(payload []byte) error {
				req := &pb.TunnelRequest{
					Message: &pb.TunnelRequest_Data{
						Data: &pb.TunnelData{Payload: payload},
					},
				}
				return stream.Send(req)
			},
			sendClose: func(closeInfo *pb.TunnelClose) error {
				req := &pb.TunnelRequest{
					Message: &pb.TunnelRequest_Close{Close: closeInfo},
				}
				if err := stream.Send(req); err != nil {
					logger.WarnContext(gctx, "failed to send final close to agent",
						slog.String("error", err.Error()),
					)
				}
				return nil
			},
			onPipeClosed: func() error {
				closeMsg := &pb.TunnelRequest{
					Message: &pb.TunnelRequest_Close{Close: &pb.TunnelClose{}},
				}
				if err := stream.Send(closeMsg); err != nil {
					logger.WarnContext(gctx, "failed to send close message to agent",
						slog.String("error", err.Error()),
					)
				}
				return nil
			},
		})
	})

	// Wait for both goroutines to complete
	if err := g.Wait(); err != nil && err != io.EOF {
		logger.ErrorContext(ctx, "agent tunnel stream error",
			slog.String("error", err.Error()),
			slog.String("code", codeToString(status.Code(err))),
		)
		return err
	}

	return nil
}

// Helper functions

func (rs *RouterServer) sessionLogger(sessionKey, operation string) *slog.Logger {
	return rs.logger.With(
		slog.String("session_key", sessionKey),
		slog.String("operation", operation),
	)
}

func deriveOperationLabel(op pb.OperationType, protocol pb.Protocol) string {
	if op != pb.OperationType_OPERATION_PORT_FORWARD {
		return operationTypeToString(op)
	}
	if protocol == pb.Protocol_PROTOCOL_UDP {
		return "portforward_udp"
	}
	return "portforward_tcp"
}

type streamPumpConfig struct {
	ctx       context.Context
	recv      func() ([]byte, *pb.TunnelClose, error)
	pipe      *SessionPipe
	timeout   time.Duration
	logger    *slog.Logger
	direction string
}

func pumpStreamToPipe(cfg streamPumpConfig) error {
	for {
		payload, closeInfo, err := cfg.recv()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			cfg.logger.ErrorContext(cfg.ctx, "stream receive error",
				slog.String("direction", cfg.direction),
				slog.String("error", err.Error()),
			)
			return err
		}

		if closeInfo != nil {
			if !cfg.pipe.TrySend(&SessionMessage{Close: closeInfo}) {
				cfg.logger.DebugContext(cfg.ctx, "dropping close message; pipe full",
					slog.String("direction", cfg.direction),
				)
			}
			return nil
		}

		if payload == nil {
			continue
		}

		if err := cfg.pipe.Send(cfg.ctx, cfg.timeout, &SessionMessage{Data: payload}); err != nil {
			if isContextErr(err) {
				return nil
			}
			cfg.logger.ErrorContext(cfg.ctx, "pipe send error",
				slog.String("direction", cfg.direction),
				slog.String("error", err.Error()),
			)
			return err
		}
	}
}

type pipeDrainConfig struct {
	ctx          context.Context
	pipe         *SessionPipe
	sendData     func([]byte) error
	sendClose    func(*pb.TunnelClose) error
	onPipeClosed func() error
	logger       *slog.Logger
	direction    string
}

func drainPipeToStream(cfg pipeDrainConfig) error {
	for {
		msg, err := cfg.pipe.Receive(cfg.ctx)
		if err != nil {
			if isContextErr(err) {
				return nil
			}
			if errors.Is(err, errPipeClosed) {
				if cfg.onPipeClosed != nil {
					return cfg.onPipeClosed()
				}
				return nil
			}
			cfg.logger.ErrorContext(cfg.ctx, "pipe receive error",
				slog.String("direction", cfg.direction),
				slog.String("error", err.Error()),
			)
			return err
		}

		if msg.Close != nil {
			return cfg.sendClose(msg.Close)
		}

		if err := cfg.sendData(msg.Data); err != nil {
			cfg.logger.ErrorContext(cfg.ctx, "stream send error",
				slog.String("direction", cfg.direction),
				slog.String("error", err.Error()),
			)
			return err
		}
	}
}

func isContextErr(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

func codeToString(code codes.Code) string {
	return code.String()
}

func stringToOperationType(s string) pb.OperationType {
	switch s {
	case "exec":
		return pb.OperationType_OPERATION_EXEC
	case "portforward_tcp", "portforward_udp":
		return pb.OperationType_OPERATION_PORT_FORWARD
	case "rsync":
		return pb.OperationType_OPERATION_RSYNC
	default:
		return pb.OperationType_OPERATION_UNSPECIFIED
	}
}

func operationTypeToString(op pb.OperationType) string {
	switch op {
	case pb.OperationType_OPERATION_EXEC:
		return "exec"
	case pb.OperationType_OPERATION_PORT_FORWARD:
		return "portforward" // Will be refined by protocol later
	case pb.OperationType_OPERATION_RSYNC:
		return "rsync"
	default:
		return "unknown"
	}
}

// GetSessionInfo retrieves information about an active session.
// Returns session details or an error if the session is not found.
func (rs *RouterServer) GetSessionInfo(ctx context.Context, req *pb.SessionInfoRequest) (resp *pb.SessionInfoResponse, err error) {
	session, err := rs.store.GetSession(req.SessionKey)
	if err != nil {
		return nil, err
	}

	return &pb.SessionInfoResponse{
		Active:        true,
		WorkflowId:    session.WorkflowID,
		CreatedAt:     session.CreatedAt.Unix(),
		OperationType: stringToOperationType(session.OperationType),
	}, nil
}
