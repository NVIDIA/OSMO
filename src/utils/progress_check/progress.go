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

package progress_check

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ProgressWriter reports progress by writing the current timestamp to a file.
// It is safe for concurrent use from multiple goroutines.
type ProgressWriter struct {
	filename string
	dir      string
	mu       sync.Mutex // Protects concurrent writes
}

// NewProgressWriter creates a new ProgressWriter that writes to the specified file.
// The directory will be created if it doesn't exist.
func NewProgressWriter(filename string) (*ProgressWriter, error) {
	dir := filepath.Dir(filename)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create progress directory %s: %w", dir, err)
	}

	return &ProgressWriter{
		filename: filename,
		dir:      dir,
	}, nil
}

// ReportProgress writes the current Unix timestamp to the progress file.
// This method is safe to call from multiple goroutines concurrently.
// It uses atomic file replacement to ensure the file is never partially written.
func (pw *ProgressWriter) ReportProgress() error {
	pw.mu.Lock()
	defer pw.mu.Unlock()

	// Generate a temporary file name using UUID for uniqueness
	tempFile := fmt.Sprintf("%s-%s.tmp", pw.filename, uuid.New().String())

	// Write the current Unix timestamp (with nanosecond precision as float)
	timestamp := float64(time.Now().UnixNano()) / 1e9
	content := strconv.FormatFloat(timestamp, 'f', 6, 64)

	// Write to temporary file
	if err := os.WriteFile(tempFile, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write progress to temp file %s: %w", tempFile, err)
	}

	// Atomically replace the target file with the temp file
	if err := os.Rename(tempFile, pw.filename); err != nil {
		// Clean up temp file on error
		os.Remove(tempFile)
		return fmt.Errorf("failed to rename temp file %s to %s: %w", tempFile, pw.filename, err)
	}

	return nil
}
