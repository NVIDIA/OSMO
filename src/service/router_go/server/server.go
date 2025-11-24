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

	pb "go.corp.nvidia.com/osmo/proto/router/v1"
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

// TODO(refactor): The Exec/PortForward/Rsync handlers have significant duplication.
// They all perform bidirectional byte streaming with nearly identical logic, differing
// only in proto message types and metrics labels. Consider refactoring into a generic
// helper function using Go generics or interfaces when time permits. For now, the
// explicit duplication provides clear, debuggable code with working tests.
// See discussion: The three operations could share ~80% of their code.

// Exec handles the exec stream from the client
func (rs *RouterServer) Exec(stream pb.RouterClientService_ExecServer) error {
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

	rs.logger.InfoContext(ctx, "client exec started",
		slog.String("session_key", init.SessionKey),
		slog.String("workflow_id", init.WorkflowId),
		slog.String("cookie", init.Cookie),
	)

	// Create or get session
	session, existed, err := rs.store.CreateSession(init.SessionKey, init.Cookie, init.WorkflowId, OperationExec)
	if err != nil {
		return err
	}

	if existed {
		return status.Error(codes.AlreadyExists, "session already exists")
	}

	defer rs.store.DeleteSession(init.SessionKey)

	// Wait for agent to connect
	if err := rs.store.WaitForRendezvous(ctx, session, true); err != nil {
		rs.logger.ErrorContext(ctx, "client exec rendezvous failed",
			slog.String("session_key", init.SessionKey),
			slog.String("error", err.Error()),
		)
		return err
	}

	rs.logger.InfoContext(ctx, "client exec rendezvous successful",
		slog.String("session_key", init.SessionKey),
	)

	// Start bidirectional streaming with errgroup for proper coordination
	var g errgroup.Group
	gctx := ctx

	// Client -> Agent (receiving from client, sending to agent via channel)
	g.Go(func() error {
		defer close(session.ClientToAgent)
		for {
			req, err := stream.Recv()
			if err == io.EOF {
				return nil
			}
			if err != nil {
				rs.logger.ErrorContext(gctx, "client exec recv error",
					slog.String("session_key", init.SessionKey),
					slog.String("error", err.Error()),
				)
				return err
			}

			// Handle different message types
			if data := req.GetData(); data != nil {
				if err := rs.store.SendWithFlowControl(gctx, session.ClientToAgent, data.Payload, init.SessionKey); err != nil {
					// If context was canceled, treat as normal shutdown
					if gctx.Err() != nil {
						return nil
					}
					return err
				}
			} else if resize := req.GetResize(); resize != nil {
				// Encode resize as special payload
				// This is a simplification; production should use proper encoding
				rs.logger.DebugContext(gctx, "client exec terminal resize",
					slog.String("session_key", init.SessionKey),
					slog.Int("rows", int(resize.Rows)),
					slog.Int("cols", int(resize.Cols)),
				)
			} else if req.GetClose() != nil {
				return nil
			}
		}
	})

	// Agent -> Client (receiving from channel, sending to client)
	g.Go(func() error {
		for {
			data, err := rs.store.ReceiveWithContext(gctx, session.AgentToClient, init.SessionKey)
			if err != nil {
				// Channel closed (agent finished) or context canceled - both are normal completion
				if status.Code(err) == codes.Unavailable || gctx.Err() != nil {
					return nil
				}
				return err
			}

			resp := &pb.ExecResponse{
				Message: &pb.ExecResponse_Data{
					Data: &pb.ExecData{
						Payload: data,
					},
				},
			}

			if err := stream.Send(resp); err != nil {
				rs.logger.ErrorContext(gctx, "client exec send error",
					slog.String("session_key", init.SessionKey),
					slog.String("error", err.Error()),
				)
				return err
			}

		}
	})

	// Wait for both goroutines to complete
	if err := g.Wait(); err != nil && err != io.EOF {
		rs.logger.ErrorContext(ctx, "client exec stream error",
			slog.String("session_key", init.SessionKey),
			slog.String("error", err.Error()),
			slog.String("code", codeToString(status.Code(err))),
		)
		return err
	}

	return nil
}

// RegisterExec handles the exec stream from the agent
func (rs *RouterServer) RegisterExec(stream pb.RouterAgentService_RegisterExecServer) error {
	ctx := stream.Context()

	// Receive init message from agent
	resp, err := stream.Recv()
	if err != nil {
		return status.Error(codes.InvalidArgument, "failed to receive init message from agent")
	}

	// Agent sends init information in the first ExecResponse
	init := resp.GetInit()
	if init == nil {
		return status.Error(codes.InvalidArgument, "first message from agent must be init")
	}

	rs.logger.InfoContext(ctx, "agent register exec started",
		slog.String("session_key", init.SessionKey),
		slog.String("workflow_id", init.WorkflowId),
	)

	// Find the session created by the client (or create if agent arrives first)
	session, existed, err := rs.store.CreateSession(init.SessionKey, init.Cookie, init.WorkflowId, OperationExec)
	if err != nil {
		return err
	}

	// If session just created (agent arrived first), we still need to wait for client
	// If session existed (client arrived first), signal rendezvous
	if !existed {
		defer rs.store.DeleteSession(init.SessionKey)
	}

	// Signal rendezvous (agent side)
	if err := rs.store.WaitForRendezvous(ctx, session, false); err != nil {
		rs.logger.ErrorContext(ctx, "agent register exec rendezvous failed",
			slog.String("session_key", init.SessionKey),
			slog.String("error", err.Error()),
		)
		return err
	}

	rs.logger.InfoContext(ctx, "agent register exec rendezvous successful",
		slog.String("session_key", init.SessionKey),
	)

	// Start bidirectional streaming with errgroup for proper coordination
	var g errgroup.Group
	gctx := ctx

	// Agent -> Client (agent sends ExecResponse, we forward to client's AgentToClient channel)
	g.Go(func() error {
		defer close(session.AgentToClient)
		for {
			resp, err := stream.Recv()
			if err == io.EOF {
				return nil
			}
			if err != nil {
				rs.logger.ErrorContext(gctx, "agent register exec recv error",
					slog.String("session_key", init.SessionKey),
					slog.String("error", err.Error()),
				)
				return err
			}

			// Handle different response types
			if data := resp.GetData(); data != nil {
				if err := rs.store.SendWithFlowControl(gctx, session.AgentToClient, data.Payload, init.SessionKey); err != nil {
					// If context was canceled, treat as normal shutdown
					if gctx.Err() != nil {
						return nil
					}
					return err
				}
			} else if respError := resp.GetError(); respError != nil {
				rs.logger.ErrorContext(gctx, "agent register exec agent sent error",
					slog.String("session_key", init.SessionKey),
					slog.String("message", respError.Message),
				)
				return fmt.Errorf("agent error: %s", respError.Message)
			} else if resp.GetClose() != nil {
				return nil
			}
		}
	})

	// Client -> Agent (we send ExecRequest to agent from ClientToAgent channel)
	g.Go(func() error {
		for {
			data, err := rs.store.ReceiveWithContext(gctx, session.ClientToAgent, init.SessionKey)
			if err != nil {
				// Channel closed (client sent Close) - forward Close to agent
				closeMsg := &pb.ExecRequest{
					Message: &pb.ExecRequest_Close{
						Close: &pb.ExecClose{},
					},
				}
				if sendErr := stream.Send(closeMsg); sendErr != nil {
					rs.logger.WarnContext(gctx, "agent register exec failed to send close",
						slog.String("session_key", init.SessionKey),
						slog.String("error", sendErr.Error()),
					)
				}

				// Successfully forwarded close - exit gracefully
				return nil
			}

			req := &pb.ExecRequest{
				Message: &pb.ExecRequest_Data{
					Data: &pb.ExecData{
						Payload: data,
					},
				},
			}

			if err := stream.Send(req); err != nil {
				rs.logger.ErrorContext(gctx, "agent register exec send error",
					slog.String("session_key", init.SessionKey),
					slog.String("error", err.Error()),
				)
				return err
			}

		}
	})

	// Wait for both goroutines to complete
	if err := g.Wait(); err != nil && err != io.EOF {
		rs.logger.ErrorContext(ctx, "agent register exec stream error",
			slog.String("session_key", init.SessionKey),
			slog.String("error", err.Error()),
			slog.String("code", codeToString(status.Code(err))),
		)
		return err
	}

	return nil
}

// PortForward handles port forward stream from client
func (rs *RouterServer) PortForward(stream pb.RouterClientService_PortForwardServer) error {
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

	operationType := "portforward_tcp"
	if init.Protocol == pb.Protocol_PROTOCOL_UDP {
		operationType = "portforward_udp"
	}

	rs.logger.InfoContext(ctx, "client port forward started",
		slog.String("session_key", init.SessionKey),
		slog.String("protocol", init.Protocol.String()),
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

	// Wait for agent
	if err := rs.store.WaitForRendezvous(ctx, session, true); err != nil {
		return err
	}

	// Start bidirectional streaming with errgroup for proper coordination
	var g errgroup.Group
	gctx := ctx

	// Client -> Agent
	g.Go(func() error {
		defer close(session.ClientToAgent)
		for {
			req, err := stream.Recv()
			if err == io.EOF {
				return nil
			}
			if err != nil {
				return err
			}

			if data := req.GetData(); data != nil {
				if err := rs.store.SendWithFlowControl(gctx, session.ClientToAgent, data.Payload, init.SessionKey); err != nil {
					if gctx.Err() != nil {
						return nil
					}
					return err
				}
			} else if req.GetClose() != nil {
				return nil
			}
		}
	})

	// Agent -> Client
	g.Go(func() error {
		for {
			data, err := rs.store.ReceiveWithContext(gctx, session.AgentToClient, init.SessionKey)
			if err != nil {
				// Channel closed or context canceled - both are normal completion
				if status.Code(err) == codes.Unavailable || gctx.Err() != nil {
					return nil
				}
				return err
			}

			resp := &pb.PortForwardResponse{
				Message: &pb.PortForwardResponse_Data{
					Data: &pb.PortForwardData{
						Payload: data,
					},
				},
			}

			if err := stream.Send(resp); err != nil {
				return err
			}

		}
	})

	if err := g.Wait(); err != nil && err != io.EOF {
		return err
	}

	return nil
}

// RegisterPortForward handles port forward stream from agent
func (rs *RouterServer) RegisterPortForward(stream pb.RouterAgentService_RegisterPortForwardServer) error {
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

	operationType := "portforward_tcp"
	if init.Protocol == pb.Protocol_PROTOCOL_UDP {
		operationType = "portforward_udp"
	}

	rs.logger.InfoContext(ctx, "agent register port forward started",
		slog.String("session_key", init.SessionKey),
		slog.String("protocol", init.Protocol.String()),
	)

	// Find or create session
	session, existed, err := rs.store.CreateSession(init.SessionKey, init.Cookie, init.WorkflowId, operationType)
	if err != nil {
		return err
	}

	if !existed {
		defer rs.store.DeleteSession(init.SessionKey)
	}

	// Wait for rendezvous
	if err := rs.store.WaitForRendezvous(ctx, session, false); err != nil {
		return err
	}

	// Start bidirectional streaming with errgroup for proper coordination
	var g errgroup.Group
	gctx := ctx

	// Agent -> Client
	g.Go(func() error {
		defer close(session.AgentToClient)
		for {
			resp, err := stream.Recv()
			if err == io.EOF {
				return nil
			}
			if err != nil {
				return err
			}

			if data := resp.GetData(); data != nil {
				if err := rs.store.SendWithFlowControl(gctx, session.AgentToClient, data.Payload, init.SessionKey); err != nil {
					if gctx.Err() != nil {
						return nil
					}
					return err
				}
			} else if respError := resp.GetError(); respError != nil {
				return fmt.Errorf("agent error: %s", respError.Message)
			} else if resp.GetClose() != nil {
				return nil
			}
		}
	})

	// Client -> Agent
	g.Go(func() error {
		for {
			data, err := rs.store.ReceiveWithContext(gctx, session.ClientToAgent, init.SessionKey)
			if err != nil {
				// Channel closed - forward Close to agent
				closeMsg := &pb.PortForwardRequest{
					Message: &pb.PortForwardRequest_Close{
						Close: &pb.PortForwardClose{},
					},
				}
				if sendErr := stream.Send(closeMsg); sendErr != nil {
					rs.logger.WarnContext(gctx, "agent register port forward failed to send close",
						slog.String("session_key", init.SessionKey),
						slog.String("error", sendErr.Error()),
					)
				}

				// Successfully forwarded close - exit gracefully
				return nil
			}

			req := &pb.PortForwardRequest{
				Message: &pb.PortForwardRequest_Data{
					Data: &pb.PortForwardData{
						Payload: data,
					},
				},
			}

			if err := stream.Send(req); err != nil {
				return err
			}

		}
	})

	if err := g.Wait(); err != nil && err != io.EOF {
		return err
	}

	return nil
}

// Rsync handles rsync stream from client
func (rs *RouterServer) Rsync(stream pb.RouterClientService_RsyncServer) error {
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

	rs.logger.InfoContext(ctx, "client rsync started",
		slog.String("session_key", init.SessionKey),
		slog.String("direction", init.Direction),
	)

	// Create or get session
	session, existed, err := rs.store.CreateSession(init.SessionKey, init.Cookie, init.WorkflowId, OperationRsync)
	if err != nil {
		return err
	}

	if existed {
		return status.Error(codes.AlreadyExists, "session already exists")
	}

	defer rs.store.DeleteSession(init.SessionKey)

	// Wait for agent
	if err := rs.store.WaitForRendezvous(ctx, session, true); err != nil {
		return err
	}

	// Start bidirectional streaming with errgroup for proper coordination
	var g errgroup.Group
	gctx := ctx

	// Client -> Agent
	g.Go(func() error {
		defer close(session.ClientToAgent)
		for {
			req, err := stream.Recv()
			if err == io.EOF {
				return nil
			}
			if err != nil {
				return err
			}

			if data := req.GetData(); data != nil {
				if err := rs.store.SendWithFlowControl(gctx, session.ClientToAgent, data.Payload, init.SessionKey); err != nil {
					if gctx.Err() != nil {
						return nil
					}
					return err
				}
			} else if req.GetClose() != nil {
				return nil
			}
		}
	})

	// Agent -> Client
	g.Go(func() error {
		for {
			data, err := rs.store.ReceiveWithContext(gctx, session.AgentToClient, init.SessionKey)
			if err != nil {
				// Channel closed or context canceled - both are normal completion
				if status.Code(err) == codes.Unavailable || gctx.Err() != nil {
					return nil
				}
				return err
			}

			resp := &pb.RsyncResponse{
				Message: &pb.RsyncResponse_Data{
					Data: &pb.RsyncData{
						Payload: data,
					},
				},
			}

			if err := stream.Send(resp); err != nil {
				return err
			}

		}
	})

	if err := g.Wait(); err != nil && err != io.EOF {
		return err
	}

	return nil
}

// RegisterRsync handles rsync stream from agent
func (rs *RouterServer) RegisterRsync(stream pb.RouterAgentService_RegisterRsyncServer) error {
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

	rs.logger.InfoContext(ctx, "agent register rsync started",
		slog.String("session_key", init.SessionKey),
		slog.String("direction", init.Direction),
	)

	// Find or create session
	session, existed, err := rs.store.CreateSession(init.SessionKey, init.Cookie, init.WorkflowId, OperationRsync)
	if err != nil {
		return err
	}

	if !existed {
		defer rs.store.DeleteSession(init.SessionKey)
	}

	// Wait for rendezvous
	if err := rs.store.WaitForRendezvous(ctx, session, false); err != nil {
		return err
	}

	// Start bidirectional streaming with errgroup for proper coordination
	var g errgroup.Group
	gctx := ctx

	// Agent -> Client
	g.Go(func() error {
		defer close(session.AgentToClient)
		for {
			resp, err := stream.Recv()
			if err == io.EOF {
				return nil
			}
			if err != nil {
				return err
			}

			if data := resp.GetData(); data != nil {
				if err := rs.store.SendWithFlowControl(gctx, session.AgentToClient, data.Payload, init.SessionKey); err != nil {
					if gctx.Err() != nil {
						return nil
					}
					return err
				}
			} else if respError := resp.GetError(); respError != nil {
				return fmt.Errorf("agent error: %s", respError.Message)
			} else if resp.GetClose() != nil {
				return nil
			}
		}
	})

	// Client -> Agent
	g.Go(func() error {
		for {
			data, err := rs.store.ReceiveWithContext(gctx, session.ClientToAgent, init.SessionKey)
			if err != nil {
				// Channel closed - forward Close to agent
				closeMsg := &pb.RsyncRequest{
					Message: &pb.RsyncRequest_Close{
						Close: &pb.RsyncClose{},
					},
				}
				if sendErr := stream.Send(closeMsg); sendErr != nil {
					rs.logger.WarnContext(gctx, "agent register rsync failed to send close",
						slog.String("session_key", init.SessionKey),
						slog.String("error", sendErr.Error()),
					)
				}

				// Successfully forwarded close - exit gracefully
				return nil
			}

			req := &pb.RsyncRequest{
				Message: &pb.RsyncRequest_Data{
					Data: &pb.RsyncData{
						Payload: data,
					},
				},
			}

			if err := stream.Send(req); err != nil {
				return err
			}

		}
	})

	if err := g.Wait(); err != nil && err != io.EOF {
		return err
	}

	return nil
}

// RefreshToken handles JWT token refresh.
// Returns a new token and expiration time, or an error if the refresh fails.
func (rs *RouterServer) RefreshToken(ctx context.Context, req *pb.RefreshTokenRequest) (resp *pb.RefreshTokenResponse, err error) {
	// For MVP, we implement a simple token refresh that validates the current token
	// and returns a refreshed one. In production, this would call the auth backend.

	// Validate input
	if req.CurrentToken == "" {
		return nil, status.Error(codes.InvalidArgument, "current_token is required")
	}

	// In a real implementation, we would:
	// 1. Validate the current token (check signature, expiry)
	// 2. Call the auth backend API to get a new token
	// 3. Return the new token with its expiry time

	// For now, we'll implement a placeholder that returns a mock refreshed token
	// This allows the system to work end-to-end without requiring the full auth backend

	rs.logger.InfoContext(ctx, "refresh token requested",
		slog.String("workflow_id", req.WorkflowId),
		slog.String("token_prefix", req.CurrentToken[:min(len(req.CurrentToken), 10)]),
	)

	// Mock: return the same token with a new expiry (1 hour from now)
	newExpiry := time.Now().Add(1 * time.Hour).Unix()

	// In production, replace this with actual backend call:
	// newToken, expiry, err := rs.authBackend.RefreshToken(ctx, req.CurrentToken, req.WorkflowId)

	return &pb.RefreshTokenResponse{
		NewToken:  req.CurrentToken + "_refreshed_" + fmt.Sprintf("%d", time.Now().Unix()),
		ExpiresAt: newExpiry,
	}, nil
}

// GetSessionInfo retrieves session information.
// Returns session details including activity times and operation type, or an error if the session is not found.
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

// timeNow is an alias for time.Now for testing purposes
var timeNow = time.Now
