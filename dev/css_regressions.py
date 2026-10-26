"""Visual/component checks with populated synthetic data: python3 dev/css_regressions.py."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]


def run():
    output=Path(os.environ.get('PHB_CSS_SCREENSHOTS','/tmp/phb-css-review'));output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='phb-css-') as temporary:
        root=Path(temporary);server=root/'server.py'
        server.write_text('''import sys,json
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import app as b
b.DOCUMENT_ROOT=Path(sys.argv[2])/"documents";b.DOCUMENT_ROOT.mkdir()
with b.app.app_context():
 b.initialize();b._ensure_import_recovery()
 company=b.Contractor(name="Beispielbetrieb für energetische Modernisierung GmbH",trade="Dach & Fassade")
 b.db.session.add(company);b.db.session.flush()
 lines=[]
 for i,title in enumerate(["Dachflächen dämmen inklusive Anschlussdetails und Gerüstarbeiten", "Fenster und Außentüren ersetzen", "Elektroinstallation vollständig erneuern", "Innenräume in Eigenleistung renovieren"]):
  line=b.BudgetLine(code="K"+str(i),title=title,category=["Dach & Fassade","Fenster & Türen","Elektro","Innenausbau"][i],estimate=12345.67*(i+1),kind="Eigenleistung" if i==3 else "Fremdleistung",sort_order=i,company_hint=company.name)
  b.db.session.add(line);lines.append(line)
 b.db.session.flush()
 b.db.session.add(b.CostItem(title="Zusätzliche Materialkosten und eigene Arbeitszeit",category="Innenausbau",kind="Eigenleistung",state="Schätzung",estimate=1200,paid=200,own_hours=45,own_hourly=25,budget_line_id=lines[3].id,contractor_id=company.id))
 b.db.session.add(b.Loan(name="Modernisierung",principal=200000));b.db.session.add(b.EquityAccount(name="Eigenmittel",opening_balance=50000,reserve=0))
 doc=b.Document(original_name="Kostenaufstellung_Architekt_Musterprojekt.csv",stored_name="plan.csv",kind="Kostenplanung")
 b.db.session.add(doc);b.db.session.flush();(b.DOCUMENT_ROOT/"plan.csv").write_text("Position;Gewerk;Schätzung\\nFenster;Fenster;1234,56")
 b.db.session.add(b.CostPlanImport(document_id=doc.id,digest="demo-plan",analysis_mode="local",rows_json=json.dumps([dict(title="Fenster nach Architektenplanung",category="Fenster",estimate=1234.56,is_group=False)]),warnings_json="[]"))
 for i in range(5):b.db.session.add(b.Task(code="T"+str(i),name="Arbeitspaket "+str(i)+" mit einer aussagekräftigen Bezeichnung",phase="Innenausbau",trade="Elektro",duration=4,position=i,lag_days=0,execution_type="Eigenleistung" if i==1 else "Fremdleistung",status="Offen",progress=0))
 b.db.session.commit()
from werkzeug.serving import make_server
s=make_server("127.0.0.1",0,b.app,threaded=True);print("PHB_TEST_PORT="+str(s.server_port),flush=True);s.serve_forever()
''')
        with (root/'server.log').open('w') as log:
            process=subprocess.Popen([str(ROOT/'.venv/bin/python'),str(server),str(ROOT),str(root)],env={**os.environ,'DATABASE_URL':'sqlite:///'+str(root/'test.db'),'PHB_CHATGPT_HOME':str(root/'auth'),'APP_PASSWORD':''},stdout=log,stderr=subprocess.STDOUT)
            try:
                base=None
                for _ in range(80):
                    if process.poll() is not None:raise RuntimeError((root/'server.log').read_text())
                    match=re.search(r'PHB_TEST_PORT=(\d+)',(root/'server.log').read_text())
                    if match:base='http://127.0.0.1:'+match.group(1);break
                    time.sleep(.1)
                assert base,'test server startup'
                with sync_playwright() as p:
                    browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
                    context=browser.new_context(viewport={'width':1440,'height':950},service_workers='block',locale='de-DE')
                    context.route('**/api/ai/status',lambda r:r.fulfill(json={'connected':True,'sharing':True,'credits_acknowledged':True,'email':'test@example.test'}))
                    context.route('**/api/ai/models',lambda r:r.fulfill(json={'models':[{'slug':'test','name':'Test'}]}))
                    page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
                    def check_buttons():
                        failures=page.locator('.phb-button:visible').evaluate_all('''nodes=>nodes.map(e=>{const s=getComputedStyle(e),compact=e.matches('.mini,.phb-button--compact');return {id:e.id,text:e.textContent.trim().slice(0,45),radius:s.borderRadius,font:s.fontSize,line:s.lineHeight,height:e.getBoundingClientRect().height,expected:compact?'12px':'13px',close:e.classList.contains('phb-ai-close')};}).filter(x=>!x.close&&(x.radius!=='8px'||x.font!==x.expected||x.line!=='20px'||x.height<31))''')
                        assert not failures,(page.url,page.viewport_size,failures)
                    for width in (360,768,1024,1440):
                        page.set_viewport_size({'width':width,'height':950})
                        for theme in ('light','dark'):
                            for path in ('/','/kosten','/angebote','/belege','/finanzierung','/dokumente','/energieplanung','/stammdaten','/daten'):
                                page.goto(base+path);page.wait_for_load_state('networkidle');page.locator('#phbThemeMode').select_option(theme)
                                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(path,width,theme,'page overflow')
                                check_buttons()
                                if path in ('/','/kosten'):
                                    page.screenshot(path=str(output/((path[1:] or 'gantt')+'-'+str(width)+'-'+theme+'.png')),full_page=True)
                                if path=='/':
                                    fab=page.locator('#scheduleChatFab');expect(fab).to_be_visible()
                                    assert fab.evaluate('e=>e.scrollWidth<=e.clientWidth'),('chat button content clips',width)
                                    expect(fab.locator('.schedule-chat-fab-open')).to_be_visible()
                                    fab.click();expect(page.locator('#aiScheduleChatPanel')).to_be_visible();expect(fab.locator('.schedule-chat-fab-close')).to_be_visible()
                                    bounds=page.locator('#aiScheduleChatPanel').bounding_box();button=fab.bounding_box()
                                    assert bounds['x']>=0 and bounds['x']+bounds['width']<=width+1 and bounds['y']>=0 and bounds['y']+bounds['height']<=button['y']-4,(width,bounds,button)
                                    page.screenshot(path=str(output/('chat-open-'+str(width)+'-'+theme+'.png')))
                                    check_buttons();page.locator('#scheduleChatClose').click();expect(fab.locator('.schedule-chat-fab-open')).to_be_visible()
                                if path=='/kosten':
                                    panels=page.locator('.budget-panel').evaluate_all('''nodes=>nodes.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};})''')
                                    assert max(x['width'] for x in panels)-min(x['width'] for x in panels)<2,('cost panel widths',width)
                                    assert page.locator('.budget-panel .panelbar').evaluate_all("nodes=>nodes.every(e=>getComputedStyle(e).flexDirection==='row'&&e.getBoundingClientRect().height<300)"),('cost headers create empty space',width)
                                    assert page.locator('#categories td.amount').first.evaluate('e=>getComputedStyle(e).textAlign')=='right'
                                    page.locator('#addLine').click();expect(page.locator('#editor')).to_be_visible();check_buttons()
                                    assert page.locator('#editFields input[name=estimate]').evaluate('e=>e.getBoundingClientRect().width>100')
                                    page.screenshot(path=str(output/('cost-editor-'+str(width)+'-'+theme+'.png')))
                                    page.locator('#closeDialog').click()
                                    page.locator('#openCostUpload').click();expect(page.locator('#costDocumentDialog')).to_be_visible();check_buttons();page.locator('#closeCostUpload').click()
                                    page.locator('#planImportList [data-plan]').first.click();expect(page.locator('#planReviewDialog')).to_be_visible();check_buttons();page.locator('#closePlanReview').click()
                            print('PASS:',width,theme,'nine pages, populated cost tables/editors and chat open/closed',flush=True)
                    # Short windows must keep the composer reachable, including mobile landscape.
                    for width,height in ((360,640),(768,390),(1440,650)):
                        page.set_viewport_size({'width':width,'height':height});page.goto(base+'/')
                        page.locator('#scheduleChatFab').click();expect(page.locator('#aiScheduleChatPanel')).to_be_visible()
                        send=page.locator('#scheduleChatSend');send.scroll_into_view_if_needed()
                        box=send.bounding_box();panel=page.locator('#aiScheduleChatPanel').bounding_box()
                        assert box['y']>=panel['y'] and box['y']+box['height']<=panel['y']+panel['height'],('short-window composer clips',width,height,box,panel)
                        page.screenshot(path=str(output/('chat-short-'+str(width)+'x'+str(height)+'.png')))
                    print('PASS: chat composer accessible in short windows and mobile landscape',flush=True)
                    assert not errors,errors
                    browser.close()
            finally:process.terminate();process.wait(timeout=10)


if __name__=='__main__':run()
