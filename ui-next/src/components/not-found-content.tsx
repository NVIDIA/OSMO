// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/shadcn/button";

export function NotFoundContent() {
  const router = useRouter();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      {/* Decorative background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/4 left-1/2 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-gradient-to-br from-[var(--nvidia-green)]/8 via-transparent to-transparent blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center">
        {/* 404 - prominent */}
        <h1 className="text-6xl font-black text-[var(--nvidia-green)] sm:text-7xl">404</h1>

        {/* OSMO acronym subtitle */}
        <p className="mt-2 mb-6 text-2xl text-zinc-400 sm:text-3xl dark:text-zinc-500">
          <span className="font-bold text-[var(--nvidia-green)]">O</span>ur{" "}
          <span className="font-bold text-[var(--nvidia-green)]">S</span>erver{" "}
          <span className="font-bold text-[var(--nvidia-green)]">M</span>issed{" "}
          <span className="font-bold text-[var(--nvidia-green)]">O</span>ne...
        </p>

        {/* Message */}
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          The page you&apos;re looking for doesn&apos;t exist
          <br />
          or has been moved.
        </p>

        {/* Actions */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            asChild
            size="sm"
            variant="default"
            className="gap-1.5 bg-[var(--nvidia-green)] hover:bg-[var(--nvidia-green-dark)]"
          >
            <Link href="/">
              <Home className="h-3.5 w-3.5" />
              Dashboard
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Go Back
          </Button>
        </div>
      </div>
    </div>
  );
}
