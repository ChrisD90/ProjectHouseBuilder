"""OCR startup contracts: GUI paths, broken tools, and idempotent native installation."""
import contextlib
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import ocr_runtime
import receipt_parser

ROOT=Path(__file__).resolve().parents[1]


class OCRRuntimeTests(unittest.TestCase):
    def test_mac_gui_path_discovers_both_homebrew_locations(self):
        def which(name,path=None):
            return '/opt/homebrew/bin/'+name if path else None
        with patch('ocr_runtime.sys.platform','darwin'),patch('ocr_runtime.shutil.which',side_effect=which) as finder:
            self.assertEqual(ocr_runtime.find_ocr_tool('tesseract'),'/opt/homebrew/bin/tesseract')
        self.assertEqual(finder.call_args.kwargs['path'],'/opt/homebrew/bin:/usr/local/bin')

    def test_image_extraction_uses_discovered_executable(self):
        result=subprocess.CompletedProcess([],0,stdout='Rechnung mit mindestens 45 Zeichen und 123,45 EUR',stderr='')
        with patch('receipt_parser.find_ocr_tool',return_value='/opt/homebrew/bin/tesseract'),patch('receipt_parser.subprocess.run',return_value=result) as run:
            receipt_parser._ocr('/tmp/synthetic.png')
        self.assertEqual(run.call_args.args[0][0],'/opt/homebrew/bin/tesseract')
        self.assertIn('deu+eng',run.call_args.args[0])

    def test_renderer_found_but_not_executable_is_not_ready(self):
        def run(args,**kwargs):
            if '--list-langs' in args:
                return subprocess.CompletedProcess(args,0,stdout='deu\neng\n',stderr='')
            if '-v' in args:
                raise OSError('broken dynamic library')
            return subprocess.CompletedProcess(args,0,stdout='tesseract 5',stderr='')
        with patch('ocr_runtime.find_ocr_tool',side_effect=lambda name:'/bin/'+name),patch('ocr_runtime.subprocess.run',side_effect=run):
            state=ocr_runtime.ocr_diagnostics()
        self.assertFalse(state['ready'])
        self.assertFalse(state['tools']['pdftoppm'])

    def test_failed_language_command_cannot_claim_readiness(self):
        def run(args,**kwargs):
            return subprocess.CompletedProcess(args,1 if '--list-langs' in args else 0,stdout='deu\neng\n',stderr='')
        with patch('ocr_runtime.find_ocr_tool',return_value='/bin/tool'),patch('ocr_runtime.subprocess.run',side_effect=run):
            self.assertFalse(ocr_runtime.ocr_diagnostics()['ready'])

    def test_startup_fails_with_actionable_language_message(self):
        state={'ready':False,'tools':{'tesseract':True,'pdftoppm':True},'languages':['eng'],'reason':'Start wiederholen'}
        stderr=io.StringIO()
        with patch('ocr_runtime.ocr_diagnostics',return_value=state),patch.dict(os.environ,{'TESSDATA_PREFIX':'/wrong'}),contextlib.redirect_stderr(stderr):
            self.assertEqual(ocr_runtime.main(['--check']),1)
        self.assertIn('deu',stderr.getvalue())
        self.assertIn('TESSDATA_PREFIX',stderr.getvalue())


@unittest.skipIf(os.name=='nt','POSIX native launcher')
class NativeOCRBootstrapTests(unittest.TestCase):
    def bootstrap(self,ready=False,repair=True,platform='Darwin'):
        with tempfile.TemporaryDirectory(prefix='phb-ocr-bootstrap-') as tmp:
            root=Path(tmp);bin_dir=root/'bin';bin_dir.mkdir()
            def executable(name,body):
                path=bin_dir/name;path.write_text('#!/bin/sh\nset -eu\n'+body);path.chmod(0o755)
                return str(path)
            python=executable('test-python','echo "check $*" >> "$PHB_TEST_LOG"\n[ -f "$PHB_TEST_READY" ]\n')
            executable('uname','echo '+platform+'\n')
            executable('id','echo 0\n')
            executable('brew','echo "brew $*" >> "$PHB_TEST_LOG"\n'+('touch "$PHB_TEST_READY"\n' if repair else 'exit 0\n'))
            executable('apt-get','echo "apt $*" >> "$PHB_TEST_LOG"\n'+('touch "$PHB_TEST_READY"\n' if repair else 'exit 0\n'))
            marker=root/'ready';log=root/'calls'
            if ready:marker.touch()
            result=subprocess.run(['sh',str(ROOT/'scripts/ensure_ocr.sh')],cwd=tmp,env={**os.environ,'PATH':str(bin_dir)+os.pathsep+os.environ['PATH'],'PHB_PYTHON':python,'PHB_TEST_LOG':str(log),'PHB_TEST_READY':str(marker)},capture_output=True,text=True,timeout=15)
            return result,log.read_text()

    def test_ready_start_does_not_install_or_access_network(self):
        result,log=self.bootstrap(ready=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn('brew',log)
        self.assertNotIn('apt',log)

    def test_mac_installs_manifest_and_rechecks_before_start(self):
        result,log=self.bootstrap()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('brew bundle install --no-upgrade --file=Brewfile',log)
        self.assertTrue(log.endswith('check ocr_runtime.py --check\n'),log)

    def test_successful_package_command_is_not_enough_without_ready_ocr(self):
        result,log=self.bootstrap(repair=False)
        self.assertEqual(result.returncode,1,result.stderr)
        self.assertIn('brew bundle install',log)

    def test_linux_installs_both_languages_and_renderer(self):
        result,log=self.bootstrap(platform='Linux')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('apt install -y tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng poppler-utils',log)
