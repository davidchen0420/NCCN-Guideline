# OncoCarta, built files

| File | What it is | How to open |
|---|---|---|
| `oncocarta.html` | The library: all 91 encoded guidelines, opening on the atlas (a map of every guideline, its pages and boxes). It embeds the atlas overview but no guideline; it reads `../data/index.json` and each `../data/<slug>/guideline.json` when opened. | Serve the repository over http, e.g. `python -m http.server` in the repository root, then open `http://localhost:8000/built/oncocarta.html`. (Browsers do not let a page opened from disk read neighbouring files; opened that way the map still works but guidelines cannot be opened.) |
| `prostate-oncocarta.html` | One guideline (Prostate Cancer v6.2026) embedded in a single offline file, with the example patients. | Open it directly in any browser, phone or laptop. |

`screenshots/atlas-*.png` show the atlas home page (light, dark, search, a guideline with an example patient's route, a page card, phone); the other screenshots show an earlier version of the reader.

Rebuild:
```
cd web && npm run build && cd ..                                   # the app -> src/nccn_nav/dashboard.html
PYTHONPATH=src python -m nccn_nav.dashboard --library [--pdfs DIR]  # -> built/oncocarta.html (with the atlas and local PDF paths)
PYTHONPATH=src python -m nccn_nav.dashboard data/prostate built     # -> built/prostate-oncocarta.html (any data/<slug>)
```

The source PDFs are not included yet. They may be committed at `data/<slug>/pdf/<slug>.pdf` (the only place `.gitignore` allows PDFs); the library build then finds them. To preview original pages, either put your copies where the library build finds them (`data/<slug>/`, `Guideline/`, `private/`, `pdf/`, `pdfs/`, or pass `--pdfs DIR`) and rebuild with `--library` (it records their paths, matched by SHA-256), or in OncoCarta use "Source PDF" → "Connect a folder of NCCN PDFs" once (matched to all guidelines by SHA-256 and kept in your browser), or choose or drop a single guideline's PDF.

**Licensing note.** The offline file and the data it reads contain processed NCCN guideline text. NCCN's PDF header says the content may not be distributed or used with an AI model or tool; make sure your agreement with NCCN allows publishing this before keeping the repository public.
