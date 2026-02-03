/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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

package utils

import (
	"log"
	"net/url"
	"strings"
	"time"

	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// ParseServiceURL extracts host:port from a URL string (supports both "host:port" and "scheme://host:port")
func ParseServiceURL(serviceURL string) (string, error) {
	// Try parsing as URL first
	parsedURL, err := url.Parse(serviceURL)
	if err == nil && parsedURL.Host != "" {
		// URL was successfully parsed with scheme (e.g., "http://localhost:8000")
		return parsedURL.Host, nil
	}

	// If no scheme or parsing failed, assume it's already in "host:port" format
	return serviceURL, nil
}

// GetTransportCredentials returns appropriate gRPC transport credentials based on service URL
// Uses TLS for https:// URLs, insecure for http:// or plain host:port
func GetTransportCredentials(serviceURL string) credentials.TransportCredentials {
	// Try parsing as URL to check for https scheme
	parsedURL, err := url.Parse(serviceURL)
	if err == nil && strings.ToLower(parsedURL.Scheme) == "https" {
		// Use system TLS certificates for HTTPS with server name from URL
		log.Printf("Using TLS credentials for HTTPS connection (server name: %s)", parsedURL.Host)
		return credentials.NewClientTLSFromCert(nil, parsedURL.Host)
	}
	// Use insecure credentials for http or plain host:port
	log.Printf("Using insecure credentials for connection")
	return insecure.NewCredentials()
}

// CalculateBackoff calculates exponential backoff duration with a maximum cap
// Backoff sequence: 1s, 2s, 4s, 8s, 16s, max 30s
func CalculateBackoff(retryCount int, maxBackoff time.Duration) time.Duration {
	if retryCount <= 0 {
		return 0
	}
	backoff := time.Duration(1<<uint(retryCount-1)) * time.Second
	if backoff > maxBackoff {
		backoff = maxBackoff
	}
	return backoff
}
