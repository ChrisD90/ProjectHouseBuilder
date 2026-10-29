"""Cross-page dialog and workflow invariants; no database or NAS required."""
import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
TEMPLATES=ROOT/'templates'
STATIC=ROOT/'static'
PAGES=('index','angebote','belege','finanzierung','kosten','daten','dokumente','stammdaten')


class DialogAuditTests(unittest.TestCase):
    def test_every_named_dialog_has_a_resolvable_accessible_title(self):
        for page in PAGES:
            html=(TEMPLATES/(page+'.html')).read_text(encoding='utf-8')
            dialogs=list(re.finditer(r'<dialog\b[^>]*>',html))
            self.assertTrue(dialogs,page)
            ids=set(re.findall(r'\bid="([^"]+)"',html))
            for dialog in dialogs:
                tag=dialog.group()
                with self.subTest(page=page,dialog=tag):
                    self.assertRegex(tag,r'\bid="[^"]+"')
                    match=re.search(r'\baria-labelledby="([^"]+)"',tag)
                    self.assertIsNotNone(match,tag)
                    self.assertIn(match.group(1),ids)

    def test_hidden_attribute_always_wins_over_css_display_rules(self):
        css=(STATIC/'ui.css').read_text(encoding='utf-8')
        self.assertIn('body.phb-app [hidden]{display:none!important}',css)
        page=(TEMPLATES/'index.html').read_text(encoding='utf-8')
        self.assertIn('id="scheduleChatFab"',page)
        self.assertIn('id="aiScheduleChatPanel" hidden',page)

    def test_loan_ai_busy_flag_guards_all_close_paths_and_saving(self):
        js=(STATIC/'finanzierung.js').read_text(encoding='utf-8')
        self.assertIn('loanAiBusy=true;',js)
        self.assertIn('loanAiBusy=false;',js)
        self.assertIn("loanDialog').addEventListener('cancel'",js)
        self.assertIn("if(loanAiBusy)return;",js)
        self.assertIn("closeLoan').disabled=true",js)
        self.assertIn("loanSaveButton').disabled=true",js)

    def test_cancelled_receipt_booking_does_not_mutate_record(self):
        js=(STATIC/'receipts.js').read_text(encoding='utf-8')
        start=js.index("$('book').onclick=async()=>{")
        end=js.index("$('unbook').onclick",start)
        booking=js[start:end]
        self.assertLess(booking.index('await PHBUI.confirm('),booking.index("method:'PATCH'"))
        self.assertIn('receiptBusy',booking)
        self.assertIn('receiptBusy=true;',js)
        self.assertIn("receiptDialog.addEventListener('cancel'",js)
        self.assertIn("if(uploading||receiptBusy)event.preventDefault()",js)

    def test_cost_dashboard_has_no_save_and_quote_dialog_cannot_close_mid_save(self):
        cost=(STATIC/'costs.js').read_text(encoding='utf-8')
        quote=(STATIC/'offers.js').read_text(encoding='utf-8')
        self.assertNotIn("method:'POST'",cost)
        self.assertNotIn("method:'PUT'",cost)
        self.assertIn("dialog:'costDetailsDialog'",cost)
        self.assertIn('offerEditBusy=true',quote)
        self.assertIn("editDialog.addEventListener('cancel'",quote)


if __name__=='__main__':
    unittest.main()
