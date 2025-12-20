import { Cpu } from "lucide-react";

interface PlatformChipsProps {
  platforms: string[];
}

export function PlatformChips({ platforms }: PlatformChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {platforms.map((platform) => (
        <div
          key={platform}
          className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <Cpu className="h-3.5 w-3.5 text-zinc-400" />
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {platform}
          </span>
        </div>
      ))}
    </div>
  );
}

