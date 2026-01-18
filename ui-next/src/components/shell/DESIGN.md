# Task Shell Experience - Design Document

> Interactive terminal access to running workflow tasks

## Status: Implemented ✅

Core shell functionality is complete.

---

## Current Implementation

| Component | Location | Purpose |
|-----------|----------|---------|
| `ShellTerminal` | `@/components/shell/` | xterm.js wrapper with WebGL |
| `ShellSearch` | `@/components/shell/` | Ctrl+Shift+F search overlay |
| `ShellSessionIcon` | `@/components/shell/` | Individual session status icon |
| `StatusDot` | `@/components/shell/` | Connection status indicator |
| `ShellConnecting` | `@/components/shell/` | Connecting overlay |
| `shell-session-cache.ts` | `@/components/shell/` | Module-scope session persistence |
| `use-shell.ts` | `@/components/shell/` | xterm.js lifecycle hook |
| `use-websocket-shell.ts` | `@/components/shell/` | WebSocket connection hook |
| `use-shell-sessions.ts` | `@/components/shell/` | React hook for session state |
| `use-shell-navigation-guard.ts` | `@/components/shell/` | beforeunload warning |
| `TaskShell` | `workflows/[name]/components/panel/task/` | Shell tab UI with connect/reconnect |
| `ShellContainer` | `workflows/[name]/components/shell/` | Portal-based session rendering |
| `ShellContext` | `workflows/[name]/components/shell/` | Active shells state management |
| `ShellPortalContext` | `workflows/[name]/components/shell/` | Portal target management |
| `WorkflowEdgeStrip` | `workflows/[name]/components/panel/shared/` | Unified edge strip with expand, links, shells |

### Features

- **xterm.js with WebGL** - GPU-accelerated rendering, canvas fallback
- **FitAddon** - Auto-resize with debounce and minimum dimension guards
- **SearchAddon** - Ctrl+Shift+F with prev/next navigation
- **WebLinksAddon** - Clickable URLs in terminal output
- **Copy/Paste** - Ctrl+Shift+C/V (preserves Ctrl+C for SIGINT)
- **Shell Selector** - bash/sh/zsh dropdown + custom shell input
- **Session Persistence** - Module-scope cache survives React lifecycle
- **Unified Edge Strip** - Always-visible strip with expand button, workflow links, and shell sessions
- **Navigation Guard** - beforeunload warning when sessions active
- **Connection States** - idle, connecting, connected, disconnected, error
- **Reconnect UI** - Inline status bar with manual reconnect button
- **NVIDIA Theme** - Dark terminal with NVIDIA green cursor

---

## Future Features (Not Started)

### Inline Log Viewer

View task logs inline without leaving the workflow page.

```
src/components/log-viewer/
├── index.ts
├── LogViewer.tsx
├── LogLine.tsx
└── use-log-stream.ts
```

### Inline Event List

View Kubernetes events inline.

```
src/components/event-list/
├── index.ts
├── EventList.tsx
└── EventItem.tsx
```

---

## References

- [xterm.js Documentation](https://xtermjs.org/)
- [xterm.js GitHub](https://github.com/xtermjs/xterm.js)
- Backend: `external/src/service/router/router.py`
