# BioStats · v0.2.0 — experimental prototype

**Live app:** https://vubio.github.io/biostats/  
**Source:** https://github.com/vubio/biostats

BioStats is a free, browser-first biomedical statistics and vector graphing tool. It is **not validated for manuscript submission**; compare any outputs with independently verified software before scientific use.

## How it works

1. **Choose a statistical method first.** The table structure changes for independent versus paired designs. Time-course, two-way ANOVA, survival and IC50 modules are still planned, not currently available.
2. **Create a blank editable table**, import CSV/XLS/XLSX or choose a small synthetic teaching example. Every currently supported test has at least one example. The ⓘ explanation describes the design and assumptions; t tests offer two-sided and directional alternatives.
3. **Edit the imported or entered values** in a spreadsheet-like grid. Supports adding rows/groups, pasting cells from Excel and paginating large tables. Statistical tests always use the current validated numbers; every edit invalidates prior on-screen P values until reanalysis.
4. **Run calculations** using SciPy/statsmodels through Pyodide. Supported: Student and Welch independent two-group t tests (two-sided, one-sided), paired t test (including two-/one-sided alternatives), ordinary one-way ANOVA with Tukey post hoc, Welch ANOVA (omnibus only), and Kruskal–Wallis (omnibus only).
5. **Edit and export graphs.** Plotly scatter, bar and box plots with axes, labels, palettes, error bars, SVG vector export, PNG and a browser print-to-PDF option.
6. **Create or open a local project folder** in desktop Chrome. Save frozen statistical results, an immutable SVG snapshot, graph settings, source/provenance information and HTML methods report. Project files are separate from the online code and from original raw data.

## Project folder and provenance

```
Research/Experiment_001/
├── Raw_Data/                 # Independent originals, never modified by BioStats
└── Statistics_Project/
    ├── project.json
    ├── Data/
    ├── Analyses/             # timestamped immutable analysis.json + SVG + report
    ├── Figures/
    ├── Reports/
    └── History/
```

Check **Save the exact analyzed numerical values** to include the real processed table in `input.csv` and `Data/`. This is the default. You can uncheck it for large inputs: no numerical table is archived; the report still records the computed statistics and a SHA-256 fingerprint of the exact processed CSV plus (for imports) filename, byte size, last-modified time, original file SHA-256, and whether the values were edited in the app. If you omit numeric values and no longer have the source data, precise recomputation may be impossible.

**Important:** All original input files are read-only. Historical saved analyses remain frozen; no silent rerun on open. The project format uses a compatible 1.x schema to open project indexes created with BioStats v0.1.0.

## Scientific scope and security

- **Synthetic examples are learning tools, not biomedical evidence.** Do not select significance alternatives or tests based on observed P values; consider experimental units, paired IDs, independence, approximate normality and homogeneity of variances.
- Matched t tests use a `Subject ID` column with one matched subject per row; incomplete pairs are rejected. The program never matches independent rows automatically.
- Welch ANOVA and Kruskal–Wallis currently have no implemented post hoc comparisons. It would be incorrect to claim pairwise significance from their omnibus P values.
- The browser runs Python locally via Pyodide; the app does not upload user-provided measurements to GitHub. Some dependencies are fetched over the network from CDNs; do not input identifiable patient data or confidential source material until a security review and dependency audit have been completed.
- SVG outputs use true vector Plotly traces. Check fonts and symbol rendering in your vector editor; use PNG only when raster output is explicitly intended.
- Preserve regular backups of project folders. Historic release archives and versioned web URLs are a planned feature; GitHub commit history alone is not a promise that any old live runtime can be reproduced exactly.

## Source and tests

- `engine/engine.py`: Python statistical engine, explicit functions and arguments.
- `src/examples.js`: synthetic teaching examples and explanations.
- `src/main.js`: current editable data grid and workflow.
- `src/projects.js`: file access, immutable records, human-readable reports.
- `src/charts.js`: graph rendering and vector export.
- `tests/test_engine.py`: initial reference-value smoke tests, **not** comprehensive statistical validation.

Local Python check: `PYTHONPATH=. pytest -q tests/`. Local web check: run `python -m http.server 8000` at repository root and open `http://localhost:8000` in Chrome. GitHub Pages publishes the `main` branch root.
