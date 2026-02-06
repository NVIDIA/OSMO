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
import { FocusTrap } from "focus-trap-react";

import { OutlinedIcon } from "~/components/Icon";

interface FullPageModalProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  headerChildren: React.ReactNode;
  size?: "none" | "sm" | "md" | "lg";
}

const FullPageModal = ({ open, onClose, children, headerChildren, size = "lg", ...props }: FullPageModalProps) => {
  return (
    <div
      className={`${open ? "fixed" : "hidden"} top-0 left-0 right-0 bottom-0 bg-black/10 z-30`}
      onClick={() => {
        onClose();
      }}
    >
      <div className="p-global w-full h-full flex items-center justify-center">
        <FocusTrap
          active={open}
          focusTrapOptions={{
            allowOutsideClick: true,
            clickOutsideDeactivates: true,
            escapeDeactivates: true,
            onDeactivate: () => {
              onClose();
            },
          }}
        >
          <div
            className={`flex flex-col body-component shadow-xl shadow-black/50 ${size === "md" ? "md:w-1/2" : size === "sm" ? "md:w-1/4" : ""} max-h-[96vh] max-w-[96vw]`}
            aria-modal="true"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
            {...props}
          >
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
            <div className="flex flex-col w-full h-full overflow-auto">{children}</div>
          </div>
        </FocusTrap>
      </div>
    </div>
  );
};

export default FullPageModal;
