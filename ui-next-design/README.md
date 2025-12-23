# ✈️ OSMO UI Flight Kit

**Offline reference material for working with local LLMs on the `ui-next` codebase.**

## Quick Start

1. **Start Ollama** (before your flight):
   ```bash
   ollama serve
   ```

2. **Pull your model** (do this on WiFi!):
   ```bash
   ollama pull qwen2.5-coder:14b
   ```

3. **Test it works**:
   ```bash
   ollama run qwen2.5-coder:14b "Write a React useState hook"
   ```

> 📖 **Full setup guide**: See [`docs/OLLAMA-SETUP.md`](docs/OLLAMA-SETUP.md) for complete installation, Cursor integration, and troubleshooting.

---

## What's in This Kit

```
ui-next-design/
├── docs/
│   ├── OLLAMA-SETUP.md  # ⭐ Complete Ollama + Cursor setup guide
│   ├── PATTERNS.md      # Architecture & component patterns
│   ├── CONVENTIONS.md   # Styling, naming, TypeScript conventions
│   ├── PROMPTS.md       # Copy-paste prompts optimized for local LLMs
│   └── QUICK-REF.md     # Print this! Import cheatsheet & patterns
│
└── examples/
    ├── components/
    │   └── example-table-component.tsx   # Themed component pattern
    ├── hooks/
    │   ├── example-headless-hook.ts      # Business logic hook pattern
    │   └── example-adapter-hook.ts       # API adapter hook pattern
    └── tests/
        ├── example-e2e-test.spec.ts      # E2E test pattern
        └── example-factories.ts          # Mock data factory pattern
```

---

## How to Use with Local LLMs

### For New Components

1. Open `docs/PROMPTS.md` → Find "Creating a New Component"
2. Copy the prompt template
3. Paste an example from `examples/components/` as context
4. Fill in what you want to build
5. Paste into Ollama/LM Studio

### For New Hooks

1. Open `docs/PROMPTS.md` → Find "Creating a Headless Hook"
2. Copy the prompt template
3. Paste an example from `examples/hooks/` as context
4. Describe your hook's behavior
5. Paste into Ollama

### For E2E Tests

1. Open `docs/PROMPTS.md` → Find "Creating an E2E Test"
2. Copy the prompt template
3. Paste an example from `examples/tests/` as context
4. Describe your test scenario
5. Paste into Ollama

---

## Tips for Working Offline

### 1. Break Work Into Small Chunks

Local models work best on focused, single-file tasks:
- ✅ "Add a toggle filter to this component"
- ✅ "Write a test for this scenario"
- ❌ "Refactor the entire resource table and update all pages"

### 2. Provide Context Explicitly

Always paste relevant code into your prompt:
```
Here's my existing component:
[paste code]

Now add [specific feature]
```

### 3. Use the Example Files

Before asking for something new, check if there's a similar example:
- Building a table? → `examples/components/example-table-component.tsx`
- Adding filters? → `examples/hooks/example-headless-hook.ts`
- Writing tests? → `examples/tests/example-e2e-test.spec.ts`

### 4. Reference the Conventions

If output doesn't follow project style, paste from `docs/CONVENTIONS.md`:
```
Please follow these styling conventions:
[paste relevant section]

Now update your output.
```

---

## Recommended Workflow

1. **Plan** what you want to build
2. **Find** a similar example in `examples/`
3. **Copy** a prompt template from `docs/PROMPTS.md`
4. **Paste** the example + fill in placeholders
5. **Generate** with Ollama
6. **Review** and iterate (local models may need 2-3 tries)
7. **Test** the result

---

## Commands Reference

```bash
# Start dev server
pnpm dev

# Run unit tests
pnpm test

# Run E2E tests
pnpm test:e2e

# Build
pnpm build

# Lint
pnpm lint

# Format
pnpm format
```

---

## Have a Good Flight! ✈️

Remember:
- Local models are ~70-80% as capable as Claude for focused tasks
- Break big work into small pieces
- Use examples liberally - local models learn well from patterns
- When in doubt, check `docs/CONVENTIONS.md`
