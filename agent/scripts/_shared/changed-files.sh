#!/usr/bin/env sh
set -eu

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
	exit 0
fi

{
	git diff --name-only
	git diff --name-only --cached
	git ls-files --others --exclude-standard
} |
	awk 'NF > 0' |
	while IFS= read -r file; do
		if [ -f "$file" ] || [ -L "$file" ]; then
			echo "$file"
		fi
	done | sort -u
