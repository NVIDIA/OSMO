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
import { z } from "zod";

export const AuthClaimsSchema = z.object({
  acr: z.string().optional(),
  at_hash: z.string().optional(),
  aud: z.string().optional(),
  auth_time: z.number().optional(),
  azp: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.literal(false).optional(),
  exp: z.number().optional(),
  family_name: z.string().optional(),
  given_name: z.string().optional(),
  iat: z.number().optional(),
  iss: z.string().optional(),
  jti: z.string().optional(),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
  roles: z.array(z.string()).optional(),
  session_state: z.string().optional(),
  sid: z.string().optional(),
  sub: z.string().optional(),
  typ: z.string().optional(),
});

export const TokenCheckSchema = z.object({
  isFailure: z.boolean(),
});

export const TokenRefreshSchema = z.object({
  isFailure: z.boolean(),
  id_token: z.string().optional(),
  refresh_token: z.string().optional(),
});

export type AuthClaims = z.infer<typeof AuthClaimsSchema>;
export type TokenCheck = z.infer<typeof TokenCheckSchema>;
export type TokenRefresh = z.infer<typeof TokenRefreshSchema>;
