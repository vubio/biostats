let pyodideInstance = null;
let pyodidePromise = null;
let codeLoaded = false;
export async function runStatisticalTest(input, onState = () => {}) {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      if (typeof window.loadPyodide !== 'function') throw new Error('Python runtime script unavailable. Check your internet connection.');
      onState('Loading Python runtime…');
      const py = await window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/' });
      onState('Loading SciPy and statsmodels…');
      await py.loadPackage(['numpy', 'scipy', 'statsmodels']);
      return py;
    })();
  }
  try {
    pyodideInstance = await pyodidePromise;
    if (!codeLoaded) {
      const url = new URL('../engine/engine.py', import.meta.url);
      const response = await fetch(url);
      if (!response.ok) throw new Error('Could not load the statistical engine');
      const source = await response.text();
      await pyodideInstance.runPythonAsync(source);
      codeLoaded = true;
    }
    pyodideInstance.globals.set('analysis_json', JSON.stringify(input));
    onState('Calculating…');
    const output = await pyodideInstance.runPythonAsync('run_from_json(analysis_json)');
    return JSON.parse(output);
  } catch (e) {
    // Allow a retry after an initial network error.
    if (!pyodideInstance) pyodidePromise = null;
    throw e;
  }
}
