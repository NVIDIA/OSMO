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
"use client";

import { useEffect, useRef, useState } from "react";

import { useWindowSize } from "usehooks-ts";

export default function SpecViewer({ url, title }: { url?: string; title: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const windowSize = useWindowSize();
  const [scrollerHeight, setScrollerHeight] = useState(0);

  useEffect(() => {
    if (iframeRef?.current) {
      let height = windowSize.height - iframeRef.current.getBoundingClientRect().top - 12;
      if (height < 200) {
        height = 200;
      }

      setScrollerHeight(height);
    }
  }, [windowSize.height, iframeRef]);

  return (
    <iframe
      height={scrollerHeight}
      width="100%"
      src={url}
      ref={iframeRef}
      title={title}
    />
  );
}
