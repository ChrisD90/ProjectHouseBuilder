"""Run the funding-planner browser smoke against a fresh DB and simulated AI only."""
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

ROOT=Path(__file__).resolve().parents[1]
SERVER=r'''
import sys,json
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import app as b
from flask import request,jsonify
from funding_estimates import BAFA_URL,KFW_URL
root=Path(sys.argv[2])
for key,directory in [('DOCUMENT_ROOT','documents'),('PROJECT_DOCUMENT_ROOT','project-documents'),('RECEIPT_ROOT','receipts'),('IMPORT_QUEUE_ROOT','import-queue')]:
 path=root/directory;path.mkdir(exist_ok=True);setattr(b,key,path)
connection={'sharing':True}
b.chatgpt.status=lambda:{'sharing':connection['sharing'],'connected':connection['sharing'],'credits_acknowledged':True,'email':'fixture@example.test'}
def run(prompt,instruction,model='',web_search=False):
 data=json.loads(prompt);orientation=data['phase']=='orientation';program=data['plan']['inputs'].get('program_key') or 'bafa_envelope'
 return json.dumps(dict(eligible=None if orientation else True,program_key=program,programs=[{'key':program,'reason':'Simulierte Programmzuordnung anhand offizieller Quellen.'}],amount_min=None if orientation else 1000,amount_max=None if orientation else 2000,explanation='Simulierter, unverbindlicher Förderbericht im isolierten Test.',questions=['Bauantragsdatum und Antragstermin ergänzen.'] if orientation else [],missing=['Objektdaten ergänzen.'] if orientation else [],assumptions=['Technische Eignung fachlich bestätigen.'],sources=[{'title':'Offizielle Programmquelle','url':KFW_URL if program=='kfw_458' else BAFA_URL}]))
b.chatgpt.run=run
@b.app.post('/__fixture/connection')
def connection_fixture():
 connection['sharing']=request.get_json()['sharing'];return jsonify(ok=True)
with b.app.app_context():
 b.initialize()
 for index,gross in enumerate((10000,5000),1):
  offer=b.Offer(vendor='Plan-Angebot '+str(index),digest='plan-fixture-'+str(index),filename='Manuell',gross=gross,net=gross/1.19,vat=gross-gross/1.19,status='Angebot',category='Sonstiges')
  b.db.session.add(offer);b.db.session.flush()
  for number in (1,2):b.db.session.add(b.OfferPosition(offer_id=offer.id,number=str(number),section='',description='Fensterposition '+str(index)+'-'+str(number),net_amount=gross/2/1.19,optional=False))
 b.db.session.commit()
from werkzeug.serving import make_server
server=make_server('127.0.0.1',0,b.app,threaded=True)
print('PHB_TEST_PORT='+str(server.server_port),flush=True)
server.serve_forever()
'''

def main():
    with tempfile.TemporaryDirectory(prefix='phb-plan-browser-') as folder:
        root=Path(folder);source=root/'server.py';source.write_text(SERVER)
        environment={**os.environ,'DATABASE_URL':'sqlite:///'+str(root/'test.db'),'PHB_CHATGPT_HOME':str(root/'auth'),'APP_PASSWORD':''}
        with (root/'server.log').open('w') as output:
            process=subprocess.Popen([sys.executable,str(source),str(ROOT),str(root)],cwd=ROOT,env=environment,stdout=output,stderr=subprocess.STDOUT)
            try:
                for _ in range(100):
                    if process.poll() is not None:raise RuntimeError((root/'server.log').read_text())
                    found=re.search(r'PHB_TEST_PORT=(\d+)',(root/'server.log').read_text())
                    if found:break
                    time.sleep(.1)
                else:raise RuntimeError('Testserver nicht erreichbar.')
                environment['PHB_TEST_URL']='http://127.0.0.1:'+found.group(1)
                subprocess.run(['node',str(ROOT/'tests/browser_funding_plans.cjs')],cwd=ROOT,env=environment,check=True,timeout=180)
            except Exception:
                print((root/'server.log').read_text()[-5000:],file=sys.stderr);raise
            finally:process.terminate();process.wait(timeout=10)

if __name__=='__main__':main()
