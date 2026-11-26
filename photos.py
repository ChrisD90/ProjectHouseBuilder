"""Shared project photo library. Tags and object associations are independent.

Originals remain in the existing project-document store, so every original is
backed up once. An object link is removed on deletion of its object, never its photo.
"""
import json
import warnings
from datetime import date, datetime, timezone
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from flask import jsonify, request, send_file
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select, event
from multi_projects import ProjectSession, current_project_id
from project_documents import plain
from project_lifecycle import sqlite_write_lock

IMAGE_EXTENSIONS=('.jpg','.jpeg','.png','.webp')


def backfill(connection, owner=None):
    """Add metadata/links for existing images without touching bytes or legacy links."""
    from sqlalchemy import MetaData,Table
    metadata=MetaData()
    docs=Table('project_document',metadata,autoload_with=connection)
    photos=Table('project_photo',metadata,autoload_with=connection)
    links=Table('project_photo_link',metadata,autoload_with=connection)
    records=Table('companion_record',metadata,autoload_with=connection)
    canonical={(x.project_id,x.digest):x.id for x in connection.execute(select(photos))}
    photo_by_doc={}
    for d in connection.execute(select(docs).where(docs.c.extension.in_(IMAGE_EXTENSIONS), *([docs.c.project_id==owner] if owner else [])).order_by(docs.c.id)):
        key=(d.project_id,d.digest)
        if key not in canonical:
            result=connection.execute(photos.insert().values(project_id=d.project_id,document_id=d.id,digest=d.digest,title=d.title,description='',taken_on='',revision=uuid4().hex,created_at=d.uploaded_at or datetime.now(timezone.utc)))
            canonical[key]=result.inserted_primary_key[0]
        photo_by_doc[(d.project_id,d.id)]=canonical[key]
    existing={(x.project_id,x.photo_id,x.source_type,x.source_id) for x in connection.execute(select(links))}
    for row in connection.execute(select(records).where(*([records.c.project_id==owner] if owner else []))):
        try:ids=json.loads(row.data_json).get('document_ids',[])
        except (ValueError,AttributeError):continue
        for did in ids:
            pid=photo_by_doc.get((row.project_id,did))
            key=(row.project_id,pid,'companion',row.id)
            if pid and key not in existing:
                connection.execute(links.insert().values(project_id=row.project_id,photo_id=pid,source_type='companion',source_id=row.id));existing.add(key)


def register_photos(r):
    app,db=r.app,r.db
    class ProjectPhoto(db.Model):
        __tablename__='project_photo'
        __table_args__=(db.UniqueConstraint('project_id','digest',name='uq_project_photo_content'),)
        id=db.Column(db.Integer,primary_key=True)
        document_id=db.Column(db.Integer,db.ForeignKey('project_document.id'),nullable=False,unique=True)
        digest=db.Column(db.String(64),nullable=False)
        title=db.Column(db.String(200),nullable=False)
        description=db.Column(db.Text,nullable=False,default='')
        taken_on=db.Column(db.String(10),nullable=False,default='')
        revision=db.Column(db.String(32),nullable=False,default=lambda:uuid4().hex)
        created_at=db.Column(db.DateTime,nullable=False,default=lambda:datetime.now(timezone.utc))
        document=db.relationship(r.ProjectDocument,lazy='joined')
        tag_links=db.relationship('PhotoTagging',cascade='all, delete-orphan',lazy='selectin')
        links=db.relationship('PhotoObjectLink',cascade='all, delete-orphan',lazy='selectin')
    class PhotoTag(db.Model):
        __tablename__='photo_tag'
        __table_args__=(db.UniqueConstraint('project_id','normalized',name='uq_photo_tag_name'),)
        id=db.Column(db.Integer,primary_key=True)
        name=db.Column(db.String(60),nullable=False)
        normalized=db.Column(db.String(180),nullable=False)
    class PhotoTagging(db.Model):
        __tablename__='photo_tagging'
        __table_args__=(db.UniqueConstraint('project_id','photo_id','tag_id',name='uq_photo_tagging'),)
        id=db.Column(db.Integer,primary_key=True)
        photo_id=db.Column(db.Integer,db.ForeignKey('project_photo.id'),nullable=False,index=True)
        tag_id=db.Column(db.Integer,db.ForeignKey('photo_tag.id'),nullable=False,index=True)
        tag=db.relationship(PhotoTag,lazy='joined')
    class PhotoObjectLink(db.Model):
        __tablename__='project_photo_link'
        __table_args__=(db.UniqueConstraint('project_id','photo_id','source_type','source_id',name='uq_photo_object_link'),)
        id=db.Column(db.Integer,primary_key=True)
        photo_id=db.Column(db.Integer,db.ForeignKey('project_photo.id'),nullable=False,index=True)
        source_type=db.Column(db.String(24),nullable=False)
        source_id=db.Column(db.Integer,nullable=False,index=True)

    sources={**r.work_sources,
        'work':(r.ProjectWork,lambda x:('Notiz · ' if x.kind=='note' else 'To-do · ')+x.title,lambda x:'/aufgaben?work_id='+str(x.id)),
        'companion':(r.CompanionRecord,lambda x:x.title,lambda x:'/projektwerkstatt?tab='+{'room':'rooms','tile_plan':'tiles','osb_plan':'osb'}.get(x.kind,x.kind)+'&record='+str(x.id)),
        'person':(r.TimePerson,lambda x:'Stunden · '+x.name,lambda x:'/stunden?person_id='+str(x.id)),
        'equity':(r.EquityAccount,lambda x:'Eigenkapital · '+x.name,lambda x:'/finanzierung?equity_id='+str(x.id))}
    # Modern offer navigation opens the existing detail subpage.
    sources['company']=(r.Contractor,lambda x:'Firma · '+x.name,lambda x:'/stammdaten?contractor_id='+str(x.id))
    sources['offer']=(r.Offer,lambda x:'Angebot · '+x.vendor,lambda x:'/angebote/'+str(x.id))
    def target(kind,ident):
        if not isinstance(kind,str) or kind not in sources or type(ident)is not int or ident<1:raise ValueError('Bitte ein gültiges Projektobjekt auswählen.')
        obj=db.session.get(sources[kind][0],ident)
        if obj is None:raise ValueError('Das verknüpfte Objekt gehört nicht zu diesem Projekt oder wurde gelöscht.')
        return obj
    def info(kind,ident):
        try:obj=target(kind,ident)
        except ValueError:return None
        return dict(type=kind,id=ident,label=sources[kind][1](obj),url=sources[kind][2](obj))
    def source_body(body,optional=False):
        kind=body.get('source_type');ident=body.get('source_id')
        if optional and not kind and ident is None:return None
        target(kind,ident);return kind,ident
    def wire(p):
        doc=p.document
        if not doc or doc.project_id!=current_project_id():raise ValueError('Ungültige Foto-Dateizuordnung.')
        return dict(id=p.id,title=p.title,description=p.description,taken_on=p.taken_on,revision=p.revision,created_at=p.created_at.isoformat(),filename=doc.original_name,document_id=doc.id,
                    tags=[dict(id=x.tag.id,name=x.tag.name) for x in p.tag_links if x.tag.project_id==current_project_id()],
                    links=[{**(info(x.source_type,x.source_id) or dict(type=x.source_type,id=x.source_id,label='Objekt nicht mehr vorhanden',url='')),'link_id':x.id} for x in p.links],
                    thumbnail_url=f'/api/photos/{p.id}/image?size=thumb',image_url=f'/api/photos/{p.id}/image',original_url=f'/api/photos/{p.id}/original')
    def ensure_photo(doc):
        if doc.extension.lower() not in IMAGE_EXTENSIONS:return None
        found=db.session.scalar(select(ProjectPhoto).where(ProjectPhoto.digest==doc.digest))
        if found:return found
        p=ProjectPhoto(document=doc,digest=doc.digest,title=doc.title)
        db.session.add(p);db.session.flush();return p
    r.ensure_photo_document=ensure_photo
    def link(photo,source):
        kind,ident=source
        exists=db.session.scalar(select(PhotoObjectLink.id).where(PhotoObjectLink.photo_id==photo.id,PhotoObjectLink.source_type==kind,PhotoObjectLink.source_id==ident))
        if not exists:db.session.add(PhotoObjectLink(photo_id=photo.id,source_type=kind,source_id=ident))
    def sync_companion(row):
        ids=json.loads(row.data_json).get('document_ids',[])
        for doc in db.session.scalars(select(r.ProjectDocument).where(r.ProjectDocument.id.in_(ids))):
            p=ensure_photo(doc)
            if p:link(p,('companion',row.id))
    r.sync_companion_photos=sync_companion
    def photo(ident):
        p=db.session.get(ProjectPhoto,ident)
        if p is None:raise ValueError('Foto nicht gefunden.')
        return p
    def tags(names):
        if not isinstance(names,list) or len(names)>50:raise ValueError('Maximal 50 Tags pro Foto sind möglich.')
        rows=[];seen=set()
        for name in names:
            name=plain(name,'Tag',60,required=True);normalized=name.casefold()
            if normalized in seen:continue
            seen.add(normalized);row=db.session.scalar(select(PhotoTag).where(PhotoTag.normalized==normalized))
            if row is None:row=PhotoTag(name=name,normalized=normalized);db.session.add(row);db.session.flush()
            rows.append(row)
        return rows
    def file_path(p):
        if p.document.project_id!=current_project_id():raise ValueError('Ungültige Foto-Dateizuordnung.')
        root=r.PROJECT_DOCUMENT_ROOT.resolve();name=p.document.stored_name
        if Path(name).name!=name:raise ValueError('Ungültiger Dateiname.')
        path=root/name
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):raise ValueError('Originalfoto ist nicht verfügbar.')
        return path

    @app.get('/api/photos')
    def photo_list():
        query=select(ProjectPhoto).order_by(ProjectPhoto.created_at.desc(),ProjectPhoto.id.desc())
        try:
            if request.args.get('source_type'):
                kind=request.args['source_type'];ident=int(request.args.get('source_id','0'));target(kind,ident)
                query=query.where(ProjectPhoto.id.in_(select(PhotoObjectLink.photo_id).where(PhotoObjectLink.source_type==kind,PhotoObjectLink.source_id==ident)))
            return jsonify(photos=[wire(x) for x in db.session.scalars(query).unique()])
        except (ValueError,TypeError) as exc:return jsonify(error=str(exc)),400
    @app.get('/api/photos/sources')
    def photo_sources():
        return jsonify(sources=[info(kind,obj.id) for kind,(model,_,__) in sources.items() for obj in db.session.scalars(select(model).order_by(model.id.desc()))])
    @app.get('/api/photo-tags')
    def tag_list():
        return jsonify(tags=[dict(id=x.id,name=x.name,count=db.session.query(PhotoTagging).filter_by(tag_id=x.id).count()) for x in db.session.scalars(select(PhotoTag).order_by(PhotoTag.name))])
    @app.post('/api/photo-tags')
    @app.route('/api/photo-tags/<int:ident>',methods=['PATCH','DELETE'])
    def tag_edit(ident=None):
        try:
            row=db.session.get(PhotoTag,ident) if ident else None
            if ident and row is None:return jsonify(error='Tag nicht gefunden.'),404
            body=request.get_json(silent=True) or {}
            if not isinstance(body,dict):raise ValueError('Ungültige Tagdaten.')
            if row:
                affected=select(PhotoTagging.photo_id).where(PhotoTagging.tag_id==row.id)
                db.session.query(ProjectPhoto).filter(ProjectPhoto.id.in_(affected)).update({'revision':uuid4().hex},synchronize_session=False)
            if request.method=='DELETE':
                if body.get('confirm')is not True:raise ValueError('Bitte das Entfernen des Tags bestätigen.')
                db.session.query(PhotoTagging).filter_by(tag_id=ident).delete();db.session.delete(row)
            else:
                name=plain(body.get('name',''),'Tag',60,required=True)
                other=db.session.scalar(select(PhotoTag).where(PhotoTag.normalized==name.casefold()))
                if other and (not row or other.id!=row.id):raise ValueError('Dieser Tag existiert bereits.')
                if row:row.name=name;row.normalized=name.casefold()
                else:db.session.add(PhotoTag(name=name,normalized=name.casefold()))
            db.session.commit();return jsonify(ok=True)
        except (ValueError,TypeError) as exc:db.session.rollback();return jsonify(error=str(exc)),400
    @app.post('/api/photos')
    def photo_upload():
        created=[]
        try:
            files=request.files.getlist('files')
            if not files:raise ValueError('Bitte Fotos auswählen.')
            compression=request.form.get('compression','original')
            if compression not in ('original','compact'):raise ValueError('Ungültige Komprimierungsoption.')
            input_bytes=0;stored_bytes=0;optimized_count=0
            # Same project lock as ordinary writes, including multipart uploads.
            sqlite_write_lock(db.session.connection());db.session.execute(select(r.Project.id).where(r.Project.id==current_project_id()).with_for_update()).first()
            source=source_body(dict(source_type=request.form.get('source_type'),source_id=int(request.form['source_id']) if request.form.get('source_id') else None),True)
            result=[];seen=set()
            for upload in files:
                raw=upload.read();input_bytes+=len(raw);optimized=False
                with warnings.catch_warnings():
                    warnings.simplefilter('error',Image.DecompressionBombWarning)
                    with Image.open(BytesIO(raw)) as image:
                        fmt=image.format
                        if fmt not in ('JPEG','PNG','WEBP'):raise ValueError('Bitte JPEG-, PNG- oder WEBP-Fotos verwenden.')
                        image.verify()
                    if compression=='compact':
                        with Image.open(BytesIO(raw)) as image:
                            image=ImageOps.exif_transpose(image)
                            image.thumbnail((2560,2560),Image.Resampling.LANCZOS)
                            if image.mode not in ('RGB','RGBA'):image=image.convert('RGBA' if 'transparency' in image.info else 'RGB')
                            output=BytesIO();image.save(output,format='WEBP',quality=82,method=6)
                            candidate=output.getvalue()
                            if len(candidate)<len(raw):raw=candidate;fmt='WEBP';optimized=True;optimized_count+=1
                stored_bytes+=len(raw)
                digest=sha256(raw).hexdigest();p=db.session.scalar(select(ProjectPhoto).where(ProjectPhoto.digest==digest))
                if p is None:
                    doc=db.session.scalar(select(r.ProjectDocument).where(r.ProjectDocument.digest==digest,r.ProjectDocument.extension.in_(IMAGE_EXTENSIONS)).order_by(r.ProjectDocument.id))
                    if doc is None:
                        ext={'JPEG':'.jpg','PNG':'.png','WEBP':'.webp'}[fmt];stored=uuid4().hex+ext
                        r.PROJECT_DOCUMENT_ROOT.mkdir(parents=True,exist_ok=True);path=r.PROJECT_DOCUMENT_ROOT/stored
                        with path.open('xb') as dst:dst.write(raw)
                        created.append(path)
                        filename=Path(upload.filename or 'Foto'+ext).name[:200]
                        if optimized:filename=Path(filename).stem[:195]+'.webp'
                        doc=r.ProjectDocument(title=filename,original_name=filename,stored_name=stored,extension=ext,digest=digest,size_bytes=len(raw),category='Sonstiges',area='Allgemein',status='Aktuell',tags='',description='',extracted_text='',extraction_note='Foto in der Fotobibliothek')
                        db.session.add(doc);db.session.flush()
                    p=ensure_photo(doc)
                if source:link(p,source)
                if p.id not in seen:seen.add(p.id);result.append(p.id)
            db.session.commit();db.session.expire_all();return jsonify(photos=[wire(photo(i)) for i in result],upload_summary=dict(input_bytes=input_bytes,stored_bytes=stored_bytes,optimized_count=optimized_count)),201
        except (ValueError,TypeError,OSError,UnidentifiedImageError,Image.DecompressionBombWarning,Image.DecompressionBombError) as exc:
            db.session.rollback()
            for path in created:path.unlink(missing_ok=True)
            return jsonify(error=str(exc) if isinstance(exc,ValueError) else 'Ein Foto ist nicht lesbar. Es wurde nichts aus diesem Upload gespeichert.'),400
        except Exception:
            db.session.rollback()
            for path in created:path.unlink(missing_ok=True)
            raise
    @app.route('/api/photos/<int:ident>',methods=['GET','PATCH','DELETE'])
    def photo_edit(ident):
        try:
            p=photo(ident)
            if request.method=='GET':return jsonify(photo=wire(p))
            body=request.get_json(silent=True) or {}
            if not isinstance(body,dict):raise ValueError('Ungültige Fotodaten.')
            if body.get('revision')!=p.revision:return jsonify(error='Das Foto wurde inzwischen geändert. Bitte neu öffnen; deine Eingaben wurden nicht gespeichert.'),409
            if request.method=='DELETE':
                if p.links:return jsonify(error='Das Foto ist noch verknüpft. Bitte zuerst die Objektverknüpfungen lösen.'),409
                db.session.delete(p);db.session.commit();return jsonify(ok=True,original_retained=True)
            if not isinstance(body,dict) or set(body)-{'revision','title','description','taken_on','tags'}:raise ValueError('Ungültige Fotodaten.')
            p.title=plain(body.get('title',''),'Titel',200,required=True);p.description=plain(body.get('description',''),'Beschreibung',5000)
            taken=body.get('taken_on','')
            if not isinstance(taken,str) or (taken and date.fromisoformat(taken).isoformat()!=taken):raise ValueError('Ungültiges Aufnahmedatum.')
            p.taken_on=taken;p.revision=uuid4().hex
            selected=tags(body.get('tags',[]));existing={x.tag_id:x for x in p.tag_links}
            p.tag_links=[existing.get(x.id) or PhotoTagging(tag_id=x.id) for x in selected]
            db.session.commit();return jsonify(photo=wire(p))
        except (ValueError,TypeError) as exc:db.session.rollback();return jsonify(error=str(exc)),400
    @app.post('/api/photos/links')
    def photo_links():
        try:
            body=request.get_json(silent=True)
            if not isinstance(body,dict) or set(body)-{'source_type','source_id','photo_ids','action','sources'}:raise ValueError('Ungültige Verknüpfung.')
            raw_sources=body.get('sources')
            if raw_sources is not None:
                if not isinstance(raw_sources,list) or not raw_sources or len(raw_sources)>100 or any(not isinstance(x,dict) or set(x)!={'source_type','source_id'} for x in raw_sources):raise ValueError('Ungültige Objektauswahl.')
                selected_sources=[source_body(x) for x in raw_sources]
            else:selected_sources=[source_body(body)]
            ids=body.get('photo_ids');action=body.get('action')
            if not isinstance(ids,list) or not ids or len(ids)>500 or any(type(x)is not int for x in ids) or action not in ('add','remove'):raise ValueError('Bitte Fotos und Aktion auswählen.')
            photos=[photo(i) for i in set(ids)]
            for source in set(selected_sources):
                for p in photos:
                    if action=='add':link(p,source)
                    else:db.session.query(PhotoObjectLink).filter_by(photo_id=p.id,source_type=source[0],source_id=source[1]).delete()
            db.session.commit();return jsonify(ok=True)
        except (ValueError,TypeError) as exc:db.session.rollback();return jsonify(error=str(exc)),400
    @app.get('/api/photos/<int:ident>/image')
    def photo_image(ident):
        try:
            p=photo(ident);path=file_path(p);edge=360 if request.args.get('size')=='thumb' else 1800
            with warnings.catch_warnings():
                warnings.simplefilter('error',Image.DecompressionBombWarning)
                with Image.open(path) as image:
                    image=ImageOps.exif_transpose(image);image.thumbnail((edge,edge));out=BytesIO()
                    if image.mode not in ('RGB','RGBA'):image=image.convert('RGB')
                    image.save(out,format='WEBP',quality=85)
            out.seek(0);response=send_file(out,mimetype='image/webp',etag=p.digest+'-'+str(edge),max_age=86400);response.headers['X-Content-Type-Options']='nosniff';response.cache_control.public=False;response.cache_control.private=True;return response
        except (ValueError,OSError,Image.DecompressionBombWarning,Image.DecompressionBombError):return jsonify(error='Das Originalfoto fehlt oder ist nicht lesbar.'),404
    @app.get('/api/photos/<int:ident>/original')
    def photo_original(ident):
        try:
            p=photo(ident);return send_file(file_path(p),as_attachment=True,download_name=p.document.original_name)
        except ValueError as exc:return jsonify(error=str(exc)),404

    @event.listens_for(ProjectSession,'before_flush')
    def detach_deleted_objects(session,flush_context,instances):
        for obj in list(session.deleted):
            if getattr(obj,'project_id',None)!=current_project_id():continue
            for kind,(model,_,__) in sources.items():
                if isinstance(obj,model):
                    session.execute(PhotoObjectLink.__table__.delete().where(PhotoObjectLink.project_id==current_project_id(),PhotoObjectLink.source_type==kind,PhotoObjectLink.source_id==obj.id))
    r.photo_sources=sources
    return ProjectPhoto,PhotoTag,PhotoTagging,PhotoObjectLink
