/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

package logging

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestParseLevel(t *testing.T) {
	tests := []struct {
		input    string
		expected slog.Level
	}{
		{"debug", slog.LevelDebug},
		{"DEBUG", slog.LevelDebug},
		{"info", slog.LevelInfo},
		{"INFO", slog.LevelInfo},
		{"warn", slog.LevelWarn},
		{"warning", slog.LevelWarn},
		{"WARN", slog.LevelWarn},
		{"error", slog.LevelError},
		{"ERROR", slog.LevelError},
		{"critical", slog.LevelError},
		{"fatal", slog.LevelError},
		{"  info  ", slog.LevelInfo},
		{"unknown", slog.LevelInfo},
		{"", slog.LevelInfo},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := ParseLevel(tt.input)
			if result != tt.expected {
				t.Errorf("ParseLevel(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestServiceHandlerFormat(t *testing.T) {
	var buf bytes.Buffer
	handler := NewServiceHandler("test-service", slog.LevelDebug, &buf)
	logger := slog.New(handler)

	logger.Info("hello world")

	line := buf.String()

	// The osmo-log parser regex
	osmoLogRegex := regexp.MustCompile(
		`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} test-service \[INFO\] [^ ]*: hello world\n$`,
	)
	if !osmoLogRegex.MatchString(line) {
		t.Errorf("log line does not match osmo-log format:\n  got:  %q", line)
	}
}

func TestServiceHandlerLevelFiltering(t *testing.T) {
	var buf bytes.Buffer
	handler := NewServiceHandler("svc", slog.LevelWarn, &buf)
	logger := slog.New(handler)

	logger.Debug("should not appear")
	logger.Info("should not appear")
	logger.Warn("should appear")

	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d: %v", len(lines), lines)
	}
	if !strings.Contains(lines[0], "[WARN]") {
		t.Errorf("expected WARN level, got: %s", lines[0])
	}
}

func TestServiceHandlerWithUser(t *testing.T) {
	var buf bytes.Buffer
	handler := NewServiceHandler("svc", slog.LevelDebug, &buf)
	logger := slog.New(handler)

	logger.Info("access denied",
		slog.String("user", "alice@example.com"),
		slog.String("path", "/api/workflow"),
		slog.String("method", "GET"),
	)

	line := buf.String()
	if !strings.Contains(line, "user=alice@example.com") {
		t.Errorf("expected user= in output, got: %s", line)
	}

	authzRegex := regexp.MustCompile(
		`\[INFO\] [^ ]*: user=alice@example\.com access denied`,
	)
	if !authzRegex.MatchString(line) {
		t.Errorf("user field should appear before the message, got: %s", line)
	}
}

func TestServiceHandlerUserViaWithAttrs(t *testing.T) {
	var buf bytes.Buffer
	handler := NewServiceHandler("svc", slog.LevelDebug, &buf)
	logger := slog.New(handler).With(slog.String("user", "bob"))

	logger.Info("checking access")

	line := buf.String()
	if !strings.Contains(line, "user=bob") {
		t.Errorf("expected user=bob from WithAttrs, got: %s", line)
	}

	authzRegex := regexp.MustCompile(
		`\[INFO\] [^ ]*: user=bob checking access`,
	)
	if !authzRegex.MatchString(line) {
		t.Errorf("user field should appear before the message, got: %s", line)
	}
}

func TestServiceHandlerStructuredAttrs(t *testing.T) {
	var buf bytes.Buffer
	handler := NewServiceHandler("svc", slog.LevelDebug, &buf)
	logger := slog.New(handler)

	logger.Info("configured",
		slog.Int("port", 8080),
		slog.String("host", "localhost"),
	)

	line := buf.String()
	if !strings.Contains(line, "port=8080") {
		t.Errorf("expected port=8080, got: %s", line)
	}
	if !strings.Contains(line, "host=localhost") {
		t.Errorf("expected host=localhost, got: %s", line)
	}
}

func TestServiceHandlerWithGroup(t *testing.T) {
	var buf bytes.Buffer
	handler := NewServiceHandler("svc", slog.LevelDebug, &buf)
	logger := slog.New(handler).WithGroup("db").With(slog.String("host", "pg"))

	logger.Info("connected")

	line := buf.String()
	if !strings.Contains(line, "db.host=pg") {
		t.Errorf("expected db.host=pg, got: %s", line)
	}
}

func TestServiceHandlerEnabled(t *testing.T) {
	handler := NewServiceHandler("svc", slog.LevelWarn, nil)
	ctx := context.Background()

	if handler.Enabled(ctx, slog.LevelDebug) {
		t.Error("DEBUG should be disabled when level is WARN")
	}
	if handler.Enabled(ctx, slog.LevelInfo) {
		t.Error("INFO should be disabled when level is WARN")
	}
	if !handler.Enabled(ctx, slog.LevelWarn) {
		t.Error("WARN should be enabled when level is WARN")
	}
	if !handler.Enabled(ctx, slog.LevelError) {
		t.Error("ERROR should be enabled when level is WARN")
	}
}

func TestInitLoggerCreatesFile(t *testing.T) {
	tmpDir := t.TempDir()

	config := Config{
		Level:   slog.LevelInfo,
		LogDir:  tmpDir,
		LogName: "test_service",
	}

	logger := InitLogger("test-service", config)
	logger.Info("file logging works")

	// Allow a brief moment for file write
	time.Sleep(10 * time.Millisecond)

	matches, err := filepath.Glob(filepath.Join(tmpDir, "*test_service.txt"))
	if err != nil {
		t.Fatalf("glob error: %v", err)
	}
	if len(matches) == 0 {
		t.Fatal("expected log file to be created in tmpDir")
	}

	content, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("failed to read log file: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(content)), "\n")
	if len(lines) < 1 {
		t.Fatal("expected at least one line in log file")
	}
	if !strings.Contains(lines[0], "Starting service") {
		t.Errorf("expected 'Starting service' in first line, got: %s", lines[0])
	}
}

func TestCallerSource(t *testing.T) {
	// callerSource with zero PC returns "unknown"
	if src := callerSource(0); src != "unknown" {
		t.Errorf("expected 'unknown' for zero PC, got: %s", src)
	}
}
