# Dead Code -- Skipped Files
Files with 0 production importers but skipped for valid reasons.

src/actions/mock-config.ts -- server action ("use server") for dev mock mode, invoked by MockProvider.tsx which is aliased to no-op in production -- 2026-02-21
src/actions/mock-config.types.ts -- types file shared between mock-config.ts and mock infrastructure -- 2026-02-21
src/components/dag/layout/layout.ts -- 0 production importers (only layout.test.ts imports); substantial generic DAG layout utility (~295 lines) duplicated in workflow-detail dag-layout.ts; has companion test file that would break if deleted -- 2026-02-21
src/contexts/config-context.tsx (exports: useConfig, ConfigContext, TableConfig, PanelConfig, ViewportConfig, TimingConfig, ConfigProviderProps) -- 0 external importers but intentional public API surface for context module -- 2026-02-21
src/components/copyable-value.tsx (exports: CopyButtonProps, CopyableValueProps, CopyableBlockProps) -- Props interfaces with 0 external importers; standard React pattern to export component prop types for consumer typing -- 2026-02-21
src/components/inline-progress.tsx (export: InlineProgressProps) -- Props interface with 0 external importers; standard React pattern -- 2026-02-21
src/components/capacity-bar.tsx (export: CapacityBarProps) -- Props interface with 0 external importers; standard React pattern -- 2026-02-21
src/components/boolean-indicator.tsx (export: BooleanIndicatorProps) -- Props interface with 0 external importers; standard React pattern -- 2026-02-21
src/components/expandable-chips.tsx (export: ExpandableChipsProps) -- Props interface with 0 external importers; standard React pattern -- 2026-02-21
src/components/item-selector.tsx (export: ItemSelectorProps) -- Props interface with 0 external importers; standard React pattern -- 2026-02-21
