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

// Package logging provides structured logging utilities that produce output
// compatible with the Python ServiceFormatter format used by OSMO services.
// Log lines follow the format:
//
//	<ISO8601_time> <service_name> [<LEVEL>] <source>: [user=<user> ]<message>[ key=value ...]
//
// The "user" attribute is treated as a special filter field: it is extracted
// from the slog record and placed before the message body so upstream log
// parsers can capture it as a named group.
package logging

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Format selects the on-disk/stdout encoding for log records.
type Format int

const (
	// FormatText emits the legacy ServiceFormatter text format used
	// historically by OSMO services (one human-readable line per record).
	FormatText Format = iota
	// FormatJSON emits one JSON object per record using slog's stdlib JSON
	// handler, suitable for direct ingestion by Loki/Elastic without parsing.
	FormatJSON
)

// ParseFormat converts a string format name to a Format. Unknown values
// fall back to FormatText to preserve existing behavior.
func ParseFormat(s string) Format {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "json":
		return FormatJSON
	case "text", "":
		return FormatText
	default:
		return FormatText
	}
}

// Config holds the logging configuration, mirroring Python's LoggingConfig.
type Config struct {
	// Level is the minimum slog level emitted; records below it are dropped.
	Level slog.Level
	// Format selects the on-disk/stdout encoding (text vs JSON).
	Format Format
	// LogDir is the directory to write log files to; empty disables file output.
	LogDir string
	// LogName is the base name of the log file (without extension); empty
	// falls back to the service name passed to InitLogger.
	LogName string
}

// FlagPointers holds pointers to flag values for logging configuration.
type FlagPointers struct {
	logLevel  *string
	logFormat *string
	logDir    *string
	logName   *string
}

// RegisterFlags registers logging-related command-line flags and returns
// pointers that should be converted to Config after flag.Parse().
func RegisterFlags() *FlagPointers {
	return &FlagPointers{
		logLevel:  flag.String("log-level", "info", "Log level (debug, info, warn, error)"),
		logFormat: flag.String("log-format", "text", "Log output format: text (legacy ServiceFormatter) or json (slog JSON)"),
		logDir:    flag.String("log-dir", "", "Directory to write log files to"),
		logName:   flag.String("log-name", "", "Name for the log file (without extension)"),
	}
}

// ToConfig converts flag pointers to Config. Must be called after flag.Parse().
func (f *FlagPointers) ToConfig() Config {
	return Config{
		Level:   ParseLevel(*f.logLevel),
		Format:  ParseFormat(*f.logFormat),
		LogDir:  *f.logDir,
		LogName: *f.logName,
	}
}

// ParseLevel converts a string log level to slog.Level.
func ParseLevel(level string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		return slog.LevelDebug
	case "info":
		return slog.LevelInfo
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	case "critical", "fatal":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// specialAttrKey is the slog attribute key that is extracted from the log
// record and placed before the message body as a named filter field
// (e.g. "user=alice ...") so upstream parsers can pick it up as a named
// capture group.
const specialAttrKey = "user"

// ServiceHandler is a slog.Handler that formats log records in the same format
// as Python's ServiceFormatter:
//
//	<ISO8601_time> <service_name> [<LEVEL>] <source>: [user=<user> ]<message>
//
// The "user" attribute is extracted from the record and placed as a named
// filter field before the message. All other attributes are appended as
// key=value pairs after the message.
//
// The <source> field is derived from the calling Go package name, analogous to
// Python's %(module)s.
type ServiceHandler struct {
	serviceName string
	level       slog.Level
	writer      io.Writer
	mu          *sync.Mutex
	attrs       []slog.Attr
	groups      []string
}

// NewServiceHandler creates a new ServiceHandler that writes to the given writer.
func NewServiceHandler(serviceName string, level slog.Level, writer io.Writer) *ServiceHandler {
	return &ServiceHandler{
		serviceName: serviceName,
		level:       level,
		writer:      writer,
		mu:          &sync.Mutex{},
	}
}

// Enabled reports whether the handler handles records at the given level.
func (h *ServiceHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level
}

// Handle formats and writes the log record.
func (h *ServiceHandler) Handle(_ context.Context, r slog.Record) error {
	timeStr := r.Time.Format("2006-01-02T15:04:05.000-07:00")
	levelStr := r.Level.String()

	source := callerSource(r.PC)

	var user string
	var extraParts []string

	collectAttr := func(a slog.Attr, groups []string) {
		if a.Key == specialAttrKey && user == "" {
			user = a.Value.String()
		} else {
			extraParts = append(extraParts, formatAttr(a, groups))
		}
	}

	for _, a := range h.resolveAttrs() {
		collectAttr(a, h.groups)
	}
	r.Attrs(func(a slog.Attr) bool {
		collectAttr(a, nil)
		return true
	})

	userPrefix := ""
	if user != "" {
		userPrefix = "user=" + user + " "
	}

	msg := r.Message
	if len(extraParts) > 0 {
		msg = msg + " " + strings.Join(extraParts, " ")
	}

	line := fmt.Sprintf("%s %s [%s] %s: %s%s\n",
		timeStr, h.serviceName, levelStr, source, userPrefix, msg)

	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := h.writer.Write([]byte(line))
	return err
}

// WithAttrs returns a new Handler with the given attributes pre-set.
func (h *ServiceHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	newAttrs := make([]slog.Attr, len(h.attrs), len(h.attrs)+len(attrs))
	copy(newAttrs, h.attrs)
	newAttrs = append(newAttrs, attrs...)
	return &ServiceHandler{
		serviceName: h.serviceName,
		level:       h.level,
		writer:      h.writer,
		mu:          h.mu,
		attrs:       newAttrs,
		groups:      h.groups,
	}
}

// WithGroup returns a new Handler with the given group name prepended to
// subsequent attribute keys.
func (h *ServiceHandler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	newGroups := make([]string, len(h.groups), len(h.groups)+1)
	copy(newGroups, h.groups)
	newGroups = append(newGroups, name)
	return &ServiceHandler{
		serviceName: h.serviceName,
		level:       h.level,
		writer:      h.writer,
		mu:          h.mu,
		attrs:       h.attrs,
		groups:      newGroups,
	}
}

// InitLogger initializes the default slog logger with a ServiceHandler.
// It always writes to stdout. If config.LogDir is set, it also writes to a
// log file at <LogDir>/<LogName>.txt (using LogName, or serviceName if empty).
// Returns the configured *slog.Logger.
func InitLogger(serviceName string, config Config) *slog.Logger {
	var writers []io.Writer
	writers = append(writers, os.Stdout)

	if config.LogDir != "" {
		if err := os.MkdirAll(config.LogDir, 0o755); err != nil {
			fmt.Fprintf(os.Stderr, "failed to create log directory %s: %v\n", config.LogDir, err)
		} else {
			logName := config.LogName
			if logName == "" {
				logName = serviceName
			}
			now := time.Now()
			timestamp := strings.ReplaceAll(
				now.Format("2006-01-02T15-04-05"), ":", "-")
			pid := os.Getpid()
			fileName := fmt.Sprintf("%s_%d_%s.txt", timestamp, pid, logName)
			filePath := filepath.Join(config.LogDir, fileName)

			file, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
			if err != nil {
				fmt.Fprintf(os.Stderr, "failed to open log file %s: %v\n", filePath, err)
			} else {
				writers = append(writers, file)
			}
		}
	}

	writer := io.MultiWriter(writers...)
	logger := slog.New(buildHandler(serviceName, config, writer))
	slog.SetDefault(logger)

	logger.Info("Starting service ...")

	return logger
}

// buildHandler returns the slog.Handler for the requested format.
// For JSON, the standard library handler is used and the service name is
// attached as a stable top-level attribute so log backends can filter on it.
func buildHandler(serviceName string, config Config, writer io.Writer) slog.Handler {
	switch config.Format {
	case FormatJSON:
		h := slog.NewJSONHandler(writer, &slog.HandlerOptions{
			Level: config.Level,
		})
		return h.WithAttrs([]slog.Attr{slog.String("service", serviceName)})
	default:
		return NewServiceHandler(serviceName, config.Level, writer)
	}
}

// callerSource extracts the Go package name from the program counter,
// analogous to Python's %(module)s.
func callerSource(pc uintptr) string {
	if pc == 0 {
		return "unknown"
	}
	frames := runtime.CallersFrames([]uintptr{pc})
	f, _ := frames.Next()
	if f.Function == "" {
		return "unknown"
	}
	parts := strings.Split(f.Function, "/")
	lastPart := parts[len(parts)-1]
	if idx := strings.Index(lastPart, "."); idx >= 0 {
		return lastPart[:idx]
	}
	return lastPart
}

// resolveAttrs returns the pre-set attributes with group prefixes applied.
func (h *ServiceHandler) resolveAttrs() []slog.Attr {
	if len(h.groups) == 0 {
		return h.attrs
	}
	result := make([]slog.Attr, len(h.attrs))
	prefix := strings.Join(h.groups, ".") + "."
	for i, a := range h.attrs {
		result[i] = slog.Attr{Key: prefix + a.Key, Value: a.Value}
	}
	return result
}

// formatAttr formats a single slog.Attr as "key=value", applying the group
// prefix if provided.
func formatAttr(a slog.Attr, groups []string) string {
	key := a.Key
	if len(groups) > 0 {
		key = strings.Join(groups, ".") + "." + key
	}
	return fmt.Sprintf("%s=%s", key, a.Value.String())
}
