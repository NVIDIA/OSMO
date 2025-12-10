"""
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
"""

import argparse
import re


class RstStrippingHelpFormatter(argparse.RawTextHelpFormatter):
    """Formatter that strips RST directives from epilog for terminal output."""

    # Pattern to match RST directives like .. note::, .. warning::, .. image::, etc.
    # Matches the directive line and any indented continuation lines (options like :align:)
    RST_DIRECTIVE_PATTERN = re.compile(
        r'^\.\.\s+\w+::.*\n(?:[ \t]+.*\n)*',
        re.MULTILINE
    )

    def _format_text(self, text: str) -> str:
        """Format text, stripping RST directive lines."""
        text = self.RST_DIRECTIVE_PATTERN.sub('', text)
        return super()._format_text(text)
