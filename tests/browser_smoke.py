import asyncio, json
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=await browser.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('dialog',lambda d:asyncio.create_task(d.accept()))
    import re
    html=(ROOT/'index.html').read_text()
    html=re.sub(r'<script[^>]*></script>', '', html)
    html=re.sub(r'<link[^>]+rel="stylesheet"[^>]*>', '', html)
    await page.goto('about:blank')
    await page.set_content(html,wait_until='domcontentloaded')
    await page.add_style_tag(content=(ROOT/'styles.css').read_text())
    await page.evaluate("window.Plotly={react:async(el,data,layout)=>{el.data=data;el.layout=layout;el.textContent='Plot rendered';},toImage:async()=>'data:image/svg+xml,%3Csvg%3E%3C/svg%3E'};")
    bundle='\n'.join((ROOT/'src'/file).read_text() for file in ('charts.js','stats.js','examples.js','projects.js','main.js'))
    bundle=re.sub(r'^import .*?;\n', '', bundle,flags=re.MULTILINE)
    bundle=re.sub(r'\bexport (?=(?:const|function|async|let|class))', '', bundle)
    bundle=bundle.replace("new URL('../engine/engine.py', import.meta.url)","'https://example.com/engine/engine.py'")
    await page.add_script_tag(content=bundle)
    methods=['anova','welch_anova','kruskal','ttest','welch_ttest','paired_ttest']
    total=0
    for method in methods:
      await page.select_option('#test-select', method)
      n=await page.locator('#example-select option').count()
      for j in range(n):
        await page.locator('#example-select').select_option(index=j)
        await page.click('#load-example')
        await page.wait_for_timeout(40)
        val=await page.locator('#edit-state').inner_text()
        ptext=await page.locator('#plot').inner_text()
        assert 'Check table:' not in val,(method,j,val)
        assert ptext=='Plot rendered',(method,j,ptext)
        total+=1
    # Validate Plotly graph options and independent annotation view using fabricated stats data
    await page.select_option('#test-select','anova')
    await page.select_option('#example-select','anova_four')
    await page.click('#load-example')
    # For the browser test we supply the real, independently checked engine output via a fake Pyodide bridge.
    # This tests JavaScript UI wiring, not Python math (covered in pytest).
    from sys import path
    path.insert(0,str(ROOT))
    from engine.engine import analyze
    groups=[{'name':'Control','values':[40,42,45,39,43]},{'name':'Drug A','values':[50,52,54,51,53]},
            {'name':'Drug B','values':[55,59,58,57,60]},{'name':'Drug C','values':[69,73,71,74,72]}]
    result=analyze({'test':'anova','groups':groups})
    js='''window.fetch=async()=>({ok:true,text:async()=>''});window.loadPyodide=async()=>({loadPackage:async()=>{},globals:{set:()=>{}},runPythonAsync:async(src)=>src.startsWith('run_from_json(')?JSON.stringify(window.__mockStat):null});window.__mockStat=JSON.parse(%s);'''%json.dumps(json.dumps(result))
    await page.evaluate(js)
    await page.click('#run-stats')
    await page.wait_for_timeout(200)
    assert await page.locator('.pair-checkbox').count()==6
    assert await page.locator('#plot').inner_text()=='Plot rendered'
    await page.select_option('#annotation-mode','all')
    assert await page.evaluate('document.querySelector("#plot").layout.annotations.length')==6
    await page.select_option('#annotation-format','p')
    assert await page.evaluate('document.querySelector("#plot").layout.annotations[0].text.includes("P(adj)")')
    ch=page.locator('.pair-checkbox').first
    await ch.uncheck()
    assert await page.input_value('#annotation-mode')=='custom'
    assert await page.evaluate('document.querySelector("#plot").layout.annotations.length')==5
    print('Teaching data plot previews:',total,'\nComparison rows: 6','\nUnexpected browser JS errors:',errors)
    if errors:raise AssertionError(errors)
    await browser.close()
asyncio.run(main())
