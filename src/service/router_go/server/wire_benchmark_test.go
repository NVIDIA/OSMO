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

package server

// wire_benchmark_test.go - Benchmarks comparing zero-copy vs traditional forwarding
//
// Run manually with:
//   bazel run //src/service/router_go/server:wire_benchmark
//
// This is a manual target because benchmarks take time and shouldn't run on every test.

import (
	"fmt"
	"testing"

	"google.golang.org/protobuf/proto"

	pb "go.corp.nvidia.com/osmo/proto/router"
)

// Benchmark payload sizes to test
var benchPayloadSizes = []int{
	64,              // Tiny: metadata, small commands
	1024,            // 1KB: typical small transfers
	16 * 1024,       // 16KB: medium transfers
	64 * 1024,       // 64KB: rsync/file chunks
	256 * 1024,      // 256KB: large transfers
	1024 * 1024,     // 1MB: big file chunks
	4 * 1024 * 1024, // 4MB: max message size (defaultMaxMessageSize)
}

// benchResult holds the result of a single benchmark run
type benchResult struct {
	size          int
	zeroCopyNs    float64
	zeroCopyMB    float64
	zeroCopyB     int64
	traditionalNs float64
	traditionalMB float64
	traditionalB  int64
}

// TestPrintBenchmarkTable runs benchmarks and prints a formatted comparison table.
// This is a "Test" so it can use testing.B for accurate measurements.
func TestPrintBenchmarkTable(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping benchmark table in short mode")
	}

	codec := rawCodec{}
	results := make([]benchResult, 0, len(benchPayloadSizes))

	for _, size := range benchPayloadSizes {
		// Prepare test data
		payload := make([]byte, size)
		for i := range payload {
			payload[i] = byte(i % 256)
		}
		wireBytes, _ := proto.Marshal(&pb.UserFrame{
			Frame: &pb.UserFrame_Payload{Payload: payload},
		})

		// Run zero-copy benchmark
		zcResult := testing.Benchmark(func(b *testing.B) {
			b.SetBytes(int64(len(wireBytes)))
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				var rf RawFrame
				_ = codec.Unmarshal(wireBytes, &rf)
				forwarded, _ := codec.Marshal(&rf)
				if len(forwarded) == 0 {
					b.Fatal("unexpected empty")
				}
			}
		})

		// Run traditional benchmark
		tradResult := testing.Benchmark(func(b *testing.B) {
			b.SetBytes(int64(len(wireBytes)))
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				var frame pb.UserFrame
				_ = proto.Unmarshal(wireBytes, &frame)
				forwarded, _ := proto.Marshal(&frame)
				if len(forwarded) == 0 {
					b.Fatal("unexpected empty")
				}
			}
		})

		results = append(results, benchResult{
			size:          size,
			zeroCopyNs:    float64(zcResult.NsPerOp()),
			zeroCopyMB:    float64(len(wireBytes)) / float64(zcResult.NsPerOp()) * 1000,
			zeroCopyB:     int64(zcResult.AllocedBytesPerOp()),
			traditionalNs: float64(tradResult.NsPerOp()),
			traditionalMB: float64(len(wireBytes)) / float64(tradResult.NsPerOp()) * 1000,
			traditionalB:  int64(tradResult.AllocedBytesPerOp()),
		})
	}

	// Print the table
	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║                        ZERO-COPY vs TRADITIONAL FORWARDING BENCHMARK                         ║")
	fmt.Println("╠══════════╦═══════════════════════════════════╦═══════════════════════════════════╦═══════════╣")
	fmt.Println("║ Payload  ║          Zero-Copy                ║          Traditional              ║  Speedup  ║")
	fmt.Println("║   Size   ║    Time    │  Throughput │ Alloc  ║    Time    │  Throughput │ Alloc  ║           ║")
	fmt.Println("╠══════════╬════════════╪═════════════╪════════╬════════════╪═════════════╪════════╬═══════════╣")

	for _, r := range results {
		speedup := r.traditionalNs / r.zeroCopyNs
		memSaved := float64(r.traditionalB-r.zeroCopyB) / float64(r.traditionalB) * 100

		fmt.Printf("║ %8s ║ %10s │ %11s │ %6s ║ %10s │ %11s │ %6s ║ %6.0fx    ║\n",
			formatSize(r.size),
			formatDuration(r.zeroCopyNs),
			formatThroughput(r.zeroCopyMB),
			formatBytes(r.zeroCopyB),
			formatDuration(r.traditionalNs),
			formatThroughput(r.traditionalMB),
			formatBytes(r.traditionalB),
			speedup,
		)
		_ = memSaved // Used for logging if needed
	}

	fmt.Println("╚══════════╩════════════╧═════════════╧════════╩════════════╧═════════════╧════════╩═══════════╝")
	fmt.Println()
	fmt.Println("Legend:")
	fmt.Println("  • Time: nanoseconds per operation (lower is better)")
	fmt.Println("  • Throughput: megabytes per second (higher is better)")
	fmt.Println("  • Alloc: bytes allocated per operation (lower is better)")
	fmt.Println("  • Speedup: how many times faster zero-copy is vs traditional")
	fmt.Println()
}

// formatSize returns a human-readable size string
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

// formatDuration formats nanoseconds nicely
func formatDuration(ns float64) string {
	switch {
	case ns >= 1_000_000:
		return fmt.Sprintf("%.1fms", ns/1_000_000)
	case ns >= 1_000:
		return fmt.Sprintf("%.1fµs", ns/1_000)
	default:
		return fmt.Sprintf("%.1fns", ns)
	}
}

// formatThroughput formats MB/s nicely
func formatThroughput(mbps float64) string {
	switch {
	case mbps >= 1_000_000:
		return fmt.Sprintf("%.0fTB/s", mbps/1_000_000)
	case mbps >= 1_000:
		return fmt.Sprintf("%.0fGB/s", mbps/1_000)
	default:
		return fmt.Sprintf("%.0fMB/s", mbps)
	}
}

// formatBytes formats byte count nicely
func formatBytes(b int64) string {
	switch {
	case b >= 1024*1024:
		return fmt.Sprintf("%.1fMB", float64(b)/(1024*1024))
	case b >= 1024:
		return fmt.Sprintf("%.1fKB", float64(b)/1024)
	default:
		return fmt.Sprintf("%dB", b)
	}
}

// ============================================================================
// Standard Go Benchmarks (for go test -bench compatibility)
// ============================================================================

// BenchmarkZeroCopyForward measures the zero-copy approach:
// gRPC bytes → RawFrame (no copy) → forward same bytes
func BenchmarkZeroCopyForward(b *testing.B) {
	codec := rawCodec{}

	for _, size := range benchPayloadSizes {
		b.Run(formatSize(size), func(b *testing.B) {
			payload := make([]byte, size)
			for i := range payload {
				payload[i] = byte(i % 256)
			}
			wireBytes, _ := proto.Marshal(&pb.UserFrame{
				Frame: &pb.UserFrame_Payload{Payload: payload},
			})

			b.SetBytes(int64(len(wireBytes)))
			b.ReportAllocs()
			b.ResetTimer()

			for i := 0; i < b.N; i++ {
				var rf RawFrame
				_ = codec.Unmarshal(wireBytes, &rf)
				forwarded, _ := codec.Marshal(&rf)
				if len(forwarded) == 0 {
					b.Fatal("unexpected empty")
				}
			}
		})
	}
}

// BenchmarkTraditionalForward measures the traditional approach:
// gRPC bytes → Unmarshal to UserFrame → Marshal back to bytes
func BenchmarkTraditionalForward(b *testing.B) {
	for _, size := range benchPayloadSizes {
		b.Run(formatSize(size), func(b *testing.B) {
			payload := make([]byte, size)
			for i := range payload {
				payload[i] = byte(i % 256)
			}
			wireBytes, _ := proto.Marshal(&pb.UserFrame{
				Frame: &pb.UserFrame_Payload{Payload: payload},
			})

			b.SetBytes(int64(len(wireBytes)))
			b.ReportAllocs()
			b.ResetTimer()

			for i := 0; i < b.N; i++ {
				var frame pb.UserFrame
				_ = proto.Unmarshal(wireBytes, &frame)
				forwarded, _ := proto.Marshal(&frame)
				if len(forwarded) == 0 {
					b.Fatal("unexpected empty")
				}
			}
		})
	}
}

// BenchmarkTypeCheck measures the cost of IsInit/IsPayload byte inspection
func BenchmarkTypeCheck(b *testing.B) {
	initBytes, _ := proto.Marshal(&pb.UserFrame{
		Frame: &pb.UserFrame_Init{Init: &pb.UserInit{SessionKey: "test"}},
	})
	payloadBytes, _ := proto.Marshal(&pb.UserFrame{
		Frame: &pb.UserFrame_Payload{Payload: make([]byte, 1024)},
	})

	b.Run("IsInit", func(b *testing.B) {
		rf := &RawFrame{Raw: initBytes}
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_ = rf.IsInit()
		}
	})

	b.Run("IsPayload", func(b *testing.B) {
		rf := &RawFrame{Raw: payloadBytes}
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_ = rf.IsPayload()
		}
	})

	b.Run("FullUnmarshal", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			var frame pb.UserFrame
			_ = proto.Unmarshal(payloadBytes, &frame)
			_ = frame.GetPayload() != nil
		}
	})
}
