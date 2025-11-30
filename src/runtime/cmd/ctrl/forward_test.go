/*
Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
*/

package main

import (
	"bytes"
	"context"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"

	"go.corp.nvidia.com/osmo/pkg/router"
	pb "go.corp.nvidia.com/osmo/proto/router"
	"go.corp.nvidia.com/osmo/runtime/pkg/args"
)

// =============================================================================
// Test Setup
// =============================================================================

func init() {
	// Initialize JWT for tests - required by forwarders
	jwtTokenMux.Lock()
	jwtToken = "test-jwt-token"
	tokenExpiration = time.Now().Add(time.Hour)
	jwtTokenMux.Unlock()
}

func defaultTestCtrlArgs() args.CtrlArgs {
	return args.CtrlArgs{
		Workflow:    "test-workflow",
		TokenHeader: "Authorization",
	}
}

// =============================================================================
// Real TCP Echo Server
// =============================================================================

// tcpEchoServer is a real TCP server that echoes all data.
// No mocking - this is actual network I/O.
type tcpEchoServer struct {
	listener net.Listener
	wg       sync.WaitGroup
	closed   chan struct{}
}

func startTCPEchoServer(t *testing.T) *tcpEchoServer {
	t.Helper()
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to start TCP server: %v", err)
	}

	s := &tcpEchoServer{
		listener: lis,
		closed:   make(chan struct{}),
	}

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		for {
			conn, err := s.listener.Accept()
			if err != nil {
				select {
				case <-s.closed:
					return
				default:
					continue
				}
			}
			s.wg.Add(1)
			go func(c net.Conn) {
				defer s.wg.Done()
				defer c.Close()
				io.Copy(c, c) // Real echo
			}(conn)
		}
	}()

	return s
}

func (s *tcpEchoServer) Addr() string {
	return s.listener.Addr().String()
}

func (s *tcpEchoServer) Port() int {
	return s.listener.Addr().(*net.TCPAddr).Port
}

func (s *tcpEchoServer) Stop() {
	close(s.closed)
	s.listener.Close()
	s.wg.Wait()
}

// =============================================================================
// Real gRPC Router Server (using bufconn for in-process testing)
// =============================================================================

// grpcEchoRouter is a minimal gRPC router that echoes data.
// Uses the real router.Tunnel implementation for zero-copy testing.
type grpcEchoRouter struct {
	listener *bufconn.Listener
	server   *grpc.Server
}

// userEchoService echoes all payloads for user tunnels
type userEchoService struct {
	pb.UnimplementedRouterUserServiceServer
}

func (s *userEchoService) Tunnel(stream pb.RouterUserService_TunnelServer) error {
	// Read and discard init
	if _, err := stream.Recv(); err != nil {
		return err
	}

	// Echo all payloads
	for {
		frame, err := stream.Recv()
		if err != nil {
			return err
		}
		if err := stream.Send(frame); err != nil {
			return err
		}
	}
}

func startGRPCEchoRouter(t *testing.T) *grpcEchoRouter {
	t.Helper()
	listener := bufconn.Listen(1024 * 1024) // 1MB buffer

	r := &grpcEchoRouter{
		listener: listener,
		server:   grpc.NewServer(),
	}

	pb.RegisterRouterUserServiceServer(r.server, &userEchoService{})

	go r.server.Serve(listener)
	return r
}

func (r *grpcEchoRouter) Dial() (*grpc.ClientConn, error) {
	return grpc.NewClient(
		"passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, s string) (net.Conn, error) {
			return r.listener.Dial()
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
}

func (r *grpcEchoRouter) Stop() {
	r.server.Stop()
	r.listener.Close()
}

// =============================================================================
// Forwarder Factory Tests
// =============================================================================

func TestNewForwarder_DefaultsToWS(t *testing.T) {
	info := ServiceRequest{RouterAddress: "http://localhost:8080"}
	fwd, err := NewForwarder(info, defaultTestCtrlArgs())
	if err != nil {
		t.Fatalf("NewForwarder failed: %v", err)
	}
	defer fwd.Close()

	if _, ok := fwd.(*wsForwarder); !ok {
		t.Errorf("Expected *wsForwarder, got %T", fwd)
	}
}

func TestNewForwarder_GRPCRequiresAddress(t *testing.T) {
	// When UseGrpcRouter is set but GrpcRouterAddress is empty,
	// the factory will try to create gRPC forwarder with empty address which fails.
	info := ServiceRequest{
		RouterAddress: "http://localhost:8080",
		UseGrpcRouter: true,
		// GrpcRouterAddress intentionally empty
	}

	_, err := NewForwarder(info, defaultTestCtrlArgs())
	if err == nil {
		t.Error("Expected error when UseGrpcRouter=true but GrpcRouterAddress empty")
	}
}

func TestWSForwarder_CloseIdempotent(t *testing.T) {
	fwd := newWSForwarder("http://localhost:9999", "test", defaultTestCtrlArgs())
	for i := 0; i < 3; i++ {
		if err := fwd.Close(); err != nil {
			t.Errorf("Close #%d failed: %v", i+1, err)
		}
	}
}

// =============================================================================
// gRPC Tunnel Tests - Using real router.Tunnel with bufconn
// =============================================================================

// TestGRPCTunnel_RoundTrip tests the real router.Tunnel implementation.
func TestGRPCTunnel_RoundTrip(t *testing.T) {
	grpcRouter := startGRPCEchoRouter(t)
	defer grpcRouter.Stop()

	conn, err := grpcRouter.Dial()
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()

	// Use the real router.DialUser
	tunnel, err := router.DialUser(context.Background(), conn, &pb.UserInit{
		SessionKey: "test-session",
		WorkflowId: "test-workflow",
	})
	if err != nil {
		t.Fatalf("DialUser failed: %v", err)
	}
	defer tunnel.Close()

	// Test data integrity
	testData := bytes.Repeat([]byte("grpc-test"), 1000)

	// Write
	n, err := tunnel.Write(testData)
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}
	if n != len(testData) {
		t.Errorf("Short write: %d != %d", n, len(testData))
	}

	// Read echo
	buf := make([]byte, len(testData))

	if _, err := io.ReadFull(tunnel, buf); err != nil {
		t.Fatalf("Read failed: %v", err)
	}

	if !bytes.Equal(buf, testData) {
		t.Error("Data mismatch")
	}
}

// TestGRPCTunnel_LargeData tests with larger payloads.
func TestGRPCTunnel_LargeData(t *testing.T) {
	grpcRouter := startGRPCEchoRouter(t)
	defer grpcRouter.Stop()

	conn, err := grpcRouter.Dial()
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()

	tunnel, err := router.DialUser(context.Background(), conn, &pb.UserInit{
		SessionKey: "large-data",
		WorkflowId: "test",
	})
	if err != nil {
		t.Fatalf("DialUser failed: %v", err)
	}
	defer tunnel.Close()

	// 100KB of data
	testData := make([]byte, 100*1024)
	for i := range testData {
		testData[i] = byte(i % 256)
	}

	var wg sync.WaitGroup
	var writeErr, readErr error
	var received bytes.Buffer

	// Writer
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, writeErr = tunnel.Write(testData)
	}()

	// Reader
	wg.Add(1)
	go func() {
		defer wg.Done()
		buf := make([]byte, len(testData))
		_, readErr = io.ReadFull(tunnel, buf)
		received.Write(buf)
	}()

	// Wait with timeout
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("Timeout - possible deadlock")
	}

	if writeErr != nil {
		t.Errorf("Write error: %v", writeErr)
	}
	if readErr != nil {
		t.Errorf("Read error: %v", readErr)
	}
	if !bytes.Equal(received.Bytes(), testData) {
		t.Error("Data mismatch")
	}
}

// TestGRPCTunnel_Concurrent tests multiple concurrent tunnels.
func TestGRPCTunnel_Concurrent(t *testing.T) {
	grpcRouter := startGRPCEchoRouter(t)
	defer grpcRouter.Stop()

	const numTunnels = 10
	var wg sync.WaitGroup
	errors := make(chan error, numTunnels)

	for i := 0; i < numTunnels; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			conn, err := grpcRouter.Dial()
			if err != nil {
				errors <- err
				return
			}
			defer conn.Close()

			tunnel, err := router.DialUser(context.Background(), conn, &pb.UserInit{
				SessionKey: "concurrent-" + string(rune('a'+id)),
				WorkflowId: "test",
			})
			if err != nil {
				errors <- err
				return
			}
			defer tunnel.Close()

			// Unique data per tunnel
			data := bytes.Repeat([]byte{byte(id)}, 1000)
			if _, err := tunnel.Write(data); err != nil {
				errors <- err
				return
			}

			buf := make([]byte, len(data))
			if _, err := io.ReadFull(tunnel, buf); err != nil {
				errors <- err
				return
			}

			if !bytes.Equal(buf, data) {
				errors <- io.ErrShortWrite // sentinel for mismatch
			}
		}(i)
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		if err != nil {
			t.Errorf("Concurrent tunnel error: %v", err)
		}
	}
}

// =============================================================================
// TCP Echo Server Tests - Validates the patterns used in forwarders
// =============================================================================

// TestTCPEcho_BasicRoundTrip tests basic TCP echo.
func TestTCPEcho_BasicRoundTrip(t *testing.T) {
	server := startTCPEchoServer(t)
	defer server.Stop()

	conn, err := net.Dial("tcp", server.Addr())
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()

	testData := []byte("hello-tcp")
	if _, err := conn.Write(testData); err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	// Half-close to signal EOF
	conn.(*net.TCPConn).CloseWrite()

	var received bytes.Buffer
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	io.Copy(&received, conn)

	if !bytes.Equal(received.Bytes(), testData) {
		t.Errorf("Got %q, want %q", received.String(), testData)
	}
}

// TestTCPEcho_GracefulShutdown tests half-close semantics.
func TestTCPEcho_GracefulShutdown(t *testing.T) {
	server := startTCPEchoServer(t)
	defer server.Stop()

	conn, err := net.Dial("tcp", server.Addr())
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()

	// Large data to ensure buffering
	testData := bytes.Repeat([]byte("x"), 64*1024)

	var wg sync.WaitGroup
	var received bytes.Buffer

	// Writer
	wg.Add(1)
	go func() {
		defer wg.Done()
		conn.Write(testData)
		conn.(*net.TCPConn).CloseWrite() // Half-close
	}()

	// Reader
	wg.Add(1)
	go func() {
		defer wg.Done()
		conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		io.Copy(&received, conn)
	}()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("Graceful shutdown timed out")
	}

	if received.Len() != len(testData) {
		t.Errorf("Data loss: got %d, want %d", received.Len(), len(testData))
	}
}

// =============================================================================
// Bidirectional Bridge Tests - Tests the io.Copy pattern used in forwarders
// =============================================================================

// TestBridge_BothDirectionsComplete tests bidirectional data flow.
// Uses real TCP echo server instead of net.Pipe for realistic behavior.
func TestBridge_BothDirectionsComplete(t *testing.T) {
	server := startTCPEchoServer(t)
	defer server.Stop()

	conn, err := net.Dial("tcp", server.Addr())
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()

	testData := bytes.Repeat([]byte("bidirectional"), 100)

	var wg sync.WaitGroup
	var received bytes.Buffer

	// Write data
	wg.Add(1)
	go func() {
		defer wg.Done()
		conn.Write(testData)
		// Half-close to signal we're done writing
		conn.(*net.TCPConn).CloseWrite()
	}()

	// Read echo
	wg.Add(1)
	go func() {
		defer wg.Done()
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		io.Copy(&received, conn)
	}()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("Bridge deadlock")
	}

	if !bytes.Equal(received.Bytes(), testData) {
		t.Errorf("Data mismatch: got %d bytes, want %d bytes", received.Len(), len(testData))
	}
}

// TestBridge_LargeTransfer tests with significant data.
func TestBridge_LargeTransfer(t *testing.T) {
	server := startTCPEchoServer(t)
	defer server.Stop()

	conn, err := net.Dial("tcp", server.Addr())
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()

	// 1MB
	testData := make([]byte, 1024*1024)
	for i := range testData {
		testData[i] = byte(i % 256)
	}

	var wg sync.WaitGroup
	var received bytes.Buffer

	wg.Add(1)
	go func() {
		defer wg.Done()
		conn.Write(testData)
		conn.(*net.TCPConn).CloseWrite()
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		io.Copy(&received, conn)
	}()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(60 * time.Second):
		t.Fatal("Large transfer timeout")
	}

	if received.Len() != len(testData) {
		t.Errorf("Data loss: %d != %d", received.Len(), len(testData))
	}
	if !bytes.Equal(received.Bytes(), testData) {
		t.Error("Data corruption")
	}
}
