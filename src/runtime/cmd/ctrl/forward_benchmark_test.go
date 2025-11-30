/*
Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
*/

// forward_benchmark_test.go - Apples-to-apples benchmarks: WS (Python Router) vs gRPC (Go Router)
//
// REQUIRES EXTERNAL ROUTERS - start them in separate terminals before running benchmarks.
//
// ╔═══════════════════════════════════════════════════════════════════════════════════╗
// ║                              SETUP (3 terminals)                                  ║
// ╠═══════════════════════════════════════════════════════════════════════════════════╣
// ║ Terminal 1 - Start Postgres (for Python router):                                  ║
// ║   docker run --rm -d --name postgres -p 5432:5432 \                               ║
// ║     -e POSTGRES_PASSWORD=osmo -e POSTGRES_DB=osmo_db postgres:15.1                ║
// ║                                                                                   ║
// ║ Terminal 2 - Start Go Router:                                                     ║
// ║   cd external && bazel run //src/service/router_go -- --port=50051 --tls-enabled=false
// ║                                                                                   ║
// ║ Terminal 3 - Start Python Router:                                                 ║
// ║   cd external && OSMO_POSTGRES_PASSWORD=osmo \                                    ║
// ║     bazel run //src/service/router -- --host http://127.0.0.1:8001 --method=dev   ║
// ╚═══════════════════════════════════════════════════════════════════════════════════╝
//
// ╔═══════════════════════════════════════════════════════════════════════════════════╗
// ║                              RUN BENCHMARKS                                       ║
// ╠═══════════════════════════════════════════════════════════════════════════════════╣
// ║ Run with nice table output (recommended):                                         ║
// ║   cd external && GO_ROUTER_ADDR=127.0.0.1:50051 PYTHON_ROUTER_URL=http://127.0.0.1:8001 \
// ║     bazel test //src/runtime/cmd/ctrl:ctrl_benchmark --test_output=streamed       ║
// ║                                                                                   ║
// ║ Run standard Go benchmarks:                                                       ║
// ║   cd external && GO_ROUTER_ADDR=127.0.0.1:50051 PYTHON_ROUTER_URL=http://127.0.0.1:8001 \
// ║     bazel test //src/runtime/cmd/ctrl:ctrl_benchmark \                            ║
// ║       --test_arg=-test.bench=. --test_arg=-test.benchmem --test_output=streamed   ║
// ║                                                                                   ║
// ║ Run only Go router (no postgres needed):                                          ║
// ║   cd external && GO_ROUTER_ADDR=127.0.0.1:50051 \                                 ║
// ║     bazel test //src/runtime/cmd/ctrl:ctrl_benchmark --test_output=streamed       ║
// ╚═══════════════════════════════════════════════════════════════════════════════════╝

package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"go.corp.nvidia.com/osmo/pkg/router"
	pb "go.corp.nvidia.com/osmo/proto/router"
	"go.corp.nvidia.com/osmo/runtime/pkg/args"
)

// ============================================================================
// Router Configuration (from environment variables)
// ============================================================================

var (
	globalGoRouterAddr    string
	globalPythonRouterURL string
)

func init() {
	// Initialize JWT token for tests
	jwtTokenMux.Lock()
	jwtToken = "benchmark-jwt-token"
	tokenExpiration = time.Now().Add(24 * time.Hour)
	jwtTokenMux.Unlock()

	// Get router addresses from environment
	globalGoRouterAddr = os.Getenv("GO_ROUTER_ADDR")
	globalPythonRouterURL = os.Getenv("PYTHON_ROUTER_URL")

	if globalGoRouterAddr != "" {
		fmt.Printf("✓ Go router: %s\n", globalGoRouterAddr)
	} else {
		fmt.Println("ℹ GO_ROUTER_ADDR not set - gRPC benchmarks will skip")
	}

	if globalPythonRouterURL != "" {
		fmt.Printf("✓ Python router: %s\n", globalPythonRouterURL)
	} else {
		fmt.Println("ℹ PYTHON_ROUTER_URL not set - WS benchmarks will skip")
	}
}

// ============================================================================
// Benchmark Configuration
// ============================================================================

var (
	payloadSizes = []int{
		1024,            // 1KB
		64 * 1024,       // 64KB
		256 * 1024,      // 256KB
		1024 * 1024,     // 1MB
		4 * 1024 * 1024, // 4MB
		8 * 1024 * 1024, // 8MB
	}

	// Pre-generated payloads for deterministic benchmarks.
	// Generated once at init, reused across all benchmark runs.
	benchPayloads = make(map[int][]byte)
)

func init() {
	// Pre-generate payloads for deterministic, reproducible benchmarks
	for _, size := range payloadSizes {
		payload := make([]byte, size)
		rand.Read(payload)
		benchPayloads[size] = payload
	}
}

// grpcDialOptions returns optimized gRPC dial options for high-throughput benchmarks.
// These match the server-side tuning in router_go/main.go.
func grpcDialOptions() []grpc.DialOption {
	return []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(64*1024*1024),
			grpc.MaxCallSendMsgSize(64*1024*1024),
		),
		// HTTP/2 flow control tuning - larger windows reduce stalls
		grpc.WithInitialWindowSize(1 << 21),     // 2MB per-stream
		grpc.WithInitialConnWindowSize(1 << 24), // 16MB per-connection
		// Larger buffers for better throughput
		grpc.WithWriteBufferSize(128 * 1024),
		grpc.WithReadBufferSize(128 * 1024),
		// Share write buffers to reduce allocations
		grpc.WithSharedWriteBuffer(true),
	}
}

// benchResult holds timing and throughput results for comparison
type benchResult struct {
	size      int
	grpcNs    float64
	grpcMBps  float64
	grpcAlloc int64
	wsNs      float64
	wsMBps    float64
	wsAlloc   int64
}

// TestBenchmarkTCP runs benchmarks for TCP.
//
// IMPORTANT: Runs gRPC and WS SEQUENTIALLY for each payload size to ensure fair comparison
// (no network contention between the two).
func TestBenchmarkTCP(t *testing.T) {
	if globalGoRouterAddr == "" && globalPythonRouterURL == "" {
		t.Skip("Neither GO_ROUTER_ADDR nor PYTHON_ROUTER_URL set - see file header for setup instructions")
	}

	// Create echo server for benchmarks
	echoServer, err := newLocalTCPEchoServer()
	if err != nil {
		t.Fatalf("Failed to create echo server: %v", err)
	}
	defer echoServer.Close()

	results := make([]benchResult, 0, len(payloadSizes))

	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║  Running benchmarks SEQUENTIALLY (gRPC then WS for each size)                ║")
	fmt.Println("║  This ensures fair comparison - no network contention between routers        ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════════════════════╝")
	fmt.Println()

	for _, size := range payloadSizes {
		r := benchResult{size: size}
		sizeName := formatSize(size)

		// ═══════════════════════════════════════════════════════════════════════
		// PHASE 1: Benchmark gRPC (Go Router) for this payload size
		// ═══════════════════════════════════════════════════════════════════════
		if globalGoRouterAddr != "" {
			log.Printf("════════════════════════════════════════════════════════════════")
			log.Printf("BENCHMARK: gRPC (Go Router) | Payload: %s | Port: %d", sizeName, echoServer.port)
			log.Printf("════════════════════════════════════════════════════════════════")

			grpcResult := testing.Benchmark(func(b *testing.B) {
				benchmarkGRPCTCP(b, globalGoRouterAddr, echoServer.port, size)
			})
			r.grpcNs = float64(grpcResult.NsPerOp())
			r.grpcMBps = float64(size*2) / r.grpcNs * 1000 // round-trip bytes → MB/s
			r.grpcAlloc = int64(grpcResult.AllocedBytesPerOp())

			log.Printf("RESULT: gRPC %s → %s latency, %s throughput",
				sizeName, formatDuration(r.grpcNs), formatThroughput(r.grpcMBps))
		}

		// Brief pause between routers to let things settle
		time.Sleep(1 * time.Second)

		// ═══════════════════════════════════════════════════════════════════════
		// PHASE 2: Benchmark WebSocket (Python Router) for this payload size
		// ═══════════════════════════════════════════════════════════════════════
		if globalPythonRouterURL != "" {
			log.Printf("════════════════════════════════════════════════════════════════")
			log.Printf("BENCHMARK: WebSocket (Python Router) | Payload: %s | Port: %d", sizeName, echoServer.port)
			log.Printf("════════════════════════════════════════════════════════════════")

			wsResult := testing.Benchmark(func(b *testing.B) {
				benchmarkWSTCP(b, globalPythonRouterURL, echoServer.port, size)
			})
			r.wsNs = float64(wsResult.NsPerOp())
			r.wsMBps = float64(size*2) / r.wsNs * 1000 // round-trip bytes → MB/s
			r.wsAlloc = int64(wsResult.AllocedBytesPerOp())

			log.Printf("RESULT: WS %s → %s latency, %s throughput",
				sizeName, formatDuration(r.wsNs), formatThroughput(r.wsMBps))
		}

		results = append(results, r)

		// Pause between payload sizes
		time.Sleep(100 * time.Millisecond)
	}

	// Print comparison table
	fmt.Println()
	fmt.Println("╔════════════════════════════════════════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║                          gRPC (Go Router) vs WebSocket (Python Router) BENCHMARK                       ║")
	fmt.Println("╠══════════╦════════════════════════════════════════╦════════════════════════════════════════╦════════════╣")
	fmt.Println("║ Payload  ║           gRPC (Go Router)             ║        WebSocket (Python Router)       ║  gRPC      ║")
	fmt.Println("║   Size   ║    Latency   │ Throughput  │   Alloc   ║    Latency   │ Throughput  │   Alloc   ║  Speedup   ║")
	fmt.Println("╠══════════╬══════════════╪═════════════╪═══════════╬══════════════╪═════════════╪═══════════╬════════════╣")

	for _, r := range results {
		grpcLatency := "N/A"
		grpcTput := "N/A"
		grpcAlloc := "N/A"
		wsLatency := "N/A"
		wsTput := "N/A"
		wsAlloc := "N/A"
		speedup := "N/A"

		if r.grpcNs > 0 {
			grpcLatency = formatDuration(r.grpcNs)
			grpcTput = formatThroughput(r.grpcMBps)
			grpcAlloc = formatBytes(r.grpcAlloc)
		}
		if r.wsNs > 0 {
			wsLatency = formatDuration(r.wsNs)
			wsTput = formatThroughput(r.wsMBps)
			wsAlloc = formatBytes(r.wsAlloc)
		}
		if r.grpcNs > 0 && r.wsNs > 0 {
			speedup = fmt.Sprintf("%.1fx", r.wsNs/r.grpcNs)
		}

		fmt.Printf("║ %8s ║ %12s │ %11s │ %9s ║ %12s │ %11s │ %9s ║ %10s ║\n",
			formatSize(r.size),
			grpcLatency, grpcTput, grpcAlloc,
			wsLatency, wsTput, wsAlloc,
			speedup,
		)
	}

	fmt.Println("╚══════════╩══════════════╧═════════════╧═══════════╩══════════════╧═════════════╧═══════════╩════════════╝")
	fmt.Println()
	fmt.Println("Legend:")
	fmt.Println("  • Latency: time per round-trip operation (lower is better)")
	fmt.Println("  • Throughput: megabytes per second (higher is better)")
	fmt.Println("  • Alloc: bytes allocated per operation (lower is better)")
	fmt.Println("  • Speedup: how many times faster gRPC is vs WebSocket (>1 = gRPC wins)")
	fmt.Println()
	fmt.Printf("System: %s/%s, %d CPUs\n", runtime.GOOS, runtime.GOARCH, runtime.NumCPU())
	fmt.Println()
}

// ============================================================================
// Formatting Helpers
// ============================================================================

func formatSize(bytes int) string {
	switch {
	case bytes >= 1024*1024:
		return fmt.Sprintf("%dMB", bytes/(1024*1024))
	case bytes >= 1024:
		return fmt.Sprintf("%dKB", bytes/1024)
	default:
		return fmt.Sprintf("%dB", bytes)
	}
}

func formatDuration(ns float64) string {
	switch {
	case ns >= 1_000_000_000:
		return fmt.Sprintf("%.2fs", ns/1_000_000_000)
	case ns >= 1_000_000:
		return fmt.Sprintf("%.1fms", ns/1_000_000)
	case ns >= 1_000:
		return fmt.Sprintf("%.1fµs", ns/1_000)
	default:
		return fmt.Sprintf("%.0fns", ns)
	}
}

func formatThroughput(mbps float64) string {
	switch {
	case mbps >= 1_000:
		return fmt.Sprintf("%.1f GB/s", mbps/1_000)
	case mbps >= 1:
		return fmt.Sprintf("%.0f MB/s", mbps)
	default:
		return fmt.Sprintf("%.2f MB/s", mbps)
	}
}

func formatBytes(b int64) string {
	switch {
	case b >= 1024*1024:
		return fmt.Sprintf("%.1fMB", float64(b)/(1024*1024))
	case b >= 1024:
		return fmt.Sprintf("%.1fKB", float64(b)/1024)
	default:
		return fmt.Sprintf("%dB", b)
	}
}

// ============================================================================
// Local Echo Servers (simulate user's service in the pod)
// ============================================================================

type localTCPEchoServer struct {
	listener net.Listener
	port     int
	wg       sync.WaitGroup
	closed   atomic.Bool
}

func newLocalTCPEchoServer() (*localTCPEchoServer, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}

	server := &localTCPEchoServer{
		listener: listener,
		port:     listener.Addr().(*net.TCPAddr).Port,
	}

	server.wg.Add(1)
	go server.serve()

	return server, nil
}

func (s *localTCPEchoServer) serve() {
	defer s.wg.Done()
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			return
		}
		s.wg.Add(1)
		go s.handleConn(conn)
	}
}

func (s *localTCPEchoServer) handleConn(conn net.Conn) {
	defer s.wg.Done()
	defer conn.Close()
	io.Copy(conn, conn)
}

func (s *localTCPEchoServer) Close() {
	s.closed.Store(true)
	s.listener.Close()
	s.wg.Wait()
}

// ============================================================================
// Benchmark: Go Router (gRPC) - TCP Forwarding
// ============================================================================

func BenchmarkGoRouter_TCP(b *testing.B) {
	if globalGoRouterAddr == "" {
		b.Skip("GO_ROUTER_ADDR not set")
	}

	echoServer, err := newLocalTCPEchoServer()
	if err != nil {
		b.Fatalf("Failed to create echo server: %v", err)
	}
	defer echoServer.Close()

	for _, size := range payloadSizes {
		b.Run(fmt.Sprintf("%dKB", size/1024), func(b *testing.B) {
			benchmarkGRPCTCP(b, globalGoRouterAddr, echoServer.port, size)
		})
	}
}

func benchmarkGRPCTCP(b *testing.B, routerAddr string, localPort, payloadSize int) {
	payload := benchPayloads[payloadSize]
	response := make([]byte, payloadSize)

	// =========================================================================
	// SETUP: Establish connections ONCE (not measured)
	// =========================================================================
	ctx, cancel := context.WithCancel(context.Background())
	sessionKey := fmt.Sprintf("grpc-tcp-%d", payloadSize)
	errCh := make(chan error, 2)

	// Agent side - runs until context cancelled
	agentReady := make(chan struct{})
	agentDone := make(chan struct{})
	go func() {
		defer close(agentDone)

		conn, err := grpc.NewClient(routerAddr,
			grpc.WithTransportCredentials(insecure.NewCredentials()),
			grpc.WithDefaultCallOptions(
				grpc.MaxCallRecvMsgSize(16*1024*1024),
				grpc.MaxCallSendMsgSize(16*1024*1024),
			))
		if err != nil {
			errCh <- fmt.Errorf("agent dial: %w", err)
			close(agentReady)
			return
		}
		defer conn.Close()

		fwd := &grpcForwarder{
			conn:     conn,
			workflow: sessionKey,
			cmdArgs:  args.CtrlArgs{TokenHeader: "Authorization"},
		}

		close(agentReady) // Signal ready before blocking on ForwardTCP

		if err := fwd.ForwardTCP(ctx, sessionKey, "", localPort, nil); err != nil {
			if ctx.Err() == nil {
				errCh <- fmt.Errorf("agent forward: %w", err)
			}
		}
	}()

	// Wait for agent to be ready
	<-agentReady

	// User side - establish tunnel once
	userConn, err := grpc.NewClient(routerAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(16*1024*1024),
			grpc.MaxCallSendMsgSize(16*1024*1024),
		))
	if err != nil {
		b.Fatalf("user dial: %v", err)
	}
	defer userConn.Close()

	tunnel, err := router.DialUser(ctx, userConn, &pb.UserInit{
		SessionKey: sessionKey,
		WorkflowId: sessionKey,
		Operation: &pb.UserInit_PortForward{
			PortForward: &pb.PortForwardOperation{
				Protocol: pb.PortForwardOperation_TCP,
				Port:     int32(localPort),
			},
		},
	})
	if err != nil {
		cancel()
		<-agentDone
		b.Fatalf("user dial tunnel: %v", err)
	}
	defer tunnel.Close()

	// Small delay to ensure rendezvous completes
	time.Sleep(1 * time.Second)

	// =========================================================================
	// BENCHMARK: Only measure send/receive (pure streaming performance)
	// =========================================================================

	b.SetBytes(int64(payloadSize * 2)) // round-trip

	for i := 0; b.Loop(); i++ {
		// Send 1 message
		if _, err := tunnel.Write(payload); err != nil {
			b.Fatalf("write error at iteration %d: %v", i, err)
		}

		// Receive 1 echo (the "ack")
		if _, err := io.ReadFull(tunnel, response); err != nil {
			b.Fatalf("read error at iteration %d: %v", i, err)
		}
	}

	b.StopTimer()

	// =========================================================================
	// CLEANUP
	// =========================================================================
	cancel()
	select {
	case <-agentDone:
	case <-time.After(5 * time.Second):
		b.Log("agent cleanup timed out")
	}

	select {
	case err := <-errCh:
		b.Logf("background error: %v", err)
	default:
	}
}

// ============================================================================
// Benchmark: Python Router (WebSocket) - TCP Forwarding
// ============================================================================

func BenchmarkPythonRouter_TCP(b *testing.B) {
	if globalPythonRouterURL == "" {
		b.Skip("PYTHON_ROUTER_URL not set")
	}

	echoServer, err := newLocalTCPEchoServer()
	if err != nil {
		b.Fatalf("Failed to create echo server: %v", err)
	}
	defer echoServer.Close()

	for _, size := range payloadSizes {
		b.Run(fmt.Sprintf("%dKB", size/1024), func(b *testing.B) {
			benchmarkWSTCP(b, globalPythonRouterURL, echoServer.port, size)
		})
	}
}

func benchmarkWSTCP(b *testing.B, routerURL string, localPort, payloadSize int) {
	payload := benchPayloads[payloadSize]

	// =========================================================================
	// SETUP: Establish connections ONCE (not measured)
	// =========================================================================
	ctx, cancel := context.WithCancel(context.Background())
	sessionKey := fmt.Sprintf("ws-tcp-%d", payloadSize)
	errCh := make(chan error, 2)

	// Agent side - runs until context cancelled
	agentReady := make(chan struct{})
	agentDone := make(chan struct{})
	var agentConn *websocket.Conn
	var agentConnMu sync.Mutex

	go func() {
		defer close(agentDone)

		wsURL := fmt.Sprintf("ws%s/api/router/portforward/benchmark/backend/%s",
			routerURL[4:], sessionKey)

		conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
		if err != nil {
			errCh <- fmt.Errorf("agent ws dial: %w", err)
			close(agentReady)
			return
		}
		agentConnMu.Lock()
		agentConn = conn
		agentConnMu.Unlock()
		defer conn.Close()

		lc, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", localPort))
		if err != nil {
			errCh <- fmt.Errorf("agent local dial: %w", err)
			close(agentReady)
			return
		}
		defer lc.Close()

		close(agentReady) // Signal ready

		var bridgeWg sync.WaitGroup
		firstDone := make(chan struct{})
		var closeOnce sync.Once

		bridgeWg.Add(2)

		// WS → Local
		go func() {
			defer bridgeWg.Done()
			defer closeOnce.Do(func() { close(firstDone) })
			for {
				_, data, err := conn.ReadMessage()
				if err != nil {
					return
				}
				if _, err := lc.Write(data); err != nil {
					return
				}
			}
		}()

		// Local → WS
		go func() {
			defer bridgeWg.Done()
			defer closeOnce.Do(func() { close(firstDone) })
			buf := make([]byte, 32*1024)
			for {
				n, err := lc.Read(buf)
				if err != nil {
					return
				}
				if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
					return
				}
			}
		}()

		<-firstDone
		conn.Close()
		lc.Close()
		bridgeWg.Wait()
	}()

	// Wait for agent to be ready
	<-agentReady

	// User side - establish connection once
	wsURL := fmt.Sprintf("ws%s/api/router/portforward/benchmark/client/%s",
		routerURL[4:], sessionKey)

	userConn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		cancel()
		<-agentDone
		b.Fatalf("user ws dial: %v", err)
	}
	defer userConn.Close()

	// Small delay to ensure connection is fully established
	time.Sleep(1 * time.Second)

	// =========================================================================
	// BENCHMARK: Only measure send/receive (pure streaming performance)
	// =========================================================================

	b.SetBytes(int64(payloadSize * 2)) // round-trip

	for i := 0; b.Loop(); i++ {
		// Send 1 message
		if err := userConn.WriteMessage(websocket.BinaryMessage, payload); err != nil {
			b.Fatalf("write error at iteration %d: %v", i, err)
		}

		// Receive 1 echo (the "ack") - may come in multiple frames
		totalReceived := 0
		for totalReceived < payloadSize {
			userConn.SetReadDeadline(time.Now().Add(5 * time.Second))
			_, data, err := userConn.ReadMessage()
			if err != nil {
				b.Fatalf("read error at iteration %d: %v (received %d/%d)", i, err, totalReceived, payloadSize)
			}
			totalReceived += len(data)
		}
	}

	b.StopTimer()

	// =========================================================================
	// CLEANUP
	// =========================================================================
	userConn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))

	agentConnMu.Lock()
	if agentConn != nil {
		agentConn.Close()
	}
	agentConnMu.Unlock()

	cancel()
	select {
	case <-agentDone:
	case <-time.After(5 * time.Second):
		b.Log("agent cleanup timed out")
	}

	select {
	case err := <-errCh:
		b.Logf("background error: %v", err)
	default:
	}
}

// ============================================================================
// One-Way Throughput Ceiling Test
// ============================================================================

// localDiscardServer reads and discards all data (no echo)
type localDiscardServer struct {
	listener net.Listener
	port     int
}

func newLocalDiscardServer() (*localDiscardServer, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}

	port := listener.Addr().(*net.TCPAddr).Port

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				buf := make([]byte, 64*1024)
				for {
					_, err := c.Read(buf)
					if err != nil {
						return
					}
				}
			}(conn)
		}
	}()

	return &localDiscardServer{listener: listener, port: port}, nil
}

func (s *localDiscardServer) Close() error {
	return s.listener.Close()
}

// throughputResult holds results from a throughput ceiling test
type throughputResult struct {
	peakRate  float64
	totalSent int64
	duration  time.Duration
}

// throughputTestConfig holds all configurable parameters for throughput tests
type throughputTestConfig struct {
	TestDuration  time.Duration // Duration for each rate level
	ChunkSize     int           // Size of each chunk to send
	TargetRates   []int         // Target rates in MB/s to test
	PlateauCount  int           // Number of consecutive plateaus to declare ceiling
	SetupDelay    time.Duration // Delay after connection setup
	InterLevelGap time.Duration // Gap between rate levels
}

// defaultThroughputConfig returns the default benchmark configuration
func defaultThroughputConfig() throughputTestConfig {
	return throughputTestConfig{
		TestDuration:  5 * time.Second,
		ChunkSize:     64 * 1024, // 64KB chunks
		TargetRates:   []int{1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096},
		PlateauCount:  3,
		SetupDelay:    500 * time.Millisecond,
		InterLevelGap: 200 * time.Millisecond,
	}
}

// TestThroughputCeiling finds the maximum sustainable one-way throughput.
//
// IMPORTANT: Runs gRPC and WS SEQUENTIALLY to ensure fair comparison
// (no network contention between the two).
func TestThroughputCeiling(t *testing.T) {
	if globalGoRouterAddr == "" && globalPythonRouterURL == "" {
		t.Skip("Neither GO_ROUTER_ADDR nor PYTHON_ROUTER_URL set - see file header for setup instructions")
	}

	// Create discard server for throughput tests
	discardServer, err := newLocalDiscardServer()
	if err != nil {
		t.Fatalf("Failed to create discard server: %v", err)
	}
	defer discardServer.Close()

	cfg := defaultThroughputConfig()
	var grpcResult, wsResult *throughputResult

	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║  Running ONE-WAY throughput ceiling tests SEQUENTIALLY                       ║")
	fmt.Println("║  (User → Router → Agent → Discard) - measures pure send throughput           ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════════════════════╝")
	fmt.Println()

	// =========================================================================
	// PHASE 1: gRPC (Go Router)
	// =========================================================================
	if globalGoRouterAddr != "" {
		grpcResult = runGRPCThroughputCeiling(t, discardServer.port, cfg)
	}

	// Brief pause between routers
	time.Sleep(1 * time.Second)

	// =========================================================================
	// PHASE 2: WebSocket (Python Router)
	// =========================================================================
	if globalPythonRouterURL != "" {
		wsResult = runWSThroughputCeiling(t, discardServer.port, cfg)
	}

	// =========================================================================
	// Print Comparison Summary
	// =========================================================================
	printThroughputComparison(grpcResult, wsResult)
}

func printThroughputComparison(grpcResult, wsResult *throughputResult) {
	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║                   ONE-WAY THROUGHPUT CEILING COMPARISON                      ║")
	fmt.Println("╠═══════════════════════════╦═════════════════════════════════════════════════╣")
	fmt.Println("║ Metric                    ║   gRPC (Go Router)   │  WebSocket (Python)      ║")
	fmt.Println("╠═══════════════════════════╬═════════════════════════════════════════════════╣")

	grpcPeak := "N/A"
	grpcTotal := "N/A"
	wsPeak := "N/A"
	wsTotal := "N/A"

	if grpcResult != nil {
		grpcPeak = fmt.Sprintf("%.1f MB/s", grpcResult.peakRate)
		grpcTotal = fmt.Sprintf("%.2f GB", float64(grpcResult.totalSent)/(1024*1024*1024))
	}
	if wsResult != nil {
		wsPeak = fmt.Sprintf("%.1f MB/s", wsResult.peakRate)
		wsTotal = fmt.Sprintf("%.2f GB", float64(wsResult.totalSent)/(1024*1024*1024))
	}

	fmt.Printf("║ Peak Throughput           ║ %20s │ %24s ║\n", grpcPeak, wsPeak)
	fmt.Printf("║ Total Data Sent           ║ %20s │ %24s ║\n", grpcTotal, wsTotal)

	if grpcResult != nil && wsResult != nil && wsResult.peakRate > 0 {
		speedup := grpcResult.peakRate / wsResult.peakRate
		fmt.Println("╠═══════════════════════════╬═════════════════════════════════════════════════╣")
		fmt.Printf("║ gRPC Speedup              ║                      %.1fx                       ║\n", speedup)
	}

	fmt.Println("╚═══════════════════════════╩═════════════════════════════════════════════════╝")
	fmt.Println()
}

// runThroughputCeilingTest is the common test runner for throughput ceiling tests.
// It takes a sender function and runs the ramp-up test with the given config.
func runThroughputCeilingTest(name string, cfg throughputTestConfig, sender func([]byte) error) *throughputResult {
	chunk := benchPayloads[cfg.ChunkSize]

	fmt.Println()
	fmt.Println("╔═══════════════════════════════════════════════════════════════════╗")
	fmt.Printf("║          %s ONE-WAY THROUGHPUT CEILING TEST%s║\n", name, strings.Repeat(" ", 22-len(name)))
	fmt.Println("║          (User → Router → Agent → Discard)                        ║")
	fmt.Println("╠════════════════╦════════════════╦════════════════╦════════════════╣")
	fmt.Println("║ Target (MB/s)  ║ Actual (MB/s)  ║ Sent (MB)      ║ Status         ║")
	fmt.Println("╠════════════════╬════════════════╬════════════════╬════════════════╣")

	var lastActualRate float64
	var plateauCount int
	var totalBytesSent int64
	var peakRate float64
	testStart := time.Now()

	for _, targetRate := range cfg.TargetRates {
		bytesPerSecond := targetRate * 1024 * 1024
		chunksPerSecond := float64(bytesPerSecond) / float64(cfg.ChunkSize)
		sendInterval := time.Duration(float64(time.Second) / chunksPerSecond)

		var bytesSent atomic.Int64
		var sendErr atomic.Value

		levelStart := time.Now()
		deadline := levelStart.Add(cfg.TestDuration)

		senderDone := make(chan struct{})
		go func() {
			defer close(senderDone)
			ticker := time.NewTicker(sendInterval)
			defer ticker.Stop()

			for time.Now().Before(deadline) {
				<-ticker.C
				if err := sender(chunk); err != nil {
					sendErr.Store(err)
					return
				}
				bytesSent.Add(int64(cfg.ChunkSize))
			}
		}()

		<-senderDone

		levelDuration := time.Since(levelStart)
		sentBytes := bytesSent.Load()
		sent := float64(sentBytes) / (1024 * 1024)
		actualRate := sent / levelDuration.Seconds()

		totalBytesSent += sentBytes
		if actualRate > peakRate {
			peakRate = actualRate
		}

		status := "OK"
		if e := sendErr.Load(); e != nil {
			status = "SEND ERR"
		} else if actualRate < float64(targetRate)*0.8 {
			status = "SATURATED"
		}

		fmt.Printf("║ %14d ║ %14.1f ║ %14.1f ║ %14s ║\n",
			targetRate, actualRate, sent, status)

		// Check for plateau (throughput not increasing)
		if lastActualRate > 0 && actualRate <= lastActualRate*1.1 {
			plateauCount++
			if plateauCount >= cfg.PlateauCount {
				fmt.Println("╠════════════════╩════════════════╩════════════════╩════════════════╣")
				fmt.Printf("║ CEILING REACHED: ~%.0f MB/s (throughput plateaued)                ║\n", actualRate)
				break
			}
		} else {
			plateauCount = 0
		}
		lastActualRate = actualRate

		// On send error, count toward plateau but continue to confirm it's not transient
		if status == "SEND ERR" {
			if plateauCount >= 2 {
				fmt.Println("╠════════════════╩════════════════╩════════════════╩════════════════╣")
				fmt.Printf("║ CEILING REACHED: ~%.0f MB/s (repeated send errors)                ║\n", peakRate)
				break
			}
			plateauCount++
		}

		time.Sleep(cfg.InterLevelGap)
	}

	testDurationTotal := time.Since(testStart)
	totalSentMB := float64(totalBytesSent) / (1024 * 1024)
	totalSentGB := totalSentMB / 1024

	fmt.Println("╠═══════════════════════════════════════════════════════════════════╣")
	fmt.Printf("║ SUMMARY                                                           ║\n")
	fmt.Printf("║   Test Duration: %-48s ║\n", testDurationTotal.Round(time.Millisecond))
	fmt.Printf("║   Total Sent:    %.2f GB (%.0f MB) %-28s ║\n", totalSentGB, totalSentMB, "")
	fmt.Printf("║   Peak Rate:     %.1f MB/s %-38s ║\n", peakRate, "")
	fmt.Println("╚═══════════════════════════════════════════════════════════════════╝")

	return &throughputResult{
		peakRate:  peakRate,
		totalSent: totalBytesSent,
		duration:  testDurationTotal,
	}
}

func runGRPCThroughputCeiling(t *testing.T, discardPort int, cfg throughputTestConfig) *throughputResult {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sessionKey := "grpc-throughput-ceiling"

	// Start agent
	agentReady := make(chan struct{})
	agentDone := make(chan struct{})
	go func() {
		defer close(agentDone)

		conn, err := grpc.NewClient(globalGoRouterAddr, grpcDialOptions()...)
		if err != nil {
			close(agentReady)
			return
		}
		defer conn.Close()

		fwd := &grpcForwarder{
			conn:     conn,
			workflow: sessionKey,
			cmdArgs:  args.CtrlArgs{TokenHeader: "Authorization"},
		}
		close(agentReady)
		fwd.ForwardTCP(ctx, sessionKey, "", discardPort, nil)
	}()

	<-agentReady

	// Setup user tunnel
	userConn, err := grpc.NewClient(globalGoRouterAddr, grpcDialOptions()...)
	if err != nil {
		t.Fatalf("user dial: %v", err)
	}
	defer userConn.Close()

	tunnel, err := router.DialUser(ctx, userConn, &pb.UserInit{
		SessionKey: sessionKey,
		WorkflowId: sessionKey,
		Operation: &pb.UserInit_PortForward{
			PortForward: &pb.PortForwardOperation{
				Protocol: pb.PortForwardOperation_TCP,
				Port:     int32(discardPort),
			},
		},
	})
	if err != nil {
		t.Fatalf("user dial tunnel: %v", err)
	}
	defer tunnel.Close()

	time.Sleep(cfg.SetupDelay)

	// Run the test with gRPC sender
	result := runThroughputCeilingTest("gRPC", cfg, func(data []byte) error {
		_, err := tunnel.Write(data)
		return err
	})

	cancel()
	<-agentDone

	return result
}

func runWSThroughputCeiling(t *testing.T, discardPort int, cfg throughputTestConfig) *throughputResult {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sessionKey := "ws-throughput-ceiling"

	// Start agent
	agentReady := make(chan struct{})
	agentDone := make(chan struct{})
	var agentConn *websocket.Conn
	var agentConnMu sync.Mutex

	go func() {
		defer close(agentDone)

		wsURL := fmt.Sprintf("ws%s/api/router/portforward/benchmark/backend/%s",
			globalPythonRouterURL[4:], sessionKey)

		conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
		if err != nil {
			close(agentReady)
			return
		}
		agentConnMu.Lock()
		agentConn = conn
		agentConnMu.Unlock()
		defer conn.Close()

		lc, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", discardPort))
		if err != nil {
			close(agentReady)
			return
		}
		defer lc.Close()

		close(agentReady)

		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if _, err := lc.Write(data); err != nil {
				return
			}
		}
	}()

	<-agentReady

	// Setup user connection
	wsURL := fmt.Sprintf("ws%s/api/router/portforward/benchmark/client/%s",
		globalPythonRouterURL[4:], sessionKey)

	userConn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("user ws dial: %v", err)
	}
	defer userConn.Close()

	time.Sleep(cfg.SetupDelay)

	// Run the test with WS sender
	result := runThroughputCeilingTest("WS", cfg, func(data []byte) error {
		return userConn.WriteMessage(websocket.BinaryMessage, data)
	})

	// Cleanup
	userConn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))

	agentConnMu.Lock()
	if agentConn != nil {
		agentConn.Close()
	}
	agentConnMu.Unlock()

	cancel()
	<-agentDone

	return result
}

// ============================================================================
// Concurrency Ceiling Test
// ============================================================================

// concurrencyResult holds results from a concurrency ceiling test
type concurrencyResult struct {
	maxConcurrency int
	totalSent      int64
	successRate    float64
}

// TestConcurrencyCeiling finds the maximum sustainable concurrent sessions.
//
// Uses a steady 32 MB/s rate per session (observed as sustainable for both routers).
// Doubles concurrency until sessions start failing or aggregate rate drops.
func TestConcurrencyCeiling(t *testing.T) {
	if globalGoRouterAddr == "" && globalPythonRouterURL == "" {
		t.Skip("Neither GO_ROUTER_ADDR nor PYTHON_ROUTER_URL set - see file header for setup instructions")
	}

	// Create discard server for throughput tests
	discardServer, err := newLocalDiscardServer()
	if err != nil {
		t.Fatalf("Failed to create discard server: %v", err)
	}
	defer discardServer.Close()

	var grpcResult, wsResult *concurrencyResult

	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║  Running CONCURRENCY ceiling tests SEQUENTIALLY                              ║")
	fmt.Println("║  Each session sends at 32 MB/s - doubles concurrency until failure           ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════════════════════╝")
	fmt.Println()

	// =========================================================================
	// PHASE 1: gRPC (Go Router)
	// =========================================================================
	if globalGoRouterAddr != "" {
		log.Printf("════════════════════════════════════════════════════════════════")
		log.Printf("CONCURRENCY CEILING: gRPC (Go Router)")
		log.Printf("════════════════════════════════════════════════════════════════")

		grpcResult = runGRPCConcurrencyCeiling(discardServer.port)
	}

	// Brief pause between routers
	time.Sleep(2 * time.Second)

	// =========================================================================
	// PHASE 2: WebSocket (Python Router)
	// =========================================================================
	if globalPythonRouterURL != "" {
		log.Printf("════════════════════════════════════════════════════════════════")
		log.Printf("CONCURRENCY CEILING: WebSocket (Python Router)")
		log.Printf("════════════════════════════════════════════════════════════════")

		wsResult = runWSConcurrencyCeiling(discardServer.port)
	}

	// =========================================================================
	// Print Comparison Summary
	// =========================================================================
	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║                   CONCURRENCY CEILING COMPARISON                             ║")
	fmt.Println("╠═══════════════════════════╦═════════════════════════════════════════════════╣")
	fmt.Println("║ Metric                    ║   gRPC (Go Router)   │  WebSocket (Python)      ║")
	fmt.Println("╠═══════════════════════════╬═════════════════════════════════════════════════╣")

	grpcMax := "N/A"
	grpcTotal := "N/A"
	wsMax := "N/A"
	wsTotal := "N/A"

	if grpcResult != nil {
		grpcMax = fmt.Sprintf("%d sessions", grpcResult.maxConcurrency)
		grpcTotal = fmt.Sprintf("%.2f GB", float64(grpcResult.totalSent)/(1024*1024*1024))
	}
	if wsResult != nil {
		wsMax = fmt.Sprintf("%d sessions", wsResult.maxConcurrency)
		wsTotal = fmt.Sprintf("%.2f GB", float64(wsResult.totalSent)/(1024*1024*1024))
	}

	fmt.Printf("║ Max Concurrent Sessions   ║ %20s │ %24s ║\n", grpcMax, wsMax)
	fmt.Printf("║ Total Data Sent           ║ %20s │ %24s ║\n", grpcTotal, wsTotal)

	if grpcResult != nil && wsResult != nil && wsResult.maxConcurrency > 0 {
		speedup := float64(grpcResult.maxConcurrency) / float64(wsResult.maxConcurrency)
		fmt.Println("╠═══════════════════════════╬═════════════════════════════════════════════════╣")
		fmt.Printf("║ gRPC Advantage            ║                      %.1fx                       ║\n", speedup)
	}

	fmt.Println("╚═══════════════════════════╩═════════════════════════════════════════════════╝")
	fmt.Println()
}

func runGRPCConcurrencyCeiling(discardPort int) *concurrencyResult {
	const (
		testDuration   = 5 * time.Second
		chunkSize      = 64 * 1024
		targetRateMBps = 32  // 32 MB/s per session
		failureThresh  = 0.9 // 90% success rate threshold
	)

	concurrencyLevels := []int{4, 8, 16, 24, 28, 32, 48}
	chunk := benchPayloads[chunkSize]

	// Calculate send interval for target rate
	bytesPerSecond := targetRateMBps * 1024 * 1024
	chunksPerSecond := float64(bytesPerSecond) / float64(chunkSize)
	sendInterval := time.Duration(float64(time.Second) / chunksPerSecond)

	fmt.Println()
	fmt.Println("╔═══════════════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║          gRPC CONCURRENCY CEILING TEST                                        ║")
	fmt.Println("║          (Each session: 32 MB/s one-way to Discard)                           ║")
	fmt.Println("╠════════════════╦════════════════╦════════════════╦════════════════════════════╣")
	fmt.Println("║ Concurrency    ║ Aggregate MB/s ║ Success Rate   ║ Status                     ║")
	fmt.Println("╠════════════════╬════════════════╬════════════════╬════════════════════════════╣")

	var maxConcurrency int
	var totalBytesSent int64

	for _, concurrency := range concurrencyLevels {
		ctx, cancel := context.WithCancel(context.Background())

		var wg sync.WaitGroup
		var totalSent atomic.Int64
		var successCount, failCount atomic.Int64

		// Launch concurrent sessions
		for i := range concurrency {
			sessionKey := fmt.Sprintf("grpc-conc-%d-%d", concurrency, i)

			wg.Add(1)
			go func(key string) {
				defer wg.Done()

				// Agent side
				agentReady := make(chan struct{})
				agentDone := make(chan struct{})

				go func() {
					defer close(agentDone)

					conn, err := grpc.NewClient(globalGoRouterAddr, grpcDialOptions()...)
					if err != nil {
						close(agentReady)
						failCount.Add(1)
						return
					}
					defer conn.Close()

					fwd := &grpcForwarder{
						conn:     conn,
						workflow: key,
						cmdArgs:  args.CtrlArgs{TokenHeader: "Authorization"},
					}
					close(agentReady)
					fwd.ForwardTCP(ctx, key, "", discardPort, nil)
				}()

				<-agentReady

				// User side
				userConn, err := grpc.NewClient(globalGoRouterAddr, grpcDialOptions()...)
				if err != nil {
					failCount.Add(1)
					return
				}
				defer userConn.Close()

				tunnel, err := router.DialUser(ctx, userConn, &pb.UserInit{
					SessionKey: key,
					WorkflowId: key,
					Operation: &pb.UserInit_PortForward{
						PortForward: &pb.PortForwardOperation{
							Protocol: pb.PortForwardOperation_TCP,
							Port:     int32(discardPort),
						},
					},
				})
				if err != nil {
					failCount.Add(1)
					return
				}
				defer tunnel.Close()

				// Wait for connection to stabilize
				time.Sleep(100 * time.Millisecond)

				// Send at target rate for test duration
				deadline := time.Now().Add(testDuration)
				ticker := time.NewTicker(sendInterval)
				defer ticker.Stop()

				for time.Now().Before(deadline) {
					select {
					case <-ctx.Done():
						return
					case <-ticker.C:
						if _, err := tunnel.Write(chunk); err != nil {
							failCount.Add(1)
							return
						}
						totalSent.Add(int64(chunkSize))
					}
				}

				successCount.Add(1)
			}(sessionKey)
		}

		// Wait for all user sessions to complete, then cancel agents
		wg.Wait()
		cancel()

		// Brief pause to let agents clean up
		time.Sleep(100 * time.Millisecond)

		// Calculate results
		sent := totalSent.Load()
		totalBytesSent += sent
		success := successCount.Load()
		failures := failCount.Load()
		successRate := float64(success) / float64(concurrency)
		aggregateRate := float64(sent) / (1024 * 1024) / testDuration.Seconds()

		status := "OK"
		if successRate < failureThresh {
			status = "SESSIONS FAILING"
		} else if aggregateRate < float64(concurrency*targetRateMBps)*0.5 {
			status = "RATE DEGRADED"
		}

		fmt.Printf("║ %14d ║ %14.1f ║ %5.1f%% (%d/%d) ║ %-26s ║\n",
			concurrency, aggregateRate, successRate*100, success, concurrency, status)

		if status == "OK" {
			maxConcurrency = concurrency
		} else {
			fmt.Println("╠════════════════╩════════════════╩════════════════╩════════════════════════════╣")
			fmt.Printf("║ CEILING REACHED: %d concurrent sessions (failures: %d)                        ║\n", maxConcurrency, failures)
			break
		}

		// Brief pause between levels
		time.Sleep(500 * time.Millisecond)
	}

	fmt.Println("╠═══════════════════════════════════════════════════════════════════════════════╣")
	fmt.Printf("║ SUMMARY: Max stable concurrency = %d sessions at 32 MB/s each                 ║\n", maxConcurrency)
	fmt.Printf("║          Total data sent: %.2f GB                                             ║\n", float64(totalBytesSent)/(1024*1024*1024))
	fmt.Println("╚═══════════════════════════════════════════════════════════════════════════════╝")

	return &concurrencyResult{
		maxConcurrency: maxConcurrency,
		totalSent:      totalBytesSent,
		successRate:    1.0,
	}
}

func runWSConcurrencyCeiling(discardPort int) *concurrencyResult {
	const (
		testDuration   = 5 * time.Second
		chunkSize      = 64 * 1024
		targetRateMBps = 32  // 32 MB/s per session
		failureThresh  = 0.9 // 90% success rate threshold
	)

	concurrencyLevels := []int{4, 8, 16, 24, 28, 32, 48}
	chunk := benchPayloads[chunkSize]

	// Calculate send interval for target rate
	bytesPerSecond := targetRateMBps * 1024 * 1024
	chunksPerSecond := float64(bytesPerSecond) / float64(chunkSize)
	sendInterval := time.Duration(float64(time.Second) / chunksPerSecond)

	fmt.Println()
	fmt.Println("╔═══════════════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║          WS CONCURRENCY CEILING TEST                                          ║")
	fmt.Println("║          (Each session: 32 MB/s one-way to Discard)                           ║")
	fmt.Println("╠════════════════╦════════════════╦════════════════╦════════════════════════════╣")
	fmt.Println("║ Concurrency    ║ Aggregate MB/s ║ Success Rate   ║ Status                     ║")
	fmt.Println("╠════════════════╬════════════════╬════════════════╬════════════════════════════╣")

	var maxConcurrency int
	var totalBytesSent int64

	for _, concurrency := range concurrencyLevels {
		ctx, cancel := context.WithCancel(context.Background())

		var wg sync.WaitGroup
		var totalSent atomic.Int64
		var successCount, failCount atomic.Int64

		// Launch concurrent sessions
		for i := range concurrency {
			sessionKey := fmt.Sprintf("ws-conc-%d-%d", concurrency, i)

			wg.Add(1)
			go func(key string) {
				defer wg.Done()

				// Agent side
				agentReady := make(chan struct{})
				agentDone := make(chan struct{})

				go func() {
					defer close(agentDone)

					wsURL := fmt.Sprintf("ws%s/api/router/portforward/benchmark/backend/%s",
						globalPythonRouterURL[4:], key)

					conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
					if err != nil {
						close(agentReady)
						failCount.Add(1)
						return
					}
					defer conn.Close()

					lc, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", discardPort))
					if err != nil {
						close(agentReady)
						failCount.Add(1)
						return
					}
					defer lc.Close()

					close(agentReady)

					for {
						_, data, err := conn.ReadMessage()
						if err != nil {
							return
						}
						if _, err := lc.Write(data); err != nil {
							return
						}
					}
				}()

				<-agentReady

				// User side
				wsURL := fmt.Sprintf("ws%s/api/router/portforward/benchmark/client/%s",
					globalPythonRouterURL[4:], key)

				userConn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
				if err != nil {
					failCount.Add(1)
					return
				}
				defer userConn.Close()

				// Wait for connection to stabilize
				time.Sleep(100 * time.Millisecond)

				// Send at target rate for test duration
				deadline := time.Now().Add(testDuration)
				ticker := time.NewTicker(sendInterval)
				defer ticker.Stop()

				for time.Now().Before(deadline) {
					select {
					case <-ctx.Done():
						return
					case <-ticker.C:
						if err := userConn.WriteMessage(websocket.BinaryMessage, chunk); err != nil {
							failCount.Add(1)
							return
						}
						totalSent.Add(int64(chunkSize))
					}
				}

				userConn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))

				successCount.Add(1)
			}(sessionKey)
		}

		// Wait for all user sessions to complete, then cancel agents
		wg.Wait()
		cancel()

		// Brief pause to let agents clean up
		time.Sleep(100 * time.Millisecond)

		// Calculate results
		sent := totalSent.Load()
		totalBytesSent += sent
		success := successCount.Load()
		failures := failCount.Load()
		successRate := float64(success) / float64(concurrency)
		aggregateRate := float64(sent) / (1024 * 1024) / testDuration.Seconds()

		status := "OK"
		if successRate < failureThresh {
			status = "SESSIONS FAILING"
		} else if aggregateRate < float64(concurrency*targetRateMBps)*0.5 {
			status = "RATE DEGRADED"
		}

		fmt.Printf("║ %14d ║ %14.1f ║ %5.1f%% (%d/%d) ║ %-26s ║\n",
			concurrency, aggregateRate, successRate*100, success, concurrency, status)

		if status == "OK" {
			maxConcurrency = concurrency
		} else {
			fmt.Println("╠════════════════╩════════════════╩════════════════╩════════════════════════════╣")
			fmt.Printf("║ CEILING REACHED: %d concurrent sessions (failures: %d)                        ║\n", maxConcurrency, failures)
			break
		}

		// Brief pause between levels
		time.Sleep(500 * time.Millisecond)
	}

	fmt.Println("╠═══════════════════════════════════════════════════════════════════════════════╣")
	fmt.Printf("║ SUMMARY: Max stable concurrency = %d sessions at 32 MB/s each                 ║\n", maxConcurrency)
	fmt.Printf("║          Total data sent: %.2f GB                                             ║\n", float64(totalBytesSent)/(1024*1024*1024))
	fmt.Println("╚═══════════════════════════════════════════════════════════════════════════════╝")

	return &concurrencyResult{
		maxConcurrency: maxConcurrency,
		totalSent:      totalBytesSent,
		successRate:    1.0,
	}
}
