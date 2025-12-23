import { Sidebar } from "./sidebar";
import { Header } from "./header";

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-950">
      {/* Skip to main content link - WCAG 2.1 bypass block */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:m-2 focus:rounded-md focus:bg-[var(--nvidia-green)] focus:px-4 focus:py-2 focus:text-black focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Sidebar */}
      <Sidebar />

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <Header />

        {/* Content */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-auto bg-zinc-50 p-6 dark:bg-zinc-900"
          aria-label="Main content"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
