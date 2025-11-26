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
	"fmt"
	"io"
	"log/slog"
	"time"

	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "go.corp.nvidia.com/osmo/proto/router"
)

// RouterServer implements all router gRPC services.
type RouterServer struct {
	store  *SessionStore
	logger *slog.Logger
	pb.UnimplementedRouterClientServiceServer
	pb.UnimplementedRouterAgentServiceServer
	pb.UnimplementedRouterControlServiceServer
}

// NewRouterServer creates a new router server.
func NewRouterServer(store *SessionStore, logger *slog.Logger) *RouterServer {
	if logger == nil {
		logger = slog.Default()
	}
	return &RouterServer{store: store, logger: logger}
}

// Router Data Flow:
//                            ROUTER
//                     ┌─────────────────────────────────────┐
//                     │                                     │
//   CLIENT            │      ClientToAgent                  │          AGENT
//  ┌──────┐           │    ════════════════►                │         ┌──────┐
//  │      │ ── recv ──┼--──► outPipe ════════════════►  ────┼── send ─│      │
//  │      │           │                                     │         │      │
//  │      │ ◄─ send ──┼─--─◄ inPipe  ◄════════════════  ◄───┼── recv ─│      │
//  └──────┘           │    ◄════════════════                │         └──────┘
//                     │      AgentToClient                  │
//                     └─────────────────────────────────────┘

// tunnelConfig holds role-specific tunnel configuration.
type tunnelConfig struct {
	role       string
	rendezvous func(s *Session, ctx context.Context, timeout time.Duration) error
	outPipe    func(s *Session) *Pipe // this party → other party
	inPipe     func(s *Session) *Pipe // other party → this party
}

var (
	clientConfig = tunnelConfig{
		role:       "client",
		rendezvous: (*Session).WaitForAgent,
		outPipe:    (*Session).ClientToAgent,
		inPipe:     (*Session).AgentToClient,
	}
	agentConfig = tunnelConfig{
		role:       "agent",
		rendezvous: (*Session).WaitForClient,
		outPipe:    (*Session).AgentToClient,
		inPipe:     (*Session).ClientToAgent,
	}
)

// tunnelClientToAgent handles client tunnel connections.
func (rs *RouterServer) tunnelClientToAgent(
	ctx context.Context,
	recv func() (*pb.TunnelMessage, error),
	send func(*pb.TunnelMessage) error,
) error {
	return rs.tunnelHandler(ctx, recv, send, &clientConfig)
}

// tunnelAgentToClient handles agent tunnel connections.
func (rs *RouterServer) tunnelAgentToClient(
	ctx context.Context,
	recv func() (*pb.TunnelMessage, error),
	send func(*pb.TunnelMessage) error,
) error {
	return rs.tunnelHandler(ctx, recv, send, &agentConfig)
}

// tunnelHandler is the common implementation for tunnel handling.
func (rs *RouterServer) tunnelHandler(
	ctx context.Context,
	recv func() (*pb.TunnelMessage, error),
	send func(*pb.TunnelMessage) error,
	cfg *tunnelConfig,
) error {
	// Receive init message
	msg, err := recv()
	if err != nil {
		return status.Error(codes.InvalidArgument, "failed to receive init message")
	}

	init := msg.GetInit()
	if init == nil {
		return status.Error(codes.InvalidArgument, "first message must be init")
	}

	if err := validateTunnelInit(init); err != nil {
		return err
	}

	opType := operationTypeFromInit(init)
	logger := rs.logger.With(
		slog.String("session_key", init.SessionKey),
		slog.String("operation", opType),
		slog.String("role", cfg.role),
	)

	logger.InfoContext(ctx, cfg.role+" tunnel started",
		slog.String("workflow_id", init.WorkflowId),
	)

	// Get or create session
	session, _, err := rs.store.GetOrCreateSession(
		init.SessionKey,
		init.Cookie,
		init.WorkflowId,
		opType,
	)
	if err != nil {
		return err
	}

	defer rs.store.ReleaseSession(init.SessionKey)

	// Wait for the other party
	if err := cfg.rendezvous(session, ctx, rs.store.RendezvousTimeout()); err != nil {
		logger.ErrorContext(ctx, "rendezvous failed", slog.String("error", err.Error()))
		return err
	}

	logger.InfoContext(ctx, "rendezvous successful")

	// Get pipes for this role
	outPipe, inPipe := cfg.outPipe(session), cfg.inPipe(session)

	// Bidirectional streaming
	g, gctx := errgroup.WithContext(ctx)

	// Stream → Pipe (this party's data out)
	g.Go(func() error {
		defer outPipe.Close()
		return rs.forward(gctx, recv, outPipe.Sender(gctx), logger)
	})

	// Pipe → Stream (other party's data in)
	g.Go(func() error {
		return rs.forward(gctx, inPipe.Receiver(gctx), send, logger)
	})

	if err := g.Wait(); err != nil && !isExpectedClose(err) {
		logger.ErrorContext(ctx, "tunnel error", slog.String("error", err.Error()))
		return err
	}

	logger.InfoContext(ctx, "tunnel closed")
	return nil
}

// Tunnel handles client connections (implements RouterClientService).
func (rs *RouterServer) Tunnel(stream pb.RouterClientService_TunnelServer) error {
	return rs.tunnelClientToAgent(stream.Context(), stream.Recv, stream.Send)
}

// RouterAgentServer wraps RouterServer to implement RouterAgentService.Tunnel.
// Required because both services have a method named "Tunnel" with different stream types.
type RouterAgentServer struct {
	*RouterServer
	pb.UnimplementedRouterAgentServiceServer
}

// Tunnel handles agent connections (implements RouterAgentService).
func (ras *RouterAgentServer) Tunnel(stream pb.RouterAgentService_TunnelServer) error {
	return ras.tunnelAgentToClient(stream.Context(), stream.Recv, stream.Send)
}

// Register registers all router services with the gRPC server.
// This version handles the agent service separately.
func RegisterRouterServices(s *grpc.Server, rs *RouterServer) {
	pb.RegisterRouterClientServiceServer(s, rs)
	pb.RegisterRouterAgentServiceServer(s, &RouterAgentServer{RouterServer: rs})
	pb.RegisterRouterControlServiceServer(s, rs)
}

// forward transfers messages from source to destination (zero-copy).
func (rs *RouterServer) forward(
	ctx context.Context,
	recv func() (*pb.TunnelMessage, error),
	send func(*pb.TunnelMessage) error,
	logger *slog.Logger,
) error {
	for {
		msg, err := recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			if isExpectedClose(err) {
				return nil
			}
			logger.DebugContext(ctx, "recv error", slog.String("error", err.Error()))
			return err
		}

		// Handle message types
		switch {
		case msg.GetData() != nil:
			if err := send(msg); err != nil {
				if isExpectedClose(err) {
					return nil
				}
				return err
			}

		case msg.GetClose() != nil:
			// Forward close message then exit - log but don't fail on error
			if err := send(msg); err != nil && !isExpectedClose(err) {
				logger.DebugContext(ctx, "failed to forward close message", slog.String("error", err.Error()))
			}
			return nil

		default:
			// Skip init or unknown message types
			logger.DebugContext(ctx, "skipping message", slog.String("type", fmt.Sprintf("%T", msg)))
			continue
		}
	}
}

// GetSessionInfo returns information about an active session.
func (rs *RouterServer) GetSessionInfo(ctx context.Context, req *pb.SessionInfoRequest) (*pb.SessionInfoResponse, error) {
	session, err := rs.store.GetSession(req.SessionKey)
	if err != nil {
		return nil, err
	}

	// Active means both client and agent have completed rendezvous
	return &pb.SessionInfoResponse{
		Active:        session.IsConnected(),
		WorkflowId:    session.WorkflowID,
		CreatedAt:     session.CreatedAt.Unix(),
		OperationType: session.OperationType,
	}, nil
}

// Helper functions

// validateTunnelInit validates the TunnelInit message.
func validateTunnelInit(init *pb.TunnelInit) error {
	if init.SessionKey == "" {
		return status.Error(codes.InvalidArgument, "session_key is required")
	}

	switch op := init.Operation.(type) {
	case *pb.TunnelInit_Exec:
		// Exec is always valid
	case *pb.TunnelInit_PortForward:
		if op.PortForward == nil {
			return status.Error(codes.InvalidArgument, "port_forward operation is nil")
		}
		if op.PortForward.Port <= 0 || op.PortForward.Port > 65535 {
			return status.Errorf(codes.InvalidArgument, "invalid port: %d (must be 1-65535)", op.PortForward.Port)
		}
		if op.PortForward.Protocol == pb.PortForwardOperation_UNSPECIFIED {
			return status.Error(codes.InvalidArgument, "port_forward protocol must be specified (TCP or UDP)")
		}
	case *pb.TunnelInit_Rsync:
		// Rsync is always valid
	case *pb.TunnelInit_WebSocket:
		// WebSocket is always valid
	case nil:
		return status.Error(codes.InvalidArgument, "operation is required")
	default:
		return status.Errorf(codes.InvalidArgument, "unknown operation type: %T", init.Operation)
	}

	return nil
}

// operationTypeFromInit extracts operation type string from TunnelInit.
func operationTypeFromInit(init *pb.TunnelInit) string {
	switch op := init.Operation.(type) {
	case *pb.TunnelInit_Exec:
		return OperationExec
	case *pb.TunnelInit_PortForward:
		return OperationPortForward + "_" + op.PortForward.Protocol.String()
	case *pb.TunnelInit_Rsync:
		return OperationRsync
	case *pb.TunnelInit_WebSocket:
		return OperationWebSocket
	default:
		return OperationUnknown
	}
}

func isExpectedClose(err error) bool {
	if err == nil {
		return false
	}
	if err == io.EOF {
		return true
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	if errors.Is(err, errPipeClosed) {
		return true
	}
	if status.Code(err) == codes.Canceled {
		return true
	}
	return false
}
