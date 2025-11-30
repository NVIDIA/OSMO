/*
Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
*/

// forward_ws.go - WebSocket forwarding implementation
//
// This file contains the WebSocket-based forwarder, which is a direct extraction
// from ctrl.go. The logic is intentionally kept identical to the original to
// avoid regressions.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"go.corp.nvidia.com/osmo/runtime/pkg/args"
	"go.corp.nvidia.com/osmo/runtime/pkg/metrics"
)

// wsForwarder implements Forwarder using WebSocket connections.
// This is the original implementation extracted from ctrl.go.
type wsForwarder struct {
	address  string
	workflow string
	cmdArgs  args.CtrlArgs
}

// newWSForwarder creates a new WebSocket-based forwarder.
func newWSForwarder(address, workflow string, cmdArgs args.CtrlArgs) *wsForwarder {
	return &wsForwarder{
		address:  address,
		workflow: workflow,
		cmdArgs:  cmdArgs,
	}
}

// Close is a no-op for WebSocket forwarder (connections are per-request).
func (f *wsForwarder) Close() error {
	return nil
}

// ServePortForward handles a port forwarding session using WebSocket control channel.
// This is the same logic as the original userPortForward in ctrl.go.
//
// The control channel receives messages from Python router indicating new user connections.
// For each connection, it spawns ForwardTCP or ForwardWebSocket to handle data transfer.
func (f *wsForwarder) ServePortForward(ctx context.Context, cfg *PortForwardConfig) error {
	url := fmt.Sprintf(
		"%s/api/router/%s/%s/backend/%s",
		cfg.RouterAddress, cfg.Action, f.workflow, cfg.Key)

	var conn *websocket.Conn
	var err error
	var retryMax int = 10
	for i := 0; i < retryMax; i++ {
		conn, err = createWebsocketConnection(url, cfg.Cookie, cfg.CmdArgs)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Println("ServePortForward: error connecting to control channel:", err)
		return err
	}
	defer conn.Close()

	log.Printf("ServePortForward: connected, waiting for connections...")

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			if err == io.EOF {
				log.Println("ServePortForward: EOF reached.")
				break
			}
			log.Println("ServePortForward: Error reading control channel:", err)
			break
		}

		var message PortForwardMessage
		err = json.Unmarshal(data, &message)
		if err != nil {
			log.Println("ServePortForward: Error parsing json:", err)
			break
		}

		if message.Type == PortForwardWS {
			go f.ForwardWebSocket(ctx, message.Key, message.Cookie,
				cfg.Port, message.Payload)
		} else {
			opts := &ForwardOpts{
				EnableTelemetry: cfg.EnableTelemetry,
				MetricChan:      cfg.MetricChan,
				ActionType:      cfg.Action,
			}
			go f.ForwardTCP(ctx, message.Key, message.Cookie, cfg.Port, opts)
		}
	}
	return nil
}

// ForwardTCP forwards data via WebSocket to a local TCP port.
// This is the same logic as portforwardConnectTCP in ctrl.go.
func (f *wsForwarder) ForwardTCP(ctx context.Context, key, cookie string, localPort int, opts *ForwardOpts) error {
	var remoteConn *websocket.Conn
	var localConn net.Conn
	var err error
	var retryMax int = 5

	// Use sync primitives to avoid deadlock with unbuffered channels
	var wg sync.WaitGroup
	firstDone := make(chan struct{})
	var closeOnce sync.Once

	url := fmt.Sprintf(
		"%s/api/router/portforward/%s/backend/%s", f.address, f.workflow, key)
	for i := 0; i < retryMax; i++ {
		remoteConn, err = createWebsocketConnection(url, cookie, f.cmdArgs)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Println("portforwardConnectTCP: error connecting to the router:", err)
		return err
	}
	defer remoteConn.Close()

	localAddr := fmt.Sprintf("127.0.0.1:%d", localPort)
	localConn, err = createConnection(localAddr, retryMax, "tcp")
	if err != nil {
		log.Println("portforwardConnectTCP: error connecting to local server listening at port: ",
			localPort, err)
		return err
	}
	defer localConn.Close()
	defer log.Println("Closing local and remote connections. key: ",
		key, localConn.LocalAddr(), remoteConn.LocalAddr())

	actionType := ActionPortForward
	enableTelemetry := false
	var metricChan chan metrics.Metric
	if opts != nil {
		actionType = opts.ActionType
		enableTelemetry = opts.EnableTelemetry
		metricChan = opts.MetricChan
	}

	wg.Add(2)

	// Local -> Remote
	go func() {
		defer wg.Done()
		defer closeOnce.Do(func() { close(firstDone) })

		// Optional telemetry for portforward output
		var bytesSent atomic.Int64
		if enableTelemetry {
			startTime := time.Now().Format("2006-01-02 15:04:05.000")
			defer func() {
				go putPortforwardTCPTelemetry(
					metricChan,
					strings.ToUpper(string(actionType))+"_OUTPUT",
					f.cmdArgs,
					startTime,
					bytesSent.Load(),
					250*time.Millisecond,
				)
			}()
		}

		buffer := make([]byte, BUFFERSIZE)
		for {
			n, err := localConn.Read(buffer)
			if err != nil {
				log.Println("portforwardConnectTCP: Error reading for localConn: ", err)
				return
			}
			err = remoteConn.WriteMessage(websocket.BinaryMessage, buffer[:n])
			if err != nil {
				log.Println("portforwardConnectTCP: Error writing for remoteConn: ", err)
				return
			}

			if enableTelemetry {
				bytesSent.Add(int64(n))
			}
		}
	}()

	// Remote -> Local
	go func() {
		defer wg.Done()
		defer closeOnce.Do(func() { close(firstDone) })

		// Optional telemetry for portforward input
		var bytesReceived atomic.Int64
		if enableTelemetry {
			startTime := time.Now().Format("2006-01-02 15:04:05.000")
			defer func() {
				go putPortforwardTCPTelemetry(
					metricChan,
					strings.ToUpper(string(actionType))+"_INPUT",
					f.cmdArgs,
					startTime,
					bytesReceived.Load(),
					250*time.Millisecond,
				)
			}()
		}

		for {
			_, data, err := remoteConn.ReadMessage()
			if err != nil {
				log.Println("portforwardConnectTCP: Error reading for remoteConn: ", err)
				return
			}

			_, err = localConn.Write(data)
			if err != nil {
				log.Println("portforwardConnectTCP: Error writing for localConn: ", err)
				return
			}

			if enableTelemetry {
				bytesReceived.Add(int64(len(data)))
			}
		}
	}()

	// Wait for first goroutine to finish
	<-firstDone

	// Close connections to unblock the other goroutine
	remoteConn.Close()
	localConn.Close()

	// Wait for both goroutines to complete cleanup
	wg.Wait()
	return nil
}

// ForwardUDP forwards UDP packets via WebSocket.
// This is the same logic as userPortForwardUDP in ctrl.go.
func (f *wsForwarder) ForwardUDP(ctx context.Context, key, cookie string, taskPort int) error {
	url := fmt.Sprintf(
		"%s/api/router/portforward/%s/backend/%s", f.address, f.workflow, key)

	var conn *websocket.Conn
	var mutex sync.Mutex
	var err error
	var retryMax int = 10
	for i := 0; i < retryMax; i++ {
		conn, err = createWebsocketConnection(url, cookie, f.cmdArgs)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Println("userPortForwardUDP: error connecting to the router:", err)
		return err
	}
	defer conn.Close()

	map_addr := make(map[string]net.Conn)
	// Some services like Isaac-sim can not resolve "localhost"
	localAddr := fmt.Sprintf("127.0.0.1:%d", taskPort)
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			if err == io.EOF {
				log.Println("userPortForwardUDP: EOF reached. for port ", taskPort)
			} else {
				log.Println(
					"userPortForwardUDP: Error reading remote connection with port", taskPort, err)
			}
			break
		}

		srcAddr := getSrcAddr(data)
		if map_addr[srcAddr] == nil {
			// Create UDP transport
			localConn, err := createConnection(localAddr, retryMax, "udp")
			if err != nil {
				log.Println("userPortForwardUDP: error connecting to local port:", taskPort, err)
				continue
			}
			map_addr[srcAddr] = localConn
			// Read from UDP transport
			go readUDP(conn, &mutex, localConn, data[:6])
		}

		// Write to UDP transport
		_, err = map_addr[srcAddr].Write(data[6:])
		if err != nil {
			log.Println("userPortForwardUDP: Error local write to local port: ", taskPort, err)
			continue
		}
	}

	// Close all transports
	for _, localConn := range map_addr {
		localConn.Close()
	}
	return nil
}

// ForwardConn forwards data to an existing connection (e.g., Unix socket for exec).
// This is the same logic as ctrlUserExec in ctrl.go.
func (f *wsForwarder) ForwardConn(ctx context.Context, key, cookie string, unixConn net.Conn) error {
	url := fmt.Sprintf("%s/api/router/exec/%s/backend/%s", f.address, f.workflow, key)
	var conn *websocket.Conn
	var err error
	var retryMax int = 5

	for i := 0; i < retryMax; i++ {
		conn, err = createWebsocketConnection(url, cookie, f.cmdArgs)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Println("User Exec: error connecting to the router:", err)
		return err
	}
	defer conn.Close()

	var wg sync.WaitGroup
	firstDone := make(chan struct{})
	var closeOnce sync.Once

	wg.Add(2)

	// WS -> Unix
	go func() {
		defer wg.Done()
		defer closeOnce.Do(func() { close(firstDone) })

		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				if err != io.EOF {
					log.Println("User Exec: Error from connection to exec instance.", err)
				}
				return
			}
			_, err = unixConn.Write(data)
			if err != nil {
				log.Println("User Exec: Error write to exec instance", err)
				return
			}
		}
	}()

	// Unix -> WS
	go func() {
		defer wg.Done()
		defer closeOnce.Do(func() { close(firstDone) })

		data := make([]byte, 1024)
		for {
			n, err := unixConn.Read(data)
			if err != nil {
				log.Println("User Exec: Error from exec instance to connection.", err)
				return
			}
			err = conn.WriteMessage(websocket.BinaryMessage, data[:n])
			if err != nil {
				log.Println("User Exec: Error writing to connection.", err)
				return
			}
		}
	}()

	// Wait for first goroutine to finish
	<-firstDone

	// Close connections to unblock the other
	conn.Close()
	unixConn.Close()

	wg.Wait()
	return nil
}

// ForwardWebSocket bridges a WebSocket connection to a local WebSocket server.
// This is the same logic as portforwardConnectWS in ctrl.go.
func (f *wsForwarder) ForwardWebSocket(ctx context.Context, key, cookie string, localPort int, payload map[string]interface{}) error {
	var remoteConn *websocket.Conn
	var localConn *websocket.Conn
	var err error
	var retryMax int = 5

	var wg sync.WaitGroup
	firstDone := make(chan struct{})
	var closeOnce sync.Once

	url := fmt.Sprintf(
		"%s/api/router/portforward/%s/backend/%s", f.address, f.workflow, key)
	for i := 0; i < retryMax; i++ {
		remoteConn, err = createWebsocketConnection(url, cookie, f.cmdArgs)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Println("portforwardConnectWS: error connecting to the router:", err)
		return err
	}
	defer remoteConn.Close()

	path := ""
	if p, ok := payload["path"].(string); ok {
		path = p
	}
	localAddr := fmt.Sprintf("ws://127.0.0.1:%d%s", localPort, path)
	log.Println("portforwardConnectWS: localAddr", localAddr)
	headers := http.Header{}
	if headerMap, ok := payload["headers"].(map[string]interface{}); ok {
		for k, value := range headerMap {
			if strValue, ok := value.(string); ok {
				headers.Set(k, strValue)
			}
		}
	}

	for i := 0; i < retryMax; i++ {
		localConn, _, err = websocket.DefaultDialer.Dial(localAddr, headers)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Println("portforwardConnectWS: error connecting to local server listening at port: ",
			localPort, err)
		return err
	}
	defer localConn.Close()
	defer log.Println("Closing local and remote connections. key: ",
		key, localConn.LocalAddr(), remoteConn.LocalAddr())

	log.Println("start coroutine")

	wg.Add(2)

	// Remote -> Local
	go func() {
		defer wg.Done()
		defer closeOnce.Do(func() { close(firstDone) })

		for {
			messageType, data, err := remoteConn.ReadMessage()
			if err != nil {
				log.Printf("portforwardConnectWS: Error reading from remote: %v", err)
				return
			}
			err = localConn.WriteMessage(messageType, data)
			if err != nil {
				log.Printf("portforwardConnectWS: Error writing to local: %v", err)
				return
			}
		}
	}()

	// Local -> Remote
	go func() {
		defer wg.Done()
		defer closeOnce.Do(func() { close(firstDone) })

		for {
			messageType, data, err := localConn.ReadMessage()
			if err != nil {
				log.Printf("portforwardConnectWS: Error reading from local: %v", err)
				return
			}
			err = remoteConn.WriteMessage(messageType, data)
			if err != nil {
				log.Printf("portforwardConnectWS: Error writing to remote: %v", err)
				return
			}
		}
	}()

	// Wait for first goroutine to finish
	<-firstDone

	// Close connections to unblock the other
	remoteConn.Close()
	localConn.Close()

	wg.Wait()
	return nil
}

// readUDP reads from a local UDP connection and writes to a WebSocket.
// The 6-byte header (IP:port) is prepended to each message.
func readUDP(remoteConn *websocket.Conn, mutex *sync.Mutex, localConn net.Conn, header []byte) {
	buffer := make([]byte, BUFFERSIZE)
	copy(buffer[:6], header[:6])

	for {
		n, err := localConn.Read(buffer[6:])
		if err != nil {
			if err != io.EOF {
				log.Println("readUDP: Error reading:", err)
				log.Println("Address for local and remote:",
					localConn.LocalAddr(), localConn.RemoteAddr())
			} else {
				log.Println("readUDP: EOF reached. Address for local and remote:",
					localConn.LocalAddr(), localConn.RemoteAddr())
			}
			break
		}

		mutex.Lock()
		err = remoteConn.WriteMessage(websocket.BinaryMessage, buffer[:n+6])
		mutex.Unlock()
		if err != nil {
			log.Println("readUDP: Error write to websocket", err)
			return
		}
	}
}
