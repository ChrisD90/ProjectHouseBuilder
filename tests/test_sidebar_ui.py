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
            'finanzierung': ('loanForm', 'paymentForm', 'eventForm'),
            'daten': ('backupNow', 'resetForm', 'resetButton', 'resetUnderstand', 'resetText')
        }.items():
            html = self.render(page)
            for identifier in identifiers:
                with self.subTest(page=page, id=identifier):
                    self.assertIn('id="' + identifier + '"', html)

    def test_schedule_chat_is_gated_and_history_collapsed_by_default(self):
        page=self.render('index')
        for marker in (
            'id="templatePanel" aria-labelledby="templateTitle" hidden',
            'id="aiSchedulePanel" hidden',
            'id="aiScheduleChatPanel" hidden',
            'id="scheduleHistoryDetails"',
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
        self.assertIn("scheduleHistoryDetails",assistant)

    def test_floating_schedule_chat_toggle_closes_on_outside_click_and_escape(self):
        page=self.render('index')
        self.assertIn('id="scheduleChatFab"',page)
        self.assertIn('aria-controls="aiScheduleChatPanel"',page)
        self.assertIn('aria-expanded="false"',page)
        self.assertIn('aria-haspopup="dialog"',page)
        self.assertIn('id="aiScheduleChatPanel" hidden',page)
        self.assertIn('role="dialog" aria-modal="false"',page)
        self.assertIn('id="scheduleChatPreview" hidden',page)
        self.assertIn('id="scheduleHistoryDetails"',page)
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

        css=(STATIC/'ui.css').read_text()
        self.assertIn(".schedule-chat-fab[aria-expanded=\"true\"]",css)
        self.assertIn(".schedule-chat-popover",css)
        self.assertIn("position:fixed",css)
        self.assertIn("calc(100vw - 24px)",css)
        self.assertIn("var(--ui-surface)",css)
        self.assertIn(":not(.schedule-chat-fab)",css)

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
        self.assertIn('await reload(data.id)',receipt)
        self.assertIn("receiptDialog.classList.toggle('is-reviewing'",receipt)
        docs=(STATIC/'dokumente.js').read_text()
        self.assertIn('uploadDialog.close();',docs)
        self.assertIn('edit(result.document.id)',docs)

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
