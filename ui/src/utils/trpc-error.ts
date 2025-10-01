//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0
import { TRPCError } from "@trpc/server";

import { type OSMOErrorResponse } from "~/models";

/**
 * Converts an HTTP response to a TRPC error
 * Handles both HTTP status errors and OSMO-specific error responses
 *
 * @param response - The HTTP response to convert to a TRPC error
 * @throws {TRPCError} - A TRPC error with appropriate code and message
 */
export const throwTrpcErrorFromResponse = async (response: Response): Promise<never> => {
  let errorData: OSMOErrorResponse | undefined = undefined;

  try {
    // Try to parse the response as JSON to get error details
    errorData = await response.json();
  } catch {
    // If JSON parsing fails, use a default error message (below)
  }

  // Determine the appropriate TRPC error code based on HTTP status
  let code: TRPCError["code"] = "INTERNAL_SERVER_ERROR";

  switch (response.status) {
    case 400:
      code = "BAD_REQUEST";
      break;
    case 401:
      code = "UNAUTHORIZED";
      break;
    case 403:
      code = "FORBIDDEN";
      break;
    case 404:
      code = "NOT_FOUND";
      break;
    case 409:
      code = "CONFLICT";
      break;
    case 422:
      code = "UNPROCESSABLE_CONTENT";
      break;
    case 429:
      code = "TOO_MANY_REQUESTS";
      break;
    default:
      code = "INTERNAL_SERVER_ERROR";
  }

  throw new TRPCError({
    code,
    message: errorData?.message ?? errorData?.error_code ?? `HTTP ${response.status}: ${response.statusText}`,
  });
};
