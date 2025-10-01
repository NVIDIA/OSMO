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

import {
  type CredentialsListResponse,
  CredentialsRequestSchema,
  CredentialTypes,
  DeleteCredentialRequestSchema,
  type DeleteCredentialsResponseSchema,
  type OSMOErrorResponse,
  type OSMOErrorResponseSchema,
  SetCredentialRequestSchema,
  type SetCredentialsResponseSchema,
} from "~/models";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { OsmoApiFetch } from "~/utils/common";

export const credentialsRouter = createTRPCRouter({
  getCredentials: publicProcedure.input(CredentialsRequestSchema).query(async ({ ctx }) => {
    try {
      const response = await OsmoApiFetch("/api/credentials", ctx);
      const data = (await response.json()) as CredentialsListResponse;

      return data.credentials;
    } catch (e) {
      return [];
    }
  }),
  setCredential: publicProcedure.input(SetCredentialRequestSchema).mutation(async ({ ctx, input }) => {
    try {
      let requestBody: Record<string, unknown>;

      switch (input.type) {
        case CredentialTypes.Registry:
          requestBody = {
            registry_credential: {
              registry: input.registry_credential.registry,
              username: input.registry_credential.username,
              auth: input.registry_credential.auth,
            },
          };
          break;
        case CredentialTypes.Data:
          requestBody = {
            data_credential: {
              endpoint: input.data_credential.endpoint,
              access_key_id: input.data_credential.access_key_id,
              access_key: input.data_credential.access_key,
              region: input.data_credential.region,
            },
          };
          break;
        case CredentialTypes.Generic:
          requestBody = {
            generic_credential: {
              credential: input.generic_credential.credential,
            },
          };
          break;
        default:
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid credential type",
          });
      }

      const response = await OsmoApiFetch(
        `/api/credentials/${input.cred_name}`,
        ctx,
        undefined,
        requestBody,
        "POST",
        true,
      );

      if (response.ok) {
        return (await response.json()) as typeof SetCredentialsResponseSchema;
      } else {
        return (await response.json()) as typeof OSMOErrorResponseSchema;
      }
    } catch (e) {
      return {
        message: `Unknown error occured!\n ${e as string}`,
      } as OSMOErrorResponse;
    }
  }),
  deleteCredential: publicProcedure.input(DeleteCredentialRequestSchema).mutation(async ({ ctx, input }) => {
    try {
      const response = await OsmoApiFetch(
        `/api/credentials/${input.cred_name}`,
        ctx,
        undefined,
        undefined,
        "DELETE",
        true,
      );

      if (response.ok) {
        return (await response.json()) as typeof DeleteCredentialsResponseSchema;
      } else {
        return (await response.json()) as typeof OSMOErrorResponseSchema;
      }
    } catch (e) {
      return {
        message: `Unknown error occured!\n ${e as string}`,
      } as OSMOErrorResponse;
    }
  }),
});
