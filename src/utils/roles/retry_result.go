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

package roles

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.corp.nvidia.com/osmo/utils/postgres"
)

type retryResultRunner interface {
	RunWithRetry(
		context.Context,
		string,
		postgres.ReplaySafety,
		func(context.Context, *pgxpool.Pool) error,
	) error
}

func runWithRetryResult[T any](
	ctx context.Context,
	runner retryResultRunner,
	operationName string,
	replaySafety postgres.ReplaySafety,
	result *T,
	operation func(context.Context, *pgxpool.Pool) (T, error),
) error {
	return runner.RunWithRetry(ctx, operationName, replaySafety,
		func(attemptContext context.Context, pool *pgxpool.Pool) error {
			attemptResult, err := operation(attemptContext, pool)
			if err != nil {
				return err
			}
			*result = attemptResult
			return nil
		})
}
