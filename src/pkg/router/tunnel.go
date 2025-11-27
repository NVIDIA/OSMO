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
// The tunnel implements io.ReadWriteCloser for easy integration with existing code.
// For zero-copy reads, use Recv() which returns the payload slice directly.
package router

import (
	"context"
	"errors"
	"io"
	"sync"

	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc"

	pb "go.corp.nvidia.com/osmo/proto/router"
)

// DefaultBufferSize is the default buffer size for copying data.
const DefaultBufferSize = 32 * 1024 // 32KB

// bufferPool reduces allocations by reusing buffers for ReadFrom/WriteTo.
var bufferPool = sync.Pool{
	New: func() any {
		buf := make([]byte, DefaultBufferSize)
		return &buf
	},
}

func getBuffer() []byte {
	return *bufferPool.Get().(*[]byte)
}

func putBuffer(buf []byte) {
	bufferPool.Put(&buf)
}

// Role indicates whether this is a user or agent connection.
type Role int

const (
	// RoleUser connects via RouterUserService (CLI side).
	RoleUser Role = iota
	// RoleAgent connects via RouterAgentService (agent side).
	RoleAgent
)

// TunnelConfig holds configuration for establishing a tunnel.
type TunnelConfig struct {
	// SessionKey is the unique identifier for this tunnel session.
	SessionKey string

	// Cookie is the session cookie for authentication.
	Cookie string

	// WorkflowID is the workflow this tunnel belongs to.
	WorkflowID string

	// Operation specifies what type of tunnel to establish.
	Operation Operation
}

// Operation is the interface for tunnel operations.
type Operation interface {
	toProto() *pb.TunnelInit
}

// ExecOperation creates an exec tunnel.
type ExecOperation struct {
	Command string
}

func (e ExecOperation) toProto() *pb.TunnelInit {
	return &pb.TunnelInit{
		Operation: &pb.TunnelInit_Exec{
			Exec: &pb.ExecOperation{Command: e.Command},
		},
	}
}

// PortForwardOperation creates a port forward tunnel.
type PortForwardOperation struct {
	Protocol pb.PortForwardOperation_Protocol
	Port     int32
}

func (p PortForwardOperation) toProto() *pb.TunnelInit {
	return &pb.TunnelInit{
		Operation: &pb.TunnelInit_PortForward{
			PortForward: &pb.PortForwardOperation{
				Protocol: p.Protocol,
				Port:     p.Port,
			},
		},
	}
}

// RsyncOperation creates an rsync tunnel.
type RsyncOperation struct{}

func (r RsyncOperation) toProto() *pb.TunnelInit {
	return &pb.TunnelInit{
		Operation: &pb.TunnelInit_Rsync{
			Rsync: &pb.RsyncOperation{},
		},
	}
}

// WebSocketOperation creates a websocket tunnel.
type WebSocketOperation struct{}

func (w WebSocketOperation) toProto() *pb.TunnelInit {
	return &pb.TunnelInit{
		Operation: &pb.TunnelInit_WebSocket{
			WebSocket: &pb.WebSocketOperation{},
		},
	}
}

// tunnelStream abstracts over user and agent tunnel streams.
type tunnelStream interface {
	Send(*pb.TunnelFrame) error
	Recv() (*pb.TunnelFrame, error)
	CloseSend() error
}

// Tunnel provides bidirectional streaming over a router tunnel.
// It implements io.ReadWriteCloser for easy integration with existing code.
//
// For zero-copy reads, use Recv() which returns the payload slice directly
// from the received protobuf frame without copying.
type Tunnel struct {
	stream tunnelStream
	config TunnelConfig
	role   Role

	// Read state - holds unconsumed portion of last received payload.
	// This is a slice into the original protobuf frame (no copy).
	pending []byte
	readMu  sync.Mutex

	// Close state
	closeOnce sync.Once
	closed    chan struct{}
}

// Dial establishes a tunnel connection to the router.
// The caller must call Close() when done.
func Dial(ctx context.Context, conn *grpc.ClientConn, role Role, config TunnelConfig) (*Tunnel, error) {
	var stream tunnelStream
	var err error

	switch role {
	case RoleUser:
		client := pb.NewRouterUserServiceClient(conn)
		stream, err = client.Tunnel(ctx)
	case RoleAgent:
		client := pb.NewRouterAgentServiceClient(conn)
		stream, err = client.Tunnel(ctx)
	default:
		return nil, errors.New("invalid role")
	}

	if err != nil {
		return nil, err
	}

	t := &Tunnel{
		stream: stream,
		config: config,
		role:   role,
		closed: make(chan struct{}),
	}

	// Send init frame
	if err := t.sendInit(); err != nil {
		return nil, err
	}

	return t, nil
}

// sendInit sends the TunnelInit frame to establish the session.
func (t *Tunnel) sendInit() error {
	init := t.config.Operation.toProto()
	init.SessionKey = t.config.SessionKey
	init.Cookie = t.config.Cookie
	init.WorkflowId = t.config.WorkflowID

	return t.stream.Send(&pb.TunnelFrame{
		Frame: &pb.TunnelFrame_Init{Init: init},
	})
}

// Recv receives the next payload from the tunnel.
// Returns the payload slice directly from the protobuf frame (zero-copy).
//
// IMPORTANT: The returned slice is only valid until the next call to Recv or Read.
// If you need to retain the data, copy it.
//
// Returns io.EOF when the tunnel is closed.
func (t *Tunnel) Recv() ([]byte, error) {
	t.readMu.Lock()
	defer t.readMu.Unlock()

	// Return pending data first
	if len(t.pending) > 0 {
		data := t.pending
		t.pending = nil
		return data, nil
	}

	return t.recvLocked()
}

// recvLocked receives data with lock held.
func (t *Tunnel) recvLocked() ([]byte, error) {
	frame, err := t.stream.Recv()
	if err != nil {
		return nil, err
	}

	// Extract payload directly - no copy
	if p, ok := frame.Frame.(*pb.TunnelFrame_Payload); ok {
		return p.Payload, nil
	}

	// Skip unexpected frame types (e.g., init after first), try again
	return t.recvLocked()
}

// Read reads data from the tunnel into p.
// Implements io.Reader.
//
// Note: This copies data into p. For zero-copy, use Recv() instead.
func (t *Tunnel) Read(p []byte) (int, error) {
	t.readMu.Lock()
	defer t.readMu.Unlock()

	// Consume pending data first
	if len(t.pending) > 0 {
		n := copy(p, t.pending)
		t.pending = t.pending[n:]
		return n, nil
	}

	// Receive new data
	data, err := t.recvLocked()
	if err != nil {
		return 0, err
	}

	// Copy to caller's buffer, save remainder
	n := copy(p, data)
	if n < len(data) {
		t.pending = data[n:]
	}
	return n, nil
}

// Send sends a payload through the tunnel.
func (t *Tunnel) Send(payload []byte) error {
	return t.stream.Send(&pb.TunnelFrame{
		Frame: &pb.TunnelFrame_Payload{Payload: payload},
	})
}

// Write writes data to the tunnel.
// Implements io.Writer.
func (t *Tunnel) Write(p []byte) (int, error) {
	if err := t.Send(p); err != nil {
		return 0, err
	}
	return len(p), nil
}

// WriteTo implements io.WriterTo for optimized copying.
// Writes all data from the tunnel to w until EOF or error.
func (t *Tunnel) WriteTo(w io.Writer) (int64, error) {
	var total int64

	for {
		data, err := t.Recv()
		if err != nil {
			if err == io.EOF {
				return total, nil
			}
			return total, err
		}

		n, werr := w.Write(data)
		total += int64(n)
		if werr != nil {
			return total, werr
		}
	}
}

// ReadFrom implements io.ReaderFrom for optimized copying.
// Reads all data from r and sends through tunnel until EOF or error.
func (t *Tunnel) ReadFrom(r io.Reader) (int64, error) {
	buf := getBuffer()
	defer putBuffer(buf)

	var total int64
	for {
		n, err := r.Read(buf)
		if n > 0 {
			if serr := t.Send(buf[:n]); serr != nil {
				return total, serr
			}
			total += int64(n)
		}
		if err != nil {
			if err == io.EOF {
				return total, nil
			}
			return total, err
		}
	}
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

// CopyBidirectional copies data bidirectionally between a tunnel and a local connection.
// It blocks until one side closes or an error occurs, then returns.
//
// This is the common pattern for port forwarding:
//   - Agent: local server <---> tunnel <---> router <---> user
//   - User:  local listen <---> tunnel <---> router <---> agent
//
// Example usage:
//
//	tunnel, _ := router.Dial(ctx, conn, router.RoleAgent, config)
//	localConn, _ := net.Dial("tcp", "localhost:8080")
//	err := router.CopyBidirectional(ctx, tunnel, localConn)
func CopyBidirectional(ctx context.Context, tunnel *Tunnel, local io.ReadWriter) error {
	g, ctx := errgroup.WithContext(ctx)

	// tunnel -> local
	g.Go(func() error {
		return copyToWriter(ctx, local, tunnel)
	})

	// local -> tunnel
	g.Go(func() error {
		return copyToTunnel(ctx, tunnel, local)
	})

	return g.Wait()
}

// copyToWriter copies from tunnel to a writer.
// Uses io.ReaderFrom optimization if available.
func copyToWriter(ctx context.Context, dst io.Writer, src *Tunnel) error {
	// Check if dst implements ReaderFrom (e.g., net.TCPConn)
	if rf, ok := dst.(io.ReaderFrom); ok {
		_, err := rf.ReadFrom(readerWithContext{ctx: ctx, r: src})
		return err
	}

	// Fallback to pooled buffer copy
	buf := getBuffer()
	defer putBuffer(buf)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return werr
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

// copyToTunnel copies from a reader to tunnel.
// Uses io.WriterTo optimization if available.
func copyToTunnel(ctx context.Context, dst *Tunnel, src io.Reader) error {
	// Check if src implements WriterTo (e.g., net.TCPConn, bytes.Buffer)
	if wt, ok := src.(io.WriterTo); ok {
		_, err := wt.WriteTo(writerWithContext{ctx: ctx, w: dst})
		return err
	}

	// Fallback to pooled buffer copy
	buf := getBuffer()
	defer putBuffer(buf)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return werr
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

// readerWithContext wraps a reader with context cancellation.
type readerWithContext struct {
	ctx context.Context
	r   io.Reader
}

func (r readerWithContext) Read(p []byte) (int, error) {
	select {
	case <-r.ctx.Done():
		return 0, r.ctx.Err()
	default:
		return r.r.Read(p)
	}
}

// writerWithContext wraps a writer with context cancellation.
type writerWithContext struct {
	ctx context.Context
	w   io.Writer
}

func (w writerWithContext) Write(p []byte) (int, error) {
	select {
	case <-w.ctx.Done():
		return 0, w.ctx.Err()
	default:
		return w.w.Write(p)
	}
}
