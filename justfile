# Update pi globally and re-apply patches
update-pi:
    npm update -g @mariozechner/pi-coding-agent
    ./scripts/patch-pi.sh apply

# Apply patches without updating
patch-pi:
    ./scripts/patch-pi.sh apply

# Revert patches
unpatch-pi:
    ./scripts/patch-pi.sh revert

# Check patch status
patch-status:
    ./scripts/patch-pi.sh check
