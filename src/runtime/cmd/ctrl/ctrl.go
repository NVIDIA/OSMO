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

package main

import (
	"bufio"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"go.corp.nvidia.com/osmo/runtime/pkg/args"
	"go.corp.nvidia.com/osmo/runtime/pkg/common"
	"go.corp.nvidia.com/osmo/runtime/pkg/data"
	"go.corp.nvidia.com/osmo/runtime/pkg/messages"
	"go.corp.nvidia.com/osmo/runtime/pkg/metrics"
	"go.corp.nvidia.com/osmo/runtime/pkg/osmo_errors"
	"go.corp.nvidia.com/osmo/runtime/pkg/rsync"

	"github.com/gorilla/websocket"
	"gopkg.in/yaml.v3"
)

const BUFFERSIZE int = 32 * 1024
const BARRIER_TICKER_DURATION = time.Duration(5) * time.Minute

var waitGoRoutines sync.WaitGroup
var webConn *websocket.Conn
var bufferMutex sync.Mutex
var numDroppedMsg int
var jwtTokenMux sync.RWMutex
var jwtToken string // Should only be written by refreshJWTToken()
var tokenExpiration time.Time
var barrierMutex sync.Mutex

// This only work for sequential barrier calls, namely no parallel barrier calls in the user task
var barrierReq string

var rsyncStatus rsync.RsyncStatus

type PortForwardType string

const (
	PortForwardTCP PortForwardType = "tcp"
	PortForwardWS  PortForwardType = "ws"
)

type ActionType string

const (
	ActionExec        ActionType = "exec"
	ActionPortForward ActionType = "portforward"
	ActionWebServer   ActionType = "webserver"
	ActionBarrier     ActionType = "barrier"
	ActionRestart     ActionType = "restart"
	ActionLogDone     ActionType = "log_done"
	ActionRsync       ActionType = "rsync"
)

type Credential struct {
	Id  string `json:"access_key_id"`
	Key string `json:"access_key"`
}

type PortForwardMessage struct {
	Key     string                 `json:"key"`
	Cookie  string                 `json:"cookie"`
	Type    PortForwardType        `json:"type,omitempty"`
	Payload map[string]interface{} `json:"payload,omitempty"`
}

type JWTTokenResponse struct {
	Token     string `json:"token"`
	ExpiresAt int    `json:"expires_at"`
	Error     string `json:"error"`
}

type ErrorType string

const (
	PendingError      ErrorType = "PENDING"
	FetchFailureError ErrorType = "FETCH_FAILURE"
	InvalidTokenError ErrorType = "INVALID_TOKEN"
	FinishedError     ErrorType = "FINISHED"
)

type DialWebsocketError struct {
	ErrorType string
	Message   string
}

func (e *DialWebsocketError) Error() string {
	return e.Message
}

func refreshJWTToken(cmdArgs args.CtrlArgs) error {
	refreshToken, err := os.ReadFile(cmdArgs.RefreshToken)
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.TOKEN_INVALID_CODE)
		panic(fmt.Sprintf("Unable to read refresh token from file %s due to error %s\n",
			cmdArgs.RefreshToken, err))
	}

	// Create a URL object from the base URL
	u, err := url.Parse(cmdArgs.RefreshTokenUrl.String())
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.TOKEN_INVALID_CODE)
		panic(fmt.Sprintf("Parsing refreshUrl failed: %v\n%s", cmdArgs.RefreshTokenUrl, err))
	}

	// Query parameters
	params := url.Values{}
	// Get refresh token
	params.Add("refresh_token", string(refreshToken))
	params.Add("workflow_id", cmdArgs.Workflow)
	params.Add("group_name", cmdArgs.GroupName)
	params.Add("task_name", cmdArgs.LogSource)
	params.Add("retry_id", cmdArgs.RetryId)

	// Encode query parameters and append to the base URL
	u.RawQuery = params.Encode()
	resp, err := http.Get(u.String())
	if err != nil {
		return &DialWebsocketError{
			ErrorType: string(FetchFailureError),
			Message:   fmt.Sprintf("Error fetching new jwt token: %s\n", err),
		}
	}
	if resp.StatusCode != http.StatusOK {
		var jwtTokenResp JWTTokenResponse
		err := json.NewDecoder(resp.Body).Decode(&jwtTokenResp)
		if err != nil {
			return &DialWebsocketError{
				ErrorType: string(FetchFailureError),
				Message:   fmt.Sprintf("Error getting new jwt token: %s\n", resp.Status),
			}
		}
		if jwtTokenResp.Error == string(PendingError) {
			return &DialWebsocketError{
				ErrorType: string(PendingError),
				Message:   "Waiting for task to enter RUNNING status.",
			}
		}
		if jwtTokenResp.Error == string(FinishedError) {
			return &DialWebsocketError{
				ErrorType: string(FinishedError),
				Message:   "Task has finished.",
			}
		}
	} else {
		var jwtTokenResp JWTTokenResponse
		err := json.NewDecoder(resp.Body).Decode(&jwtTokenResp)
		if err != nil {
			return &DialWebsocketError{
				ErrorType: string(InvalidTokenError),
				Message:   fmt.Sprintf("Error decoding jwt token response: %s\n", err),
			}
		}
		log.Printf("Retrieved jwt token.")
		jwtTokenMux.Lock()
		jwtToken = jwtTokenResp.Token
		tokenExpiration = time.Unix(int64(jwtTokenResp.ExpiresAt), 0)
		jwtTokenMux.Unlock()
	}

	return nil
}

func dialWebsocket(url string, conn **websocket.Conn, cmdArgs args.CtrlArgs, retryCount int) error {
	// TODO: Validate ssl certs when this is moved into a sidecar
	// container where we can add a list of certificate authorities.
	dialer := *websocket.DefaultDialer
	dialer.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}

	var err error
	var newConn *websocket.Conn
	var resp *http.Response
	var isRefresh bool = false

	// Check if token is valid
	jwtTokenMux.RLock()
	isRefresh = time.Now().After(tokenExpiration)
	jwtTokenMux.RUnlock()
	if isRefresh {
		err := refreshJWTToken(cmdArgs)
		if err != nil {
			// Exponential backoff
			exponent := common.Min(retryCount, 5)
			delay := time.Duration(math.Pow(2, float64(exponent))) * time.Second
			time.Sleep(delay)
			return err
		}
	}
	headerKey := cmdArgs.TokenHeader
	headers := make(http.Header)
	jwtTokenMux.RLock()
	headers.Add(headerKey, jwtToken)
	jwtTokenMux.RUnlock()

	newConn, resp, err = dialer.Dial(url, headers)
	*conn = newConn
	if err != nil {
		// Enhanced error logging with HTTP response details
		if resp != nil {
			log.Printf("Websocket connection failed - URL: %s, Status: %s (%d), Error: %s",
				url, resp.Status, resp.StatusCode, err)
			if len(resp.Header) > 0 {
				log.Printf("Response headers: %v", resp.Header)
			}
		}
		if !data.WebsocketConnection.ReachedTimeout() {
			// Exponential backoff
			exponent := common.Min(retryCount, 5)
			delay := time.Duration(math.Pow(2, float64(exponent))) * time.Second
			time.Sleep(delay)
			return err
		}

		log.Printf("Unable to connect to websocket: Timeout")
		osmo_errors.SetExitCode(osmo_errors.WEBSOCKET_TIMEOUT_CODE)
		panic(fmt.Sprintf("Failed to connect to websocket %s with error: %s", url, err))
	}
	return nil
}

func connWorkflowService(url string, cmdArgs args.CtrlArgs) {
	// Attempt to dial the websocket
	data.WebsocketConnection.DisconnectStartTime = time.Now()
	count := 0

	for {
		err := dialWebsocket(url, &webConn, cmdArgs, count)
		if err != nil {
			count++
			if count%100 == 1 {
				switch e := err.(type) {
				case *DialWebsocketError:
					if e.ErrorType == string(PendingError) {
						log.Println("Waiting for task status to update to RUNNING.")
					} else {
						log.Printf("Failed to connect to websocket %s with %s error: %s",
							url, e.ErrorType, e.Message)
					}
				default:
					log.Printf("Failed to connect to websocket %s with error: %s", url, err)
				}
			}
			continue
		}
		break
	}
	if count == 0 {
		log.Printf("Connected to websocket")
	} else {
		log.Printf("Connected to websocket: %s retries", strconv.Itoa(count))
	}
}

// Enqueue log into circular queue in a threadsafe manner
func threadsafeEnqueue(logQueue *common.CircularBuffer, message string) {
	bufferMutex.Lock()
	defer bufferMutex.Unlock()
	if logQueue.IsFull() {
		numDroppedMsg++
	}
	logQueue.Push(message)
}

// Reads from both channels and writes the output into the websocket
func putLogs(
	logSource string, osmoChan chan string, downloadChan chan string, uploadChan chan string,
	stopChan chan bool, metricChan chan metrics.Metric, logQueue *common.CircularBuffer) {
	for {
		var logMsg string
		select {
		case downloadMsg := <-downloadChan:
			logMsg = messages.CreateLog(logSource, downloadMsg, messages.Download)
			log.Printf("%s", downloadMsg)
			threadsafeEnqueue(logQueue, logMsg)
		case uploadMsg := <-uploadChan:
			logMsg = messages.CreateLog(logSource, uploadMsg, messages.Upload)
			log.Printf("%s", uploadMsg)
			threadsafeEnqueue(logQueue, logMsg)
		case osmoMsg := <-osmoChan:
			logMsg = messages.CreateLog(logSource, osmoMsg, messages.OSMOCtrl)
			log.Printf("%s", osmoMsg)
			threadsafeEnqueue(logQueue, logMsg)
		case osmoMetrics := <-metricChan:
			logMsg = metrics.CreateMetrics(logSource, osmoMetrics, metrics.Metrics)
			threadsafeEnqueue(logQueue, logMsg)
		case <-stopChan:
			defer waitGoRoutines.Done()
			log.Printf("Go routine putLogs is done")
			return
		}
	}
}

type ServiceRequest struct {
	Action          ActionType
	RouterAddress   string `json:"router_address"`
	EntryCommand    string `json:"entry_command"`
	TaskPort        int    `json:"task_port"`
	Key             string `json:"key"`
	Cookie          string `json:"cookie"`
	UseUDP          bool   `json:"use_udp"`
	EnableTelemetry bool   `json:"enable_telemetry"`
}

func createWebsocketConnection(
	address string, cookie string, cmdArgs args.CtrlArgs) (*websocket.Conn, error) {
	var conn *websocket.Conn = nil
	var err error = nil
	var isRefresh bool = false

	jwtTokenMux.RLock()
	isRefresh = time.Now().After(tokenExpiration)
	jwtTokenMux.RUnlock()
	if isRefresh {
		err := refreshJWTToken(cmdArgs)
		if err != nil {
			time.Sleep(1 * time.Second)
			return nil, err
		}
	}

	headerKey := cmdArgs.TokenHeader
	headers := make(http.Header)
	jwtTokenMux.RLock()
	headers.Add(headerKey, jwtToken)
	jwtTokenMux.RUnlock()
	headers.Add("Cookie", cookie)

	conn, _, err = websocket.DefaultDialer.Dial(address, headers)
	return conn, err
}

func createConnection(address string, retryMax int, protocal string) (net.Conn, error) {
	var conn net.Conn = nil
	var err error = nil
	for i := 0; i < retryMax; i++ {
		conn, err = net.Dial(protocal, address)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	return conn, err
}

func sendUserExecStart(unixConn net.Conn, entryCommand string) error {
	return json.NewEncoder(unixConn).Encode(
		messages.UserExecStartRequest(entryCommand))
}

func ctrlUserExec(unixConn net.Conn, routerAddress string, key string, cookie string,
	cmdArgs args.CtrlArgs) {
	defer unixConn.Close()
	url := fmt.Sprintf("%s/api/router/exec/%s/backend/%s", routerAddress, cmdArgs.Workflow, key)
	var conn *websocket.Conn
	var err error
	var retryMax int = 5

	for i := 0; i < retryMax; i++ {
		conn, err = createWebsocketConnection(url, cookie, cmdArgs)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Println("User Exec: error connecting to the router:", err)
		return
	}
	defer conn.Close()

	var waitGroup sync.WaitGroup
	waitGroup.Add(1)

	go func() {
		for {
			_, data, err := conn.ReadMessage()
			if err != nil && err != io.EOF {
				log.Println(
					"User Exec: Error from connection to exec instance. ", err)
				break
			}
			_, err = unixConn.Write(data)
			if err != nil {
				log.Println("User Exec: Error write to exec instance", err)
				break
			}
		}
	}()

	go func() {
		defer waitGroup.Done()
		data := make([]byte, 1024)
		for {
			n, err := unixConn.Read(data)
			if err != nil {
				log.Println("User Exec: Error from exec instance to connection.", err)
				break
			}
			err = conn.WriteMessage(websocket.BinaryMessage, data[:n])
			if err != nil {
				log.Println("User Exec: Error writing to connection.", err)
				break
			}
		}
	}()
	waitGroup.Wait()
}

func userPortForwardTCP(
	routerAddress string,
	clientInfo ServiceRequest,
	cmdArgs args.CtrlArgs,
	metricChan chan metrics.Metric,
) {
	url := fmt.Sprintf(
		"%s/api/router/%s/%s/backend/%s",
		routerAddress, clientInfo.Action, cmdArgs.Workflow, clientInfo.Key)

	var conn *websocket.Conn
	var err error
	var retryMax int = 10
	for i := 0; i < retryMax; i++ {
		conn, err = createWebsocketConnection(url, clientInfo.Cookie, cmdArgs)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Println("userPortForwardTCP: error connecting to the router:", err)
		return
	}
	defer conn.Close()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			if err == io.EOF {
				log.Println("userPortForwardTCP: EOF reached.")
				break
			}
			log.Println("userPortForwardTCP: Error reading websocket connection:", err)
			break
		}

		// Get the key and cookie of the remote connection
		var message PortForwardMessage
		err = json.Unmarshal(data, &message)
		if err != nil {
			log.Println("userPortForwardTCP: Error parsing json:", err)
			break
		}

		if message.Type == PortForwardWS {
			go portforwardConnectWS(
				routerAddress, message, clientInfo.TaskPort, cmdArgs)
		} else {
			go portforwardConnectTCP(
				clientInfo.Action,
				routerAddress,
				message.Key,
				message.Cookie,
				clientInfo.TaskPort,
				cmdArgs,
				clientInfo.EnableTelemetry,
				metricChan,
			)
		}
	}
}

func copyWebsocket(dst, src *websocket.Conn, closeConn chan bool) {
	defer func() { closeConn <- true }()
	for {
		messageType, data, err := src.ReadMessage()
		if err != nil {
			log.Printf("Error reading from websocket: %v", err)
			return
		}
		err = dst.WriteMessage(messageType, data)
		if err != nil {
			log.Printf("Error writing to websocket: %v", err)
			return
		}
	}
}

func putPortforwardTCPTelemetry(
	metricChan chan metrics.Metric,
	metricsType string,
	cmdArgs args.CtrlArgs,
	startTime string,
	sizeInBytes int64,
	timeout time.Duration,
) {
	metric := metrics.TaskIOMetrics{
		RetryId:      cmdArgs.RetryId,
		GroupName:    cmdArgs.GroupName,
		TaskName:     cmdArgs.LogSource,
		Type:         metricsType,
		StartTime:    startTime,
		EndTime:      time.Now().Format("2006-01-02 15:04:05.000"),
		SizeInBytes:  sizeInBytes,
		DownloadType: data.NotApplicable,
	}

	select {
	case metricChan <- metric:
		// Successfully sent metrics
	case <-time.After(timeout):
		log.Println("Timeout putting metrics in log queue")
	}
}

func portforwardConnectTCP(
	actionType ActionType,
	routerAddress string,
	key string,
	cookie string,
	localPort int,
	cmdArgs args.CtrlArgs,
	enableTelemetry bool,
	metricChan chan metrics.Metric,
) {
	var remoteConn *websocket.Conn
	var localConn net.Conn
	var err error
	var retryMax int = 5
	closeConn := make(chan bool)

	// Wait for both go routines to complete
	defer func() {
		<-closeConn
	}()

	url := fmt.Sprintf(
		"%s/api/router/portforward/%s/backend/%s", routerAddress, cmdArgs.Workflow, key)
	for i := 0; i < retryMax; i++ {
		remoteConn, err = createWebsocketConnection(url, cookie, cmdArgs)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Println("portforwardConnectTCP: error connecting to the router:", err)
		return
	}

	defer remoteConn.Close()

	localAddr := fmt.Sprintf("127.0.0.1:%d", localPort)
	localConn, err = createConnection(localAddr, retryMax, "tcp")
	if err != nil {
		log.Println("portforwardConnectTCP: error connecting to local server listening at port: ",
			localPort, err)
		return
	}
	defer localConn.Close()
	defer log.Println("Closing local and remote connections. key: ",
		key, localConn.LocalAddr(), remoteConn.LocalAddr())

	go func() {
		// Optional telemetry for portforward output
		var bytesSent atomic.Int64
		if enableTelemetry {
			startTime := time.Now().Format("2006-01-02 15:04:05.000")
			defer func() {
				go putPortforwardTCPTelemetry(
					metricChan,
					strings.ToUpper(string(actionType))+"_OUTPUT",
					cmdArgs,
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
				log.Println("Address for local and remote: ",
					localConn.LocalAddr(), localConn.RemoteAddr())
				break
			}
			err = remoteConn.WriteMessage(websocket.BinaryMessage, buffer[:n])
			if err != nil {
				log.Println("portforwardConnectTCP: Error writing for remoteConn: ", err)
				log.Println("Address for local and remote: ",
					remoteConn.LocalAddr(), remoteConn.RemoteAddr())
				break
			}

			if enableTelemetry {
				bytesSent.Add(int64(n))
			}
		}
		log.Println("portforwardConnectTCP: local to remote for loop is done. key: ", key)
		closeConn <- true
	}()

	go func() {
		// Optional telemetry for portforward input
		var bytesReceived atomic.Int64
		if enableTelemetry {
			startTime := time.Now().Format("2006-01-02 15:04:05.000")
			defer func() {
				go putPortforwardTCPTelemetry(
					metricChan,
					strings.ToUpper(string(actionType))+"_INPUT",
					cmdArgs,
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
				log.Println("Address for local and remote: ",
					remoteConn.LocalAddr(), remoteConn.RemoteAddr())
				break
			}

			_, err = localConn.Write(data)
			if err != nil {
				log.Println("portforwardConnectTCP: Error writing for localConn: ", err)
				log.Println("Address for local and remote: ",
					localConn.LocalAddr(), localConn.RemoteAddr())
				break
			}

			if enableTelemetry {
				bytesReceived.Add(int64(len(data)))
			}
		}
		log.Println("portforwardConnectTCP: remote to local for loop is done. key: ", key)
		closeConn <- true
	}()

	// If one connection breaks, close both
	<-closeConn
}

func portforwardConnectWS(routerAddress string, message PortForwardMessage, localPort int,
	cmdArgs args.CtrlArgs) {
	var remoteConn *websocket.Conn
	var localConn *websocket.Conn
	var err error
	var retryMax int = 5
	closeConn := make(chan bool)

	// Wait for both go routines to complete
	defer func() {
		<-closeConn
	}()

	url := fmt.Sprintf(
		"%s/api/router/portforward/%s/backend/%s", routerAddress, cmdArgs.Workflow, message.Key)
	for i := 0; i < retryMax; i++ {
		remoteConn, err = createWebsocketConnection(url, message.Cookie, cmdArgs)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Println("portforwardConnectWS: error connecting to the router:", err)
		return
	}

	defer remoteConn.Close()

	localAddr := fmt.Sprintf("ws://127.0.0.1:%d%s", localPort, message.Payload["path"])
	log.Println("portforwardConnectWS: localAddr", localAddr)
	headers := http.Header{}
	if headerMap, ok := message.Payload["headers"].(map[string]interface{}); ok {
		for key, value := range headerMap {
			if strValue, ok := value.(string); ok {
				headers.Set(key, strValue)
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
		return
	}
	defer localConn.Close()
	defer log.Println("Closing local and remote connections. key: ",
		message.Key, localConn.LocalAddr(), remoteConn.LocalAddr())

	log.Println("start coroutine")
	go copyWebsocket(remoteConn, localConn, closeConn)
	go copyWebsocket(localConn, remoteConn, closeConn)

	// If one connection breaks, close both
	<-closeConn
}

func userPortForwardUDP(
	routerAddress string, key string, cookie string, taskPort int, cmdArgs args.CtrlArgs) {
	url := fmt.Sprintf(
		"%s/api/router/portforward/%s/backend/%s", routerAddress, cmdArgs.Workflow, key)

	var conn *websocket.Conn
	var mutex sync.Mutex
	var err error
	var retryMax int = 10
	for i := 0; i < retryMax; i++ {
		conn, err = createWebsocketConnection(url, cookie, cmdArgs)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Println("userPortForwardUDP: error connecting to the router:", err)
		return
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
}

func getSrcAddr(data []byte) string {
	host := (net.IP)(data[:4])
	var portData = []byte{0, 0, data[4], data[5]}
	port := binary.BigEndian.Uint32(portData)
	srcAddr := fmt.Sprintf("%s:%d", host.String(), port)
	return srcAddr
}

func readUDP(remoteConn *websocket.Conn, mutex *sync.Mutex,
	localConn net.Conn, data []byte) {
	buffer := make([]byte, BUFFERSIZE)
	copy(buffer[:6], data[:6])

	for {
		n, err := localConn.Read(buffer[6:])
		if err != nil {
			if err != io.EOF {
				log.Println("readUDP: Error reading: ", err)
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

func sendLogs(logSource string, logQueue *common.CircularBuffer, logsPeriodMs int,
	stopChan chan bool) {
	// Adjust the interval for throttling
	ticker := time.NewTicker(time.Duration(logsPeriodMs) * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-stopChan:
			defer waitGoRoutines.Done()
			log.Println("Goroutine sendLogs is done")
			return
		case <-ticker.C:
			if data.WebsocketConnection.IsBroken {
				continue
			}
			bufferMutex.Lock()
			// Only pop when log is successfully pushed through the websocket connection
			logJson, err := logQueue.Peek()
			if err == nil {
				if numDroppedMsg > 0 {
					warningMsg := fmt.Sprintf("WARNING: Maximum logging rate exceeded, "+
						"%d lines have been dropped!", numDroppedMsg)
					logMsg := messages.CreateLog(logSource, warningMsg, messages.StdErr)
					err := messages.Put(webConn, logMsg)
					if err != nil {
						continue
					}
					numDroppedMsg = 0
				}
				err := messages.Put(webConn, logJson)
				if err != nil {
					log.Println("Failed to send log message:", err, logJson)
				} else {
					logQueue.Pop()
				}
			}
			bufferMutex.Unlock()
		}
	}
}

// Keeps websocket connection alive and catch any errors from the server
func pingPang(timeout time.Duration, url string, osmoChan chan string, startExecChan chan bool,
	restartChan chan bool, metricChan chan metrics.Metric,
	unixConn net.Conn, logsFinished *bool, cmdArgs args.CtrlArgs,
	listener net.Listener, logQueue *common.CircularBuffer) {

	count := 0
	logCount := 0.0
	for {
		if data.WebsocketConnection.IsBroken {
			if count == 0 {
				// Close the old connection
				webConn.WriteControl(websocket.CloseMessage, nil, time.Now().Add(time.Second))
				webConn.Close()
				log.Println("Connection lost, trying to reconnect...")
				data.WebsocketConnection.DisconnectStartTime = time.Now()
			}

			count++
			err := dialWebsocket(url, &webConn, cmdArgs, count)
			if err != nil {
				if count == 1 || math.Mod(logCount, 60) == 0 {
					log.Printf("Failed to connect to websocket %s with error: %s. "+
						"%s mins till timeout.", url, err,
						data.WebsocketConnection.TimeLeft().Truncate(time.Second))
					logCount = 0
				}
				logCount++
				continue
			}
			log.Printf("Reconnected successfully: %s retries", strconv.Itoa(count))
			osmoChan <- "Websocket Connection: " + strconv.Itoa(count)
			count = 0

			data.WebsocketConnection.IsBroken = false
		}

		err := webConn.WriteControl(websocket.PingMessage, nil, time.Now().Add(timeout))
		if err != nil {
			log.Println("Failed to send ping:", err)
			data.WebsocketConnection.IsBroken = true
			continue
		}

		messageType, message, err := webConn.ReadMessage()
		if err != nil {
			log.Println("Failed to get message:", err)
			data.WebsocketConnection.IsBroken = true
			continue
		}
		switch messageType {
		case websocket.TextMessage:
			var serviceInfo ServiceRequest
			err := json.Unmarshal(message, &serviceInfo)
			if err != nil {
				log.Println("Error parsing Text JSON:", err)
				continue
			}
			if serviceInfo.Action == ActionLogDone {
				*logsFinished = true
				log.Printf("Go routine pingPang is done")
				return
			}
		case websocket.BinaryMessage:
			var clientInfo ServiceRequest
			err := json.Unmarshal(message, &clientInfo)
			if err != nil {
				log.Println("Error parsing Binary JSON:", err)
				continue
			}
			if clientInfo.Action == ActionExec {
				log.Printf("Receive exec action")
				err := sendUserExecStart(unixConn, clientInfo.EntryCommand)
				if err != nil {
					log.Println("Error sending user exec start request", err)
					continue
				}
				unixListener := listener.(*net.UnixListener)
				unixListener.SetDeadline(time.Now().Add(cmdArgs.ExecTimeout))
				execConn, err := listener.Accept()
				if err != nil {
					log.Println("Error connect to user terminal", err)
					continue
				}
				go ctrlUserExec(execConn, clientInfo.RouterAddress, clientInfo.Key,
					clientInfo.Cookie, cmdArgs)
			} else if clientInfo.Action == ActionPortForward {
				log.Printf("Receive portforward action")
				if clientInfo.UseUDP {
					go userPortForwardUDP(
						clientInfo.RouterAddress, clientInfo.Key,
						clientInfo.Cookie, clientInfo.TaskPort, cmdArgs)
				} else {
					go userPortForwardTCP(clientInfo.RouterAddress, clientInfo, cmdArgs, metricChan)
				}
			} else if clientInfo.Action == ActionWebServer {
				go userPortForwardTCP(clientInfo.RouterAddress, clientInfo, cmdArgs, metricChan)
			} else if clientInfo.Action == ActionBarrier {
				log.Printf("Receive barrier action")
				barrierMutex.Lock()
				localBarrierReq := barrierReq
				barrierReq = ""
				barrierMutex.Unlock()
				if localBarrierReq != "" {
					startExecChan <- true
				}
			} else if clientInfo.Action == ActionRestart {
				osmoChan <- "Receive restart action"
				barrierMutex.Lock()
				localBarrierReq := barrierReq
				barrierMutex.Unlock()
				if localBarrierReq != "" { // Skip restart if user command hasn't start
					log.Println("Skip restart action")
					continue
				}
				go restartExec(osmoChan, startExecChan, restartChan, unixConn, cmdArgs, logQueue)
			} else if clientInfo.Action == ActionRsync {
				osmoChan <- "Receive rsync action"
				if !rsyncStatus.IsRunning() {
					log.Println("User Rsync is not running/ready for connection")
					continue
				}

				if clientInfo.TaskPort != int(common.RsyncPort) {
					clientInfo.TaskPort = int(common.RsyncPort)
				}

				go userPortForwardTCP(clientInfo.RouterAddress, clientInfo, cmdArgs, metricChan)
			}
		}
	}
}

// Wait until barrier has been met to restart user command
func restartExec(osmoChan chan string, startExecChan chan bool, restartChan chan bool,
	unixConn net.Conn, cmdArgs args.CtrlArgs, logQueue *common.CircularBuffer) {

	err := json.NewEncoder(unixConn).Encode(messages.UserStopRequest())
	if err != nil {
		osmoChan <- "Failed to send stop request"
		return
	}
	<-restartChan

	if cmdArgs.Barrier != "" {
		barrier(osmoChan, startExecChan, cmdArgs.Barrier, logQueue)
	}

	err = json.NewEncoder(unixConn).Encode(messages.UserStartRequest())
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.UNIX_MESSAGE_FAILED_CODE)
		panic(fmt.Sprintf("Failed to send request: %v\n", err))
	}
}

func copyFile(src string, dest string) {
	srcFile, err := os.Open(src)
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.FILE_FAILED_CODE)
		panic(fmt.Sprintf("File %s not found.", src))
	}
	defer srcFile.Close()
	destFile, err := os.Create(dest)
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.FILE_FAILED_CODE)
		panic(fmt.Sprintf("Failed to create file %s: %s", dest, err))
	}
	defer destFile.Close()
	if _, err = io.Copy(destFile, srcFile); err != nil {
		osmo_errors.SetExitCode(osmo_errors.FILE_FAILED_CODE)
		panic(fmt.Sprintf("Copy from %s to %s failed: %s", src, dest, err))
	}
}

func downloadInputs(c net.Conn, inputs common.ArrayFlags, inputPath string,
	downloadType string, osmoChan chan string, metricChan chan metrics.Metric, retryId string,
	groupName string, taskName string, userConfig string, serviceConfig string, configLoc string,
	cacheSize int) {

	inputType := "Mounting"
	if downloadType == data.Download {
		inputType = "Downloading"
	} else {
		// This is required for FUSE to properly work. Some machines already have /etc/mtab configured
		if _, statErr := os.Stat("/etc/mtab"); errors.Is(statErr, os.ErrNotExist) {
			if err := os.Symlink("/proc/mounts", "/etc/mtab"); err != nil {
				osmo_errors.SetExitCode(osmo_errors.MOUNT_FAILED_CODE)
				panic(fmt.Sprintf("Failed to create symlink /etc/mtab -> /proc/mounts: %v", err))
			}
		}
	}
	osmoChan <- inputType + " Start"

	numInputs := len(inputs)
	for inputIndex, line := range inputs {
		log.Printf("%s %s", inputType, line)
		osmoChan <- inputType + " " + data.ParseInputOutput(line).GetLogInfo()
		inputType := data.ParseInputOutput(line)
		inputInfo, isTypeInput := inputType.(data.InputType)
		if !isTypeInput {
			osmo_errors.SetExitCode(osmo_errors.INVALID_INPUT_CODE)
			panic("Incorrect Input: Output Received")
		}
		if _, isTypeTask := inputInfo.(data.TaskInput); isTypeTask {
			copyFile(serviceConfig, configLoc)
		} else {
			copyFile(userConfig, configLoc)
		}

		// Open data config file
		yfile, err := os.ReadFile(configLoc)
		if err != nil {
			osmo_errors.SetExitCode(osmo_errors.DOWNLOAD_FAILED_CODE)
			panic(fmt.Sprintf("Cannot open config file: %s", err.Error()))
		}

		var configFile data.ConfigInfo
		err = yaml.Unmarshal(yfile, &configFile)
		if err != nil {
			osmo_errors.SetExitCode(osmo_errors.DOWNLOAD_FAILED_CODE)
			panic(fmt.Sprintf("Cannot read config file: %s", err.Error()))
		}

		inputInfo.CreateMount(c, inputPath, configFile, osmoChan,
			metricChan, retryId, groupName, taskName, downloadType, inputIndex,
			cacheSize/numInputs)
	}
	log.Println("All Inputs Gathered")
	osmoChan <- "All Inputs Gathered"
}

func uploadOutputs(c net.Conn, outputs common.ArrayFlags,
	outputPath string, metadataFile string, osmoChan chan string,
	metricChan chan metrics.Metric, retryId string, groupName string,
	taskName string, userConfig string, serviceConfig string, configLoc string) {

	osmoChan <- "Upload Start"

	isEmpty, err := common.IsDirEmpty(outputPath)
	if err != nil {
		log.Println(err)
	}
	if isEmpty {
		log.Println("No Files in Output Folder")
		osmoChan <- "No Files in Output Folder"
		return
	}

	for outputIndex, line := range outputs {
		outputType := data.ParseInputOutput(line)
		log.Printf("Uploading %s", line)
		osmoChan <- "Uploading " + outputType.GetLogInfo()

		outputInfo, isTypeOutput := outputType.(data.OutputType)
		if !isTypeOutput {
			osmo_errors.SetExitCode(osmo_errors.INVALID_INPUT_CODE)
			panic("Incorrect Output: Input Received")
		}

		_, isTypeTask := outputInfo.(*data.TaskOutput)
		_, isTypeKpi := outputInfo.(*data.KpiOutput)
		if isTypeTask || isTypeKpi {
			copyFile(serviceConfig, configLoc)
		} else {
			copyFile(userConfig, configLoc)
		}

		// TODO: Make each if statement a generalized function in outputInfo
		// Set the metadata file for datasets
		if datasetInfo, isTypeDataset := outputInfo.(*data.DatasetOutput); isTypeDataset {
			datasetInfo.MetadataFile = metadataFile
			datasetInfo.UploadFolder(c, outputPath, osmoChan, metricChan, retryId, groupName,
				taskName, outputType.GetUrlIdentifier(), outputIndex)

		} else if updateDatasetInfo, isTypeUpdateDataset :=
			outputInfo.(*data.UpdateDatasetOutput); isTypeUpdateDataset {

			updateDatasetInfo.MetadataFile = metadataFile
			updateDatasetInfo.UploadFolder(c, outputPath, osmoChan, metricChan, retryId, groupName,
				taskName, outputType.GetUrlIdentifier(), outputIndex)

		} else if kpiInfo, isTypeKpi := outputInfo.(*data.KpiOutput); isTypeKpi {
			kpiPath := outputPath + kpiInfo.Path
			if _, err := os.Stat(kpiPath); errors.Is(err, os.ErrNotExist) {
				osmoChan <- fmt.Sprintf("KPI file: %s does not exist", kpiPath)
			} else {
				// kpi file exists
				outputInfo.UploadFolder(c, outputPath, osmoChan, metricChan, retryId, groupName,
					taskName, outputType.GetUrlIdentifier(), outputIndex)
			}

		} else {
			outputInfo.UploadFolder(c, outputPath, osmoChan, metricChan, retryId, groupName,
				taskName, outputType.GetUrlIdentifier(), outputIndex)
		}
	}

	osmoChan <- "All Outputs Uploaded"
}

func cleanupMounts(downloadType string) {
	if downloadType == "download" {
		return
	}

	// Keep attempting to unmount until no matching mounts remain
	for {
		mountPoints := findMountPointsForCleanup(downloadType)
		if len(mountPoints) == 0 {
			break
		}
		for _, mp := range mountPoints {
			// Use the setuid FUSE helper explicitly per request
			fuserMountPath := common.ResolveCommandPath("FUSERMOUNT_PATH", "fusermount", "/usr/bin/fusermount")
			cmd := exec.Command(fuserMountPath, "-u", mp)
			if output, err := cmd.CombinedOutput(); err != nil {
				log.Printf("Failed to unmount %s: %v: %s", mp, err, strings.TrimSpace(string(output)))
			} else {
				log.Printf("Unmounted %s", mp)
			}
		}
	}
}

// findMountPointsForCleanup parses /proc/mounts and returns mountpoints that correspond
func findMountPointsForCleanup(downloadType string) []string {
	file, err := os.Open("/proc/mounts")
	if err != nil {
		log.Printf("Unable to open /proc/mounts: %v", err)
		return nil
	}
	defer file.Close()

	var mountPoints []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		// Fast path: skip lines that do not contain the downloadType at all
		if !strings.Contains(line, downloadType) {
			continue
		}
		// /proc/mounts format: src dst fstype options dump fsck
		// Fields are space-separated; spaces in paths are escaped as \040
		parts := strings.Fields(line)
		if len(parts) < 4 {
			continue
		}
		dst := unescapeMountField(parts[1])
		mountPoints = append(mountPoints, dst)
	}
	if err := scanner.Err(); err != nil {
		log.Printf("Error reading /proc/mounts: %v", err)
	}
	return mountPoints
}

func unescapeMountField(s string) string {
	// Handle common escapes used in /proc/mounts
	s = strings.ReplaceAll(s, "\\040", " ")
	s = strings.ReplaceAll(s, "\\011", "\t")
	s = strings.ReplaceAll(s, "\\012", "\n")
	s = strings.ReplaceAll(s, "\\134", "\\")
	return s
}

// Block until barrier has been met
func barrier(osmoChan chan string, startExecChan chan bool,
	barrierName string, logQueue *common.CircularBuffer) {

	osmoChan <- "Waiting for group ready ..."
	barrierMutex.Lock()
	barrierReq = messages.CreateBarrier(barrierName, -1)
	barrierMutex.Unlock()

	ticker := time.NewTicker(BARRIER_TICKER_DURATION)
	defer ticker.Stop()

	threadsafeEnqueue(logQueue, barrierReq)
	for {
		select {
		case <-startExecChan:
			osmoChan <- "Group ready"
			return
		case <-ticker.C:
			barrierMutex.Lock()
			localBarrierReq := barrierReq
			barrierMutex.Unlock()
			if localBarrierReq != "" {
				threadsafeEnqueue(logQueue, localBarrierReq)
				log.Println("Resent barrier request")
			}
		}
	}
}

func sendCtrlFailed(unixConn net.Conn, failed *bool) {
	if *failed {
		ctrlFailed, err := json.Marshal(messages.CtrlFailedRequest())
		if err != nil {
			osmo_errors.SetExitCode(osmo_errors.UNIX_MESSAGE_FAILED_CODE)
			panic(fmt.Sprintf("Failed to marshal request: %v\n", err))
		}

		if _, err := unixConn.Write(ctrlFailed); err != nil {
			osmo_errors.SetExitCode(osmo_errors.UNIX_MESSAGE_FAILED_CODE)
			panic(fmt.Sprintf("Failed to send request: %v\n", err))
		}
	}
}

func init() {
	data.CpuCount = os.Getenv("CPU_COUNT")
	// In case variable is not set
	if data.CpuCount == "" {
		data.CpuCount = "1"
	}
}

func main() {
	cmdArgs := args.CtrlParse()
	logQueue := common.NewCircularBuffer(cmdArgs.LogsBufferSize)
	restartChan := make(chan bool)
	osmoChan := make(chan string)
	downloadChan := make(chan string)
	uploadChan := make(chan string)
	startExecChan := make(chan bool)
	metricChan := make(chan metrics.Metric)
	logsFinished := false
	stopPutLogs := make(chan bool)
	stopSendLogs := make(chan bool)
	data.DataTimeout = cmdArgs.DataTimeout
	failedCtrl := true
	data.WebsocketConnection = data.WebsocketConnectionInfo{
		IsBroken: false, DisconnectStartTime: time.Now(), Timeout: cmdArgs.Timeout}
	logsPeriodMs := cmdArgs.LogsPeriod
	barrierReq = ""

	// Oldest possible time to trigger a fetch for refresh token
	tokenExpiration = time.Date(1, 1, 1, 0, 0, 0, 0, time.UTC)

	// Save the exit code to the termination file in case of panic
	defer osmo_errors.SaveExitCode()

	if err := os.RemoveAll(cmdArgs.SocketPath); err != nil {
		osmo_errors.SetExitCode(osmo_errors.UNIX_MESSAGE_FAILED_CODE)
		panic(err)
	}

	listener, err := net.Listen("unix", cmdArgs.SocketPath)
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.UNIX_MESSAGE_FAILED_CODE)
		panic(fmt.Sprintf("listen error: %s", err))
	}
	defer listener.Close()

	{
		if err := os.Chmod(cmdArgs.SocketPath, 0777); err != nil {
			osmo_errors.SetExitCode(osmo_errors.MISC_FAILED_CODE)
			panic(err)
		}
	}

	// Set Timeout for Accepting
	unixListener := listener.(*net.UnixListener)
	unixListener.SetDeadline(time.Now().Add(cmdArgs.UnixTimeout))

	unixConn, err := listener.Accept()
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.UNIX_MESSAGE_FAILED_CODE)
		panic(fmt.Sprintf("accept error: %s", err))
	}
	defer unixConn.Close()
	defer sendCtrlFailed(unixConn, &failedCtrl)

	log.Printf("Client connected [%s]", unixConn.RemoteAddr().Network())

	// Start a websocket connection to Workflow Service
	connWorkflowService(cmdArgs.WorkflowServiceUrl.String(), cmdArgs)
	defer webConn.Close() // Conn should stay alive until the process exits

	waitGoRoutines.Add(2)
	go putLogs(cmdArgs.LogSource, osmoChan, downloadChan,
		uploadChan, stopPutLogs, metricChan, logQueue)

	go pingPang(cmdArgs.Timeout, cmdArgs.WorkflowServiceUrl.String(), osmoChan, startExecChan,
		restartChan, metricChan, unixConn, &logsFinished, cmdArgs, listener, logQueue)

	go sendLogs(cmdArgs.LogSource, logQueue, logsPeriodMs, stopSendLogs)

	defer cleanupMounts(cmdArgs.DownloadType)
	sigintCatch := make(chan os.Signal, 1)
	signal.Notify(sigintCatch, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigintCatch
		cleanupMounts(cmdArgs.DownloadType)
		os.Exit(1)
	}()

	// Validate data auth access before starting downloads/uploads
	if err := data.ValidateInputsOutputsAccess(
		cmdArgs.Inputs,
		cmdArgs.Outputs,
		cmdArgs.UserConfig,
		osmoChan,
	); err != nil {
		osmo_errors.SetExitCode(osmo_errors.DATA_UNAUTHORIZED_CODE)
		stopPutLogs <- true
		stopSendLogs <- true
		waitGoRoutines.Wait()
		panic(fmt.Sprintf("Data unauthorized: %v", err))
	}

	// Send files to be downloaded
	inputStartTime := time.Now().Format("2006-01-02 15:04:05.000")
	downloadInputs(unixConn, cmdArgs.Inputs, cmdArgs.InputPath,
		cmdArgs.DownloadType, downloadChan, metricChan, cmdArgs.RetryId, cmdArgs.GroupName,
		cmdArgs.LogSource, cmdArgs.UserConfig, cmdArgs.ServiceConfig, cmdArgs.ConfigLoc,
		cmdArgs.CacheSize)
	inputEndTime := time.Now().Format("2006-01-02 15:04:05.000")
	downloadTimes := metrics.GroupMetrics{
		RetryId:    cmdArgs.RetryId,
		StartTime:  inputStartTime,
		EndTime:    inputEndTime,
		MetricType: "input_download",
	}
	metricChan <- downloadTimes

	// Synchronize tasks if in a group
	if cmdArgs.Barrier != "" {
		barrier(osmoChan, startExecChan, cmdArgs.Barrier, logQueue)
	}

	err = json.NewEncoder(unixConn).Encode(messages.ExecStartRequest(cmdArgs.OutputPath))
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.UNIX_MESSAGE_FAILED_CODE)
		panic(fmt.Sprintf("Failed to send request: %v\n", err))
	}

	// Exec has begun so failure no longer needs to be sent
	failedCtrl = false

	// Get Message that Exec has finished
	log.Println("Exec start")
	decoder := json.NewDecoder(unixConn)
execLogs:
	for {
		// Decode the response
		var response messages.Request
		if err := decoder.Decode(&response); err != nil {
			osmoChan <- fmt.Sprintf("Failed to parse response: %v\n", err)
			break execLogs
		}

		switch response.Type {
		case messages.ExecFailed:
			threadsafeEnqueue(logQueue,
				messages.CreateLog(cmdArgs.LogSource, response.MessageErr, messages.StdErr))
			break execLogs
		case messages.ExecFinished:
			break execLogs
		case messages.UserRsyncStatus:
			rsyncStatus.SetRunning(response.RsyncRunning)
		case messages.UserStopFinished:
			restartChan <- true
		case messages.MessageOut:
			threadsafeEnqueue(logQueue,
				messages.CreateLog(cmdArgs.LogSource, response.MessageOut, messages.StdOut))
		case messages.MessageErr:
			threadsafeEnqueue(logQueue,
				messages.CreateLog(cmdArgs.LogSource, response.MessageErr, messages.StdErr))
		case messages.MessageOps:
			threadsafeEnqueue(logQueue,
				messages.CreateLog(cmdArgs.LogSource, response.MessageOps, messages.OSMOCtrl))
		}
	}
	log.Println("Exec finished")

	// Send files to be uploaded
	outputStartTime := time.Now().Format("2006-01-02 15:04:05.000")
	uploadOutputs(unixConn, cmdArgs.Outputs, cmdArgs.OutputPath, cmdArgs.MetadataFile,
		uploadChan, metricChan, cmdArgs.RetryId, cmdArgs.GroupName, cmdArgs.LogSource,
		cmdArgs.UserConfig, cmdArgs.ServiceConfig, cmdArgs.ConfigLoc)
	outputEndTime := time.Now().Format("2006-01-02 15:04:05.000")
	uploadTimes := metrics.GroupMetrics{
		RetryId:    cmdArgs.RetryId,
		StartTime:  outputStartTime,
		EndTime:    outputEndTime,
		MetricType: "output_upload"}
	metricChan <- uploadTimes

	logMsg := messages.CreateLog(cmdArgs.LogSource, "", messages.LogDone)
	for !logsFinished {
		threadsafeEnqueue(logQueue, logMsg)
		time.Sleep(5 * time.Second)
	}

	log.Println("Stopping logs")
	stopPutLogs <- true
	stopSendLogs <- true
	waitGoRoutines.Wait() // Wait until all logs are put before exit

	log.Printf("OSMO ctrl is done")
}
