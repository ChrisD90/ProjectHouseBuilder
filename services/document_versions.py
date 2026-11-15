"""Immutable document files, explicit version review, stable document ownership."""
import json
from datetime import datetime
from uuid import uuid4
from pypdf.errors import PdfReadError

def register(r):
    fields=('title','original_name','extension','digest','size_bytes','category','area','status','tags','description','extracted_text','extraction_note','uploaded_at')
    def snapshot(doc):
        result={key:getattr(doc,key) for key in fields}
        result['uploaded_at']=doc.uploaded_at.isoformat() if doc.uploaded_at else ''
        return result
    def versions(did):
        return r.db.session.scalars(r.select(r.ProjectDocumentVersion).where(r.ProjectDocumentVersion.document_id==did).order_by(r.ProjectDocumentVersion.version.desc())).all()
    def view(doc,number,data,state):
        base=f'/api/project-documents/{doc.id}'
        path=base+f'/versions/{number}'
        return dict(version=number,state=state,filename=data.get('original_name',''),title=data.get('title',''),
                    category=data.get('category',''),area=data.get('area',''),description=data.get('description',''),
                    uploaded_at=data.get('uploaded_at',''),download_url=path+'/download',
                    view_url=path+'/preview' if data.get('extension') in ('.pdf','.jpg','.jpeg','.png','.webp','.txt') else None)
    @r.app.get('/api/project-documents/<int:did>/versions')
    def document_versions(did):
        doc=r.db.session.get(r.ProjectDocument,did)
        if not doc:return r.jsonify(error='Dokument nicht gefunden.'),404
        rows=[view(doc,doc.current_version,snapshot(doc),'current')]
        rows.extend(view(doc,v.version,json.loads(v.snapshot_json),v.state) for v in versions(did))
        return r.jsonify(document=r._document_json(doc),versions=sorted(rows,key=lambda v:v['version'],reverse=True))
    @r.app.post('/api/project-documents/<int:did>/versions')
    def project_document_version_upload(did):
        doc=r.db.session.get(r.ProjectDocument,did)
        if not doc:return r.jsonify(error='Dokument nicht gefunden.'),404
        upload=r.request.files.get('file')
        if not upload or not upload.filename:return r.jsonify(error='Bitte eine neue Datei auswählen.'),400
        target=None
        try:
            raw=upload.read();name,ext,text,note=r.inspect_upload(upload.filename,raw)
            doc=r.db.session.scalar(r.select(r.ProjectDocument).where(r.ProjectDocument.id==did).with_for_update().execution_options(populate_existing=True))
            if doc is None:raise ValueError('Dokument nicht mehr vorhanden.')
            rows=versions(did)
            if any(v.state=='draft' for v in rows):raise ValueError('Bitte zuerst den offenen Versionsentwurf übernehmen oder verwerfen.')
            digest=r.sha256(raw).hexdigest()
            if digest==doc.digest or any(json.loads(v.snapshot_json).get('digest')==digest for v in rows):
                raise ValueError('Diese Datei gehört bereits zur Versionshistorie dieses Dokuments.')
            number=max([doc.current_version]+[v.version for v in rows])+1
            stored=uuid4().hex+ext;r.PROJECT_DOCUMENT_ROOT.mkdir(parents=True,exist_ok=True)
            target=r.PROJECT_DOCUMENT_ROOT/stored
            with target.open('xb') as output:output.write(raw)
            data=snapshot(doc);data.update(original_name=name,extension=ext,digest=digest,size_bytes=len(raw),
                extracted_text=text,extraction_note=note,uploaded_at=datetime.utcnow().isoformat(),base_version=doc.current_version)
            version=r.ProjectDocumentVersion(document_id=did,version=number,state='draft',stored_name=stored,snapshot_json=json.dumps(data,ensure_ascii=False))
            r.db.session.add(version);r.db.session.commit()
            return r.jsonify(document=r._document_json(doc),version=view(doc,number,data,'draft')),201
        except (ValueError,OSError,PdfReadError) as error:
            r.db.session.rollback()
            if target:target.unlink(missing_ok=True)
            return r.jsonify(error=str(error)),400
        except Exception:
            r.db.session.rollback()
            if target:target.unlink(missing_ok=True)
            r.app.logger.exception('Dokumentversion konnte nicht gespeichert werden')
            return r.jsonify(error='Die neue Version konnte nicht gespeichert werden.'),500
    r.project_document_version_upload=project_document_version_upload
    def find(did,number):
        doc=r.db.session.get(r.ProjectDocument,did)
        version=r.db.session.scalar(r.select(r.ProjectDocumentVersion).where(r.ProjectDocumentVersion.document_id==did,r.ProjectDocumentVersion.version==number)) if doc else None
        return doc,version
    @r.app.post('/api/project-documents/<int:did>/versions/<int:number>/activate')
    def activate_document_version(did,number):
        doc,version=find(did,number)
        if not doc or not version:return r.jsonify(error='Version nicht gefunden.'),404
        if version.state!='draft':return r.jsonify(error='Nur ein Versionsentwurf kann übernommen werden.'),409
        data=json.loads(version.snapshot_json)
        if data.get('base_version')!=doc.current_version:return r.jsonify(error='Die aktuelle Fassung hat sich geändert. Bitte den Versionsentwurf neu erstellen.'),409
        try:
            old=r.ProjectDocumentVersion(document_id=did,version=doc.current_version,state='historical',stored_name=doc.stored_name,snapshot_json=json.dumps(snapshot(doc),ensure_ascii=False))
            r.db.session.add(old)
            # Preserve live metadata and all referencing IDs; replace only the reviewed file.
            for key in ('original_name','extension','digest','size_bytes','extracted_text','extraction_note'):setattr(doc,key,data[key])
            doc.stored_name=version.stored_name;doc.uploaded_at=datetime.fromisoformat(data['uploaded_at']);doc.current_version=number;doc.status='Aktuell'
            r.db.session.delete(version);r._mark_import_reviewed('documents',did)
            r.db.session.commit();return r.jsonify(document=r._document_json(doc))
        except Exception:
            r.db.session.rollback();raise
    @r.app.post('/api/project-documents/<int:did>/versions/<int:number>/discard')
    def discard_document_version(did,number):
        doc,version=find(did,number)
        if not doc or not version:return r.jsonify(error='Version nicht gefunden.'),404
        if version.state!='draft':return r.jsonify(error='Nur ein Versionsentwurf kann verworfen werden.'),409
        version.state='discarded';r._mark_import_reviewed('documents',did);r.db.session.commit()
        return r.jsonify(document=r._document_json(doc))
    @r.app.get('/api/project-documents/<int:did>/versions/<int:number>/download')
    @r.app.get('/api/project-documents/<int:did>/versions/<int:number>/preview')
    def document_version_file(did,number):
        doc,version=find(did,number)
        if doc and number==doc.current_version:
            data=snapshot(doc);path=r.PROJECT_DOCUMENT_ROOT/doc.stored_name
        elif doc and version:
            data=json.loads(version.snapshot_json);path=r.PROJECT_DOCUMENT_ROOT/version.stored_name
        else:return r.jsonify(error='Version nicht gefunden.'),404
        if not path.is_file():return r.jsonify(error='Originaldatei fehlt.'),404
        preview=r.request.path.endswith('/preview')
        mime={'.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.txt':'text/plain'}.get(data['extension'])
        if preview and not mime:return r.jsonify(error='Für diesen Dateityp steht nur der Download zur Verfügung.'),415
        response=r.send_file(path,as_attachment=not preview,download_name=data['original_name'],mimetype=mime)
        response.headers.update({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':'sandbox'})
        return response
