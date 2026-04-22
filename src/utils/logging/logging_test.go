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
	"encoding/json"
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

// TestParseFormat verifies that ParseFormat is case- and whitespace-tolerant
// and that unknown / empty inputs fall back to FormatText so callers don't
// silently switch encoding on a typo.
func TestParseFormat(t *testing.T) {
	tests := []struct {
		input    string
		expected Format
	}{
		{"text", FormatText},
		{"TEXT", FormatText},
		{"json", FormatJSON},
		{"JSON", FormatJSON},
		{"  json  ", FormatJSON},
		{"", FormatText},
		{"yaml", FormatText}, // unknown falls back to text
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			if got := ParseFormat(tt.input); got != tt.expected {
				t.Errorf("ParseFormat(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

// parseJSONLines decodes one JSON object per non-empty line and fails the test
// if any line is not valid JSON.
func parseJSONLines(t *testing.T, data string) []map[string]any {
	t.Helper()
	var records []map[string]any
	for i, line := range strings.Split(strings.TrimSpace(data), "\n") {
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("line %d is not valid JSON: %v\n  line: %s", i+1, err, line)
		}
		records = append(records, rec)
	}
	return records
}

// jsonHandler builds the same JSON handler InitLogger would build for a
// FormatJSON config, but writes to the provided buffer for inspection.
func jsonHandler(serviceName string, level slog.Level, buf *bytes.Buffer) slog.Handler {
	return buildHandler(serviceName, Config{Level: level, Format: FormatJSON}, buf)
}

// TestJSONHandlerEmitsValidJSON checks that the JSON handler produces one
// well-formed JSON object per record with the expected fields (msg, level,
// service, structured attrs, time) and intentionally without a source block.
func TestJSONHandlerEmitsValidJSON(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(jsonHandler("authz-sidecar", slog.LevelDebug, &buf))

	logger.Info("hello world",
		slog.String("file", "/tmp/roles.yaml"),
		slog.Int("count", 7),
	)

	records := parseJSONLines(t, buf.String())
	if len(records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(records))
	}
	rec := records[0]

	if rec["msg"] != "hello world" {
		t.Errorf("msg: got %v, want %q", rec["msg"], "hello world")
	}
	if rec["level"] != "INFO" {
		t.Errorf("level: got %v, want %q", rec["level"], "INFO")
	}
	if rec["service"] != "authz-sidecar" {
		t.Errorf("service: got %v, want %q", rec["service"], "authz-sidecar")
	}
	if rec["file"] != "/tmp/roles.yaml" {
		t.Errorf("file: got %v, want %q", rec["file"], "/tmp/roles.yaml")
	}
	// JSON numbers decode to float64 in Go's encoding/json
	if got, want := rec["count"], 7.0; got != want {
		t.Errorf("count: got %v, want %v", got, want)
	}
	// We intentionally do NOT enable AddSource on the JSON handler — every log
	// line would otherwise carry a source.{file,function,line} block that we
	// don't extract in alloy and don't query on, which would just bloat each
	// record. Guard against accidentally re-enabling it.
	if _, ok := rec["source"]; ok {
		t.Errorf("source should not be present (AddSource disabled), got %v", rec["source"])
	}
	if _, ok := rec["time"]; !ok {
		t.Error("expected time field to be present")
	}
}

// TestJSONHandlerLevelFiltering verifies that records below the configured
// slog level are dropped on the JSON path, matching the behavior of the text
// handler.
func TestJSONHandlerLevelFiltering(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(jsonHandler("svc", slog.LevelWarn, &buf))

	logger.Debug("nope")
	logger.Info("nope")
	logger.Warn("yep")
	logger.Error("yep too")

	records := parseJSONLines(t, buf.String())
	if len(records) != 2 {
		t.Fatalf("expected 2 records (WARN+ERROR), got %d", len(records))
	}
	if records[0]["level"] != "WARN" || records[1]["level"] != "ERROR" {
		t.Errorf("unexpected levels: %v %v", records[0]["level"], records[1]["level"])
	}
}

// TestJSONHandlerServiceAttrAlwaysPresent guards that the top-level "service"
// attribute attached by buildHandler survives derivations via With / WithGroup
// so log backends can always filter on it.
func TestJSONHandlerServiceAttrAlwaysPresent(t *testing.T) {
	var buf bytes.Buffer
	base := slog.New(jsonHandler("authz-sidecar", slog.LevelDebug, &buf))
	derived := base.With(slog.String("user", "alice")).WithGroup("db")

	derived.Info("queried", slog.String("table", "roles"))

	records := parseJSONLines(t, buf.String())
	if len(records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(records))
	}
	if records[0]["service"] != "authz-sidecar" {
		t.Errorf("service missing after WithGroup: %v", records[0])
	}
}

// TestInitLoggerJSONFormat is the end-to-end check: InitLogger with
// FormatJSON must produce JSON records on the file sink (not just on stdout)
// and tag every record with the service name.
func TestInitLoggerJSONFormat(t *testing.T) {
	tmpDir := t.TempDir()
	config := Config{
		Level:   slog.LevelInfo,
		Format:  FormatJSON,
		LogDir:  tmpDir,
		LogName: "json_service",
	}

	logger := InitLogger("json-service", config)
	logger.Info("file logging works", slog.Int("port", 50052))

	time.Sleep(10 * time.Millisecond)

	matches, err := filepath.Glob(filepath.Join(tmpDir, "*json_service.txt"))
	if err != nil || len(matches) == 0 {
		t.Fatalf("expected log file in tmpDir, glob err=%v matches=%v", err, matches)
	}
	data, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("read log file: %v", err)
	}
	records := parseJSONLines(t, string(data))
	if len(records) < 2 {
		t.Fatalf("expected at least 2 records (Starting + file logging), got %d", len(records))
	}
	for _, rec := range records {
		if rec["service"] != "json-service" {
			t.Errorf("expected service=json-service on every record, got %v", rec["service"])
		}
	}
}
