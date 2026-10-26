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
        server.write_text('''import sys,json
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
 backend.db.session.add(backend.Receipt(digest="draft-invoice",original_name="Entwurf.pdf",stored_name="draft.pdf",supplier="",document_date="",gross_amount=None,paid_amount=0,status="Entwurf"))
 (backend.RECEIPT_ROOT/"draft.pdf").write_bytes((backend.RECEIPT_ROOT/"invoice.pdf").read_bytes())
 backend.DOCUMENT_ROOT.mkdir();backend.PROJECT_DOCUMENT_ROOT.mkdir()
 (backend.DOCUMENT_ROOT/"offer.pdf").write_bytes((backend.RECEIPT_ROOT/"invoice.pdf").read_bytes())
 doc=backend.Document(id=1,original_name="Angebot.pdf",stored_name="offer.pdf",kind="Angebot")
 backend.db.session.add(doc);backend.db.session.flush()
 backend.db.session.add(backend.Offer(id=101,digest="review-offer",vendor="Prüfangebot",filename="Angebot.pdf",document_id=1,gross=500,status="Entwurf"))
 backend.db.session.add(backend.Offer(id=102,digest="version-offer",vendor="Versionsangebot",filename="Manuell",gross=600,status="Angebot"))
 backend.db.session.flush()
 snapshot=dict(vendor="Versionsangebot",filename="Angebot.pdf",gross=700,net=700/1.19,vat=700-700/1.19,status="Angebot",category="Sonstiges",warnings="[]",positions=[],sections=[],document_id=1)
 backend.db.session.add(backend.OfferVersion(offer_id=102,version_number=2,state="draft",document_id=1,snapshot=json.dumps(snapshot)))
 backend.db.session.add(backend.CostPlanImport(id=1,document_id=1,digest="review-plan",analysis_mode="local",rows_json=json.dumps([dict(title="Fenster",category="Fenster",estimate=400,is_group=False)]),warnings_json="[]"))
 (backend.PROJECT_DOCUMENT_ROOT/"review.txt").write_text("Projektunterlage zur Prüfung")
 backend.db.session.add(backend.ProjectDocument(id=1,title="Prüfdokument",original_name="review.txt",stored_name="review.txt",extension=".txt",digest="review-doc",size_bytes=28,category="Sonstiges",area="Allgemein"))
 backend.db.session.add(backend.ImportJob(id=99,batch_id="f"*32,kind="loans",filename="Kredit.pdf",stored_name="scan.pdf",analysis_mode="ai",status="Fertig",result_id=99,extra_json=json.dumps(dict(loan_id=None,values=dict(name="Eigene Kreditbezeichnung"),analysis=dict(fields=dict(principal=50000,interest_rate=3),warnings=["Vertrag prüfen"]),overwrite=False))))
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
                            record['review_url']=queue.get('review_url') if queue['terminal'] and not queue['error'] else None
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
                    # All automatic upload areas use the same explicit foreground/background contract.
                    mode_cases=[
                        ('/angebote','offers','openOfferWorkflow','offerImportForm','offerWorkflowDialog','/angebote?offer_draft=101','offerWorkflowDialog'),
                        ('/belege','receipts','openReceiptWorkflow','upload','receiptWorkflowDialog','/belege?receipt_id=2','receiptWorkflowDialog'),
                        ('/dokumente','documents','openDocUpload','projectDocumentUpload','docUploadDialog','/dokumente?document_id=1','docEditDialog'),
                        ('/kosten','costplans','openPlanUpload','planUploadForm','planUploadDialog','/kosten?cost_plan_import=1','planReviewDialog'),
                        ('/angebote','versions',None,None,None,'/angebote?offer_draft=102','offerWorkflowDialog'),
                        ('/finanzierung','loans','newLoan','loanForm','loanDialog','/finanzierung?loan_scan=99','loanDialog')]
                    for processing in ('foreground','background'):
                        for path,kind,launcher,form_id,dialog_id,review_url,review_dialog in mode_cases:
                            queue.update(jobs=[],terminal=False,error=False,kind=kind,review_url=review_url)
                            page.goto(BASE+path);page.wait_for_load_state('networkidle')
                            if launcher:page.locator('#'+launcher).click()
                            if kind=='versions':
                                card=page.locator('[data-offer-card="102"]');card.locator('[data-offer-expand]').click()
                                card.locator('.offer-version-upload-details').evaluate('e=>e.open=true')
                                form=card.locator('form[data-version-upload]');file_input=form.locator('input[type=file]');submit=form.locator('button[type=submit]')
                            elif kind=='loans':
                                page.locator('#loanAiDetails').evaluate('e=>e.open=true')
                                form=page.locator('#loanForm');file_input=page.locator('#loanAiFile');submit=page.locator('#loanAiAnalyze')
                            else:
                                form=page.locator('#'+form_id);file_input=form.locator('input[type=file]');submit=form.locator('button[type=submit]')
                            mode=page.locator('#loanProcessingMode') if kind=='loans' else form.locator('[name=processing_mode]')
                            mode.select_option(processing)
                            file_input.set_input_files({'name':'Test.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.4 synthetic'})
                            submit.click()
                            if processing=='foreground':
                                expect(page.locator('#phbImportWait')).to_be_visible()
                                assert page.locator('#phbImportWait').evaluate("e=>e.matches(':modal')")
                                page.keyboard.press('Escape');expect(page.locator('#phbImportWait')).to_be_visible()
                                page.wait_for_timeout(400);assert review_url not in page.url
                                if os.environ.get('PHB_BROWSER_SCREENSHOTS'):
                                    output=Path(os.environ['PHB_BROWSER_SCREENSHOTS']);output.mkdir(parents=True,exist_ok=True)
                                    page.screenshot(path=str(output/('upload-busy-'+kind+'.png')))
                                if kind=='offers':
                                    page.set_viewport_size({'width':360,'height':800});page.evaluate("PHBUI.setTheme('dark')")
                                    assert page.locator('#phbImportWait').evaluate('e=>e.getBoundingClientRect().width<=innerWidth-24')
                                    if os.environ.get('PHB_BROWSER_SCREENSHOTS'):page.screenshot(path=str(output/'upload-busy-mobile-dark.png'))
                                    page.set_viewport_size({'width':1440,'height':1000});page.evaluate("PHBUI.setTheme('system')")
                                queue['terminal']=True
                                expect(page).to_have_url(BASE+review_url,timeout=10000)
                                expect(page.locator('#'+review_dialog)).to_be_visible()
                                if kind=='loans':
                                    expect(form.locator('[name=name]')).to_have_value('Eigene Kreditbezeichnung')
                                    assert page.locator('#loanForm [name=principal]').evaluate('e=>PHBUI.currency.parse(e.value)')==50000
                            else:
                                if dialog_id:expect(page.locator('#'+dialog_id)).not_to_be_visible()
                                expect(page.locator('#phbImportWait')).not_to_be_visible()
                                before=page.url
                                expect(submit).to_be_disabled()
                                expect(page.locator('#phbImportCenter')).to_be_visible()
                                indicator=page.locator('#phbImportCenter').bounding_box()
                                assert indicator['x']+indicator['width']>1300,('queue must sit at bottom right',indicator)
                                queue['terminal']=True
                                expect(page.locator('#phbImportCount')).to_contain_text('fertig',timeout=10000)
                                expect(submit).to_be_enabled()
                                assert page.url==before,'Background work must not redirect automatically'
                                page.locator('#phbImportToggle').click()
                                page.locator('#phbImportFeed button',has_text='Prüfen und bearbeiten').first.click()
                                expect(page).to_have_url(BASE+review_url)
                                expect(page.locator('#'+review_dialog)).to_be_visible()
                            print('PASS:',kind,processing,'processing, global busy/release and review navigation')
                    queue.update(jobs=[],terminal=True,error=False,review_url=None)
                    page.goto(BASE+'/angebote');page.locator('#openOfferWorkflow').click();page.locator('#offerMethodManual').click()
                    manual=page.locator('#offerManualForm')
                    manual.locator('[name=vendor]').fill('Manuell mit Original-PDF')
                    manual.locator('[name=gross]').fill('1.234,56')
                    manual.locator('[name=file]').set_input_files({'name':'ManuellesAngebot.pdf','mimeType':'application/pdf','buffer':(root/'receipts/invoice.pdf').read_bytes()})
                    manual.locator('button[type=submit]').click();expect(page.locator('#offerManualStatus')).to_contain_text('Angebot gespeichert')
                    quote=next(o for o in page.request.get(BASE+'/api/offers').json()['offers'] if o['vendor']=='Manuell mit Original-PDF')
                    assert quote['gross']==1234.56 and quote['document_id'] and quote['status']=='Angebot'
                    page.locator('#closeOfferWorkflow').click();expect(page.locator('#offerWorkflowDialog')).not_to_be_visible()
                    card=page.locator('[data-offer-card="'+str(quote['id'])+'"]');card.locator('[data-offer-expand]').click()
                    expect(card.locator('a',has_text='Angebots-PDF öffnen')).to_be_visible()
                    assert page.request.get(BASE+'/api/documents/'+str(quote['document_id'])+'/download').status==200
                    print('PASS: manual offer PDF attachment, unchanged entered amount and downloadable original')
                    # Error releases the top-layer busy state and keeps the originating dialog retryable.
                    queue.update(jobs=[],terminal=False,error=False,kind='loans',review_url=None)
                    page.goto(BASE+'/finanzierung');page.locator('#newLoan').click();page.locator('#loanAiDetails').evaluate('e=>e.open=true')
                    page.locator('#loanAiFile').set_input_files({'name':'Fehler.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.4 test'})
                    page.locator('#loanAiAnalyze').click();expect(page.locator('#phbImportWait')).to_be_visible()
                    queue.update(terminal=True,error=True)
                    expect(page.locator('#phbImportWait')).not_to_be_visible(timeout=7000)
                    expect(page.locator('#loanAiStatus')).to_contain_text('Absichtlicher Testfehler')
                    expect(page.locator('#loanAiAnalyze')).to_be_enabled();expect(page.locator('#loanSaveButton')).to_be_enabled()
                    print('PASS: queued loan scan error releases all initiating controls')
                    queue.update(jobs=[],terminal=True,error=False,review_url=None)
                    page.goto(BASE+'/belege');page.locator('#list .entry',has_text='Browser-Testbetrieb').click()
                    page.locator('#markReceiptPaid').click();page.locator('.phb-messagebox button',has_text='Bestätigen').click()
                    expect(page.locator('#list .entry',has_text='Browser-Testbetrieb')).to_contain_text('Nicht zugewiesen')
                    rid=next(r['id'] for r in page.request.get(BASE+'/api/receipts').json()['receipts'] if r['supplier']=='Browser-Testbetrieb')
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
                    expect(page.locator('#list .entry',has_text='Browser-Testbetrieb')).to_contain_text('Storniert')
                    cancelled=page.request.get(BASE+'/api/receipts/'+str(rid)).json();assert cancelled['paid_amount']==0 and cancelled['cancellation']['reason']=='Durch neue Rechnung ersetzt'
                    assert page.request.get(BASE+'/api/receipts/'+str(rid)+'/download').status==200
                    page.locator('#closeReceiptWorkflow').click()
                    queue.update(jobs=[{'id':999,'kind':'documents','filename':'Plan.pdf','stage':'Wartet','analysis_mode':'local'}],terminal=False,error=False,review_url=None)
                    page.goto(BASE+'/');expect(page.locator('#scheduleChatFab')).to_be_visible()
                    assert page.locator('#scheduleChatFab').evaluate("e=>getComputedStyle(e).position")=='fixed'
                    box=page.locator('#scheduleChatFab').bounding_box();assert box['x']+box['width']>1390 and box['y']+box['height']>950
                    page.set_viewport_size({'width':360,'height':800})
                    expect(page.locator('#phbImportCenter')).to_be_visible()
                    floating=page.locator('#scheduleChatFab').bounding_box();feed=page.locator('#phbImportCenter').bounding_box()
                    assert not feed or floating['x']>=feed['x']+feed['width']+4 or floating['y']>=feed['y']+feed['height']+4,'Floating chat must not overlap the import widget'
                    page.locator('#scheduleChatFab').click();expect(page.locator('#aiScheduleChatPanel')).to_be_visible()
                    floating=page.locator('#scheduleChatFab').bounding_box();feed=page.locator('#phbImportCenter').bounding_box()
                    assert floating['x']>=feed['x']+feed['width']+4,'Open chat and queue must not overlap'
                    page.locator('#scheduleChatClose').click()
                    queue.update(jobs=[],terminal=True)
                    context.route('**/api/ai/status',lambda request:request.fulfill(json={'connected':False,'sharing':False,'credits_acknowledged':False}))
                    page.reload();expect(page.locator('#scheduleChatFab')).not_to_be_visible()
                    print('PASS: source-free payment, later assignment without double payment, retained invoice cancellation, connection-gated floating button')
                    page.set_viewport_size({'width':1440,'height':950})
                    draft=next(r for r in page.request.get(BASE+'/api/receipts').json()['receipts'] if r['status']=='Entwurf')
                    draft_id=draft['id']
                    page.goto(BASE+'/belege?receipt_id='+str(draft_id));expect(page.locator('#review')).to_be_visible()
                    page.locator('#review [name=notes]').fill('Erster unvollständiger Zwischenstand')
                    page.locator('#receiptAssignmentType').select_option('Betrieb')
                    page.locator('#saveReceiptDraftTop').click();expect(page.locator('#receiptSaveStatus')).to_contain_text('Entwurf gespeichert')
                    saved=page.request.get(BASE+'/api/receipts/'+str(draft_id)).json()
                    assert saved['notes']=='Erster unvollständiger Zwischenstand' and saved['gross_amount'] is None and saved['status']=='Entwurf'
                    page.reload();expect(page.locator('#review [name=notes]')).to_have_value('Erster unvollständiger Zwischenstand')
                    page.locator('#review [name=notes]').fill('Vor dem Firmenwechsel gesichert')
                    page.locator('#receiptCreateCompany').click();expect(page.locator('#companyDialog')).to_be_visible()
                    page.locator('#companyName').fill('Neu angelegter Rechnungsbetrieb')
                    page.locator('#saveCompany').click();expect(page.locator('#companyDialog')).not_to_be_visible()
                    page.locator('#receiptReturnLink').click();expect(page.locator('#review [name=notes]')).to_have_value('Vor dem Firmenwechsel gesichert')
                    company=next(c for c in page.request.get(BASE+'/api/costs').json()['contractors'] if c['name']=='Neu angelegter Rechnungsbetrieb')
                    page.locator('#receiptContractor').select_option(str(company['id']))
                    page.locator('#review [name=supplier]').fill(company['name']);page.locator('#review [name=document_date]').fill('2026-10-26')
                    page.locator('#receiptGross').fill('120')
                    expect(page.locator('#advanceDeductionWrap')).not_to_be_visible()
                    page.locator('#billingType').select_option('Schlussrechnung');expect(page.locator('#advanceDeductionWrap')).to_be_visible()
                    expect(page.locator('#billingTypeHint')).to_contain_text('doppelte Kosten')
                    page.locator('#billingType').select_option('Normal')
                    assert page.locator('#billingType').bounding_box()['y']<page.locator('#receiptGross').bounding_box()['y']
                    page.locator('#book').click();page.locator('.phb-messagebox button',has_text='Bestätigen').click()
                    expect(page.locator('#receiptSaveStatus')).to_contain_text('Rechnung gebucht')
                    booked=page.request.get(BASE+'/api/receipts/'+str(draft_id)).json();assert booked['status']=='Gebucht' and booked['due_date']==''
                    page.locator('#review [name=notes]').fill('Gebuchte Notiz ergänzt');page.locator('#saveReceiptDraftTop').click()
                    expect(page.locator('#receiptSaveStatus')).to_contain_text('Änderungen gespeichert')
                    for width in (360,768,1440):
                        page.set_viewport_size({'width':width,'height':950})
                        assert page.locator('#review').evaluate('e=>e.scrollWidth<=e.clientWidth+1'),('invoice form overflow',width)
                        if os.environ.get('PHB_BROWSER_SCREENSHOTS'):
                            output=Path(os.environ['PHB_BROWSER_SCREENSHOTS']);output.mkdir(parents=True,exist_ok=True)
                            page.screenshot(path=str(output/('invoice-review-'+str(width)+'.png')))
                    print('PASS: incomplete drafts survive reload/company creation, optional due date, billing guidance, booked notes and responsive invoice review')
                    quote=page.request.post(BASE+'/api/offers/manual',data={'vendor':'Löschbarer Betrieb','gross':150,'category':'Elektro'}).json()['id']
                    page.goto(BASE+'/angebote');page.locator('[data-offer-delete="'+str(quote)+'"]').click()
                    page.locator('.phb-messagebox button',has_text='Bestätigen').click();expect(page.locator('[data-offer-card="'+str(quote)+'"]')).to_have_count(0)
                    protected=page.request.post(BASE+'/api/offers/manual',data={'vendor':'Entschiedener Betrieb','gross':150,'category':'Elektro'}).json()['id']
                    for status in ('Abgelehnt','Angebot'):assert page.request.patch(BASE+'/api/offers/'+str(protected),data={'status':status}).status==200
                    page.reload();expect(page.locator('[data-offer-card="'+str(protected)+'"]')).to_be_visible()
                    expect(page.locator('[data-offer-delete="'+str(protected)+'"]')).to_have_count(0)
                    assert page.request.delete(BASE+'/api/offers/'+str(protected)).status==409
                    print('PASS: complete offer deletion is available only before decisions and invoice links')
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
