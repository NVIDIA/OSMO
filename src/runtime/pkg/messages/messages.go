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

package messages

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"time"

	"github.com/gorilla/websocket"
	"go.corp.nvidia.com/osmo/runtime/pkg/osmo_errors"
)

type RequestType string
type IOType string

const (
	ExecStart        RequestType = "ExecStart"
	ExecFinished     RequestType = "ExecFinished"
	ExecFailed       RequestType = "ExecFailed"
	MessageOut       RequestType = "MessageOut"
	MessageErr       RequestType = "MessageErr"
	MessageOps       RequestType = "MessageOps"
	CtrlFailed       RequestType = "CtrlFailed"
	UserExecStart    RequestType = "UserExecStart"
	UserStop         RequestType = "UserStop"         // Ctrl requests User to stop its process
	UserStopFinished RequestType = "UserStopFinished" // User confirms to Ctrl its process is killed
	UserStart        RequestType = "UserStart"
	UserRsyncStatus  RequestType = "UserRsyncStatus"
)

const (
	StdOut   IOType = "STDOUT"
	StdErr   IOType = "STDERR"
	OSMOCtrl IOType = "OSMO_CTRL"
	Download IOType = "DOWNLOAD"
	Upload   IOType = "UPLOAD"
	LogDone  IOType = "LOG_DONE"
	Barrier  IOType = "BARRIER"
)

/////////////////////////////////////////////////////
// Messages used between containers
/////////////////////////////////////////////////////

type Request struct {
	Type          RequestType
	MessageOut    string
	MessageErr    string
	MessageOps    string
	OutputFolder  string
	RouterAddress string
	Command       string
	TaskPort      int
	RsyncRunning  bool
}

func ExecStartRequest(outputFolder string) Request {
	return Request{
		Type:         ExecStart,
		OutputFolder: outputFolder,
	}
}

func ExecFinishedRequest() Request {
	return Request{
		Type: ExecFinished,
	}
}

func ExecFailedRequest(messageErr string) Request {
	return Request{
		Type:       ExecFailed,
		MessageErr: messageErr,
	}
}

func MessageOutRequest(messageOut string) Request {
	return Request{
		Type:       MessageOut,
		MessageOut: messageOut,
	}
}

func MessageErrRequest(messageErr string) Request {
	return Request{
		Type:       MessageErr,
		MessageErr: messageErr,
	}
}

func MessageOpsRequest(messageOps string) Request {
	return Request{
		Type:       MessageOps,
		MessageOps: messageOps,
	}
}

func CtrlFailedRequest() Request {
	return Request{
		Type: CtrlFailed,
	}
}

func UserExecStartRequest(entryCommand string) Request {
	return Request{
		Type:    UserExecStart,
		Command: entryCommand,
	}
}

func UserRsyncStatusRequest(rsyncRunning bool) Request {
	return Request{
		Type:         UserRsyncStatus,
		RsyncRunning: rsyncRunning,
	}
}

func EncodeMessage(unixConn net.Conn, message string, requestMessage Request) {
	log.Println(message)
	err := json.NewEncoder(unixConn).Encode(requestMessage)
	if err != nil {
		panic(fmt.Sprintf("Failed to send request: %v", err))
	}
}

/////////////////////////////////////////////////////
// Messages used from ctrl to service
/////////////////////////////////////////////////////

type LogRequest struct {
	Source string
	Time   time.Time
	Text   string
	IOType IOType
}

type LogDoneRequest struct {
	IOType IOType
}

type BarrierRequest struct {
	Name   string
	Count  int
	IOType IOType
}

func CreateLog(source string, text string, ioType IOType) string {
	currTime := time.Now().UTC()
	logRequest := LogRequest{source, currTime, text, ioType}
	logJson, err := json.Marshal(logRequest)
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.WEBSOCKET_MESSAGE_FAILED_CODE)
		panic(err)
	}
	return string(logJson)
}

func CreateLogDone() string {
	logRequest := LogDoneRequest{LogDone}
	logJson, err := json.Marshal(logRequest)
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.WEBSOCKET_MESSAGE_FAILED_CODE)
		panic(err)
	}
	return string(logJson)
}

func CreateBarrier(name string, count int) string {
	barrierRequest := BarrierRequest{name, count, Barrier}
	requestJson, err := json.Marshal(barrierRequest)
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.BARRIER_FAILED_CODE)
		panic(err)
	}
	return string(requestJson)
}

func Put(conn *websocket.Conn, message string) error {
	err := conn.WriteJSON(message)
	if err != nil {
		return err
	}
	return nil
}

func UserStopRequest() Request {
	return Request{
		Type: UserStop,
	}
}

func UserStopFinishedRequest() Request {
	return Request{
		Type: UserStopFinished,
	}
}

func UserStartRequest() Request {
	return Request{
		Type: UserStart,
	}
}
