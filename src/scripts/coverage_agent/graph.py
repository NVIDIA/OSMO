# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import logging

from coverage_agent.state import CoverageState

logger = logging.getLogger(__name__)

# Routing functions are pure functions of state — no side effects, easy to test.


def route_validation(state: CoverageState) -> str:
    """Route after test validation: retry, skip, next target, or done.

    This function serves double duty: it's called inside validate_with_transition
    to decide which transition to apply, AND by LangGraph as the conditional edge
    router (on the already-transitioned state). The bounds check at the top handles
    the case where _advance_target has already pushed current_index past the last target.
    """
    if state["current_index"] >= len(state["targets"]):
        return "done"

    if state["validation_passed"]:
        if state["current_index"] >= len(state["targets"]) - 1:
            return "done"
        return "next"

    if state["retry_count"] >= state["max_retries"]:
        return "skip"

    return "retry"


def route_analyze(state: CoverageState) -> str:
    """Route after analysis: skip to quality gate if no targets found."""
    if state["targets"]:
        return "write_test"
    return "quality_gate"


def route_quality(state: CoverageState) -> str:
    """Route after quality gate: create PR or abort."""
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
    """Build the LangGraph StateGraph for the coverage agent pipeline.

    Requires langgraph to be installed. Import is deferred so that tests of
    routing functions can run without the langgraph dependency.
    """
    from langgraph.graph import END, StateGraph

    from coverage_agent.nodes.analyze import analyze_coverage
    from coverage_agent.nodes.create_pr import create_pr
    from coverage_agent.nodes.quality_gate import quality_gate
    from coverage_agent.nodes.validate import validate_test
    from coverage_agent.nodes.write import write_test

    def validate_with_transition(state: CoverageState) -> CoverageState:
        """Run validation, then apply state transitions based on routing."""
        new_state = validate_test(state)
        route = route_validation(new_state)
        logger.info(
            "Route decision: %s (index=%d/%d, retry=%d/%d, passed=%s)",
            route, new_state["current_index"], len(new_state["targets"]),
            new_state["retry_count"], new_state["max_retries"],
            new_state["validation_passed"],
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
    graph.add_node("quality_gate", quality_gate)
    graph.add_node("create_pr", create_pr)

    graph.set_entry_point("analyze")
    graph.add_conditional_edges(
        "analyze",
        route_analyze,
        {
            "write_test": "write_test",
            "quality_gate": "quality_gate",
        },
    )
    graph.add_edge("write_test", "validate")
    graph.add_conditional_edges(
        "validate",
        route_validation,
        {
            "retry": "write_test",
            "skip": "write_test",
            "next": "write_test",
            "done": "quality_gate",
        },
    )
    graph.add_conditional_edges(
        "quality_gate",
        route_quality,
        {
            "create_pr": "create_pr",
            "abort": END,
        },
    )
    graph.add_edge("create_pr", END)

    return graph.compile()
