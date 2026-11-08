"""Isolated browser/visual CI runner. Each script gets fresh DB, files and backups."""
import os,re,subprocess,sys,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SERVER=r'''
import sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import app as b
import backup_manager
root=Path(sys.argv[2]);backups=root.parent/'backups';backups.mkdir(exist_ok=True)
backup_manager.ROOT=root;backup_manager.CONFIG_PATH=root/'backup-config.json'
backup_manager.configure(str(backups))
if __import__('os').environ.get('PHB_UI_FIXTURE')=='self-work':
 from dev.self_work_fixture import install
 install(b)
with b.app.app_context():b.initialize()
from werkzeug.serving import make_server
server=make_server('127.0.0.1',0,b.app,threaded=True)
print('PHB_TEST_PORT='+str(server.server_port),flush=True)
server.serve_forever()
'''

def run(script):
    with tempfile.TemporaryDirectory(prefix='phb-ui-ci-') as folder:
        work=Path(folder);root=work/'app';root.mkdir()
        (root/'static').symlink_to(ROOT/'static',target_is_directory=True)
        source=work/'server.py';source.write_text(SERVER)
        env={**os.environ,'DATABASE_URL':'sqlite:///'+str(work/'test.db'),'PHB_APP_ROOT':str(root),'PHB_CHATGPT_HOME':str(work/'auth'),'APP_PASSWORD':''}
        env.pop('PHB_UI_FIXTURE',None)
        if script=='tests/browser_self_work.cjs':env['PHB_UI_FIXTURE']='self-work'
        if not env.get('CHROMIUM_PATH'):
            import shutil
            env['CHROMIUM_PATH']=shutil.which('chromium') or subprocess.check_output(['node','-e',"console.log(require('./frontend/node_modules/playwright').chromium.executablePath())"],cwd=ROOT,text=True).strip()
        with (work/'server.log').open('w') as output:
            process=subprocess.Popen([sys.executable,str(source),str(ROOT),str(root)],cwd=ROOT,env=env,stdout=output,stderr=subprocess.STDOUT)
            try:
                for _ in range(100):
                    if process.poll() is not None:raise RuntimeError((work/'server.log').read_text()[-5000:])
                    found=re.search(r'PHB_TEST_PORT=(\d+)',(work/'server.log').read_text())
                    if found:break
                    time.sleep(.1)
                else:raise RuntimeError('Testserver nicht erreichbar.')
                env['PHB_TEST_URL']='http://127.0.0.1:'+found.group(1)
                if script=='visual':
                    command=[str(ROOT/'frontend/node_modules/.bin/playwright'),'test','--config',str(ROOT/'frontend/playwright.config.cjs')]
                    if os.environ.get('UPDATE_SCREENSHOTS')=='1':command+=['--update-snapshots=all']
                else:command=['node',str(ROOT/script)]
                subprocess.run(command,cwd=ROOT,env=env,check=True,timeout=240)
            except Exception:
                print((work/'server.log').read_text()[-7000:],file=sys.stderr);raise
            finally:process.terminate();process.wait(timeout=10)

if __name__=='__main__':
    scripts=sys.argv[1:] or ['tests/browser_react_ui.cjs','tests/browser_multi_projects.cjs','tests/browser_project_lifecycle.cjs','tests/browser_receipt_phase_ui.cjs','tests/browser_receipt_template_upgrade.cjs','tests/browser_till_receipts.cjs','tests/browser_project_start.cjs','tests/browser_project_backups.cjs','tests/browser_request_safety.cjs','tests/browser_self_work.cjs','tests/browser_self_work_upload.cjs','tests/browser_legacy_costs.cjs','visual']
    if not sys.argv[1:]:scripts.insert(scripts.index('tests/browser_till_receipts.cjs')+1,'tests/browser_financing_receipts.cjs')
    if not sys.argv[1:]:scripts.insert(scripts.index('tests/browser_financing_receipts.cjs')+1,'tests/browser_unassigned_financing.cjs')
    if not sys.argv[1:]:scripts.insert(scripts.index('tests/browser_self_work_upload.cjs')+1,'tests/browser_list_sorting.cjs')
    if not sys.argv[1:]:scripts.insert(scripts.index('tests/browser_list_sorting.cjs')+1,'tests/browser_offer_panels.cjs')
    if not sys.argv[1:]:scripts.insert(scripts.index('tests/browser_offer_panels.cjs')+1,'tests/browser_offer_editor.cjs','tests/browser_offer_extensions.cjs')
    if not sys.argv[1:]:scripts.insert(scripts.index('tests/browser_react_ui.cjs')+1,'tests/browser_sidebar_header.cjs')
    if not sys.argv[1:]:scripts.insert(scripts.index('tests/browser_receipt_phase_ui.cjs')+1,'tests/browser_dialog_navigation.cjs')
    for script in scripts:run(script)
