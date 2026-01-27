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
import { useEffect, useRef, useState } from "react";

import { FocusTrap } from "focus-trap-react";

import { FilledIcon, OutlinedIcon } from "./Icon";

export const SlideOut = ({
  id,
  top = 0,
  left,
  open,
  onClose,
  header,
  children,
  headerClassName = "",
  className = "",
  bodyClassName = "",
  position = "right",
  canPin = false,
  pinned = false,
  onPinChange,
  paused = false,
  containerRef,
  heightOffset = 0,
  dimBackground = true,
  ...props
}: {
  id: string;
  top?: number;
  left?: number;
  open: boolean;
  onClose: () => void;
  header?: string | React.ReactNode;
  headerClassName?: string;
  bodyClassName?: string;
  position?: "right" | "left";
  canPin?: boolean;
  pinned?: boolean;
  onPinChange?: (pinned: boolean) => void;
  paused?: boolean;
  containerRef?: React.RefObject<HTMLDivElement>;
  heightOffset?: number;
  dimBackground?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) => {
  const isActivated = useRef(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    // This fixes the issue where the slideout does not unpause when another slideout is opened
    // It also fixes the slideout deactivating unpinned (the else)
    if (!isActivated.current) {
      setActive(open && !pinned && !paused);
    } else {
      setActive(open);
    }
  }, [open, pinned, paused]);

  return (
    <>
      {open && !pinned && (
        <div
          className={`fixed top-0 left-0 w-full h-full z-20 ${dimBackground ? "bg-black/20" : "bg-transparent"}`}
        ></div>
      )}
      <FocusTrap
        active={active}
        paused={pinned || paused}
        focusTrapOptions={{
          allowOutsideClick: true,
          clickOutsideDeactivates: true,
          escapeDeactivates: true,
          onDeactivate: () => {
            isActivated.current = false;
            console.info(id, "deactivated");
            onClose();
          },
          onPause: () => {
            console.info(id, "paused");
          },
          onPostPause: () => {
            console.info(id, "post paused");
          },
          onActivate: () => {
            console.info(id, "activated");
          },
          onPostActivate: () => {
            isActivated.current = true;
            console.info(id, "post activated");
          },
          onPostDeactivate: () => {
            console.info(id, "post deactivated");
          },
          onUnpause: () => {
            console.info(id, "unpaused");
          },
          onPostUnpause: () => {
            console.info(id, "post unpaused");
          },
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={header ? `${id}-header` : undefined}
          className={`text-left flex flex-col ${open ? "block" : "hidden"} ${pinned ? "relative" : "absolute z-30"} ${position === "right" ? "right-0" : "left-0"} body-component ${className}`}
          style={{
            top: top,
            left: left,
            maxHeight: `calc(100vh - ${top + heightOffset + (containerRef?.current?.getBoundingClientRect()?.top ?? 0)}px)`,
          }}
          {...props}
        >
          {header && (
            <div className={`popup-header ${headerClassName}`}>
              {typeof header === "string" ? <h2 id={`${id}-header`}>{header}</h2> : header}
              <div className="flex items-center gap-2">
                {canPin && onPinChange && (
                  <button
                    className="btn btn-action"
                    onClick={() => {
                      onPinChange(!pinned);
                    }}
                    title={pinned ? "Unpin" : "Pin"}
                  >
                    {pinned ? <FilledIcon name="push_pin" /> : <OutlinedIcon name="push_pin" />}
                  </button>
                )}
                <button
                  className="btn btn-action"
                  aria-label="Close"
                  onClick={() => {
                    onClose();
                  }}
                >
                  <OutlinedIcon name="close" />
                </button>
              </div>
            </div>
          )}
          <div className={`overflow-y-auto ${bodyClassName}`}>{children}</div>
        </div>
      </FocusTrap>
    </>
  );
};
