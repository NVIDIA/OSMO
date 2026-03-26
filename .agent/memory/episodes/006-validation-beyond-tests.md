# Episode 006: Validation Beyond Tests

## What happened
The harness required explicit beyond-tests validation after quality gates passed. The changed file (`ctrl_websocket.py`) has **zero test coverage** — no test references `ctrl_websocket`, `MetricsOptions`, or `update_metrics`.

## What I validated
1. **Semantic equivalence**: `model_fields_set` returns `set[str]`, same as v1 `__fields_set__`. Both return the internal set (not a copy). `.pop()` behavior is identical.
2. **Exact runtime pattern**: Reproduced the `MetricsOptions` model with its validator and both field types. Confirmed `getattr(opts, opts.model_fields_set.pop())` returns the correct nested model instance.
3. **Caller pattern**: Simulated the websocket handler's `MetricsOptions(**{metrictype: metric})` construction. `model_fields_set` correctly tracks only the explicitly-set field.
4. **Deprecation confirmed**: `__fields_set__` still works in Pydantic 2.12.5 via compat layer (emits `PydanticDeprecatedSince20` warning), confirming our change is a forward migration, not a bugfix.
5. **No other v1 patterns**: Exhaustive grep for all known v1 deprecated attributes found zero matches.

## Key insight
The change was necessary for v3 forward-compatibility, not for v2 correctness. The old code would still work with a deprecation warning. But the migration task specifically asks to move to v2 patterns, so this is the right change.

## Lesson
When a changed file has no test coverage, runtime simulation of the exact code pattern is essential. py_compile and ruff only catch syntax/style issues, not semantic correctness.
