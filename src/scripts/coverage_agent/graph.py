# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""LangGraph state graph builder and routing functions for the coverage agent pipeline."""

import logging

try:
    from langgraph.graph import END, StateGraph
except ImportError:
    END = None
    StateGraph = None

from coverage_agent.nodes.analyze import analyze_coverage
from coverage_agent.nodes.create_pr import create_pr
from coverage_agent.nodes.review import review_test
from coverage_agent.nodes.validate import validate_test
from coverage_agent.nodes.write import write_test
from coverage_agent.state import CoverageState

logger = logging.getLogger(__name__)


def route_analyze(state: CoverageState) -> str:
    """Route after analysis: skip to done if no targets found."""
    if state["targets"]:
        return "write_test"
    return "done"


def route_validation(state: CoverageState) -> str:
    """Route after test validation: retry, skip, or proceed to review."""
    if state["validation_passed"]:
        return "review"

    if state["retry_count"] >= state["max_retries"]:
        # After skip transition, check if we're past all targets
        if state["current_index"] >= len(state["targets"]) - 1:
            return "done"
        return "skip"

    return "retry"


def route_review(state: CoverageState) -> str:
    """Route after quality review: next target, retry, skip, or done."""
    if state["review_passed"]:
        if state["current_index"] >= len(state["targets"]) - 1:
            return "done"
        return "next"

    if state["retry_count"] >= state["max_retries"]:
        if state["current_index"] >= len(state["targets"]) - 1:
            return "done"
        return "skip"

    return "retry"


def route_done(state: CoverageState) -> str:
    """Route at the end: create PR if files were generated, abort otherwise."""
    if state["generated_files"]:
        return "create_pr"
    return "abort"


def _advance_target(state: CoverageState) -> CoverageState:
    """Transition helper: move to next target, reset retry count."""
    return {**state, "current_index": state["current_index"] + 1, "retry_count": 0}


def _increment_retry(state: CoverageState) -> CoverageState:
    """Transition helper: increment retry count."""
    return {**state, "retry_count": state["retry_count"] + 1}


def build_graph():
    """Build the LangGraph StateGraph for the coverage agent pipeline."""
    if StateGraph is None:
        raise RuntimeError(
            "langgraph is not installed. Install it to use build_graph()."
        )

    def validate_with_transition(state: CoverageState) -> CoverageState:
        """Run validation, then apply transitions for retry/skip."""
        new_state = validate_test(state)
        route = route_validation(new_state)
        logger.info(
            "Validate route: %s (index=%d/%d, retry=%d/%d, passed=%s)",
            route, new_state["current_index"], len(new_state["targets"]),
            new_state["retry_count"], new_state["max_retries"],
            new_state["validation_passed"],
        )
        if route == "retry":
            return _increment_retry(new_state)
        if route == "skip":
            return _advance_target(new_state)
        return new_state

    def review_with_transition(state: CoverageState) -> CoverageState:
        """Run review, then apply transitions for retry/skip/next."""
        new_state = review_test(state)
        route = route_review(new_state)
        logger.info(
            "Review route: %s (index=%d/%d, retry=%d/%d, review=%s)",
            route, new_state["current_index"], len(new_state["targets"]),
            new_state["retry_count"], new_state["max_retries"],
            new_state["review_passed"],
        )
        if route == "retry":
            return _increment_retry(new_state)
        if route in ("skip", "next"):
            return _advance_target(new_state)
        return new_state

    graph = StateGraph(CoverageState)
    graph.add_node("analyze", analyze_coverage)
    graph.add_node("write_test", write_test)
    graph.add_node("validate", validate_with_transition)
    graph.add_node("review", review_with_transition)
    graph.add_node("create_pr", create_pr)

    graph.set_entry_point("analyze")
    graph.add_conditional_edges("analyze", route_analyze, {
        "write_test": "write_test",
        "done": END,
    })
    graph.add_edge("write_test", "validate")
    def done_check(state: CoverageState) -> CoverageState:
        """No-op node — just a routing point for done/abort decisions."""
        return state

    graph.add_node("done_check", done_check)

    graph.add_conditional_edges("validate", route_validation, {
        "retry": "write_test",
        "skip": "write_test",
        "done": "done_check",
        "review": "review",
    })
    graph.add_conditional_edges("review", route_review, {
        "retry": "write_test",
        "skip": "write_test",
        "next": "write_test",
        "done": "done_check",
    })
    graph.add_conditional_edges("done_check", route_done, {
        "create_pr": "create_pr",
        "abort": END,
    })
    graph.add_edge("create_pr", END)

    return graph.compile()
