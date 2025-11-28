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
	"errors"
	"io"
	"sync"
	"testing"
)

// mockStream implements tunnelStream for testing.
type mockStream struct {
	sendCh   chan []byte
	recvCh   chan []byte
	closed   bool
	sendErr  error // Error to return on next SendPayload
	closeErr error // Error to return on CloseSend
	mu       sync.Mutex
}

func newMockStream() *mockStream {
	return &mockStream{
		sendCh: make(chan []byte, 100), // Large buffer to prevent blocking
		recvCh: make(chan []byte, 100),
	}
}

func (m *mockStream) SendPayload(p []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sendErr != nil {
		return m.sendErr
	}
	if m.closed {
		return io.EOF
	}
	// Non-blocking send with buffer overflow check
	select {
	case m.sendCh <- p:
		return nil
	default:
		return errors.New("send buffer full")
	}
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
	return m.closeErr
}

// setSendError sets an error to be returned on SendPayload.
func (m *mockStream) setSendError(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sendErr = err
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

// drainSent returns all sent payloads.
func (m *mockStream) drainSent() [][]byte {
	var result [][]byte
	for {
		select {
		case data := <-m.sendCh:
			result = append(result, data)
		default:
			return result
		}
	}
}

// setupTestTunnel creates a Tunnel with a mock stream for testing.
func setupTestTunnel() (*Tunnel, *mockStream) {
	stream := newMockStream()
	return &Tunnel{
		stream: stream,
		closed: make(chan struct{}),
	}, stream
}

// TestTunnelWrite tests the Write operation.
func TestTunnelWrite(t *testing.T) {
	t.Parallel()

	tunnel, stream := setupTestTunnel()

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

// TestTunnelWriteError tests Write error handling.
func TestTunnelWriteError(t *testing.T) {
	t.Parallel()

	tunnel, stream := setupTestTunnel()
	testErr := errors.New("send failed")
	stream.setSendError(testErr)

	n, err := tunnel.Write([]byte("hello"))
	if err != testErr {
		t.Errorf("expected error %v, got %v", testErr, err)
	}
	if n != 0 {
		t.Errorf("expected n=0 on error, got %d", n)
	}
}

// TestTunnelWriteEmpty tests writing empty data.
func TestTunnelWriteEmpty(t *testing.T) {
	t.Parallel()

	tunnel, _ := setupTestTunnel()

	n, err := tunnel.Write([]byte{})
	if err != nil {
		t.Fatalf("Write error: %v", err)
	}
	if n != 0 {
		t.Errorf("Write returned %d, want 0", n)
	}
}

// TestTunnelRead tests the Read operation.
func TestTunnelRead(t *testing.T) {
	t.Parallel()

	tunnel, stream := setupTestTunnel()
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

	tunnel, stream := setupTestTunnel()
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

	tunnel, stream := setupTestTunnel()
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

	tunnel, stream := setupTestTunnel()
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

// TestTunnelReadZeroBuffer tests Read with zero-length buffer.
func TestTunnelReadZeroBuffer(t *testing.T) {
	t.Parallel()

	tunnel, stream := setupTestTunnel()
	stream.queuePayload([]byte("data"))

	// Reading with zero buffer should return 0, nil (per io.Reader contract)
	buf := make([]byte, 0)
	n, err := tunnel.Read(buf)
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	if n != 0 {
		t.Errorf("Read returned %d, want 0", n)
	}
}

// TestTunnelClose tests close behavior.
func TestTunnelClose(t *testing.T) {
	t.Parallel()

	tunnel, _ := setupTestTunnel()

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

	// Double close should be safe (idempotent)
	err = tunnel.Close()
	if err != nil {
		t.Fatalf("second Close error: %v", err)
	}
}

// TestTunnelCloseError tests Close error propagation.
func TestTunnelCloseError(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	stream.closeErr = errors.New("close failed")
	tunnel := &Tunnel{
		stream: stream,
		closed: make(chan struct{}),
	}

	err := tunnel.Close()
	if err == nil || err.Error() != "close failed" {
		t.Errorf("expected 'close failed' error, got %v", err)
	}

	// Done should still be closed even on error
	select {
	case <-tunnel.Done():
		// OK
	default:
		t.Error("Done channel not closed after error")
	}
}

// TestTunnelWriteTo tests the WriteTo (io.WriterTo) implementation.
func TestTunnelWriteTo(t *testing.T) {
	t.Parallel()

	tunnel, stream := setupTestTunnel()

	// Queue some payloads
	stream.queuePayload([]byte("hello"))
	stream.queuePayload([]byte("world"))
	stream.closeRecv()

	// Use a bytes.Buffer as destination
	var buf bytes.Buffer
	n, err := tunnel.WriteTo(&buf)
	if err != nil {
		t.Fatalf("WriteTo error: %v", err)
	}
	if n != 10 {
		t.Errorf("WriteTo returned %d, want 10", n)
	}
	if buf.String() != "helloworld" {
		t.Errorf("buf = %q, want %q", buf.String(), "helloworld")
	}
}

// TestTunnelWriteToWithPending tests WriteTo when there's pending data.
func TestTunnelWriteToWithPending(t *testing.T) {
	t.Parallel()

	stream := newMockStream()
	tunnel := &Tunnel{
		stream:  stream,
		pending: []byte("leftover"),
		closed:  make(chan struct{}),
	}

	// Queue more data
	stream.queuePayload([]byte("fresh"))
	stream.closeRecv()

	var buf bytes.Buffer
	n, err := tunnel.WriteTo(&buf)
	if err != nil {
		t.Fatalf("WriteTo error: %v", err)
	}
	if n != 13 {
		t.Errorf("WriteTo returned %d, want 13", n)
	}
	if buf.String() != "leftoverfresh" {
		t.Errorf("buf = %q, want %q", buf.String(), "leftoverfresh")
	}
}

// errorWriter returns an error after writing a specified number of bytes.
type errorWriter struct {
	written int
	limit   int
	err     error
}

func (w *errorWriter) Write(p []byte) (int, error) {
	if w.written >= w.limit {
		return 0, w.err
	}
	n := len(p)
	if w.written+n > w.limit {
		n = w.limit - w.written
	}
	w.written += n
	if w.written >= w.limit {
		return n, w.err
	}
	return n, nil
}

// TestTunnelWriteToWriterError tests WriteTo handles writer errors correctly.
func TestTunnelWriteToWriterError(t *testing.T) {
	t.Parallel()

	tunnel, stream := setupTestTunnel()
	stream.queuePayload([]byte("hello"))
	stream.queuePayload([]byte("world"))
	stream.closeRecv()

	testErr := errors.New("write failed")
	ew := &errorWriter{limit: 3, err: testErr}

	n, err := tunnel.WriteTo(ew)
	if err != testErr {
		t.Errorf("expected error %v, got %v", testErr, err)
	}
	if n != 3 {
		t.Errorf("expected n=3, got %d", n)
	}
}

// slowWriter writes one byte at a time to simulate partial writes.
type slowWriter struct {
	data []byte
}

func (s *slowWriter) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	// Only write one byte at a time
	s.data = append(s.data, p[0])
	return 1, nil
}

// TestTunnelWriteToPartialWrite tests WriteTo handles partial writes correctly.
func TestTunnelWriteToPartialWrite(t *testing.T) {
	t.Parallel()

	tunnel, stream := setupTestTunnel()
	stream.queuePayload([]byte("hello"))
	stream.closeRecv()

	// Use slow writer that only writes one byte at a time
	sw := &slowWriter{}
	n, err := tunnel.WriteTo(sw)
	if err != nil {
		t.Fatalf("WriteTo error: %v", err)
	}
	if n != 5 {
		t.Errorf("WriteTo returned %d, want 5", n)
	}
	if string(sw.data) != "hello" {
		t.Errorf("data = %q, want %q", sw.data, "hello")
	}
}

// TestIOCopyUsesWriterTo verifies that io.Copy uses our WriteTo method.
func TestIOCopyUsesWriterTo(t *testing.T) {
	t.Parallel()

	tunnel, stream := setupTestTunnel()
	stream.queuePayload([]byte("test data"))
	stream.closeRecv()

	var buf bytes.Buffer
	n, err := io.Copy(&buf, tunnel)
	if err != nil {
		t.Fatalf("io.Copy error: %v", err)
	}
	if n != 9 {
		t.Errorf("io.Copy returned %d, want 9", n)
	}
	if buf.String() != "test data" {
		t.Errorf("buf = %q, want %q", buf.String(), "test data")
	}
}

// TestIOCopyToTunnel verifies that io.Copy works for sending data to tunnel.
func TestIOCopyToTunnel(t *testing.T) {
	t.Parallel()

	tunnel, stream := setupTestTunnel()
	src := bytes.NewReader([]byte("test data"))

	// io.Copy will use tunnel.Write (no ReaderFrom needed - Write is already zero-copy)
	n, err := io.Copy(tunnel, src)
	if err != nil {
		t.Fatalf("io.Copy error: %v", err)
	}
	if n != 9 {
		t.Errorf("io.Copy returned %d, want 9", n)
	}

	// Verify sent data
	var received []byte
	for _, data := range stream.drainSent() {
		received = append(received, data...)
	}
	if string(received) != "test data" {
		t.Errorf("received = %q, want %q", received, "test data")
	}
}

// TestTunnelInterfaceCompliance verifies all interface implementations.
func TestTunnelInterfaceCompliance(t *testing.T) {
	t.Parallel()

	tunnel, _ := setupTestTunnel()

	// Verify interfaces at runtime (compile-time checks are in tunnel.go)
	var _ io.Reader = tunnel
	var _ io.Writer = tunnel
	var _ io.Closer = tunnel
	var _ io.WriterTo = tunnel
	// Note: We intentionally don't implement io.ReaderFrom.
	// Write() is already zero-copy, so ReaderFrom would add overhead.
}
