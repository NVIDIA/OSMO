# Workflow Spec Viewer - Technical Design Document

## Executive Summary

This document outlines the design for the Workflow Spec Viewer component that displays YAML specifications and Jinja2 templates within the workflow detail panel's **Spec** tab. The design prioritizes performance for large files (1000+ lines), a clean editing-ready architecture, and seamless integration with the existing NVIDIA design system.

**Key Decision: CodeMirror 6** is recommended over Monaco for this use case due to superior bundle size, mobile support, and extensibility without the heavyweight infrastructure Monaco requires.

---

## 1. UX Design

### 1.1 Layout Structure

The Spec tab will occupy the full `TabPanel` area, replacing the current `EmptyTabPrompt` placeholder. The layout follows a **single-view toggle** pattern (not side-by-side) to maximize code readability within the constrained panel width.

```
+------------------------------------------------------------------+
|  Spec Tab Content                                                 |
+------------------------------------------------------------------+
|  [Toolbar]                                                        |
|  +--------------------------------------------------------------+ |
|  | [YAML] [Jinja2]  |  [Search]  |  [Fold All] [Copy] [Download]| |
|  +--------------------------------------------------------------+ |
|                                                                   |
|  [Code Panel - Full Height]                                       |
|  +--------------------------------------------------------------+ |
|  |  1 | version: "1.0"                                          | |
|  |  2 | name: {{ workflow_name }}                                | |
|  |  3 | pool: {{ pool }}                                         | |
|  |  4 | ...                                                      | |
|  |  . |                                                          | |
|  |  . |                                                          | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### 1.2 Visual Hierarchy

**Toolbar (44px height)**
- Segmented toggle for YAML/Jinja2 (left-aligned)
- Search input with keyboard shortcut hint (Cmd/Ctrl+F) (center)
- Action buttons: Fold All, Expand All, Copy, Download (right-aligned)

**Code Panel (fills remaining height)**
- Line numbers: `text-zinc-500` on darker gutter (`bg-zinc-900/50`)
- Code content: Dark background (`bg-[#1e1e1e]`) matching VS Code Dark+
- Active line highlight: Subtle background (`bg-white/5`)
- Selection: `bg-nvidia/20` for brand consistency
- Fold markers: Chevron icons in gutter, collapse indicator on folded lines

### 1.3 Color Scheme (Dark Theme - Default for Code)

The code viewer will always use dark mode internally, regardless of the app's theme setting. This is intentional - developers expect code editors to be dark.

```css
/* Code Panel Colors (CSS Variables in globals.css) */
--code-bg: #1e1e1e;              /* VS Code Dark+ background */
--code-gutter-bg: #252526;       /* Gutter background */
--code-line-number: #858585;     /* Line number text */
--code-active-line: rgba(255, 255, 255, 0.05);
--code-selection: rgba(118, 185, 0, 0.2);  /* NVIDIA green selection */
--code-fold-marker: #6e7681;
```

**Syntax Highlighting (VS Code Dark+ compatible)**

| Token Type | Color | Example |
|------------|-------|---------|
| Keyword | `#569cd6` | `version`, `name`, `pool` |
| String | `#ce9178` | `"1.0"`, `"high"` |
| Number | `#b5cea8` | `42`, `3.14` |
| Boolean | `#569cd6` | `true`, `false` |
| Key/Property | `#9cdcfe` | YAML keys |
| Comment | `#6a9955` | `# comment` |
| Jinja Delimiter | `#d4d4d4` | `{{`, `}}`, `{%`, `%}` |
| Jinja Variable | `#dcdcaa` | Variable names in `{{ }}` |
| Jinja Keyword | `#c586c0` | `if`, `for`, `set` |

### 1.4 Interaction Patterns

**View Switching (YAML <-> Jinja)**
- Toggle buttons with clear active state
- Keyboard shortcut: `1` for YAML, `2` for Jinja when panel focused
- **Lazy loading**: YAML loads immediately, Jinja fetches on first toggle (then cached)
- Loading state shown during fetch: "Loading template..." skeleton
- Preserves scroll position proportionally when switching (if at 50% scroll in YAML, go to 50% in Jinja)
- URL state sync: `?spec=yaml` or `?spec=jinja` via nuqs

**Code Folding**
- Click gutter chevron to fold/unfold
- Keyboard: `Cmd/Ctrl+Shift+[` to fold, `Cmd/Ctrl+Shift+]` to unfold
- Folded line shows `...` ellipsis with fold badge showing line count
- "Fold All" collapses to top-level keys (YAML) or blocks (Jinja)
- Fold state preserved when switching views

**Search (Cmd/Ctrl+F)**
- Inline search bar appears below toolbar
- Highlights all matches with yellow background
- Up/Down arrows to navigate matches
- Shows "X of Y" match count
- Escape closes search, preserves last search term

**Copy**
- Copies entire content of current view (YAML or Jinja)
- Uses `useServices().clipboard` for accessibility announcements
- Toast confirmation: "YAML spec copied" or "Jinja template copied"

**Download**
- Downloads current view as file
- Filenames: `{workflow-name}-spec.yaml` or `{workflow-name}-template.j2`
- Dropdown for "Download Both" option

### 1.5 Keyboard Navigation

| Key | Action |
|-----|--------|
| `Tab` | Focus toolbar, then code panel |
| `Escape` | Close search, exit fullscreen |
| `Cmd/Ctrl+F` | Open search |
| `Cmd/Ctrl+G` | Go to line |
| `Cmd/Ctrl+Shift+[` | Fold current block |
| `Cmd/Ctrl+Shift+]` | Unfold current block |
| `Cmd/Ctrl+K Cmd/Ctrl+0` | Fold all |
| `Cmd/Ctrl+K Cmd/Ctrl+J` | Unfold all |
| `1` | Switch to YAML (when toolbar focused) |
| `2` | Switch to Jinja (when toolbar focused) |

### 1.6 Empty States

**No Spec Available**
```
[FileCode icon]
Workflow Spec Not Available

The workflow specification hasn't been loaded yet,
or is not available for this workflow.
```

**Loading State**
```
[Skeleton with shimmer]
3-4 lines of code skeleton with gutter
```

**Error State**
```
[AlertTriangle icon]
Failed to Load Spec

{error message}

[Retry button]
```

---

## 2. Technical Architecture

### 2.1 Editor Library: CodeMirror 6

**Decision: Use CodeMirror 6** over Monaco Editor.

| Criteria | CodeMirror 6 | Monaco Editor |
|----------|--------------|---------------|
| Bundle Size | ~150KB (with extensions) | ~2.5MB+ |
| SSR Compatibility | Excellent (no window dependency) | Poor (requires dynamic import) |
| Mobile Support | First-class | Limited |
| Touch Gestures | Native | Requires polyfills |
| Extensibility | Modular, tree-shakeable | Monolithic |
| React Integration | @uiw/react-codemirror | @monaco-editor/react |
| Theming | CSS-based, easy to customize | Complex, requires AMD loader |
| Memory Usage | ~30MB for large files | ~100MB+ for large files |
| Accessibility | ARIA compliant, screen reader tested | Basic ARIA |

**Why Not Monaco?**
1. Monaco is designed for VS Code, not embedded use cases
2. Requires web workers for syntax highlighting (complex setup)
3. Overkill for read-only code viewing (this is NOT an IDE)
4. Poor mobile experience (we support mobile viewports)
5. Significant memory overhead for the panel's constrained layout

**CodeMirror 6 Packages**

```json
{
  "dependencies": {
    "@codemirror/lang-yaml": "^6.x",
    "@codemirror/language": "^6.x",
    "@codemirror/search": "^6.x",
    "@codemirror/view": "^6.x",
    "@codemirror/state": "^6.x",
    "@codemirror/fold": "^6.x",
    "@uiw/react-codemirror": "^4.x"
  }
}
```

**Note on Jinja2**: CodeMirror doesn't have a native Jinja2 mode. We'll use a **mixed-language approach**:
- Base language: YAML
- Jinja delimiters parsed as special tokens
- Custom highlighting for `{{ }}`, `{% %}`, `{# #}`

### 2.2 Component Architecture

```
src/app/(dashboard)/workflows/[name]/components/panel/workflow/
├── WorkflowDetails.tsx           # Parent (existing)
├── WorkflowSpecViewer.tsx        # Refactored container
├── spec/
│   ├── index.ts                  # Public exports
│   ├── SpecToolbar.tsx           # View toggle, search, actions
│   ├── SpecCodePanel.tsx         # CodeMirror wrapper
│   ├── SpecSearchBar.tsx         # Search UI overlay
│   ├── hooks/
│   │   ├── useSpecData.ts        # Data fetching hook
│   │   ├── useSpecViewState.ts   # View toggle, fold state
│   │   └── useSpecSearch.ts      # Search state management
│   └── lib/
│       ├── yaml-language.ts      # YAML + Jinja mixed mode
│       ├── jinja-language.ts     # Pure Jinja mode
│       ├── theme.ts              # CodeMirror theme (VS Code Dark+)
│       └── constants.ts          # Styling constants
```

### 2.3 Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        WorkflowDetails                          │
│                              │                                  │
│                    selectedTab === "spec"                       │
│                              │                                  │
│                              ▼                                  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                  WorkflowSpecViewer                        │ │
│  │                          │                                 │ │
│  │              useSpecViewState()                            │ │
│  │                          │                                 │ │
│  │                    activeView (yaml | jinja)               │ │
│  │                          │                                 │ │
│  │                          ▼                                 │ │
│  │              useSpecData(workflowId, activeView)           │ │
│  │                          │                                 │ │
│  │          ┌───────────────┴───────────────┐                │ │
│  │          │                               │                 │ │
│  │     activeView === 'yaml'         activeView === 'jinja'   │ │
│  │          │                               │                 │ │
│  │          ▼                               ▼                 │ │
│  │    GET /spec                    GET /spec?use_template=true│ │
│  │    (fetched immediately)        (lazy - only if toggled)   │ │
│  │          │                               │                 │ │
│  │          └───────────────┬───────────────┘                │ │
│  │                          │                                 │ │
│  │                    data: string                            │ │
│  │                          │                                 │ │
│  │                          ▼                                 │ │
│  │                    SpecCodePanel                           │ │
│  │                          │                                 │ │
│  │                          ▼                                 │ │
│  │                 CodeMirror (virtualized)                   │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.4 API Contract (Actual Backend Endpoints)

The backend provides two endpoints that return **raw string content**:

```typescript
// GET /api/workflow/<workflow-id>/spec
// Returns: Raw YAML specification (plain text string)
// Example: "version: '1.0'\nname: my-workflow\npool: gpu\n..."

// GET /api/workflow/<workflow-id>/spec?use_template=true
// Returns: Raw Jinja2 template (plain text string)
// Example: "{% set pool = 'gpu' %}\nversion: '1.0'\n..."

// Error: 404 Not Found if spec doesn't exist
```

**TypeScript Interfaces for Adapter Layer**

```typescript
// Adapter wrapper for type safety and React Query integration
interface SpecData {
  yaml: string;      // Content from /spec
  jinja: string;     // Content from /spec?use_template=true
}

// React Query hook signature
function useSpecData(workflowId: string): {
  data: SpecData | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}
```

**Fetching Strategy: Lazy Load on View Switch**

Only fetch what the user is looking at:

```typescript
// hooks/useSpecData.ts
function useSpecData(workflowId: string, activeView: 'yaml' | 'jinja') {
  // Always fetch YAML (default view)
  const { data: yamlSpec, isLoading: isLoadingYaml, error: errorYaml } = useQuery({
    queryKey: ['workflow', workflowId, 'spec', 'yaml'],
    queryFn: () => fetcher(`/api/workflow/${workflowId}/spec`),
    staleTime: Infinity, // Immutable - never refetch
    gcTime: 30 * 60 * 1000, // 30 min garbage collection
  });

  // Only fetch Jinja when user switches to template view
  const { data: jinjaTemplate, isLoading: isLoadingJinja, error: errorJinja } = useQuery({
    queryKey: ['workflow', workflowId, 'spec', 'jinja'],
    queryFn: () => fetcher(`/api/workflow/${workflowId}/spec?use_template=true`),
    staleTime: Infinity, // Immutable - never refetch
    gcTime: 30 * 60 * 1000, // 30 min garbage collection
    enabled: activeView === 'jinja', // Only fetch when viewing Jinja
  });

  // Return based on active view
  return {
    data: activeView === 'yaml' ? yamlSpec : jinjaTemplate,
    isLoading: activeView === 'yaml' ? isLoadingYaml : isLoadingJinja,
    error: activeView === 'yaml' ? errorYaml : errorJinja,
  };
}
```

**Benefits**:
- **Default**: Only fetches YAML spec (most common use case)
- **Lazy**: Jinja template only fetched when user clicks "Jinja2" toggle
- **Immutable**: `staleTime: Infinity` - once fetched, never refetches (specs never change)
- **Bandwidth**: Saves network requests if user never looks at template
- **Fast**: Switching between views is instant after initial fetch (permanent cache)

**Error Handling**

- **404**: Show empty state ("Workflow Spec Not Available")
- **5xx**: Show error state with retry button
- **Network error**: Show error state with retry button
- **Success but empty string**: Treat as 404 (show empty state)

**Caching**

Specs and templates are **immutable** (never change once uploaded):
- `staleTime: Infinity` (never refetch - data never changes)
- `gcTime: 30 minutes` (keep in cache even when unmounted)
- **No invalidation needed** - immutable data doesn't require cache busting
- Perfect for React Query's structural sharing

**Mock Data for `pnpm dev:mock`**

Add MSW handlers in `src/mocks/handlers/workflow.ts`:

```typescript
// Mock YAML spec
http.get('/api/workflow/:id/spec', ({ params }) => {
  const { id } = params;

  const yamlSpec = `version: "1.0"
name: ${id}
pool: {{ pool_name }}
priority: {{ priority }}

tasks:
  - name: preprocess
    image: nvidia/cuda:12.0
    command: /app/preprocess.sh
    resources:
      cpus: 4
      memory: 8GB

  - name: train
    image: pytorch/pytorch:2.0
    command: python train.py
    resources:
      gpus: 8
      memory: 64GB

  - name: evaluate
    image: pytorch/pytorch:2.0
    command: python evaluate.py
    depends_on:
      - train`;

  return HttpResponse.text(yamlSpec, {
    headers: { 'Content-Type': 'text/yaml' },
  });
}),

// Mock Jinja template
http.get('/api/workflow/:id/spec', ({ params, request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get('use_template') !== 'true') {
    return; // Let other handler handle non-template requests
  }

  const jinjaTemplate = `{% set pool_name = "gpu-pool-1" %}
{% set priority = "high" %}
{% set resource_tier = "premium" %}

{# Workflow configuration template #}
version: "1.0"
name: {{ workflow_name }}
pool: {{ pool_name }}
priority: {{ priority }}

{# Task definitions #}
tasks:
{% for task in tasks %}
  - name: {{ task.name }}
    image: {{ task.image }}
    command: {{ task.command }}
    {% if task.resources %}
    resources:
      {% if task.resources.cpus %}cpus: {{ task.resources.cpus }}{% endif %}
      {% if task.resources.gpus %}gpus: {{ task.resources.gpus }}{% endif %}
      {% if task.resources.memory %}memory: {{ task.resources.memory }}{% endif %}
    {% endif %}
    {% if task.depends_on %}
    depends_on:
      {% for dep in task.depends_on %}
      - {{ dep }}
      {% endfor %}
    {% endif %}
{% endfor %}`;

  return HttpResponse.text(jinjaTemplate, {
    headers: { 'Content-Type': 'text/plain' },
  });
}),
```

### 2.5 Large File Strategy

**Threshold Definitions**

| Size | Lines | Strategy |
|------|-------|----------|
| Small | < 500 | Direct rendering |
| Medium | 500-2000 | Viewport virtualization |
| Large | 2000-10000 | Aggressive virtualization + fold by default |
| Very Large | > 10000 | Chunked loading + streaming |

**CodeMirror 6 Virtualization**

CodeMirror 6 has built-in viewport virtualization. Unlike TanStack Virtual (which we use for tables), CodeMirror only renders visible lines plus a small overscan buffer.

```typescript
const extensions = [
  // Virtualization is automatic, but we can tune the viewport margin
  EditorView.contentAttributes.of({
    "aria-label": "Workflow specification"
  }),
  // Limit the number of lines drawn at once
  EditorView.scrollMargins.of(() => ({ top: 100, bottom: 100 })),
];
```

**Chunked Loading (Very Large Files)**

For files > 10,000 lines, we'll implement progressive loading:

```typescript
// API supports range requests
// GET /api/workflow/{name}/spec?start=0&limit=1000

interface ChunkedSpecResponse {
  content: string;          // Chunk content
  start_line: number;       // Start line number
  end_line: number;         // End line number
  total_lines: number;      // Total lines in file
  has_more: boolean;        // More content available
}
```

The UI would:
1. Load first 1000 lines immediately
2. Show a "Loading more..." indicator at bottom
3. Load additional chunks as user scrolls
4. Maintain a sliding window for memory efficiency (unload distant chunks)

**Decision**: Start with direct rendering + CodeMirror's native virtualization. Only implement chunked loading if real-world usage shows performance issues with files > 5000 lines.

### 2.6 Performance Budget

| Metric | Target | Measurement |
|--------|--------|-------------|
| Initial Render (500 lines) | < 100ms | `performance.mark()` |
| Scroll FPS | 60fps | Chrome DevTools |
| View Switch | < 50ms | React Profiler |
| Search (10K lines) | < 200ms | User-perceived |
| Memory (10K lines) | < 50MB | Chrome Memory tab |
| Bundle Impact | < 80KB gzipped | webpack-bundle-analyzer |

### 2.7 Syntax Highlighting Approach

**YAML Highlighting**: Use `@codemirror/lang-yaml` directly.

**Jinja2 in YAML (Mixed Mode)**:

Create a custom language extension that:
1. Uses YAML as the base language
2. Injects Jinja tokens when detecting delimiters
3. Maintains proper nesting for `{% if %}...{% endif %}` blocks

```typescript
// lib/yaml-jinja-language.ts
import { yaml } from "@codemirror/lang-yaml";
import { LanguageSupport, StreamLanguage } from "@codemirror/language";

// Custom parser that detects Jinja delimiters within YAML
const jinjaOverlay = StreamLanguage.define({
  token(stream) {
    if (stream.match("{{")) {
      stream.eatWhile(/[^}]/);
      stream.match("}}");
      return "jinja-variable";
    }
    if (stream.match("{%")) {
      stream.eatWhile(/[^%]/);
      stream.match("%}");
      return "jinja-statement";
    }
    if (stream.match("{#")) {
      stream.eatWhile(/[^#]/);
      stream.match("#}");
      return "jinja-comment";
    }
    stream.next();
    return null;
  }
});

export function yamlWithJinja(): LanguageSupport {
  return new LanguageSupport(yaml().language, [
    jinjaOverlay
  ]);
}
```

**Pure Jinja2 Highlighting**:

For the Jinja template view (when not embedded in YAML), use a dedicated Jinja mode:

```typescript
// lib/jinja-language.ts
import { StreamLanguage } from "@codemirror/language";

const jinjaLanguage = StreamLanguage.define({
  startState() {
    return { inBlock: false, blockType: null };
  },
  token(stream, state) {
    // Handle delimiters
    if (stream.match("{{")) return "jinja-delim";
    if (stream.match("}}")) return "jinja-delim";
    if (stream.match("{%")) {
      state.inBlock = true;
      return "jinja-delim";
    }
    if (stream.match("%}")) {
      state.inBlock = false;
      return "jinja-delim";
    }

    // Handle keywords inside blocks
    if (state.inBlock) {
      if (stream.match(/\b(if|else|elif|endif|for|endfor|set|block|endblock|extends|include|macro|endmacro)\b/)) {
        return "jinja-keyword";
      }
    }

    // Variables and filters
    if (stream.match(/\|[a-zA-Z_]+/)) return "jinja-filter";
    if (stream.match(/[a-zA-Z_][a-zA-Z0-9_]*/)) return "jinja-variable";

    stream.next();
    return null;
  }
});
```

---

## 3. Path to Editable Mode

The current design is read-only, but the architecture supports future editing:

### 3.1 Editing Requirements (Future)

1. **Validation**: Real-time YAML syntax validation
2. **Schema Validation**: Validate against workflow schema
3. **Dirty State**: Track unsaved changes
4. **Save**: POST to backend with conflict detection
5. **Diff View**: Show changes before saving

### 3.2 Architecture Extensibility

The component structure already supports this:

```typescript
// Current (read-only)
<SpecCodePanel
  content={yamlSpec}
  language="yaml"
  readOnly
/>

// Future (editable)
<SpecCodePanel
  content={yamlSpec}
  language="yaml"
  readOnly={false}
  onChange={(newContent) => setDraft(newContent)}
  validationErrors={errors}
/>
```

CodeMirror 6 natively supports:
- `EditorState.readOnly` for toggling edit mode
- `linter()` extension for validation underlines
- `EditorView.updateListener` for change tracking

### 3.3 Editing UI Additions (Future)

```
+------------------------------------------------------------------+
|  [YAML] [Jinja2]  |  [Search]  |  [Validate] [Save] [Discard]   |
+------------------------------------------------------------------+
|  Unsaved Changes (3 lines modified)              [Review Changes]|
+------------------------------------------------------------------+
```

---

## 4. Trade-offs Analysis

### 4.1 CodeMirror vs Monaco vs Lightweight

| Solution | Pros | Cons | Verdict |
|----------|------|------|---------|
| **CodeMirror 6** | Small bundle, great perf, modular, accessible | Less "IDE-like", no IntelliSense | **Selected** |
| Monaco Editor | Full IDE experience, TypeScript support | Huge bundle, complex setup, poor mobile | Overkill for viewing |
| Prism.js + custom | Tiny bundle, simple | No folding, no search, no editing path | Insufficient |
| Shiki (current) | Beautiful highlighting | Server-side only, no interaction | Insufficient |
| highlight.js | Client-side, lightweight | No folding, limited Jinja support | Insufficient |

**Decision Rationale**: CodeMirror 6 is the Goldilocks choice - powerful enough for code folding, search, and future editing, but lightweight enough for a panel component. It's also accessible and mobile-friendly, which aligns with OSMO's quality standards.

### 4.2 Streaming vs All-at-Once Loading

| Approach | Pros | Cons | When to Use |
|----------|------|------|-------------|
| **All-at-Once** | Simple, instant search | Memory for large files | < 5000 lines |
| **Chunked/Streaming** | Memory efficient | Complex, partial search | > 10000 lines |

**Decision**: Start with all-at-once loading. CodeMirror's virtualization handles memory well up to ~10K lines. Implement streaming only if user feedback indicates performance issues with real-world specs.

### 4.3 Dark-Only vs Theme-Aware Code Panel

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Dark-Only** | Consistent, expected for code | Doesn't match light app theme | **Selected** |
| Theme-Aware | Consistent with app | Jarring for code, hard to read | Not recommended |

**Decision**: Code editors are universally dark. Users expect this. The dark code panel provides visual separation and familiar IDE aesthetics.

### 4.4 Toggle vs Side-by-Side

| Layout | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Toggle** | Max code width, clean UI | Can't compare visually | **Selected** |
| Side-by-Side | Visual comparison | Cramped code, complex scroll sync | Not for panel |
| Tabs | Familiar metaphor | Wastes vertical space | Close second |

**Decision**: Toggle is best for the constrained panel width. The existing `WorkflowSpecViewer` side-by-side design was appropriate for a fullscreen view but not for the ~400-600px panel width.

---

## 5. Implementation Plan

### Phase 1: Core Viewer (MVP)
- [ ] Add CodeMirror 6 dependencies
- [ ] Create `SpecCodePanel` with YAML highlighting
- [ ] Create `SpecToolbar` with view toggle
- [ ] Integrate into `WorkflowDetails` Spec tab
- [ ] Add copy and download functionality
- [ ] Add URL state for view (`?spec=yaml`)

### Phase 2: Enhanced Features
- [ ] Implement code folding
- [ ] Add Jinja2 mixed-mode highlighting
- [ ] Add search functionality (Cmd+F)
- [ ] Add "Go to Line" (Cmd+G)
- [ ] Keyboard shortcuts

### Phase 3: API Integration
- [ ] Design `/api/workflow/{name}/spec` endpoint
- [ ] Add `useSpecData` hook with React Query
- [ ] Add loading and error states
- [ ] Handle large file edge cases

### Phase 4: Polish
- [ ] Accessibility audit
- [ ] Performance profiling
- [ ] Mobile responsiveness testing
- [ ] Documentation

---

## 6. Open Questions

1. ~~**API Ownership**: Who implements the `/api/workflow/{name}/spec` endpoint?~~ **RESOLVED**: Backend already implements this.
2. ~~**Spec Caching**: Should the spec be cached aggressively?~~ **RESOLVED**: Yes, 5 min staleTime, 30 min cacheTime.
3. **Variable Highlighting**: Should Jinja variables be cross-referenced with resolved values? (e.g., clicking `{{ pool_name }}` shows its value)
4. **Diff Mode**: Is there a use case for comparing current spec with previous version?
5. **Export Format**: Should "Download" support JSON format in addition to YAML/Jinja?
6. **Typical File Sizes**: What's the realistic size range for specs in production? (impacts virtualization strategy)

---

## 7. Appendix

### A. Existing Component Analysis

The current `WorkflowSpecViewer.tsx` (lines 1-401) provides a side-by-side diff-style layout with:
- Split view with draggable resize
- Placeholder for Shiki syntax highlighting
- Synchronized scrolling
- Copy and download functionality

This design was intended for a larger viewport. For the panel context, we'll:
1. Repurpose the copy/download logic
2. Replace side-by-side with toggle
3. Replace manual line rendering with CodeMirror
4. Remove synchronized scrolling (not needed for toggle)

### B. Related Files

- `/src/app/(dashboard)/workflows/[name]/components/panel/workflow/WorkflowDetails.tsx` - Parent component with Spec tab
- `/src/app/(dashboard)/workflows/[name]/lib/syntax-highlighting.ts` - Shiki-based highlighting (will be deprecated)
- `/src/components/panel/tab-panel.tsx` - Tab panel container
- `/src/app/globals.css` - CSS variables for design system

### C. Bundle Size Impact

```
CodeMirror 6 core:           ~50KB gzipped
@codemirror/lang-yaml:       ~10KB gzipped
@codemirror/search:          ~8KB gzipped
@codemirror/fold:            ~5KB gzipped
@uiw/react-codemirror:       ~8KB gzipped
Custom theme + languages:    ~5KB gzipped
-----------------------------------
Total estimated impact:      ~86KB gzipped
```

This is within acceptable limits for a feature-specific lazy-loaded component.
