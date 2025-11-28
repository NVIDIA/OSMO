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

// Package router provides a tunnel client for connecting to the router service.
// This client is used by both the user CLI (via RouterUserService) and the agent
// (via RouterAgentService) to establish bidirectional streaming tunnels.
//
// The tunnel implements io.ReadWriteCloser for easy integration with io.Copy
// and standard library functions.
package router

import (
	"context"
	"sync"

	"google.golang.org/grpc"

	pb "go.corp.nvidia.com/osmo/proto/router"
)

// tunnelStream abstracts over user and agent tunnel streams.
// It provides a unified interface for sending/receiving payload bytes.
type tunnelStream interface {
	SendPayload([]byte) error
	RecvPayload() ([]byte, error)
	CloseSend() error
}

// Tunnel provides bidirectional streaming over a router tunnel.
// It implements io.ReadWriteCloser for easy integration with io.Copy.
//
// Tunnel is NOT safe for concurrent reads. Typical usage has one goroutine
// reading and one writing, which is safe.
type Tunnel struct {
	stream tunnelStream

	// Read state - holds unconsumed portion of last received payload.
	pending []byte

	// Close state
	closeOnce sync.Once
	closed    chan struct{}
}

// DialUser establishes a tunnel as a user (CLI side).
// The init message must contain an operation specifying what the user wants to do.
func DialUser(ctx context.Context, conn *grpc.ClientConn, init *pb.UserInit) (*Tunnel, error) {
	client := pb.NewRouterUserServiceClient(conn)
	grpcStream, err := client.Tunnel(ctx)
	if err != nil {
		return nil, err
	}

	stream := &userStream{stream: grpcStream}

	// Send init frame
	if err := grpcStream.Send(&pb.UserFrame{
		Frame: &pb.UserFrame_Init{Init: init},
	}); err != nil {
		return nil, err
	}

	return &Tunnel{
		stream: stream,
		closed: make(chan struct{}),
	}, nil
}

// DialAgent establishes a tunnel as an agent.
// The init message must contain session_key and workflow_id to join an existing session.
func DialAgent(ctx context.Context, conn *grpc.ClientConn, init *pb.AgentInit) (*Tunnel, error) {
	client := pb.NewRouterAgentServiceClient(conn)
	grpcStream, err := client.Tunnel(ctx)
	if err != nil {
		return nil, err
	}

	stream := &agentStream{stream: grpcStream}

	// Send init frame
	if err := grpcStream.Send(&pb.AgentFrame{
		Frame: &pb.AgentFrame_Init{Init: init},
	}); err != nil {
		return nil, err
	}

	return &Tunnel{
		stream: stream,
		closed: make(chan struct{}),
	}, nil
}

// userStream wraps the user gRPC stream.
type userStream struct {
	stream pb.RouterUserService_TunnelClient
}

func (s *userStream) SendPayload(p []byte) error {
	return s.stream.Send(&pb.UserFrame{
		Frame: &pb.UserFrame_Payload{Payload: p},
	})
}

func (s *userStream) RecvPayload() ([]byte, error) {
	for {
		frame, err := s.stream.Recv()
		if err != nil {
			return nil, err
		}
		if payload, ok := frame.Frame.(*pb.UserFrame_Payload); ok {
			return payload.Payload, nil
		}
		// Skip unexpected frame types
	}
}

func (s *userStream) CloseSend() error {
	return s.stream.CloseSend()
}

// agentStream wraps the agent gRPC stream.
type agentStream struct {
	stream pb.RouterAgentService_TunnelClient
}

func (s *agentStream) SendPayload(p []byte) error {
	return s.stream.Send(&pb.AgentFrame{
		Frame: &pb.AgentFrame_Payload{Payload: p},
	})
}

func (s *agentStream) RecvPayload() ([]byte, error) {
	for {
		frame, err := s.stream.Recv()
		if err != nil {
			return nil, err
		}
		if payload, ok := frame.Frame.(*pb.AgentFrame_Payload); ok {
			return payload.Payload, nil
		}
		// Skip unexpected frame types
	}
}

func (s *agentStream) CloseSend() error {
	return s.stream.CloseSend()
}

// Read reads data from the tunnel into p. Implements io.Reader.
// Returns io.EOF when the tunnel is closed.
func (t *Tunnel) Read(p []byte) (int, error) {
	// Consume pending data first
	if len(t.pending) > 0 {
		n := copy(p, t.pending)
		t.pending = t.pending[n:]
		return n, nil
	}

	// Receive new payload
	data, err := t.stream.RecvPayload()
	if err != nil {
		return 0, err
	}

	n := copy(p, data)
	if n < len(data) {
		t.pending = data[n:]
	}
	return n, nil
}

// Write writes data to the tunnel. Implements io.Writer.
func (t *Tunnel) Write(p []byte) (int, error) {
	if err := t.stream.SendPayload(p); err != nil {
		return 0, err
	}
	return len(p), nil
}

// Close closes the tunnel by closing the send side of the stream.
// Implements io.Closer.
func (t *Tunnel) Close() error {
	var err error
	t.closeOnce.Do(func() {
		err = t.stream.CloseSend()
		close(t.closed)
	})
	return err
}

// Done returns a channel that's closed when the tunnel is closed.
func (t *Tunnel) Done() <-chan struct{} {
	return t.closed
}
