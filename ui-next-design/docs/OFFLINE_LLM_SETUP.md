# Offline LLM Setup for UI Design Work

> **Purpose**: Guide for working with local LLMs during offline development sessions
> **Hardware**: M3 MacBook Air 24GB RAM
> **Last Updated**: December 2025

---

## Recommended Ollama Models

### Tier 1: Primary Models (Best for your use case)

| Model | Size | Command | Best For |
|-------|------|---------|----------|
| **Qwen 2.5 Coder 14B** | ~9GB | `ollama pull qwen2.5-coder:14b` | Best code + reasoning balance |
| **DeepSeek Coder V2 Lite** | ~9GB | `ollama pull deepseek-coder-v2:16b` | Excellent at UI/React code |
| **Llama 3.1 8B** | ~5GB | `ollama pull llama3.1:8b` | Fast iteration, good reasoning |

### Tier 2: Creative Exploration

| Model | Size | Command | Best For |
|-------|------|---------|----------|
| **Mistral Nemo 12B** | ~7GB | `ollama pull mistral-nemo` | Creative ideation, broad knowledge |
| **Gemma 2 9B** | ~5GB | `ollama pull gemma2:9b` | Balanced, good at structured output |
| **Phi-3 Medium 14B** | ~8GB | `ollama pull phi3:medium` | Reasoning, fewer hallucinations |

### Tier 3: Quick Iteration

| Model | Size | Command | Best For |
|-------|------|---------|----------|
| **Qwen 2.5 Coder 7B** | ~4GB | `ollama pull qwen2.5-coder:7b` | Fast code generation |
| **CodeGemma 7B** | ~5GB | `ollama pull codegemma:7b` | Code-only tasks |

---

## Pre-Flight Setup

### 1. Install Ollama (if not already)
```bash
brew install ollama
```

### 2. Download Models (do this NOW while online)
```bash
# Primary (must-have)
ollama pull qwen2.5-coder:14b
ollama pull llama3.1:8b

# Secondary (recommended)
ollama pull mistral-nemo
ollama pull deepseek-coder-v2:16b

# Quick iteration fallback
ollama pull qwen2.5-coder:7b
```

### 3. Verify Models Work
```bash
ollama list
ollama run qwen2.5-coder:14b "Write a React component for a status badge"
```

---

## Prompting Strategies for UI Design

### Pattern 1: Explore Options
```
I'm designing a [component]. Here are my constraints:
- [constraint 1]
- [constraint 2]

Give me 3-5 different approaches, comparing their tradeoffs.
Focus on: information hierarchy, interaction patterns, visual design.
```

### Pattern 2: Synthesize Ideas
```
I have these two approaches:
APPROACH A: [description]
APPROACH B: [description]

Synthesize a new approach that combines:
- [specific aspect from A]
- [specific aspect from B]

Generate React/TypeScript code with Tailwind CSS.
```

### Pattern 3: Information Architecture Review
```
Review this entity hierarchy for a [domain] UI:
[paste hierarchy]

Identify:
1. Missing relationships
2. Navigation gaps
3. Progressive disclosure opportunities
4. Cross-cutting concerns
```

### Pattern 4: Component Critique
```
Here's my current component:
[paste code]

Critique it for:
- Information hierarchy (is the most important info visible first?)
- Interaction patterns (are actions discoverable?)
- State communication (is status clear?)
- Accessibility (keyboard nav, screen readers)

Suggest specific improvements with code.
```

### Pattern 5: Generate Variations
```
Here's a workflow list row design:
[paste code]

Generate 3 variations:
1. Minimal/dense version (for power users)
2. Expanded version (with inline actions)
3. Card-based version (for touch/mobile)

Use same data props, just change layout/styling.
```

---

## Context Files to Keep Open

When working with local LLMs, you'll need to provide context since they don't have access to your codebase. Keep these files ready to paste:

### Essential Context
1. `WORKFLOWS_DESIGN.md` - Your design document
2. `INFORMATION_ARCHITECTURE.md` - Entity relationships
3. `REDESIGN_PLAN.md` - Tech stack decisions
4. `docs/PATTERNS.md` - Code patterns

### Component Examples
1. `workflows-mock/page.tsx` - Workflow list mock
2. `workflows-mock/dag/page.tsx` - DAG visualization mock  
3. `workflows-mock/explain/page.tsx` - Status explainers mock

### Data Model Reference
Keep the key types handy:
```typescript
// Workflow statuses
type WorkflowStatus =
  | "PENDING" | "WAITING" | "PROCESSING" | "SCHEDULING"  // Queued
  | "INITIALIZING" | "RUNNING"                           // Running
  | "COMPLETED"                                          // Done
  | "FAILED" | "FAILED_IMAGE_PULL" | "FAILED_EXEC_TIMEOUT" 
  | "FAILED_QUEUE_TIMEOUT" | "FAILED_EVICTED" 
  | "FAILED_PREEMPTED" | "FAILED_UPSTREAM" | "FAILED_CANCELED";

// Core entities
interface Workflow {
  id: string;
  name: string;
  status: WorkflowStatus;
  priority: "LOW" | "NORMAL" | "HIGH";
  pool: string;
  user: string;
  submitTime: Date;
  startTime: Date | null;
  endTime: Date | null;
  queuedTime: number;
  duration: number | null;
  groups: WorkflowGroup[];
  failureMessage?: string;
}

interface WorkflowGroup {
  name: string;
  status: WorkflowStatus;
  tasks: Task[];
  upstreamGroups: string[];
  downstreamGroups: string[];
}

interface Task {
  name: string;
  status: WorkflowStatus;
  startTime: Date | null;
  endTime: Date | null;
  duration: number | null;
  resources: { cpu: number; memory: string; gpu: number; storage: string };
  node: string | null;
  dependsOn: string[];
}
```

---

## Workflow for Offline Ideation

### Phase 1: Diverge (Generate Options)
1. Start with a specific UI problem (e.g., "How to show queue position?")
2. Use Pattern 1 to generate 3-5 approaches
3. Save each as a separate code snippet
4. Don't judge yet - collect variety

### Phase 2: Evaluate & Select
1. Review options against user needs from `WORKFLOWS_DESIGN.md`
2. Score each on: clarity, actionability, visual weight
3. Identify 1-2 winners

### Phase 3: Synthesize & Refine
1. Use Pattern 2 to combine best elements
2. Generate concrete code
3. Iterate on details

### Phase 4: Document Decisions
1. Add to `WORKFLOWS_DESIGN.md` or create new design notes
2. Capture "why" not just "what"
3. Note open questions for later

---

## Mixing Models: A Practical Design Session

The key insight: **Different models excel at different tasks**. Switch between them as you iterate.

### Model Roles

| Model | Role | When to Use |
|-------|------|-------------|
| **llama3.1:8b** | 🎨 Creative Brainstormer | Divergent thinking, wild ideas, exploration |
| **qwen2.5-coder:14b** | 🔧 Code Implementer | Turn ideas into working React code |
| **qwen2.5-coder:7b** | ⚡ Fast Iterator | Quick tweaks, "try this variation" |

### Example Design Session: "Queue Position Indicator"

Here's a real workflow showing how to mix models:

---

#### Step 1: Brainstorm with Llama (Creative)

```bash
ollama run llama3.1:8b
```

**Prompt:**
```
I'm designing a "queue position" indicator for a workflow orchestration UI.
The user submitted a job and it's waiting in a queue.

Give me 5 creative ways to communicate:
1. Their position in line
2. Estimated wait time
3. Why they're waiting (resource constraints)

Think beyond typical progress bars. Consider: anxiety reduction, 
actionable insights, gamification, transparency.
```

**Save the output** to `flight-notes/queue-ideas-brainstorm.md`

---

#### Step 2: Pick 2 Favorites & Get Code with Qwen 14B

```bash
ollama run qwen2.5-coder:14b
```

**Prompt:**
```
I like these two ideas from my brainstorm:

IDEA A: "Live queue visualization" - Show the actual queue as a 
horizontal list of workflow cards, with mine highlighted. As jobs 
complete, cards animate out.

IDEA B: "Resource availability meter" - Show what resources I need 
vs what's available, with a timeline showing when they'll free up.

Generate React + TypeScript + Tailwind components for both.
Use these status colors:
- Queued/waiting: amber-500
- Available: green-500  
- Unavailable: zinc-600

Each component should be self-contained and use mock data.
```

**Save to** `flight-notes/queue-v1-code.tsx`

---

#### Step 3: Quick Variations with Qwen 7B (Fast)

```bash
ollama run qwen2.5-coder:7b
```

**Prompt:**
```
Here's my queue position component:
[paste the component you liked better]

Give me 3 quick variations:
1. More compact (half the height)
2. With an "estimated time" countdown
3. With a "skip the line" upsell button

Just show the changed parts, not the full component.
```

---

#### Step 4: Synthesize with Qwen 14B

```bash
ollama run qwen2.5-coder:14b
```

**Prompt:**
```
I've been iterating on queue position indicators. Here's what I've learned:

KEEPER from v1: The resource availability meter concept
KEEPER from variation 2: The countdown timer
NEW REQUIREMENT: Should collapse to a single line when not focused

Synthesize these into a final component that:
1. Shows compact view by default: "Position #3 • ~15 min wait"
2. Expands on hover/focus to show resource breakdown
3. Uses smooth animations for state changes

Generate the complete React component with TypeScript.
```

---

#### Step 5: Critique with Llama (Fresh Eyes)

```bash
ollama run llama3.1:8b
```

**Prompt:**
```
I designed this queue position indicator for a workflow platform:
[paste your final component]

Critique it from these perspectives:
1. First-time user: Would they understand what this means?
2. Anxious user: Does this reduce or increase anxiety about waiting?
3. Power user: Is there enough detail for someone who wants to optimize?
4. Accessibility: Any issues for screen readers or color blindness?

Be specific about problems and suggest fixes.
```

---

---

## Why Different Models for Different Tasks?

### The Core Tradeoff: Speed vs Capability

| Model | Tokens/sec | Capability | Memory |
|-------|------------|------------|--------|
| **qwen2.5-coder:14b** | ~10-15 | Best reasoning, complex tasks | ~10GB |
| **qwen2.5-coder:7b** | ~25-30 | Good for simple edits | ~5GB |
| **llama3.1:8b** | ~20-25 | Creative, broad knowledge | ~5GB |

### When Model Size Matters

**14B is better** when the task requires:
- Understanding multiple pieces of context
- Making architectural decisions
- Combining ideas in novel ways
- Generating complete components from scratch

**7B is sufficient** when:
- You're making small, specific changes
- The task is mechanical ("change X to Y")
- You want rapid back-and-forth iteration
- You just need syntax help

### Why Llama for Brainstorming?

Llama 3.1 8B has broader training than code-focused models:
- More exposure to design patterns, UX writing, product thinking
- Better at "what if" and exploratory questions
- Good at critique and identifying problems
- Less likely to jump straight to code

Qwen is trained heavily on code, so it:
- Gives better TypeScript/React output
- Understands framework patterns deeply
- But can be "code-brained" - wants to implement, not explore

### The Honest Answer

**You could just use qwen2.5-coder:14b for everything.** It's good enough at all tasks, and simplicity has value.

The multi-model approach is for when:
1. You're doing lots of rapid iteration (7B is 2x faster)
2. You want genuinely different perspectives (Llama thinks differently)
3. Memory matters (running two 7B models is easier than two 14B)

---

## Quick Reference: When to Switch Models

| Task Type | Best Model | Why |
|-----------|------------|-----|
| **Brainstorm ideas** | llama3.1:8b | Broader thinking, less code-focused |
| **Generate component** | qwen2.5-coder:14b | Best code quality |
| **Small tweaks** | qwen2.5-coder:7b | Fast, good enough |
| **Critique/review** | llama3.1:8b | Fresh perspective |
| **Combine approaches** | qwen2.5-coder:14b | Needs reasoning |
| **Explain a pattern** | llama3.1:8b | Better at teaching |
| **Fix syntax/types** | qwen2.5-coder:7b | Fast, mechanical |

---

## Terminal Setup

### Option A: Simple (One Model)
```bash
# Just use the best all-rounder
ollama run qwen2.5-coder:14b
```

### Option B: Full Setup (Multiple Models)
Open 2-3 terminal tabs:
```bash
# Tab 1 - Creative brainstorming & critique
ollama run llama3.1:8b

# Tab 2 - Main code generation
ollama run qwen2.5-coder:14b

# Tab 3 (optional) - Quick iterations
ollama run qwen2.5-coder:7b
```

Switch tabs based on what you're doing. Models stay warm in memory.

---

## Memory Management

Your M3 24GB can handle:
- ✅ One 14B + one 8B model simultaneously
- ✅ Multiple 7B/8B models at once
- ⚠️ Two 14B models = memory pressure, swapping

```bash
# Check what's loaded
ollama ps

# Free up memory by stopping a model
ollama stop qwen2.5-coder:14b

# Models auto-unload after 5min idle by default
```

---

## Pro Tips

1. **Keep terminal tabs open** - faster than reloading models
2. **Copy outputs immediately** - terminal scrollback can get lost
3. **Name files with versions** - `queue-v1.tsx`, `queue-v2-compact.tsx`
4. **Start with Llama, end with Qwen** - brainstorm first, implement last
5. **Use 7B for "yes/no" questions** - it's fast and accurate enough

---

## Sample Prompts for Workflows Page

### Workflow List Row Design
```
Design a workflow list row for a job orchestration platform.

Requirements:
- Show: workflow ID, status, pool, user, timing, task count
- Differentiate: queued vs running vs failed workflows
- Running: show progress (X/Y tasks complete)
- Queued: show queue position and estimated wait
- Failed: show failure type and snippet of error

Tech stack: React + TypeScript + Tailwind CSS
Use shadcn/ui components where appropriate.

Generate the component code.
```

### DAG Node States
```
Design DAG node components for a workflow visualization.

Node types needed:
1. Single task node (one task in group)
2. Multi-task group node (shows aggregated progress)
3. Running task node (with quick actions)
4. Failed task node (shows error preview)

Each node should:
- Clearly show status via color + icon
- Show duration/timing when relevant
- Be clickable to select
- Support visual connections (upstream/downstream edges)

Generate React + Tailwind components.
```

### Status Explainer UI
```
Design a "Why isn't my workflow running?" explainer panel.

Should display:
1. Current status with human-friendly explanation
2. Resource requirements vs pool availability
3. Queue position with estimate
4. Actionable suggestions (try different pool, change priority, etc.)

Make it feel helpful, not just informative.
Use amber/yellow color scheme for queued states.

Generate the React component.
```

---

## Ollama Tips for Long Sessions

### Memory Management
```bash
# Check memory usage
ollama ps

# Stop unused models
ollama stop qwen2.5-coder:14b

# Only run one large model at a time
```

### Faster Responses
- Use 7B models for quick iteration
- Switch to 14B for final polish
- Keep prompts focused (one task at a time)

### Save Good Outputs
- Copy generated code to scratch files immediately
- Create a `flight-notes/` folder for exploration
- Use timestamps in filenames: `dag-node-v1-1230.tsx`

---

## Emergency Fallbacks

If models are too slow or running out of memory:

1. **Switch to smaller model**: `ollama run qwen2.5-coder:7b`
2. **Kill and restart**: `killall ollama && ollama serve`
3. **Reduce context**: Paste less code, be more specific
4. **Use pseudocode**: "Describe the component structure" instead of "Generate full code"

---

## After the Flight

1. Review generated code with better models (Claude, GPT-4)
2. Extract good ideas into `WORKFLOWS_DESIGN.md`
3. Create working prototypes from best concepts
4. Share findings with team

Good luck! 🛫
