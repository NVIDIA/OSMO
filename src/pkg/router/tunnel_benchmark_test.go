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

package router

// tunnel_benchmark_test.go - Benchmarks comparing zero-copy vs traditional receive
//
// Run manually with:
//   bazel run //src/pkg/router:tunnel_benchmark
//
// Key insight:
//   - Read() copies from gRPC buffer to caller's buffer (CPU overhead scales with size)
//   - WriteTo() passes gRPC buffer pointer directly to destination (constant time)
//   - Write() is already zero-copy (no io.ReaderFrom needed)

import (
	"fmt"
	"io"
	"runtime"
	"sync"
	"testing"
)

// Benchmark payload sizes - from small commands to max message size
var benchPayloadSizes = []int{
	64,              // Tiny: metadata, small commands
	1024,            // 1KB: typical small transfers
	16 * 1024,       // 16KB: medium transfers
	64 * 1024,       // 64KB: rsync/file chunks
	256 * 1024,      // 256KB: large transfers
	1024 * 1024,     // 1MB: big file chunks
	4 * 1024 * 1024, // 4MB: max message size
}

// benchResult holds timing and throughput results
type benchResult struct {
	size        int
	readNs      float64
	writeToNs   float64
	readMBps    float64
	writeToMBps float64
}

// TestPrintBenchmarkTable runs benchmarks and prints comparison table.
func TestPrintBenchmarkTable(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping benchmark table in short mode")
	}

	results := make([]benchResult, 0, len(benchPayloadSizes))

	for _, size := range benchPayloadSizes {
		payload := make([]byte, size)
		for i := range payload {
			payload[i] = byte(i % 256)
		}

		r := benchResult{size: size}

		// Benchmark Read (has copy)
		readResult := testing.Benchmark(func(b *testing.B) {
			stream := newBenchStream(payload, b.N)
			tunnel := &Tunnel{stream: stream, closed: make(chan struct{})}
			buf := make([]byte, size)

			b.SetBytes(int64(size))
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				tunnel.Read(buf)
			}
		})
		r.readNs = float64(readResult.NsPerOp())
		r.readMBps = float64(size) / r.readNs * 1000 // bytes/ns → MB/s

		// Benchmark WriteTo (zero-copy)
		writeToResult := testing.Benchmark(func(b *testing.B) {
			stream := newBenchStream(payload, b.N)
			tunnel := &Tunnel{stream: stream, closed: make(chan struct{})}

			b.SetBytes(int64(size))
			b.ResetTimer()
			tunnel.WriteTo(io.Discard)
		})
		r.writeToNs = float64(writeToResult.NsPerOp())
		r.writeToMBps = float64(size) / r.writeToNs * 1000 // bytes/ns → MB/s

		results = append(results, r)
	}

	// Print table
	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║              RECEIVE FROM TUNNEL: Read() vs WriteTo() - both receive data                   ║")
	fmt.Println("║                                                                                              ║")
	fmt.Println("║  Read(p):    Copy from gRPC buffer → p   (memcpy overhead, scales with size)                ║")
	fmt.Println("║  WriteTo(w): Pass gRPC buffer ptr → w    (no copy, constant ~6ns overhead)                  ║")
	fmt.Println("╠══════════╦═════════════════════════════╦════════════════╦════════════════════════════════════╣")
	fmt.Println("║ Payload  ║     Read() [COPY]           ║  WriteTo() ns  ║             Speedup                ║")
	fmt.Println("║          ║   Time       Throughput     ║   (overhead)   ║                                    ║")
	fmt.Println("╠══════════╬═════════════════════════════╬════════════════╬════════════════════════════════════╣")

	for _, r := range results {
		speedup := r.readNs / r.writeToNs
		fmt.Printf("║ %8s ║ %9s  %12s   ║ %10s     ║ %22.1fx faster     ║\n",
			formatSize(r.size),
			formatDuration(r.readNs),
			formatThroughput(r.readMBps),
			formatDuration(r.writeToNs),
			speedup,
		)
	}

	fmt.Println("╚══════════╩═════════════════════════════╩════════════════╩════════════════════════════════════╝")
	fmt.Println()
	fmt.Printf("System: %s/%s, %d CPUs\n", runtime.GOOS, runtime.GOARCH, runtime.NumCPU())
	fmt.Println()
}

// ============================================================================
// Helper types
// ============================================================================

type benchStream struct {
	payload   []byte
	remaining int
	mu        sync.Mutex
}

func newBenchStream(payload []byte, count int) *benchStream {
	return &benchStream{payload: payload, remaining: count}
}

func (s *benchStream) SendPayload(p []byte) error { return nil }

func (s *benchStream) RecvPayload() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.remaining <= 0 {
		return nil, io.EOF
	}
	s.remaining--
	return s.payload, nil
}

func (s *benchStream) CloseSend() error { return nil }

// ============================================================================
// Formatting helpers
// ============================================================================

func formatSize(bytes int) string {
	switch {
	case bytes >= 1024*1024:
		return fmt.Sprintf("%dMB", bytes/(1024*1024))
	case bytes >= 1024:
		return fmt.Sprintf("%dKB", bytes/1024)
	default:
		return fmt.Sprintf("%dB", bytes)
	}
}

func formatDuration(ns float64) string {
	switch {
	case ns >= 1_000_000:
		return fmt.Sprintf("%.2fms", ns/1_000_000)
	case ns >= 1_000:
		return fmt.Sprintf("%.1fµs", ns/1_000)
	default:
		return fmt.Sprintf("%.0fns", ns)
	}
}

func formatThroughput(mbps float64) string {
	switch {
	case mbps >= 1000:
		return fmt.Sprintf("%.1f GB/s", mbps/1000)
	default:
		return fmt.Sprintf("%.0f MB/s", mbps)
	}
}

// ============================================================================
// Standard Go Benchmarks (for go test -bench)
// ============================================================================

// BenchmarkRead benchmarks Read (has copy)
func BenchmarkRead(b *testing.B) {
	for _, size := range benchPayloadSizes {
		b.Run(formatSize(size), func(b *testing.B) {
			payload := make([]byte, size)
			stream := newBenchStream(payload, b.N)
			tunnel := &Tunnel{stream: stream, closed: make(chan struct{})}
			buf := make([]byte, size)

			b.SetBytes(int64(size))
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				tunnel.Read(buf)
			}
		})
	}
}

// BenchmarkWriteTo benchmarks WriteTo (zero-copy)
func BenchmarkWriteTo(b *testing.B) {
	for _, size := range benchPayloadSizes {
		b.Run(formatSize(size), func(b *testing.B) {
			payload := make([]byte, size)
			stream := newBenchStream(payload, b.N)
			tunnel := &Tunnel{stream: stream, closed: make(chan struct{})}

			b.SetBytes(int64(size))
			b.ReportAllocs()
			b.ResetTimer()
			tunnel.WriteTo(io.Discard)
		})
	}
}
