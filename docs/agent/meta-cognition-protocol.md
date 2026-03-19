# Meta-Cognition Protocol

When and how the agent should monitor its own effectiveness.

## Detection Triggers

Run `scripts/agent/meta-check.sh` periodically (or agents can self-check against these rules).

### Spinning Detection
- **Same tool call 3x with same arguments**: Stop. The approach isn't working.
- **More than 5 iterations on same file without progress**: Step back and reconsider.
- **Build/test failing with same error after 3 fix attempts**: The fix is wrong. Re-read the error.

### Time Budget
- **Simple bug fix**: If not resolved in 30 minutes, escalate or ask for help.
- **Feature implementation**: If no file has been successfully modified in 20 minutes, re-read the decision tree.
- **Cross-service change**: If downstream verification fails after 3 attempts, check cross-service-impact.md.

### Drift Detection
- **Working on a file not mentioned in the original task**: Pause. Is this necessary or scope creep?
- **More than 10 files modified**: Pause. Is this change too broad?
- **Changing test expectations instead of fixing code**: This is almost always wrong.

## Response Actions

When a trigger fires:

| Trigger | Action |
|---------|--------|
| Spinning on same approach | Try a fundamentally different approach (different algorithm, different file, different API) |
| Time budget exceeded | Save progress, document what was tried, escalate to human |
| Build error persists | Re-read the error message literally. Check if the error is in a DIFFERENT file than you're editing. |
| Test failure persists | Read the test carefully. The test might be testing the wrong thing, or you might be misunderstanding what it expects. |
| Scope creep detected | Revert to the original task description. Complete the narrow task first. |
| Too many files changed | Split into smaller commits. Consider if the change should be broken into separate tasks. |

## Sub-Agent Delegation

When the current approach is stuck, consider delegation:

- **"I need to understand how module X works"**: Delegate to an exploration sub-agent with fresh context
- **"I need to implement changes in 3 independent services"**: Delegate to parallel sub-agents, one per service
- **"I need to verify my change doesn't break other services"**: Delegate to a verification sub-agent

Sub-agents get fresh, small context — they're more effective than continuing with accumulated, possibly confused context.

## Self-Assessment Questions

Before declaring a task complete:

1. Did I actually verify the change works (ran tests, not just claimed they pass)?
2. Did I check for downstream impact on other services?
3. Did I follow the coding standards for this language/service?
4. Is my change the simplest solution, or did I over-engineer?
5. Would I be confident if a human reviewed this change?
