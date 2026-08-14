# Pure Design

A minimal **UI design agent**: prompt → a single self-contained HTML. The core idea is to fully extract the design assets of the open-source project [open-design](https://github.com/nexu-io/open-design) (**162 skills, 151 design systems, 114 templates, 13 craft references, 106 prompt templates**) and drive them with **Pi's SDK as the built-in agent base** — no login, no cloud service, no desktop app.

> Why bundle Pi? Pi is just an agent engine (`@earendil-works/pi-agent-core`). Bundling it as a dependency means anyone can `pnpm install` and run — **no need to install Pi locally**. The system prompts are composed from the asset library, the skills live in the library, and Pi only handles "loop until satisfied".

[中文文档](README.zh-CN.md)

## How it works

```
Your prompt
    │
    ▼
┌─ Built-in Pi agent (src/agent.mjs) ────────────────┐
│  System prompt = frontend-design skill + chosen     │
│                 design system + craft + template    │
│                 contract + output contract          │
│  Agent loop:                                        │
│    design → write_file → self-review vs checklist   │
│    → rewrite if needed → until satisfied → summary  │
└─────────────────────────────────────────────────────┘
    │ write_file
    ▼
output/xxx.html (self-contained, zero external assets)
    │
    ▼
Web UI (src/server.mjs, port 8745) + SSH forwarding → local browser
```

The agent doesn't generate once — it **iterates until it passes**: write a version, review it against the self-check checklist, rewrite if problems remain, stop when satisfied. Up to 6 rounds by default.

## Quick start

```bash
pnpm install        # pulls the bundled Pi SDK (the only dependency step)

# Way 1: Web UI (recommended)
pnpm pure-design preview   # http://127.0.0.1:8745/ → type a brief → watch the agent iterate live

# Way 2: CLI
pnpm pure-design "A minimal expense-tracking app home page for indie developers, focused on this month's spending and budget progress"
# Flow: AI decision (task type / design system / direction / skill, asks only when ambiguous)
#       → assembly confirmation (Enter to accept or edit)
#       → agent iterates (grilling clarification)
pnpm pure-design --yes "…"               # skip assembly confirmation (scripts / batch)
pnpm pure-design "…" --system stripe     # pin a design system (rest decided by AI)
pnpm pure-design "…" --max-rounds 4      # cap iteration rounds
pnpm pure-design "…" -o out/landing.html # custom output path

# Way 3: One-shot fast generation (no agent loop)
pnpm pure-design fast "…" [-s system] [-t template]
```

> The command is `pure-design` (CLI entry `bin/pure-design.mjs`, built on commander). Use `pnpm pure-design` inside the project; for global use, run `pnpm link --global` in the project directory and type `pure-design` anywhere.

> **Output location**: by default written to the **current working directory**, with a semantic filename derived from the brief (mixed Chinese/English, e.g. `极简记账-app-首页.html`), auto-versioned `+v2`/`+v3` if the file exists. `-o, --out` accepts a path (relative or absolute).

## Command reference

```
pure-design "brief" [options]       Built-in Pi agent iterative design (default, recommended)
pure-design fast "brief" [options]  One-shot fast generation
pure-design preview [port]          Start Web UI + preview (default 8745)
pure-design tunnel                  Print SSH port-forward command
pure-design --list                  List all design systems (151)
pure-design --list-templates        List all templates (114)
pure-design --list-directions       List all visual directions (5)

Options (default path = AI decides):
  -s, --system <name>    Design system (default AI-decided, falls back to `default`)
  -t, --template <name>  Template (default AI picks by task type)
  -d, --direction <name> Visual direction (default AI picks from 5 schools)
  -o, --out <path>       Output path (default: semantic name in CWD, auto +v2)
  -f, --file <path>      Read prompt from a file
      --yes              Skip assembly confirmation, start designing immediately
      --max-rounds <N>   Max agent iteration rounds (default 6)
      --taste            Append the anti-AI-slop taste skill
  -m, --model <id>       Model (agent: deepseek-v4-flash; fast: claude-sonnet-5)
      --max-tokens <n>   Max output tokens (fast only, default 16000)
      --refine           Self-review + refine loop (fast only)
```

> **Decision stage** (plain `pure-design "brief"`): the AI first infers the task type
> (web/dashboard/mobile/deck/editorial/brand), picks a visual direction (from 5 schools)
> and a skill (pre-filtered by task type, then chosen by AI); the design system defaults
> to `default` (matched automatically when the brief mentions a brand). When info is
> insufficient, the AI asks one question at a time (with a recommended answer). After
> deciding, it shows the assembly summary — press Enter to accept or type an edit
> (e.g. `方向 editorial`); `--yes` skips this.

## Environment variables

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek key (falls back to `deepseek.key` in `~/.pi/agent/auth.json`) |
| `PURE_DESIGN_PORT` | Web/preview port (default 8745) |
| `PURE_DESIGN_HOST` | Listen address (default 127.0.0.1, access via SSH forwarding; never 0.0.0.0) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | Only needed by the `fast` path |

## Project structure

```
pure-design/
├── bin/
│   └── pure-design.mjs  The only CLI entry (agent / fast / preview / tunnel / --list…)
├── src/                 Business layer (called by bin/)
│   ├── agent.mjs        Built-in Pi design agent (SDK base + agent loop + write_file tool)
│   ├── router.mjs       Decision stage (task type / direction / skill selection + clarification)
│   ├── design.mjs       One-shot fast generation (fast-path business functions)
│   ├── lint.mjs         Deterministic anti-AI-slop lint (post-write check, see adr/0002)
│   ├── prompt.mjs       Compose system prompts from assets/ (shared)
│   └── server.mjs       Minimal Web UI + gallery + SSE progress + preview
├── assets/              Fully extracted asset library (82M, standalone assets)
│   ├── skills/          162 skills (frontend-design, taste-skill, gsap-* …)
│   ├── design-systems/  151 design systems (DESIGN.md brand contracts + tokens)
│   ├── design-templates/ 114 rendering templates
│   ├── craft/           13 craft references
│   └── prompt-templates/ 106 prompt templates
├── output/              Generated results (Web UI gallery + preview)
├── scripts/pure-design-remote  Local one-click script (forward + remote generation + open browser)
└── package.json         Deps: pi-agent-core + pi-ai + commander + marked
```

## Web UI

`pnpm pure-design preview` serves a page (style inspired by open-design — warm paper background, serif headlines, one accent color, minimal):
- A textarea for the brief, design system/template pickers, and a "Start design" button
- **Live SSE progress**: watch each round of the agent's writes
- On completion: preview link + the agent's design summary
- A `/gallery` history gallery listing every generated page

## Adding your own design system

Create `assets/design-systems/your-brand/DESIGN.md`, write colors/typography/spacing/components following the existing format, then `--system your-brand`.

## Relationship to upstream

- **Extraction, not rewrite**: design assets are copied wholesale into `assets/` (82M); the tooling is a thin layer on top.
- What was dropped: peripheral infrastructure — login/auth, the big web app, desktop client, daemon, MCP, plugin marketplace.
- What was added: a bundled agent base (Pi SDK) in exchange for "iterate until satisfied" with zero external dependencies.
- `upstream/` is the downloaded original repo, read-only reference, kept for consulting the upstream implementation.

## Notes

- The agent iterates on DeepSeek reasoning + the self-check checklist — slower but higher quality (one round ~30s–2min, a full pass 1–5min).
- Stronger model: `--model deepseek-v4-pro`; cheaper locally: `--model deepseek-v4-flash`.
- Output defaults to the **execution directory** with semantic naming and auto `+v2`/`+v3`; `-o` places it anywhere.
