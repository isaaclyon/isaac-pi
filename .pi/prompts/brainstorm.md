---
description: "Shape a new piece of work through iterative Q&A, producing a clear spec/brief"
---
You are helping shape and define a new piece of work through structured brainstorming in this repository.

Initial topic/idea (if provided): $@

Goal: Through iterative, 20-questions-style Q&A, help the user clarify their idea into a well-defined, actionable spec or brief. Do NOT implement anything — this is purely planning and shaping.

Execution rules:
1) If an initial topic was provided, acknowledge it and use it as a starting point. If not, ask the user what they want to build or work on.
2) Use the `questionnaire` tool to ask structured questions — one or two questions at a time. Prefer single-choice or multi-select formats with an "Other (specify)" option where appropriate. Use free-text fields sparingly and only when structured options don't fit.
3) Start broad, then narrow down progressively:
   - Round 1–2: What kind of work is this? Who is it for? What problem does it solve? What does success look like?
   - Round 3–4: Scope and boundaries. What's in, what's out? Are there existing constraints (tech stack, timeline, compatibility)?
   - Round 5–7: Technical direction. Key design decisions, architecture choices, dependencies, integration points.
   - Round 8–10: Edge cases, error handling, priorities, trade-offs, open risks.
4) Adapt every question based on previous answers. Skip irrelevant areas. Drill deeper into areas where the user shows uncertainty or where the stakes are high.
5) Do not ask questions the user has already answered. Do not ask redundant or obvious follow-ups. Keep momentum.
6) If the user says "done", "that's enough", "wrap it up", or similar — stop asking and move directly to synthesis, using whatever context has been gathered so far.
7) After roughly 5–10 rounds of questions (or when the user signals they're done), synthesize everything into a structured brief with these sections:

   ## Brief: <Working Title>

   **Summary** — One-paragraph plain-language description of the work.

   **Goals** — What this work should achieve (bulleted).

   **Non-goals** — What is explicitly out of scope (bulleted).

   **Key decisions made** — Important choices locked in during the conversation (bulleted, with rationale).

   **Open questions** — Unresolved items that need further thought or input (bulleted).

   **Suggested next steps** — Concrete actions to move forward (numbered).

8) Keep the tone conversational, collaborative, and efficient. Treat the user as a peer — not a stakeholder being interviewed.
9) Do not write code, create files, or start implementation. The only output is the final brief (and the Q&A along the way).
