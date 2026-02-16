---
name: brave-search
description: Web search via the Brave Search API. Use to retrieve search results from Brave when web lookups are needed.
compatibility: Requires env. variable BRAVE_SEARCH_API_KEY and uv with Python 3.12+.
---

# Brave Search

## Setup

This skill uses `BRAVE_SEARCH_API_KEY`.

1. Create `.env` from `.env.example` (optional):
   ```bash
   cp .pi/skills/brave-search/.env.example .env
   ```
2. Put your Brave Search API key in one of these places:
   - `BRAVE_SEARCH_API_KEY` in your shell environment, or
   - `BRAVE_SEARCH_API_KEY` inside `.env`

If you have a key, I can use it if you want to run this skill immediately.

The script auto-loads a local `.env` file (if present) and exits with `missing BRAVE_SEARCH_API_KEY` if still unset.

## Usage

```bash
uv run --script {thisSkillDir}/scripts/brave-search.py "QUERY" [OPTIONS] --json
```

## Options

- `--count <N>`: Maximum results to return (default: 5)
- `--offset <N>`: Offset into the result set (default: 0)
- `--country <CODE>`: Two letter country code
- `--search-lang <CODE>`: Search language code
- `--safesearch <off|moderate|strict>`: Safe search mode
- `--freshness <day|week|month>`: Filter by recency
- `--json`: Output normalized JSON
- `--raw`: Output raw API response
- `--help`: Show help

## Examples

```bash
uv run --script {thisSkillDir}/scripts/brave-search.py "observability tools" --count 3 --json
```
