---
name: update-lightdash
description: "Safely update Lightdash server and CLI versions on the Hetzner VM and local sandbox. Includes pg_dump backup before upgrade, dev-first verification, CLI version sync, and post-upgrade health checks. Use when asked to upgrade, update, or bump Lightdash."
---

# Update Lightdash

Safely upgrade the Lightdash server (Docker image) and CLI version across all environments.

## Architecture

- **Single Hetzner VM** (`89.167.44.60`) runs one Lightdash instance with two projects:
  - `Lola Analytics Dev` — verify upgrades here first
  - `Lola Analytics` — production project
- **Local sandbox** (`packages/lightdash/docker-compose.yml`) — optional local stack via `just lightdash-up`
- **CLI version** — pinned in multiple places, must stay compatible with server

## Safety Rules

- Always back up the VM Postgres database before upgrading
- Always verify the dev project works before declaring success
- Never skip the health check after restarting containers
- Keep CLI versions aligned with the running server version

## Phase 1 — Pre-flight

### 1a. Check current versions

```bash
# Current server version on VM
ssh root@89.167.44.60 'cd /opt/lightdash && docker compose exec lightdash cat /app/packages/backend/package.json | grep version | head -1'

# Current CLI version pinned for remote helpers
grep 'DEFAULT_LIGHTDASH_CLI_VERSION' scripts/lightdash_remote.sh

# Current CLI version pinned for local custom helpers
grep 'LIGHTDASH_CUSTOM_CLI_VERSION' justfile
```

### 1b. Check what version is available

Visit https://hub.docker.com/r/lightdash/lightdash/tags or:
```bash
# Check latest tag
curl -s "https://hub.docker.com/v2/repositories/lightdash/lightdash/tags/?page_size=5&ordering=last_updated" | python3 -c "import sys,json; [print(t['name'],t['last_updated']) for t in json.load(sys.stdin)['results']]"
```

Also check the Lightdash changelog for breaking changes: https://github.com/lightdash/lightdash/releases

### 1c. Read release notes

⚠️ **Before proceeding**, scan release notes between current and target version for:
- Database migration warnings
- Breaking API changes
- Deprecated features
- Required config changes

## Phase 2 — Backup VM Database

```bash
# SSH and dump the Lightdash Postgres database
ssh root@89.167.44.60 'cd /opt/lightdash && docker compose exec -T db pg_dump -U lightdash -Fc lightdash > /opt/lightdash/backups/lightdash-$(date +%Y%m%d-%H%M%S).dump'

# Verify the dump exists and has reasonable size
ssh root@89.167.44.60 'ls -lh /opt/lightdash/backups/*.dump | tail -3'
```

If the backups directory doesn't exist:
```bash
ssh root@89.167.44.60 'mkdir -p /opt/lightdash/backups'
```

### Restore procedure (if needed)

```bash
ssh root@89.167.44.60 'cd /opt/lightdash && docker compose down lightdash scheduler'
ssh root@89.167.44.60 'cd /opt/lightdash && docker compose exec -T db pg_restore -U lightdash -d lightdash --clean --if-exists < /opt/lightdash/backups/<dump-file>'
ssh root@89.167.44.60 'cd /opt/lightdash && docker compose up -d'
```

## Phase 3 — Upgrade VM

Use the existing ops script:

```bash
# Pull new images and restart
.claude/skills/lightdash-hetzner/scripts/lightdash_ops.sh upgrade
```

Or manually:
```bash
ssh root@89.167.44.60 'cd /opt/lightdash && docker compose pull && docker compose up -d'
```

### 3a. Post-upgrade health check

```bash
# Container status
.claude/skills/lightdash-hetzner/scripts/lightdash_ops.sh health

# Check logs for migration errors
.claude/skills/lightdash-hetzner/scripts/lightdash_ops.sh logs lightdash 50
```

### 3b. Verify dev project first

```bash
# Switch to dev project and run a verify
just lightdash-dev-verify
```

Open `https://lightdash.lolablankets.com` in a browser and:
1. Navigate to the dev project
2. Open an existing explore/chart — confirm it loads
3. Run a query — confirm results return
4. Check the Metrics Catalog — confirm it's populated

### 3c. Verify prod project

Only after dev looks good:
```bash
just lightdash-prod-verify
```

Spot-check a production dashboard or chart.

### 3d. Confirm new server version

```bash
ssh root@89.167.44.60 'cd /opt/lightdash && docker compose exec lightdash cat /app/packages/backend/package.json | grep version | head -1'
```

## Phase 4 — Sync CLI Versions

Update CLI version pins to match the new server version.

### 4a. Remote helper script

Edit `scripts/lightdash_remote.sh` line 7:
```bash
DEFAULT_LIGHTDASH_CLI_VERSION="<new-version>"
```

### 4b. Justfile local custom helper

Edit `justfile` — find `LIGHTDASH_CUSTOM_CLI_VERSION` and update:
```
LIGHTDASH_CUSTOM_CLI_VERSION="${LIGHTDASH_CUSTOM_CLI_VERSION:-<new-version>}"
```

### 4c. 1Password (for VM runtime)

Update the `LIGHTDASH_CLI_VERSION` field in the 1Password item using the `use-1p-cli` skill:
- **Account:** `team-lolablankets.1password.com` (employee account, not personal)
- Vault: `Lola Data Platform`
- Item: `lightdash-deploy`
- Field: `LIGHTDASH_CLI_VERSION`

```bash
# Inside a tmux session (required for op CLI):
op signin --account team-lolablankets.1password.com
op item edit "lightdash-deploy" "LIGHTDASH_CLI_VERSION=<new-version>" \
  --vault "Lola Data Platform" --account team-lolablankets.1password.com
```

Then re-render the VM runtime env so it picks up the new value.
Also update `~/.config/lola/runtime/shared.env` locally if it exists.

### 4d. Verify CLI works with new server

```bash
just lightdash-dev-verify
just lightdash-remote-projects
```

## Phase 5 — Update Local Sandbox (optional)

```bash
cd packages/lightdash
docker compose pull
```

Then restart:
```bash
just lightdash-down
just lightdash-up
```

⚠️ If the upgrade spans many versions or the release notes mention breaking migrations, consider `just lightdash-reset` (wipes local data) for a clean start.

After restart, verify:
```bash
# Check it's running
docker compose -f packages/lightdash/docker-compose.yml ps

# Open http://localhost:8080 and spot-check
```

## Phase 6 — Commit and PR

Commit the version bumps:
- `scripts/lightdash_remote.sh` — `DEFAULT_LIGHTDASH_CLI_VERSION`
- `justfile` — `LIGHTDASH_CUSTOM_CLI_VERSION`

## Rollback

If something goes wrong after the VM upgrade:

1. **Restore the database** (see Phase 2 restore procedure)
2. **Pin the old image version** in `/opt/lightdash/docker-compose.yml` on the VM
3. **Restart** with the old version:
   ```bash
   ssh root@89.167.44.60 'cd /opt/lightdash && docker compose up -d'
   ```
4. **Revert CLI version pins** locally

## Handoff Checklist

Report:
- [ ] Previous server version
- [ ] New server version
- [ ] Backup file path on VM
- [ ] Dev project verified
- [ ] Prod project verified
- [ ] CLI versions updated (remote script, justfile, 1Password)
- [ ] Local sandbox updated (if applicable)
- [ ] Version bump committed/PR'd
