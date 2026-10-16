# BioStats · v0.1.0 (prototype)

An open-source, browser-first biomedical statistics workspace. **Early research prototype:** validate against an independently verified program before using results in manuscripts. Current scope: independent groups and one continuous outcome.

## What works in this first version

- Paste an Excel table with one group per column, or import CSV/TSV/XLS/XLSX (first sheet)
- Plot individual values, bar + individual values, or box + individual values
- Graph controls for SD / SEM, palette, axis labels and maximum, title, font size and export width
- Download **true vector SVG** and PNG; Chrome **Print → Save as PDF** from an SVG figure
- Run Python scientific tests in Chrome via Pyodide 0.28.3:
  - Two independent groups: unpaired Student's or Welch's t test
  - Three or more independent groups: ordinary one-way ANOVA + Tukey HSD, Welch's one-way ANOVA, Kruskal–Wallis
- See numerical results and exact package/library functions and versions
- Open/create a local QuPath-style project folder (Chrome desktop, with consent)
- Save a new, immutable analysis entry containing frozen SVG, analyzed numerical inputs, full statistical JSON, and HTML report
- Reopen saved records for viewing without recalculation

## Step 1: Create repository

1. Visit <https://github.com/new> and create a **public** repository named `biostats` (add a README if desired).
2. Option A: Ask ChatGPT to upload this starter app to the repository through its connected GitHub app.
3. Option B: Unzip this package, select all its contents, and drag them into GitHub's **Add file → Upload files** page. Ensure `index.html`, `styles.css`, `src/` and `engine/` remain at the repository root. Commit changes.

## Step 2: Enable GitHub Pages

In your repository, open **Settings → Pages → Build and deployment**. Select **Deploy from a branch**, `main`, `/(root)`, then **Save**. Your app will appear at:

`https://vubio.github.io/biostats/`

It may take time for the website to publish. Check the **Actions** tab for deployment state if needed.

## Step 3: Create your first statistics project

1. On your PC, create an **empty folder**, e.g. `Research/Experiment_A/Statistics_Project/`.
2. Open the published app in **desktop Chrome** using HTTPS.
3. Click **New project**, select that folder, and grant Chrome read/write permission.
4. Click **Load example data**, then **Run statistical analysis**. Python libraries load on first use.
5. Change graph settings, click **Export SVG vector** to inspect the export.
6. Click **Save analysis + figure to project**. Find the frozen results under your chosen folder.
7. Reopen that folder with **Open project folder**; click **View frozen original**.

### Local project folder layout

```text
Statistics_Project/
  project.json
  README.txt
  Data/             # compact numerical input tables actually analyzed
  Analyses/         # each timestamped immutable calculation, inputs, SVG, HTML
  Figures/          # SVG copies for vector editors
  Reports/          # HTML copies of human-readable statistics reports
  History/          # reserved for project migrations and revision logs
```

Original images, instrument files, large raw XLSX files, etc., stay **outside** this project. The project stores the compact numerical input used for statistics so analysis remains reproducible.

## Safety and scientific scope

- **No publication-grade validation yet.** The included Python tests are initial smoke tests, not comprehensive statistical QA.
- No repeated-measures, paired, nested, two-way ANOVA, missing-data modeling or survival analyses yet.
- Ordinary ANOVA uses Tukey's HSD for post hoc tests. Welch and Kruskal–Wallis currently have **no post hoc**; do not interpret overall significance as pairwise significance.
- The user must assess independent experimental units, biological vs. technical replicates, outliers, variance assumptions, and the comparison plan.
- Avoid identifiable patient or confidential data in this prototype until its dependency and security strategy has been reviewed. Experiment values are processed in-browser, but the app loads JavaScript/Python runtimes from external pinned CDNs.
- SVG export uses SVG-based Plotly traces (not WebGL) to retain genuine vector elements.
- PDF is created using Chrome's print dialog; inspect exported PDFs in your vector editor to confirm expected editability.
- Existing records are not edited by the app's normal actions. A new analysis always creates a new ID and new report/figure files. Keep regular backups of your local project folder.
- The app records package versions and statistical function arguments. Exact reanalysis in a future environment may require matching historical dependency versions and rehydrating the original software release. Create Git tags for released versions.

## Development notes

Current structure is deliberately modular: `engine/engine.py` contains the computational functions, `src/stats.js` bridges the Python WebAssembly runtime, `src/charts.js` holds Plotly figure generation/export, `src/projects.js` provides file management and reporting, `src/main.js` contains the UI glue.

Dependencies are **pinned** in `index.html` and `src/stats.js`: Plotly.js 3.7.0, XLSX 0.18.5, Pyodide 0.28.3 (with SciPy 1.14.1 and statsmodels 0.14.4). For a true archived release, tag the source commit and archive the exact deployed static build/assets. Future upgrades should never mutate saved analyses.

For local development, serve this directory over HTTP (`python -m http.server 8000`), visit `http://localhost:8000` in Chrome. `file://` may block module imports or the Python code fetch.
