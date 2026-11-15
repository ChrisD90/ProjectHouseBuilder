"""Project-local watched folders. Discovery never moves files or starts analysis."""
from datetime import datetime, timedelta
from hashlib import sha256
from pathlib import Path
from threading import Lock, Thread, Event
import io
import os
import stat
import time
from flask import jsonify, request, send_file
from sqlalchemy import select
from process_lock import ProcessLock
from project_lifecycle import sqlite_write_lock

EXTENSIONS={'.pdf','.jpg','.jpeg','.png','.webp','.docx','.txt'}

def register_document_inbox(runtime):
    app,db=runtime.app,runtime.db
    class DocumentInboxConfig(db.Model):
        __tablename__='document_inbox_config'
        __table_args__=(db.UniqueConstraint('project_id',name='uq_document_inbox_config_project'),)
        id=db.Column(db.Integer,primary_key=True)
        folder=db.Column(db.String(2048),nullable=False,default='')
        interval_minutes=db.Column(db.Integer,nullable=False,default=10)
        enabled=db.Column(db.Boolean,nullable=False,default=True)
        last_scan=db.Column(db.DateTime)
        error=db.Column(db.String(500),nullable=False,default='')
    class DocumentInboxItem(db.Model):
        __tablename__='document_inbox_item'
        __table_args__=(db.UniqueConstraint('project_id','folder_key','digest',name='uq_document_inbox_item_content'),)
        id=db.Column(db.Integer,primary_key=True)
        folder_key=db.Column(db.String(64),nullable=False)
        digest=db.Column(db.String(64),nullable=False)
        filename=db.Column(db.String(255),nullable=False)
        size=db.Column(db.BigInteger,nullable=False)
        modified_ns=db.Column(db.BigInteger,nullable=False)
        present=db.Column(db.Boolean,nullable=False,default=True)
        state=db.Column(db.String(12),nullable=False,default='new')
        # Logical reference: deleting a reviewed upload must not rediscover its original.
        job_id=db.Column(db.Integer)
        discovered_at=db.Column(db.DateTime,nullable=False,default=datetime.utcnow)

    locks={};guard=Lock();worker=None;stop=Event()
    def project_lock():
        owner=runtime.current_project_id()
        with guard:
            return locks.setdefault(owner,ProcessLock(lambda:runtime.ROOT/'private'/('.document-inbox-'+str(owner)+'.lock')))
    def key(folder):return sha256(folder.encode()).hexdigest()
    def configuration():return db.session.scalar(select(DocumentInboxConfig).limit(1))
    def config_json(cfg):
        return dict(configured=bool(cfg and cfg.folder),folder=cfg.folder if cfg else '',enabled=bool(cfg and cfg.enabled),
                    interval_minutes=cfg.interval_minutes if cfg else 10,last_scan=cfg.last_scan.isoformat()+'Z' if cfg and cfg.last_scan else '',error=cfg.error if cfg else '')
    def root_path(folder):
        if not isinstance(folder,str) or not folder.strip() or len(folder)>2048:
            raise ValueError('Bitte einen vorhandenen Ordnerpfad auf dem App-Server angeben.')
        path=Path(folder.strip()).expanduser()
        if not path.is_absolute():raise ValueError('Bitte einen vollständigen absoluten Ordnerpfad angeben.')
        path=path.resolve(strict=True)
        if not path.is_dir():raise ValueError('Der ausgewählte Pfad ist kein Ordner.')
        if path.is_relative_to((runtime.ROOT/'private').resolve()):
            raise ValueError('Bitte einen Eingangsordner außerhalb der internen App-Dokumente wählen.')
        with os.scandir(path):pass
        return path
    def read_file(root,filename,expected=None):
        if not isinstance(filename,str) or Path(filename).name!=filename or filename in ('.','..') or '\\' in filename:
            raise ValueError('Ungültiger Dateiname.')
        source=root/filename
        if source.is_symlink():raise ValueError('Verknüpfungen werden nicht übernommen.')
        descriptor=os.open(source,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
        with os.fdopen(descriptor,'rb') as stream:
            before=os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode):raise ValueError('Keine reguläre Datei.')
            if expected and (before.st_size,before.st_mtime_ns)!=expected:
                raise ValueError('Die Datei wurde geändert. Bitte den Eingang erneut prüfen.')
            digest=sha256();chunks=[]
            while chunk:=stream.read(1024*1024):
                digest.update(chunk)
                if expected is not None:chunks.append(chunk)
            after=os.fstat(stream.fileno())
            if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):
                raise ValueError('Die Datei wird noch geschrieben. Bitte später erneut versuchen.')
        return digest.hexdigest(),b''.join(chunks)

    def scan(force=False,now=None):
        lock=project_lock()
        if not lock.acquire(blocking=False):return False
        try:
            cfg=configuration();now=now or datetime.utcnow()
            if not cfg or not cfg.folder or not cfg.enabled or runtime.restore_busy(runtime.current_project_id()):return False
            if not force and cfg.last_scan and now<cfg.last_scan+timedelta(minutes=cfg.interval_minutes):return False
            config_id,folder=cfg.id,cfg.folder
            try:
                root=root_path(folder);folder_key=key(folder)
                rows=db.session.scalars(select(DocumentInboxItem).where(DocumentInboxItem.folder_key==folder_key)).all()
                found=[]
                with os.scandir(root) as entries:
                    for entry in entries:
                        if entry.name.startswith('.') or Path(entry.name).suffix.lower() not in EXTENSIONS or not entry.is_file(follow_symlinks=False):continue
                        info=entry.stat(follow_symlinks=False)
                        if not info.st_size or time.time()-info.st_mtime<3:continue
                        digest,_=read_file(root,entry.name)
                        # The entire read must belong to the same completed file.
                        after=entry.stat(follow_symlinks=False)
                        if (info.st_size,info.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):continue
                        found.append((entry.name,info.st_size,info.st_mtime_ns,digest))
                sqlite_write_lock(db.session.connection())
                db.session.execute(select(runtime.Project.id).where(runtime.Project.id==runtime.current_project_id()).with_for_update()).first()
                cfg=db.session.get(DocumentInboxConfig,config_id,populate_existing=True)
                if not cfg or cfg.folder!=folder or not cfg.enabled or runtime.restore_busy(runtime.current_project_id()):
                    db.session.rollback();return False
                by_digest={row.digest:row for row in rows}
                for row in rows:row.present=False
                for filename,size,modified,digest in found:
                    row=by_digest.get(digest)
                    if row is None:
                        row=DocumentInboxItem(folder_key=folder_key,digest=digest,filename=filename,size=size,modified_ns=modified,present=True,state='new')
                        db.session.add(row);by_digest[digest]=row
                    elif row.state=='new' or not row.present:
                        row.filename=filename;row.size=size;row.modified_ns=modified
                    row.present=True
                cfg.last_scan=now;cfg.error='';db.session.commit();return True
            except (OSError,ValueError) as exc:
                db.session.rollback();cfg=db.session.get(DocumentInboxConfig,config_id)
                if cfg and cfg.folder==folder:
                    cfg.last_scan=now;cfg.error=('Ordner konnte nicht vollständig geprüft werden: '+str(exc))[:500];db.session.commit()
                return False
        finally:lock.release()
    runtime.scan_document_inbox=scan

    def scan_due():
        with app.app_context(),runtime.all_projects():
            owners=db.session.scalars(select(DocumentInboxConfig.project_id).where(DocumentInboxConfig.enabled==True)).all()
        for owner in owners:
            with app.app_context(),runtime.project_context(owner):
                project=db.session.get(runtime.Project,owner)
                if project and not project.archived_at:scan()
    runtime.scan_document_inboxes=scan_due
    def start_worker():
        nonlocal worker
        if db.engine.url.database==':memory:':return
        with runtime.all_projects():
            if not db.session.scalar(select(DocumentInboxConfig.id).where(DocumentInboxConfig.enabled==True).limit(1)):return
        with guard:
            if worker and worker.is_alive():return
            def loop():
                while not stop.wait(10):
                    try:scan_due()
                    except Exception:app.logger.exception('Dokumenteneingang konnte nicht geprüft werden.')
            worker=Thread(target=loop,name='phb-document-inbox',daemon=True);worker.start()
    runtime.start_document_inbox_worker=start_worker

    @app.get('/api/document-inbox')
    def inbox_status():
        cfg=configuration();start_worker()
        if not cfg or not cfg.folder:return jsonify(config=config_json(cfg),items=[],count=0)
        rows=db.session.scalars(select(DocumentInboxItem).where(DocumentInboxItem.folder_key==key(cfg.folder)).order_by(DocumentInboxItem.discovered_at.desc(),DocumentInboxItem.id.desc())).all()
        items=[];count=0
        for row in rows:
            if row.state=='ignored' and request.args.get('ignored')!='1':continue
            if row.state=='new' and not row.present:continue
            job=db.session.get(runtime.ImportJob,row.job_id) if row.job_id else None
            if row.state=='queued' and (not job or job.status in ('Übernommen','Ausgeblendet')):continue
            if row.state=='new':count+=1
            items.append(dict(id=row.id,filename=row.filename,size=row.size,state=row.state,present=row.present,
                              job={**runtime._import_json(job),'review_url':runtime._import_result(job)} if job else None,preview_url='/api/document-inbox/items/'+str(row.id)+'/preview'))
        return jsonify(config=config_json(cfg),items=items,count=count)

    @app.post('/api/document-inbox/configure')
    def configure():
        lock=project_lock()
        if not lock.acquire(blocking=False):return jsonify(error='Der Ordner wird gerade geprüft. Bitte kurz warten.'),409
        try:
            data=request.get_json(silent=True)
            if not isinstance(data,dict) or set(data)-{'folder','interval_minutes','enabled'}:raise ValueError('Ungültige Einstellungen.')
            folder=str(root_path(data.get('folder','')))
            interval=data.get('interval_minutes',10);enabled=data.get('enabled',True)
            if type(interval) is not int or not 1<=interval<=1440 or type(enabled) is not bool:raise ValueError('Das Prüfintervall muss zwischen 1 und 1440 Minuten liegen.')
            cfg=configuration()
            if not cfg:cfg=DocumentInboxConfig();db.session.add(cfg)
            cfg.folder=folder;cfg.interval_minutes=interval;cfg.enabled=enabled;cfg.last_scan=None;cfg.error='';db.session.commit()
        except (ValueError,OSError) as exc:
            db.session.rollback();return jsonify(error=str(exc)),400
        finally:lock.release()
        scan(force=True);start_worker();return jsonify(config=config_json(configuration()))

    @app.post('/api/document-inbox/scan')
    def scan_now():
        scan(force=True);return inbox_status()

    def source_item(item_id):
        cfg=configuration();item=db.session.get(DocumentInboxItem,item_id)
        if not cfg or not item or item.folder_key!=key(cfg.folder):raise ValueError('Eingangsdokument nicht gefunden.')
        root=root_path(cfg.folder)
        digest,raw=read_file(root,item.filename,(item.size,item.modified_ns))
        if digest!=item.digest:raise ValueError('Die Datei wurde geändert. Bitte den Eingang erneut prüfen.')
        return item,raw

    @app.get('/api/document-inbox/items/<int:item_id>/preview')
    def preview(item_id):
        try:
            item,raw=source_item(item_id)
            suffix=Path(item.filename).suffix.lower()
            response=send_file(io.BytesIO(raw),download_name=item.filename,as_attachment=suffix=='.docx')
            response.headers['X-Content-Type-Options']='nosniff'
            return response
        except (ValueError,OSError) as exc:return jsonify(error=str(exc)),404

    @app.patch('/api/document-inbox/items/<int:item_id>')
    def dismiss(item_id):
        item=db.session.get(DocumentInboxItem,item_id);cfg=configuration()
        data=request.get_json(silent=True) or {}
        if not item or not cfg or item.folder_key!=key(cfg.folder):return jsonify(error='Eingangsdokument nicht gefunden.'),404
        if data.get('state') not in ('ignored','new') or item.state=='queued':return jsonify(error='Dieser Eintrag wird bereits im Standardprozess bearbeitet.'),409
        item.state=data['state'];db.session.commit();return jsonify(ok=True)

    @app.post('/api/document-inbox/items/<int:item_id>/import')
    def import_item(item_id):
        lock=project_lock()
        if not lock.acquire(blocking=False):return jsonify(error='Der Ordner wird gerade geprüft. Bitte kurz warten.'),409
        try:
            item=db.session.get(DocumentInboxItem,item_id);cfg=configuration()
            if not item or not cfg or item.folder_key!=key(cfg.folder):return jsonify(error='Eingangsdokument nicht gefunden.'),404
            if item.state=='queued':
                job=db.session.get(runtime.ImportJob,item.job_id)
                if job:return jsonify(jobs=[runtime._import_json(job)],batch_id=job.batch_id),202
                raise ValueError('Diese Datei wurde bereits übernommen.')
            if item.state!='new':raise ValueError('Bitte den ausgeblendeten Eintrag zuerst wiederherstellen.')
            data=request.get_json(silent=True)
            if not isinstance(data,dict):raise ValueError('Ungültige Eingaben.')
            kind=data.get('kind','');fields=data.get('fields',{})
            if kind not in ('offers','versions','receipts','documents','loans') or not isinstance(fields,dict) or set(fields)-{'offer_id','receipt_kind','version_document_id','review_context','funding_id'}:
                raise ValueError('Bitte einen gültigen Dokumenttyp auswählen.')
            if data.get('analysis_mode')=='ai':runtime._ai_request_required()
            item,raw=source_item(item_id)
            payload={**fields,'kind':kind,'analysis_mode':data.get('analysis_mode','local'),'model':data.get('model',''),'plan_only':str(data.get('plan_only',False)).lower(),'files':(io.BytesIO(raw),item.filename)}
            with app.test_request_context('/api/import-jobs',method='POST',data=payload,headers={'X-PHB-AI':request.headers.get('X-PHB-AI','')},environ_base={'REMOTE_ADDR':request.remote_addr or ''},base_url=request.host_url):
                return runtime.enqueue_import_jobs(inbox_item=item)
        except (ValueError,OSError) as exc:
            db.session.rollback();return jsonify(error=str(exc)),400
        finally:lock.release()

    return DocumentInboxConfig,DocumentInboxItem
