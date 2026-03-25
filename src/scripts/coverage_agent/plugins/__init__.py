# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Writer plugin registry and discovery."""

from coverage_agent.plugins.base import (
    GeneratedTest,
    TestType,
    ValidationResult,
    WriterPlugin,
    detect_test_type,
    determine_test_path,
    file_path_to_bazel_package,
)
from coverage_agent.plugins.claude_code import ClaudeCodeWriter
from coverage_agent.plugins.nemotron import NemotronWriter
from coverage_agent.plugins.openai_writer import OpenAIWriter

PLUGINS: dict[str, type[WriterPlugin]] = {}
_instances: dict[str, WriterPlugin] = {}


def register_plugin(name: str, plugin_class: type[WriterPlugin]) -> None:
    PLUGINS[name] = plugin_class


def get_writer(provider: str) -> WriterPlugin:
    """Return a cached plugin instance for the given provider."""
    if provider not in PLUGINS:
        raise KeyError(
            f"Unknown provider: {provider}. "
            f"Available: {list(PLUGINS.keys())}"
        )
    if provider not in _instances:
        _instances[provider] = PLUGINS[provider]()
    return _instances[provider]


def _register_defaults() -> None:
    """Register built-in plugins."""
    if PLUGINS:
        return
    register_plugin("nemotron", NemotronWriter)
    register_plugin("claude-code", ClaudeCodeWriter)
    register_plugin("openai", OpenAIWriter)
