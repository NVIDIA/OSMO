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

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "go.corp.nvidia.com/osmo/proto/router"
)

func init() {
	// Register our zero-copy codec at startup.
	// This replaces the default protobuf codec with one that preserves
	// raw bytes for RawFrame types, enabling zero-copy forwarding.
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

// Router Data Flow (Direct Forwarding with gRPC Flow Control):
//
//	                          ROUTER
//	                   ┌─────────────────────────────────────┐
//	                   │                                     │
//	 USER              │      Direct Stream Forwarding       │          AGENT
//	┌──────┐           │    ════════════════════════════►    │         ┌──────┐
//	│      │ ── recv ──┼─────────────────────────────────────┼── send ─│      │
//	│      │           │     (gRPC flow control applies)     │         │      │
//	│      │ ◄─ send ──┼─────────────────────────────────────┼── recv ─│      │
//	└──────┘           │    ◄════════════════════════════    │         └──────┘
//	                   │                                     │
//	                   └─────────────────────────────────────┘
//
// NATURAL BACKPRESSURE:
// - gRPC uses HTTP/2 flow control windows
// - When receiver is slow, Send() blocks until window has space
// - No artificial timeouts - throughput adjusts organically
// - Sender and receiver naturally synchronize

// sessionInfo holds parsed init information needed for session setup.
type sessionInfo struct {
	SessionKey    string
	WorkflowID    string
	OperationType string
}

// tunnelRole defines the role-specific behavior for tunnel handling.
type tunnelRole struct {
	name            string
	parseInit       func(f *RawFrame) (*sessionInfo, error)
	registerStream  func(s *Session, stream TunnelStream)
	registerContext func(s *Session, ctx context.Context) context.Context
	rendezvous      func(s *Session, ctx context.Context, timeout time.Duration) error
	getPeer         func(s *Session) TunnelStream
}

var (
	userRole = tunnelRole{
		name:            "user",
		parseInit:       parseUserInit,
		registerStream:  (*Session).RegisterUserStream,
		registerContext: (*Session).RegisterUserContext,
		rendezvous:      (*Session).WaitForAgent,
		getPeer:         (*Session).AgentStream,
	}
	agentRole = tunnelRole{
		name:            "agent",
		parseInit:       parseAgentInit,
		registerStream:  (*Session).RegisterAgentStream,
		registerContext: (*Session).RegisterAgentContext,
		rendezvous:      (*Session).WaitForUser,
		getPeer:         (*Session).UserStream,
	}
)

// tunnelUserToAgent handles user tunnel connections.
func (rs *RouterServer) tunnelUserToAgent(stream TunnelStream) error {
	return rs.tunnelHandler(stream, &userRole)
}

// tunnelAgentToUser handles agent tunnel connections.
func (rs *RouterServer) tunnelAgentToUser(stream TunnelStream) error {
	return rs.tunnelHandler(stream, &agentRole)
}

// tunnelHandler is the common implementation for tunnel handling.
//
// DIRECT FORWARDING WITH GRPC FLOW CONTROL:
//
// After rendezvous, each handler reads from its own stream and writes to the
// peer's stream. gRPC's HTTP/2 flow control provides natural backpressure:
//
// - When the receiver is slow, the sender's stream.Send() blocks
// - This throttles the sender without artificial timeouts
// - Throughput adjusts organically to network/receiver capacity
//
// IMPORTANT: Each handler only does ONE direction of forwarding:
//
// - User handler: reads from user stream → sends to agent stream
// - Agent handler: reads from agent stream → sends to user stream
//
// This avoids race conditions on stream access.
func (rs *RouterServer) tunnelHandler(stream TunnelStream, role *tunnelRole) error {
	ctx := stream.Context()

	// Receive init frame using zero-copy codec
	var initFrame RawFrame
	if err := stream.RecvMsg(&initFrame); err != nil {
		return status.Error(codes.InvalidArgument, "failed to receive init frame")
	}

	// Parse init frame (role-specific)
	info, err := role.parseInit(&initFrame)
	if err != nil {
		return err
	}

	logger := rs.logger.With(
		slog.String("session_key", info.SessionKey),
		slog.String("operation", info.OperationType),
		slog.String("role", role.name),
	)

	logger.InfoContext(ctx, role.name+" tunnel started",
		slog.String("workflow_id", info.WorkflowID),
	)

	// Get or create session
	session, _, err := rs.store.GetOrCreateSession(
		info.SessionKey,
		info.WorkflowID,
		info.OperationType,
	)
	if err != nil {
		return err
	}

	defer rs.store.ReleaseSession(info.SessionKey)

	// Register our stream so peer can access it
	role.registerStream(session, stream)

	// Register context for external cancellation.
	// The returned ctx will be cancelled if session is terminated externally.
	ctx = role.registerContext(session, ctx)

	// Wait for the other party
	if err := role.rendezvous(session, ctx, rs.store.RendezvousTimeout()); err != nil {
		logger.ErrorContext(ctx, "rendezvous failed", slog.String("error", err.Error()))
		return err
	}

	logger.InfoContext(ctx, "rendezvous successful")

	// Get peer's stream for direct forwarding
	peer := role.getPeer(session)
	if peer == nil {
		return status.Error(codes.Internal, "peer stream not available")
	}

	// SINGLE DIRECTION: Read from our stream, send to peer.
	// The peer's handler does the reverse direction.
	err = rs.forwardStream(ctx, stream, peer, logger)
	if err != nil && !isExpectedClose(err) {
		logger.ErrorContext(ctx, "tunnel error", slog.String("error", err.Error()))
		return err
	}

	logger.InfoContext(ctx, "tunnel closed")
	return nil
}

// Tunnel handles user connections (implements RouterUserService).
func (rs *RouterServer) Tunnel(stream pb.RouterUserService_TunnelServer) error {
	return rs.tunnelUserToAgent(stream)
}

// RouterAgentServer wraps RouterServer to implement RouterAgentService.Tunnel.
// Required because both services have a method named "Tunnel" with different stream types.
type RouterAgentServer struct {
	*RouterServer
	pb.UnimplementedRouterAgentServiceServer
}

// Tunnel handles agent connections (implements RouterAgentService).
func (ras *RouterAgentServer) Tunnel(stream pb.RouterAgentService_TunnelServer) error {
	return ras.tunnelAgentToUser(stream)
}

// Register registers all router services with the gRPC server.
// This version handles the agent service separately.
func RegisterRouterServices(s *grpc.Server, rs *RouterServer) {
	pb.RegisterRouterUserServiceServer(s, rs)
	pb.RegisterRouterAgentServiceServer(s, &RouterAgentServer{RouterServer: rs})
	pb.RegisterRouterControlServiceServer(s, rs)
}

// forwardStream reads from src and writes to dst with zero-copy forwarding.
//
// ARCHITECTURE:
// A single goroutine runs the blocking recv→send loop. The main goroutine
// monitors for context cancellation (session termination). Frames stay on
// the forwarding goroutine's stack - no channel overhead per frame.
//
// NATURAL BACKPRESSURE:
// dst.SendMsg() blocks when the receiver's flow control window is full.
// This automatically throttles the sender without artificial timeouts,
// allowing throughput to adjust organically to network and receiver capacity.
func (rs *RouterServer) forwardStream(
	ctx context.Context,
	src TunnelStream,
	dst TunnelStream,
	logger *slog.Logger,
) error {
	// errCh receives the final result from the forwarding loop.
	// Only the final error goes through the channel - frames stay on stack.
	errCh := make(chan error, 1)

	go func() {
		errCh <- rs.doForward(src, dst, logger)
	}()

	select {
	case err := <-errCh:
		// Forwarding completed (EOF, error, or peer disconnect)
		if err == io.EOF {
			return io.EOF
		}
		if err != nil && !isExpectedClose(err) {
			return err
		}
		return nil

	case <-ctx.Done():
		// Session was terminated externally (ReleaseSession/TerminateSession)
		if context.Cause(ctx) == ErrSessionTerminated {
			return nil
		}
		return ctx.Err()
	}
}

// doForward is the inner forwarding loop. Runs in a goroutine.
// Frames stay on this goroutine's stack - zero channel overhead per frame.
func (rs *RouterServer) doForward(
	src TunnelStream,
	dst TunnelStream,
	logger *slog.Logger,
) error {
	for {
		var frame RawFrame

		// RecvMsg blocks until data arrives or stream ends
		err := src.RecvMsg(&frame)
		if err != nil {
			if err == io.EOF {
				return io.EOF
			}
			if !isExpectedClose(err) {
				logger.Debug("recv error", slog.String("error", err.Error()))
			}
			return err
		}

		// ZERO-COPY FORWARD: Send raw bytes to peer stream
		// gRPC flow control blocks here if receiver is slow
		err = dst.SendMsg(frame)
		if err != nil {
			if !isExpectedClose(err) {
				logger.Debug("send error", slog.String("error", err.Error()))
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

	return &pb.SessionInfoResponse{
		Active:        session.IsConnected(),
		WorkflowId:    session.WorkflowID,
		CreatedAt:     session.CreatedAt.Unix(),
		OperationType: session.OperationType(),
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

// parseUserInit parses and validates a UserInit from the raw frame.
func parseUserInit(f *RawFrame) (*sessionInfo, error) {
	init := f.GetUserInit()
	if init == nil {
		return nil, status.Error(codes.InvalidArgument, "first frame must be user init")
	}

	if init.SessionKey == "" {
		return nil, status.Error(codes.InvalidArgument, "session_key is required")
	}

	// Validate and extract operation type
	opType, err := validateUserOperation(init)
	if err != nil {
		return nil, err
	}

	return &sessionInfo{
		SessionKey:    init.SessionKey,
		WorkflowID:    init.WorkflowId,
		OperationType: opType,
	}, nil
}

// parseAgentInit parses and validates an AgentInit from the raw frame.
func parseAgentInit(f *RawFrame) (*sessionInfo, error) {
	init := f.GetAgentInit()
	if init == nil {
		return nil, status.Error(codes.InvalidArgument, "first frame must be agent init")
	}

	if init.SessionKey == "" {
		return nil, status.Error(codes.InvalidArgument, "session_key is required")
	}

	if init.WorkflowId == "" {
		return nil, status.Error(codes.InvalidArgument, "workflow_id is required")
	}

	// Agent doesn't specify operation - it joins an existing session
	return &sessionInfo{
		SessionKey:    init.SessionKey,
		WorkflowID:    init.WorkflowId,
		OperationType: "", // Will be filled from existing session
	}, nil
}

// validateUserOperation validates the operation in UserInit and returns its type.
func validateUserOperation(init *pb.UserInit) (string, error) {
	switch op := init.Operation.(type) {
	case *pb.UserInit_Exec:
		return OperationExec, nil
	case *pb.UserInit_PortForward:
		if op.PortForward == nil {
			return "", status.Error(codes.InvalidArgument, "port_forward operation is nil")
		}
		if op.PortForward.Port <= 0 || op.PortForward.Port > 65535 {
			return "", status.Errorf(codes.InvalidArgument, "invalid port: %d (must be 1-65535)", op.PortForward.Port)
		}
		if op.PortForward.Protocol == pb.PortForwardOperation_UNSPECIFIED {
			return "", status.Error(codes.InvalidArgument, "port_forward protocol must be specified (TCP or UDP)")
		}
		return OperationPortForward + "_" + op.PortForward.Protocol.String(), nil
	case *pb.UserInit_Rsync:
		return OperationRsync, nil
	case *pb.UserInit_WebSocket:
		return OperationWebSocket, nil
	case nil:
		return "", status.Error(codes.InvalidArgument, "operation is required")
	default:
		return "", status.Errorf(codes.InvalidArgument, "unknown operation type: %T", init.Operation)
	}
}

func isExpectedClose(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.EOF) ||
		errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	return status.Code(err) == codes.Canceled
}
