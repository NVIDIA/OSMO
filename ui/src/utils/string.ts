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
import { type Row } from "@tanstack/react-table";

/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
*/

export const convertToTimestamp = (timestamp?: string | null): Date | undefined => {
  if (!timestamp) {
    return undefined;
  }

  try {
    let normalizedTimestamp = timestamp;
    // Convert +00:00 or .sss+00:00 to Z
    normalizedTimestamp = normalizedTimestamp.replace(/([0-9]{2}:[0-9]{2})(\.[0-9]+)?\+00:00$/, (match, p1, p2) => (p2 ? p1 + p2 : p1) + 'Z');
    // If it still doesn't end with Z, append Z
    if (!normalizedTimestamp.endsWith('Z')) {
      normalizedTimestamp += 'Z';
    }
    const date = new Date(normalizedTimestamp);
    if (isNaN(date.getTime())) {
      return undefined;
    }
    return date;
  } catch (_error) {
    return undefined;
  }
};

export const convertToReadableTimezone = (timestamp?: string | null): string | undefined => {
  const date = convertToTimestamp(timestamp);
  if (!date || isNaN(date.getTime())) {
    return "N/A";
  }

  const options: Intl.DateTimeFormatOptions = {
    year: "2-digit",
    month: "2-digit",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };

  // Convert to readable format
  const formattedDate = date.toLocaleString("en-US", options);
  return `${formattedDate}`;
};

export const calcDuration = (start?: string | null, end?: string | null): string | undefined => {
  if (!start) {
    return undefined;
  }

  const startDate = convertToTimestamp(start);
  if (!startDate) {
    return undefined;
  }

  const endDate = end ? convertToTimestamp(end) : new Date();
  if (!endDate) {
    return undefined;
  }

  const duration = (endDate.getTime() - startDate.getTime()) / 1000;
  if (isNaN(duration)) {
    return undefined;
  }

  return convertSeconds(duration);
};

export const convertBytes = (bytes: number): string => {
  if (bytes === 0) {
    return "0.00 B";
  }

  const e = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, e)).toFixed(2) + " " + "BKMGTP".charAt(e) + (e > 0 ? "b" : "");
};

export const convertSeconds = (inputSeconds: number): string => {
  const numSeconds = Number(inputSeconds);
  // Check for negative input
  if (numSeconds < 0) {
    return "Invalid input: Negative value";
  }

  let seconds = Math.floor(numSeconds); // Truncates decimals

  const days = Math.floor(seconds / 86400);
  seconds -= days * 86400;

  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;

  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;

  let timeString = "";

  if (days > 0) {
    timeString += `${days}d`;
    if (hours > 0) {
      timeString += `${hours}h`;
    }
  } else if (hours > 0) {
    timeString += `${hours}h`;
    if (minutes > 0) {
      timeString += `${minutes}m`;
    }
  } else if (minutes > 0) {
    timeString += `${minutes}m`;
    if (seconds > 0) {
      timeString += `${seconds}s`;
    }
  } else {
    timeString = `${seconds}s`;
  }

  return timeString;
};

export const sortDateWithNA = <T>(rowA: Row<T>, rowB: Row<T>, columnId: string): number => {
  function compareBasic(a?: Date, b?: Date) {
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    return a === b ? 0 : a > b ? 1 : -1;
  }

  const dateA = rowA.getValue<Date>(columnId) ?? undefined;
  const dateB = rowB.getValue<Date>(columnId) ?? undefined;

  return compareBasic(dateA, dateB);
};

export const ZERO_WIDTH_SPACE = "\u200B";
const BREAKING_CHARACTERS = [" ", "-", "?", ZERO_WIDTH_SPACE];

export const breakIntoParts = (name: string, breakingCharacters = BREAKING_CHARACTERS) => {
  const parts: string[] = [];
  let currentPart = "";

  for (const char of name) {
    if (breakingCharacters.includes(char)) {
      if (currentPart) {
        parts.push(currentPart);
        currentPart = "";
      }
      parts.push(char);
    } else {
      currentPart += char;
    }
  }

  if (currentPart) {
    parts.push(currentPart);
  }

  return parts;
};

export const formatForWrapping = (name: string) => {
  const parts = breakIntoParts(name);

  const updatedParts = parts.map((part) => {
    // Add a zero-width space after each underscore and @ to allow a line break
    let wrappedName = part.replaceAll("_", `_${ZERO_WIDTH_SPACE}`);
    wrappedName = wrappedName.replaceAll("@", `@${ZERO_WIDTH_SPACE}`);

    // Add a zero-width space every 20 characters IF the part is longer than 20 characters
    const subSections = breakIntoParts(wrappedName, ["_", "@"]);
    const updatedSubSections = subSections.map((subSection) => {
      return subSection.match(/.{1,20}/g)?.join(ZERO_WIDTH_SPACE) ?? subSection;
    });
    return updatedSubSections.join("");
  });

  return updatedParts.join("").replaceAll(`${ZERO_WIDTH_SPACE}${ZERO_WIDTH_SPACE}`, ZERO_WIDTH_SPACE);
};
