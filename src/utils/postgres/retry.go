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
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

const (
	retryBaseDelay = 100 * time.Millisecond
	retryMaxDelay  = 2 * time.Second
)

// ReplaySafety describes whether an operation can be safely replayed after an ambiguous failure.
type ReplaySafety int

const (
	// ReplayReadOnly identifies operations that do not change database state.
	ReplayReadOnly ReplaySafety = iota
	// ReplayIdempotent identifies writes whose repeated execution converges to the same state.
	ReplayIdempotent
	// ReplaySafeOnly identifies writes that must not be replayed after an ambiguous failure.
	ReplaySafeOnly
)

func (s ReplaySafety) String() string {
	switch s {
	case ReplayReadOnly:
		return "read_only"
	case ReplayIdempotent:
		return "idempotent"
	case ReplaySafeOnly:
		return "safe_only"
	default:
		return "unknown"
	}
}

// RunWithRetry runs an operation with bounded retries appropriate for its replay safety.
func (c *PostgresClient) RunWithRetry(
	ctx context.Context,
	operationName string,
	replaySafety ReplaySafety,
	operation func(context.Context) error,
) error {
	for attempt := 1; attempt <= c.retryAttempts; attempt++ {
		err := operation(ctx)
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if attempt == c.retryAttempts || !canRetry(err, replaySafety) {
			return err
		}

		delay := c.retryDelay(attempt)
		c.logger.Warn("retrying PostgreSQL operation",
			slog.String("operation", operationName),
			slog.Int("attempt", attempt),
			slog.Int("max_attempts", c.retryAttempts),
			slog.Duration("delay", delay),
			slog.String("error_type", fmt.Sprintf("%T", err)),
			slog.String("sqlstate", postgresSQLState(err)),
			slog.String("replay_safety", replaySafety.String()),
		)
		if err := c.waitForRetry(ctx, delay); err != nil {
			return err
		}
	}
	return nil
}

func (c *PostgresClient) retryDelay(attempt int) time.Duration {
	window := retryBaseDelay
	for retryNumber := 1; retryNumber < attempt && window < retryMaxDelay; retryNumber++ {
		window *= 2
	}
	if window > retryMaxDelay {
		window = retryMaxDelay
	}
	halfWindow := window / 2
	return halfWindow + time.Duration(c.randomFloat()*float64(halfWindow))
}

func waitForRetry(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func canRetry(err error, replaySafety ReplaySafety) bool {
	if pgconn.SafeToRetry(err) {
		return true
	}

	sqlState := postgresSQLState(err)
	if sqlState == "40001" || sqlState == "40P01" {
		return true
	}

	return permitsAmbiguousReplay(replaySafety) && isConnectionFailure(err, sqlState)
}

func permitsAmbiguousReplay(replaySafety ReplaySafety) bool {
	return replaySafety == ReplayReadOnly || replaySafety == ReplayIdempotent
}

func isConnectionFailure(err error, sqlState string) bool {
	if strings.HasPrefix(sqlState, "08") || pgconn.Timeout(err) || errors.Is(err, net.ErrClosed) {
		return true
	}

	var networkError net.Error
	return errors.As(err, &networkError) && networkError.Timeout()
}

func postgresSQLState(err error) string {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		return postgresError.Code
	}
	return ""
}

func defaultRandomFloat() float64 {
	return rand.Float64()
}
