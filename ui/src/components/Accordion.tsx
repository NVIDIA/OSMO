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
import React from "react";

interface AccordionItemData {
  title?: string | React.ReactNode;
  ariaLabel?: string;
  content: React.ReactNode;
  slotLeft?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

interface AccordionItemProps extends AccordionItemData {
  isOpen: boolean;
  onToggle: () => void;
}

const AccordionItem: React.FC<AccordionItemProps> = ({
  title,
  ariaLabel,
  content,
  slotLeft,
  isOpen,
  onToggle,
  disabled = false,
  className = "",
}): React.ReactNode => {
  return (
    <div className={`w-full ${className}`}>
      <div className="flex flex-row gap-global justify-between items-end w-full">
        {slotLeft}
        <button
          className={`btn btn-tertiary p-1 min-h-auto ${slotLeft ? "" : "w-full"} text-left flex justify-between items-center ${disabled ? "hidden" : ""}`}
          onClick={onToggle}
          aria-expanded={isOpen}
          type="button"
          aria-label={ariaLabel ? ariaLabel : title ? undefined : "Expand"}
        >
          {title}
          <svg
            className={`w-5 h-5 transform transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      </div>
      {isOpen && <div className="overflow-hidden mt-3 transition-all duration-200 ease-in-out">{content}</div>}
    </div>
  );
};

interface AccordionProps {
  items: AccordionItemData[];
  openIndex: number;
  setOpenIndex: (index: number) => void;
  className?: string;
}

export const Accordion: React.FC<AccordionProps> = ({ items, openIndex, setOpenIndex, className = "" }) => {
  return (
    <div className={`w-full ${className}`}>
      {items.map((item, index) => (
        <AccordionItem
          key={index}
          {...item}
          isOpen={openIndex === index}
          onToggle={() => {
            setOpenIndex(openIndex === index ? -1 : index);
          }}
          className={item.className}
          ariaLabel={item.ariaLabel}
          title={item.title}
        />
      ))}
    </div>
  );
};

export default Accordion;
