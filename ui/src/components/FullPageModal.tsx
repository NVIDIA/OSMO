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
import { useEffect, useRef } from "react";

import { FocusTrap } from "focus-trap-react";

import { OutlinedIcon } from "~/components/Icon";

interface FullPageModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  headerChildren: React.ReactNode;
  onHeightChange?: (height: number) => void;
  size?: "none" | "sm" | "md" | "lg";
  onEscapeDeactivate?: () => boolean;
}

const FullPageModal = ({
  open,
  onClose,
  children,
  headerChildren,
  onHeightChange,
  size = "lg",
  onEscapeDeactivate,
}: FullPageModalProps) => {
  const modalContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (modalContentRef.current && typeof window !== "undefined") {
      const windowHeight = window.innerHeight;
      if (onHeightChange) {
        onHeightChange(windowHeight - modalContentRef.current.getBoundingClientRect().top - 26);
      }
    }
  }, [modalContentRef, onHeightChange]);

  return (
    <FocusTrap
      active={open}
      focusTrapOptions={{
        allowOutsideClick: true,
        clickOutsideDeactivates: true,
        escapeDeactivates: onEscapeDeactivate ?? true,
        onDeactivate: () => {
          onClose();
        },
      }}
    >
      <div className={`${open ? "fixed" : "hidden"} top-0 left-0 right-0 bottom-0 bg-black/20 z-30`}>
        <div className="p-3 w-full h-full flex items-center justify-center">
          <div
            className={`relative body-component ${size === "none" ? "" : size === "sm" ? "w-1/4 h-1/2" : size === "md" ? "w-1/2 h-3/4" : "w-full h-full"}`}
            aria-modal="true"
            role="dialog"
            tabIndex={0}
            autoFocus
          >
            <div className="flex flex-col h-full w-full">
              <div className="popup-header body-header">
                {headerChildren}
                <button
                  className="btn"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <OutlinedIcon name="close" />
                </button>
              </div>
              <div
                ref={modalContentRef}
                className="flex flex-col w-full h-full overflow-y-auto"
              >
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
};

export default FullPageModal;
