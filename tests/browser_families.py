"""Headless Chrome integration smoke test with Plotly/Pyodide bridge stubs.

Python math validated independently in pytest; this checks actual page wiring.
"""
import asyncio, json, re
from pathlib import Path
from playwright.async_api import async_playwright
from engine.families import analyze_family
ROOT=Path(__file__).resolve().parents[1]


def python_records(test, csv):
    lines=[x.split(',') for x in csv.splitlines()]; rows=lines[1:]
    if test=='time_independent':return [{'a':r[0],'b':r[1],'value':float(r[2])} for r in rows]
    if test=='time_repeated':return [{'subject':r[0],'time':r[1],'value':float(r[2])} for r in rows]
    if test=='two_factor':return [{'a':r[0],'b':r[1],'value':float(r[2])} for r in rows]
    if test=='survival_logrank':return [{'subject':r[0],'group':r[1],'time':float(r[2]),'event':int(r[3])} for r in rows]
    if test=='dose_4pl':return [{'group':r[0],'dose':float(r[1]),'value':float(r[2])} for r in rows]
    raise ValueError(test)

async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=await browser.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('dialog',lambda d:asyncio.create_task(d.accept()))
    html=(ROOT/'index.html').read_text()
    html=re.sub(r'<script[^>]*></script>', '', html)
    html=re.sub(r'<link[^>]+rel="stylesheet"[^>]*>', '', html)
    await page.goto('about:blank');await page.set_content(html,wait_until='domcontentloaded')
    await page.add_style_tag(content=(ROOT/'styles.css').read_text())
    await page.evaluate("window.Plotly={react:async(el,data,layout)=>{el.data=data;el.layout=layout;el.textContent='Plot rendered';},toImage:async()=>'data:image/svg+xml,%3Csvg%3E%3C/svg%3E'};")
    bundle='\n'.join((ROOT/'src'/file).read_text() for file in ('charts.js','plots-special.js','stats.js','examples.js','families.js','projects.js','main.js'))
    bundle=re.sub(r'^import .*?;\n', '',bundle,flags=re.MULTILINE)
    bundle=re.sub(r'\bexport (?=(?:const|function|async|let|class))', '',bundle)
    bundle=bundle.replace("new URL('../engine/engine.py', import.meta.url)","'https://example.com/engine/engine.py'")
    bundle=bundle.replace("new URL('../engine/families.py', import.meta.url)","'https://example.com/engine/families.py'")
    await page.add_script_tag(content=bundle)
    passed=[]
    for family,test in [('time','time_independent'),('time','time_repeated'),('factorial','two_factor'),('survival','survival_logrank'),('dose','dose_4pl')]:
      await page.select_option('#analysis-family',family)
      await page.select_option('#test-select',test)
      await page.click('#load-example')
      await page.wait_for_timeout(140)
      preview=await page.locator('#plot').inner_text()
      assert preview=='Plot rendered',(test,preview, await page.locator('#message').inner_text())
      # load exactly this example's source table for independent numerical verification
      example=(await page.evaluate("({csv:examples.find(e=>e.id===document.getElementById('example-select').value).csv})"))['csv']
      result=analyze_family({'family':family,'test':test,'records':python_records(test,example)})
      js="window.fetch=async()=>({ok:true,text:async()=>''});window.loadPyodide=async()=>({loadPackage:async()=>{},globals:{set:()=>{}},runPythonAsync:async(src)=>src.startsWith('run_from_json(')?JSON.stringify(window.__mockStat):null});"
      await page.evaluate(js)
      await page.evaluate('(value)=>{window.__mockStat=value}',result)
      await page.click('#run-stats');await page.wait_for_timeout(180)
      resultHTML=await page.locator('#analysis-results').inner_text()
      # Reports must support both inferential P values and IC50-only results.
      report=await page.evaluate("(r)=>makeReport({statistics:r,dataset:{name:'Synthetic',note:'Example',family:'special',source:{kind:'example'},processed_values_stored:false,processed_sha256:'examplehash'},graph:{settings:{annotationMode:'none',annotationFormat:'stars',shownPairs:[]},renderer:'Plotly.js',renderer_version:'3.7.0'},software:{version:'0.4.0',runtime:'Pyodide',source_page:'demo'},schema_version:'1.1.0',created_at:'2026-10-17'})",result)
      assert 'Reproducibility: Python statistical calculation' in report,(test,'Missing report')
      assert result['label'] in resultHTML,(test,resultHTML)
      assert await page.locator('#plot').inner_text()=='Plot rendered',(test,'post-analysis plot failed')
      if test=='dose_4pl':
        assert 'IC50' in resultHTML and await page.evaluate('document.querySelector("#plot").data.length')==2
      if test=='survival_logrank':
        assert await page.locator('#comparison-matrix tbody tr').count()==3
      passed.append(test)
    # Legacy group analyses remain usable after switching families.
    await page.select_option('#analysis-family','groups')
    group_tests=['anova','welch_anova','kruskal','ttest','welch_ttest','paired_ttest']
    group_count=0
    for test in group_tests:
      await page.select_option('#test-select',test)
      num=await page.locator('#example-select option').count()
      for j in range(num):
        await page.locator('#example-select').select_option(index=j)
        await page.click('#load-example')
        await page.wait_for_timeout(70)
        assert await page.locator('#plot').inner_text()=='Plot rendered',(test,j,await page.locator('#plot').inner_text())
        group_count+=1
    print('Legacy group examples still render:',group_count)
    # Confirm switching family doesn't silently retain invalid old input
    await page.select_option('#analysis-family','groups')
    assert await page.locator('#data-preview').inner_text()=='No data yet. Use Create blank table, Load example, or Import.'
    assert not errors,errors
    print('PASS: browser previews and result panels',passed)
    await browser.close()
asyncio.run(main())
