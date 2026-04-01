# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Prompt templates for test generation by language and framework."""


def escape_fenced_content(content: str) -> str:
    """Escape triple backtick sequences in content that will be embedded inside markdown fences.

    Replaces ``` with the zero-width space escaped variant so the
    content cannot close an outer triple-backtick fence early.
    """
    return content.replace("```", "``\u200b`")
