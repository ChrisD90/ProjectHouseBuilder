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
