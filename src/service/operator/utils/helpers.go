/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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
	"context"
	"errors"
	"io"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// ExtractBackendName extracts and validates the backend-name from gRPC metadata.
// Returns an error if the metadata is missing or empty.
func ExtractBackendName(ctx context.Context) (string, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", errors.New("missing gRPC metadata")
	}

	names := md.Get("backend-name")
	if len(names) == 0 {
		return "", errors.New("backend-name metadata is required but not provided")
	}

	backendName := names[0]
	if backendName == "" {
		return "", errors.New("backend-name metadata cannot be empty")
	}

	return backendName, nil
}

// IsExpectedClose checks if an error is an expected stream closure.
func IsExpectedClose(err error) bool {
	if err == nil {
		return false
	}
	if err == io.EOF || err == context.Canceled {
		return true
	}
	return status.Code(err) == codes.Canceled
}

