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

// RouterServer implements the router gRPC services
type RouterServer struct {
	store         *SessionStore
	logger        *slog.Logger
	streamBufSize int // Buffer size for stream message smoothing
	pb.UnimplementedRouterClientServiceServer
	pb.UnimplementedRouterAgentServiceServer
	pb.UnimplementedRouterControlServiceServer
}

// NewRouterServer creates a new router server
func NewRouterServer(store *SessionStore, logger *slog.Logger) *RouterServer {
	if logger == nil {
		logger = slog.Default()
	}
	streamBufSize := store.config.StreamBufferSize
	if streamBufSize <= 0 {
		streamBufSize = 4 // Default if not configured
	}
	return &RouterServer{
		store:         store,
		logger:        logger,
		streamBufSize: streamBufSize,
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

	// Receive init message
	req, err := stream.Recv()
	if err != nil {
		return status.Error(codes.InvalidArgument, "failed to receive init message")
	}

	init := req.GetInit()
	if init == nil {
		return status.Error(codes.InvalidArgument, "first message must be init")
	}

	// Determine operation type and session key
	operationType := operationTypeToString(init.Operation)
	// For PORT_FORWARD, refine based on protocol
	if init.Operation == pb.OperationType_OPERATION_PORT_FORWARD {
		if init.Protocol == pb.Protocol_PROTOCOL_UDP {
			operationType = "portforward_udp"
		} else {
			operationType = "portforward_tcp"
		}
	}

	rs.logger.InfoContext(ctx, "client tunnel started",
		slog.String("session_key", init.SessionKey),
		slog.String("workflow_id", init.WorkflowId),
		slog.String("cookie", init.Cookie),
		slog.String("operation", operationType),
	)

	// Create or get session
	session, existed, err := rs.store.CreateSession(init.SessionKey, init.Cookie, init.WorkflowId, operationType)
	if err != nil {
		return err
	}

	if existed {
		return status.Error(codes.AlreadyExists, "session already exists")
	}

	defer rs.store.DeleteSession(init.SessionKey)

	// Wait for agent to connect
	if err := rs.store.WaitForRendezvous(ctx, session, true); err != nil {
		rs.logger.ErrorContext(ctx, "client tunnel rendezvous failed",
			slog.String("session_key", init.SessionKey),
			slog.String("operation", operationType),
			slog.String("error", err.Error()),
		)
		return err
	}

	rs.logger.InfoContext(ctx, "client tunnel rendezvous successful",
		slog.String("session_key", init.SessionKey),
		slog.String("operation", operationType),
	)

	// Start bidirectional streaming with buffered channels for traffic smoothing
	clientToAgentBuf := make(chan []byte, rs.streamBufSize)
	agentToClientBuf := make(chan []byte, rs.streamBufSize)

	var g errgroup.Group
	gctx := ctx

	// Client -> Buffer (receive from stream and buffer messages)
	g.Go(func() error {
		defer close(clientToAgentBuf)
		for {
			req, err := stream.Recv()
			if err == io.EOF {
				return nil
			}
			if err != nil {
				rs.logger.ErrorContext(gctx, "client tunnel recv error",
					slog.String("session_key", init.SessionKey),
					slog.String("operation", operationType),
					slog.String("error", err.Error()),
				)
				return err
			}

			// Handle different message types
			if data := req.GetData(); data != nil {
				select {
				case clientToAgentBuf <- data.Payload:
				case <-gctx.Done():
					return gctx.Err()
				}
			} else if metadata := req.GetMetadata(); metadata != nil {
				// Handle metadata (e.g., resize for exec)
				if resize := metadata.GetResize(); resize != nil {
					rs.logger.DebugContext(gctx, "client tunnel terminal resize",
						slog.String("session_key", init.SessionKey),
						slog.Int("rows", int(resize.Rows)),
						slog.Int("cols", int(resize.Cols)),
					)
					// In production, encode and forward resize to agent
				}
			} else if req.GetClose() != nil {
				return nil
			}
		}
	})

	// Buffer -> Agent (send buffered messages to agent with flow control)
	g.Go(func() error {
		defer close(session.ClientToAgent)
		for {
			select {
			case data, ok := <-clientToAgentBuf:
				if !ok {
					return nil
				}
				if err := rs.store.SendWithFlowControl(gctx, session.ClientToAgent, data, init.SessionKey); err != nil {
					if gctx.Err() != nil {
						return nil
					}
					return err
				}
			case <-gctx.Done():
				return gctx.Err()
			}
		}
	})

	// Agent -> Buffer (receive from agent channel and buffer)
	g.Go(func() error {
		defer close(agentToClientBuf)
		for {
			data, err := rs.store.ReceiveWithContext(gctx, session.AgentToClient, init.SessionKey)
			if err != nil {
				if status.Code(err) == codes.Unavailable || gctx.Err() != nil {
					return nil
				}
				return err
			}
			select {
			case agentToClientBuf <- data:
			case <-gctx.Done():
				return gctx.Err()
			}
		}
	})

	// Buffer -> Client (send buffered messages to client stream)
	g.Go(func() error {
		for {
			select {
			case data, ok := <-agentToClientBuf:
				if !ok {
					return nil
				}
				resp := &pb.TunnelResponse{
					Message: &pb.TunnelResponse_Data{
						Data: &pb.TunnelData{
							Payload: data,
						},
					},
				}
				if err := stream.Send(resp); err != nil {
					rs.logger.ErrorContext(gctx, "client tunnel send error",
						slog.String("session_key", init.SessionKey),
						slog.String("operation", operationType),
						slog.String("error", err.Error()),
					)
					return err
				}
			case <-gctx.Done():
				return gctx.Err()
			}
		}
	})

	// Wait for both goroutines to complete
	if err := g.Wait(); err != nil && err != io.EOF {
		rs.logger.ErrorContext(ctx, "client tunnel stream error",
			slog.String("session_key", init.SessionKey),
			slog.String("operation", operationType),
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

	operationType := operationTypeToString(init.Operation)
	// For PORT_FORWARD, refine based on protocol
	if init.Operation == pb.OperationType_OPERATION_PORT_FORWARD {
		if init.Protocol == pb.Protocol_PROTOCOL_UDP {
			operationType = "portforward_udp"
		} else {
			operationType = "portforward_tcp"
		}
	}

	rs.logger.InfoContext(ctx, "agent tunnel registration started",
		slog.String("session_key", init.SessionKey),
		slog.String("workflow_id", init.WorkflowId),
		slog.String("operation", operationType),
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
		rs.logger.ErrorContext(ctx, "agent tunnel rendezvous failed",
			slog.String("session_key", init.SessionKey),
			slog.String("operation", operationType),
			slog.String("error", err.Error()),
		)
		return err
	}

	rs.logger.InfoContext(ctx, "agent tunnel rendezvous successful",
		slog.String("session_key", init.SessionKey),
		slog.String("operation", operationType),
	)

	// Start bidirectional streaming with buffered channels for traffic smoothing
	agentToClientBuf := make(chan []byte, rs.streamBufSize)
	clientToAgentBuf := make(chan []byte, rs.streamBufSize)

	var g errgroup.Group
	gctx := ctx

	// Agent -> Buffer (receive from agent stream and buffer messages)
	g.Go(func() error {
		defer close(agentToClientBuf)
		for {
			resp, err := stream.Recv()
			if err == io.EOF {
				return nil
			}
			if err != nil {
				rs.logger.ErrorContext(gctx, "agent tunnel recv error",
					slog.String("session_key", init.SessionKey),
					slog.String("operation", operationType),
					slog.String("error", err.Error()),
				)
				return err
			}

			// Handle different message types
			if data := resp.GetData(); data != nil {
				select {
				case agentToClientBuf <- data.Payload:
				case <-gctx.Done():
					return gctx.Err()
				}
			} else if resp.GetClose() != nil {
				return nil
			}
		}
	})

	// Buffer -> Client (send buffered messages to client channel with flow control)
	g.Go(func() error {
		defer close(session.AgentToClient)
		for {
			select {
			case data, ok := <-agentToClientBuf:
				if !ok {
					return nil
				}
				if err := rs.store.SendWithFlowControl(gctx, session.AgentToClient, data, init.SessionKey); err != nil {
					if gctx.Err() != nil {
						return nil
					}
					return err
				}
			case <-gctx.Done():
				return gctx.Err()
			}
		}
	})

	// Client -> Buffer (receive from client channel and buffer)
	g.Go(func() error {
		defer close(clientToAgentBuf)
		for {
			data, err := rs.store.ReceiveWithContext(gctx, session.ClientToAgent, init.SessionKey)
			if err != nil {
				if status.Code(err) == codes.Unavailable || gctx.Err() != nil {
					return nil
				}
				return err
			}
			select {
			case clientToAgentBuf <- data:
			case <-gctx.Done():
				return gctx.Err()
			}
		}
	})

	// Buffer -> Agent (send buffered messages to agent stream)
	g.Go(func() error {
		for {
			select {
			case data, ok := <-clientToAgentBuf:
				if !ok {
					// Send close message to agent when channel is closed
					closeMsg := &pb.TunnelRequest{
						Message: &pb.TunnelRequest_Close{
							Close: &pb.TunnelClose{},
						},
					}
					stream.Send(closeMsg)
					return nil
				}
				req := &pb.TunnelRequest{
					Message: &pb.TunnelRequest_Data{
						Data: &pb.TunnelData{
							Payload: data,
						},
					},
				}
				if err := stream.Send(req); err != nil {
					rs.logger.ErrorContext(gctx, "agent tunnel send error",
						slog.String("session_key", init.SessionKey),
						slog.String("operation", operationType),
						slog.String("error", err.Error()),
					)
					return err
				}
			case <-gctx.Done():
				return gctx.Err()
			}
		}
	})

	// Wait for both goroutines to complete
	if err := g.Wait(); err != nil && err != io.EOF {
		rs.logger.ErrorContext(ctx, "agent tunnel stream error",
			slog.String("session_key", init.SessionKey),
			slog.String("operation", operationType),
			slog.String("error", err.Error()),
			slog.String("code", codeToString(status.Code(err))),
		)
		return err
	}

	return nil
}

// Helper functions

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

// RefreshToken refreshes an authentication token.
// For MVP, implements a simple token refresh placeholder.
func (rs *RouterServer) RefreshToken(ctx context.Context, req *pb.RefreshTokenRequest) (resp *pb.RefreshTokenResponse, err error) {
	// Validate input
	if req.CurrentToken == "" {
		return nil, status.Error(codes.InvalidArgument, "current_token is required")
	}

	rs.logger.InfoContext(ctx, "refresh token requested",
		slog.String("workflow_id", req.WorkflowId),
		slog.String("token_prefix", req.CurrentToken[:min(len(req.CurrentToken), 10)]),
	)

	// Mock: return a refreshed token with new expiry (1 hour from now)
	newExpiry := time.Now().Add(1 * time.Hour).Unix()

	return &pb.RefreshTokenResponse{
		NewToken:  req.CurrentToken + "_refreshed_" + fmt.Sprintf("%d", time.Now().Unix()),
		ExpiresAt: newExpiry,
	}, nil
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
		LastActivity:  session.LastActivity().Unix(),
		OperationType: stringToOperationType(session.OperationType),
	}, nil
}

// timeNow is an alias for time.Now for testing purposes
var timeNow = time.Now
