"""Common interaction contract on all application pages."""
import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
TEMPLATES=ROOT/'templates'
STATIC=ROOT/'static'
PAGES=('index','angebote','belege','finanzierung','kosten','dokumente','daten','stammdaten')

class WorkflowArchitectureTests(unittest.TestCase):
    def test_every_business_page_loads_shared_framework_after_ui_js(self):
        for page in PAGES:
            with self.subTest(page=page):
                html=(TEMPLATES/(page+'.html')).read_text(encoding='utf-8')
                self.assertIn('src="/static/phb-workflow.js"',html)
                self.assertIn('href="/static/phb-workflow.css"',html)
                self.assertLess(html.index('src="/static/ui.js"'),
                                html.index('src="/static/phb-workflow.js"'))
                self.assertIn('aria-labelledby=',html)

    def test_module_adoption_covers_major_business_dialogs(self):
        source={
            'app.js':('taskListDialog','companyProposalsDialog'),
            'schedule_chat.js':('scheduleHistoryDialog',),
            'initial_schedule.js':('initialScheduleDialog',),
            'offers.js':('offerWorkflowDialog','offerEditDialog','offerAcceptanceDialog'),
            'receipts.js':('receiptWorkflowDialog',),
            'finanzierung.js':('loanDialog','equityDialog'),
            'costs.js':('costDetailsDialog',),
            'dokumente.js':('docUploadDialog','docEditDialog'),
            'stammdaten.js':('companyDialog',),
            'daten.js':('backupConfigDialog','backupRestoreDialog'),
            'chatgpt.js':('phbAIDialog',),
        }
        for name, dialogs in source.items():
            js=(STATIC/name).read_text(encoding='utf-8')
            self.assertIn('PHBFlow.manage(',js,name)
            for dialog in dialogs:
                with self.subTest(module=name,dialog=dialog):
                    self.assertIn("dialog:'"+dialog+"'",js)

    def test_steps_and_critical_workflows_share_same_state(self):
        offer=(STATIC/'offers.js').read_text(encoding='utf-8')
        receipt=(STATIC/'receipts.js').read_text(encoding='utf-8')
        finance=(STATIC/'finanzierung.js').read_text(encoding='utf-8')
        backup=(STATIC/'daten.js').read_text(encoding='utf-8')
        self.assertIn("steps:['Erfassen','Prüfen']",offer)
        self.assertIn("steps:['Erfassen','Prüfen & buchen','Bezahlen']",receipt)
        self.assertIn('receiptFlow.stage(2)',receipt)
        self.assertIn('receiptFlow.snapshot()',receipt)
        self.assertIn('loanFlow.snapshot()',finance)
        self.assertIn('createAfterConfiguration',backup)
        self.assertIn('if(createAfterConfiguration)await createBackup();',backup)

    def test_shared_framework_owns_dirty_busy_focus_and_stage(self):
        js=(STATIC/'phb-workflow.js').read_text(encoding='utf-8')
        for invariant in ('function signature(form)','function manage(config)',
                          'function cancel()','function setBusy(next)',
                          'function stage(index)','const snapshot=()','function run(callback',
                          "'beforeunload'",'aria-current', 'opener.focus'):
            self.assertIn(invariant,js)
        css=(STATIC/'phb-workflow.css').read_text(encoding='utf-8')
        for token in ('.phb-flow-dialog','.phb-flow-steps','.phb-flow-step',
                      '.phb-flow-busy','@media(max-width:650px)'):
            self.assertIn(token,css)

    def test_node_suite_is_part_of_ci(self):
        pipeline=(ROOT/'.github/workflows/tests.yml').read_text(encoding='utf-8')
        self.assertIn('node --check static/phb-workflow.js',pipeline)
        self.assertIn('node --test tests/workflow_runtime.test.cjs',pipeline)


if __name__=='__main__':
    unittest.main()
