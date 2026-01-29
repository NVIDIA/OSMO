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

package utils_test

import (
	"context"
	"errors"
	"io"
	"testing"

	"go.corp.nvidia.com/osmo/service/compute/utils"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestExtractBackendName(t *testing.T) {
	tests := []struct {
		name        string
		ctx         context.Context
		expected    string
		shouldError bool
	}{
		{
			name:        "valid backend name",
			ctx:         metadata.NewIncomingContext(context.Background(), metadata.Pairs("backend-name", "my-backend")),
			expected:    "my-backend",
			shouldError: false,
		},
		{
			name:        "missing metadata",
			ctx:         context.Background(),
			expected:    "",
			shouldError: true,
		},
		{
			name:        "empty backend name",
			ctx:         metadata.NewIncomingContext(context.Background(), metadata.Pairs("backend-name", "")),
			expected:    "",
			shouldError: true,
		},
		{
			name:        "backend-name not in metadata",
			ctx:         metadata.NewIncomingContext(context.Background(), metadata.Pairs("other-key", "value")),
			expected:    "",
			shouldError: true,
		},
		{
			name:        "multiple backend names (first is used)",
			ctx:         metadata.NewIncomingContext(context.Background(), metadata.Pairs("backend-name", "first", "backend-name", "second")),
			expected:    "first",
			shouldError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := utils.ExtractBackendName(tt.ctx)

			if tt.shouldError {
				if err == nil {
					t.Errorf("expected error but got nil")
				}
			} else {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
				if result != tt.expected {
					t.Errorf("expected %q, got %q", tt.expected, result)
				}
			}
		})
	}
}

func TestIsExpectedClose(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "nil error",
			err:      nil,
			expected: false,
		},
		{
			name:     "io.EOF",
			err:      io.EOF,
			expected: true,
		},
		{
			name:     "context.Canceled",
			err:      context.Canceled,
			expected: true,
		},
		{
			name:     "status codes.Canceled",
			err:      status.Error(codes.Canceled, "canceled"),
			expected: true,
		},
		{
			name:     "other error",
			err:      errors.New("some error"),
			expected: false,
		},
		{
			name:     "status codes.Internal",
			err:      status.Error(codes.Internal, "internal error"),
			expected: false,
		},
		{
			name:     "status codes.Unknown",
			err:      status.Error(codes.Unknown, "unknown error"),
			expected: false,
		},
		{
			name:     "status codes.InvalidArgument",
			err:      status.Error(codes.InvalidArgument, "invalid argument"),
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := utils.IsExpectedClose(tt.err)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}
