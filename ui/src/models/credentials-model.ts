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

export enum CredentialTypes {
  Data = "DATA",
  Generic = "GENERIC",
  Registry = "REGISTRY",
}

export const CredentialsRequestSchema = z.undefined();

export const CredentialListItemSchema = z.object({
  cred_name: z.string(),
  cred_type: z.nativeEnum(CredentialTypes),
  profile: z.string().nullable(),
});

export const CredentialsListResponseSchema = z.object({
  credentials: z.array(CredentialListItemSchema),
});

export const BaseSetCredentialRequestSchema = z.object({
  cred_name: z.string(),
});

export const RegistryCredentialSchema = z.object({
  registry_credential: z.object({
    registry: z.string(),
    username: z.string(),
    auth: z.string(),
  }),
});

export const DataCredentialSchema = z.object({
  data_credential: z.object({
    endpoint: z.string(),
    access_key_id: z.string(),
    access_key: z.string(),
    region: z.string(),
  }),
});

export const GenericCredentialSchema = z.object({
  generic_credential: z.object({
    credential: z.record(z.string()),
  }),
});

// Credentials can have three types - Generic, Registry and Data
export const SetCredentialRequestSchema = z.discriminatedUnion("type", [
  RegistryCredentialSchema.extend({
    type: z.literal(CredentialTypes.Registry),
  }).merge(BaseSetCredentialRequestSchema),
  DataCredentialSchema.extend({ type: z.literal(CredentialTypes.Data) }).merge(BaseSetCredentialRequestSchema),
  GenericCredentialSchema.extend({
    type: z.literal(CredentialTypes.Generic),
  }).merge(BaseSetCredentialRequestSchema),
]);

export const SetCredentialsResponseSchema = z.null();

export const DeleteCredentialRequestSchema = z.object({
  cred_name: z.string(),
});

export const DeleteCredentialsResponseSchema = CredentialsListResponseSchema;

export type CredentialsRequest = z.infer<typeof CredentialsRequestSchema>;
export type CredentialListItem = z.infer<typeof CredentialListItemSchema>;
export type RegistryCredential = z.infer<typeof RegistryCredentialSchema>;
export type DataCredential = z.infer<typeof DataCredentialSchema>;
export type GenericCredential = z.infer<typeof GenericCredentialSchema>;
export type SetCredentialsResponse = z.infer<typeof SetCredentialsResponseSchema>;
export type DeleteCredentialRequest = z.infer<typeof DeleteCredentialRequestSchema>;
export type DeleteCredentialsResponse = z.infer<typeof DeleteCredentialsResponseSchema>;
export type BaseSetCredentialRequest = z.infer<typeof BaseSetCredentialRequestSchema>;
export type SetCredentialRequest = z.infer<typeof SetCredentialRequestSchema>;
export type CredentialsListResponse = z.infer<typeof CredentialsListResponseSchema>;
