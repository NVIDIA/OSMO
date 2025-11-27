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

func init() {
	// Register our zero-copy codec at startup.
	// This replaces the default protobuf codec with one that preserves
	// raw bytes for RawMessage types, enabling zero-copy forwarding.
	RegisterRawCodec()
}

// RouterServer implements all router gRPC services.
type RouterServer struct {
	store  *SessionStore
	logger *slog.Logger
	pb.UnimplementedRouterUserServiceServer
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

// grpcStream is the interface for gRPC bidirectional streams.
// Both client and agent streams implement this.
type grpcStream interface {
	Context() context.Context
	SendMsg(m any) error
	RecvMsg(m any) error
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
func (rs *RouterServer) tunnelClientToAgent(stream grpcStream) error {
	return rs.tunnelHandler(stream, &clientConfig)
}

// tunnelAgentToClient handles agent tunnel connections.
func (rs *RouterServer) tunnelAgentToClient(stream grpcStream) error {
	return rs.tunnelHandler(stream, &agentConfig)
}

// tunnelHandler is the common implementation for tunnel handling.
//
// ZERO-COPY DESIGN:
// 1. Receive raw bytes from gRPC (using our custom codec)
// 2. For data messages (ONLY): forward raw bytes through pipe WITHOUT parsing
// 3. Send raw bytes to gRPC (using our custom codec)
//
// The payload bytes in data messages are NEVER copied or parsed.
func (rs *RouterServer) tunnelHandler(stream grpcStream, cfg *tunnelConfig) error {
	ctx := stream.Context()

	// Receive init message using zero-copy codec
	var initMsg RawMessage
	if err := stream.RecvMsg(&initMsg); err != nil {
		return status.Error(codes.InvalidArgument, "failed to receive init message")
	}

	// Parse init message
	init := initMsg.GetInit()
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

	// Bidirectional streaming with shared context for coordinated cancellation
	g, gctx := errgroup.WithContext(ctx)

	// Stream → Pipe (receive from gRPC, send to pipe)
	g.Go(func() error {
		defer outPipe.Close()
		return rs.forwardStreamToPipe(gctx, stream, outPipe, session.Done(), logger)
	})

	// Pipe → Stream (receive from pipe, send to gRPC)
	g.Go(func() error {
		return rs.forwardPipeToStream(gctx, inPipe, stream, session.Done(), logger)
	})

	if err := g.Wait(); err != nil && !isExpectedClose(err) {
		logger.ErrorContext(ctx, "tunnel error", slog.String("error", err.Error()))
		return err
	}

	logger.InfoContext(ctx, "tunnel closed")
	return nil
}

// Tunnel handles user connections (implements RouterUserService).
func (rs *RouterServer) Tunnel(stream pb.RouterUserService_TunnelServer) error {
	return rs.tunnelClientToAgent(stream)
}

// RouterAgentServer wraps RouterServer to implement RouterAgentService.Tunnel.
// Required because both services have a method named "Tunnel" with different stream types.
type RouterAgentServer struct {
	*RouterServer
	pb.UnimplementedRouterAgentServiceServer
}

// Tunnel handles agent connections (implements RouterAgentService).
func (ras *RouterAgentServer) Tunnel(stream pb.RouterAgentService_TunnelServer) error {
	return ras.tunnelAgentToClient(stream)
}

// Register registers all router services with the gRPC server.
// This version handles the agent service separately.
func RegisterRouterServices(s *grpc.Server, rs *RouterServer) {
	pb.RegisterRouterUserServiceServer(s, rs)
	pb.RegisterRouterAgentServiceServer(s, &RouterAgentServer{RouterServer: rs})
	pb.RegisterRouterControlServiceServer(s, rs)
}

// recvResult holds the result of an async receive operation.
type recvResult struct {
	msg RawMessage
	err error
}

// forwardStreamToPipe receives messages from gRPC and sends to pipe.
//
// The sessionDone channel is used to detect when the session is terminated
// externally (e.g., via TerminateSession API).
func (rs *RouterServer) forwardStreamToPipe(
	ctx context.Context,
	stream grpcStream,
	pipe *Pipe,
	sessionDone <-chan struct{},
	logger *slog.Logger,
) error {
	// Channel for async receive results
	recvCh := make(chan recvResult, 1)

	// Start receive goroutine
	go func() {
		for {
			var msg RawMessage
			err := stream.RecvMsg(&msg)
			select {
			case recvCh <- recvResult{msg, err}:
				if err != nil {
					return // Stop on error
				}
			case <-ctx.Done():
				return
			case <-sessionDone:
				return
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()

		case <-sessionDone:
			// Session was terminated externally
			return nil

		case result := <-recvCh:
			if result.err == io.EOF {
				return io.EOF
			}
			if result.err != nil {
				if !isExpectedClose(result.err) {
					logger.DebugContext(ctx, "recv error", slog.String("error", result.err.Error()))
				}
				return result.err
			}

			// Check message type using quick byte inspection (no full parse)
			switch {
			case result.msg.IsData():
				// ZERO-COPY: Forward raw bytes through pipe
				if err := pipe.Send(ctx, result.msg); err != nil {
					return err
				}

			case result.msg.IsClose():
				// Forward close message then exit
				if err := pipe.Send(ctx, result.msg); err != nil && !isExpectedClose(err) {
					logger.DebugContext(ctx, "failed to forward close message", slog.String("error", err.Error()))
				}
				return nil

			case result.msg.IsInit():
				// Skip init messages after the first one
				logger.DebugContext(ctx, "skipping extra init message")
				continue

			default:
				// Unknown message type - skip
				logger.DebugContext(ctx, "skipping unknown message")
				continue
			}
		}
	}
}

// forwardPipeToStream receives messages from pipe and sends to gRPC.
//
// The sessionDone channel is used to detect when the session is terminated
// externally (e.g., via TerminateSession API).
func (rs *RouterServer) forwardPipeToStream(
	ctx context.Context,
	pipe *Pipe,
	stream grpcStream,
	sessionDone <-chan struct{},
	logger *slog.Logger,
) error {
	for {
		// Check if session was terminated
		select {
		case <-sessionDone:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		default:
			// Continue to receive
		}

		msg, err := pipe.Receive(ctx)
		if err != nil {
			if isExpectedClose(err) {
				return nil
			}
			return err
		}

		if err := stream.SendMsg(msg); err != nil {
			if !isExpectedClose(err) {
				logger.DebugContext(ctx, "send error", slog.String("error", err.Error()))
			}
			return err
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

// TerminateSession forcibly terminates an active session.
func (rs *RouterServer) TerminateSession(ctx context.Context, req *pb.TerminateSessionRequest) (*pb.TerminateSessionResponse, error) {
	if req.SessionKey == "" {
		return nil, status.Error(codes.InvalidArgument, "session_key is required")
	}

	terminated := rs.store.TerminateSession(req.SessionKey, req.Reason)

	rs.logger.InfoContext(ctx, "terminate session request",
		slog.String("session_key", req.SessionKey),
		slog.String("reason", req.Reason),
		slog.Bool("terminated", terminated),
	)

	return &pb.TerminateSessionResponse{Terminated: terminated}, nil
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
