# Agent Studio

**Deterministic, Cost-Aware Multi-Agent Orchestration Platform.**

Agent Studio is a production-grade orchestration engine designed to safely execute complex AI workflows. It moves beyond simple chatbot wrappers by providing a stateful, schema-validated, and cost-optimized runtime for multi-agent systems.

---

## 🚀 Vision

Agent Studio is built for developers who need to bridge the gap between "cool AI demos" and robust, observable production agents.

- **Deterministic Orchestration**: Execute agents in Directed Acyclic Graphs (DAGs) with strict transition rules.
- **Cost-Aware Routing**: Automatically selects the cheapest model capable of completing a task based on complexity and provider pricing.
- **Safety First**: Every tool call is schema-validated, permission-checked, and resource-limited.
- **Deep Observability**: Track every token, every cent, and every latency spike in real-time.

---

## 🛠 Features

### 1. Multi-Agent Ecosystem
- **Planner Agent**: Decomposes tasks into structured execution plans.
- **Executor Agent**: The workhorse that interacts with tools via a ReAct loop.
- **Validator Agent**: Acts as a quality gate, semantically verifying results against goals.
- **Retrieval Agent**: Native integration for RAG/Memory workflows.

### 2. Probabilistic Model Router
Native support for:
- 🟢 **OpenAI** (o3-mini, gpt-4o, gpt-4o-mini)
- 🟣 **Anthropic** (Claude 3.5 Sonnet, Claude 3 Haiku)
- 🟡 **Google** (Gemini 2.5 Pro/Flash)
- 🔴 **Groq** (Llama 3.3, Llama 3.1, GPT-OSS)
- ⚪ **Local Models** (Ollama support)

### 3. Visual Workflow Editor
- Drag-and-drop DAG composition using React Flow.
- Global provider settings to control intelligence vs. cost balancing.
- Real-time execution overlays and step validation.

### 4. Enterprise Observability
- **Run History**: Complete audit trail of every step, prompt, and response.
- **Cost Tracking**: Per-run and per-user budget enforcement.
- **Live SSE Streaming**: Watch your agents think and act in real-time.

---

## 🏗 Project Structure

This is a **pnpm monorepo** managed with **Turbo**:

- `apps/web`: Next.js frontend (Tailwind + React Flow).
- `apps/api`: Fastify backend server.
- `packages/shared`: Shared types, schemas (Zod), and constants.
- `packages/router`: The intelligence engine for model scoring and cost estimation.
- `packages/runtime`: The execution engine for the DAG and Agent loops.
- `packages/tools`: The secure tool registry and execution sandbox.
- `packages/persistence`: Database layer (Drizzle/Postgres).
- `packages/observability`: Telemetry, metrics, and incident tracking.

---

## 🚦 Getting Started

### Prerequisites
- [pnpm](https://pnpm.io/)
- Node.js 20+

### Installation
```bash
# Clone the repository
git clone https://github.com/tribhangind/agent-studio.git
cd agent-studio

# Install dependencies
pnpm install
```

### Development
```bash
# Start all apps (Web + API)
pnpm dev

# Build the entire monorepo
pnpm build
```

---

## 📄 License

Private Repository - All Rights Reserved.
