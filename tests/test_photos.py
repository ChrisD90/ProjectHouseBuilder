"""Photo process/data integrity: shared originals, isolation, rollback and backup."""
import os,json,tempfile,unittest,zipfile,hashlib
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from PIL import Image
os.environ['DATABASE_URL']='sqlite:///:memory:'
import app as b
from photos import backfill
from multi_projects import project_context
import project_backups

class PhotoIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.ctx=b.app.app_context();self.ctx.push();b.db.session.remove();b.db.drop_all();b.initialize();self.client=b.app.test_client()
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.store=self.root/'private'/'project-documents';self.store.mkdir(parents=True)
        self.patch=patch.object(b,'PROJECT_DOCUMENT_ROOT',self.store);self.patch.start()
        out=BytesIO();Image.new('RGB',(40,30),'green').save(out,format='PNG');self.raw=out.getvalue()
    def tearDown(self):self.patch.stop();b.db.session.remove();b.db.drop_all();self.ctx.pop();self.temp.cleanup()
    def upload(self,source=None):
        data={'files':(BytesIO(self.raw),'Baustelle.png')}
        if source:data.update(source_type=source[0],source_id=str(source[1]))
        result=self.client.post('/api/photos',data=data);self.assertEqual(result.status_code,201,result.json);return result.json['photos'][0]
    def action(self,p,source,action='add'):
        result=self.client.post('/api/photos/links',json=dict(photo_ids=[p],source_type=source[0],source_id=source[1],action=action));self.assertEqual(result.status_code,200,result.json)
    def test_project_documents_hide_images_without_removing_originals(self):
        p=self.upload()
        doc=self.client.post('/api/project-documents',data={'file':(BytesIO(b'Projektunterlage'),'Plan.txt'),'title':'Plan'}).json['document']
        filtered=self.client.get('/api/project-documents?documents_only=1')
        self.assertEqual(filtered.status_code,200,filtered.json)
        self.assertEqual([x['id'] for x in filtered.json['documents']],[doc['id']])
        self.assertEqual(len(self.client.get('/api/project-documents').json['documents']),2)
        library=self.client.get('/api/document-library?documents_only=1').json
        self.assertEqual([x['project_document_id'] for x in library['documents']],[doc['id']])
        self.assertEqual(library['total'],1)
        self.assertEqual(len(self.client.get('/api/document-library').json['documents']),2)
        self.assertEqual(self.client.get('/api/photos').json['photos'][0]['id'],p['id'])
        self.assertEqual(self.client.get('/api/photos/'+str(p['id'])+'/image').status_code,200)
    def test_shared_photo_tags_object_deletion_and_project_safety(self):
        work=b.ProjectWork(kind='note',title='Notiz',body='Text');journal=b.CompanionRecord(kind='journal',title='Bautagebuch',data_json='{}');offer=b.Offer(vendor='Betrieb',digest='o'*64,filename='Angebot.pdf',status='Angebot')
        b.db.session.add_all([work,journal,offer]);b.db.session.commit();wid,jid,oid=work.id,journal.id,offer.id
        p=self.upload(('work',wid));self.action(p['id'],('companion',jid));self.action(p['id'],('offer',oid))
        duplicate=self.upload(('work',wid));self.assertEqual(duplicate['id'],p['id']);self.assertEqual(len(duplicate['links']),3);self.assertEqual(len(list(self.store.iterdir())),1)
        metadata=dict(revision=p['revision'],title='Leitungen in der Wand',description='Vor dem Verputzen',taken_on='',tags=['Elektrik','Vorher','elektrik'])
        result=self.client.patch('/api/photos/'+str(p['id']),json=metadata);self.assertEqual(result.status_code,200,result.json);updated=result.json['photo'];self.assertEqual(len(updated['tags']),2)
        # Editing the same tags again must not insert duplicate association rows.
        metadata['revision']=updated['revision'];result=self.client.patch('/api/photos/'+str(p['id']),json=metadata);self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(self.client.delete('/api/photos/'+str(p['id']),json={'revision':result.json['photo']['revision']}).status_code,409)
        self.assertEqual(self.client.delete('/api/project-documents/'+str(p['document_id'])).status_code,409)
        self.assertEqual(self.client.post('/api/project-documents/'+str(p['document_id'])+'/versions').status_code,409)
        self.action(p['id'],('work',wid),'remove')
        self.assertEqual(len(self.client.get('/api/photos?source_type=offer&source_id='+str(oid)).json['photos']),1)
        self.assertEqual(self.client.delete('/api/companion/records/'+str(jid)).status_code,200)
        self.assertEqual(len(self.client.get('/api/photos/'+str(p['id'])).json['photo']['links']),1)
        tag=updated['tags'][0];self.assertEqual(self.client.delete('/api/photo-tags/'+str(tag['id']),json={'confirm':True}).status_code,200)
        self.assertEqual(len(self.client.get('/api/photos/'+str(p['id'])).json['photo']['links']),1,'Tags must not change object associations')
        other=self.client.post('/api/projects',json={'title':'Fremdprojekt'}).json['project']['id'];headers={'X-PHB-Project':str(other)}
        self.assertEqual(self.client.get('/api/photos',headers=headers).json['photos'],[])
        self.assertEqual(self.client.get('/api/photos/'+str(p['id'])+'/image',headers=headers).status_code,404)
        foreign=self.client.post('/api/photos/links',headers=headers,json={'photo_ids':[p['id']],'source_type':'offer','source_id':oid,'action':'add'});self.assertEqual(foreign.status_code,400)
        self.assertEqual(self.client.get('/api/photos/'+str(p['id'])+'/image').status_code,200)
    def test_partial_upload_and_backup_roundtrip_preserves_original_and_links(self):
        record=b.CompanionRecord(kind='journal',title='Altbestand',data_json='{}');b.db.session.add(record);b.db.session.commit()
        digest=hashlib.sha256(self.raw).hexdigest();doc=b.ProjectDocument(title='Altes Foto',original_name='alt.png',stored_name='alt.png',extension='.png',digest=digest,size_bytes=len(self.raw),category='Protokoll',area='Allgemein')
        b.db.session.add(doc);b.db.session.flush();record.data_json=json.dumps({'document_ids':[doc.id]});b.db.session.commit();old_data=record.data_json;did=doc.id
        (self.store/'alt.png').write_bytes(self.raw)
        backfill(b.db.session.connection());b.db.session.commit();backfill(b.db.session.connection());b.db.session.commit()
        p=self.client.get('/api/photos').json['photos'][0];self.assertEqual(len(p['links']),1);self.assertEqual(b.db.session.get(b.CompanionRecord,record.id).data_json,old_data)
        before=self.client.get('/api/photos').json
        out=BytesIO();Image.new('RGB',(10,10),'red').save(out,format='PNG')
        failed=self.client.post('/api/photos',data={'files':[(BytesIO(out.getvalue()),'neu.png'),(BytesIO(b'not an image'),'kaputt.png')]})
        self.assertEqual(failed.status_code,201,failed.json)
        self.assertEqual([x['status'] for x in failed.json['files']],['created','skipped'])
        self.assertEqual(failed.json['files'][1]['filename'],'kaputt.png')
        self.assertEqual(failed.json['files'][1]['error_code'],'unreadable_image')
        before=self.client.get('/api/photos').json
        self.assertEqual(len(before['photos']),2);self.assertEqual(len(list(self.store.iterdir())),2)
        backups=self.root/'backups';backups.mkdir();archive=project_backups.create(b.db,self.root,1,dict(folder=str(backups),keep=5))
        with zipfile.ZipFile(archive) as z:self.assertEqual(z.read('private/project-documents/alt.png'),self.raw)
        self.action(p['id'],('companion',record.id),'remove')
        project_backups.restore(archive,b.db,self.root,1)
        self.assertEqual(self.client.get('/api/photos').json,before);self.assertEqual((self.store/'alt.png').read_bytes(),self.raw)
        # Old backups without library tables rebuild only the restored project's metadata.
        with zipfile.ZipFile(archive) as z:contents={name:z.read(name) for name in z.namelist()}
        data=json.loads(contents['project-data.json'])
        for name in ('photo_fingerprint','project_photo','project_photo_link','photo_tag','photo_tagging'):data['tables'].pop(name)
        contents['project-data.json']=json.dumps(data).encode();manifest=json.loads(contents['backup-manifest.json']);manifest['files']['project-data.json']={'sha256':hashlib.sha256(contents['project-data.json']).hexdigest(),'bytes':len(contents['project-data.json'])};contents['backup-manifest.json']=json.dumps(manifest).encode()
        old=self.root/'legacy.zip'
        with zipfile.ZipFile(old,'w') as z:
            for name,raw in contents.items():z.writestr(name,raw)
        project_backups.restore(old,b.db,self.root,1)
        restored=self.client.get('/api/photos').json['photos'];self.assertEqual(len(restored),2);legacy=next(x for x in restored if x['document_id']==did);self.assertEqual(len(legacy['links']),1)

    def test_optional_compression_keeps_orientation_and_only_stores_selected_version(self):
        image=Image.new('RGB',(4000,3000),'#356047');exif=Image.Exif();exif[274]=6;exif[34665]={36867:'2026:11:26 12:30:00'}
        stream=BytesIO();image.save(stream,format='JPEG',quality=95,exif=exif);raw=stream.getvalue()
        note=b.ProjectWork(kind='note',title='Direktupload',body='Text');b.db.session.add(note);b.db.session.commit()
        response=self.client.post('/api/photos',data={'files':(BytesIO(raw),'Kamera.jpg'),'compression':'compact','source_type':'work','source_id':str(note.id)})
        self.assertEqual(response.status_code,201,response.json);p=response.json['photos'][0];summary=response.json['upload_summary']
        self.assertEqual(p['taken_on'],'2026-11-26');self.assertEqual(summary['optimized_count'],1);self.assertLess(summary['stored_bytes'],summary['input_bytes']);self.assertEqual(p['links'][0]['id'],note.id)
        doc=b.db.session.get(b.ProjectDocument,p['document_id']);stored=(self.store/doc.stored_name).read_bytes()
        with Image.open(BytesIO(stored)) as optimized:
            self.assertEqual(optimized.format,'WEBP');self.assertEqual(optimized.size,(1920,2560))
        self.assertEqual(len(list(self.store.iterdir())),1,'No second full-size original is stored for a compressed upload')
        self.assertEqual(doc.original_name,'Kamera.webp')
        self.assertEqual(self.client.get('/api/photos/'+str(p['id'])).json['photo']['taken_on'],'2026-11-26')
        rejected=self.client.patch('/api/photos/'+str(p['id']),json=dict(revision=p['revision'],title=p['title'],description='',tags=[],taken_on='2001-01-01'))
        self.assertEqual(rejected.status_code,400);self.assertEqual(self.client.get('/api/photos/'+str(p['id'])).json['photo']['taken_on'],'2026-11-26')
        # Historic manual entries remain stored, but do not replace the EXIF date.
        legacy=b.db.session.get(b.ProjectPhoto,p['id']);legacy.taken_on='2000-01-01';b.db.session.commit()
        self.assertEqual(self.client.get('/api/photos/'+str(p['id'])).json['photo']['taken_on'],'2026-11-26')
        self.assertEqual(b.db.session.get(b.ProjectPhoto,p['id']).taken_on,'2000-01-01')

        original=self.client.post('/api/photos',data={'files':(BytesIO(raw),'Original.jpg'),'compression':'original'})
        self.assertEqual(original.status_code,201,original.json);doc=b.db.session.get(b.ProjectDocument,original.json['photos'][0]['document_id'])
        self.assertEqual(original.json['photos'][0]['id'],p['id']);self.assertEqual(original.json['files'][0]['status'],'duplicate')
        self.assertEqual(doc.extension,'.webp');self.assertEqual(len(list(self.store.iterdir())),1)
        backups=self.root/'backups';backups.mkdir();archive=project_backups.create(b.db,self.root,1,dict(folder=str(backups),keep=5))
        project_backups.restore(archive,b.db,self.root,1)
        again=self.client.post('/api/photos',data={'files':(BytesIO(raw),'Nach Restore.jpg')})
        self.assertEqual(again.json['files'][0]['status'],'duplicate');self.assertEqual(again.json['photos'][0]['id'],p['id'])
        invalid=self.client.post('/api/photos',data={'files':(BytesIO(raw),'Fehler.jpg'),'compression':'unknown'})
        self.assertEqual(invalid.status_code,400);self.assertEqual(len(list(self.store.iterdir())),1)

    def test_heic_upload_metadata_is_atomic_and_duplicate_upload_merges_without_losing_links(self):
        raw=(Path(__file__).parent/'fixtures'/'project-photo.heic').read_bytes()
        work=b.ProjectWork(kind='note',title='Notiz',body='Text');journal=b.CompanionRecord(kind='journal',title='Bautagebuch',data_json='{}')
        b.db.session.add_all([work,journal]);b.db.session.commit();wid,jid=work.id,journal.id
        sources=[dict(source_type='work',source_id=wid),dict(source_type='companion',source_id=jid)]
        metadata=dict(tags=json.dumps(['Rohbau','Vorher']),sources=json.dumps(sources),compression='original')
        response=self.client.post('/api/photos',data={**metadata,'files':(BytesIO(raw),'Baufortschritt.heic')})
        self.assertEqual(response.status_code,201,response.json);p=response.json['photos'][0]
        self.assertEqual({x['name'] for x in p['tags']},{'Rohbau','Vorher'});self.assertEqual(len(p['links']),2)
        doc=b.db.session.get(b.ProjectDocument,p['document_id']);self.assertEqual((self.store/doc.stored_name).read_bytes(),raw);self.assertEqual(doc.extension,'.heic')
        self.assertTrue(self.client.get('/api/photos/formats').json['heic_available'])
        self.assertEqual(self.client.get('/api/photos/'+str(p['id'])+'/image').status_code,200)
        self.assertEqual(self.client.get('/api/project-documents/'+str(doc.id)+'/preview').status_code,200)
        self.assertEqual(self.client.get('/api/project-documents/'+str(doc.id)+'/versions/1/preview').status_code,200)
        duplicate=self.client.post('/api/photos',data={'files':(BytesIO(raw),'Nochmals.heic'),'tags':json.dumps(['Nachher']),'sources':'[]'})
        self.assertEqual(duplicate.status_code,201,duplicate.json);again=duplicate.json['photos'][0];self.assertEqual(again['id'],p['id']);self.assertEqual(len(again['links']),2);self.assertEqual({x['name'] for x in again['tags']},{'Vorher','Rohbau','Nachher'})
        self.assertNotEqual(again['revision'],p['revision'])
        failed=self.client.post('/api/photos',data={'files':(BytesIO(self.raw),'Nicht speichern.png'),'tags':json.dumps(['Soll nicht entstehen']),'sources':json.dumps([sources[0],dict(source_type='work',source_id=999999)])})
        self.assertEqual(failed.status_code,400);self.assertEqual(len(self.client.get('/api/photos').json['photos']),1);self.assertEqual(len(list(self.store.iterdir())),1)
        self.assertNotIn('Soll nicht entstehen',{x['name'] for x in self.client.get('/api/photo-tags').json['tags']})
        backups=self.root/'backups';backups.mkdir();archive=project_backups.create(b.db,self.root,1,dict(folder=str(backups),keep=5))
        with zipfile.ZipFile(archive) as z:self.assertEqual(z.read('private/project-documents/'+doc.stored_name),raw)
        project_backups.restore(archive,b.db,self.root,1);self.assertEqual(len(self.client.get('/api/photos').json['photos'][0]['links']),2)

    def test_multiframe_originals_are_retained_when_compression_is_selected(self):
        for fmt,ext in [('GIF','.gif'),('TIFF','.tiff'),('PNG','.png'),('MPO','.JPG')]:
            with self.subTest(format=fmt):
                output=BytesIO();Image.new('RGB',(32,24),'red').save(output,format=fmt,save_all=True,append_images=[Image.new('RGB',(32,24),'blue')],duration=100)
                raw=output.getvalue()
                response=self.client.post('/api/photos',data={'files':(BytesIO(raw),'Mehrere'+ext),'compression':'compact'})
                self.assertEqual(response.status_code,201,response.json);self.assertEqual(response.json['upload_summary']['multi_frame_count'],1)
                doc=b.db.session.get(b.ProjectDocument,response.json['photos'][0]['document_id'])
                self.assertEqual((self.store/doc.stored_name).read_bytes(),raw)
                self.assertEqual(self.client.get('/api/photos/'+str(response.json['photos'][0]['id'])+'/image').status_code,200)
                if fmt=='MPO':
                    self.assertEqual(response.json['files'][0]['format'],'MPO')
                    self.assertEqual(doc.original_name,'Mehrere.JPG')
                    with Image.open(self.store/doc.stored_name) as saved:
                        self.assertEqual(saved.n_frames,2);saved.seek(1);saved.load()
                    repeated=self.client.post('/api/photos',data={'files':(BytesIO(raw),'IMG_0451.JPG')})
                    self.assertEqual(repeated.json['files'][0]['status'],'duplicate')
                    self.assertEqual(repeated.json['photos'][0]['id'],response.json['photos'][0]['id'])

    def test_capture_dates_come_from_original_metadata_including_compressed_heic(self):
        exif=Image.Exif();exif[34665]={36867:'2024:09:08 14:30:00',36868:'2025:01:01 00:00:00',36881:'+02:00'}
        raw=BytesIO();Image.new('RGB',(96,72),'#719452').save(raw,format='HEIF',quality=95,exif=exif)
        response=self.client.post('/api/photos',data={'files':(BytesIO(raw.getvalue()),'Datum.heic'),'compression':'compact'})
        self.assertEqual(response.status_code,201,response.json);self.assertEqual(response.json['photos'][0]['taken_on'],'2024-09-08')
        # Metadata-free images never borrow an upload or file-modification date.
        missing=self.upload();self.assertEqual(missing['taken_on'],'')
        invalid=Image.Exif();invalid[34665]={36867:'0000:00:00 00:00:00'};out=BytesIO();Image.new('RGB',(16,16),'red').save(out,format='JPEG',exif=invalid)
        result=self.client.post('/api/photos',data={'files':(BytesIO(out.getvalue()),'Unbekannt.jpg')})
        self.assertEqual(result.status_code,201,result.json);self.assertEqual(result.json['photos'][0]['taken_on'],'')

    def test_bulk_tags_and_room_links_are_atomic_scoped_and_preserve_originals(self):
        note=b.ProjectWork(kind='note',title='Geteilte Notiz',body='Text')
        room=b.CompanionRecord(kind='room',title='Küche',data_json=json.dumps({'geometry':{'width':4000,'height':3000,'roomShape':'rectangle'},'document_ids':[]}))
        journal=b.CompanionRecord(kind='journal',title='Bestehende Zuordnung',data_json='{}')
        b.db.session.add_all([note,room,journal]);b.db.session.commit();wid,rid,jid=note.id,room.id,journal.id
        photos=[]
        for name in ('late','early'):
            raw=(Path(__file__).parent/'fixtures'/('room-progress-'+name+'.jpg')).read_bytes()
            result=self.client.post('/api/photos',data={'files':(BytesIO(raw),name+'.jpg'),'tags':json.dumps(['Alt'])})
            self.assertEqual(result.status_code,201,result.json);photos.append(result.json['photos'][0])
        ids=[p['id'] for p in photos];self.action(ids[0],('companion',jid))
        originals={p.name:p.read_bytes() for p in self.store.iterdir()}
        payload=dict(photo_ids=ids,add_tags=['Neu'],add_sources=[dict(source_type='companion',source_id=rid),dict(source_type='work',source_id=wid)])
        result=self.client.post('/api/photos/bulk',json=payload);self.assertEqual(result.status_code,200,result.json);self.assertEqual(result.json['changed'],2)
        for item in self.client.get('/api/photos').json['photos']:
            self.assertEqual({t['name'] for t in item['tags']},{'Alt','Neu'})
            self.assertTrue(any(l['type']=='companion' and l['id']==rid and l['kind']=='room' for l in item['links']))
            self.assertTrue(any(l['type']=='work' and l['id']==wid for l in item['links']))
        result=self.client.post('/api/photos/bulk',json=payload);self.assertEqual(result.json['changed'],0,'Re-applying an additive action is idempotent')
        removal=self.client.post('/api/photos/bulk',json=dict(photo_ids=ids,remove_tags=['alt'],remove_sources=[dict(source_type='companion',source_id=rid)]))
        self.assertEqual(removal.status_code,200,removal.json)
        current=self.client.get('/api/photos').json
        for item in current['photos']:
            self.assertEqual({t['name'] for t in item['tags']},{'Neu'})
            self.assertFalse(any(l['type']=='companion' and l['id']==rid for l in item['links']))
            self.assertTrue(any(l['type']=='work' and l['id']==wid for l in item['links']))
        self.assertTrue(any(l['type']=='companion' and l['id']==jid for p in current['photos'] if p['id']==ids[0] for l in p['links']))
        self.assertEqual({p.name:p.read_bytes() for p in self.store.iterdir()},originals)
        self.assertEqual({p['id']:p['taken_on'] for p in current['photos']},{p['id']:p['taken_on'] for p in photos})
        # Foreign IDs or deleted targets abort the entire selection, including new tags.
        other=self.client.post('/api/projects',json={'title':'Fremdes Projekt'}).json['project']['id']
        foreign=self.client.post('/api/photos',headers={'X-PHB-Project':str(other)},data={'files':(BytesIO(self.raw),'Fremdes Foto.png')}).json['photos'][0]
        failed=self.client.post('/api/photos/bulk',json=dict(photo_ids=[ids[0],foreign['id']],add_tags=['Nicht speichern']))
        self.assertEqual(failed.status_code,400);self.assertEqual(self.client.get('/api/photos').json,current)
        failed=self.client.post('/api/photos/bulk',json=dict(photo_ids=ids,add_tags=['Nicht speichern'],add_sources=[dict(source_type='work',source_id=wid),dict(source_type='companion',source_id=999999)]))
        self.assertEqual(failed.status_code,400);self.assertEqual(self.client.get('/api/photos').json,current)
        self.assertNotIn('Nicht speichern',{t['name'] for t in self.client.get('/api/photo-tags').json['tags']})
        self.assertEqual(self.client.post('/api/photos/bulk',json=dict(photo_ids=ids,taken_on='2001-01-01')).status_code,400)

    def test_mixed_batch_duplicates_decoder_errors_and_project_isolation(self):
        import photos
        from photo_formats import supported_formats
        heic=(Path(__file__).parent/'fixtures'/'project-photo.heic').read_bytes()
        available=[row for row in supported_formats() if row['name']!='HEIF']
        with patch.object(photos,'supported_formats',return_value=available),patch('photo_formats.supported_formats',return_value=available):
            response=self.client.post('/api/photos',data={'files':[(BytesIO(self.raw),'Erstes.png'),(BytesIO(heic),'Handy.heic'),(BytesIO(self.raw),'Kopie.png'),(BytesIO(b''),'Leer.png')]})
        self.assertEqual(response.status_code,201,response.json)
        report=response.json['files'];self.assertEqual([x['status'] for x in report],['created','skipped','duplicate','skipped'])
        self.assertEqual(report[1]['filename'],'Handy.heic');self.assertEqual(report[1]['error_code'],'decoder_unavailable');self.assertEqual(report[1]['format'],'HEIC / HEIF')
        self.assertEqual(report[3]['error_code'],'empty_file');self.assertEqual(len(list(self.store.iterdir())),1)
        all_bad=self.client.post('/api/photos',data={'files':(BytesIO(b'not a picture'),'Falsch.heic'),'tags':json.dumps(['Nicht anlegen'])})
        self.assertEqual(all_bad.status_code,200,all_bad.json);self.assertEqual(all_bad.json['photos'],[])
        self.assertEqual(all_bad.json['files'][0]['error_code'],'unreadable_image')
        self.assertEqual(self.client.get('/api/photo-tags').json['tags'],[])
        # Original first, then compression: one photo in this project.
        repeat=self.client.post('/api/photos',data={'files':(BytesIO(self.raw),'Kompakt.png'),'compression':'compact'})
        self.assertEqual(repeat.json['files'][0]['status'],'duplicate');self.assertEqual(len(list(self.store.iterdir())),1)
        other=self.client.post('/api/projects',json={'title':'Eigenständiges Projekt'}).json['project']['id']
        foreign=self.client.post('/api/photos',headers={'X-PHB-Project':str(other)},data={'files':(BytesIO(self.raw),'Eigenes.png')})
        self.assertEqual(foreign.status_code,201,foreign.json);self.assertEqual(foreign.json['files'][0]['status'],'created')
        self.assertNotEqual(foreign.json['photos'][0]['id'],repeat.json['photos'][0]['id'])
