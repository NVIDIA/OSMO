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
import { useMediaQuery } from "usehooks-ts";

import { FilledIcon, OutlinedIcon } from "./Icon";

export const SlideOut = ({
  id,
  top = 0,
  left,
  open,
  canClose = true,
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
  dimBackground = true,
  returnFocusOnDeactivate = true,
  ...props
}: {
  id: string;
  top?: number;
  left?: number;
  open: boolean;
  canClose?: boolean;
  onClose: () => void;
  header?: string | React.ReactNode;
  headerClassName?: string;
  bodyClassName?: string;
  position?: "right" | "left";
  canPin?: boolean;
  pinned?: boolean;
  onPinChange?: (pinned: boolean) => void;
  paused?: boolean;
  dimBackground?: boolean;
  returnFocusOnDeactivate?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) => {
  const allowPinning = useMediaQuery("(min-width: 1024px)");
  const isActivated = useRef(false);
  const [active, setActive] = useState(false);
  const localPinned = canPin ? pinned && allowPinning : pinned;

  useEffect(() => {
    // This fixes the issue where the slideout does not unpause when another slideout is opened
    // It also fixes the slideout deactivating unpinned (the else)
    if (!isActivated.current) {
      setActive(open && !localPinned && !paused);
    } else {
      setActive(open);
    }
  }, [open, localPinned, paused]);

  return (
    <>
      {open && !localPinned && (
        <div className={`fixed top-0 left-0 w-full h-full z-20 ${dimBackground ? "bg-black/10" : ""}`}></div>
      )}
      <FocusTrap
        active={active}
        paused={localPinned || paused}
        focusTrapOptions={{
          allowOutsideClick: true,
          clickOutsideDeactivates: true,
          escapeDeactivates: true,
          returnFocusOnDeactivate: returnFocusOnDeactivate,
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
          role={localPinned ? "region" : "dialog"}
          aria-live={localPinned ? "polite" : undefined}
          aria-modal={!localPinned}
          aria-labelledby={header ? `${id}-header` : undefined}
          className={`text-left flex flex-col ${open ? "block" : "hidden"} ${localPinned ? "relative" : "absolute z-30"} ${position === "right" ? "right-0" : "left-0"} body-component max-h-full ${dimBackground && !localPinned ? "shadow-xl shadow-black/50" : ""} ${className}`}
          style={{
            top: top,
            left: left,
          }}
          {...props}
        >
          {header && (
            <div className={`popup-header ${headerClassName}`}>
              {typeof header === "string" ? <h2 id={`${id}-header`}>{header}</h2> : header}
              <div className="flex items-center gap-global">
                {canPin && onPinChange && allowPinning && (
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
                {canClose && (
                  <button
                    className="btn btn-action"
                    aria-label="Close"
                    onClick={() => {
                      onClose();
                    }}
                  >
                    <OutlinedIcon name="close" />
                  </button>
                )}
              </div>
            </div>
          )}
          <div className={`overflow-y-auto ${bodyClassName}`}>{children}</div>
        </div>
      </FocusTrap>
    </>
  );
};
