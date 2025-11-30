/*
Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
*/

// forward_grpc.go - Ultra-low-latency gRPC forwarding
//
// ZERO-COPY ARCHITECTURE:
//
// This file implements the agent side of the gRPC tunnel. The key insight is
// that the tunnel (pkg/router/tunnel.go) is designed for zero-copy with io.Copy:
//
//   tunnel.WriteTo(conn)  - Zero-copy: writes directly from gRPC buffer
//   tunnel.Write(buf)     - Zero-copy: passes pointer directly to gRPC
//
// DATA PATH (optimized for throughput):
//
//   ┌─────────────────────────────────────────────────────────────────────────┐
//   │                         AGENT (this file)                               │
//   │                                                                         │
//   │   Local Service ←──── io.Copy(conn, tunnel) ────── gRPC Tunnel          │
//   │                       [uses WriteTo = ZERO COPY]                        │
//   │                                                                         │
//   │   Local Service ────→ io.Copy(tunnel, conn) ──────→ gRPC Tunnel         │
//   │                       [32KB internal buffer]                            │
//   │                                                                         │
//   └─────────────────────────────────────────────────────────────────────────┘
//
// WHY NO EXPLICIT BUFFERS:
//
//   1. tunnel→conn: io.Copy detects tunnel.WriteTo, uses it directly
//   2. conn→tunnel: io.Copy uses internal 32KB buffer (can't avoid due to gRPC framing)
//   3. We don't allocate buffers ourselves - let io.Copy manage them
//
// NATURAL BACKPRESSURE:
//
//   gRPC uses HTTP/2 flow control. When the receiver is slow:
//   - tunnel.Write() blocks (HTTP/2 window full)
//   - io.Copy blocks on Write
//   - conn.Read() blocks (TCP buffer fills)
//   - Sender naturally throttles
//
// No artificial rate limiting needed - throughput adjusts organically.

package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"go.corp.nvidia.com/osmo/pkg/router"
	"go.corp.nvidia.com/osmo/runtime/pkg/args"
	"go.corp.nvidia.com/osmo/runtime/pkg/metrics"

	pb "go.corp.nvidia.com/osmo/proto/router"
)

// Connection retry settings
const (
	dialRetryMax      = 5           // Max retries for dial operations
	dialRetryInterval = time.Second // Wait between retries
)

// grpcForwarder implements Forwarder using gRPC connections.
type grpcForwarder struct {
	conn     *grpc.ClientConn
	workflow string
	cmdArgs  args.CtrlArgs
}

// newGrpcForwarder creates a new gRPC-based forwarder.
// For local development without TLS, prefix the address with "insecure:".
func newGrpcForwarder(address, workflow string, cmdArgs args.CtrlArgs) (*grpcForwarder, error) {
	var opts []router.DialOption

	if len(address) > 9 && address[:9] == "insecure:" {
		address = address[9:]
		opts = append(opts, router.WithInsecure())
	}

	conn, err := router.Dial(address, opts...)
	if err != nil {
		return nil, fmt.Errorf("dial gRPC: %w", err)
	}

	return &grpcForwarder{conn: conn, workflow: workflow, cmdArgs: cmdArgs}, nil
}

// Close closes the gRPC connection.
func (f *grpcForwarder) Close() error {
	if f.conn != nil {
		return f.conn.Close()
	}
	return nil
}

// ServePortForward handles a port forwarding session using gRPC.
//
// Unlike WS forwarding (which uses Python Router's notification protocol for
// multiple connections), gRPC forwarding uses a single tunnel to Go Router.
// gRPC/HTTP2 handles multiplexing natively - no notification protocol needed.
//
// Flow:
//  1. Agent dials router_go with session key
//  2. User dials router_go with same session key
//  3. router_go pairs them
//  4. Single tunnel handles all HTTP traffic (multiplexed)
func (f *grpcForwarder) ServePortForward(ctx context.Context, cfg *PortForwardConfig) error {
	opts := &ForwardOpts{
		EnableTelemetry: cfg.EnableTelemetry,
		MetricChan:      cfg.MetricChan,
		ActionType:      cfg.Action,
	}
	return f.ForwardTCP(ctx, cfg.Key, cfg.Cookie, cfg.Port, opts)
}

// dialTunnel establishes a tunnel as an agent with auth metadata.
func (f *grpcForwarder) dialTunnel(ctx context.Context, key, cookie string) (*router.Tunnel, error) {
	// Refresh token if needed
	jwtTokenMux.RLock()
	needsRefresh := time.Now().After(tokenExpiration)
	jwtTokenMux.RUnlock()

	if needsRefresh {
		if err := refreshJWTToken(f.cmdArgs); err != nil {
			return nil, fmt.Errorf("refresh token: %w", err)
		}
	}

	// Add auth metadata
	jwtTokenMux.RLock()
	token := jwtToken
	jwtTokenMux.RUnlock()

	md := metadata.Pairs(f.cmdArgs.TokenHeader, token)
	if cookie != "" {
		md.Append("cookie", cookie)
	}
	ctx = metadata.NewOutgoingContext(ctx, md)

	return router.DialAgent(ctx, f.conn, &pb.AgentInit{
		SessionKey: key,
		WorkflowId: f.workflow,
	})
}

// ForwardTCP forwards a gRPC tunnel to a local TCP port.
// Implements the Forwarder interface.
func (f *grpcForwarder) ForwardTCP(ctx context.Context, key, cookie string, port int, opts *ForwardOpts) error {
	tunnel, err := f.dialTunnel(ctx, key, cookie)
	if err != nil {
		return err
	}
	defer tunnel.Close()

	conn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return fmt.Errorf("connect to local port %d: %w", port, err)
	}
	defer conn.Close()

	enableTelemetry := false
	var metricChan chan metrics.Metric
	var actionType ActionType
	if opts != nil {
		enableTelemetry = opts.EnableTelemetry
		metricChan = opts.MetricChan
		actionType = opts.ActionType
	}
	return f.bridge(tunnel, conn, enableTelemetry, metricChan, actionType)
}

// ForwardConn forwards a gRPC tunnel to an existing connection.
// Implements the Forwarder interface.
func (f *grpcForwarder) ForwardConn(ctx context.Context, key, cookie string, conn net.Conn) error {
	tunnel, err := f.dialTunnel(ctx, key, cookie)
	if err != nil {
		return err
	}
	defer tunnel.Close()

	return f.bridge(tunnel, conn, false, nil, "")
}

// ForwardUDP forwards a gRPC tunnel to a local UDP port.
// Implements the Forwarder interface.
//
// UDP REQUIRES EXPLICIT BUFFERS because:
//  1. Datagram-based: must read complete packets, not streams
//  2. Header parsing: 6-byte header contains source address for routing
//  3. Multiplexing: multiple UDP "connections" share one tunnel
//
// We cannot use io.Copy here - UDP fundamentally differs from TCP.
//
// GRACEFUL SHUTDOWN:
//
//	When tunnel read loop exits, we close all UDP connections which causes
//	the reverse reader goroutines to exit. We use a WaitGroup to ensure all
//	reverse readers complete before returning.
func (f *grpcForwarder) ForwardUDP(ctx context.Context, key, cookie string, port int) error {
	tunnel, err := f.dialTunnel(ctx, key, cookie)
	if err != nil {
		return err
	}
	defer tunnel.Close()

	udpConns := make(map[string]net.Conn)
	var mu sync.Mutex
	var wg sync.WaitGroup // Track reverse reader goroutines
	localAddr := fmt.Sprintf("127.0.0.1:%d", port)

	// Single buffer for tunnel reads - reused for all packets
	buf := make([]byte, BUFFERSIZE)

	// Main read loop runs in current goroutine
	for {
		n, err := tunnel.Read(buf)
		if err != nil {
			break // Tunnel closed or error
		}
		if n < 6 {
			continue // Invalid packet, skip
		}

		// Extract source address from 6-byte header
		srcAddr := getSrcAddr(buf[:n])

		mu.Lock()
		conn := udpConns[srcAddr]
		if conn == nil {
			conn, err = net.Dial("udp", localAddr)
			if err != nil {
				mu.Unlock()
				log.Printf("grpc UDP: dial error: %v", err)
				continue
			}
			udpConns[srcAddr] = conn

			// IMPORTANT: Copy header BEFORE releasing the lock and spawning goroutine
			// to avoid race condition where buf gets overwritten
			header := make([]byte, 6)
			copy(header, buf[:6])

			// Start reverse reader for this UDP connection
			wg.Add(1)
			go func(conn net.Conn, header []byte) {
				defer wg.Done()
				readBuf := make([]byte, BUFFERSIZE)
				copy(readBuf[:6], header) // Prepend original header for routing
				for {
					n, err := conn.Read(readBuf[6:])
					if err != nil {
						return // Connection closed
					}
					mu.Lock()
					// tunnel.Write is zero-copy (passes pointer to gRPC)
					_, writeErr := tunnel.Write(readBuf[:n+6])
					mu.Unlock()
					if writeErr != nil {
						return // Tunnel closed
					}
				}
			}(conn, header)
		}
		mu.Unlock()

		// Forward payload (skip 6-byte header)
		if _, err := conn.Write(buf[6:n]); err != nil {
			log.Printf("grpc UDP: write error: %v", err)
		}
	}

	// Close all UDP connections - this unblocks reverse reader goroutines
	mu.Lock()
	for _, conn := range udpConns {
		conn.Close()
	}
	mu.Unlock()

	// Wait for all reverse readers to complete
	wg.Wait()

	return nil
}

// ForwardWebSocket forwards a gRPC tunnel to a local WebSocket.
// Implements the Forwarder interface.
//
// WebSocket requires message framing, so we can't use io.Copy directly.
// However, tunnel.Write() is still zero-copy (passes pointer to gRPC).
//
// GRACEFUL SHUTDOWN (2-goroutine pattern for correctness):
//
//	Both directions run as independent goroutines. When one finishes, it performs
//	a graceful close to signal EOF while allowing the other to complete.
//	We wait for BOTH directions to complete before returning.
func (f *grpcForwarder) ForwardWebSocket(ctx context.Context, key, cookie string, port int, payload map[string]interface{}) error {
	tunnel, err := f.dialTunnel(ctx, key, cookie)
	if err != nil {
		return err
	}
	defer tunnel.Close()

	path, _ := payload["path"].(string)
	wsAddr := fmt.Sprintf("ws://127.0.0.1:%d%s", port, path)

	headers := http.Header{}
	if headerMap, ok := payload["headers"].(map[string]interface{}); ok {
		for k, v := range headerMap {
			if strVal, ok := v.(string); ok {
				headers.Set(k, strVal)
			}
		}
	}

	var wsConn *websocket.Conn
	var wsErr error
	for range dialRetryMax {
		wsConn, _, wsErr = websocket.DefaultDialer.Dial(wsAddr, headers)
		if wsErr == nil {
			break
		}
		time.Sleep(dialRetryInterval)
	}
	if wsErr != nil {
		return fmt.Errorf("connect to local WebSocket: %w", wsErr)
	}
	defer wsConn.Close()

	var wg sync.WaitGroup
	wg.Add(2)

	// WS → Tunnel (tunnel.Write is zero-copy)
	go func() {
		defer wg.Done()
		for {
			// ReadMessage returns the payload directly - no extra copy
			_, data, err := wsConn.ReadMessage()
			if err != nil {
				return
			}
			// tunnel.Write passes the pointer directly to gRPC
			if _, err := tunnel.Write(data); err != nil {
				return
			}
		}
	}()

	// Tunnel → WS (needs framing, one buffer required)
	go func() {
		defer wg.Done()
		// Single buffer, reused for all reads
		buf := make([]byte, BUFFERSIZE)
		for {
			n, err := tunnel.Read(buf)
			if err != nil {
				break
			}
			// WriteMessage frames the data as a WS message
			if err := wsConn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				break
			}
		}
		// Send graceful WS close frame to signal EOF
		wsConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	}()

	// Wait for BOTH directions to complete
	wg.Wait()

	// Half-close tunnel send direction (gRPC CloseSend) before returning
	tunnel.Close()

	return nil
}

// bridge copies data bidirectionally between tunnel and connection using io.Copy.
//
// ZERO-COPY PATH:
//
//	tunnel → conn: io.Copy calls tunnel.WriteTo(conn) - writes directly from gRPC buffer
//	conn → tunnel: io.Copy uses 32KB internal buffer (unavoidable due to gRPC framing)
//
// GRACEFUL SHUTDOWN (2-goroutine pattern for correctness):
//
//	Both directions run as independent goroutines. When one finishes, it performs
//	a half-close to signal EOF while allowing the other to complete. We wait for
//	BOTH directions to complete before fully closing connections.
//
//	conn→tunnel finishes: tunnel.Close() sends gRPC CloseSend (half-close)
//	tunnel→conn finishes: conn.CloseWrite() sends TCP FIN (half-close)
//
// This symmetric design ensures all in-flight data is delivered before teardown.
func (f *grpcForwarder) bridge(tunnel *router.Tunnel, conn net.Conn,
	enableTelemetry bool, metricChan chan metrics.Metric, actionType ActionType) error {

	var startTime string
	if enableTelemetry {
		startTime = time.Now().Format("2006-01-02 15:04:05.000")
	}

	var wg sync.WaitGroup
	var bytesSent, bytesRecv int64

	wg.Add(2)

	// conn → tunnel (uses io.Copy's internal 32KB buffer)
	go func() {
		defer wg.Done()
		n, _ := io.Copy(tunnel, conn)
		bytesSent = n
		// Half-close tunnel's send direction (gRPC CloseSend)
		// Signals EOF to remote while allowing continued receiving
		tunnel.Close()
	}()

	// tunnel → conn (ZERO-COPY via tunnel.WriteTo)
	go func() {
		defer wg.Done()
		n, _ := io.Copy(conn, tunnel)
		bytesRecv = n
		// Half-close conn's write side (TCP FIN)
		// Signals EOF to local service while allowing continued reading
		if tcpConn, ok := conn.(*net.TCPConn); ok {
			tcpConn.CloseWrite()
		}
	}()

	// Wait for BOTH directions to complete - ensures all data is delivered
	wg.Wait()

	// Now fully close the connection (safe - both directions are done)
	conn.Close()

	// Telemetry (if enabled)
	if enableTelemetry && metricChan != nil {
		go putPortforwardTCPTelemetry(metricChan, string(actionType)+"_OUTPUT",
			f.cmdArgs, startTime, bytesSent, 250*time.Millisecond)
		go putPortforwardTCPTelemetry(metricChan, string(actionType)+"_INPUT",
			f.cmdArgs, startTime, bytesRecv, 250*time.Millisecond)
	}

	return nil
}
