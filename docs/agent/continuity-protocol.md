# Continuity Protocol

Convention for persisting progress across agent sessions.

## Progress File

**Location**: `.agent-progress.json` in repo root (gitignored)

**Schema**:
```json
{
  "task": "Short description of the current task",
  "status": "in_progress | completed | blocked",
  "started": "2026-03-19T10:00:00Z",
  "updated": "2026-03-19T14:30:00Z",
  "steps": [
    {
      "name": "Step description",
      "status": "done | in_progress | todo",
      "files": ["src/service/core/workflow/submit.py"],
      "notes": "Any relevant context for next session"
    }
  ],
  "blockers": ["Description of any blockers"],
  "context_for_next_session": "What the next session needs to know to continue"
}
```

## Session Startup Protocol

When starting a new session on an in-progress task:

1. Run `scripts/agent/load-progress.sh` — outputs saved state
2. Read the progress file to understand: what's done, what's next, any blockers
3. Check `git log --oneline -10` — verify progress file matches actual git state
4. Check `git status` — any uncommitted work from previous session?
5. Continue from where the last session left off

## Session End Protocol

Before ending a session:

1. Run `scripts/agent/save-progress.sh` — captures current state
2. Verify the progress file accurately reflects what was done
3. Make descriptive git commits (these serve as durable progress log)
4. Write `context_for_next_session` — what the next agent needs to know

## Rules

- **Progress file is supplementary to git.** Git commits are the source of truth. The progress file adds context that commits don't capture (intent, blockers, next steps).
- **Never trust stale progress files.** If the progress file says "in_progress" but git shows the work was completed, trust git.
- **Write for a stranger.** The next session may be a different agent or the same agent with no memory. Write as if explaining to someone new.
- **Keep it brief.** One sentence per step. The progress file should be <50 lines.
