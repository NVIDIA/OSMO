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

package router

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"sync"
	"testing"

	pb "go.corp.nvidia.com/osmo/proto/router"
)

// mockStream implements tunnelStream for testing.
type mockStream struct {
	sendCh chan *pb.TunnelFrame
	recvCh chan *pb.TunnelFrame
	closed bool
	mu     sync.Mutex
}

func newMockStream() *mockStream {
	return &mockStream{
		sendCh: make(chan *pb.TunnelFrame, 10),
		recvCh: make(chan *pb.TunnelFrame, 10),
	}
}

func (m *mockStream) Send(frame *pb.TunnelFrame) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return io.EOF
	}
	m.sendCh <- frame
	return nil
}

func (m *mockStream) Recv() (*pb.TunnelFrame, error) {
	frame, ok := <-m.recvCh
	if !ok {
		return nil, io.EOF
	}
	return frame, nil
}

func (m *mockStream) CloseSend() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	return nil
}

// queuePayload adds a payload frame to be received.
func (m *mockStream) queuePayload(data []byte) {
	m.recvCh <- &pb.TunnelFrame{
		Frame: &pb.TunnelFrame_Payload{Payload: data},
	}
}

// closeRecv closes the receive channel (simulates EOF).
func (m *mockStream) closeRecv() {
	close(m.recvCh)
}

// getSent returns the next sent frame or nil if none.
func (m *mockStream) getSent() *pb.TunnelFrame {
	select {
	case frame := <-m.sendCh:
		return frame
	default:
		return nil
	}
}

// TestTunnelSend tests the Send operation.
func TestTunnelSend(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
		config: TunnelConfig{SessionKey: "test"},
		closed: make(chan struct{}),
	}

	err := tunnel.Send([]byte("hello"))
	if err != nil {
		t.Fatalf("Send error: %v", err)
	}

	sent := stream.getSent()
	if sent == nil {
		t.Fatal("no frame sent")
	}
	if string(sent.GetPayload()) != "hello" {
		t.Errorf("payload = %q, want %q", sent.GetPayload(), "hello")
	}
}

// TestTunnelRecv tests the Recv operation.
func TestTunnelRecv(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
		config: TunnelConfig{SessionKey: "test"},
		closed: make(chan struct{}),
	}

	stream.queuePayload([]byte("world"))

	data, err := tunnel.Recv()
	if err != nil {
		t.Fatalf("Recv error: %v", err)
	}
	if string(data) != "world" {
		t.Errorf("received = %q, want %q", data, "world")
	}
}

// TestTunnelRecvEOF tests that Recv returns EOF when stream closes.
func TestTunnelRecvEOF(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
		config: TunnelConfig{SessionKey: "test"},
		closed: make(chan struct{}),
	}

	stream.closeRecv()

	_, err := tunnel.Recv()
	if err != io.EOF {
		t.Errorf("expected EOF, got %v", err)
	}
}

// TestTunnelWrite tests the io.Writer interface.
func TestTunnelWrite(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
		config: TunnelConfig{SessionKey: "test"},
		closed: make(chan struct{}),
	}

	n, err := tunnel.Write([]byte("write test"))
	if err != nil {
		t.Fatalf("Write error: %v", err)
	}
	if n != 10 {
		t.Errorf("Write returned %d, want 10", n)
	}

	sent := stream.getSent()
	if sent == nil {
		t.Fatal("no frame sent")
	}
	if string(sent.GetPayload()) != "write test" {
		t.Errorf("payload = %q, want %q", sent.GetPayload(), "write test")
	}
}

// TestTunnelReadExact tests reading with an exact-sized buffer.
func TestTunnelReadExact(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
		config: TunnelConfig{SessionKey: "test"},
		closed: make(chan struct{}),
	}

	stream.queuePayload([]byte("hello"))

	buf := make([]byte, 5)
	n, err := tunnel.Read(buf)
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	if n != 5 {
		t.Errorf("Read returned %d, want 5", n)
	}
	if string(buf) != "hello" {
		t.Errorf("buf = %q, want %q", buf, "hello")
	}
}

// TestTunnelReadPartial tests reading with a smaller buffer (partial reads).
func TestTunnelReadPartial(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
		config: TunnelConfig{SessionKey: "test"},
		closed: make(chan struct{}),
	}

	stream.queuePayload([]byte("helloworld"))

	buf := make([]byte, 5)

	// First read
	n, err := tunnel.Read(buf)
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	if n != 5 || string(buf) != "hello" {
		t.Errorf("first read: n=%d, buf=%q, want n=5, buf=hello", n, buf)
	}

	// Second read (from pending)
	n, err = tunnel.Read(buf)
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	if n != 5 || string(buf) != "world" {
		t.Errorf("second read: n=%d, buf=%q, want n=5, buf=world", n, buf)
	}
}

// TestTunnelWriteTo tests io.WriterTo interface.
func TestTunnelWriteTo(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
		config: TunnelConfig{SessionKey: "test"},
		closed: make(chan struct{}),
	}

	// Queue some payloads then close
	stream.queuePayload([]byte("one"))
	stream.queuePayload([]byte("two"))
	stream.queuePayload([]byte("three"))
	stream.closeRecv()

	var buf bytes.Buffer
	n, err := tunnel.WriteTo(&buf)
	if err != nil {
		t.Fatalf("WriteTo error: %v", err)
	}
	if n != 11 { // "one" + "two" + "three"
		t.Errorf("WriteTo returned %d, want 11", n)
	}
	if buf.String() != "onetwothree" {
		t.Errorf("buf = %q, want %q", buf.String(), "onetwothree")
	}
}

// TestTunnelReadFrom tests io.ReaderFrom interface.
func TestTunnelReadFrom(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
		config: TunnelConfig{SessionKey: "test"},
		closed: make(chan struct{}),
	}

	input := bytes.NewReader([]byte("hello world from reader"))
	n, err := tunnel.ReadFrom(input)
	if err != nil {
		t.Fatalf("ReadFrom error: %v", err)
	}
	if n != 23 {
		t.Errorf("ReadFrom returned %d, want 23", n)
	}

	// Verify frames were sent
	sent := stream.getSent()
	if sent == nil {
		t.Fatal("no frame sent")
	}
	if len(sent.GetPayload()) == 0 {
		t.Error("empty payload sent")
	}
}

// TestTunnelClose tests close behavior.
func TestTunnelClose(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
		config: TunnelConfig{SessionKey: "test"},
		closed: make(chan struct{}),
	}

	// Close should work
	err := tunnel.Close()
	if err != nil {
		t.Fatalf("Close error: %v", err)
	}

	// Done channel should be closed
	select {
	case <-tunnel.Done():
		// OK
	default:
		t.Error("Done channel not closed")
	}

	// Double close should be safe
	err = tunnel.Close()
	if err != nil {
		t.Fatalf("second Close error: %v", err)
	}
}

// TestCopyBidirectional tests bidirectional copy.
func TestCopyBidirectional(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
		config: TunnelConfig{SessionKey: "test"},
		closed: make(chan struct{}),
	}

	// Create a mock local connection using pipes
	localRead, localWrite := io.Pipe()
	local := &mockReadWriter{
		Reader: localRead,
		Writer: localWrite,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start bidirectional copy
	done := make(chan error, 1)
	go func() {
		done <- CopyBidirectional(ctx, tunnel, local)
	}()

	// Simulate tunnel -> local: queue a payload
	stream.queuePayload([]byte("from tunnel"))

	// Read from local
	buf := make([]byte, 20)
	n, err := localRead.Read(buf)
	if err != nil {
		t.Fatalf("read from local error: %v", err)
	}
	if string(buf[:n]) != "from tunnel" {
		t.Errorf("read = %q, want %q", buf[:n], "from tunnel")
	}

	// Close to end the test
	stream.closeRecv()
	localWrite.Close()

	// Wait for copy to finish
	cancel()
}

// mockReadWriter wraps separate reader and writer.
type mockReadWriter struct {
	io.Reader
	io.Writer
}

// TestOperationTypes tests operation type conversions.
func TestOperationTypes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		op   Operation
		want string
	}{
		{
			name: "exec",
			op:   ExecOperation{Command: "ls"},
			want: "exec",
		},
		{
			name: "port_forward",
			op:   PortForwardOperation{Protocol: pb.PortForwardOperation_TCP, Port: 8080},
			want: "port_forward",
		},
		{
			name: "rsync",
			op:   RsyncOperation{},
			want: "rsync",
		},
		{
			name: "websocket",
			op:   WebSocketOperation{},
			want: "web_socket",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			init := tt.op.toProto()
			if init == nil {
				t.Fatal("toProto returned nil")
			}

			// Verify the operation is set
			switch tt.name {
			case "exec":
				if init.GetExec() == nil {
					t.Error("Exec operation not set")
				}
				if init.GetExec().Command != "ls" {
					t.Errorf("Command = %q, want %q", init.GetExec().Command, "ls")
				}
			case "port_forward":
				if init.GetPortForward() == nil {
					t.Error("PortForward operation not set")
				}
				if init.GetPortForward().Port != 8080 {
					t.Errorf("Port = %d, want 8080", init.GetPortForward().Port)
				}
			case "rsync":
				if init.GetRsync() == nil {
					t.Error("Rsync operation not set")
				}
			case "websocket":
				if init.GetWebSocket() == nil {
					t.Error("WebSocket operation not set")
				}
			}
		})
	}
}

// TestBufferPool tests buffer pool functionality.
func TestBufferPool(t *testing.T) {
	t.Parallel()

	// Get a buffer
	buf1 := getBuffer()
	if buf1 == nil {
		t.Fatal("getBuffer returned nil")
	}
	if len(buf1) != DefaultBufferSize {
		t.Errorf("buffer size = %d, want %d", len(buf1), DefaultBufferSize)
	}

	// Put it back
	putBuffer(buf1)

	// Get another - may or may not be the same
	buf2 := getBuffer()
	if buf2 == nil {
		t.Fatal("second getBuffer returned nil")
	}
	if len(buf2) != DefaultBufferSize {
		t.Errorf("buffer size = %d, want %d", len(buf2), DefaultBufferSize)
	}
}

// Benchmark payload sizes to test.
var benchPayloadSizes = []int{64, 1024, 16 * 1024, 64 * 1024}

// BenchmarkSend benchmarks Send at various payload sizes.
func BenchmarkSend(b *testing.B) {
	for _, size := range benchPayloadSizes {
		b.Run(fmt.Sprintf("size=%d", size), func(b *testing.B) {
			stream := newMockStream()
			tunnel := &Tunnel{
				stream: stream,
				config: TunnelConfig{SessionKey: "test"},
				closed: make(chan struct{}),
			}

			payload := make([]byte, size)

			// Drain sent messages in background
			go func() {
				for range stream.sendCh {
				}
			}()

			b.SetBytes(int64(size))
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				tunnel.Send(payload)
			}
		})
	}
}
