# Pi core patches

`pi-core-proactive-compaction.patch` is a reproducible patch for Pi `0.80.6`.
It compacts at the configured local threshold between agent turns, before the
next provider request, and stops safely if that compaction fails. It also fixes
cut-point selection when a large tool result crosses the keep-recent budget.

Apply it from the root of a matching Pi source checkout:

```sh
git apply ~/.pi/agent/patches/pi-core-proactive-compaction.patch
```

The current installed Pi runtime was built from this patch during development;
the original dist files are backed up under `/tmp/pi-core-dist-backup`.

`pi-lcm-compaction-model-thinking.patch` adds per-model reasoning levels and
records the successful summarizer model(s) in the compaction details while
logging them as `[LCM] Compaction summarizer: ...`. It is already applied to
the installed `pi-lcm` package.
