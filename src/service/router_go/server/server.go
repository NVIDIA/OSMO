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
	"io"
	"log/slog"

	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

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

	// Note: existed can be true if agent connected first - this is OK
	// The rendezvous mechanism ensures proper coordination
	_ = existed

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

	// Start bidirectional streaming (direct to session channels)
	// Use errgroup.WithContext to get cancellable context that stops all goroutines
	// when any one completes or errors
	g, gctx := errgroup.WithContext(ctx)

	// Client -> Agent (receive from client stream, send to agent via session channel)
	g.Go(func() error {
		defer close(session.ClientToAgent)
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
				// Send data to session channel with flow control
				msg := &SessionMessage{Data: data.Payload}
				if err := rs.store.SendWithFlowControl(gctx, session.ClientToAgent, msg); err != nil {
					if gctx.Err() != nil {
						return nil
					}
					return err
				}
			} else if closeInfo := req.GetClose(); closeInfo != nil {
				// Client sent explicit close - forward to agent
				rs.logger.DebugContext(gctx, "client sent close message",
					slog.String("session_key", init.SessionKey),
				)
				// Serialize close info to forward to agent
				closeBytes, err := proto.Marshal(closeInfo)
				if err != nil {
					rs.logger.ErrorContext(gctx, "failed to marshal close info",
						slog.String("session_key", init.SessionKey),
						slog.String("error", err.Error()),
					)
					return err
				}
				msg := &SessionMessage{CloseInfo: closeBytes}
				// Send close message through channel (non-blocking, best effort)
				select {
				case session.ClientToAgent <- msg:
				case <-gctx.Done():
				default:
					// Channel full or closed, continue anyway
				}
				return nil
			}
		}
	})

	// Agent -> Client (receive from session channel, send to client stream)
	g.Go(func() error {
		for {
			msg, err := rs.store.ReceiveWithContext(gctx, session.AgentToClient)
			if err != nil {
				if status.Code(err) == codes.Unavailable || gctx.Err() != nil {
					return nil
				}
				return err
			}

			// Handle different message types
			if msg.CloseInfo != nil {
				// Close signal - send close message to client and exit
				var closeInfo pb.TunnelClose
				if err := proto.Unmarshal(msg.CloseInfo, &closeInfo); err != nil {
					rs.logger.ErrorContext(gctx, "failed to unmarshal close info",
						slog.String("session_key", init.SessionKey),
						slog.String("error", err.Error()),
					)
					// Send empty close on error
					stream.Send(&pb.TunnelResponse{
						Message: &pb.TunnelResponse_Close{Close: &pb.TunnelClose{}},
					})
					return nil
				}
				resp := &pb.TunnelResponse{
					Message: &pb.TunnelResponse_Close{
						Close: &closeInfo,
					},
				}
				if err := stream.Send(resp); err != nil {
					rs.logger.WarnContext(gctx, "failed to send final close to client",
						slog.String("session_key", init.SessionKey),
						slog.String("error", err.Error()),
					)
				}
				return nil
			} else {
				// Forward data to client (including empty messages)
				resp := &pb.TunnelResponse{
					Message: &pb.TunnelResponse_Data{
						Data: &pb.TunnelData{
							Payload: msg.Data,
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

	// Start bidirectional streaming (direct to session channels)
	// Use errgroup.WithContext to get cancellable context that stops all goroutines
	// when any one completes or errors
	g, gctx := errgroup.WithContext(ctx)

	// Agent -> Client (receive from agent stream, send to client via session channel)
	g.Go(func() error {
		defer close(session.AgentToClient)
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
				// Send data to session channel with flow control
				msg := &SessionMessage{Data: data.Payload}
				if err := rs.store.SendWithFlowControl(gctx, session.AgentToClient, msg); err != nil {
					if gctx.Err() != nil {
						return nil
					}
					return err
				}
			} else if closeInfo := resp.GetClose(); closeInfo != nil {
				// Agent sent explicit close - forward to client
				rs.logger.DebugContext(gctx, "agent sent close message",
					slog.String("session_key", init.SessionKey),
				)
				// Serialize close info to forward to client
				closeBytes, err := proto.Marshal(closeInfo)
				if err != nil {
					rs.logger.ErrorContext(gctx, "failed to marshal close info from agent",
						slog.String("session_key", init.SessionKey),
						slog.String("error", err.Error()),
					)
					return err
				}
				msg := &SessionMessage{CloseInfo: closeBytes}
				// Send close message through channel (non-blocking, best effort)
				select {
				case session.AgentToClient <- msg:
				case <-gctx.Done():
				default:
					// Channel full or closed, continue anyway
				}
				return nil
			}
		}
	})

	// Client -> Agent (receive from session channel, send to agent stream)
	g.Go(func() error {
		for {
			msg, err := rs.store.ReceiveWithContext(gctx, session.ClientToAgent)
			if err != nil {
				if status.Code(err) == codes.Unavailable || gctx.Err() != nil {
					// Send close message to agent when channel is closed
					closeMsg := &pb.TunnelRequest{
						Message: &pb.TunnelRequest_Close{
							Close: &pb.TunnelClose{},
						},
					}
					if err := stream.Send(closeMsg); err != nil {
						// Log error but don't fail - connection might already be closing
						rs.logger.WarnContext(gctx, "failed to send close message to agent",
							slog.String("session_key", init.SessionKey),
							slog.String("error", err.Error()),
						)
					}
					return nil
				}
				return err
			}

			// Handle different message types
			if msg.CloseInfo != nil {
				// Close signal - send close message to agent and exit
				var closeInfo pb.TunnelClose
				if err := proto.Unmarshal(msg.CloseInfo, &closeInfo); err != nil {
					rs.logger.ErrorContext(gctx, "failed to unmarshal close info for agent",
						slog.String("session_key", init.SessionKey),
						slog.String("error", err.Error()),
					)
					// Send empty close on error
					stream.Send(&pb.TunnelRequest{
						Message: &pb.TunnelRequest_Close{Close: &pb.TunnelClose{}},
					})
					return nil
				}
				req := &pb.TunnelRequest{
					Message: &pb.TunnelRequest_Close{
						Close: &closeInfo,
					},
				}
				if err := stream.Send(req); err != nil {
					rs.logger.WarnContext(gctx, "failed to send final close to agent",
						slog.String("session_key", init.SessionKey),
						slog.String("error", err.Error()),
					)
				}
				return nil
			} else {
				// Forward data to agent (including empty messages)
				req := &pb.TunnelRequest{
					Message: &pb.TunnelRequest_Data{
						Data: &pb.TunnelData{
							Payload: msg.Data,
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
