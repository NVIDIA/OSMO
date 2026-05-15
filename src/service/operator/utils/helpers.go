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

import (
	"fmt"
	"log/slog"
	"net/url"
)

func ParseHost(hostString string) (string, int, error) {
	parsedURL, err := url.Parse(hostString)
	if err == nil && parsedURL.Scheme != "" {
		host := parsedURL.Hostname()
		if host == "" {
			host = "0.0.0.0"
		}
		if parsedURL.Port() == "" {
			return "", 0, fmt.Errorf("port is required in URL: %s", hostString)
		}
		var port int
		if _, err := fmt.Sscanf(parsedURL.Port(), "%d", &port); err != nil {
			return "", 0, fmt.Errorf("invalid port in URL: %s", parsedURL.Port())
		}
		return host, port, nil
	}
	return "", 0, fmt.Errorf(
		"invalid host format, expected URL format (for example http://0.0.0.0:8001): %s",
		hostString)
}

func ParseLogLevel(levelString string) slog.Level {
	var level slog.Level
	if err := level.UnmarshalText([]byte(levelString)); err != nil {
		return slog.LevelInfo
	}
	return level
}
