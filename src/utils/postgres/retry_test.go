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

package postgres

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type safeToRetryError struct{}

func (safeToRetryError) Error() string {
	return "safe to retry"
}

func (safeToRetryError) SafeToRetry() bool {
	return true
}

type timeoutError struct{}

func (timeoutError) Error() string {
	return "database operation timed out"
}

func (timeoutError) Timeout() bool {
	return true
}

func (timeoutError) Temporary() bool {
	return true
}

type permanentNetworkError struct{}

func (permanentNetworkError) Error() string {
	return "permanent network error"
}

func (permanentNetworkError) Timeout() bool {
	return false
}

func (permanentNetworkError) Temporary() bool {
	return false
}

func newRetryTestClient(attempts int) (*PostgresClient, *[]time.Duration) {
	delays := []time.Duration{}
	return &PostgresClient{
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		retryAttempts: attempts,
		randomFloat:   func() float64 { return 0 },
		waitForRetry: func(_ context.Context, delay time.Duration) error {
			delays = append(delays, delay)
			return nil
		},
	}, &delays
}

func TestRetryDelayUsesEqualJitterAndCap(t *testing.T) {
	randomValues := []float64{0, 0.5, 0, 0, 0, 0, 0}
	client, _ := newRetryTestClient(8)
	client.randomFloat = func() float64 {
		value := randomValues[0]
		randomValues = randomValues[1:]
		return value
	}

	want := []time.Duration{
		50 * time.Millisecond,
		150 * time.Millisecond,
		200 * time.Millisecond,
		400 * time.Millisecond,
		800 * time.Millisecond,
		time.Second,
		time.Second,
	}
	for attempt, wantDelay := range want {
		if got := client.retryDelay(attempt + 1); got != wantDelay {
			t.Errorf("retryDelay(%d) = %v, want %v", attempt+1, got, wantDelay)
		}
	}
}

func TestRunWithRetrySuccessDoesNotDelay(t *testing.T) {
	client, delays := newRetryTestClient(5)
	client.pool = &pgxpool.Pool{}
	type contextKey string
	ctx := context.WithValue(context.Background(), contextKey("request"), "original")
	attempts := 0

	err := client.RunWithRetry(ctx, "read roles", ReplayReadOnly,
		func(operationCtx context.Context, operationPool *pgxpool.Pool) error {
			attempts++
			if operationCtx != ctx {
				t.Errorf("operation context differs from original context")
			}
			if operationPool != client.pool {
				t.Errorf("operation pool differs from client pool")
			}
			return nil
		})

	if err != nil {
		t.Fatalf("RunWithRetry() error = %v", err)
	}
	if attempts != 1 {
		t.Errorf("operation calls = %d, want 1", attempts)
	}
	if len(*delays) != 0 {
		t.Errorf("retry delays = %v, want none", *delays)
	}
}

func TestRunWithRetryExhaustionHasNoFinalDelay(t *testing.T) {
	var logs bytes.Buffer
	client, delays := newRetryTestClient(3)
	client.logger = slog.New(slog.NewTextHandler(&logs, nil))
	wantErr := &pgconn.PgError{Code: "40001"}
	attempts := 0

	err := client.RunWithRetry(context.Background(), "update role", ReplaySafeOnly,
		func(context.Context, *pgxpool.Pool) error {
			attempts++
			return wantErr
		})

	if !errors.Is(err, wantErr) {
		t.Fatalf("RunWithRetry() error = %v, want original error", err)
	}
	if attempts != 3 {
		t.Errorf("operation calls = %d, want 3", attempts)
	}
	if got := len(*delays); got != 2 {
		t.Errorf("retry delay count = %d, want 2", got)
	}
	if got := strings.Count(logs.String(), "retrying PostgreSQL operation"); got != 2 {
		t.Errorf("retry log count = %d, want 2", got)
	}
}

func TestRunWithRetryCancellationDuringDelay(t *testing.T) {
	client, _ := newRetryTestClient(5)
	ctx, cancel := context.WithCancel(context.Background())
	waits := 0
	client.waitForRetry = func(waitCtx context.Context, delay time.Duration) error {
		waits++
		cancel()
		return waitForRetry(waitCtx, delay)
	}
	attempts := 0

	err := client.RunWithRetry(ctx, "read roles", ReplayReadOnly,
		func(context.Context, *pgxpool.Pool) error {
			attempts++
			return &pgconn.PgError{Code: "08006"}
		})

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("RunWithRetry() error = %v, want context.Canceled", err)
	}
	if attempts != 1 {
		t.Errorf("operation calls = %d, want 1", attempts)
	}
	if waits != 1 {
		t.Errorf("retry waits = %d, want 1", waits)
	}
}

func TestRunWithRetryPreservesCallbackErrorWrappingCanceledContext(t *testing.T) {
	client, delays := newRetryTestClient(5)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	attempts := 0

	err := client.RunWithRetry(ctx, "read pool names", ReplayReadOnly,
		func(operationContext context.Context, _ *pgxpool.Pool) error {
			attempts++
			return fmt.Errorf("failed to query pool names: %w", operationContext.Err())
		})

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("RunWithRetry() error = %v, want wrapped context.Canceled", err)
	}
	if got, want := err.Error(), "failed to query pool names: context canceled"; got != want {
		t.Errorf("RunWithRetry() error = %q, want %q", got, want)
	}
	if attempts != 1 {
		t.Errorf("operation calls = %d, want 1", attempts)
	}
	if len(*delays) != 0 {
		t.Errorf("retry delays = %v, want none", *delays)
	}
}

func TestRunWithRetryPublishesOnlySuccessfulAttemptResults(t *testing.T) {
	client, _ := newRetryTestClient(2)
	attempts := 0
	var published []string

	err := client.RunWithRetry(context.Background(), "read role names", ReplayReadOnly,
		func(context.Context, *pgxpool.Pool) error {
			attempts++
			attemptResult := []string{"partial"}
			if attempts == 1 {
				attemptResult = append(attemptResult, "failed attempt")
				return &pgconn.PgError{Code: "40001"}
			}

			attemptResult = append(attemptResult, "successful attempt")
			published = attemptResult
			return nil
		})

	if err != nil {
		t.Fatalf("RunWithRetry() error = %v", err)
	}
	if attempts != 2 {
		t.Fatalf("operation calls = %d, want 2", attempts)
	}
	want := []string{"partial", "successful attempt"}
	if !slices.Equal(published, want) {
		t.Errorf("published result = %v, want %v", published, want)
	}
}

func TestRunWithRetrySafeToRetryPermitsAllClasses(t *testing.T) {
	for _, replaySafety := range []ReplaySafety{ReplayReadOnly, ReplayIdempotent, ReplaySafeOnly} {
		t.Run(replaySafety.String(), func(t *testing.T) {
			client, _ := newRetryTestClient(2)
			attempts := 0

			err := client.RunWithRetry(context.Background(), "database operation", replaySafety,
				func(context.Context, *pgxpool.Pool) error {
					attempts++
					if attempts == 1 {
						return safeToRetryError{}
					}
					return nil
				})

			if err != nil {
				t.Fatalf("RunWithRetry() error = %v", err)
			}
			if attempts != 2 {
				t.Errorf("operation calls = %d, want 2", attempts)
			}
		})
	}
}

func TestRunWithRetryConnectionFailureRespectsReplaySafety(t *testing.T) {
	testCases := []struct {
		name         string
		error        error
		replaySafety ReplaySafety
		wantAttempts int
	}{
		{name: "read only SQLSTATE 08", error: &pgconn.PgError{Code: "08006"}, replaySafety: ReplayReadOnly, wantAttempts: 2},
		{name: "idempotent SQLSTATE 08", error: &pgconn.PgError{Code: "08006"}, replaySafety: ReplayIdempotent, wantAttempts: 2},
		{name: "safe only SQLSTATE 08", error: &pgconn.PgError{Code: "08006"}, replaySafety: ReplaySafeOnly, wantAttempts: 1},
		{name: "read only timeout", error: timeoutError{}, replaySafety: ReplayReadOnly, wantAttempts: 2},
		{name: "safe only timeout", error: timeoutError{}, replaySafety: ReplaySafeOnly, wantAttempts: 1},
		{name: "read only permanent network error", error: permanentNetworkError{}, replaySafety: ReplayReadOnly, wantAttempts: 1},
		{name: "read only closed transaction", error: pgx.ErrTxClosed, replaySafety: ReplayReadOnly, wantAttempts: 1},
		{name: "safe only closed transaction", error: pgx.ErrTxClosed, replaySafety: ReplaySafeOnly, wantAttempts: 1},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			client, _ := newRetryTestClient(2)
			attempts := 0

			err := client.RunWithRetry(context.Background(), "database operation", testCase.replaySafety,
				func(context.Context, *pgxpool.Pool) error {
					attempts++
					return testCase.error
				})

			if !errors.Is(err, testCase.error) {
				t.Fatalf("RunWithRetry() error = %v, want original error", err)
			}
			if attempts != testCase.wantAttempts {
				t.Errorf("operation calls = %d, want %d", attempts, testCase.wantAttempts)
			}
		})
	}
}

func TestRunWithRetryTransactionAbortCodes(t *testing.T) {
	for _, sqlState := range []string{"40001", "40P01"} {
		for _, replaySafety := range []ReplaySafety{ReplayReadOnly, ReplayIdempotent, ReplaySafeOnly} {
			t.Run(sqlState+"/"+replaySafety.String(), func(t *testing.T) {
				var logs bytes.Buffer
				client, _ := newRetryTestClient(2)
				client.logger = slog.New(slog.NewJSONHandler(&logs, nil))
				attempts := 0

				err := client.RunWithRetry(context.Background(), "database operation", replaySafety,
					func(context.Context, *pgxpool.Pool) error {
						attempts++
						if attempts == 1 {
							return &pgconn.PgError{Code: sqlState, Message: "sensitive query contents"}
						}
						return nil
					})

				if err != nil {
					t.Fatalf("RunWithRetry() error = %v", err)
				}
				if attempts != 2 {
					t.Errorf("operation calls = %d, want 2", attempts)
				}
				logOutput := logs.String()
				if strings.Contains(logOutput, "sensitive query contents") {
					t.Errorf("retry log contains query contents: %s", logOutput)
				}
				var fields map[string]any
				if err := json.Unmarshal(logs.Bytes(), &fields); err != nil {
					t.Fatalf("retry log is not valid structured JSON: %v", err)
				}
				wantFields := map[string]any{
					"operation":     "database operation",
					"attempt":       float64(1),
					"max_attempts":  float64(2),
					"error_type":    "*pgconn.PgError",
					"sqlstate":      sqlState,
					"replay_safety": replaySafety.String(),
				}
				for name, wantValue := range wantFields {
					if fields[name] != wantValue {
						t.Errorf("retry log field %q = %v, want %v", name, fields[name], wantValue)
					}
				}
				if _, ok := fields["delay"]; !ok {
					t.Error("retry log does not contain delay")
				}
			})
		}
	}
}

func TestRunWithRetryRejectsDeterministicPgError(t *testing.T) {
	client, delays := newRetryTestClient(5)
	wantErr := &pgconn.PgError{Code: "23505"}
	attempts := 0

	err := client.RunWithRetry(context.Background(), "insert role", ReplayReadOnly,
		func(context.Context, *pgxpool.Pool) error {
			attempts++
			return wantErr
		})

	if !errors.Is(err, wantErr) {
		t.Fatalf("RunWithRetry() error = %v, want original error", err)
	}
	if attempts != 1 {
		t.Errorf("operation calls = %d, want 1", attempts)
	}
	if len(*delays) != 0 {
		t.Errorf("retry delays = %v, want none", *delays)
	}
}
