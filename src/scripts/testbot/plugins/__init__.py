# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""LLM provider registry and discovery."""

from testbot.plugins.base import (
    GeneratedTest,
    TestType,
    ValidationResult,
    LLMProvider,
    detect_test_type,
    determine_test_path,
    file_path_to_bazel_package,
)
from testbot.plugins.llm_client import LLMClient

PLUGINS: dict[str, type[LLMProvider]] = {}
_instances: dict[str, LLMProvider] = {}


def register_plugin(name: str, plugin_class: type[LLMProvider]) -> None:
    """Register a plugin class under a provider name."""
    PLUGINS[name] = plugin_class


def get_llm(provider: str) -> LLMProvider:
    """Return a cached plugin instance for the given provider."""
    if provider not in PLUGINS:
        raise KeyError(
            f"Unknown provider: {provider}. "
            f"Available: {list(PLUGINS.keys())}"
        )
    if provider not in _instances:
        _instances[provider] = PLUGINS[provider](provider=provider)
    return _instances[provider]


def _register_defaults() -> None:
    """Register built-in provider presets (all backed by LLMClient)."""
    if PLUGINS:
        return
    register_plugin("nemotron", LLMClient)
    register_plugin("claude", LLMClient)
