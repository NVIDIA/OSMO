# Dead Code -- Skipped Files
Files with 0 production importers but skipped for valid reasons.

src/actions/mock-config.ts -- server action ("use server") for dev mock mode, invoked by MockProvider.tsx which is aliased to no-op in production -- 2026-02-21
src/actions/mock-config.types.ts -- types file shared between mock-config.ts and mock infrastructure -- 2026-02-21
src/components/dag/layout/layout.ts -- 0 production importers (only layout.test.ts imports); substantial generic DAG layout utility (~295 lines) duplicated in workflow-detail dag-layout.ts; has companion test file that would break if deleted -- 2026-02-21
src/contexts/config-context.tsx (exports: useConfig, ConfigContext, TableConfig, PanelConfig, ViewportConfig, TimingConfig, ConfigProviderProps) -- 0 external importers but intentional public API surface for context module -- 2026-02-21
