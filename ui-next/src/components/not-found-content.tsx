// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NotFoundContent() {
  const router = useRouter();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      {/* Decorative background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/4 left-1/2 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-gradient-to-br from-[#76b900]/8 via-transparent to-transparent blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center">
        {/* OSMO acronym as 404 message */}
        <div className="mb-2 flex items-baseline gap-1">
          <span className="text-4xl font-black text-[#76b900] sm:text-5xl">O</span>
          <span className="text-4xl font-black text-zinc-300 dark:text-zinc-700 sm:text-5xl">ur</span>
          <span className="ml-3 text-4xl font-black text-[#76b900] sm:text-5xl">S</span>
          <span className="text-4xl font-black text-zinc-300 dark:text-zinc-700 sm:text-5xl">erver</span>
        </div>
        <div className="mb-6 flex items-baseline gap-1">
          <span className="text-4xl font-black text-[#76b900] sm:text-5xl">M</span>
          <span className="text-4xl font-black text-zinc-300 dark:text-zinc-700 sm:text-5xl">issed</span>
          <span className="ml-3 text-4xl font-black text-[#76b900] sm:text-5xl">O</span>
          <span className="text-4xl font-black text-zinc-300 dark:text-zinc-700 sm:text-5xl">ne...</span>
        </div>

        {/* 404 badge */}
        <div className="mb-5 rounded-full bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          Error 404
        </div>

        {/* Message */}
        <p className="mb-6 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        {/* Actions */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            asChild
            size="sm"
            variant="default"
            className="gap-1.5 bg-[#76b900] hover:bg-[#5a8c00]"
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
