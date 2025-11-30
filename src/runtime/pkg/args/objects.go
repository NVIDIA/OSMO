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
	"net/url"
	"time"

	"go.corp.nvidia.com/osmo/runtime/pkg/common"
)

type ExecArgs struct {
	Command         string
	Args            common.ArrayFlags
	Checkpoint      common.ArrayFlags
	SocketPath      string
	UnixTimeout     time.Duration
	UserBinPath     string
	HistoryFilePath string
	RunLocation     string

	// Rsync flags
	EnableRsync        bool
	RsyncReadLimit     int
	RsyncWriteLimit    int
	RsyncPathAllowList string

	CliAutoCompleteScriptPath string
}

type CtrlArgs struct {
	Inputs             common.ArrayFlags
	Outputs            common.ArrayFlags
	InputPath          string
	OutputPath         string
	SocketPath         string
	LogSource          string
	WorkflowServiceUrl url.URL
	RefreshTokenUrl    url.URL
	Workflow           string
	Barrier            string
	GroupName          string
	RetryId            string
	RefreshToken       string
	RefreshScheme      string
	TokenHeader        string
	ConfigLoc          string
	UserConfig         string
	ServiceConfig      string
	MetadataFile       string
	DownloadType       string
	Timeout            time.Duration
	UnixTimeout        time.Duration
	ExecTimeout        time.Duration
	DataTimeout        time.Duration
	LogsPeriod         int
	LogsBufferSize     int
	CacheSize          int

	// gRPC Router configuration
	UseGrpcRouter     bool   // Feature flag to enable gRPC router
	GrpcRouterAddress string // Address of the gRPC router (e.g., "router-grpc:50051")
}
