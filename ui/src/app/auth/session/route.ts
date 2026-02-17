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

// Returns the authenticated user from Envoy's x-osmo-user header.
// When OAuth2 Proxy is handling browser authentication, Envoy validates
// the session via ext_authz, sets the Authorization header with the
// ID token, and the JWT filter extracts the user claim into x-osmo-user.
// This endpoint lets the UI detect OAuth2 Proxy sessions without needing
// to extract JWTs from cookies.
export async function GET(request: Request) {
  const user = request.headers.get("x-osmo-user");
  if (user) {
    return new Response(JSON.stringify({ authenticated: true, user }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ authenticated: false }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
