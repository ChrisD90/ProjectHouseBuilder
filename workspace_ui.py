"""Project-scoped explicit form drafts; no financial effects or automatic replay."""
from datetime import datetime,timezone
from hashlib import sha256
import json
from flask import jsonify,request

def register_workspace_ui(app,db,Setting):
    def key(name):return 'ui_draft:'+sha256(name.encode()).hexdigest()[:40]
    @app.route('/api/ui-drafts/<path:name>',methods=['GET','PUT','DELETE'])
    def ui_draft(name):
        if len(name)>240:return jsonify(error='Ungültiger Entwurfsname.'),400
        row=db.session.get(Setting,key(name))
        if request.method=='GET':return jsonify(draft=json.loads(row.value) if row else None)
        if request.method=='DELETE':
            if row:db.session.delete(row);db.session.commit()
            return jsonify(ok=True)
        body=request.get_json(silent=True)
        try:
            if not isinstance(body,dict) or 'value' not in body or not isinstance(body['value'],dict):raise ValueError('Ungültiger Entwurf.')
            value=json.dumps(dict(value=body['value'],saved_at=datetime.now(timezone.utc).isoformat()),ensure_ascii=False,allow_nan=False)
            if len(value)>200000:raise ValueError('Entwurf ist zu groß; Dateien werden separat gespeichert.')
            if row:row.value=value
            else:db.session.add(Setting(key=key(name),value=value))
            db.session.commit();return jsonify(ok=True)
        except (ValueError,TypeError) as exc:db.session.rollback();return jsonify(error=str(exc)),400

    @app.route('/api/project-onboarding',methods=['GET','PUT'])
    def project_onboarding():
        from uuid import uuid4
        name='project_onboarding_v1'
        db.session.expire_all()
        row=db.session.get(Setting,name)
        def result():
            raw=row.value if row else ''
            state=json.loads(raw) if raw else dict(status='not_started',step=0)
            return dict(status=state['status'],step=state['step'],token=sha256(raw.encode()).hexdigest())
        if request.method=='GET':return jsonify(result())
        data=request.get_json(silent=True)
        if not isinstance(data,dict) or set(data)-{'action','step','token'} or data.get('action') not in ('start','progress','finish','skip'):
            return jsonify(error='Ungültiger Tour-Schritt.'),400
        if data.get('token')!=result()['token']:
            return jsonify(error='Die Tour wurde in einem anderen Fenster geändert. Bitte den aktuellen Stand laden.'),409
        action=data['action'];step=data.get('step',0)
        if type(step) is not int or not 0<=step<=4:return jsonify(error='Ungültiger Tour-Schritt.'),400
        if action!='start' and result()['status']!='pending':return jsonify(error='Bitte die Tour erneut starten.'),409
        state=dict(status={'start':'pending','progress':'pending','finish':'completed','skip':'skipped'}[action],step=0 if action=='start' else step,revision=uuid4().hex)
        raw=json.dumps(state)
        if row:row.value=raw
        else:row=Setting(key=name,value=raw);db.session.add(row)
        db.session.commit();return jsonify(result())
