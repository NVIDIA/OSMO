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
	"fmt"
	"io"
	"sync"
	"testing"
)

// mockStream implements tunnelStream for testing.
type mockStream struct {
	sendCh chan []byte
	recvCh chan []byte
	closed bool
	mu     sync.Mutex
}

func newMockStream() *mockStream {
	return &mockStream{
		sendCh: make(chan []byte, 10),
		recvCh: make(chan []byte, 10),
	}
}

func (m *mockStream) SendPayload(p []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return io.EOF
	}
	m.sendCh <- p
	return nil
}

func (m *mockStream) RecvPayload() ([]byte, error) {
	data, ok := <-m.recvCh
	if !ok {
		return nil, io.EOF
	}
	return data, nil
}

func (m *mockStream) CloseSend() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	return nil
}

// queuePayload adds a payload to be received.
func (m *mockStream) queuePayload(data []byte) {
	m.recvCh <- data
}

// closeRecv closes the receive channel (simulates EOF).
func (m *mockStream) closeRecv() {
	close(m.recvCh)
}

// getSent returns the next sent payload or nil if none.
func (m *mockStream) getSent() []byte {
	select {
	case data := <-m.sendCh:
		return data
	default:
		return nil
	}
}

// TestTunnelWrite tests the Write operation.
func TestTunnelWrite(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
		closed: make(chan struct{}),
	}

	n, err := tunnel.Write([]byte("hello"))
	if err != nil {
		t.Fatalf("Write error: %v", err)
	}
	if n != 5 {
		t.Errorf("Write returned %d, want 5", n)
	}

	sent := stream.getSent()
	if sent == nil {
		t.Fatal("no payload sent")
	}
	if string(sent) != "hello" {
		t.Errorf("payload = %q, want %q", sent, "hello")
	}
}

// TestTunnelRead tests the Read operation.
func TestTunnelRead(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
		closed: make(chan struct{}),
	}

	stream.queuePayload([]byte("world"))

	buf := make([]byte, 10)
	n, err := tunnel.Read(buf)
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	if n != 5 || string(buf[:n]) != "world" {
		t.Errorf("Read: n=%d, data=%q, want n=5, data=world", n, buf[:n])
	}
}

// TestTunnelReadEOF tests that Read returns EOF when stream closes.
func TestTunnelReadEOF(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
		closed: make(chan struct{}),
	}

	stream.closeRecv()

	buf := make([]byte, 10)
	_, err := tunnel.Read(buf)
	if err != io.EOF {
		t.Errorf("expected EOF, got %v", err)
	}
}

// TestTunnelReadExact tests reading with an exact-sized buffer.
func TestTunnelReadExact(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
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

// TestTunnelClose tests close behavior.
func TestTunnelClose(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream: stream,
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

// Benchmark payload sizes to test.
var benchPayloadSizes = []int{64, 1024, 16 * 1024, 64 * 1024}

// BenchmarkWrite benchmarks Write at various payload sizes.
func BenchmarkWrite(b *testing.B) {
	for _, size := range benchPayloadSizes {
		b.Run(fmt.Sprintf("size=%d", size), func(b *testing.B) {
			stream := newMockStream()
			tunnel := &Tunnel{
				stream: stream,
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
				tunnel.Write(payload)
			}
		})
	}
}
