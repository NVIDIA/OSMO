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

package osmo_errors

import (
	"encoding/json"
	"log"
	"os"
)

type ExitCode int

// Exit code for type of ctrl failure
var exitCode ExitCode

const (
	// Data Failures
	DOWNLOAD_FAILED_CODE        ExitCode = 10 // Failures regarding download calls
	MOUNT_FAILED_CODE           ExitCode = 11 // Failures regarding mount calls
	UPLOAD_FAILED_CODE          ExitCode = 12 // Failures regarding upload calls
	DATA_AUTH_CHECK_FAILED_CODE ExitCode = 13 // Failures regarding data auth
	DATA_UNAUTHORIZED_CODE      ExitCode = 14 // Failures regarding data unauthorized

	// Connection Failures
	TOKEN_INVALID_CODE            ExitCode = 20 // Failures regarding token
	WEBSOCKET_TIMEOUT_CODE        ExitCode = 21 // Failures regarding websocket timeout
	WEBSOCKET_MESSAGE_FAILED_CODE ExitCode = 22 // Failures regarding websocket messages
	UNIX_MESSAGE_FAILED_CODE      ExitCode = 23 // Failures regarding unix socket messages
	BARRIER_FAILED_CODE           ExitCode = 24 // Failures regarding barrier
	METRICS_FAILED_CODE           ExitCode = 25 // Failures regarding metrics creation

	// Obtuse Failures
	INVALID_INPUT_CODE ExitCode = 30 // Failures regarding invalid function inputs
	CMD_FAILED_CODE    ExitCode = 31 // Failures regarding cmd execution
	FILE_FAILED_CODE   ExitCode = 32 // Failures regarding file operations

	// Miscellaneous Catch All for Rest
	MISC_FAILED_CODE ExitCode = 40 // Failures in general
)

type TimeoutError struct {
	S string
}

func (e *TimeoutError) Error() string {
	return e.S
}

func LogError(stdout string, stderr string, osmoChan chan string, err error, code ExitCode) {
	if err != nil {
		log.Println("out:", stdout)
		log.Println("err:", stderr)
		osmoChan <- stdout
		osmoChan <- stderr
		SetExitCode(code)
		panic(err)
	}
}

func SetExitCode(code ExitCode) {
	exitCode = code
}

func SaveExitCode() {
	// TODO: This file applies to kubernetes. Won't work with slurm
	file, err := os.Create("/dev/termination-log")
	if err != nil {
		panic(err)
	}
	defer file.Close()

	log.Printf("Writing failure code %d to termination log", exitCode)
	exitCodeJson, err := json.Marshal(map[string]int{"code": int(exitCode)})
	if err != nil {
		panic(err)
	}
	_, err = file.Write(exitCodeJson)
	if err != nil {
		panic(err)
	}
}
