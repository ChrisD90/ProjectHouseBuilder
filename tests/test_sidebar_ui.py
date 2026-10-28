"""UI regression tests for the shared Bootstrap/sidebar layout.

These tests intentionally avoid touching the SQLite database and uploaded files.
"""
import re
import unittest
from pathlib import Path
from jinja2 import Environment, FileSystemLoader

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / 'templates'
STATIC = ROOT / 'static'


class SidebarUITest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.env = Environment(loader=FileSystemLoader(TEMPLATES))

    def render(self, page):
        return self.env.get_template(page + '.html').render()

    def test_every_app_page_has_one_shared_navigation_and_topbar(self):
        for name in ('index', 'kosten', 'angebote', 'belege', 'finanzierung', 'stammdaten', 'dokumente', 'daten'):
            with self.subTest(page=name):
                content = self.render(name)
                self.assertEqual(content.count('id="phbSidebar"'), 1)
                self.assertEqual(content.count('class="phb-topbar"'), 1)
                self.assertEqual(content.count('id="phbMain"'), 1)
                self.assertIn('aria-label="Hauptnavigation"', content)
                self.assertIn('id="phbMenu"', content)
                self.assertIn('id="phbSidebarScrim"', content)
                self.assertIn('/static/shell.js', content)
                self.assertIn('/static/shell.css', content)
                self.assertIn('/static/vendor-bootstrap-5.3.6.min.css', content)
                if name == 'angebote':
                    self.assertIn('/static/angebote.css', content)
                    self.assertIn('/static/offers.js', content)
                if name == 'daten':
                    self.assertIn('/static/daten.js', content)
                    self.assertIn('/static/daten.css', content)
                if name == 'stammdaten':
                    self.assertIn('/static/stammdaten.js', content)
                    self.assertIn('/static/stammdaten.css', content)
                self.assertIn('<form method="post" action="/logout"', content)
                self.assertEqual(content.count('aria-current="page"'), 1)
                self.assertNotIn('← Zum Gantt-Plan', content)

    def test_navigation_has_one_central_master_data_and_backup_destination(self):
        rendered = self.render('index')
        for target in ('/', '/kosten', '/angebote', '/belege',
                       '/finanzierung', '/stammdaten', '/dokumente', '/daten'):
            self.assertIn('href="' + target + '"', rendered)
        self.assertNotIn('/kosten#kontakte', rendered)
        self.assertNotIn('/finanzierung#sicherung', rendered)
        self.assertNotIn('id="phbExports"', rendered)
        master=self.render('stammdaten')
        for section in ('firmen', 'gewerke', 'kategorien'):
            self.assertIn('id="' + section + '"', master)
        costs=self.render('kosten')
        self.assertNotIn('id="kontakte"', costs)
        receipts=self.render('belege')
        self.assertNotIn('id="categoryCreate"', receipts)
        financing=self.render('finanzierung')
        self.assertNotIn('id="backupButton"', financing)
        data=self.render('daten')
        for anchor in ('sicherung','exporte'):
            self.assertIn('id="' + anchor + '"', data)
        for endpoint in ('/api/export.csv','/api/budget.csv','/api/costs.csv',
                         '/api/backup.json','/api/project-archive.zip'):
            self.assertIn('href="'+endpoint+'"', data)

    def test_existing_interactive_form_ids_are_unchanged(self):
        for page, identifiers in {
            'index': ('projectStart', 'saveStart', 'newTask', 'taskForm', 'gantt'),
            'kosten': ('budgetrows', 'costrows', 'editForm'),
            'angebote': ('offerImportForm', 'offerManualForm', 'offerDrafts', 'offerList', 'offerCategoryFilter'),
            'belege': ('upload', 'review'),
            'stammdaten': ('companyForm', 'tradeCreate', 'categoryCreate', 'companyRows'),
            'dokumente': ('projectDocumentUpload', 'docList', 'docEditForm', 'docFilterArea'),
            'finanzierung': ('loanForm', 'equityForm', 'eventForm'),
            'daten': ('backupNow', 'resetForm', 'resetButton', 'resetUnderstand', 'resetText')
        }.items():
            html = self.render(page)
            for identifier in identifiers:
                with self.subTest(page=page, id=identifier):
                    self.assertIn('id="' + identifier + '"', html)

    def test_schedule_chat_is_gated_and_history_collapsed_by_default(self):
        page=self.render('index')
        for marker in (
            'id="aiSchedulePanel" hidden',
            'id="aiScheduleChatPanel" hidden',
            'id="scheduleHistoryDialog"',
            'id="scheduleChatApprove"',
            'id="scheduleChatReject"',
            '/static/schedule_chat.js'
        ):
            self.assertIn(marker,page)
        js=(STATIC/'app.js').read_text()
        self.assertIn("project.tasks.length===0",js)
        self.assertIn("window.PHBAI?.connected()",js)
        assistant=(STATIC/'schedule_chat.js').read_text()
        self.assertIn("selection()",assistant)
        self.assertIn("confirm:approve",assistant)
        self.assertIn("openScheduleHistory",assistant)

    def test_floating_schedule_chat_toggle_closes_on_outside_click_and_escape(self):
        page=self.render('index')
        self.assertIn('id="scheduleChatFab"',page)
        self.assertIn('aria-controls="aiScheduleChatPanel"',page)
        self.assertIn('aria-expanded="false"',page)
        self.assertIn('aria-haspopup="dialog"',page)
        self.assertIn('id="aiScheduleChatPanel" hidden',page)
        self.assertIn('role="dialog" aria-modal="false"',page)
        self.assertIn('id="scheduleChatPreview" hidden',page)
        self.assertIn('id="scheduleHistoryDialog"',page)
        self.assertIn('href="/static/icons/ui-icons.svg#message-circle"',page)
        self.assertIn('id="message-circle"', (STATIC/'icons'/'ui-icons.svg').read_text())

        script=(STATIC/'schedule_chat.js').read_text()
        self.assertIn("fab.addEventListener('click'",script)
        self.assertIn("document.addEventListener('pointerdown'",script)
        self.assertIn("!panel.contains(event.target) && !fab.contains(event.target)",script)
        self.assertIn("event.key==='Escape'",script)
        self.assertIn("document.addEventListener('focusin'",script)
        self.assertIn("fab.setAttribute('aria-expanded',String(isOpen))",script)
        self.assertIn("fab.hidden=!canChat",script)
        self.assertIn("panel.hidden=!isOpen",script)
        self.assertIn("setPopoverOpen(false,true)",script)
        self.assertIn("pendingId",script)
        self.assertIn("scheduleChatApprove",script)

        css=(STATIC/'schedule_chat.css').read_text()
        self.assertIn(".schedule-chat-fab[aria-expanded=true]",css)
        self.assertIn(".schedule-chat-popover",css)
        self.assertIn("position:fixed",css)
        self.assertIn("calc(100vw - 24px)",css)
        self.assertIn("var(--ui-surface)",css)
        self.assertIn(".schedule-chat-fab",(STATIC/'ui.js').read_text())

    def test_chatgpt_planner_floats_outside_toolbar_only_when_connected(self):
        page=self.render('index')
        self.assertIn('id="scheduleChatFab"',page)
        self.assertIn('ChatGPT-Planung</span>',page)
        self.assertIn('id="scheduleChatClose"',page)
        self.assertIn('id="aiScheduleChatPanel" hidden',page)
        gantt_toolbar=page.index('id="openTaskList"')
        chat_button=page.index('id="scheduleChatFab"')
        self.assertLess(gantt_toolbar,chat_button)
        self.assertGreater(chat_button,page.index('<div class="ganttwrap"'))
        css=(STATIC/'schedule_chat.css').read_text()
        self.assertIn('.schedule-chat-fab[hidden]',css)
        self.assertIn('.schedule-chat-popover[hidden]',css)
        self.assertIn('body.phb-app.phb-page-zeitplan .schedule-chat-fab',css)
        self.assertIn('position:fixed;inset:auto 24px 24px auto',css)
        js=(STATIC/'schedule_chat.js').read_text()
        self.assertIn('panel.hidden=true;',js)
        self.assertIn('fab.hidden=true;',js)
        self.assertIn("scheduleChatClose').addEventListener('click'",js)
        self.assertNotIn("scheduleHistoryDetails').addEventListener",js)
        self.assertIn('historyFlow.open()',js)

    def test_ocr_diagnostics_distinguish_runtime_and_offer_recovery(self):
        page=self.render('daten')
        self.assertIn('id="checkOCR"',page)
        self.assertIn('id="ocrHelp"',page)
        self.assertIn('id="ocrSynologySteps"',page)
        self.assertIn('id="ocrMacSteps"',page)
        self.assertIn('build --no-cache app',page)
        self.assertIn('up -d --no-deps app',page)
        script=(STATIC/'daten.js').read_text()
        self.assertIn("info.environment==='container'",script)
        self.assertIn('info.image_marker',script)
        self.assertIn("get('ocrHelp').hidden=false",script)
        docker=(ROOT/'Dockerfile').read_text()
        self.assertIn('PHB_OCR_IMAGE=',docker)
        self.assertIn('tesseract-ocr-deu',docker)
        self.assertIn('poppler-utils',docker)
        self.assertIn('grep -qx deu',docker)

    def test_project_document_ui_and_gantt_context_are_separate(self):
        html=self.render('dokumente')
        for marker in ('id="projectDocumentUpload"','id="docFilterStatus"',
                       'id="docEditDialog"','/static/dokumente.js'):
            self.assertIn(marker,html)
        schedule=self.render('index')
        self.assertIn('id="scheduleChatDocuments"',schedule)
        script=(STATIC/'schedule_chat.js').read_text()
        self.assertIn('document_ids:[...selectedDocuments]',script)

    def test_upload_entry_points_use_consistent_modal_workflow(self):
        pages={
            'angebote':('offerWorkflowDialog','openOfferWorkflow','offerImportForm','offerDrafts','offerManualForm'),
            'belege':('receiptWorkflowDialog','openReceiptWorkflow','upload','review','book'),
            'dokumente':('docUploadDialog','openDocUpload','projectDocumentUpload',None,None),
        }
        for name,(dialog,trigger,upload,review,confirm) in pages.items():
            with self.subTest(page=name):
                html=self.render(name)
                self.assertIn('id="'+dialog+'"',html)
                self.assertIn('id="'+trigger+'"',html)
                self.assertIn('aria-labelledby=',html)
                self.assertIn('/static/workflow-dialogs.css',html)
                start=html.index('id="'+dialog+'"')
                close=html.index('</dialog>',start)
                dialog_html=html[start:close]
                self.assertIn('id="'+upload+'"',dialog_html)
                if review:self.assertIn('id="'+review+'"',dialog_html)
                if confirm:self.assertIn('id="'+confirm+'"',dialog_html)
                self.assertEqual(html.count('id="'+upload+'"'),1)
        offers=(STATIC/'offers.js').read_text()
        self.assertIn('openWorkflow(true)',offers)
        self.assertIn("'angebote-pruefen'",offers)
        self.assertNotIn("scrollIntoView({behavior:'smooth',block:'start'})",offers)
        receipt=(STATIC/'receipts.js').read_text()
        self.assertIn('openReceiptDialog(true)',receipt)
        self.assertIn("kind:'receipts'",receipt)
        self.assertIn('linkReceipt',receipt)
        self.assertIn("receiptDialog.classList.toggle('is-reviewing'",receipt)
        docs=(STATIC/'dokumente.js').read_text()
        self.assertIn('uploadDialog.close();',docs)
        self.assertIn("kind:'documents'",docs)
        self.assertIn('edit(documentId)',docs)

    def test_cost_attachment_management_is_in_costs_and_read_only_in_documents(self):
        costs=self.render('kosten')
        page=self.render('dokumente')
        self.assertIn('id="openCostUpload"',costs)
        self.assertIn('id="costDocumentDialog"',costs)
        self.assertIn('id="closeCostUpload"',costs)
        self.assertIn('id="uploadForm"',costs)
        self.assertIn('id="documents"',costs)
        self.assertIn('id="kosten-unterlagen"',costs)
        start=costs.index('id="costDocumentDialog"')
        end=costs.index('</dialog>',start)
        self.assertIn('name="contractor_id"',costs[start:end])
        self.assertIn('name="budget_line_id"',costs[start:end])
        self.assertNotIn('id="costDocumentDialog"',page)
        self.assertNotIn('id="uploadForm"',page)
        self.assertNotIn('id="documents"',page)
        self.assertNotIn('id="openCostUpload"',page)
        js=(STATIC/'dokumente.js').read_text()
        self.assertNotIn('costDocumentDialog',js)
        self.assertNotIn('data-delete-doc',js)
        self.assertNotIn("api('/api/documents/'+",js)
        cost_js=(STATIC/'costs.js').read_text()
        self.assertIn('attachmentFlow.open()',cost_js)
        self.assertIn('data-delete-cost-document',cost_js)
        self.assertIn("api('/api/document-library')",cost_js)

    def test_company_assignment_searchable_accordion_without_close_x(self):
        page=self.render('index')
        self.assertIn('id="companyProposalsDialog"',page)
        self.assertIn('id="companySearch"',page)
        self.assertIn('id="companySearchCount"',page)
        self.assertIn('id="companySelectionCount"',page)
        self.assertIn('id="companyProposalsCancel"',page)
        self.assertIn('id="companyProposalsApply"',page)
        self.assertNotIn('id="companyProposalsClose"',page)
        js=(STATIC/'app.js').read_text()
        self.assertIn('<details class="company-task-group"',js)
        self.assertIn('class="company-task-summary"',js)
        self.assertIn('data-company-group',js)
        self.assertIn('data-task-search',js)
        self.assertIn("companySearch').addEventListener('input',filterCompanies)",js)
        self.assertIn('function filterCompanyTasks(group)',js)
        self.assertIn('other.checked=false',js)
        self.assertIn('updateCompanySelectionCounts()',js)
        self.assertIn("companyProposalsCancel').onclick=",js)
        self.assertNotIn("companyProposalsClose').onclick",js)
        css=(STATIC/'style.css').read_text()
        self.assertIn('.company-task-group[hidden]',css)
        self.assertIn('.company-task-choice[hidden]',css)
        self.assertIn('.company-task-choices{',css)

    def test_document_css_overrides_page_defaults_and_group_headers(self):
        page=self.render('dokumente')
        self.assertLess(page.index('/static/ui.css'),
                        page.index('/static/dokumente.css'))
        self.assertLess(page.index('/static/workflow-dialogs.css'),
                        page.index('/static/dokumente.css'))
        css=(STATIC/'dokumente.css').read_text()
        self.assertIn('body.phb-app.phb-page-dokumente main.phb-main',css)
        self.assertIn('grid-template-columns:minmax(0,1fr) auto;',css)
        self.assertIn('.docs-item-actions',css)
        self.assertIn('.docs-linked-group-head',css)
        self.assertIn('max-width:1480px',css)
        self.assertIn('@media(max-width:780px)',css)
        self.assertIn('@media(max-width:500px)',css)
        js=(STATIC/'dokumente.js').read_text()
        self.assertIn("const header=document.createElement('div');",js)
        self.assertNotIn("const header=document.createElement('header');",js)

    def test_general_library_and_readonly_source_groups(self):
        page=self.render('dokumente')
        self.assertIn('id="allgemeine-projektdokumente"',page)
        self.assertIn('id="generalDocsTitle"',page)
        self.assertIn('id="docList"',page)
        self.assertIn('id="docEditDialog"',page)
        self.assertIn('id="fachunterlagen"',page)
        self.assertIn('id="linkedDocSearch"',page)
        self.assertIn('id="linkedDocType"',page)
        self.assertIn('id="linkedDocGroups"',page)
        self.assertIn('option value="Angebote"',page)
        self.assertIn('option value="Rechnungen &amp; Belege"',page)
        self.assertIn('option value="Finanzierung"',page)
        self.assertIn('option value="Weitere Projektunterlagen"',page)
        self.assertIn('nur ansehen und herunterladen',page.lower())
        js=(STATIC/'dokumente.js').read_text()
        self.assertIn('const LINKED_GROUPS=',js)
        self.assertIn("library.filter(doc=>Boolean(doc.project_document_id))",js)
        self.assertIn("library.filter(doc=>!doc.project_document_id)",js)
        self.assertIn("for(const doc of files)list.append(documentRow(doc,false))",js)
        self.assertIn("for(const doc of filtered)list.append(documentRow(doc,true))",js)
        self.assertIn("moduleLink.textContent=group.label",js)
        self.assertIn("button.onclick=()=>edit(doc.project_document_id)",js)

    def test_review_has_original_inline_and_quote_edit_uses_separate_modal(self):
        offers=self.render('angebote')
        receipts=self.render('belege')
        plan=self.render('index')
        self.assertIn('id="offerPdfFrame"',offers)
        self.assertIn('id="offerEditDialog"',offers)
        self.assertIn('id="offerEditPdfFrame"',offers)
        self.assertIn('id="receiptPdfFrame"',receipts)
        self.assertIn('id="receiptImagePreview"',receipts)
        self.assertIn('id="complete"',plan)
        self.assertNotIn('id="close" title="Schließen"',plan)
        javascript=(STATIC/'offers.js').read_text()
        self.assertIn('openOfferEdit(Number(id))',javascript)
        self.assertNotIn('box.innerHTML=\`<h4>Angaben korrigieren',javascript)
        worker=(STATIC/'sw.js').read_text()
        self.assertIn('event.respondWith(fetch(event.request)',worker)

    def test_global_import_progress_and_review_notifications_are_available_everywhere(self):
        for page in ('index','kosten','angebote','belege','finanzierung',
                     'dokumente','stammdaten','daten'):
            with self.subTest(page=page):
                html=self.render(page)
                self.assertEqual(html.count('id="phbImportCenter"'),1)
                self.assertEqual(html.count('id="phbImportToast"'),1)
                self.assertEqual(html.count('src="/static/import_jobs.js"'),1)
                topbar=html.index('class="phb-topbar-right"')
                self.assertLess(topbar,html.index('id="phbImportCenter"'))
                self.assertLess(html.index('id="phbThemeMode"'),html.index('id="phbChatGPTButton"'))
                self.assertLess(html.index('id="phbChatGPTButton"'),html.index('id="phbImportCenter"'))
                self.assertNotIn('Privater Betrieb',html)
        for page,element in (
            ('angebote','offerImportForm'),
            ('belege','upload'),
            ('dokumente','projectDocumentUpload')):
            html=self.render(page)
            self.assertIn('id="'+element+'"',html)
            self.assertRegex(html,r'<input[^>]*type="file"[^>]*multiple|<input[^>]*multiple[^>]*type="file"')
        script=(STATIC/'import_jobs.js').read_text()
        self.assertIn("kind:'receipts'",(STATIC/'receipts.js').read_text())
        self.assertIn("kind:'offers'",(STATIC/'offers.js').read_text())
        self.assertIn("kind:'documents'",(STATIC/'dokumente.js').read_text())
        self.assertIn('review_url',script)
        self.assertIn('/api/import-jobs',script)
        self.assertIn('Notification.permission',script)

    def test_upload_and_create_actions_sit_in_matching_page_headers(self):
        for page,button in (('angebote','openOfferWorkflow'),
                            ('belege','openReceiptWorkflow'),
                            ('dokumente','openDocUpload'),
                            ('kosten','openCostUpload'),
                            ('finanzierung','newLoan')):
            html=self.render(page)
            header=html.index('phb-action-header')
            button_index=html.index('id="'+button+'"')
            self.assertLess(header,button_index,page)
            self.assertLess(button_index,html.index('</section>',header)
                if page in ('belege','finanzierung') else
                html.index('</div>',html.index('phb-header-actions',header))+200)
            self.assertEqual(html.count('id="'+button+'"'),1)
        styles=(STATIC/'ui.css').read_text()
        self.assertIn('.phb-action-header .phb-header-actions',styles)
        self.assertIn('justify-content:flex-end',styles)

    def test_offer_tiles_are_compact_and_open_details_dialog_with_quick_actions(self):
        js=(STATIC/'offers.js').read_text()
        css=(STATIC/'angebote.css').read_text()
        page=self.render('angebote')
        for marker in ('offer-tile-open','data-offer-details','openOfferDetails',
                       'data-offer-accept','data-offer-edit','data-offer-reject',
                       'data-offer-delete','data-offer-invoices','openOfferInvoices',
                       'aria-haspopup="dialog"',"icon('pencil')","icon('receipt')","icon('trash')"):
            self.assertIn(marker,js)
        self.assertNotIn('Kostenübersicht ansehen',page)
        self.assertIn('id="openOfferDrafts"',page)
        self.assertIn('class="offer-drafts-icon"',page)
        self.assertLess(page.index('id="openOfferDrafts"'),page.index('id="openOfferWorkflow"'))
        self.assertIn("$('openOfferDrafts').hidden=draftCount===0",js)
        self.assertIn('Arbeitspaket zuordnen',js)
        self.assertNotIn('Firma zuordnen',js)
        self.assertNotIn('Auftrag fixiert',js)
        self.assertNotIn('Berücksichtigt',js)
        self.assertIn('id="offerDetailsDialog"',page)
        self.assertIn('id="offerDetailsContent"',page)
        self.assertIn('id="offerInvoicesDialog"',page)
        self.assertIn('id="offerInvoicesContent"',page)
        self.assertIn('#offerList .offer-tile',css)
        self.assertIn('grid-template-columns:repeat(3',css)
        self.assertIn('max-height:610px',css)
        self.assertIn('overflow-y:auto',css)
        self.assertIn('.offer-tile-corner-actions',css)
        self.assertIn('.offer-drafts-icon',css)
        self.assertIn('.offer-icon-badge',css)
        self.assertIn('.phb-offer-details-dialog',css)
        self.assertIn('.phb-offer-invoices-dialog',css)
        self.assertNotIn('offer-tile-details',js)

    def test_receipt_overview_has_client_side_search(self):
        page=self.render('belege')
        script=(STATIC/'receipts.js').read_text()
        styles=(STATIC/'receipts.css').read_text()
        self.assertIn('id="receiptSearch"',page)
        self.assertIn('id="receiptSearchResult"',page)
        self.assertIn('ui-icons.svg#search',page)
        self.assertIn('receiptMatchesSearch',script)
        self.assertIn('renderReceiptList',script)
        self.assertIn('Keine Belege entsprechen der Suche.',script)
        self.assertIn('.receipt-search',styles)
        self.assertIn('.receipt-search input{display:block;width:100%;height:42px',styles)
        self.assertIn('.entry .status{margin:0 0 8px 14px}',styles)

    def test_task_list_and_history_are_on_demand_and_do_not_take_page_space(self):
        page=self.render('index')
        self.assertIn('id="openTaskList"',page)
        self.assertIn('id="taskListDialog"',page)
        self.assertIn('id="openScheduleHistory"',page)
        self.assertIn('id="scheduleHistoryDialog"',page)
        self.assertNotIn('<section class="panel tablepanel">',page)
        js=(STATIC/'app.js').read_text()
        self.assertIn('taskListFlow.open()',js)
        history=(STATIC/'schedule_chat.js').read_text()
        self.assertIn('historyFlow.open()',history)

    def test_order_acceptance_dialog_and_separate_payment_steps(self):
        offers=self.render('angebote')
        receipts=self.render('belege')
        self.assertIn('id="offerAcceptanceDialog"',offers)
        self.assertIn('id="offerAcceptanceFile"',offers)
        self.assertIn('id="offerAcceptanceGross"',offers)
        css=(STATIC/'angebote.css').read_text()
        self.assertIn('.offer-acceptance-form{',css)
        self.assertIn('overflow-y:auto',css[css.index('.offer-acceptance-form{'):])
        script=(STATIC/'offers.js').read_text()
        self.assertIn("offerUrl(id)+'/accept'",script)
        self.assertIn('openOfferAcceptance(Number(id))',script)
        self.assertIn('id="receiptReviewLayout"',receipts)
        self.assertIn('id="receiptReviewStage"',receipts)
        self.assertIn('id="receiptPaymentsPanel"',receipts)
        self.assertIn('Rechnungsdaten prüfen',receipts)
        self.assertIn('<span>Zahlung</span>',receipts)
        rjs=(STATIC/'receipts.js').read_text()
        self.assertIn("delete result.paid_amount",rjs)
        self.assertIn("receiptReviewLayout').hidden=true",rjs)

    def test_finance_budget_and_invoice_payment_workflows_are_on_correct_pages(self):
        finance=self.render('finanzierung')
        costs=self.render('kosten')
        receipts=self.render('belege')
        self.assertIn('id="newLoan"',finance)
        self.assertIn('id="newEquity"',finance)
        self.assertNotIn('id="paymentForm"',finance)
        self.assertNotIn('Liquiditätsvorschau',finance)
        self.assertNotIn('id="editBudget"',costs)
        self.assertIn('Kreditrahmen + Eigenkapital',costs)
        self.assertIn('id="payReceipt"',receipts)
        self.assertIn('id="receiptPaymentForm"',receipts)
        self.assertIn('id="receiptPaymentSource"',receipts)
        self.assertIn('id="receiptPaymentHistory"',receipts)
        self.assertIn('id="closeReceiptPayment"',receipts)
        self.assertIn('Zurück zu Schritt 2: Prüfen',receipts)
        self.assertNotIn('id="receiptUploadAgain"',receipts)
        self.assertNotIn('id="saveReceiptDraftTop"',receipts)
        self.assertEqual(receipts.count('id="saveReceiptDraft"'),1)
        review_actions=receipts.index('<div class="actions">',receipts.index('id="receiptCancellationInfo"'))
        self.assertLess(receipts.index('class="push"',review_actions),receipts.index('id="saveReceiptDraft"',review_actions))
        receipt_js=(STATIC/'receipts.js').read_text()
        self.assertIn("'/api/financing/payments'",receipt_js)
        self.assertIn('showReceiptPayments()',receipt_js)
        self.assertIn("submitReceiptPayment",receipt_js)
        self.assertIn("select.innerHTML=accounts.map",receipt_js)
        self.assertNotIn("const usable=accounts.filter",receipt_js)
        self.assertIn("Der Kredit ist auswählbar",receipt_js)
        finance_js=(STATIC/'finanzierung.js').read_text()
        self.assertNotIn("paymentForm",finance_js)
        self.assertIn("'Projektbudget',s.project_budget",finance_js)
        import_js=(STATIC/'import_jobs.js').read_text()
        self.assertIn("'phbImportDismissAll'",import_js)
        self.assertIn("'/api/import-jobs/'+id+'/dismiss'",import_js)

    def test_optional_credit_and_version_uploads_stay_collapsed(self):
        financing=self.render('finanzierung')
        for name in ('loanAiDetails','loanDocUploadDetails'):
            self.assertIn('id="'+name+'"',financing)
        self.assertIn('id="loanAiFile"',financing)
        self.assertIn('id="loanDocumentUpload"',financing)
        offers=(STATIC/'offers.js').read_text()
        self.assertIn('offer-version-upload-details',offers)
        self.assertIn('data-version-upload',offers)
        self.assertIn('openWorkflow(true)',offers)
        css=(STATIC/'workflow-dialogs.css').read_text()
        self.assertIn('var(--ui-surface)',css)
        self.assertIn('max-height',css)
        self.assertIn(':not([open])',css)
        sw=(STATIC/'sw.js').read_text()
        self.assertIn("'/static/workflow-dialogs.css'",sw)

    def test_invoice_labor_is_separately_editable_and_visible(self):
        page=self.render('belege')
        self.assertIn('id="receiptLabor"',page)
        self.assertIn('name="labor_amount"',page)
        self.assertIn('id="receiptLaborSource"',page)
        self.assertIn('id="receiptLaborHint"',page)
        self.assertIn('Arbeits- / Lohnkostenanteil brutto',page)
        js=(STATIC/'receipts.js').read_text()
        self.assertIn("updateLaborHint(x.labor_source,x.labor_amount)",js)
        self.assertIn("x.labor_amount!==null",js)
        self.assertIn("Manuell eingetragen",js)

    def test_login_does_not_show_application_sidebar(self):
        self.assertNotIn('phbSidebar', self.render('login'))

    def test_pwa_cache_includes_offline_shell_and_never_api_or_html(self):
        worker = (STATIC / 'sw.js').read_text()
        for static_path in ('/static/shell.css', '/static/shell.js',
                            '/static/vendor-bootstrap-5.3.6.min.css', '/static/daten.js', '/static/daten.css', '/static/angebote.css', '/static/offers.js',
                            '/static/icons/ui-icons.svg', '/static/stammdaten.js', '/static/stammdaten.css', '/static/schedule_chat.js'):
            self.assertIn(static_path, worker)
        self.assertNotIn("'/api/", worker)
        self.assertIn("url.pathname.startsWith('/static/')", worker)

    def test_bundle_contains_license_and_no_remote_dependencies(self):
        css = (STATIC / 'vendor-bootstrap-5.3.6.min.css').read_text()
        self.assertIn('Bootstrap  v5.3.6', css)
        self.assertIn('MIT', (STATIC / 'vendor-bootstrap-LICENSE.txt').read_text())
        shell = (STATIC / 'shell.js').read_text()
        self.assertNotIn('fetch(', shell)
        self.assertIn("'Escape'", shell)
        self.assertIn('phb-nav-open', shell)
        self.assertIn('aria-current', shell)
        for name in ('index', 'kosten', 'angebote', 'belege', 'finanzierung', 'stammdaten', 'daten'):
            html = self.render(name)
            # Navigational links to an official account settings page are fine.
            # Only remote static dependencies (CDNs, scripts, CSS, images) are banned.
            self.assertNotRegex(html, r'<script[^>]*src="https?://')
            self.assertNotRegex(html, r'<link[^>]*href="https?://')
            self.assertNotRegex(html, r'<img[^>]*src="https?://')


if __name__ == '__main__':
    unittest.main()
