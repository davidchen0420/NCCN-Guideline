# Built navigator (prostate, NCCN v6.2026)

`prostate-navigator.html` is the finished, offline, single-file navigator: open it in any browser (phone or laptop).
`screenshots/` shows it on desktop and phone.

**Licensing note.** This file embeds the processed NCCN Prostate guideline text. NCCN's PDF header says the content may not be
distributed or used with an AI model or tool; make sure your agreement with NCCN allows publishing this before keeping the
repository public. Rebuild it any time with:

```
PYTHONPATH=src python -m nccn_nav.dashboard data/prostate   # writes private/viz/dashboard.html
```
