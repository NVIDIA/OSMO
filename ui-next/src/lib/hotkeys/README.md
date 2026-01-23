# Keyboard Shortcuts Registry

Centralized management of keyboard shortcuts across the application.

## Overview

All keyboard shortcuts are now documented in centralized registries:

- **Global shortcuts**: [`lib/hotkeys/global.ts`](./global.ts)
- **Component shortcuts**: Co-located with each component (e.g., `components/shell/hotkeys.ts`)

## Architecture

```
lib/hotkeys/
├── types.ts          # Shared TypeScript types
├── global.ts         # Global app shortcuts (Cmd+B, Mod+I, Escape)
├── utils.ts          # Helper functions for help dialogs, conflict detection
└── README.md         # This file

components/
├── shell/hotkeys.ts           # Terminal & shell search shortcuts
├── data-table/hotkeys.ts      # Table navigation shortcuts
├── filter-bar/hotkeys.ts      # Filter bar shortcuts
└── panel/hotkeys.ts           # Panel tab navigation shortcuts
```

## Registry Structure

All registries follow a consistent structure:

```typescript
export const COMPONENT_HOTKEYS: HotkeyRegistry = {
  id: 'component-name',
  label: 'Component Label',
  shortcuts: {
    SHORTCUT_NAME: {
      key: 'mod+b',              // react-hotkeys-hook format
      description: 'What it does',
      category: 'Navigation',     // For grouping in help UI
      scoped: true,              // If component-scoped (not global)
    },
  },
  browserConflicts: {           // Optional: known browser conflicts
    'mod+shift+b': 'Chrome: Toggle bookmarks',
  },
};
```

## Usage

### Global Shortcuts

```typescript
import { useHotkeys } from 'react-hotkeys-hook';
import { GLOBAL_HOTKEYS } from '@/lib/hotkeys/global';

// Use in component
useHotkeys(
  GLOBAL_HOTKEYS.shortcuts.TOGGLE_SIDEBAR.key,
  handler,
  options,
);
```

### Component-Scoped Shortcuts

Component shortcuts are documented in their registry but implemented directly in the component:

```typescript
// In ShellTerminalImpl.tsx
// Shortcuts defined in: ./hotkeys.ts (TERMINAL_HOTKEYS)
const handleKeyDown = (e: KeyboardEvent) => {
  // TERMINAL_HOTKEYS.shortcuts.TOGGLE_SEARCH
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'f') {
    // ... implementation
  }
};
```

## Utilities

### Get All Registries

```typescript
import { getAllHotkeyRegistries } from '@/lib/hotkeys/utils';

const registries = getAllHotkeyRegistries();
// Returns array of all registries (global + component)
```

### Check Browser Conflicts

```typescript
import { checkBrowserConflict } from '@/lib/hotkeys/utils';

const conflict = checkBrowserConflict('mod+shift+b');
// Returns: "Chrome: Toggle bookmarks bar"
```

### Get Shortcuts by Category

```typescript
import { getShortcutsByCategory } from '@/lib/hotkeys/utils';

const shortcuts = getShortcutsByCategory();
// Returns: { Navigation: [...], Terminal: [...], ... }
```

## Current Shortcuts

### Global

| Shortcut | Description | Component |
|----------|-------------|-----------|
| **Cmd+B** (Mac) / **Ctrl+B** (Windows) | Toggle left sidebar | Sidebar |
| **Mod+I** | Toggle workflow details panel | Workflow Details |
| **Escape** | Close expanded panel | Panels |

### Terminal (scoped)

| Shortcut | Description |
|----------|-------------|
| **Cmd+F** | Toggle search in terminal |
| **Cmd+C** | Copy selected text (when selection exists) |
| **Cmd+V** | Paste from clipboard |

### Shell Search (scoped)

| Shortcut | Description |
|----------|-------------|
| **Cmd+F** | Focus search input |
| **Enter** | Find next match |
| **Shift+Enter** | Find previous match |
| **Escape** | Close search |

### Data Table (scoped)

| Shortcut | Description |
|----------|-------------|
| **Arrow Up/Down** | Navigate rows |
| **Home/End** | Jump to first/last row |
| **PageUp/PageDown** | Move by page |
| **Enter/Space** | Activate row |

### Filter Bar (scoped)

| Shortcut | Description |
|----------|-------------|
| **Arrow Left/Right** | Navigate filter chips |
| **Backspace/Delete** | Remove chip |
| **Escape** | Close dropdown |
| **Enter** | Apply filter |

### Panel Tabs (scoped)

| Shortcut | Description |
|----------|-------------|
| **Arrow Left/Right** | Switch tabs |
| **Home/End** | Jump to first/last tab |

## Known Browser Conflicts

The following browser shortcuts are documented to avoid conflicts:

- **Cmd+Shift+B**: Chrome - Toggle bookmarks bar
- **Cmd+T**: All browsers - New tab
- **Cmd+W**: All browsers - Close tab
- **Cmd+R**: All browsers - Reload page
- **Cmd+F**: All browsers - Find in page
- **Cmd+K/L**: Browsers - Focus address bar
- **Cmd+N**: All browsers - New window
- **Cmd+Shift+T**: All browsers - Reopen closed tab

See [`global.ts`](./global.ts) for the complete list.

## Benefits

1. **Discoverability**: `grep "HOTKEYS"` finds all shortcuts
2. **Documentation**: Single source of truth
3. **Conflict Detection**: Programmatic checking for conflicts
4. **Maintainability**: Consistent structure across codebase
5. **Future-Ready**: Can auto-generate help dialog from registries

## Future Enhancements

1. **Help Dialog**: Auto-generate "Keyboard Shortcuts" help UI
2. **User Customization**: Allow users to customize shortcuts
3. **Automated Tests**: Detect app vs browser conflicts
4. **Accessibility Docs**: Auto-generate keyboard nav documentation

## Migration Notes

- **Sidebar**: Migrated from manual `addEventListener` to `useHotkeys` (fixes Cmd+Shift+B bug)
- **Other Components**: Added registry comments but kept existing implementations
- **No Breaking Changes**: All user-facing behavior remains the same
