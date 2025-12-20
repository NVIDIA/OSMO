"use client";

import { useGetVersionApiVersionGet } from "@/lib/api/generated";
import { Button } from "@/components/ui/button";

// Version type - not in OpenAPI spec so we define it locally
interface Version {
  major: string;
  minor: string;
  revision: string;
  hash?: string;
}

export default function Home() {
  const { data, isLoading, error, refetch } = useGetVersionApiVersionGet();

  // Cast to proper type (backend doesn't document response in OpenAPI)
  const version = data as Version | undefined;

  const formatVersion = (v: Version | undefined) =>
    v ? `${v.major}.${v.minor}.${v.revision}` : "";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-950 text-zinc-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">OSMO UI Next</h1>
        <p className="mt-2 text-zinc-400">
          Connected to:{" "}
          <code className="rounded bg-zinc-800 px-2 py-1 text-sm text-emerald-400">
            {process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME || "fernandol-dev.osmo.nvidia.com"}
          </code>
        </p>
      </div>

      <div className="flex flex-col items-center gap-4">
        <Button
          onClick={() => refetch()}
          disabled={isLoading}
          className="min-w-[200px]"
        >
          {isLoading ? "Loading..." : "Refresh Version"}
        </Button>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center min-w-[300px]">
          {isLoading ? (
            <p className="text-zinc-400">Connecting...</p>
          ) : error ? (
            <div className="text-red-400">
              <p className="font-medium">Connection Failed</p>
              <p className="text-sm">{error instanceof Error ? error.message : "Unknown error"}</p>
            </div>
          ) : version ? (
            <div className="text-emerald-400">
              <p className="font-medium">✓ Connected via OpenAPI Codegen</p>
              <p className="mt-2 text-sm text-zinc-400">
                Version: <span className="text-zinc-100">{formatVersion(version)}</span>
              </p>
              {version.hash && (
                <p className="text-sm text-zinc-400">
                  SHA: <span className="font-mono text-zinc-100">{version.hash}</span>
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-8 text-center text-sm text-zinc-500">
        <p>Using orval-generated TanStack Query hooks</p>
        <p>Next.js 16 • React 19 • Tailwind 4</p>
      </div>
    </div>
  );
}
