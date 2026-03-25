# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""OpenAI-based test writer plugin."""

import logging
import os
from typing import Optional

try:
    from langchain_openai import ChatOpenAI
except ImportError:
    ChatOpenAI = None

from coverage_agent.plugins.base import GeneratedTest, ValidationResult, WriterPlugin
from coverage_agent.plugins.nemotron import NemotronWriter
from coverage_agent.prompts.go_test import GO_TEST_SYSTEM_PROMPT, build_go_prompt
from coverage_agent.prompts.python_test import PYTHON_TEST_SYSTEM_PROMPT, build_python_prompt
from coverage_agent.prompts.ui_test import UI_TEST_SYSTEM_PROMPT, build_ui_prompt
from coverage_agent.tools.file_ops import read_file, write_file
from coverage_agent.tools.shell import run_shell

logger = logging.getLogger(__name__)


class OpenAIWriter(NemotronWriter):
    """Test writer using OpenAI models via ChatOpenAI.

    Shares the same tool-calling pattern as NemotronWriter,
    just uses a different LLM backend.
    """

    def __init__(self):
        if ChatOpenAI is None:
            logger.warning(
                "langchain-openai not installed."
                " OpenAIWriter will not work.",
            )
            self.llm = None
            return
        self.llm = ChatOpenAI(
            model=os.getenv("OPENAI_MODEL", "gpt-4o"),
        )
