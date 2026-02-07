# ASYNC_FILTER_PLAN_v2.md

**Date**: 2026-02-06
**Status**: Planning (No Code Changes Yet)
**Scope**: FilterBar Compositional Refactor + Async Infrastructure

---

## Executive Summary

This document supersedes the original ASYNC_FILTER_PLAN.md with a pragmatic, evidence-based approach informed by specialist agent reviews. The original plan proposed decomposing FilterBar into 10+ primitives with async/static data providers. After thorough analysis, we've determined that approach was **over-engineered for the actual use cases**.

**Key Finding**: The current FilterBar architecture is already well-designed. The separation between pure logic (`lib/`), UI-agnostic hooks (`hooks/`), and rendering layer is the optimal React 19 pattern. We have exactly **2 usage patterns** (TableToolbar wrapper and direct LogViewer usage), both using identical APIs.

**Revised Strategy**: Refactor internally to reduce complexity and improve testability while keeping the public API unchanged. Add async infrastructure at the hook level, not the component level.

### Quick Decisions Summary ✅

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Delete hotkeys.ts?** | ✅ Yes (Phase 1) | Never imported at runtime, pure dead code |
| **Extract validation?** | ✅ Yes (Phase 3) | Improves testability, adheres to SRP |
| **Single-select mode?** | ✅ Hook composition | Avoids branching in component, React 19 way |
| **Document async feature?** | ✅ Yes (Phase 7) | Valuable pattern, encourage adoption |

**Total Effort**: 13 hours (1.6 days) across 7 phases
**Breaking Changes**: 0 (public API unchanged through Phase 1-6)

---

## Current State Analysis

### Architecture Assessment

| Layer | Files | Quality | Issues |
|-------|-------|---------|--------|
| **Types** | `lib/types.ts` (230 lines) | ✅ Excellent | None |
| **Logic** | `lib/filter.ts` (72 lines) | ✅ Excellent | None |
| **Hooks** | `hooks/use-chips.ts` (207 lines)<br>`hooks/use-suggestions.ts` (278 lines) | ✅ Good | Dead code in return values |
| **Styles** | `styles.ts` (92 lines) | ⚠️ Good | Hardcoded colors, not design tokens |
| **Components** | `components.tsx` (107 lines) | ✅ Minimal | Clean separation |
| **Composition** | `filter-bar.tsx` (523 lines) | ⚠️ Monolithic | 90-line keyboard handler, mixed concerns |

### Usage Patterns

**Current Consumers**: 6+ components

| Consumer | Pattern | Features Used |
|----------|---------|---------------|
| `PoolsToolbar` | Via TableToolbar | Chips, Presets, Results Count, Client-side Filter |
| `ResourcesToolbar` | Via TableToolbar | Chips, Results Count, Client-side Filter |
| `WorkflowsToolbar` | Via TableToolbar | Chips, Presets, Results Count, **Server-side Filter** |
| `WorkflowTasksToolbar` | Via TableToolbar | Chips, Presets, Results Count, Client-side Filter |
| `GroupTasksTab` | Via TableToolbar | Chips, Presets, Results Count, Client-side Filter |
| `LogViewer` | Direct | Chips, Presets, Results Count, **Server-side Filter** |

**Key Insight**: All consumers use the **exact same API shape**. There is no evidence that different compositional variants are needed.

### Pain Points (Code-Simplifier Analysis)

#### 1. Dead Code (0 Impact, Safe to Remove)

| Item | Location | Impact |
|------|----------|--------|
| `selectableSuggestions` return | `use-suggestions.ts:260` | Never consumed; computed again in `filter-bar.tsx:82` |
| `totalNavigableCount` return | `use-suggestions.ts:269` | Never consumed |
| `dropdownStyles.highlighted` | `styles.ts:50` | Never referenced |
| `dropdownStyles.kbd` | `styles.ts:53` | Never used (footer uses `chipStyles.chip` instead) |
| `PresetContentProps.isFocused` | `components.tsx:94` | Accepted but never passed by consumer |
| `getPresetChips` callback | `use-chips.ts:142-144` | Trivial wrapper (`return preset.chips`) with no value |
| `hotkeys.ts` | Entire file | Documentation-only, never imported at runtime |

**Total Lines of Dead Code**: ~50 lines

#### 2. Code Duplication (Medium Impact)

| Pattern | Occurrences | Fix |
|---------|-------------|-----|
| Chip removal logic | 2x (`filter-bar.tsx:150-156`, `158-161`) | Extract `removeFocusedChip()` helper |
| "Reset input after action" | 4x (`94-96`, `113-114`, `179-181`) | Extract `commitAndReset()` helper |
| Hint-filtering logic | 3x (in hook, in component, inverse filter) | Single partition in hook, use directly |
| Chip key pattern `${field}:${value}` | 2x (`use-chips.ts:175`, `178`) | Extract `chipKey(chip)` utility |
| `selectables` derivation | 2x (`use-suggestions.ts:260`, `filter-bar.tsx:82`) | Use hook value directly |

**Total Duplicate Lines**: ~30 lines

#### 3. Complexity Hotspots (High Impact)

| Location | Lines | Cyclomatic Complexity | Concerns Mixed |
|----------|-------|----------------------|----------------|
| `handleKeyDown` | 90+ lines | 15+ branches | Chip navigation + deletion + input submission |
| `handleSelect` | 34 lines | 3 paths | Preset selection + field selection + value selection |
| `addChip` | 55 lines | 5 concerns | Validation + resolution + dedup + error handling + dispatch |

**Most Complex Function**: `handleKeyDown` with 10-item dependency array, untestable in isolation.

#### 4. Responsibility Violations (SOLID)

**FilterBarInner mixes 5 concerns:**

| Concern | Lines | Should Be |
|---------|-------|-----------|
| UI State | `48-53` | ✅ Correct (component state) |
| Keyboard behavior | `123-227` | ❌ Extract to `useFilterKeyboard` hook |
| Selection behavior | `86-119` | ❌ Extract to `useFilterSelection` hook |
| Input lifecycle | `229-293` | ⚠️ Extract to `FilterInput` component |
| Rendering | `297-519` | ⚠️ Extract to `FilterInput` + `FilterDropdown` components |

---

## Architectural Decisions

### Decision 1: Internal Refactor, Not External Decomposition

**Rejected Approach** (from ASYNC_FILTER_PLAN v1):
- 6 exported primitives (FilterSearch, FilterItem, FilterSuggestionList, etc.)
- AsyncFilterData/StaticFilterData providers with render props
- SingleSelectFilter/MultiChipFilter as separate components
- Compound component pattern with Context

**Why Rejected**:
- ❌ **YAGNI violation** - No consumer needs individual primitives
- ❌ **Over-abstraction** - Designing a library for 2 identical use cases
- ❌ **Performance cost** - More component boundaries = more reconciliation overhead
- ❌ **Complexity cost** - Context providers for 2-level tree adds indirection
- ❌ **Testability illusion** - Internal extraction gives same testability without API surface

**Approved Approach**:
- ✅ Keep single `<FilterBar>` component as public API
- ✅ Extract internal sub-components (not exported): `FilterInput`, `FilterDropdown`, `ValidationMessage`
- ✅ Extract behavior hooks: `useFilterKeyboard`, `useFilterSelection`
- ✅ State flows via props (no Context for 2-level tree)
- ✅ Explicit composition in `filter-bar.tsx` root

**Rationale**: React 19 Compiler optimizes within components, not across boundaries. The current headless-hook + render-layer pattern is already optimal. Our problem is the 523-line render function, not the architecture.

### Decision 2: Async Infrastructure at Hook Level, Not Component Level

**Rejected Approach**:
```tsx
<AsyncFilterProvider hook={usePoolNames}>
  {({ values, isLoading }) => (
    <FilterBar fields={[{ key: "pool", values }]} />
  )}
</AsyncFilterProvider>
```

**Why Rejected**:
- ❌ Adds Provider nesting for no benefit (parent already has TanStack Query hook)
- ❌ Duplicates cache entries or requires coordinated query keys
- ❌ Couples generic component to specific data sources
- ❌ Loading states belong at page level (skeletons), not filter level

**Approved Approach**:
```typescript
// Parent component owns data fetching
const { pools, isLoading } = usePools();

// FilterBar receives resolved data
<FilterBar
  data={pools}
  fields={[
    {
      key: "pool",
      getValues: (data) => data.map(p => ({ value: p.name, label: p.name })),
    }
  ]}
/>
```

**For future async suggestions** (workflows page pool filter):
- Add `isLoading` prop to `SearchField<T>`
- FilterBar shows loading state in dropdown
- Data fetching stays in parent via TanStack Query
- No Provider abstraction needed

### Decision 3: Single-Select Mode via Hook Composition

**For PoolSection resubmit dialog** (the original use case):

**Rejected Approach**: Separate `<SingleSelectFilter>` component

**Approved Approach**: Compose at hook level, reuse same rendering

```typescript
// hooks/use-single-select-chips.ts
export function useSingleSelectChips<T>(options: UseChipsOptions<T>) {
  const chipOps = useChips(options);

  const addChip = useCallback(
    (field: SearchField<T>, value: string): boolean => {
      // Clear existing chips for this field before adding
      const withoutField = options.chips.filter(c => c.field !== field.id);
      options.onChipsChange(withoutField);
      return chipOps.addChip(field, value);
    },
    [chipOps, options],
  );

  return { ...chipOps, addChip };
}
```

```tsx
// In PoolSection.tsx
const chipOps = useSingleSelectChips({ chips, onChipsChange, fields, data });

<FilterBar
  {...chipOps}
  fields={POOL_FIELDS}
  // Optional: hide chip UI since it's single-select
  renderChips={false}
/>
```

**Rationale**: Hook composition is the React 19 way. Same rendering code, different behavior. No component duplication.

### Decision 4: Accessibility First-Class

**Required ARIA improvements** (currently missing):

| Gap | Fix | Priority |
|-----|-----|----------|
| Chips lack role/label | Add `role="option"` + `aria-label="Filter: {label}. Press Delete to remove."` | High |
| Listbox ID collision | Use `useId()` for listbox ID (already imported, underused) | High |
| Validation not announced | Add `role="alert"` + `aria-live="assertive"` to error message | High |
| Results count not announced | Use `announcer.announce()` on change | Medium |
| Chip removal not announced | Announce "Removed filter: {label}" via announcer | Medium |
| Focus not returned to input | Explicitly `.focus()` input after last chip removed | Medium |

**Integration**: FilterBar needs `useServices()` for announcer. Extract `@/hooks/use-services` if not already available.

---

## Phased Implementation Plan

### Phase 1: Code Cleanup (Dead Code Removal)
**Effort**: 1 hour | **Risk**: None | **Value**: Reduce maintenance surface

**Changes**:
1. Remove unused return values from `use-suggestions.ts`:
   - Delete `selectableSuggestions` and `totalNavigableCount` from return
   - Update return type to match
2. Remove dead styles from `styles.ts`:
   - Delete `highlighted` and `kbd` from `dropdownStyles`
3. Remove `isFocused` prop from `PresetContent`:
   - Delete from `PresetContentProps` type
   - Remove from `render` signature in `PresetRenderProps`
4. Inline `getPresetChips` in `use-chips.ts`:
   - Replace `getPresetChips(preset)` with `preset.chips` directly
   - Remove callback definition
5. **Delete `hotkeys.ts`**:
   - Remove `src/components/filter-bar/hotkeys.ts` (dead code, never imported)

**Verification**: `pnpm type-check && pnpm lint && pnpm test --run`

**Files Modified**:
- `src/components/filter-bar/hooks/use-suggestions.ts`
- `src/components/filter-bar/hooks/use-chips.ts`
- `src/components/filter-bar/styles.ts`
- `src/components/filter-bar/components.tsx`
- `src/components/filter-bar/lib/types.ts`

**Files Deleted**:
- `src/components/filter-bar/hotkeys.ts`

---

### Phase 2: Extract Keyboard Handler Hook
**Effort**: 2 hours | **Risk**: Low | **Value**: ⭐⭐⭐ High (testability, readability)

**Create**: `src/components/filter-bar/hooks/use-filter-keyboard.ts`

**Interface**:
```typescript
interface UseFilterKeyboardOptions<T> {
  // State
  chips: SearchChip[];
  inputValue: string;
  isOpen: boolean;
  focusedChipIndex: number;
  parsedInput: ParsedInput;
  selectables: Suggestion[];

  // Setters
  setInputValue: (value: string) => void;
  setIsOpen: (open: boolean) => void;
  setFocusedChipIndex: (index: number) => void;
  setValidationError: (error: string | null) => void;

  // Actions
  addChip: (field: SearchField<T>, value: string) => boolean;
  removeChip: (index: number) => void;
  handleSelect: (value: string) => void;

  // Refs
  inputRef: RefObject<HTMLInputElement>;
}

export function useFilterKeyboard<T>(
  options: UseFilterKeyboardOptions<T>
): (e: React.KeyboardEvent) => void;
```

**Extract logic from** `filter-bar.tsx` lines 123-227 (the `handleKeyDown` callback).

**Benefits**:
- Reduces `FilterBarInner` from 523 to ~450 lines
- Makes keyboard behavior independently testable
- Clear separation: state management (component) vs. keyboard logic (hook)
- Can write unit tests for each key handler without rendering FilterBar

**Testing**:
```typescript
describe("useFilterKeyboard", () => {
  it("ArrowLeft focuses previous chip", () => {
    const setFocusedChipIndex = vi.fn();
    const handleKeyDown = useFilterKeyboard({
      focusedChipIndex: 2,
      chips: [chip1, chip2, chip3],
      setFocusedChipIndex,
      // ... other options
    });

    handleKeyDown(createKeyboardEvent("ArrowLeft"));
    expect(setFocusedChipIndex).toHaveBeenCalledWith(1);
  });

  // ... test all 7 key handlers independently
});
```

**Files Modified**:
- `src/components/filter-bar/hooks/use-filter-keyboard.ts` (NEW)
- `src/components/filter-bar/filter-bar.tsx` (extract 90 lines → import + use hook)

---

### Phase 3: Consolidate Duplicate Logic + Extract Validation
**Effort**: 2 hours | **Risk**: Low | **Value**: ⭐⭐⭐ High (DRY, testability, SOLID)

**Changes**:

1. **Extract `chipKey` utility**:
   ```typescript
   // lib/utils.ts (NEW FILE)
   export function chipKey(chip: SearchChip): string {
     return `${chip.field}:${chip.value}`;
   }
   ```
   Use in `use-chips.ts` lines 175, 178.

2. **Extract `removeFocusedChip` helper**:
   ```typescript
   // Inside FilterBarInner
   const removeFocusedChip = useCallback(() => {
     removeChip(focusedChipIndex);
     setFocusedChipIndex(chips.length === 1 ? -1 : Math.min(focusedChipIndex, chips.length - 2));
   }, [focusedChipIndex, removeChip, chips.length]);
   ```
   Replace duplicate logic at lines 150-153 and 159-161.

3. **Extract `commitAndReset` helper**:
   ```typescript
   const commitAndReset = useCallback(() => {
     setInputValue("");
     setIsOpen(false);
     inputRef.current?.focus();
   }, [setInputValue, setIsOpen, inputRef]);
   ```
   Replace 4 occurrences (lines 94-96, 113-114, 179-181).

4. **Use `selectableSuggestions` from hook**:
   ```typescript
   // In filter-bar.tsx, replace:
   const selectables = useMemo(() => suggestions.filter((s) => s.type !== "hint"), [suggestions]);

   // With:
   const { parsedInput, suggestions, selectableSuggestions: selectables, flatPresets } = useSuggestions({...});
   ```
   Requires restoring `selectableSuggestions` return (but NOT `totalNavigableCount`).

5. **Extract validation logic to pure function**:
   ```typescript
   // lib/validation.ts (NEW FILE)
   interface ValidationResult {
     valid: boolean;
     error?: string;
   }

   export function validateChip<T>(
     field: SearchField<T>,
     value: string,
     data: T[]
   ): ValidationResult {
     // Custom validation from field config
     if (field.validate) {
       const customError = field.validate(value);
       if (customError) {
         return { valid: false, error: customError };
       }
     }

     // Valid-value checking for exhaustive fields
     if (field.requiresValidValue) {
       const validValues = field.getValues?.(data) ?? [];
       const isValid = validValues.some(v => v.value === value);
       if (!isValid) {
         return {
           valid: false,
           error: `"${value}" is not a valid ${field.label.toLowerCase()}`,
         };
       }
     }

     return { valid: true };
   }
   ```

   Then update `addChip` in `use-chips.ts` to use this pure function:
   ```typescript
   const addChip = useCallback(
     (field: SearchField<T>, value: string): boolean => {
       // Use pure validation function
       const validationResult = validateChip(field, value, data);
       if (!validationResult.valid) {
         setValidationError(validationResult.error!);
         return false;
       }

       // ... rest of addChip logic (resolution, dedup, dispatch)
     },
     [data, chips, onChipsChange, setValidationError],
   );
   ```

   **Benefits**:
   - Validation logic is now independently testable (no hook setup needed)
   - Clear separation: validation vs. chip CRUD operations
   - Can reuse `validateChip` in other contexts (e.g., bulk import validation)

**Files Created**:
- `src/components/filter-bar/lib/validation.ts`

**Files Modified**:
- `src/components/filter-bar/lib/utils.ts` (NEW)
- `src/components/filter-bar/hooks/use-chips.ts`
- `src/components/filter-bar/filter-bar.tsx`
- `src/components/filter-bar/hooks/use-suggestions.ts`

---

### Phase 4: Extract Internal Sub-Components
**Effort**: 3 hours | **Risk**: Low | **Value**: ⭐⭐⭐ High (readability, maintainability)

**Create 3 internal components** (NOT exported from `index.ts`):

#### 4.1 FilterInput Component

**File**: `src/components/filter-bar/components/FilterInput.tsx`

**Responsibility**: Input container with chips, clear button, results count, validation error

**Extract from**: `filter-bar.tsx` lines 325-399 (the `CommandInput` container)

**Props**:
```typescript
interface FilterInputProps {
  chips: SearchChip[];
  inputValue: string;
  placeholder?: string;
  resultsCount?: { total: number; filtered?: number };
  validationError: string | null;
  focusedChipIndex: number;
  isOpen: boolean;
  inputRef: RefObject<HTMLInputElement>;
  onInputChange: (value: string) => void;
  onChipRemove: (index: number) => void;
  onClearAll: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onFocus: () => void;
}
```

**Contents**:
- Input element
- Chips row (map over chips → `<ChipLabel>`)
- Clear all button (conditional)
- Results count display (conditional)
- Validation error message

#### 4.2 FilterDropdown Component

**File**: `src/components/filter-bar/components/FilterDropdown.tsx`

**Responsibility**: Dropdown content (presets, hints, suggestions, footer)

**Extract from**: `filter-bar.tsx` lines 410-515 (inside `CommandList`)

**Props**:
```typescript
interface FilterDropdownProps<T> {
  presets?: SearchPreset[];
  hints: Suggestion[];
  suggestions: Suggestion[];
  validationError: string | null;
  onSelect: (value: string) => void;
  isPresetActive: (preset: SearchPreset) => boolean;
}
```

**Contents**:
- Presets section (`CommandGroup` with preset buttons)
- Hints section (`CommandGroup` with hint items)
- Suggestions section (`CommandGroup` for each field)
- Footer with keyboard shortcuts
- Loading states (if suggestions are still computing)

#### 4.3 ValidationMessage Component

**File**: `src/components/filter-bar/components/ValidationMessage.tsx`

**Responsibility**: Error message with ARIA live region

**Props**:
```typescript
interface ValidationMessageProps {
  error: string | null;
}
```

**Implementation**:
```tsx
export function ValidationMessage({ error }: ValidationMessageProps) {
  if (!error) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mt-1 text-xs text-red-600 dark:text-red-400"
    >
      {error}
    </div>
  );
}
```

**After Phase 4**, `filter-bar.tsx` should be ~100 lines:
```tsx
function FilterBarInner<T>(props: FilterBarProps<T>) {
  // State (10 lines)
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  // ...

  // Hooks (10 lines)
  const chipOps = useChips({...});
  const { suggestions, selectables, hints } = useSuggestions({...});
  const handleKeyDown = useFilterKeyboard({...});

  // Handlers (30 lines)
  const handleSelect = useCallback(...);
  const handleInputChange = useCallback(...);
  // ...

  // Render (50 lines)
  return (
    <div className="relative">
      <Command shouldFilter={false}>
        <FilterInput {...inputProps} />
        {showDropdown && (
          <>
            <FilterBackdrop onClick={handleBackdropClick} />
            <FilterDropdown {...dropdownProps} />
          </>
        )}
      </Command>
      <ValidationMessage error={validationError} />
    </div>
  );
}
```

**Files Created**:
- `src/components/filter-bar/components/FilterInput.tsx`
- `src/components/filter-bar/components/FilterDropdown.tsx`
- `src/components/filter-bar/components/ValidationMessage.tsx`
- `src/components/filter-bar/components/FilterBackdrop.tsx`

**Files Modified**:
- `src/components/filter-bar/filter-bar.tsx` (523 → ~100 lines)
- `src/components/filter-bar/components.tsx` (delete, split into separate files)

---

### Phase 5: Accessibility Improvements
**Effort**: 2 hours | **Risk**: Low | **Value**: ⭐⭐⭐ High (a11y compliance)

**Changes**:

1. **Add chip ARIA roles** (in `ChipLabel.tsx`):
   ```tsx
   <span
     role="option"
     aria-selected={isFocused}
     aria-label={`Filter: ${chip.label}. Press Delete or Backspace to remove.`}
     tabIndex={isFocused ? 0 : -1}
     className={cn(chipStyles.chip, isFocused && "ring-2 ring-ring")}
   >
   ```

2. **Use dynamic listbox ID** (in `filter-bar.tsx`):
   ```tsx
   const listboxId = useId();

   <CommandInput aria-controls={listboxId} />
   <CommandList id={listboxId}>
   ```

3. **Add validation live region** (already in `ValidationMessage.tsx` from Phase 4):
   ```tsx
   <div role="alert" aria-live="assertive">
   ```

4. **Announce results count** (in `FilterInput.tsx`):
   ```tsx
   useEffect(() => {
     if (resultsCount && resultsCount.filtered !== undefined) {
       announcer.announce(
         `${resultsCount.filtered} of ${resultsCount.total} results`,
         "polite"
       );
     }
   }, [resultsCount, announcer]);
   ```

5. **Announce chip removal** (in `filter-bar.tsx`):
   ```tsx
   const handleChipRemove = useCallback((index: number) => {
     const removedLabel = chips[index].label;
     removeChip(index);
     announcer.announce(`Removed filter: ${removedLabel}`, "polite");
   }, [chips, removeChip, announcer]);
   ```

6. **Ensure focus on last chip removal** (in keyboard hook):
   ```tsx
   if (chips.length === 1) {
     inputRef.current?.focus();
   }
   ```

**Integration**:
- Import `useServices` from `@/hooks/use-services` (or create if doesn't exist)
- Pass `announcer` to FilterBar via services context

**Files Modified**:
- `src/components/filter-bar/components/ChipLabel.tsx`
- `src/components/filter-bar/components/FilterInput.tsx`
- `src/components/filter-bar/filter-bar.tsx`
- `src/components/filter-bar/hooks/use-filter-keyboard.ts`

---

### Phase 6: Design Token Migration
**Effort**: 1 hour | **Risk**: Low | **Value**: ⭐ Low (nice-to-have)

**Changes in `styles.ts`**:

Replace hardcoded color classes with design system tokens:

| Before | After |
|--------|-------|
| `text-blue-600` | `text-primary` |
| `bg-blue-100` | `bg-primary/10` |
| `text-blue-700 dark:text-blue-300` | `text-primary` (theme-aware) |
| `ring-2 ring-blue-500` | `ring-2 ring-ring` (uses `focus-nvidia` pattern) |
| `text-red-500` | `text-destructive` |
| `bg-red-50` | `bg-destructive/10` |

**Verify** that `animate-shake` respects `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  .animate-shake {
    animation: none;
  }
}
```

**Files Modified**:
- `src/components/filter-bar/styles.ts`
- `src/styles/utilities.css` (add reduced-motion guard if missing)

---

### Phase 7: Async Suggestions Infrastructure (Future - PoolSection Use Case)
**Effort**: 3 hours | **Risk**: Medium | **Value**: ⭐⭐ Medium (enables lazy loading)

**This phase is for the PoolSection single-select use case** (the original driver for this refactor).

**Add `isLoading` prop to `SearchField<T>`**:
```typescript
interface SearchField<T> {
  // ... existing props
  isLoading?: boolean; // NEW: display loading state for this field's suggestions
}
```

**Update FilterDropdown to show loading state**:
```tsx
// In FilterDropdown.tsx
{field.isLoading ? (
  <CommandGroup heading={field.label}>
    <CommandLoading>
      <Loader2 className="size-4 animate-spin" />
      <span>Loading {field.label.toLowerCase()}...</span>
    </CommandLoading>
  </CommandGroup>
) : (
  <CommandGroup heading={field.label}>
    {suggestions.map(s => <CommandItem key={s.value}>{s.label}</CommandItem>)}
  </CommandGroup>
)}
```

**Parent component usage** (e.g., PoolSection):
```tsx
const [open, setOpen] = useState(false);
const { pools, isLoading } = usePoolNames(open); // Lazy load when dropdown opens

<Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger asChild>
    <Button>{selectedPool?.name ?? "Select pool..."}</Button>
  </PopoverTrigger>
  <PopoverContent>
    <FilterBar
      mode="single-select" // NEW prop (optional, future)
      fields={[
        {
          key: "pool",
          label: "Pool",
          type: "select",
          getValues: () => pools.map(p => ({ value: p.name, label: p.name })),
          isLoading, // Pass loading state
        }
      ]}
      chips={chips}
      onChipsChange={onChipsChange}
    />
  </PopoverContent>
</Popover>
```

**Hook for lazy loading** (in adapter layer):
```typescript
// src/lib/api/adapter/hooks.ts
export function usePoolNames(enabled: boolean = false) {
  const query = useQuery({
    queryKey: ["pools", "names"] as const,
    queryFn: async () => {
      const pools = await fetchAllPools();
      return pools.map(p => p.name);
    },
    staleTime: QUERY_STALE_TIME_EXPENSIVE_MS, // 5 minutes
    enabled, // Only fetch when enabled=true
  });

  return {
    pools: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}
```

**Optional: Add `mode` prop for single-select behavior**:
```typescript
interface FilterBarProps<T> {
  mode?: "multi-chip" | "single-select"; // Default: "multi-chip"
  // ...
}
```

If `mode="single-select"`:
- Hide chips row (or show single chip)
- Hide "Clear all" button
- Auto-close dropdown on selection
- Use `useSingleSelectChips` hook internally

**Files Modified**:
- `src/components/filter-bar/lib/types.ts` (add `isLoading` to `SearchField`)
- `src/components/filter-bar/components/FilterDropdown.tsx` (add loading state rendering)
- `src/components/filter-bar/filter-bar.tsx` (optional: add `mode` prop handling)
- `src/lib/api/adapter/hooks.ts` (add `usePoolNames`, `useResourceNames`, etc.)

**Files Created**:
- `src/components/filter-bar/hooks/use-single-select-chips.ts` (optional, for single-select mode)

---

## Change Summary Tables

### Files to Modify

| File | Current Lines | After Refactor | Reason |
|------|---------------|----------------|--------|
| `filter-bar.tsx` | 523 | ~120 | Extract sub-components, keyboard hook |
| `use-suggestions.ts` | 278 | 270 | Remove dead return values |
| `use-chips.ts` | 207 | 200 | Inline `getPresetChips`, use `chipKey` utility |
| `styles.ts` | 92 | 85 | Remove dead styles, migrate to design tokens |
| `components.tsx` | 107 | DELETE | Split into separate component files |
| `types.ts` | 230 | 235 | Add `isLoading` to `SearchField` (Phase 7) |

### Files to Create

| File | Lines | Purpose |
|------|-------|---------|
| `hooks/use-filter-keyboard.ts` | ~100 | Extract keyboard handler logic |
| `lib/utils.ts` | ~10 | Utilities (`chipKey`, etc.) |
| `lib/validation.ts` | ~40 | Pure validation logic (Phase 3) |
| `components/FilterInput.tsx` | ~80 | Input container with chips |
| `components/FilterDropdown.tsx` | ~120 | Dropdown content (presets, hints, suggestions) |
| `components/ValidationMessage.tsx` | ~20 | Error display with ARIA |
| `components/FilterBackdrop.tsx` | ~10 | Backdrop overlay |
| `components/ChipLabel.tsx` | ~60 | Extract from `components.tsx` |
| `components/PresetContent.tsx` | ~50 | Extract from `components.tsx` |
| `hooks/use-single-select-chips.ts` | ~30 | Single-select variant (Phase 7) |

**Total New Files**: 10
**Total Deleted Files**: 2 (`components.tsx`, `hotkeys.ts`)
**Net File Count**: +8 files

### Lines of Code Impact

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| **Total LOC** | ~1,600 | ~1,450 | -150 lines (9% reduction) |
| **Longest File** | 523 (`filter-bar.tsx`) | ~120 (`filter-bar.tsx`) | -403 lines (77% reduction) |
| **Dead Code** | ~50 lines | 0 | -50 lines |
| **Duplicate Code** | ~30 lines | 0 | -30 lines |
| **Test Coverage** | 16% (only `filter.ts`) | Target: 60% | +44% |

---

## Risk Assessment

| Phase | Risk Level | Mitigation |
|-------|-----------|------------|
| **Phase 1: Code Cleanup** | 🟢 None | Dead code removal has zero behavior impact |
| **Phase 2: Keyboard Hook** | 🟡 Low | Comprehensive test suite for extracted hook |
| **Phase 3: Deduplication** | 🟢 None | Pure refactor, no logic changes |
| **Phase 4: Sub-Components** | 🟡 Low | Visual regression tests, no prop API changes |
| **Phase 5: Accessibility** | 🟡 Low | Test with screen readers (NVDA, VoiceOver) |
| **Phase 6: Design Tokens** | 🟢 None | Visual-only change, no behavior impact |
| **Phase 7: Async** | 🟠 Medium | Requires new hook integration, test lazy loading edge cases |

**Overall Risk**: 🟡 Low to Medium

**High-Risk Areas**:
- Keyboard handler extraction (90+ lines of complex logic)
- Async infrastructure (new data flow pattern)

**Risk Controls**:
- Unit tests for keyboard hook (all 7 key handlers)
- Integration tests for FilterBar (existing E2E tests in workflows page)
- Visual regression tests for sub-component extraction
- Accessibility audit with screen readers

---

## Testing Strategy

### Unit Tests (Vitest)

**New test files**:

1. **`use-filter-keyboard.test.ts`** (Phase 2)
   - Test each key handler independently (ArrowLeft, ArrowRight, Backspace, Delete, Enter, Tab, Escape)
   - Test edge cases (empty chips, focused chip at start/end, no selectables, etc.)
   - Test state transitions (focus movement, chip removal, input commit)

2. **`use-single-select-chips.test.ts`** (Phase 7)
   - Test single-select behavior (replaces chip instead of adding)
   - Test empty state handling
   - Test validation errors

3. **`lib/utils.test.ts`** (Phase 3)
   - Test `chipKey()` utility
   - Test any other extracted utilities

**Existing tests to update**:
- `filter.test.ts` (no changes needed)

**Target Coverage**: 60% (up from 16%)

### Integration Tests (Playwright)

**Existing tests** (no changes needed):
- `e2e/journeys/workflows.spec.ts` - Workflows page with FilterBar via TableToolbar
- Filters continue to work end-to-end through refactor

**New tests** (recommended):
- Keyboard navigation test (Arrow keys, Backspace, Delete, Enter, Tab, Escape)
- Accessibility test (screen reader announcements, ARIA roles)
- Async loading test (lazy load suggestions, loading states)

### Manual Testing Checklist

**Regression tests** (after each phase):
- [ ] Pools page filters work (status, platform, quota, etc.)
- [ ] Resources page filters work (type, platform, gpu, etc.)
- [ ] Workflows page filters work (status, pool, user, etc.)
- [ ] Tasks page filters work (status, node, ip, etc.)
- [ ] LogViewer filters work (level, source, task, etc.)
- [ ] Presets activate/deactivate correctly
- [ ] Results count updates on filter changes
- [ ] Clear all button works
- [ ] Keyboard shortcuts work (documented in footer)

**Accessibility tests** (Phase 5):
- [ ] Screen reader announces filter changes (NVDA on Windows, VoiceOver on macOS)
- [ ] Screen reader announces chip removal
- [ ] Screen reader announces validation errors
- [ ] Keyboard-only navigation works (Tab, Arrow keys, Enter, Escape)
- [ ] Focus visible on all interactive elements
- [ ] Focus returns to input after chip removal

---

## Performance Considerations

### Current Performance Profile

**FilterBar render time** (measured with React DevTools Profiler):
- Initial render: ~5ms
- Re-render on input change: ~2ms
- Re-render on chip add/remove: ~3ms

**Current optimization techniques**:
- `memo()` on FilterBar export
- `useMemo()` on all computed values (suggestions, selectables, hints)
- `useCallback()` on all handlers
- cmdk Command component provides built-in virtualization for long suggestion lists

### Phase 4 Impact (Sub-Component Extraction)

**Potential concern**: More component boundaries = more reconciliation checkpoints

**Mitigation**:
- Sub-components are internal (not exported) → React Compiler can optimize across boundaries
- Sub-components will be wrapped in `memo()` with explicit prop dependencies
- State lift is minimal (all state already in parent)

**Expected impact**: **Neutral to slight improvement**
- Fewer lines in parent component → faster reconciliation of unchanged parts
- React 19 Compiler auto-memoizes within components → fewer manual memoization needs

### Phase 7 Impact (Async Infrastructure)

**Potential concern**: Lazy loading on dropdown open could cause UI jank

**Mitigation**:
- Use React Query with 5-minute `staleTime` → subsequent opens are instant
- Show loading spinner immediately (no suspense boundary)
- Prefetch on hover over trigger button (optional future enhancement)

**Expected impact**: **Improvement**
- Current: Pools page fetches all pools on mount (~100KB response)
- After: PoolSection fetches only when dropdown opens (~10KB response)
- Net: Faster initial page load, same or better UX for dropdown interaction

---

## Migration Guide for Consumers

### For Most Consumers: No Changes Needed ✅

The public API of `<FilterBar>` **remains unchanged** through Phase 1-6. If you use FilterBar via `TableToolbar` or directly, **no code changes required**.

### For New Async Use Cases (Phase 7)

**Before** (current pattern - fetch on mount):
```tsx
const { pools } = usePools(); // Always fetches

<Select>
  {pools.map(p => <SelectItem key={p.name} value={p.name} />)}
</Select>
```

**After** (lazy load on open):
```tsx
const [open, setOpen] = useState(false);
const { pools, isLoading } = usePoolNames(open); // Only fetches when open=true

<Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger>Select pool...</PopoverTrigger>
  <PopoverContent>
    <FilterBar
      fields={[
        {
          key: "pool",
          label: "Pool",
          getValues: () => pools.map(p => ({ value: p.name, label: p.name })),
          isLoading, // NEW: Pass loading state
        }
      ]}
      chips={chips}
      onChipsChange={onChipsChange}
    />
  </PopoverContent>
</Popover>
```

**New hooks to create** (in adapter layer):
- `usePoolNames(enabled)` - Returns pool names for filters
- `useResourceTypes(enabled)` - Returns resource types for filters
- `useUserNames(enabled)` - Returns user names for filters
- `useWorkflowTags(enabled)` - Returns workflow tags for filters (future)

---

## Specialist Validation Summary

### React State Architect Review ✅

**Key Findings**:
- Current architecture (headless hooks + render layer) is optimal for React 19
- Proposed 10-primitive decomposition was over-engineering
- Hook composition (`useSingleSelectChips`) is the right pattern for variants
- State should flow via props, not Context (tree is 2 levels deep)
- TanStack Query integration should stay in parent, not inside FilterBar

**Recommendations Adopted**:
- ✅ Keep single FilterBar component as public API
- ✅ Extract keyboard handler to hook (testability win)
- ✅ Use explicit composition, not compound components
- ✅ Add async support via `isLoading` prop, not Provider wrapper

### UI Component Architect Review ✅

**Key Findings**:
- 3 internal sub-components is the right level of granularity (not 6+ primitives)
- Compound component pattern not needed (no consumer rearranges layout)
- Hardcoded colors should migrate to design system tokens
- 6 accessibility gaps identified (chip roles, announcements, focus management)

**Recommendations Adopted**:
- ✅ Extract FilterInput, FilterDropdown, ValidationMessage (not exported)
- ✅ Migrate `styles.ts` to design tokens (Phase 6)
- ✅ Add ARIA roles, live regions, announcements (Phase 5)
- ✅ Use explicit composition (parent passes props to sub-components)

### Code Simplifier Review ✅

**Key Findings**:
- 50 lines of dead code identified
- 30 lines of duplicate code identified
- 90-line keyboard handler is highest complexity hotspot (15+ branches)
- `addChip` function mixes 5 concerns (validation, resolution, dedup, error, dispatch)

**Recommendations Adopted**:
- ✅ Remove all dead code (Phase 1)
- ✅ Extract duplicate patterns (`chipKey`, `removeFocusedChip`, `commitAndReset`)
- ✅ Extract keyboard handler to hook (Phase 2)
- ✅ Consider extracting validation logic from `addChip` (future optimization)

---

## Success Metrics

### Code Quality Metrics

| Metric | Before | Target | How to Measure |
|--------|--------|--------|----------------|
| **Lines in longest file** | 523 | <150 | `wc -l filter-bar.tsx` |
| **Cyclomatic complexity** | 15+ (handleKeyDown) | <8 | ESLint complexity rule |
| **Test coverage** | 16% | >60% | Vitest coverage report |
| **Dead code** | 50 lines | 0 | Manual audit |
| **Duplicate code** | 30 lines | 0 | Manual audit |

### User-Facing Metrics

| Metric | Before | Target | How to Measure |
|--------|--------|--------|----------------|
| **Initial render time** | 5ms | <5ms | React DevTools Profiler |
| **Re-render on input** | 2ms | <2ms | React DevTools Profiler |
| **Accessibility score** | Unknown | 100 | Lighthouse / axe DevTools |
| **Keyboard nav coverage** | 7/7 keys | 7/7 keys | Manual test checklist |
| **Screen reader compat** | Partial | Full | NVDA/VoiceOver test |

### Behavioral Metrics (No Regression)

| Scenario | Expected Behavior | Test Method |
|----------|-------------------|-------------|
| **Pools page filters** | All filters work identically | Playwright E2E |
| **Resources page filters** | All filters work identically | Playwright E2E |
| **Workflows page filters** | All filters work identically | Playwright E2E |
| **Preset activation** | Presets activate/deactivate correctly | Manual checklist |
| **Results count** | Updates on every filter change | Manual checklist |
| **URL sync** | Filters persist to URL query params | Manual checklist |

---

## Decisions Made ✅

All architectural questions have been resolved. Here are the final decisions:

### Decision 1: Delete `hotkeys.ts` (Reduce Dead Code)

**Rationale**: The file is never imported at runtime. Constants are referenced only via comments. Keeping documentation-only code creates maintenance burden and confuses developers about what's actually used.

**Action in Phase 1**:
- Delete `src/components/filter-bar/hotkeys.ts`
- If hotkey palette is added in future, recreate with actual runtime usage

---

### Decision 2: Extract Validation Logic to Pure Function

**Rationale**: The `addChip` function currently mixes 5 concerns (validation, resolution, dedup, error handling, dispatch). Extracting validation as a pure function improves testability and adheres to Single Responsibility Principle.

**Action in Phase 3 (extended)**:

Create `lib/validation.ts`:
```typescript
interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateChip<T>(
  field: SearchField<T>,
  value: string,
  data: T[]
): ValidationResult {
  // Custom validation from field config
  if (field.validate) {
    const customError = field.validate(value);
    if (customError) {
      return { valid: false, error: customError };
    }
  }

  // Valid-value checking for exhaustive fields
  if (field.requiresValidValue) {
    const validValues = field.getValues?.(data) ?? [];
    const isValid = validValues.some(v => v.value === value);
    if (!isValid) {
      return {
        valid: false,
        error: `"${value}" is not a valid ${field.label.toLowerCase()}`,
      };
    }
  }

  return { valid: true };
}
```

Then update `addChip` in `use-chips.ts` to use this pure function.

**Testing benefit**: Can test all validation edge cases without hook setup.

---

### Decision 3: Single-Select via Hook Composition (No `mode` Prop)

**Rationale**: Hook composition is the React 19 way. Avoids adding conditional branching to FilterBar. Keeps component simple and focused. If multiple consumers emerge needing single-select, we can add a `mode` prop later without breaking existing code.

**Action in Phase 7**:

Create `hooks/use-single-select-chips.ts`:
```typescript
export function useSingleSelectChips<T>(options: UseChipsOptions<T>) {
  const chipOps = useChips(options);

  const addChip = useCallback(
    (field: SearchField<T>, value: string): boolean => {
      // Clear existing chips for this field before adding new one
      const withoutField = options.chips.filter(c => c.field !== field.id);
      options.onChipsChange(withoutField);
      return chipOps.addChip(field, value);
    },
    [chipOps, options],
  );

  return { ...chipOps, addChip };
}
```

Usage in PoolSection:
```tsx
const chipOps = useSingleSelectChips({ chips, onChipsChange, fields, data });
<FilterBar {...chipOps} />
```

**No `mode` prop added to FilterBar** - keeps API surface minimal.

---

### Decision 4: Document Async Loading as Public Feature

**Rationale**: The `isLoading` prop on `SearchField<T>` is a valuable feature that enables lazy loading for any filter field. Documenting it encourages adoption and helps other developers leverage the pattern for resources, users, tags, etc.

**Action in Phase 7**:

1. Add section to FilterBar README:
   ```markdown
   ## Async Filter Fields

   FilterBar supports lazy loading for filter suggestions. Pass `isLoading: true` to show
   loading state while data is being fetched:

   ```tsx
   const [open, setOpen] = useState(false);
   const { pools, isLoading } = usePoolNames(open); // TanStack Query hook

   <FilterBar
     fields={[
       {
         key: "pool",
         label: "Pool",
         getValues: () => pools.map(p => ({ value: p.name, label: p.name })),
         isLoading, // Shows spinner in dropdown
       }
     ]}
   />
   ```
   ```

2. Add JSDoc to `SearchField<T>` type:
   ```typescript
   interface SearchField<T> {
     // ... existing props

     /**
      * Whether this field's suggestions are currently loading.
      * When true, displays a loading spinner in the dropdown.
      * Use with TanStack Query's `isLoading` flag for lazy loading.
      */
     isLoading?: boolean;
   }
   ```

3. Create example hooks in adapter layer:
   - `usePoolNames(enabled)` - Pool name suggestions
   - `useResourceTypes(enabled)` - Resource type suggestions
   - `useUserNames(enabled)` - User name suggestions

**Benefit**: Enables other pages to adopt lazy loading pattern, reducing initial page load times.

---

## Conclusion

This refactor plan is **pragmatic and incremental**. Unlike the original v1 plan (10+ primitives, Provider wrappers, separate compositions), this approach:

✅ **Preserves the strong foundation** - Current architecture is already well-designed
✅ **Targets real pain points** - 90-line keyboard handler, duplicate code, dead code
✅ **Maintains compatibility** - Public API unchanged through Phase 1-6
✅ **Delivers testability** - Extracted hooks can be unit tested independently
✅ **Improves accessibility** - ARIA roles, announcements, focus management
✅ **Enables async** - Lazy loading for PoolSection use case (Phase 7)

**Estimated Total Effort**: 13 hours (1.6 days)
**Risk Level**: Low to Medium
**Value**: High (code quality, testability, maintainability, accessibility)

**Next Step**: Begin Phase 1 (Code Cleanup) after plan approval.
