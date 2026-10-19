# BioStats · v0.5.0 — experimental prototype

**Live app:** https://vubio.github.io/biostats/  
**Source:** https://github.com/vubio/biostats

BioStats is a free browser-first biomedical statistics and vector graphing application. It is **an early prototype and not validated for manuscript submission**. Independently verify results, underlying biological replicates, and assumptions before scientific use.

## Quick research templates (v0.5)

Choose **Cell Viability (1)** before selecting a statistical test. The template configures a generic independent-group table with numeric dose headers (0, 0.05, 0.1, 0.2 µM), a numeric Erastin2 X-axis, luminescence Y-axis, editable replicate counts, connected means, and optional individual wells. Import CSV/XLSX, or load a 1/2/3/6-well synthetic teaching dataset. A dose-in-rows spreadsheet triggers a one-click transpose suggestion; it cannot be accidentally analyzed as a dose-in-columns table before conversion.

Raw and **control-mean-normalized (% = measurement / mean(reference) × 100)** display modes are graph transformations. Raw numerical measurements remain the inputs to statistical tests; the figure transformation, displayed-data checksum, edited/imported-file provenance, and optional numerical inputs are recorded with each analysis. If numerical storage is selected, the archived project contains both raw `input.csv` and normalized `displayed_values.csv`. Graph controls (numeric X-axis, axis titles, legend, markers, connected lines, labels, normalization) are available to ordinary analyses too, not just the preset.

The default template uses **descriptive summary only**. Three technical wells from one experiment do not imply three independent biological replicates. Choose ANOVA only if its experimental-unit and model assumptions are appropriate.

## Workflow

1. **Choose an analysis family and method first.** Every supported method has a distinct, documented table template. Switching between incompatible formats asks for confirmation before clearing unsaved data.
2. **Load explained synthetic examples**, create a blank table, paste from Excel, or import CSV/XLS/XLSX. Edit measurements directly; the next analysis always uses the last edited values. Header labels are fixed for long-format families.
3. **Run the Python engine** in your browser using Pyodide, NumPy, pandas, SciPy and statsmodels. Record the specific function and package versions, test assumptions and available estimates.
4. **Export vector plots as SVG** (or PNG, Chrome-print PDF). Statistical plotting is separated from calculations.
5. **Create/open a separate local project folder**. Save frozen SVG, analysis JSON, human-readable statistical report and optionally the exact analyzed CSV table. No experiment data is uploaded to GitHub.

## Modules in v0.4

| Family | Data-table header | Implemented methods | Important limits |
|---|---|---|---|
| One measurement across groups | Group columns as header row | Student/Welch/paired t tests; one-way ANOVA + Tukey; Welch ANOVA + Welch/Holm; Kruskal–Wallis + Mann–Whitney/Holm | Check statistical assumptions, biological independence, matching |
| Independent time course | `Group,Time,Value` | Balanced independent two-way ANOVA (group, time, interaction) | Each row must be an independent biological unit; repeated same animal is **not** supported in this mode |
| Repeated time course (single cohort) | `Subject ID,Time,Value` | Complete-case one-factor repeated-measures ANOVA across time | Same subjects across time; **one cohort only**; check sphericity, no GG correction |
| Two-factor design | `Factor A,Factor B,Value` | Balanced independent two-factor ANOVA (A, B, interaction) | Complete balanced replicate cells (at least 2 per cell), independent units; no simple-effect post hoc yet |
| Survival | `Subject ID,Group,Time,Event (1=event; 0=censored)` | Kaplan–Meier estimator, log-rank omnibus test, pairwise log-rank + Holm for 3+ groups | One unique subject per row; event=1, censored=0; censoring is not failure; no Cox hazard ratio yet |
| Dose response | `Group,Dose,Response` | Decreasing 4-parameter logistic fit, relative IC50, approximate CI, Hill, R² | Positive concentrations in one consistent unit; measured dose range must bracket IC50; no ascending curves or between-curve test; no P value for curve fit |

All five new examples have explanations describing the assumptions and design. Specialized plots include interaction/time curves, individual repeated-subject traces, Kaplan–Meier steps and censor ticks, and semilog fitted 4PL curves. Specialized families do **not** support significance brackets yet (survival group pairs appear in a Holm-adjusted comparison matrix). For two-factor ANOVA, the headline P value is explicitly the interaction effect; the report gives P values for all factors.

## Project folder and provenance

```
Research/Experiment_001/
├── Raw_Data/                 # Originals, never modified by BioStats
└── Statistics_Project/
    ├── project.json
    ├── Data/
    ├── Analyses/             # Immutable analysis.json, frozen SVG, HTML report, optional input.csv
    ├── Figures/
    ├── Reports/
    └── History/
```

Check **Save the exact analyzed numerical values** (default) to archive the exact CSV table. Uncheck for large inputs; the saved analysis still includes statistical results, input fingerprint, imported filename/file SHA-256, edit status and frozen figure, but exact recomputation might be impossible. Some derived curve coordinates remain part of the frozen output. The original raw file is never changed. File-system access requires an explicit Chrome directory permission.

Original v0.1–v0.3 saved project records remain readable; every save adds a new immutable analysis entry, never overwriting previous P values or SVG figures. The `project.json` metadata schema remains 1.x. Git history preserves source commits, but reproducible historical installations and versioned Pages URLs still need separate release archival.

## Scientific and security notes

- Recorded library name alone is insufficient for reproducibility: `analysis.json` and the HTML report also include exact numerical results, function names, arguments, package versions, exported graph settings, and provenance.
- Check experimental unit and assumptions. The longitudinal **independent** model cannot be used for repeated measurements of the same animal. Repeated-measures ANOVA assumes sphericity for three or more time points; no corrected P value is supplied.
- One-way ANOVA uses Tukey-adjusted comparisons. Welch ANOVA uses pairwise Welch t tests + Holm (not Games–Howell), while Kruskal uses pairwise Mann–Whitney U tests + Holm (not Dunn's). Choose test models and planned comparisons before inspecting significance.
- `IC50` here means the concentration halfway between modeled upper and lower asymptotes, not the dose at 50% of untreated control. An estimated IC50 may be non-identifiable for poorly sampled or flat responses; the fitter rejects obvious out-of-range solutions. The reported interval is approximate, not a bootstrap profile likelihood interval.
- Python runs locally in Chrome using Pyodide but libraries arrive from external CDNs. Do not enter identifiable patient data or confidential data until dependency/security audits are completed.
- Exported SVGs contain vector geometry. Check symbol fonts and line widths in Illustrator or Inkscape before publication.
- Back up local project folders. Experimental input files are stored separately from the public application code.

## Source and testing

- `engine/engine.py`: backwards-compatible one-way engine and dispatcher.
- `engine/families.py`: method-specific calculations using SciPy/statsmodels.
- `src/families.js`: long-format data schema and validation.
- `src/plots-special.js`: scientific plots and SVG export-compatible Plotly traces.
- `src/main.js`: editable table, results, project controls and interactions.
- `src/projects.js`: frozen records and reports.
- `tests/test_engine.py`, `tests/test_comparisons.py`, `tests/test_families.py`: numerical regression tests.
- `tests/browser_families.py`: browser-interface smoke test with Plotly/Pyodide stubs; requires Playwright and Chromium locally. This is **not** a full CDN/Pyodide integration test.

Local Python check: `PYTHONPATH=. pytest -q tests/`. Static web check: run `python -m http.server 8000` at repository root, then open `http://localhost:8000` in Chrome.
