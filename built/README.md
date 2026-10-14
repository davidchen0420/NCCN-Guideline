# Built navigator

| File | What it is | How to open |
|---|---|---|
| `navigator.html` | The library: all 91 encoded guidelines. It embeds no guideline; it reads `../data/index.json` and each `../data/<slug>/guideline.json` when opened. | Serve the repository over http, e.g. `python -m http.server` in the repository root, then open `http://localhost:8000/built/navigator.html`. (Browsers do not let a page opened from disk read neighbouring files; opened that way it offers to open one `guideline.json` instead.) |
| `prostate-navigator.html` | One guideline (Prostate Cancer v6.2026) embedded in a single offline file, with the example patients. | Open it directly in any browser, phone or laptop. |

`screenshots/` shows an earlier version of the interface.

Rebuild:
```
cd web && npm run build && cd ..                                   # the app -> src/nccn_nav/dashboard.html
PYTHONPATH=src python -m nccn_nav.dashboard --library               # -> built/navigator.html
PYTHONPATH=src python -m nccn_nav.dashboard data/prostate built     # -> built/prostate-navigator.html (any data/<slug>)
```

The source PDFs are never included. Connect your copy in the navigator (title bar, or drop it on the page) to preview original pages; it stays in your browser, and its SHA-256 is checked against the one the guideline was encoded from.

**Licensing note.** The offline file and the data it reads contain processed NCCN guideline text. NCCN's PDF header says the content may not be distributed or used with an AI model or tool; make sure your agreement with NCCN allows publishing this before keeping the repository public.
