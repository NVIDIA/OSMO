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

package transport

import (
	"context"
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"

	pb "go.corp.nvidia.com/osmo/proto/router/v1"
)

// GRPCAgentTransport implements Transport for osmo-ctrl agent using gRPC RegisterXxx APIs
type GRPCAgentTransport struct {
	config Config
	conn   *grpc.ClientConn
	agent  pb.RouterAgentServiceClient
	mu     sync.Mutex
}

// NewGRPCAgentTransport creates a new gRPC agent transport
func NewGRPCAgentTransport(config Config) (*GRPCAgentTransport, error) {
	var opts []grpc.DialOption

	// TLS configuration
	if config.UseTLS {
		creds := credentials.NewTLS(nil)
		opts = append(opts, grpc.WithTransportCredentials(creds))
	} else {
		opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	}

	// Keepalive configuration
	opts = append(opts, grpc.WithKeepaliveParams(keepalive.ClientParameters{
		Time:                60 * time.Second,
		Timeout:             20 * time.Second,
		PermitWithoutStream: true,
	}))

	// Connect to router
	conn, err := grpc.Dial(config.RouterAddress, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to router: %w", err)
	}

	agent := pb.NewRouterAgentServiceClient(conn)

	return &GRPCAgentTransport{
		config: config,
		conn:   conn,
		agent:  agent,
	}, nil
}

// ConnectExec implements Transport.ConnectExec for agents
func (t *GRPCAgentTransport) ConnectExec(ctx context.Context, key, cookie, workflowID string) (Stream, error) {
	stream, err := t.agent.RegisterExec(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create agent exec stream: %w", err)
	}

	// Send init message as ExecResponse (agent sends responses)
	initResp := &pb.ExecResponse{
		Message: &pb.ExecResponse_Init{
			Init: &pb.ExecInit{
				SessionKey: key,
				Cookie:     cookie,
				WorkflowId: workflowID,
			},
		},
	}
	if err := stream.Send(initResp); err != nil {
		return nil, fmt.Errorf("failed to send init: %w", err)
	}

	return &grpcAgentExecStream{stream: stream}, nil
}

// ConnectPortForward implements Transport.ConnectPortForward for agents
func (t *GRPCAgentTransport) ConnectPortForward(ctx context.Context, key, cookie, workflowID string, protocol PortForwardProtocol, remotePort int) (Stream, error) {
	stream, err := t.agent.RegisterPortForward(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create agent port-forward stream: %w", err)
	}

	// Determine protocol
	proto := pb.Protocol_PROTOCOL_TCP
	if protocol == ProtocolUDP {
		proto = pb.Protocol_PROTOCOL_UDP
	}

	// Send init message as PortForwardResponse
	initResp := &pb.PortForwardResponse{
		Message: &pb.PortForwardResponse_Init{
			Init: &pb.PortForwardInit{
				SessionKey: key,
				Cookie:     cookie,
				WorkflowId: workflowID,
				Protocol:   proto,
				RemotePort: int32(remotePort),
			},
		},
	}
	if err := stream.Send(initResp); err != nil {
		return nil, fmt.Errorf("failed to send init: %w", err)
	}

	return &grpcAgentPortForwardStream{stream: stream}, nil
}

// ConnectRsync implements Transport.ConnectRsync for agents
func (t *GRPCAgentTransport) ConnectRsync(ctx context.Context, key, cookie, workflowID string, direction string) (Stream, error) {
	stream, err := t.agent.RegisterRsync(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create agent rsync stream: %w", err)
	}

	// Send init message as RsyncResponse
	initResp := &pb.RsyncResponse{
		Message: &pb.RsyncResponse_Init{
			Init: &pb.RsyncInit{
				SessionKey: key,
				Cookie:     cookie,
				WorkflowId: workflowID,
				Direction:  direction,
			},
		},
	}
	if err := stream.Send(initResp); err != nil {
		return nil, fmt.Errorf("failed to send init: %w", err)
	}

	return &grpcAgentRsyncStream{stream: stream}, nil
}

// Close implements Transport.Close
func (t *GRPCAgentTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.conn != nil {
		return t.conn.Close()
	}
	return nil
}

// grpcAgentExecStream wraps a gRPC agent exec stream
type grpcAgentExecStream struct {
	stream pb.RouterAgentService_RegisterExecClient
	mu     sync.Mutex
	seq    uint64
}

func (s *grpcAgentExecStream) Send(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.seq++
	resp := &pb.ExecResponse{
		Message: &pb.ExecResponse_Data{
			Data: &pb.ExecData{
				Payload: data,
				Seq:     s.seq,
			},
		},
	}
	return s.stream.Send(resp)
}

func (s *grpcAgentExecStream) Recv() ([]byte, error) {
	req, err := s.stream.Recv()
	if err != nil {
		return nil, err
	}

	if data := req.GetData(); data != nil {
		return data.Payload, nil
	} else if req.GetClose() != nil {
		return nil, io.EOF
	}

	return nil, fmt.Errorf("unexpected request type")
}

func (s *grpcAgentExecStream) Close() error {
	resp := &pb.ExecResponse{
		Message: &pb.ExecResponse_Close{
			Close: &pb.ExecClose{
				ExitCode: 0,
			},
		},
	}
	if err := s.stream.Send(resp); err != nil {
		log.Printf("Error sending close: %v", err)
	}
	return s.stream.CloseSend()
}

// grpcAgentPortForwardStream wraps a gRPC agent port-forward stream
type grpcAgentPortForwardStream struct {
	stream pb.RouterAgentService_RegisterPortForwardClient
	mu     sync.Mutex
	seq    uint64
}

func (s *grpcAgentPortForwardStream) Send(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.seq++
	resp := &pb.PortForwardResponse{
		Message: &pb.PortForwardResponse_Data{
			Data: &pb.PortForwardData{
				Payload: data,
				Seq:     s.seq,
			},
		},
	}
	return s.stream.Send(resp)
}

func (s *grpcAgentPortForwardStream) Recv() ([]byte, error) {
	req, err := s.stream.Recv()
	if err != nil {
		return nil, err
	}

	if data := req.GetData(); data != nil {
		return data.Payload, nil
	} else if req.GetClose() != nil {
		return nil, io.EOF
	}

	return nil, fmt.Errorf("unexpected request type")
}

func (s *grpcAgentPortForwardStream) Close() error {
	resp := &pb.PortForwardResponse{
		Message: &pb.PortForwardResponse_Close{
			Close: &pb.PortForwardClose{
				Reason: "agent closed",
			},
		},
	}
	if err := s.stream.Send(resp); err != nil {
		log.Printf("Error sending close: %v", err)
	}
	return s.stream.CloseSend()
}

// grpcAgentRsyncStream wraps a gRPC agent rsync stream
type grpcAgentRsyncStream struct {
	stream pb.RouterAgentService_RegisterRsyncClient
	mu     sync.Mutex
	seq    uint64
}

func (s *grpcAgentRsyncStream) Send(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.seq++
	resp := &pb.RsyncResponse{
		Message: &pb.RsyncResponse_Data{
			Data: &pb.RsyncData{
				Payload: data,
				Seq:     s.seq,
			},
		},
	}
	return s.stream.Send(resp)
}

func (s *grpcAgentRsyncStream) Recv() ([]byte, error) {
	req, err := s.stream.Recv()
	if err != nil {
		return nil, err
	}

	if data := req.GetData(); data != nil {
		return data.Payload, nil
	} else if req.GetClose() != nil {
		return nil, io.EOF
	}

	return nil, fmt.Errorf("unexpected request type")
}

func (s *grpcAgentRsyncStream) Close() error {
	resp := &pb.RsyncResponse{
		Message: &pb.RsyncResponse_Close{
			Close: &pb.RsyncClose{
				Success: true,
			},
		},
	}
	if err := s.stream.Send(resp); err != nil {
		log.Printf("Error sending close: %v", err)
	}
	return s.stream.CloseSend()
}
