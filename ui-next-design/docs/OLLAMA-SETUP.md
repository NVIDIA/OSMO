# Ollama Setup & Cursor Integration Guide

> Complete guide for running local LLMs with Ollama and integrating with Cursor.

---

## Part 1: Install Ollama

### macOS (Homebrew)
```bash
brew install ollama
```

### macOS (Direct Download)
1. Go to https://ollama.com/download
2. Download the macOS app
3. Drag to Applications
4. Open Ollama.app (it runs in the menu bar)

### Verify Installation
```bash
ollama --version
# Should output: ollama version 0.x.x
```

---

## Part 2: Download Models (Do This on WiFi!)

### Recommended Models for Your Hardware (M3 24GB)

| Model | Size | Quality | Command |
|-------|------|---------|---------|
| **qwen2.5-coder:14b** | ~9GB | ⭐⭐⭐⭐ Best for coding | `ollama pull qwen2.5-coder:14b` |
| qwen2.5-coder:7b | ~4.5GB | ⭐⭐⭐ Good, faster | `ollama pull qwen2.5-coder:7b` |
| deepseek-coder-v2:16b | ~9GB | ⭐⭐⭐⭐ Great alternative | `ollama pull deepseek-coder-v2:16b` |
| codellama:13b | ~7GB | ⭐⭐⭐ Solid fallback | `ollama pull codellama:13b` |

### Download Your Primary Model
```bash
# This will take a while on first download (~9GB)
ollama pull qwen2.5-coder:14b
```

### Download Backup Model (Smaller, Faster)
```bash
ollama pull qwen2.5-coder:7b
```

### Verify Models Downloaded
```bash
ollama list
# Should show your downloaded models
```

---

## Part 3: Running Ollama

### Start the Ollama Server
```bash
# Start the server (required for Cursor integration)
ollama serve
```

The server runs at `http://localhost:11434` by default.

**Keep this terminal open** - Ollama needs to be running for Cursor to connect.

### Quick Test (New Terminal)
```bash
# Test your model works
ollama run qwen2.5-coder:14b "Write a TypeScript function that adds two numbers"
```

### Offline Test
1. Turn off WiFi
2. Run the same command
3. Should work without internet!

---

## Part 4: Cursor Integration

### Option A: Add Ollama as Custom Model (Recommended)

1. **Open Cursor Settings**
   - Press `Cmd + ,` (or Cursor → Settings)
   - Or click the gear icon

2. **Go to Models Section**
   - Click "Models" in the left sidebar

3. **Add Custom Model**
   - Scroll to "OpenAI API Key" or "Custom Models" section
   - Look for "Add Model" or "Custom API"

4. **Configure the Model**
   ```
   Model Name: qwen2.5-coder (or any name you like)
   API Base URL: http://localhost:11434/v1
   API Key: ollama (or leave blank, Ollama doesn't require one)
   ```

5. **Select the Model**
   - In the Cursor AI chat, click the model dropdown
   - Select your custom model

### Option B: Use Continue Extension (Alternative)

1. Install the "Continue" extension in Cursor/VS Code
2. Configure it to use Ollama:
   
   In `~/.continue/config.json`:
   ```json
   {
     "models": [
       {
         "title": "Qwen 2.5 Coder",
         "provider": "ollama",
         "model": "qwen2.5-coder:14b"
       }
     ]
   }
   ```

---

## Part 5: Usage Tips

### Terminal Usage (Best for Quick Questions)

```bash
# Simple question
ollama run qwen2.5-coder:14b "How do I use useMemo in React?"

# Multi-line prompt (use quotes)
ollama run qwen2.5-coder:14b "
Here's a React component:

function MyComponent({ items }) {
  const filtered = items.filter(i => i.active);
  return <ul>{filtered.map(i => <li>{i.name}</li>)}</ul>;
}

Add memoization to prevent unnecessary re-renders.
"

# Interactive chat mode
ollama run qwen2.5-coder:14b
# Then type your prompts, Ctrl+D to exit
```

### Piping File Content

```bash
# Analyze a file
cat src/components/MyComponent.tsx | ollama run qwen2.5-coder:14b "Review this React component for performance issues:"

# Generate tests for a file
cat src/lib/utils.ts | ollama run qwen2.5-coder:14b "Write unit tests for these utility functions:"
```

### Model Switching

```bash
# If 14b is too slow, switch to 7b
ollama run qwen2.5-coder:7b "your prompt"

# List available models
ollama list
```

---

## Part 6: Troubleshooting

### "Connection refused" Error
```bash
# Make sure Ollama is running
ollama serve

# Check if it's running
curl http://localhost:11434/api/tags
```

### Model Not Found
```bash
# List downloaded models
ollama list

# Re-download if needed
ollama pull qwen2.5-coder:14b
```

### Slow Response
- Try the smaller 7b model: `ollama run qwen2.5-coder:7b`
- Close other memory-heavy apps
- Check Activity Monitor for memory usage

### Cursor Not Connecting
1. Verify Ollama is running: `curl http://localhost:11434/api/tags`
2. Check the API base URL is exactly: `http://localhost:11434/v1`
3. Try restarting Cursor after adding the model

---

## Part 7: Pre-Flight Checklist ✈️

Run these commands before boarding:

```bash
# 1. Start Ollama
ollama serve

# 2. (In new terminal) Verify models are ready
ollama list

# 3. Test offline - TURN OFF WIFI first
ollama run qwen2.5-coder:14b "Hello, are you working offline?"

# 4. If it responds, you're good to go!
```

### What Should Be Ready:
- [ ] Ollama installed (`ollama --version` works)
- [ ] At least one model downloaded (`ollama list` shows models)
- [ ] Tested offline (WiFi off, model still responds)
- [ ] Cursor configured (optional, can use terminal)

---

## Quick Reference Commands

```bash
# Start server
ollama serve

# List models
ollama list

# Run a model
ollama run qwen2.5-coder:14b "prompt"

# Interactive mode
ollama run qwen2.5-coder:14b

# Pull a new model
ollama pull <model-name>

# Remove a model
ollama rm <model-name>

# Model info
ollama show qwen2.5-coder:14b

# Check server status
curl http://localhost:11434/api/tags
```

---

## API Reference (For Custom Integration)

Ollama exposes an OpenAI-compatible API:

```bash
# Chat completion
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-coder:14b",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Generate (simpler)
curl http://localhost:11434/api/generate \
  -d '{
    "model": "qwen2.5-coder:14b",
    "prompt": "Write a React hook",
    "stream": false
  }'
```

This API is what Cursor uses when you configure it as a custom model.
