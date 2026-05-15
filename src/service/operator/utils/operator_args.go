// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package utils

import "flag"

type OperatorArgs struct {
	Host             string
	HTTPHost         string
	Kubeconfig       string
	LogLevel         string
	EnableReflection bool
}

func OperatorParse() OperatorArgs {
	host := flag.String("host", "http://0.0.0.0:8001", "Host for the operator service")
	httpHost := flag.String("http-host", "http://0.0.0.0:8002",
		"HTTP host for the operator service's Python-compatible OTG endpoints")
	kubeconfig := flag.String("kubeconfig", "",
		"kubeconfig path; empty uses in-cluster config")
	logLevel := flag.String("log-level", "INFO", "Logging level (DEBUG, INFO, WARN, ERROR)")
	enableReflection := flag.Bool("enable-reflection", false, "enable gRPC reflection")
	flag.Parse()
	return OperatorArgs{
		Host:             *host,
		HTTPHost:         *httpHost,
		Kubeconfig:       *kubeconfig,
		LogLevel:         *logLevel,
		EnableReflection: *enableReflection,
	}
}
