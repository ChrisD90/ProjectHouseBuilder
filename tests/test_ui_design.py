"""Shared visual system, theme and activity indicator smoke tests."""
import re
import unittest
from pathlib import Path
from jinja2 import Environment, FileSystemLoader

ROOT=Path(__file__).resolve().parents[1]
TEMPLATES=ROOT/'templates'
STATIC=ROOT/'static'
PAGES=('index','kosten','angebote','belege','finanzierung','stammdaten','dokumente','daten')


class GlobalUIDesignTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.env=Environment(loader=FileSystemLoader(TEMPLATES))

    def test_all_app_pages_load_one_common_theme_and_activity_script(self):
        for page in PAGES:
            with self.subTest(page=page):
                html=self.env.get_template(page+'.html').render()
                self.assertEqual(html.count('href="/static/ui.css"'),1)
                self.assertEqual(html.count('src="/static/ui.js"'),1)
                self.assertLess(html.index('/static/ui.js'),html.index('</head>'))
                self.assertEqual(html.count('id="phbThemeMode"'),1)
                self.assertEqual(html.count('id="phbLoadTrack"'),1)
                self.assertEqual(html.count('id="phbBusyOverlay"'),1)
                self.assertEqual(html.count('id="phbBusyStatus"'),1)
                self.assertIn('aria-live="polite"',html)
                self.assertIn('value="system"',html)
                self.assertIn('value="light"',html)
                self.assertIn('value="dark"',html)

    def test_no_external_ui_dependencies_or_duplicate_theme_bootstraps(self):
        script=(STATIC/'ui.js').read_text()
        css=(STATIC/'ui.css').read_text()
        self.assertIn("prefers-color-scheme: dark",script)
        self.assertIn("localStorage.setItem(key,next)",script)
        self.assertIn("data-phb-busy",script)
        self.assertIn("window.fetch=",script)
        self.assertIn(".finally(()=>end(id))",script)
        self.assertIn("await response.clone().text()",script)
        self.assertIn("url.origin!==location.origin",script)
        self.assertIn("'/api/'",script)
        self.assertIn("FormData",script)
        self.assertIn("ChatGPT",script)
        self.assertIn("Rechnung",script)
        self.assertNotIn("fetch('https://",script)
        self.assertNotIn('fetch("https://',script)
        for token in ('--ui-bg','--ui-surface','--ui-ink','--ui-line',
                      '--ui-gutter','data-phb-theme="dark"','phb-busy-spinner',
                      'prefers-reduced-motion','focus-visible'):
            self.assertIn(token,css)

    def test_saved_appearance_is_used_on_login_as_well(self):
        html=self.env.get_template('login.html').render()
        self.assertIn('href="/static/ui.css"',html)
        self.assertIn('src="/static/ui.js"',html)
        self.assertNotIn('phbSidebar',html)
        css=(STATIC/'ui.css').read_text()
        self.assertIn('body.login-screen .login-panel',css)

    def test_dark_mode_and_busy_assets_are_offline_cacheable(self):
        worker=(STATIC/'sw.js').read_text()
        self.assertIn("'/static/ui.css'",worker)
        self.assertIn("'/static/ui.js'",worker)
        self.assertIn('id="sun"',(STATIC/'icons'/'ui-icons.svg').read_text())
        self.assertIn("url.pathname.startsWith('/static/')",worker)
        self.assertNotIn("'/api/",worker)


if __name__=='__main__':
    unittest.main()
