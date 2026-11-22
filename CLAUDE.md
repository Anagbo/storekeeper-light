## StoreKeeper standing rules (apply to every task)

Safety
- Do not read .env or .env.local files.
- Do not commit docs/handoff/ or agent-handoff/.
- Never push. Manual mode only. Never remove git worktrees with --force (node_modules links only with plain rmdir).
- If `git status` is not clean at the start, stop and tell the owner.

Code and wording
- Money is integer pesewas through formatGhs. Times through formatTime. Dates dd/mm/yyyy via src/lib/formatDate.js.
- Use the curly apostrophe ’ in user-facing text.
- WhatsApp links only through src/lib/openWhatsApp.js. Phone search only through src/lib/phoneSearch.js. Layout mode only from src/pos/layout.js (no other width reads).
- Wide screens change layout only; every phone control keeps its label and accessible name.

Contract
- The contract is docs/handoff/journey-wiring.json. src/pos/wiring.json must be byte-identical to it: sync (Copy-Item -Force, compare Get-FileHash) and commit the sync alone, only if it changed.
- Do NOT read the whole wiring file (about 240KB). Read only the screens you need: `node scripts/wiring-screen.mjs <screen id> [rules_global key ...]`, `node scripts/wiring-screen.mjs --globals` lists the global rule names.

Working style (keeps token use low)
- One commit per item. Run only the tests that your change affects while working.
- Do NOT run the full test suite, the builds or the delta check; the owner runs `.\scripts\delta-check.ps1` himself. Run at most one `vite build` if your change could break the build.
- Never print long output: pipe test and build output through `Select-Object -Last 20` or write it to a file and read the tail.
- Do not do a real-browser width check unless the task says layout changed; then only for the screens named in the task, at the widths named.
- "Report first" only when the task says so.
- Finish with a short report: commits, tests you ran (counts), existing tests you changed and why, anything you did not change. Do not list what you checked in prose.