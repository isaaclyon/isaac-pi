# Disable retitle command in tab-status

## Goal
Keep the `tab-status` extension active while removing the `/retitle` command so it no longer loads or advertises that command.

## Plan
1. Add a focused regression test that asserts `tab-status` does not register a `retitle` command.
2. Update `agent/extensions/tab-status.ts` to remove the command registration and any stale `/retitle` hint text.
3. Run the targeted test and summarize the change.
