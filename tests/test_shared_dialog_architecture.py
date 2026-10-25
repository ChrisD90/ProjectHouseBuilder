"""Shared dialog design-system contracts across all app screens."""
import re
import unittest
from pathlib import Path

BASE=Path(__file__).resolve().parents[1]
PAGES=('index','angebote','belege','finanzierung','kosten','daten','dokumente','stammdaten')


class SharedDialogTests(unittest.TestCase):
    def test_managed_dialogs_across_all_pages(self):
        for page in PAGES:
            with self.subTest(page=page):
                html=(BASE/'templates'/f'{page}.html').read_text()
                self.assertIn('data-phb-dialog',html)
                self.assertIn('/static/workflow-dialogs.css',html)
                tags=re.findall(r'<dialog\b[^>]*>',html)
                for tag in tags:
                    if 'id="phbAIDialog"' in tag:
                        continue
                    self.assertIn('data-phb-dialog',tag)

    def test_dirty_forms_and_close_controls_explicit(self):
        html='\n'.join((BASE/'templates'/f'{p}.html').read_text() for p in PAGES)
        for id_ in ('loanForm','equityForm','editForm','offerEditForm',
                    'offerAcceptanceForm','docEditForm','companyForm','backupConfigForm'):
            with self.subTest(form=id_):
                self.assertRegex(html,r'<form\b[^>]*\bid="'+id_+r'"[^>]*data-phb-dirty')
        for id_ in ('closeLoan','closeEquity','closeDialog','cancelDialog',
                    'closeOfferEdit','cancelOfferEdit','docClose','closeCompany'):
            with self.subTest(button=id_):
                self.assertRegex(html,r'<button\b[^>]*\bid="'+id_+r'"[^>]*data-phb-close')

    def test_common_controller_tracks_pending_changes_and_busy_states(self):
        js=(BASE/'static/ui.js').read_text()
        self.assertIn("dialog.addEventListener('cancel'",js)
        self.assertIn("event.stopImmediatePropagation()",js)
        self.assertIn("form.elements",js)
        self.assertIn('MutationObserver',js)
        self.assertIn("phb-dialog-saved",js)
        self.assertIn("phb-dialog-busy",js)
        self.assertIn('dialogs.init()',js)
        self.assertIn('dialogs,',js)
        self.assertIn('Ungespeicherte Änderungen verwerfen?',js)

    def test_shared_styles_are_responsive_and_opt_in(self):
        css=(BASE/'static/workflow-dialogs.css').read_text()
        self.assertIn('dialog.phb-managed-dialog',css)
        self.assertIn('body.phb-app dialog.phb-managed-dialog',css)
        self.assertIn('@media(max-width:680px)',css)
        self.assertIn('aria-busy="true"',css)

    def test_saves_notify_controller_and_ai_cannot_close_mid_job(self):
        modules={
            'finanzierung.js':"PHBUI.dialogs.saved($('loanDialog'))",
            'costs.js':"PHBUI.dialogs.busy(el('editor'),true)",
            'offers.js':"PHBUI.dialogs.busy(editDialog,true)",
            'dokumente.js':"PHBUI.dialogs.saved($('docEditDialog'))",
            'stammdaten.js':"PHBUI.dialogs.saved($('companyDialog'))"
        }
        for module,marker in modules.items():
            with self.subTest(module=module):
                self.assertIn(marker,(BASE/'static'/module).read_text())


if __name__=='__main__':
    unittest.main()
