"""Optional isolated Chromium regressions: python3 dev/browser_regressions.py.
Requires Playwright and system Chromium; uses synthetic data in a temporary directory.
"""
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
BASE=''


def run():
    global BASE
    with tempfile.TemporaryDirectory(prefix='phb-browser-regression-') as temporary:
        root=Path(temporary)
        server=root/'server.py'
        server.write_text('''import sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import app as backend
backend.DOCUMENT_ROOT=Path(sys.argv[2])/"documents"
backend.IMPORT_QUEUE_ROOT=Path(sys.argv[2])/"queue"
backend.PROJECT_DOCUMENT_ROOT=Path(sys.argv[2])/"project-documents"
with backend.app.app_context():
 backend.initialize();backend._ensure_import_recovery()
 backend.RECEIPT_ROOT=Path(sys.argv[2])/"receipts";backend.RECEIPT_ROOT.mkdir()
 from pypdf import PdfWriter
 writer=PdfWriter();writer.add_blank_page(width=595,height=842)
 with (backend.RECEIPT_ROOT/"invoice.pdf").open("wb") as file:writer.write(file)
 backend.db.session.add(backend.Receipt(digest="browser-invoice",original_name="Testrechnung.pdf",stored_name="invoice.pdf",supplier="Browser-Testbetrieb",invoice_number="B-1",document_date="2026-10-26",gross_amount=100,paid_amount=0,status="Gebucht",assignment_type="Eigenleistung"))
 backend.db.session.commit()
from werkzeug.serving import make_server
server=make_server("127.0.0.1",0,backend.app,threaded=True)
print("PHB_TEST_PORT="+str(server.server_port),flush=True)
server.serve_forever()
''')
        environment={**os.environ,'DATABASE_URL':'sqlite:///'+str(root/'test.db'),
                     'PHB_CHATGPT_HOME':str(root/'auth'),'APP_PASSWORD':''}
        with (root/'server.log').open('w') as log:
            process=subprocess.Popen([str(ROOT/'.venv/bin/python'),str(server),str(ROOT),str(root)],env=environment,stdout=log,stderr=subprocess.STDOUT)
            try:
                for _ in range(70):
                    if process.poll() is not None:raise RuntimeError((root/'server.log').read_text())
                    match=re.search(r'PHB_TEST_PORT=(\d+)',(root/'server.log').read_text())
                    if match:
                        BASE='http://127.0.0.1:'+match.group(1);break
                    time.sleep(.1)
                if not BASE:raise RuntimeError('Isolierter Testserver konnte nicht starten.')
                with sync_playwright() as playwright:
                    browser=playwright.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
                    context=browser.new_context(viewport={'width':1440,'height':1000},service_workers='block')
                    page=context.new_page();errors=[]
                    page.on('pageerror',lambda error:(errors.append(str(error)),print('BROWSER ERROR:',error,flush=True)))
                    page.on('dialog',lambda dialog:dialog.accept())
                    def create(code,**values):
                        response=page.request.post(BASE+'/api/tasks',data={'code':code,'name':'Aufgabe '+code,**values})
                        assert response.status==201,response.text()
                        return response.json()['id']
                    a=create('A',duration=3);b=create('B',duration=2,predecessors=['A']);c=create('C',duration=2,predecessors=['B'])
                    page.goto(BASE+'/');expect(page.locator('#gantt .bar')).to_have_count(3)
                    bar=page.locator('#gantt .bar[data-id="'+str(b)+'"]');box=bar.bounding_box()
                    page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
                    page.mouse.down();page.mouse.move(box['x']+box['width']/2+78,box['y']+box['height']/2,steps=8);page.mouse.up()
                    expect(page.locator('#ganttStatus')).to_contain_text('07.03.2027')
                    assert not page.locator('#overlay').is_visible()
                    tasks=page.request.get(BASE+'/api/project').json()['tasks'];assert next(t for t in tasks if t['id']==b)['start']=='2027-03-07'
                    # Invalid upstream drag must roll back; keyboard is an equivalent accessible gesture.
                    page.locator('#gantt .bar[data-id="'+str(b)+'"]').focus()
                    page.keyboard.press('Alt+Shift+ArrowLeft')
                    expect(page.locator('#ganttStatus')).to_contain_text('erlauben diesen Termin nicht')
                    assert next(t for t in page.request.get(BASE+'/api/project').json()['tasks'] if t['id']==b)['start']=='2027-03-07'
                    page.locator('#gantt .gantt-label[data-id="'+str(b)+'"]').click()
                    expect(page.locator('#overlay')).to_be_visible()
                    expect(page.locator('#taskForm [name=predecessors]')).to_have_values(['A'])
                    expect(page.locator('#taskForm [name=successors]')).to_have_values(['C'])
                    page.locator('#complete').click();expect(page.locator('#overlay')).not_to_be_visible()
                    page.locator('#gantt .gantt-label[data-id="'+str(b)+'"]').click()
                    expect(page.locator('#taskForm [name=duration]')).to_be_disabled()
                    expect(page.locator('#taskForm [name=notes]')).to_be_enabled()
                    expect(page.locator('#taskForm [name=predecessors]')).to_be_enabled()
                    expect(page.locator('#taskForm [name=successors]')).to_be_enabled()
                    page.locator('#taskForm [name=notes]').fill('Nachträgliche Dokumentation')
                    expect(page.locator('#taskForm button[type=submit]')).not_to_be_visible();expect(page.locator('#delete')).not_to_be_visible()
                    expect(page.locator('#taskAutosaveStatus')).to_contain_text('Automatisch gespeichert',timeout=6000)
                    assert next(t for t in page.request.get(BASE+'/api/project').json()['tasks'] if t['id']==b)['notes']=='Nachträgliche Dokumentation'
                    page.locator('#reopenTask').click();page.locator('.phb-messagebox button',has_text='Bestätigen').click()
                    expect(page.locator('#taskForm [name=duration]')).to_be_enabled();expect(page.locator('#taskForm button[type=submit]')).to_be_visible()
                    page.locator('#cancel').click()
                    print('PASS: drag, completed-task autosave, hidden save/delete and reopening')

                    # Keep genuine page data/APIs; simulate slow background analysis at the queue boundary.
                    queue={'jobs':[],'terminal':False,'posts':0,'error':False}
                    def jobs():
                        result=[]
                        for job in queue['jobs']:
                            record={**job,'status':'Fehler' if queue['error'] else 'Fertig'} if queue['terminal'] else {**job,'status':'Läuft'}
                            record['error']='Absichtlicher Testfehler' if queue['error'] and queue['terminal'] else ''
                            result.append(record)
                        return result
                    def route(request):
                        if request.request.method=='POST':
                            queue['posts']+=1
                            kind=queue['kind'];queue['jobs']=[{'id':queue['posts'],'kind':kind,'batch_id':'a'*32,
                                'filename':'Test.txt','stage':'Testanalyse','analysis_mode':'local','result_id':1,
                                'created_at':datetime.now(timezone.utc).isoformat(),'updated_at':datetime.now(timezone.utc).isoformat(),
                                'finished_at':datetime.now(timezone.utc).isoformat(),'review_url':None}]
                            request.fulfill(status=202,json={'jobs':jobs(),'batch_id':'a'*32})
                        else:request.fulfill(json={'jobs':jobs()})
                    context.route('**/api/import-jobs',route)
                    context.route('**/api/import-jobs/batches/*',route)
                    cases=[('/angebote','offers','openOfferWorkflow','offerImportForm','offerImportStatus','offerWorkflowDialog'),
                           ('/belege','receipts','openReceiptWorkflow','upload','uploadStatus','receiptWorkflowDialog'),
                           ('/dokumente','documents','openDocUpload','projectDocumentUpload','docMessage','docUploadDialog'),
                           ('/kosten','costplans','openPlanUpload','planUploadForm','planUploadMessage','planUploadDialog')]
                    for path,kind,launcher,form,status,dialog in cases:
                        queue.update(jobs=[],terminal=False,error=False,kind=kind)
                        page.goto(BASE+path);page.locator('#'+launcher).click()
                        page.locator('#'+form+' input[type=file]').set_input_files({'name':'Test.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.4 synthetic test'})
                        submit=page.locator('#'+form+' button[type=submit]');submit.click()
                        expect(submit).to_be_disabled();expect(page.locator('#'+form+' input[type=file]')).to_be_disabled()
                        page.wait_for_timeout(1200);assert page.locator('#'+dialog).is_visible()
                        posts=queue['posts']
                        page.evaluate("window.__duplicate=PHBImports.enqueue({kind:'"+kind+"',files:[new File(['test'],'Test.pdf')]}).then(()=>false).catch(()=>true)")
                        assert page.evaluate('window.__duplicate');assert queue['posts']==posts
                        queue['terminal']=True
                        expect(page.locator('#'+dialog)).not_to_be_visible(timeout=7000)
                        expect(page.locator('#'+launcher)).to_be_enabled(timeout=7000)
                        print('PASS:',kind,'stays locked after HTTP 202 and unlocks only at terminal analysis')
                    # Visible terminal error releases the initiating action for retry.
                    queue.update(jobs=[],terminal=False,error=False,kind='costplans')
                    page.goto(BASE+'/kosten');page.locator('#openPlanUpload').click()
                    page.locator('#planUploadForm input[type=file]').set_input_files({'name':'Fehler.txt','mimeType':'text/plain','buffer':b'test'})
                    page.locator('#planUploadForm button[type=submit]').click();page.wait_for_timeout(300)
                    queue.update(terminal=True,error=True)
                    expect(page.locator('#planUploadMessage')).to_contain_text('Absichtlicher Testfehler',timeout=7000)
                    expect(page.locator('#planUploadForm button[type=submit]')).to_be_enabled()
                    # Navigate while processing: the newly loaded page resumes the server-side lock.
                    page.locator('#closePlanUpload').click()
                    queue.update(terminal=False,error=False)
                    page.goto(BASE+'/kosten');expect(page.locator('#openPlanUpload')).to_be_disabled(timeout=7000)
                    queue.update(terminal=True,error=False)
                    expect(page.locator('#openPlanUpload')).to_be_enabled(timeout=7000)
                    print('PASS: error recovery, duplicate protection and resumed locks after navigation')
                    context.route('**/api/ai/status',lambda request:request.fulfill(json={'connected':True,'sharing':True,'credits_acknowledged':True,'email':'test@example.test'}))
                    context.route('**/api/ai/models',lambda request:request.fulfill(json={'models':[{'slug':'test','name':'Test'}]}))
                    captured=[]
                    context.route('**/api/financing/loans/ai/extract',lambda request:captured.append(request))
                    page.goto(BASE+'/finanzierung');expect(page.locator('#phbChatGPTLabel')).to_have_text('ChatGPT verbunden')
                    page.locator('#newLoan').click();page.locator('#loanAiDetails').evaluate('(e)=>e.open=true')
                    page.locator('#loanAiFile').set_input_files({'name':'Kredit.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.4 test'})
                    page.locator('#loanAiAnalyze').click()
                    for _ in range(40):
                        if captured:break
                        page.wait_for_timeout(50)
                    assert len(captured)==1
                    expect(page.locator('#loanAiAnalyze')).to_be_disabled();expect(page.locator('#closeLoan')).to_be_disabled();expect(page.locator('#loanSaveButton')).to_be_disabled()
                    page.keyboard.press('Escape');expect(page.locator('#loanDialog')).to_be_visible()
                    page.evaluate("document.getElementById('loanAiAnalyze').click()")
                    assert len(captured)==1
                    captured[0].fulfill(status=502,json={'error':'Test: Analyse fehlgeschlagen'})
                    expect(page.locator('#loanAiStatus')).to_contain_text('Test: Analyse fehlgeschlagen')
                    expect(page.locator('#loanAiAnalyze')).to_be_enabled();expect(page.locator('#closeLoan')).to_be_enabled()
                    if page.locator('.phb-messagebox').is_visible():page.locator('.phb-messagebox button').last.click()
                    page.locator('#closeLoan').click()
                    if page.locator('.phb-messagebox').is_visible():page.locator('.phb-messagebox button',has_text='Bestätigen').click()
                    print('PASS: direct loan scan blocks duplicate actions, save, close and Escape until error response')
                    page.goto(BASE+'/belege');page.locator('#list .entry').first.click()
                    page.locator('#markReceiptPaid').click();page.locator('.phb-messagebox button',has_text='Bestätigen').click()
                    expect(page.locator('#list .entry').first).to_contain_text('Nicht zugewiesen')
                    rid=page.request.get(BASE+'/api/receipts').json()['receipts'][0]['id']
                    assert page.request.get(BASE+'/api/receipts/'+str(rid)).json()['paid_amount']==100
                    account=page.request.post(BASE+'/api/financing/equity',data={'name':'Späteres Konto','opening_balance':200,'reserve':0})
                    assert account.status==201,account.text()
                    page.locator('#payReceipt').click();page.locator('[data-assign-payment]').first.click()
                    expect(page.locator('#receiptPaymentSource')).to_have_value('equity')
                    page.locator('#submitReceiptPayment').click();page.locator('.phb-messagebox button',has_text='Bestätigen').click()
                    expect(page.locator('[data-unassign-payment]')).to_be_visible()
                    assigned=page.request.get(BASE+'/api/receipts/'+str(rid)).json();assert assigned['paid_amount']==100 and assigned['unassigned_amount']==0
                    page.locator('[data-unassign-payment]').click();page.locator('.phb-messagebox button',has_text='Bestätigen').click()
                    expect(page.locator('[data-assign-payment]')).to_be_visible()
                    assert page.request.get(BASE+'/api/receipts/'+str(rid)).json()['paid_amount']==100
                    page.locator('#closeReceiptPayment').click();page.locator('#cancelReceipt').click()
                    expect(page.locator('#receiptCancelDialog')).to_be_visible()
                    page.locator('#receiptCancelReason').fill('Durch neue Rechnung ersetzt')
                    page.locator('#receiptCancelForm button[type=submit]').click();expect(page.locator('#receiptCancelDialog')).not_to_be_visible()
                    expect(page.locator('#list .entry').first).to_contain_text('Storniert')
                    cancelled=page.request.get(BASE+'/api/receipts/'+str(rid)).json();assert cancelled['paid_amount']==0 and cancelled['cancellation']['reason']=='Durch neue Rechnung ersetzt'
                    assert page.request.get(BASE+'/api/receipts/'+str(rid)+'/download').status==200
                    page.locator('#closeReceiptWorkflow').click()
                    page.goto(BASE+'/');expect(page.locator('#scheduleChatFab')).to_be_visible()
                    assert page.locator('#scheduleChatFab').evaluate("e=>getComputedStyle(e).position")=='fixed'
                    box=page.locator('#scheduleChatFab').bounding_box();assert box['x']+box['width']>1390 and box['y']+box['height']>950
                    page.set_viewport_size({'width':360,'height':800})
                    floating=page.locator('#scheduleChatFab').bounding_box();feed=page.locator('#phbImportCenter').bounding_box()
                    assert not feed or floating['x']>=feed['x']+feed['width']+4,'Floating chat must not overlap the import widget'
                    context.route('**/api/ai/status',lambda request:request.fulfill(json={'connected':False,'sharing':False,'credits_acknowledged':False}))
                    page.reload();expect(page.locator('#scheduleChatFab')).not_to_be_visible()
                    print('PASS: source-free payment, later assignment without double payment, retained invoice cancellation, connection-gated floating button')
                    for width in (360,768,1440):
                        page.set_viewport_size({'width':width,'height':950})
                        for path in ['/','/kosten','/angebote','/belege','/finanzierung','/dokumente','/energieplanung','/stammdaten','/daten']:
                            page.goto(BASE+path);page.locator('#phbThemeMode').select_option('dark')
                            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(path,width)
                            gaps=page.locator('.phb-action-header').evaluate_all("nodes=>nodes.map(n=>{const first=n.firstElementChild?.getBoundingClientRect(),last=n.lastElementChild?.getBoundingClientRect();return first&&last?Math.max(0,last.top-first.bottom):0;})")
                            assert all(gap<=32 for gap in gaps),(path,width,'header action gap',gaps)
                            if os.environ.get('PHB_BROWSER_SCREENSHOTS'):
                                output=Path(os.environ['PHB_BROWSER_SCREENSHOTS']);output.mkdir(parents=True,exist_ok=True)
                                page.screenshot(path=str(output/((path[1:] or 'gantt')+'-'+str(width)+'.png')),full_page=True)
                    assert not errors,errors
                    print('PASS: nine pages at 360/768/1440px, dark theme, no runtime errors or page overflow')
                    browser.close()
            finally:
                process.terminate();process.wait(timeout=10)


if __name__=='__main__':run()
