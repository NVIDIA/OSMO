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
export type InlineBannerStatus = "error" | "warning" | "info" | "success" | "none";

export const InlineBanner = ({
  children,
  status,
  className,
}: {
  children: React.ReactNode;
  status: InlineBannerStatus;
  className?: string;
}) => {
  const statusColor = {
    error: "bg-red-100 border-l-4 border-l-red-400",
    warning: "bg-yellow-100 border-l-4 border-l-yellow-400",
    info: "bg-blue-100 border-l-4 border-l-blue-400",
    success: "bg-green-100 border-l-4 border-l-green-400",
    none: "",
  };

  const statusIcon = {
    error: "🚫",
    warning: "⚠️",
    info: "ℹ️",
    success: "✅",
    none: undefined,
  };

  return (
    <div
      className={`flex items-center gap-3 ${statusColor[status]} p-2 min-h-10 ${className}`}
      aria-live="polite"
    >
      {statusIcon[status] && <span>{statusIcon[status]}</span>}
      {children}
    </div>
  );
};
