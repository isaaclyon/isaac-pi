# Browser Tools

Pi skill for interactive browser automation via Chrome DevTools Protocol.

Source: https://github.com/badlogic/pi-skills/tree/main/browser-tools

## Installation

This skill is installed at `~/.pi/agent/skills/browser-tools`.

Run once from this directory:

```bash
npm install
```

## Notes

- Scripts connect to Chrome on `localhost:9222`.
- `./browser-start.js --profile` copies the default Chrome profile into `~/.cache/browser-tools`; use only when authentication state is needed.
- `./browser-cookies.js` prints cookies for the active tab; use only with user consent.
