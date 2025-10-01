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
import { type NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Check if the path starts with /collections
  if (pathname.startsWith("/collections")) {
    // Replace only the first occurrence of "/collections" with "/datasets"
    const newPath = pathname.replace("/collections", "/datasets");
    const newUrl = new URL(newPath + search, request.url);

    // Use permanent redirect (308) for SEO and caching benefits
    return NextResponse.redirect(newUrl, 308);
  }

  // Check if the path matches /datasets/[bucket]/[name]/collections pattern
  const datasetsBucketNameCollectionsMatch = pathname.match(/^\/datasets\/([^\/]+)\/([^\/]+)\/collections$/);
  if (datasetsBucketNameCollectionsMatch) {
    const bucket = datasetsBucketNameCollectionsMatch[1];
    const name = datasetsBucketNameCollectionsMatch[2];
    const newUrl = new URL(`/datasets/${bucket}/${name}?showVersions=true`, request.url);

    // Use permanent redirect (308) for SEO and caching benefits
    return NextResponse.redirect(newUrl, 308);
  }

  // Check if the path matches /datasets/[bucket]/[name]/metadata pattern
  const datasetsBucketNameMetadataMatch = pathname.match(/^\/datasets\/([^\/]+)\/([^\/]+)\/metadata$/);
  if (datasetsBucketNameMetadataMatch) {
    const bucket = datasetsBucketNameMetadataMatch[1];
    const name = datasetsBucketNameMetadataMatch[2];
    const newUrl = new URL(`/datasets/${bucket}/${name}?showVersions=false&tool=metadata`, request.url);

    // Use permanent redirect (308) for SEO and caching benefits
    return NextResponse.redirect(newUrl, 308);
  }

  // Check if the path matches /datasets/[bucket] pattern
  const datasetsBucketMatch = pathname.match(/^\/datasets\/([^\/]+)$/);
  if (datasetsBucketMatch) {
    const bucket = datasetsBucketMatch[1];
    const newUrl = new URL(`/datasets?buckets=${bucket}&AllUsers=true`, request.url);

    // Use permanent redirect (308) for SEO and caching benefits
    return NextResponse.redirect(newUrl, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/collections",
    "/collections/(.*)",
    "/datasets/(.*)"
  ],
};
