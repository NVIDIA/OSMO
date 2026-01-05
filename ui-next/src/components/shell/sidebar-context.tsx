"use client";

import { createContext, useContext } from "react";
import { usePersistedBoolean } from "@/hooks";

interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = usePersistedBoolean("sidebar-collapsed", false);

  const toggle = () => setCollapsed(!collapsed);

  return <SidebarContext.Provider value={{ collapsed, setCollapsed, toggle }}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}
