//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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

"use client";

import { useActiveSection } from "@/hooks/use-active-section";
import { cn } from "@/lib/utils";
import { User, Bell, Database, Server, Key } from "lucide-react";

interface NavSection {
  id: string;
  label: string;
  icon: React.ElementType;
}

const NAV_SECTIONS: NavSection[] = [
  { id: "user-info", label: "User Information", icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "pools", label: "Pools", icon: Server },
  { id: "buckets", label: "Data Buckets", icon: Database },
  { id: "credentials", label: "Credentials", icon: Key },
];

const NAV_SECTION_IDS = NAV_SECTIONS.map((s) => s.id);

export function ProfileNavigation() {
  const { activeSection, scrollToSection } = useActiveSection(NAV_SECTION_IDS);

  return (
    <nav className="sticky top-8 w-52 shrink-0 self-start">
      <div className="space-y-1">
        {NAV_SECTIONS.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;

          return (
            <button
              key={section.id}
              type="button"
              onClick={() => scrollToSection(section.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                "hover:bg-accent",
                isActive && "bg-accent text-foreground font-medium",
                !isActive && "text-muted-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{section.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
