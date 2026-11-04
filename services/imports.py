"""Imports services. Dependencies are supplied by the application composition root.

Original entry points stay exported on runtime for CLI integrations and tests.
No imports of app.py and no implicit application context are required.
"""
from types import ModuleType

def register(runtime: ModuleType):
    def _import_json(job):
        return {'project_id': job.project_id, 'id': job.id, 'batch_id': job.batch_id, 'kind': job.kind, 'filename': job.filename, 'analysis_mode': job.analysis_mode, 'status': job.status, 'stage': job.stage, 'error': job.error, 'result_id': job.result_id, 'created_at': job.created_at.isoformat() if job.created_at else '', 'updated_at': job.updated_at.isoformat() if job.updated_at else '', 'finished_at': job.finished_at.isoformat() if job.finished_at else ''}

    runtime._import_json = _import_json

    def _mark_import_reviewed(kind, result_id):
        """Retain audited job history, remove reviewed items from active queue."""
        for job in runtime.db.session.scalars(runtime.select(runtime.ImportJob).where(runtime.ImportJob.kind == kind, runtime.ImportJob.result_id == result_id, runtime.ImportJob.status == 'Fertig')):
            job.status = 'Übernommen'
            job.stage = 'Fachlich geprüft und übernommen'
            job.updated_at = runtime.datetime.utcnow()

    runtime._mark_import_reviewed = _mark_import_reviewed

    def _forget_import_job(job):
        job.result_id = None
        job.status = 'Ausgeblendet'
        job.stage = 'Importiertes Dokument oder Entwurf wurde gelöscht'
        job.updated_at = runtime.datetime.utcnow()

    def _forget_import_result(kind, result_id):
        """Unlink deleted results atomically with deletion, retaining import history."""
        for job in runtime.db.session.scalars(runtime.select(runtime.ImportJob).where(
                runtime.ImportJob.kind == kind, runtime.ImportJob.result_id == result_id,
                runtime.ImportJob.status.notin_(['Wartend', 'Läuft']))):
            _forget_import_job(job)

    runtime._forget_import_result = _forget_import_result

    def _sync_import_reviews():
        """Detect final business decisions even if they were made elsewhere."""
        for job in runtime.db.session.scalars(runtime.select(runtime.ImportJob).where(runtime.ImportJob.status == 'Fertig')).all():
            if job.result_id is None:
                _forget_import_job(job)
                continue
            missing = False
            if job.kind == 'offers':
                offer = runtime.db.session.get(runtime.Offer, job.result_id)
                missing = offer is None
                reviewed = offer is not None and offer.status != 'Entwurf'
            elif job.kind == 'receipts':
                receipt = runtime.db.session.get(runtime.Receipt, job.result_id)
                missing = receipt is None
                reviewed = receipt is not None and receipt.status == 'Gebucht'
            elif job.kind == 'versions':
                meta = runtime.json.loads(job.extra_json or '{}')
                number = meta.get('version_number')
                version = runtime.db.session.scalar(runtime.select(runtime.OfferVersion).where(runtime.OfferVersion.offer_id == job.result_id, runtime.OfferVersion.version_number == number)) if number else None
                missing = runtime.db.session.get(runtime.Offer, job.result_id) is None or bool(number and version is None)
                reviewed = version is not None and version.state != 'draft'
            elif job.kind == 'documents':
                missing = runtime.db.session.get(runtime.ProjectDocument, job.result_id) is None
                reviewed = False
            elif job.kind == 'loans':
                meta = runtime.json.loads(job.extra_json or '{}')
                missing = bool(meta.get('loan_id') and runtime.db.session.get(runtime.Loan, meta['loan_id']) is None)
                reviewed = bool(meta.get('saved'))
            else:
                reviewed = False
            if job.kind == 'costplans':
                plan = runtime.db.session.get(runtime.CostPlanImport, job.result_id)
                missing = plan is None
                reviewed = plan is not None and plan.status == 'Übernommen'
            if missing:
                _forget_import_job(job)
            elif reviewed:
                job.status = 'Übernommen'
                job.stage = 'Fachlich geprüft und übernommen'
                job.updated_at = runtime.datetime.utcnow()
        runtime.db.session.commit()

    runtime._sync_import_reviews = _sync_import_reviews

    def _import_result(job):
        if job.result_id is None:
            return None
        if job.kind == 'documents':
            meta = runtime.json.loads(job.extra_json or '{}')
            if meta.get('review_context') == 'funding':
                result = '/energieplanung?funding_document=' + str(job.result_id)
                if meta.get('funding_id'):
                    result += '&document_funding_id=' + str(meta['funding_id'])
                return result
        prefix = {'costplans': '/kosten?cost_plan_import=', 'offers': '/angebote?offer_draft=', 'versions': '/angebote?offer_draft=', 'receipts': '/belege?receipt_id=', 'documents': '/dokumente?document_id=', 'loans': '/finanzierung?loan_scan=', 'schedules': '/?schedule_job='}[job.kind]
        return prefix + str(job.result_id)

    runtime._import_result = _import_result

    @runtime.app.get('/api/import-jobs/<int:job_id>/loan-review')
    def loan_import_review(job_id):
        job = runtime.db.session.get(runtime.ImportJob, job_id)
        if not job or job.kind != 'loans':
            return (runtime.jsonify(error='Kreditanalyse nicht gefunden.'), 404)
        if job.status not in ('Fertig', 'Übernommen', 'Ausgeblendet') or not job.result_id:
            return (runtime.jsonify(error='Die Kreditanalyse ist noch nicht erfolgreich abgeschlossen.'), 409)
        meta = runtime.json.loads(job.extra_json or '{}')
        if meta.get('loan_id') and runtime.db.session.get(runtime.Loan, meta['loan_id']) is None:
            return (runtime.jsonify(error='Der zugehörige Kredit wurde gelöscht. Vorschläge können nicht mehr darauf angewendet werden.'), 409)
        return runtime.jsonify(**meta.get('analysis', {}), loan_id=meta.get('loan_id'), values=meta.get('values', {}), overwrite=meta.get('overwrite', False), reviewed=meta.get('saved', False))

    runtime.loan_import_review = loan_import_review

    def _finish_loan_scan(job_id, loan_id):
        try:
            job = runtime.db.session.get(runtime.ImportJob, int(job_id))
        except (ValueError, TypeError):
            raise ValueError('Ungültige Kreditanalyse.') from None
        if not job or job.kind != 'loans' or job.status not in ('Fertig', 'Ausgeblendet'):
            raise ValueError('Die Kreditanalyse ist nicht zur Übernahme verfügbar.')
        target = runtime.json.loads(job.extra_json or '{}').get('loan_id')
        if target and target != loan_id:
            raise ValueError('Die Kreditanalyse gehört zu einem anderen Kredit.')
        job.status = 'Übernommen'
        job.stage = 'Vertragsdaten geprüft und gespeichert'
        job.updated_at = runtime.datetime.utcnow()
        meta = runtime.json.loads(job.extra_json or '{}')
        meta.update(loan_id=loan_id, saved=True)
        job.extra_json = runtime.json.dumps(meta, ensure_ascii=False)

    runtime._finish_loan_scan = _finish_loan_scan

    def _run_import_job(job_id):
        with runtime.app.app_context():
            with runtime.all_projects():
                job = runtime.db.session.get(runtime.ImportJob, job_id)
            if job is None:
                return
            with runtime.project_context(job.project_id):
                return runtime._run_project_import_job(job_id)

    runtime._run_import_job = _run_import_job

    def _run_project_import_job(job_id):
        with runtime.app.app_context():
            job = runtime.db.session.get(runtime.ImportJob, job_id)
            if not job or job.status != 'Wartend':
                return
            from job_leases import claim, Heartbeat
            token = claim(runtime.db, runtime.ImportJob, job_id)
            if not token:
                return
            heartbeat = Heartbeat(runtime.app, runtime.db, runtime.ImportJob, job_id, job.project_id, token)
            runtime.db.session.info['phb_import_lease']=(job_id,job.project_id,token)
            job = runtime.db.session.get(runtime.ImportJob, job_id)
            job.status = 'Läuft'
            job.stage = 'Beleg wird ohne Analyse abgelegt …' if job.analysis_mode == 'none' else 'ChatGPT analysiert die Datei …' if job.analysis_mode == 'ai' else 'Datei wird lokal eingelesen …'
            job.updated_at = runtime.datetime.utcnow()
            runtime.db.session.commit()
            filename = job.filename
            job_type = job.kind
            mode = job.analysis_mode
            ai_model = job.model
            meta = runtime.json.loads(job.extra_json or '{}')
            source = runtime.IMPORT_QUEUE_ROOT / job.stored_name
            try:

                def update_stage(message):
                    item = runtime.db.session.get(runtime.ImportJob, job_id)
                    if item:
                        item.stage = message[:250]
                        item.updated_at = runtime.datetime.utcnow()
                        runtime.db.session.commit()
                runtime.ai_background_hooks.progress = update_stage
                if job_type == 'schedules':
                    update_stage('ChatGPT erstellt Bauphasen und Arbeitspakete …')
                    try:
                        info = runtime.json.loads(source.read_text(encoding='utf-8'))
                    except (OSError, ValueError) as exc:
                        raise ValueError('Planungsgrundlage konnte nicht gelesen werden.') from exc
                    proposal = runtime._generate_initial_schedule(info, ai_model)
                    job = runtime.db.session.get(runtime.ImportJob, job_id)
                    meta['analysis'] = proposal
                    job.extra_json = runtime.json.dumps(meta, ensure_ascii=False)
                    job.result_id = job.id
                    job.status = 'Fertig'
                    job.stage = 'Planvorschlag erstellt – bitte Bauphasen und Arbeitspakete prüfen'
                    job.error = ''
                    job.finished_at = runtime.datetime.utcnow()
                    job.updated_at = runtime.datetime.utcnow()
                    runtime.db.session.commit()
                    source.unlink(missing_ok=True)
                    return
                raw = source.read_bytes()
                fields = {'file': (runtime.io.BytesIO(raw), filename)}
                if job_type=='receipts' and meta.get('receipt_kind'):fields['receipt_kind']=meta['receipt_kind']
                if job_type=='receipts' and meta.get('self_work_id'):fields['self_work_id']=str(meta['self_work_id'])
                if job_type in ('offers', 'versions', 'receipts', 'costplans', 'loans'):
                    fields.update(analysis_mode=mode, model=ai_model, plan_only='true')
                else:
                    fields.update(meta)
                    fields.setdefault('title', runtime.Path(filename).stem[:200])
                endpoint = 'offers/' + str(meta['offer_id']) + '/versions' if job_type == 'versions' else {'costplans': 'cost-plan-imports', 'offers': 'offers/import', 'receipts': 'receipts', 'documents': 'project-documents', 'loans': 'financing/loans/ai/extract'}[job_type]
                with runtime.app.test_request_context('/api/' + endpoint, method='POST', data=fields, headers={'X-PHB-AI': '1'} if mode == 'ai' else {}, environ_base={'REMOTE_ADDR': '127.0.0.1'}, base_url='http://127.0.0.1:5055'):
                    result = {'costplans': lambda: runtime.cost_plan_upload(), 'offers': lambda: runtime.offers_import(), 'versions': lambda: runtime.upload_offer_version(meta['offer_id']), 'receipts': lambda: runtime.receipt_upload(), 'documents': lambda: runtime.project_document_upload(), 'loans': lambda: runtime.app.view_functions['loan_ai_extract']()}[job_type]()
                    if isinstance(result, tuple):
                        response, status_code = (result[0], result[1])
                    else:
                        response, status_code = (result, 200)
                    payload = response.get_json() or {}
                if status_code >= 400:
                    raise ValueError(str(payload.get('error', 'Import fehlgeschlagen'))[:450])
                result_id = job_id if job_type == 'loans' else payload.get('document', {}).get('id') if job_type == 'documents' else payload.get('offer_id') if job_type == 'versions' else payload.get('id')
                if not result_id:
                    raise ValueError('Server hat keinen gespeicherten Entwurf zurückgegeben.')
                job = runtime.db.session.get(runtime.ImportJob, job_id)
                job.result_id = int(result_id)
                if job_type == 'loans':
                    meta['analysis'] = payload
                    job.extra_json = runtime.json.dumps(meta, ensure_ascii=False)
                if job_type == 'versions':
                    meta['version_number'] = payload.get('version', {}).get('version')
                    job.extra_json = runtime.json.dumps(meta, ensure_ascii=False)
                job.status = 'Fertig'
                job.stage = 'Entwurf ohne Analyse gespeichert – Angaben später ergänzen' if mode == 'none' else 'Entwurf angelegt – bitte Daten prüfen'
                job.error = ''
                job.finished_at = runtime.datetime.utcnow()
                job.updated_at = runtime.datetime.utcnow()
                runtime.db.session.commit()
                source.unlink(missing_ok=True)
            except Exception as exc:
                trace = __import__('traceback').extract_tb(exc.__traceback__)
                where = trace[-1].name + ':' + str(trace[-1].lineno) if trace else 'unknown'
                runtime.app.logger.warning('Background import %s failed: %s at %s', job_id, type(exc).__name__, where)
                runtime.db.session.rollback()
                job = runtime.db.session.get(runtime.ImportJob, job_id)
                if job and job.status=='Läuft' and job.lease_owner==token:
                    job.status = 'Fehler'
                    job.stage = 'Analyse oder Speicherung fehlgeschlagen'
                    job.error = str(exc)[:450] if isinstance(exc, (ValueError, runtime.AIError)) else 'Importfehler (' + type(exc).__name__ + ' bei ' + where + '). Bitte erneut versuchen.'
                    job.finished_at = runtime.datetime.utcnow()
                    job.updated_at = runtime.datetime.utcnow()
                    runtime.db.session.commit()
            finally:
                heartbeat.close()
                runtime.db.session.info.pop('phb_import_lease',None)
                runtime.ai_background_hooks.progress = None
                runtime.db.session.remove()

    runtime._run_project_import_job = _run_project_import_job

    def _import_worker():
        next_recovery=0
        while True:
            local = True
            try:
                ident = runtime._import_queue.get(timeout=2)
            except runtime.Empty:
                local = False
                with runtime.app.app_context(), runtime.all_projects():
                    if runtime.time.monotonic()>=next_recovery:
                        runtime._recover_interrupted_imports()
                        next_recovery=runtime.time.monotonic()+30
                    ident = runtime.db.session.scalar(runtime.select(runtime.ImportJob.id).where(runtime.ImportJob.status == 'Wartend').order_by(runtime.ImportJob.id).limit(1))
                if ident is None:
                    continue
            try:
                runtime._run_import_job(ident)
            except Exception:
                runtime.app.logger.exception('Import job unexpectedly failed: %s', ident)
            finally:
                if local:
                    runtime._import_queue.task_done()

    runtime._import_worker = _import_worker

    def _start_import_worker():
        with runtime._import_guard:
            if runtime._import_thread is None or not runtime._import_thread.is_alive():
                runtime._import_thread = runtime.Thread(target=runtime._import_worker, name='phb-sequential-imports', daemon=True)
                runtime._import_thread.start()

    runtime._start_import_worker = _start_import_worker

    @runtime.app.post('/api/import-jobs')
    def enqueue_import_jobs():
        runtime._ensure_import_recovery()
        kind = runtime.request.form.get('kind', '')
        if kind not in runtime._ALLOWED_IMPORTS:
            return (runtime.jsonify(error='Unbekannter Dokumenttyp.'), 400)
        mode = runtime.request.form.get('analysis_mode', 'local')
        if mode not in ('ai', 'local', 'none') or (mode == 'none' and kind != 'receipts') or (kind == 'documents' and mode != 'local'):
            return (runtime.jsonify(error='Unbekannte Analyseart.'), 400)
        if kind == 'loans' and mode != 'ai':
            return (runtime.jsonify(error='Kreditunterlagen werden mit ChatGPT analysiert.'), 400)
        model = runtime.request.form.get('model', '')
        if mode == 'ai':
            runtime._ai_request_required()
            if not isinstance(model, str) or not model.strip() or len(model) > 100:
                return (runtime.jsonify(error='Bitte ChatGPT-Modell auswählen.'), 400)
        files = runtime.request.files.getlist('files')
        if not 1 <= len(files) <= runtime._MAX_IMPORT_COUNT:
            return (runtime.jsonify(error='Bitte eine bis acht Dateien auswählen.'), 400)
        staged = []
        runtime.IMPORT_QUEUE_ROOT.mkdir(parents=True, exist_ok=True)
        try:
            for file in files:
                filename = runtime.Path(file.filename or '').name[:240]
                extension = runtime.Path(filename).suffix.lower()
                if extension not in runtime._ALLOWED_IMPORTS[kind]:
                    raise ValueError('Nicht unterstützte Datei: ' + filename)
                data = file.read()
                if not data:
                    raise ValueError('Datei leer: ' + filename)
                if extension == '.pdf' and (not data.startswith(b'%PDF-')):
                    raise ValueError('PDF-Signatur ungültig: ' + filename)
                stored = runtime.uuid4().hex + extension
                path = runtime.IMPORT_QUEUE_ROOT / stored
                path.write_bytes(data)
                staged.append((filename, stored))
            meta = {}
            if kind=='receipts' and runtime.request.form.get('receipt_kind'):
                receipt_kind=runtime.request.form['receipt_kind']
                if receipt_kind not in ('Rechnung','Kassenzettel'):raise ValueError('Unbekannte Belegart für den Upload.')
                meta['receipt_kind']=receipt_kind
            if kind=='receipts' and runtime.request.form.get('self_work_id'):
                ident=runtime.request.form['self_work_id']
                if not ident.isdigit() or runtime.db.session.get(runtime.SelfWorkPlan,int(ident)) is None:
                    raise ValueError('Zugehörige Eigenleistung nicht gefunden.')
                meta['self_work_id']=int(ident)
            if kind == 'loans':
                if len(files) != 1:
                    raise ValueError('Pro Kreditanalyse genau eine Unterlage auswählen.')
                target = runtime.request.form.get('loan_id', '')
                loan_id = int(target) if target else None
                if loan_id is not None and (loan_id < 1 or runtime.db.session.get(runtime.Loan, loan_id) is None):
                    raise ValueError('Kredit für diese Analyse nicht gefunden.')
                raw = runtime.request.form.get('loan_values', '{}')
                if len(raw) > 10000:
                    raise ValueError('Zu viele Vertragsdaten.')
                values = runtime.json.loads(raw)
                allowed = {'name', 'bank', 'reference', 'principal', 'interest_rate', 'monthly_payment', 'initial_repayment_rate', 'extra_repayment_pct', 'contract_date', 'fixed_until', 'interest_free_until', 'commitment_interest_rate', 'notes'}
                if not isinstance(values, dict) or any((k not in allowed or not isinstance(v, (str, int, float, type(None))) for k, v in values.items())):
                    raise ValueError('Ungültige Vertragsdaten.')
                meta.update(loan_id=loan_id, values=values, overwrite=runtime.request.form.get('overwrite') == 'true')
            if kind == 'versions':
                try:
                    offer_id = int(runtime.request.form.get('offer_id', ''))
                except (ValueError, TypeError):
                    raise ValueError('Angebot für neue Version auswählen.')
                if offer_id < 1 or runtime.db.session.get(runtime.Offer, offer_id) is None:
                    raise ValueError('Angebot für diese Version nicht gefunden.')
                if len(files) != 1:
                    raise ValueError('Pro Angebotsversion genau ein PDF auswählen.')
                meta['offer_id'] = offer_id
            if kind == 'documents':
                context = runtime.request.form.get('review_context', '')
                if context not in ('', 'funding'):
                    raise ValueError('Unbekannter Dokumentbereich.')
                if context == 'funding':
                    meta['review_context'] = 'funding'
                    meta['area'] = 'Energetische Planung'
                    target = runtime.request.form.get('funding_id', '')
                    if target:
                        if not target.isdigit() or runtime.db.session.get(runtime.Funding, int(target)) is None:
                            raise ValueError('Zugehörige Förderung nicht gefunden.')
                        meta['funding_id'] = int(target)
                for key in ('title', 'category', 'area', 'status', 'tags', 'description'):
                    if key in runtime.request.form:
                        meta[key] = runtime.request.form[key][:1500]
                if context == 'funding':
                    meta['area'] = 'Energetische Planung'
                if len(files) > 1:
                    meta.pop('title', None)
            batch = runtime.uuid4().hex
            jobs = []
            for filename, stored in staged:
                job = runtime.ImportJob(lease_owner='queued', batch_id=batch, kind=kind, filename=filename, stored_name=stored, analysis_mode=mode, model=model if mode == 'ai' else '', extra_json=runtime.json.dumps(meta, ensure_ascii=False), stage='Wartet auf die sequenzielle Verarbeitung')
                runtime.db.session.add(job)
                jobs.append(job)
            runtime.db.session.commit()
            result = [runtime._import_json(job) for job in jobs]
        except (ValueError, OSError) as exc:
            runtime.db.session.rollback()
            for _, stored in staged:
                (runtime.IMPORT_QUEUE_ROOT / stored).unlink(missing_ok=True)
            return (runtime.jsonify(error=str(exc)), 400)
        except Exception:
            runtime.db.session.rollback()
            for _, stored in staged:
                (runtime.IMPORT_QUEUE_ROOT / stored).unlink(missing_ok=True)
            return (runtime.jsonify(error='Dateien konnten nicht in die Warteschlange gelegt werden.'), 500)
        runtime._start_import_worker()
        for job in jobs:
            runtime._import_queue.put(job.id)
        return (runtime.jsonify(jobs=result, batch_id=batch), 202)

    runtime.enqueue_import_jobs = enqueue_import_jobs

    @runtime.app.get('/api/import-jobs/batches/<batch_id>')
    def import_batch_status(batch_id):
        runtime._ensure_import_recovery()
        if len(batch_id) != 32 or any((c not in '0123456789abcdef' for c in batch_id)):
            return (runtime.jsonify(error='Ungültiger Importdurchgang.'), 400)
        runtime._sync_import_reviews()
        jobs = runtime.db.session.scalars(runtime.select(runtime.ImportJob).where(runtime.ImportJob.batch_id == batch_id).order_by(runtime.ImportJob.id)).all()
        if not jobs:
            return (runtime.jsonify(error='Importdurchgang nicht gefunden.'), 404)
        response = runtime.jsonify(jobs=[dict(runtime._import_json(j), review_url=runtime._import_result(j)) for j in jobs])
        response.headers['Cache-Control'] = 'no-store'
        return response

    runtime.import_batch_status = import_batch_status

    @runtime.app.get('/api/import-jobs')
    def list_import_jobs():
        runtime._ensure_import_recovery()
        runtime._sync_import_reviews()
        rows = runtime.db.session.scalars(runtime.select(runtime.ImportJob).where(runtime.ImportJob.status.notin_(['Übernommen', 'Ausgeblendet'])).order_by(runtime.ImportJob.id.desc()).limit(40)).all()
        response = runtime.jsonify(jobs=[{**runtime._import_json(job), 'review_url': runtime._import_result(job)} for job in rows])
        response.headers['Cache-Control'] = 'no-store'
        return response

    runtime.list_import_jobs = list_import_jobs

    def _dismissable_import(job):
        return job.status in ('Fertig', 'Fehler', 'Unterbrochen', 'Übernommen', 'Ausgeblendet')

    runtime._dismissable_import = _dismissable_import

    def _hide_imports(jobs):
        changed = 0
        for job in jobs:
            if not runtime._dismissable_import(job):
                raise ValueError('Laufende oder wartende Importe dürfen nicht entfernt werden.')
        for job in jobs:
            if job.status not in ('Ausgeblendet', 'Übernommen'):
                job.status = 'Ausgeblendet'
                job.stage = 'Benachrichtigung manuell entfernt'
                job.updated_at = runtime.datetime.utcnow()
                (runtime.IMPORT_QUEUE_ROOT / job.stored_name).unlink(missing_ok=True)
                changed += 1
        runtime.db.session.commit()
        return changed

    runtime._hide_imports = _hide_imports

    @runtime.app.post('/api/import-jobs/dismiss-completed')
    def dismiss_completed_import_jobs():
        runtime._ensure_import_recovery()
        rows = runtime.db.session.scalars(runtime.select(runtime.ImportJob).where(runtime.ImportJob.status.in_(['Fertig', 'Fehler', 'Unterbrochen']))).all()
        return runtime.jsonify(ok=True, removed=runtime._hide_imports(rows))

    runtime.dismiss_completed_import_jobs = dismiss_completed_import_jobs

    @runtime.app.post('/api/import-jobs/<int:job_id>/dismiss')
    def dismiss_import_job(job_id):
        runtime._ensure_import_recovery()
        job = runtime.db.session.get(runtime.ImportJob, job_id)
        if not job:
            return (runtime.jsonify(error='Importauftrag nicht gefunden.'), 404)
        try:
            return runtime.jsonify(ok=True, removed=runtime._hide_imports([job]))
        except ValueError as exc:
            return (runtime.jsonify(error=str(exc)), 409)

    runtime.dismiss_import_job = dismiss_import_job

    @runtime.app.post('/api/import-jobs/<int:job_id>/retry')
    def retry_import_job(job_id):
        runtime._ensure_import_recovery()
        job = runtime.db.session.get(runtime.ImportJob, job_id)
        if not job:
            return (runtime.jsonify(error='Importauftrag nicht gefunden.'), 404)
        if job.status not in ('Fehler', 'Unterbrochen'):
            return (runtime.jsonify(error='Nur fehlgeschlagene Aufträge dürfen wiederholt werden.'), 409)
        if job.analysis_mode == 'ai':
            runtime._ai_request_required()
            model = runtime.request.get_json(silent=True) or {}
            if isinstance(model.get('model'), str) and model['model']:
                job.model = model['model'][:100]
        if not (runtime.IMPORT_QUEUE_ROOT / job.stored_name).is_file():
            return (runtime.jsonify(error='Temporäre Quelldatei fehlt, bitte Datei erneut hochladen.'), 409)
        job.status = 'Wartend'
        job.lease_owner = 'queued'
        job.lease_until = None
        job.error = ''
        job.stage = 'Erneut zur Warteschlange hinzugefügt'
        job.finished_at = None
        job.updated_at = runtime.datetime.utcnow()
        runtime.db.session.commit()
        runtime._start_import_worker()
        runtime._import_queue.put(job.id)
        return (runtime.jsonify(job=runtime._import_json(job)), 202)

    runtime.retry_import_job = retry_import_job

    def _recover_project_imports():
        for job in runtime.db.session.scalars(runtime.select(runtime.ImportJob).where(runtime.ImportJob.status.in_(['Wartend', 'Läuft']))).all():
            runtime.db.session.connection().execute(runtime.select(runtime.Project.__table__.c.id).where(runtime.Project.__table__.c.id==job.project_id).with_for_update()).first()
            runtime.db.session.refresh(job)
            if job.status == 'Läuft' and job.lease_until and (job.lease_until > runtime.datetime.utcnow()):
                continue
            if job.status == 'Wartend' and job.lease_owner == 'queued':
                continue
            job.status = 'Unterbrochen'
            job.error = 'Die Anwendung wurde während des Imports beendet. Bitte erneut starten.'
            job.stage = 'Import nach Neustart unterbrochen'
            job.updated_at = runtime.datetime.utcnow()
        runtime.db.session.commit()

    runtime._recover_project_imports = _recover_project_imports

    def _recover_interrupted_imports():
        with runtime.all_projects():
            return runtime._recover_project_imports()

    runtime._recover_interrupted_imports = _recover_interrupted_imports

    def _ensure_import_recovery():
        if runtime._import_recovery_done:
            return
        with runtime._import_guard:
            if not runtime._import_recovery_done:
                runtime._recover_interrupted_imports()
                runtime._import_recovery_done = True
        runtime._start_import_worker()

    runtime._ensure_import_recovery = _ensure_import_recovery
