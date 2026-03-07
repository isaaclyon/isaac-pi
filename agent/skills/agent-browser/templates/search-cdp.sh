#!/bin/bash
# Template: Web Search via Chrome DevTools Protocol (CDP)
# Starts Chrome (headed or headless), connects agent-browser, runs a search, prints interactive results.
#
# Usage:
#   ./search-cdp.sh "your search query" [engine] [mode]
#
# Examples:
#   ./search-cdp.sh "pi coding agent github"
#   ./search-cdp.sh "site:github.com pi-coding-agent extensions" google headless
#   ./search-cdp.sh "playwright docs" bing headed

set -euo pipefail

QUERY="${1:?Usage: $0 <query> [engine: google|bing|duckduckgo] [mode: headed|headless]}"
ENGINE="${2:-google}"
MODE="${3:-headed}"
SESSION="${AGENT_BROWSER_SESSION:-search}"
CDP_PORT="${CDP_PORT:-9222}"
PROFILE_DIR="${CDP_PROFILE_DIR:-/tmp/pi-cdp-${SESSION}}"

find_chrome() {
  if [[ -n "${CHROME_BIN:-}" && -x "${CHROME_BIN}" ]]; then
    echo "${CHROME_BIN}"
    return 0
  fi

  local mac_chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if [[ -x "$mac_chrome" ]]; then
    echo "$mac_chrome"
    return 0
  fi

  for bin in google-chrome-stable google-chrome chromium chromium-browser chrome; do
    if command -v "$bin" >/dev/null 2>&1; then
      command -v "$bin"
      return 0
    fi
  done

  return 1
}

CHROME_PATH="$(find_chrome || true)"
if [[ -z "$CHROME_PATH" ]]; then
  echo "ERROR: Could not find Chrome/Chromium binary." >&2
  echo "Set CHROME_BIN to your browser executable path and try again." >&2
  exit 1
fi

case "$MODE" in
  headed|headless) ;;
  *)
    echo "ERROR: mode must be 'headed' or 'headless' (got: $MODE)" >&2
    exit 1
    ;;
esac

case "$ENGINE" in
  google|bing|duckduckgo) ;;
  *)
    echo "ERROR: engine must be one of: google, bing, duckduckgo (got: $ENGINE)" >&2
    exit 1
    ;;
esac

mkdir -p "$PROFILE_DIR"

chrome_args=(
  --remote-debugging-port="$CDP_PORT"
  --user-data-dir="$PROFILE_DIR"
  --no-first-run
  --no-default-browser-check
  about:blank
)

if [[ "$MODE" == "headless" ]]; then
  chrome_args=(--headless=new "${chrome_args[@]}")
fi

"$CHROME_PATH" "${chrome_args[@]}" >/tmp/pi-cdp-search.log 2>&1 &
CHROME_PID=$!

cleanup() {
  kill "$CHROME_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Started Chrome PID $CHROME_PID ($MODE) on CDP port $CDP_PORT"

connected=0
for _ in $(seq 1 20); do
  if agent-browser --session "$SESSION" connect "$CDP_PORT" >/dev/null 2>&1; then
    connected=1
    break
  fi
  sleep 0.5
done

if [[ "$connected" -ne 1 ]]; then
  echo "ERROR: Could not connect agent-browser to CDP port $CDP_PORT" >&2
  exit 1
fi

ENCODED_QUERY="$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$QUERY")"
case "$ENGINE" in
  google) SEARCH_URL="https://www.google.com/search?q=${ENCODED_QUERY}" ;;
  bing) SEARCH_URL="https://www.bing.com/search?q=${ENCODED_QUERY}" ;;
  duckduckgo) SEARCH_URL="https://duckduckgo.com/?q=${ENCODED_QUERY}" ;;
esac

echo "Running search on $ENGINE: $QUERY"
agent-browser --session "$SESSION" open "$SEARCH_URL" >/dev/null
agent-browser --session "$SESSION" wait --load networkidle >/dev/null || true
agent-browser --session "$SESSION" snapshot -i

echo
echo "Done. If you hit a challenge page, retry headed mode or use a site-specific query (e.g., site:github.com ...)."
