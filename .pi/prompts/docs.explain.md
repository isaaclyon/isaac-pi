---
description: "Explain a file, function, directory, or concept from the codebase in plain English"
---
You are helping someone understand this codebase.

Goal: explain the target specified by `$@` in clear, plain English that is accessible to non-developers.

Execution rules:
1) If `$@` is empty, ask the user what they would like explained and stop.
2) Determine what `$@` refers to — it could be a file path, function name, directory, or a description of a concept in the codebase.
3) Gather context using available tools:
   - Use `read` to examine file contents.
   - Use `bash` (grep, find, ls) to locate references, usages, and related files.
   - Use `lsp` actions (symbols, references, hover, definition) to understand type signatures, call sites, and structure.
4) Do NOT modify any files. This is a read-only operation.
5) Respond with a structured explanation in this format:

   **Summary** — one or two sentences on what it is and what it does.

   **Purpose** — why it exists, what problem it solves, and how it fits into the broader project.

   **How it works** — a walkthrough of the key logic, control flow, or structure. Use plain language; avoid jargon where possible.

   **Dependencies & connections** — what it depends on, what depends on it, and how it connects to the rest of the codebase.

   **Gotchas & notes** — anything surprising, easy to misunderstand, or important to keep in mind (edge cases, assumptions, known limitations). Omit this section if there is nothing notable.

6) Keep it concise. Prefer short paragraphs and bullet points over walls of text.
7) If `$@` is ambiguous and matches multiple things, list the candidates and ask the user to clarify.
