// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * LinkifiedText
 *
 * Renders plain message text with any URLs/emails turned into safe external
 * links. Used for operator-authored workflow warnings and policy error
 * messages, which may embed a help URL (e.g. a label-policy assert_message).
 *
 * Injection-safe: linkify-react only wraps detected links and escapes the
 * surrounding text — no dangerouslySetInnerHTML. Links inherit the ambient
 * text color (amber for warnings, red for errors) and only add an underline.
 */

import Linkify from "linkify-react";

const LINK_OPTIONS = {
  defaultProtocol: "https",
  target: "_blank",
  rel: "noopener noreferrer",
  className: "underline underline-offset-2 hover:opacity-80",
} as const;

export function LinkifiedText({ text }: { text: string }) {
  return <Linkify options={LINK_OPTIONS}>{text}</Linkify>;
}
