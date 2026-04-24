---
name: create-skill
description: "Create new pi skills from scratch. Use when asked to build, scaffold, or design a new skill — handles requirements gathering, SKILL.md authoring, helper files, and wiring into the project."
---

# Skill Creation

Create new pi skills that follow the [Agent Skills specification](https://agentskills.io/specification).

## When to Use

Use this skill when the user wants to:
- Create a new skill from scratch
- Scaffold a skill directory with SKILL.md and supporting files
- Convert an existing workflow into a reusable skill

## Step 1 — Gather Requirements

Before writing anything, clarify:

1. **What does the skill do?** One clear sentence.
2. **When should the agent use it?** Trigger conditions (be specific — this becomes the `description`).
3. **Does it need helper scripts, reference docs, or templates?** Plan the directory structure.
4. **Are there external dependencies?** CLI tools, APIs, packages.
5. **Does it need `allowed-tools`?** Pre-approved tool patterns for the agent.

If the user gives a vague request, ask **2–3 focused questions** using the `ask_user` tool one at a time. Don't guess at ambiguous requirements.

## Step 2 — Choose the Skill Name

Rules (must follow all):
- Lowercase letters, numbers, and hyphens only
- 1–64 characters
- No leading/trailing hyphens
- No consecutive hyphens
- The parent directory **must** match the name exactly

Good: `pdf-processing`, `code-review`, `data-analysis`
Bad: `PDF-Processing`, `-pdf`, `pdf--processing`, `my_skill`

## Step 3 — Write the SKILL.md

Every SKILL.md has two parts: **frontmatter** and **body**.

### Frontmatter (required fields)

```yaml
---
name: <skill-name>
description: "<What it does and when to use it. Max 1024 chars. Be specific — this is what the agent sees to decide whether to load the skill.>"
---
```

Optional frontmatter fields:
- `license` — license name or reference to a bundled file
- `compatibility` — environment requirements (max 500 chars)
- `metadata` — arbitrary key-value pairs
- `allowed-tools` — space-delimited list of pre-approved tools (e.g., `Bash(my-skill:*)`)
- `disable-model-invocation` — set `true` to hide from system prompt (user must use `/skill:name`)

### Description quality

The description determines when the agent loads the skill. Be specific and action-oriented.

Good:
```yaml
description: "Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents."
```

Bad:
```yaml
description: "Helps with PDFs."
```

### Body content

Write clear, actionable instructions. The agent reads this at runtime and follows it. Structure with:

1. **Purpose** — what this skill accomplishes
2. **Setup** (if needed) — one-time installation or config
3. **Usage** — concrete commands, code examples, or workflows
4. **Reference** — link to deeper docs with relative paths if needed

Use relative paths for all file references within the skill directory:
```markdown
See [the API reference](references/api.md) for details.
Run `./scripts/process.sh <input>` to process files.
```

## Step 4 — Create Supporting Files (if needed)

Common patterns:

```
my-skill/
├── SKILL.md              # Required
├── scripts/              # Helper scripts (bash, node, python)
│   └── process.sh
├── references/           # Detailed docs loaded on-demand
│   └── api-reference.md
├── templates/            # Reusable templates or starter files
│   └── config.json
└── assets/               # Static assets
    └── schema.json
```

Keep it minimal. Only add files the skill actually references.

## Step 5 — Wire It Up

### For this package (isaac-pi)

Skills in `.pi/skills/` are already picked up by the `pi.skills` entry in `package.json`:
```json
"pi": {
  "skills": [".pi/skills"]
}
```

No extra wiring needed — just create the directory and SKILL.md.

### For other projects

Place the skill in one of the discovery locations:
- **Project-level:** `.pi/skills/<skill-name>/SKILL.md` or `.agents/skills/<skill-name>/SKILL.md`
- **Global:** `~/.pi/agent/skills/<skill-name>/SKILL.md` or `~/.agents/skills/<skill-name>/SKILL.md`
- **Settings:** Add the path to the `skills` array in `settings.json`

## Step 6 — Update Routing (if in isaac-pi)

After creating the skill, update `AGENTS.md` to include a routing entry under the appropriate section:

**Skills section:**
```markdown
- `<skill-name>` — use for <when to use it>.
```

This ensures the agent knows when to reach for the skill.

## Step 7 — Validate

Self-check before finishing:
- [ ] Directory name matches `name` in frontmatter exactly
- [ ] `description` is specific and under 1024 characters
- [ ] `name` follows naming rules (lowercase, hyphens, no consecutive hyphens)
- [ ] Body has clear, actionable instructions
- [ ] All relative paths in the body point to files that exist
- [ ] Helper scripts are executable (`chmod +x`)
- [ ] No missing dependencies or undocumented setup steps

## Common Mistakes to Avoid

- **Vague descriptions** — "Helps with X" tells the agent nothing. Say what it does and when.
- **Name mismatch** — directory must match `name` field exactly.
- **Missing description** — skills without a description are **not loaded**.
- **Absolute paths** — use relative paths from the skill directory, not machine-specific paths.
- **Over-engineering** — start with just a SKILL.md. Add scripts/references only when needed.
- **Installing globally** — never use `pi install` to add skills. Wire through `package.json` or discovery locations.
