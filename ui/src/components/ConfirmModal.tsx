//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.
//
//SPDX-License-Identifier: Apache-2.0
import FullPageModal from "~/components/FullPageModal";
import { OutlinedIcon } from "~/components/Icon";

interface ConfirmModalProps {
  open: boolean;
  title: React.ReactNode;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLoading?: boolean;
  size?: "none" | "sm" | "md" | "lg";
  ariaLabel?: string;
  children?: React.ReactNode;
}

const ConfirmModal = ({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  size = "none",
  ariaLabel,
  children,
}: ConfirmModalProps) => {
  return (
    <FullPageModal
      open={open}
      onClose={onCancel}
      headerChildren={title}
      size={size}
      aria-label={ariaLabel ?? (typeof title === "string" ? title : "Confirm")}
      role="alertdialog"
    >
      <div className="w-full h-full flex flex-col justify-between">
        <div className="flex flex-col gap-global p-global pb-10">
          {message ? <p>{message}</p> : null}
          {children}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
          >
            <OutlinedIcon name="close" />
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-primary h-8"
            onClick={onConfirm}
          >
            <OutlinedIcon name="check" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </FullPageModal>
  );
};

export default ConfirmModal;
