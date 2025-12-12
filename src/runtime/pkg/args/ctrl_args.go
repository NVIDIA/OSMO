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

package args

import (
	"flag"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"go.corp.nvidia.com/osmo/runtime/pkg/common"
)

// Parse and process command line arguments
func CtrlParse() CtrlArgs {
	var inputs, outputs common.ArrayFlags
	flag.Var(&inputs, "inputs", "Pod inputs.")
	flag.Var(&outputs, "outputs", "Pod outputs.")
	workflow := flag.String("workflow", "", "Workflow id.")
	barrier := flag.String("barrier", "", "Barrier name for synchronization. Default to no synchronization.")
	logSource := flag.String("logSource", "", "Source of the messages.")
	socketPath := flag.String("socketPath", "", "Socket location.")
	scheme := flag.String("scheme", "ws", "Scheme to connect to the Workflow service.")
	host := flag.String("host", "localhost", "Workflow service host.")
	port := flag.String("port", "8000", "Workflow service port.")
	refreshToken := flag.String("refreshToken", "/osmo/.refresh_token", "Location of the refresh token file for authentication.")
	refreshScheme := flag.String("refreshScheme", "http", "Scheme to request for new access token.")
	tokenHeader := flag.String("tokenHeader", "x-osmo-auth", "HTTP header to pass the token in.")
	userConfig := flag.String("userConfig", "/osmo/user_config.yaml", "User Config File.")
	serviceConfig := flag.String("serviceConfig", "/osmo/service_config.yaml",
		"Service Config File.")
	inputPath := flag.String("inputPath", "", "Input Folder.")
	outputPath := flag.String("outputPath", "", "Output Folder.")
	metadataFile := flag.String("metadataFile", "", "Default Metadata to apply to Ctrlset.")
	downloadType := flag.String("downloadType", "download",
		"Whether input does mounting or downloaing and what type of mounting if mounting.")
	timeout := flag.Int("timeout", 60, "Wait time (m) to connect to the OSMO service.")
	unixTimeout := flag.Int("unixTimeout", 120, "osmo_exec wait time (m) for the unix connection.")
	execTimeout := flag.Int("execTimeout", 5, "osmo_exec wait time (m) for the exec connection.")
	dataTimeout := flag.Int("dataTimeout", 10,
		"osmo_exec wait time (m) between data upload/download messages.")
	groupName := flag.String("groupName", "", "Group name for workflow")
	retryId := flag.String("retryId", "0", "Retry ID of the task. Default to 0.")
	logsPeriod := flag.Int("logsPeriod", 100, "How often OSMO control should push logs to the "+
		"service (in milliseconds)")
	logsBufferSize := flag.Int("logsBufferSize", 10000, "The capacity of circular buffer for "+
		"storing messages.")
	cacheSize := flag.Int("cacheSize", 0, "The maximum mount cache size (in MiB) "+
		"split across inputs.")
	flag.Parse()

	// logSource is also the name of the task in the workflow
	path := fmt.Sprintf("/api/logger/workflow/%s/osmo_ctrl/%s/retry_id/%s",
		*workflow, *logSource, *retryId)
	workflowServiceUrl := url.URL{Scheme: *scheme, Host: *host + ":" + *port, Path: path}

	refreshTokenPath := "/api/auth/jwt/refresh_token"
	refreshTokenUrl := url.URL{Scheme: *refreshScheme, Host: *host + ":" + *port, Path: refreshTokenPath}
	input := *inputPath
	if !strings.HasSuffix(input, "/") {
		input += "/"
	}

	output := *outputPath
	if !strings.HasSuffix(output, "/") {
		output += "/"
	}

	duration := time.Duration(*timeout) * time.Minute
	unixDuration := time.Duration(*unixTimeout) * time.Minute
	execDuration := time.Duration(*execTimeout) * time.Minute
	dataDuration := time.Duration(*dataTimeout) * time.Minute

	finalLogsPeriod := *logsPeriod
	if finalLogsPeriod <= 0 {
		finalLogsPeriod = 1
	}

	finalLogsBufferSize := *logsBufferSize
	if finalLogsBufferSize <= 0 {
		finalLogsBufferSize = 1
	}

	parsedArgs := CtrlArgs{
		Inputs:             inputs,
		Outputs:            outputs,
		InputPath:          input,
		OutputPath:         output,
		SocketPath:         *socketPath,
		LogSource:          *logSource,
		WorkflowServiceUrl: workflowServiceUrl,
		RefreshTokenUrl:    refreshTokenUrl,
		Workflow:           *workflow,
		Barrier:            *barrier,
		GroupName:          *groupName,
		RetryId:            *retryId,
		RefreshToken:       *refreshToken,
		TokenHeader:        *tokenHeader,
		ConfigLoc:          os.Getenv("OSMO_CONFIG_FILE_DIR") + "/config.yaml",
		UserConfig:         *userConfig,
		ServiceConfig:      *serviceConfig,
		MetadataFile:       *metadataFile,
		DownloadType:       *downloadType,
		Timeout:            duration,
		UnixTimeout:        unixDuration,
		ExecTimeout:        execDuration,
		DataTimeout:        dataDuration,
		LogsPeriod:         finalLogsPeriod,
		LogsBufferSize:     finalLogsBufferSize,
		CacheSize:          *cacheSize,
	}
	return parsedArgs
}
