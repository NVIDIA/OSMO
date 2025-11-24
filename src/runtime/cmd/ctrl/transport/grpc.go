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

// GRPCTransport implements Transport using gRPC
type GRPCTransport struct {
	config Config
	conn   *grpc.ClientConn
	client pb.RouterClientServiceClient
	mu     sync.Mutex
}

// NewGRPCTransport creates a new gRPC transport
func NewGRPCTransport(config Config) (*GRPCTransport, error) {
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

	client := pb.NewRouterClientServiceClient(conn)

	return &GRPCTransport{
		config: config,
		conn:   conn,
		client: client,
	}, nil
}

// ConnectExec implements Transport.ConnectExec
func (t *GRPCTransport) ConnectExec(ctx context.Context, key, cookie, workflowID string) (Stream, error) {
	stream, err := t.client.Exec(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create exec stream: %w", err)
	}

	// Send init message
	initReq := &pb.ExecRequest{
		Message: &pb.ExecRequest_Init{
			Init: &pb.ExecInit{
				SessionKey: key,
				Cookie:     cookie,
				WorkflowId: workflowID,
			},
		},
	}
	if err := stream.Send(initReq); err != nil {
		return nil, fmt.Errorf("failed to send init: %w", err)
	}

	return &grpcExecStream{stream: stream}, nil
}

// ConnectPortForward implements Transport.ConnectPortForward
func (t *GRPCTransport) ConnectPortForward(ctx context.Context, key, cookie, workflowID string, protocol PortForwardProtocol, remotePort int) (Stream, error) {
	stream, err := t.client.PortForward(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create port-forward stream: %w", err)
	}

	// Determine protocol
	proto := pb.Protocol_PROTOCOL_TCP
	if protocol == ProtocolUDP {
		proto = pb.Protocol_PROTOCOL_UDP
	}

	// Send init message
	initReq := &pb.PortForwardRequest{
		Message: &pb.PortForwardRequest_Init{
			Init: &pb.PortForwardInit{
				SessionKey: key,
				Cookie:     cookie,
				WorkflowId: workflowID,
				Protocol:   proto,
				RemotePort: int32(remotePort),
			},
		},
	}
	if err := stream.Send(initReq); err != nil {
		return nil, fmt.Errorf("failed to send init: %w", err)
	}

	return &grpcPortForwardStream{stream: stream}, nil
}

// ConnectRsync implements Transport.ConnectRsync
func (t *GRPCTransport) ConnectRsync(ctx context.Context, key, cookie, workflowID string, direction string) (Stream, error) {
	stream, err := t.client.Rsync(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create rsync stream: %w", err)
	}

	// Send init message
	initReq := &pb.RsyncRequest{
		Message: &pb.RsyncRequest_Init{
			Init: &pb.RsyncInit{
				SessionKey: key,
				Cookie:     cookie,
				WorkflowId: workflowID,
				Direction:  direction,
			},
		},
	}
	if err := stream.Send(initReq); err != nil {
		return nil, fmt.Errorf("failed to send init: %w", err)
	}

	return &grpcRsyncStream{stream: stream}, nil
}

// Close implements Transport.Close
func (t *GRPCTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.conn != nil {
		return t.conn.Close()
	}
	return nil
}

// grpcExecStream wraps a gRPC exec stream
type grpcExecStream struct {
	stream pb.RouterClientService_ExecClient
	mu     sync.Mutex
	seq    uint64
}

func (s *grpcExecStream) Send(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.seq++
	req := &pb.ExecRequest{
		Message: &pb.ExecRequest_Data{
			Data: &pb.ExecData{
				Payload: data,
				Seq:     s.seq,
			},
		},
	}
	return s.stream.Send(req)
}

func (s *grpcExecStream) Recv() ([]byte, error) {
	resp, err := s.stream.Recv()
	if err != nil {
		return nil, err
	}

	if data := resp.GetData(); data != nil {
		return data.Payload, nil
	} else if respError := resp.GetError(); respError != nil {
		return nil, fmt.Errorf("remote error: %s", respError.Message)
	} else if resp.GetClose() != nil {
		return nil, io.EOF
	}

	return nil, fmt.Errorf("unexpected response type")
}

func (s *grpcExecStream) Close() error {
	req := &pb.ExecRequest{
		Message: &pb.ExecRequest_Close{
			Close: &pb.ExecClose{},
		},
	}
	if err := s.stream.Send(req); err != nil {
		log.Printf("Error sending close: %v", err)
	}
	return s.stream.CloseSend()
}

// grpcPortForwardStream wraps a gRPC port-forward stream
type grpcPortForwardStream struct {
	stream pb.RouterClientService_PortForwardClient
	mu     sync.Mutex
	seq    uint64
}

func (s *grpcPortForwardStream) Send(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.seq++
	req := &pb.PortForwardRequest{
		Message: &pb.PortForwardRequest_Data{
			Data: &pb.PortForwardData{
				Payload: data,
				Seq:     s.seq,
			},
		},
	}
	return s.stream.Send(req)
}

func (s *grpcPortForwardStream) Recv() ([]byte, error) {
	resp, err := s.stream.Recv()
	if err != nil {
		return nil, err
	}

	if data := resp.GetData(); data != nil {
		return data.Payload, nil
	} else if respError := resp.GetError(); respError != nil {
		return nil, fmt.Errorf("remote error: %s", respError.Message)
	} else if resp.GetClose() != nil {
		return nil, io.EOF
	}

	return nil, fmt.Errorf("unexpected response type")
}

func (s *grpcPortForwardStream) Close() error {
	req := &pb.PortForwardRequest{
		Message: &pb.PortForwardRequest_Close{
			Close: &pb.PortForwardClose{Reason: "client closed"},
		},
	}
	if err := s.stream.Send(req); err != nil {
		log.Printf("Error sending close: %v", err)
	}
	return s.stream.CloseSend()
}

// grpcRsyncStream wraps a gRPC rsync stream
type grpcRsyncStream struct {
	stream pb.RouterClientService_RsyncClient
	mu     sync.Mutex
	seq    uint64
}

func (s *grpcRsyncStream) Send(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.seq++
	req := &pb.RsyncRequest{
		Message: &pb.RsyncRequest_Data{
			Data: &pb.RsyncData{
				Payload: data,
				Seq:     s.seq,
			},
		},
	}
	return s.stream.Send(req)
}

func (s *grpcRsyncStream) Recv() ([]byte, error) {
	resp, err := s.stream.Recv()
	if err != nil {
		return nil, err
	}

	if data := resp.GetData(); data != nil {
		return data.Payload, nil
	} else if respError := resp.GetError(); respError != nil {
		return nil, fmt.Errorf("remote error: %s", respError.Message)
	} else if resp.GetClose() != nil {
		return nil, io.EOF
	}

	return nil, fmt.Errorf("unexpected response type")
}

func (s *grpcRsyncStream) Close() error {
	req := &pb.RsyncRequest{
		Message: &pb.RsyncRequest_Close{
			Close: &pb.RsyncClose{Success: true},
		},
	}
	if err := s.stream.Send(req); err != nil {
		log.Printf("Error sending close: %v", err)
	}
	return s.stream.CloseSend()
}
