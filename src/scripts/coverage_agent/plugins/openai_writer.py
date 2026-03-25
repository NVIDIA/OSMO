# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""OpenAI-based test writer plugin."""

import logging
import os

from coverage_agent.plugins.nemotron import NemotronWriter

try:
    from langchain_openai import ChatOpenAI
except ImportError:
    ChatOpenAI = None

logger = logging.getLogger(__name__)


class OpenAIWriter(NemotronWriter):
    """Test writer using OpenAI models via ChatOpenAI. Same pattern as NemotronWriter."""

    def __init__(self):
        super().__init__()
        if ChatOpenAI is None:
            logger.warning("langchain-openai not installed. OpenAIWriter will not work.")
            self.llm = None
            return
        self.llm = ChatOpenAI(model=os.getenv("OPENAI_MODEL", "gpt-4o"))
