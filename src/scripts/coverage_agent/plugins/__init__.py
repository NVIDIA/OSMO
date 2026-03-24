# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from coverage_agent.plugins.base import GeneratedTest, ValidationResult, WriterPlugin

PLUGINS: dict[str, type[WriterPlugin]] = {}


def register_plugin(name: str, plugin_class: type[WriterPlugin]) -> None:
    PLUGINS[name] = plugin_class


def get_writer(provider: str) -> WriterPlugin:
    if provider not in PLUGINS:
        raise KeyError(f"Unknown provider: {provider}. Available: {list(PLUGINS.keys())}")
    return PLUGINS[provider]()


def _register_defaults() -> None:
    """Lazily register built-in plugins to avoid import-time deps on langchain/openai."""
    if PLUGINS:
        return
    from coverage_agent.plugins.nemotron import NemotronWriter
    from coverage_agent.plugins.claude_code import ClaudeCodeWriter
    from coverage_agent.plugins.openai_writer import OpenAIWriter

    register_plugin("nemotron", NemotronWriter)
    register_plugin("claude-code", ClaudeCodeWriter)
    register_plugin("openai", OpenAIWriter)
