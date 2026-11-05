"""Offers services. Dependencies are supplied by the application composition root.

Original entry points stay exported on runtime for CLI integrations and tests.
No imports of app.py and no implicit application context are required.
"""
from types import ModuleType
from offer_diy import estimate as diy_estimate

def register(runtime: ModuleType):
    def add_parsed_offer(parsed, digest, source_document=None, category='Sonstiges'):
        """Persist a non-binding analysis draft. Its PDF is stored in private/documents."""
        if runtime.db.session.scalar(runtime.select(runtime.Offer.id).where(runtime.Offer.digest == digest)):
            raise ValueError('Dieses PDF-Angebot wurde bereits hochgeladen.')
        contractor = runtime._find_contractor(parsed['vendor']) if parsed['vendor'] != 'Firma nicht erkannt' else None
        offer = runtime.Offer(digest=digest, document_id=source_document.id if source_document else None, contractor_id=contractor.id if contractor else None, vendor=parsed['vendor'], number=parsed['number'], issued=parsed['issued'], expires=parsed['expires'], net=parsed['net'], vat=parsed['vat'], gross=parsed['gross'], tax_rate=parsed['tax_rate'], category=category, status='Entwurf', reconciled=parsed['reconciled'], warnings=runtime.json.dumps(parsed['warnings'], ensure_ascii=False), filename=parsed['filename'])
        runtime.db.session.add(offer)
        runtime.db.session.flush()
        for idx, section in enumerate(parsed['groups']):
            runtime.db.session.add(runtime.OfferSection(offer_id=offer.id, name=section['name'], net=section['net'], gross=section['gross'], sort_order=idx, selected=False))
        for entry in parsed['positions']:
            runtime.db.session.add(runtime.OfferPosition(offer_id=offer.id, **{k: entry.get(k) for k in ('number', 'section', 'description', 'quantity', 'unit', 'unit_price', 'net_amount', 'optional_amount', 'optional', 'page')}))
        return offer

    runtime.add_parsed_offer = add_parsed_offer

    def _offer_has_dependencies(item):
        if item.id is None:
            return bool(item.paid)
        return bool(item.paid or runtime.db.session.scalar(runtime.select(runtime.Document.id).where(runtime.Document.cost_item_id == item.id).limit(1)) or runtime.db.session.scalar(runtime.select(runtime.Receipt.id).where(runtime.Receipt.cost_item_id == item.id).limit(1)))

    runtime._offer_has_dependencies = _offer_has_dependencies

    def _sync_offer_costs(offer):
        """A listed quotation has zero forecast impact; acceptance books exactly one total.

        Previously accepted multi-section legacy orders are retained if they have
        payments/documents, never merged destructively.
        """
        existing = runtime.db.session.scalars(runtime.select(runtime.CostItem).where(runtime.CostItem.offer_id == offer.id).order_by(runtime.CostItem.id)).all()
        if offer.status not in ('Angenommen', 'Beauftragt'):
            for item in existing:
                if runtime._offer_has_dependencies(item):
                    raise ValueError('Das Angebot hat bereits Zahlungen oder verknüpfte Belege. Bitte zuerst prüfen.')
                runtime.db.session.delete(item)
            return
        amount = runtime._contract_gross(offer)
        if not runtime.math.isfinite(amount) or amount <= 0:
            raise ValueError('Vor Annahme muss eine positive Bruttogesamtsumme bestätigt sein.')
        line = None
        if offer.budget_line_id is not None:
            line = runtime.db.session.get(runtime.BudgetLine, offer.budget_line_id)
            if not line or not line.active or line.is_group:
                raise ValueError('Bitte eine aktive Einzelposition im Kostenplan zuordnen.')
            other = runtime.db.session.scalar(runtime.select(runtime.CostItem.id).where(runtime.CostItem.budget_line_id == line.id, runtime.CostItem.selected.is_(True), runtime.CostItem.offer_id != offer.id).limit(1))
            if other:
                raise ValueError('Diese Kostenplanposition hat bereits ein ausgewähltes Angebot.')
        if len(existing) > 1 and any((runtime._offer_has_dependencies(x) for x in existing)):
            return
        item = existing[0] if existing else runtime.CostItem(offer_id=offer.id, title='')
        for duplicate in existing[1:]:
            if runtime._offer_has_dependencies(duplicate):
                raise ValueError('Eine frühere Leistungsgruppe hat Zahlungen oder Belege.')
            runtime.db.session.delete(duplicate)
        if runtime._offer_has_dependencies(item) and (item.budget_line_id != offer.budget_line_id or abs(float(item.offer or 0) - amount) > 0.001):
            raise ValueError('Betrag oder Zuordnung eines bereits bezahlten Auftrags dürfen nicht still verändert werden.')
        item.offer_id = offer.id
        item.budget_line_id = offer.budget_line_id
        item.title = f"{offer.vendor}: Angebot {offer.number or 'ohne Nummer'}"[:300]
        item.category = line.category if line else offer.category
        item.kind = 'Fremdleistung'
        item.contractor_id = offer.contractor_id
        item.offer = amount
        item.committed = amount
        item.state = 'Beauftragt'
        item.selected = True
        item.source_ref = offer.number
        runtime.db.session.add(item)

    runtime._sync_offer_costs = _sync_offer_costs

    def _offer_snapshot(o):
        """A complete, independent copy of the quote's original data and OCR corrections."""
        result = {field: getattr(o, field) for field in runtime._OFFER_VERSION_FIELDS}
        result['positions'] = [{field: getattr(pos, field) for field in runtime._POSITION_VERSION_FIELDS} for pos in sorted(o.positions, key=lambda x: x.id or 0)]
        result['sections'] = [{field: getattr(g, field) for field in runtime._SECTION_VERSION_FIELDS} for g in sorted(o.sections, key=lambda x: x.sort_order)]
        return result

    runtime._offer_snapshot = _offer_snapshot

    def _ensure_offer_current_version(o):
        """Lazily snapshot old records on first revision, no destructive data conversion."""
        record = next((v for v in o.versions if v.state == 'current'), None)
        if record is None:
            record = runtime.OfferVersion(offer_id=o.id, version_number=o.current_version or 1, state='current', document_id=o.document_id, snapshot=runtime.json.dumps(runtime._offer_snapshot(o), ensure_ascii=False))
            runtime.db.session.add(record)
            runtime.db.session.flush()
        return record

    runtime._ensure_offer_current_version = _ensure_offer_current_version

    def _sync_current_version(o):
        for v in o.versions:
            if v.state == 'current':
                v.snapshot = runtime.json.dumps(runtime._offer_snapshot(o), ensure_ascii=False)
                v.document_id = o.document_id
                return

    runtime._sync_current_version = _sync_current_version

    def _version_json(v, full=False):
        snapshot = runtime.json.loads(v.snapshot)
        summary = {'id': v.id, 'version': v.version_number, 'state': v.state, 'created_at': v.created_at.isoformat() if v.created_at else '', 'document_id': v.document_id, 'filename': snapshot.get('filename'), 'vendor': snapshot.get('vendor'), 'number': snapshot.get('number'), 'gross': snapshot.get('gross'), 'status': snapshot.get('status')}
        if full:
            summary['snapshot'] = snapshot
        return summary

    runtime._version_json = _version_json

    def _reviewed_version_from_pdf(o, parsed, digest, document, name, category):
        """Prepare review data WITHOUT modifying the current quote or contract."""
        candidate = runtime.Offer(digest=digest, document_id=document.id, contractor_id=o.contractor_id, vendor=o.vendor, number=o.number, issued=o.issued, expires=o.expires, net=o.net, vat=o.vat, gross=o.gross, tax_rate=o.tax_rate, status='Entwurf', category=category, budget_line_id=o.budget_line_id, notes=o.notes, reconciled=False, warnings='[]', filename=name)
        guessed = {field: parsed.get(field) for field in ('vendor', 'number', 'issued', 'expires', 'gross', 'net', 'vat')}
        guesses = {k: v for k, v in guessed.items() if v not in (None, '', 'Firma nicht erkannt')}
        for amount in ('gross', 'net', 'vat'):
            if amount in guesses:
                try:
                    raw = float(guesses[amount])
                    if not runtime.math.isfinite(raw) or raw < 0:
                        raise ValueError()
                    guesses[amount] = round(raw, 2)
                except (ValueError, TypeError, OverflowError):
                    del guesses[amount]
        runtime._apply_offer_fields(candidate, guesses)
        candidate.warnings = runtime.json.dumps(parsed.get('warnings') or [], ensure_ascii=False)
        raw = parsed.get('positions') or []
        rows = []
        for i, pos in enumerate(raw[:500], 1):
            if not isinstance(pos, dict) or not str(pos.get('description') or '').strip():
                continue
            clean = {f: pos.get(f) for f in runtime._POSITION_VERSION_FIELDS}
            clean.update(number=str(pos.get('number') or i), section=str(pos.get('section') or ''), description=str(pos.get('description') or ''), unit=str(pos.get('unit') or ''), optional=bool(pos.get('optional')), own_work=False)
            for money_key in ('unit_price', 'net_amount', 'optional_amount'):
                if clean[money_key] is not None:
                    try:
                        number = float(clean[money_key])
                        clean[money_key] = round(number, 2) if runtime.math.isfinite(number) and number >= 0 else None
                    except (ValueError, TypeError, OverflowError):
                        clean[money_key] = None
            try:
                rows.extend(runtime._validated_offer_positions([clean]))
            except ValueError:
                continue
        runtime._update_draft_positions(candidate, rows)
        return runtime._offer_snapshot(candidate)

    runtime._reviewed_version_from_pdf = _reviewed_version_from_pdf

    def _checked_version_snapshot(base, values):
        """Validate all edits before writing any draft revision data."""
        if not isinstance(values, dict):
            raise ValueError('Bitte gültige Angebotsdaten senden.')
        candidate = runtime.Offer(**{k: base.get(k) for k in runtime._OFFER_VERSION_FIELDS if k not in ('document_id', 'digest', 'status', 'filename', 'reconciled', 'warnings', 'contractor_id')})
        candidate.status = 'Entwurf'
        candidate.digest = base.get('digest')
        candidate.document_id = base.get('document_id')
        candidate.contractor_id = base.get('contractor_id')
        candidate.filename = base.get('filename')
        candidate.warnings = base.get('warnings') or '[]'
        candidate.reconciled = bool(base.get('reconciled'))
        runtime._apply_offer_fields(candidate, values)
        positions = runtime._validated_offer_positions(values.get('positions', base.get('positions', [])))
        runtime._update_draft_positions(candidate, positions)
        return runtime._offer_snapshot(candidate)

    runtime._checked_version_snapshot = _checked_version_snapshot

    def _apply_version_to_offer(o, snapshot):
        """Activate a reviewed revision on the same Offer.id so invoices stay linked."""
        for field in runtime._OFFER_VERSION_FIELDS:
            setattr(o, field, snapshot.get(field))
        o.positions.clear()
        o.sections.clear()
        for pos in snapshot.get('positions', []):
            o.positions.append(runtime.OfferPosition(**pos))
        for group in snapshot.get('sections', []):
            o.sections.append(runtime.OfferSection(**group))

    runtime._apply_version_to_offer = _apply_version_to_offer

    def _sync_revised_contract(o, old_budget_line):
        """Update the accepted contract amount without detaching any payment or invoice."""
        items = runtime.db.session.scalars(runtime.select(runtime.CostItem).where(runtime.CostItem.offer_id == o.id).order_by(runtime.CostItem.id)).all()
        if o.budget_line_id != old_budget_line and any((runtime._offer_has_dependencies(item) for item in items)):
            raise ValueError('Der Auftrag besitzt Rechnungen oder Zahlungen. Die Kostenplanposition darf bei einem Versionswechsel nicht verändert werden.')
        if o.budget_line_id != old_budget_line:
            runtime._sync_offer_costs(o)
            return
        if not items:
            runtime._sync_offer_costs(o)
            return
        for item in items:
            item.offer = runtime._contract_gross(o)
            item.committed = runtime._contract_gross(o)
            item.title = f"{o.vendor}: Angebot {o.number or 'ohne Nummer'}"[:300]
            item.category = o.category if not o.budget_line_id else runtime.db.session.get(runtime.BudgetLine, o.budget_line_id).category
            item.contractor_id = o.contractor_id
            item.source_ref = o.number

    runtime._sync_revised_contract = _sync_revised_contract

    def _version_drafts():
        rows = runtime.db.session.scalars(runtime.select(runtime.OfferVersion).where(runtime.OfferVersion.state == 'draft').order_by(runtime.OfferVersion.id.desc())).all()
        result = []
        for v in rows:
            o = runtime.db.session.get(runtime.Offer, v.offer_id)
            if o:
                snapshot = runtime.json.loads(v.snapshot)
                warnings = snapshot.get('warnings') or '[]'
                snapshot['warnings'] = runtime.json.loads(warnings) if isinstance(warnings, str) else warnings
                result.append({'offer_id': o.id, 'version': v.version_number, 'current_vendor': o.vendor, **snapshot})
        return result

    runtime._version_drafts = _version_drafts

    @runtime.app.post('/api/offers/<int:offer_id>/versions')
    def upload_offer_version(offer_id):
        o = runtime.db.session.get(runtime.Offer, offer_id)
        if not o:
            return (runtime.jsonify(error='Angebot nicht gefunden.'), 404)
        if any((v.state == 'draft' for v in o.versions)):
            return (runtime.jsonify(error='Bitte zuerst den offenen Versionsentwurf prüfen oder verwerfen.'), 409)
        f = runtime.request.files.get('file')
        if not f or not f.filename or runtime.Path(f.filename).suffix.lower() != '.pdf':
            return (runtime.jsonify(error='Bitte eine PDF-Datei auswählen.'), 400)
        data = f.read(15 * 1024 * 1024 + 1)
        if not data or len(data) > 15 * 1024 * 1024:
            return (runtime.jsonify(error='Maximal 15 MB je Angebot.'), 413)
        if not data.startswith(b'%PDF'):
            return (runtime.jsonify(error='Die Datei ist kein gültiges PDF.'), 400)
        digest = runtime.sha256(data).hexdigest()
        if runtime.db.session.scalar(runtime.select(runtime.Offer.id).where(runtime.Offer.digest == digest, runtime.Offer.id != o.id).limit(1)):
            return (runtime.jsonify(error='Dieses PDF ist bereits einem anderen Angebot zugeordnet.'), 409)
        if o.digest == digest or any((runtime.json.loads(v.snapshot).get('digest') == digest for v in o.versions)):
            return (runtime.jsonify(error='Dieses PDF gehört bereits zur Versionshistorie dieses Angebots.'), 409)
        name = runtime.Path(f.filename).name[:240]
        try:
            parsed, content = runtime._analyse_offer_with_mode(data, name)
        except runtime.AIError as exc:
            return (runtime.jsonify(error=str(exc)), 403)
        except ValueError as exc:
            return (runtime.jsonify(error=str(exc)), 422)
        root = runtime.DOCUMENT_ROOT
        root.mkdir(parents=True, exist_ok=True)
        stored = runtime.uuid4().hex + '.pdf'
        (root / stored).write_bytes(data)
        try:
            runtime._ensure_offer_current_version(o)
            doc = runtime.Document(original_name=name, stored_name=stored, kind='Angebot', contractor_id=o.contractor_id, notes='Neue PDF-Version von Angebot #' + str(o.id))
            runtime.db.session.add(doc)
            runtime.db.session.flush()
            snapshot = runtime._reviewed_version_from_pdf(o, parsed, digest, doc, name, o.category)
            version = max([o.current_version or 1] + [v.version_number for v in o.versions]) + 1
            v = runtime.OfferVersion(offer_id=o.id, version_number=version, state='draft', document_id=doc.id, snapshot=runtime.json.dumps(snapshot, ensure_ascii=False))
            runtime.db.session.add(v)
            runtime.db.session.commit()
            return (runtime.jsonify(ok=True, offer_id=o.id, version=runtime._version_json(v, True)), 201)
        except (ValueError, TypeError, Exception) as exc:
            runtime.db.session.rollback()
            (root / stored).unlink(missing_ok=True)
            return (runtime.jsonify(error='Neue Angebotsversion konnte nicht gespeichert werden: ' + str(exc)), 400)

    runtime.upload_offer_version = upload_offer_version

    @runtime.app.patch('/api/offers/<int:offer_id>/versions/<int:number>/draft')
    def edit_offer_version(offer_id, number):
        v = runtime.db.session.scalar(runtime.select(runtime.OfferVersion).where(runtime.OfferVersion.offer_id == offer_id, runtime.OfferVersion.version_number == number))
        if not v:
            return (runtime.jsonify(error='Version nicht gefunden.'), 404)
        if v.state != 'draft':
            return (runtime.jsonify(error='Nur noch nicht freigegebene Versionen sind bearbeitbar.'), 409)
        try:
            payload = runtime._checked_version_snapshot(runtime.json.loads(v.snapshot), runtime.request.get_json(silent=True))
            v.snapshot = runtime.json.dumps(payload, ensure_ascii=False)
            runtime.db.session.commit()
            return runtime.jsonify(ok=True, version=runtime._version_json(v, True))
        except (ValueError, TypeError) as exc:
            runtime.db.session.rollback()
            return (runtime.jsonify(error=str(exc)), 400)

    runtime.edit_offer_version = edit_offer_version

    @runtime.app.post('/api/offers/<int:offer_id>/versions/<int:number>/activate')
    def activate_offer_version(offer_id, number):
        o = runtime.db.session.get(runtime.Offer, offer_id)
        if not o:
            return (runtime.jsonify(error='Angebot nicht gefunden.'), 404)
        v = next((row for row in o.versions if row.version_number == number), None)
        if not v:
            return (runtime.jsonify(error='Version nicht gefunden.'), 404)
        if v.state != 'draft':
            return (runtime.jsonify(error='Diese Version wurde bereits entschieden.'), 409)
        snapshot = runtime.json.loads(v.snapshot)
        if not snapshot.get('vendor') or snapshot['vendor'] == 'Firma nicht erkannt' or (not snapshot.get('gross')) or (snapshot['gross'] <= 0):
            return (runtime.jsonify(error='Bitte Anbieter und Bruttogesamtsumme vor der Freigabe prüfen.'), 409)
        old_status = o.status
        old_budget = o.budget_line_id
        accepted = old_status in ('Angenommen', 'Beauftragt')
        try:
            current = runtime._ensure_offer_current_version(o)
            current.snapshot = runtime.json.dumps(runtime._offer_snapshot(o), ensure_ascii=False)
            current.state = 'historical'
            runtime._apply_version_to_offer(o, snapshot)
            o.status = old_status if accepted else 'Angebot'
            o.current_version = v.version_number
            o.deletion_locked = True
            if accepted:
                runtime._sync_revised_contract(o, old_budget)
            else:
                runtime._sync_offer_costs(o)
            v.state = 'current'
            v.snapshot = runtime.json.dumps(runtime._offer_snapshot(o), ensure_ascii=False)
            runtime.db.session.commit()
            return runtime.jsonify(ok=True, offer=runtime.offer_dict(o))
        except (ValueError, TypeError) as exc:
            runtime.db.session.rollback()
            return (runtime.jsonify(error=str(exc)), 409)

    runtime.activate_offer_version = activate_offer_version

    @runtime.app.post('/api/offers/<int:offer_id>/versions/<int:number>/discard')
    def discard_offer_version(offer_id, number):
        v = runtime.db.session.scalar(runtime.select(runtime.OfferVersion).where(runtime.OfferVersion.offer_id == offer_id, runtime.OfferVersion.version_number == number))
        if not v:
            return (runtime.jsonify(error='Version nicht gefunden.'), 404)
        if v.state != 'draft':
            return (runtime.jsonify(error='Nur offene Versionsentwürfe können verworfen werden.'), 409)
        v.state = 'discarded'
        runtime.db.session.get(runtime.Offer, offer_id).deletion_locked = True
        runtime.db.session.commit()
        return runtime.jsonify(ok=True)

    runtime.discard_offer_version = discard_offer_version

    @runtime.app.get('/api/offers/<int:offer_id>/versions')
    def list_offer_versions(offer_id):
        o = runtime.db.session.get(runtime.Offer, offer_id)
        if not o:
            return (runtime.jsonify(error='Angebot nicht gefunden.'), 404)
        return runtime.jsonify(offer_id=o.id, current_version=o.current_version or 1, versions=[runtime._version_json(v, True) for v in reversed(o.versions)] or [{'version': 1, 'state': 'current', 'snapshot': runtime._offer_snapshot(o)}])

    runtime.list_offer_versions = list_offer_versions

    def offer_dict(o):
        acceptance = runtime._order_acceptance(o)
        reversals = [dict(reversed_at=x.reversed_at.isoformat(), agreed_gross=float(x.agreed_gross), document_id=x.confirmation_document_id) for x in runtime.db.session.scalars(runtime.select(runtime.OfferAcceptanceReversal).where(runtime.OfferAcceptanceReversal.offer_id == o.id).order_by(runtime.OfferAcceptanceReversal.id.desc()))]
        acceptance_json = {'id': acceptance.id, 'mode': acceptance.mode, 'quoted_gross': float(acceptance.quoted_gross), 'agreed_gross': float(acceptance.agreed_gross), 'document_id': acceptance.confirmation_document_id, 'created_at': acceptance.created_at.isoformat() if acceptance.created_at else ''} if acceptance else None
        deletion_reason = runtime._offer_deletion_reason(o)
        return {'diy_estimate':diy_estimate(o),'attachments':[{'id':d.id,'filename':d.original_name,'uploaded_at':d.uploaded_at.isoformat() if d.uploaded_at else '', 'view_url':f'/api/documents/{d.id}/preview' if runtime.Path(d.original_name).suffix.lower() in ('.pdf','.jpg','.jpeg','.png','.webp','.txt') else None,'download_url':f'/api/documents/{d.id}/download'} for d in runtime.db.session.scalars(runtime.select(runtime.Document).where(runtime.Document.offer_id==o.id).order_by(runtime.Document.id.desc()))], 'acceptance_reversals': reversals, 'acceptance': acceptance_json, 'agreed_gross': runtime._contract_gross(o), 'can_delete': not deletion_reason, 'deletion_reason': deletion_reason, 'id': o.id, 'number': o.number, 'vendor': o.vendor, 'filename': o.filename, 'issued': o.issued, 'expires': o.expires, 'net': o.net, 'vat': o.vat, 'gross': o.gross, 'category': o.category, 'budget_line_id': o.budget_line_id, 'notes': o.notes, 'tax_rate': o.tax_rate, 'status': o.status, 'reconciled': o.reconciled, 'warnings': runtime.json.loads(o.warnings or '[]'), 'document_id': o.document_id, 'contractor_id': o.contractor_id, 'billing': runtime.offer_billing_dict(o), 'current_version': o.current_version or 1, 'versions': [runtime._version_json(v) for v in reversed(o.versions)], 'sections': [{'id': g.id, 'name': g.name, 'net': g.net, 'gross': g.gross, 'budget_line_id': g.budget_line_id, 'selected': g.selected} for g in sorted(o.sections, key=lambda x: x.sort_order)], 'positions': [{'id': p.id, 'number': p.number, 'section': p.section, 'description': p.description, 'quantity': p.quantity, 'unit': p.unit, 'unit_price': p.unit_price, 'net_amount': p.net_amount, 'optional_amount': p.optional_amount, 'optional': p.optional, 'page': p.page, 'own_work': bool(p.own_work)} for p in sorted(o.positions, key=lambda x: x.id)]}

    runtime.offer_dict = offer_dict

    def _analyse_pdf_offer(data, name):
        """Use the detailed parser first, falling back to local OCR and a general total recognizer.

        A parser failure never silently invents a total or prevents manual review.
        """
        empty = {'filename': name, 'family': 'Andere', 'vendor': 'Firma nicht erkannt', 'number': '', 'issued': '', 'expires': '', 'net': None, 'vat': None, 'gross': None, 'tax_rate': 0, 'positions': [], 'groups': [], 'reconciled': False, 'warnings': []}
        try:
            text_pages = runtime.pdf_to_pages(data)
            parsed = runtime.parse_offer(text_pages, name)
            content = '\n'.join(text_pages)
        except Exception as exc:
            if 'Verschlüsseltes PDF' in str(exc):
                raise ValueError(str(exc)) from exc
            parsed = dict(empty)
            parsed['warnings'] = ['PDF-Texterkennung nicht ausreichend: ' + str(exc)]
            try:
                content, mode = runtime.extract_text(data, name)
                if content.strip():
                    parsed = runtime.parse_offer([content], name)
                    parsed['warnings'].append('Analyse über ' + mode + '. Bitte den Gesamtbetrag besonders prüfen.')
            except Exception as fallback_error:
                parsed['warnings'].append('OCR nicht verfügbar: ' + str(fallback_error) + '. Werte bitte manuell eingeben.')
                content = ''
        if content.strip():
            generic = runtime.parse_receipt(content)
            if parsed['gross'] is None and generic.get('gross_amount'):
                parsed['gross'] = float(generic['gross_amount'])
                parsed['warnings'].append('Gesamtsumme aus allgemeiner Betragserkennung vorgeschlagen. Bitte bestätigen.')
            if parsed['net'] is None and generic.get('net_amount'):
                parsed['net'] = float(generic['net_amount'])
            if parsed['vat'] is None and generic.get('vat_amount'):
                parsed['vat'] = float(generic['vat_amount'])
            if parsed['vendor'] == 'Firma nicht erkannt' and generic.get('supplier'):
                parsed['vendor'] = generic['supplier']
            if not parsed['number'] and generic.get('invoice_number'):
                parsed['number'] = generic['invoice_number']
            if not parsed['issued'] and generic.get('document_date'):
                parsed['issued'] = generic['document_date']
        return (parsed, content)

    runtime._analyse_pdf_offer = _analyse_pdf_offer

    @runtime.app.post('/api/offers/manual')
    def offers_manual():
        """Create a reviewed offer, optionally with an original PDF, without running OCR."""
        values = runtime.request.form.to_dict() if runtime.request.mimetype == 'multipart/form-data' else runtime.request.get_json(silent=True)
        if not isinstance(values, dict):
            return (runtime.jsonify(error='Bitte Angebotsdaten eingeben.'), 400)
        obj = runtime.Offer(digest=runtime.sha256(('manual:' + runtime.uuid4().hex).encode('utf-8')).hexdigest(), filename='Manuell erfasst', vendor='', number='', category='Sonstiges', status='Angebot', warnings='[]', reconciled=False)
        stored = None
        try:
            runtime._apply_offer_fields(obj, values)
            if not obj.vendor.strip() or obj.vendor == 'Firma nicht erkannt':
                raise ValueError('Bitte einen Anbieter angeben.')
            if obj.gross is None or obj.gross <= 0:
                raise ValueError('Bitte einen positiven Bruttogesamtbetrag eingeben.')
            uploaded = runtime.request.files.get('file')
            if uploaded and uploaded.filename:
                if runtime.Path(uploaded.filename).suffix.lower() != '.pdf':
                    raise ValueError('Bitte einen PDF-Anhang auswählen.')
                data = uploaded.read(15 * 1024 * 1024 + 1)
                if not data or len(data) > 15 * 1024 * 1024 or (not data.startswith(b'%PDF-')):
                    raise ValueError('PDF-Anhang muss eine gültige PDF-Datei bis 15 MB sein.')
                try:
                    from pypdf import PdfReader
                    pdf = PdfReader(runtime.io.BytesIO(data))
                    if pdf.is_encrypted or not pdf.pages:
                        raise ValueError()
                except Exception:
                    raise ValueError('PDF-Anhang ist beschädigt, leer oder verschlüsselt.') from None
                digest = runtime.sha256(data).hexdigest()
                if runtime.db.session.scalar(runtime.select(runtime.Offer.id).where(runtime.Offer.digest == digest)):
                    raise ValueError('Dieses PDF ist bereits einem Angebot zugeordnet.')
                runtime.DOCUMENT_ROOT.mkdir(parents=True, exist_ok=True)
                stored = runtime.uuid4().hex + '.pdf'
                (runtime.DOCUMENT_ROOT / stored).write_bytes(data)
                obj.digest = digest
                obj.filename = runtime.Path(uploaded.filename).name[:240]
                document = runtime.Document(original_name=obj.filename, stored_name=stored, kind='Angebot', contractor_id=obj.contractor_id, budget_line_id=obj.budget_line_id, notes='PDF-Anhang eines manuell erfassten Angebots; ohne automatische Analyse.')
                runtime.db.session.add(document)
                runtime.db.session.flush()
                obj.document_id = document.id
            runtime.db.session.add(obj)
            runtime.db.session.commit()
            return (runtime.jsonify(ok=True, id=obj.id, offer=runtime.offer_dict(obj)), 201)
        except (ValueError, TypeError) as exc:
            runtime.db.session.rollback()
            if stored:
                (runtime.DOCUMENT_ROOT / stored).unlink(missing_ok=True)
            return (runtime.jsonify(error=str(exc)), 400)
        except Exception:
            runtime.db.session.rollback()
            if stored:
                (runtime.DOCUMENT_ROOT / stored).unlink(missing_ok=True)
            runtime.app.logger.exception('Manuelles Angebot konnte nicht gespeichert werden')
            return (runtime.jsonify(error='Angebot konnte nicht gespeichert werden; bitte erneut versuchen.'), 500)

    runtime.offers_manual = offers_manual

    @runtime.app.get('/api/offers')
    def offers_list():
        return runtime.jsonify(offers=[runtime.offer_dict(x) for x in runtime.db.session.scalars(runtime.select(runtime.Offer).order_by(runtime.Offer.id.desc()))], draft_versions=runtime._version_drafts(), categories=runtime.category_names())

    runtime.offers_list = offers_list

    @runtime.app.post('/api/offers/import')
    def offers_import():
        f = runtime.request.files.get('file')
        if not f or not f.filename or runtime.Path(f.filename).suffix.lower() != '.pdf':
            return (runtime.jsonify(error='Bitte eine PDF-Datei auswählen.'), 400)
        data = f.read()
        if len(data) > 15 * 1024 * 1024:
            return (runtime.jsonify(error='Maximal 15 MB je Angebot.'), 413)
        if not data.startswith(b'%PDF'):
            return (runtime.jsonify(error='Die Datei ist kein gültiges PDF.'), 400)
        digest = runtime.sha256(data).hexdigest()
        if runtime.db.session.scalar(runtime.select(runtime.Offer.id).where(runtime.Offer.digest == digest)):
            return (runtime.jsonify(error='Dieses PDF wurde bereits hochgeladen.'), 409)
        name = runtime.Path(f.filename).name[:240]
        try:
            parsed, content = runtime._analyse_offer_with_mode(data, name)
        except runtime.AIError as exc:
            return (runtime.jsonify(error=str(exc)), 403)
        except ValueError as exc:
            return (runtime.jsonify(error=str(exc)), 422)
        suggested = runtime.category_for(content) if content else 'Sonstiges'
        if suggested not in runtime.category_names():
            suggested = 'Sonstiges'
        runtime.DOCUMENT_ROOT.mkdir(parents=True, exist_ok=True)
        stored = runtime.uuid4().hex + '.pdf'
        (runtime.DOCUMENT_ROOT / stored).write_bytes(data)
        try:
            doc = runtime.Document(original_name=name, stored_name=stored, kind='Angebot', notes='PDF-Angebot: Analyse als Entwurf gespeichert.')
            runtime.db.session.add(doc)
            runtime.db.session.flush()
            obj = runtime.add_parsed_offer(parsed, digest, doc, category=suggested)
            doc.contractor_id = obj.contractor_id
            runtime.db.session.commit()
            return (runtime.jsonify(ok=True, id=obj.id, offer=runtime.offer_dict(obj)), 201)
        except Exception as exc:
            runtime.db.session.rollback()
            (runtime.DOCUMENT_ROOT / stored).unlink(missing_ok=True)
            return (runtime.jsonify(error='Angebot konnte nicht gespeichert werden: ' + str(exc)), 400)

    runtime.offers_import = offers_import

    def _offer_amount(raw, field):
        from decimal import Decimal, InvalidOperation
        if raw is None or raw == '':
            return None
        try:
            formatted = str(raw).strip()
            if ',' in formatted and '.' in formatted:
                import re
                if not re.fullmatch('\\d{1,3}(?:\\.\\d{3})+,\\d{1,2}', formatted):
                    raise ValueError()
                formatted = formatted.replace('.', '').replace(',', '.')
            else:
                formatted = formatted.replace(',', '.')
            v = Decimal(formatted)
            if not v.is_finite() or v < 0 or v > Decimal('99999999.99') or (v.as_tuple().exponent < -2):
                raise ValueError()
            return float(v)
        except (InvalidOperation, ValueError, TypeError):
            raise ValueError('Ungültiger Betrag für ' + field + ' (maximal zwei Nachkommastellen).')

    runtime._offer_amount = _offer_amount

    def _apply_offer_fields(offer, values):
        """Shared validation for PDF corrections and manually entered offers."""
        for key, limit in [('vendor', 200), ('number', 100), ('issued', 20), ('expires', 20), ('notes', 2000)]:
            if key in values:
                value = str(values[key] or '').strip()
                if len(value) > limit:
                    raise ValueError(key + ': Text ist zu lang.')
                setattr(offer, key, value)
        for key in ('gross', 'net', 'vat'):
            if key in values:
                setattr(offer, key, runtime._offer_amount(values[key], key))
        if 'category' in values:
            category = str(values['category'] or '').strip()
            if category not in runtime.category_names():
                raise ValueError('Bitte eine vorhandene Kategorie auswählen.')
            offer.category = category
        if 'budget_line_id' in values:
            candidate = values['budget_line_id']
            if candidate in ('', None):
                offer.budget_line_id = None
            else:
                try:
                    line_id = int(candidate)
                except (ValueError, TypeError):
                    raise ValueError('Ungültige Kostenplanposition.')
                line = runtime.db.session.get(runtime.BudgetLine, line_id)
                if not line or not line.active or line.is_group:
                    raise ValueError('Bitte eine aktive Kostenplanposition wählen.')
                offer.budget_line_id = line_id
        if 'contractor_id' in values:
            candidate = values['contractor_id']
            if candidate in ('', None):
                offer.contractor_id = None
            else:
                try:
                    contractor_id = int(candidate)
                except (ValueError, TypeError):
                    raise ValueError('Bitte eine Firma aus den Stammdaten auswählen.') from None
                contractor = runtime.db.session.get(runtime.Contractor, contractor_id)
                if not contractor:
                    raise ValueError('Die ausgewählte Firma ist nicht mehr vorhanden.')
                offer.contractor_id = contractor.id
                offer.vendor = contractor.name
        if offer.gross and offer.net:
            offer.tax_rate = round((offer.gross / offer.net - 1) * 100, 2)

    runtime._apply_offer_fields = _apply_offer_fields

    def _validated_offer_positions(raw):
        """Parse a replacement draft position list before touching any persisted rows.

        Unknown/extraneous input fields are deliberately discarded. The gross total
        of the quotation remains independent from these OCR-derived details.
        """
        from decimal import Decimal, InvalidOperation
        if not isinstance(raw, list) or len(raw) > 500:
            raise ValueError('Bitte maximal 500 Angebotspositionen als Liste senden.')
        validated = []
        for index, item in enumerate(raw, 1):
            if not isinstance(item, dict):
                raise ValueError(f'Position {index}: ungültige Eingabe.')
            output = {}
            for field, length in (('number', 30), ('section', 170), ('description', 300), ('unit', 40)):
                value = item.get(field, '')
                if not isinstance(value, str):
                    raise ValueError(f'Position {index}: {field} muss Text sein.')
                value = value.strip()
                if len(value) > length or any((ord(c) < 32 for c in value)):
                    raise ValueError(f'Position {index}: {field} ist ungültig oder zu lang.')
                output[field] = value
            if not output['description']:
                raise ValueError(f'Position {index}: Bitte eine Leistungsbeschreibung eingeben.')
            if not output['number']:
                output['number'] = str(index)
            optional = item.get('optional', False)
            if not isinstance(optional, bool):
                raise ValueError(f'Position {index}: optionale Leistung muss Ja oder Nein sein.')
            output['optional'] = optional
            own_work=item.get('own_work',False)
            if not isinstance(own_work,bool):
                raise ValueError(f'Position {index}: Eigenleistung muss Ja oder Nein sein.')
            output['own_work']=own_work
            for field in ('unit_price', 'net_amount', 'optional_amount'):
                output[field] = runtime._offer_amount(item.get(field), f'Position {index}, {field}')
            qty = item.get('quantity')
            if qty in (None, ''):
                output['quantity'] = None
            else:
                try:
                    formatted = str(qty).strip().replace(',', '.')
                    value = Decimal(formatted)
                    if not value.is_finite() or value < 0 or value > Decimal('99999999') or (value.as_tuple().exponent < -6):
                        raise ValueError()
                    output['quantity'] = float(value)
                except (InvalidOperation, TypeError, ValueError):
                    raise ValueError(f'Position {index}: Menge muss eine nichtnegative Zahl sein (maximal sechs Nachkommastellen).')
            page = item.get('page')
            if page in (None, ''):
                output['page'] = None
            else:
                try:
                    page = int(page)
                    if page < 1 or page > 9999 or str(page) != str(item.get('page')).strip():
                        raise ValueError()
                    output['page'] = page
                except (TypeError, ValueError):
                    raise ValueError(f'Position {index}: Seitennummer muss zwischen 1 und 9999 liegen.')
            validated.append(output)
        return validated

    runtime._validated_offer_positions = _validated_offer_positions

    def _update_draft_positions(offer, rows):
        """Rebuild dependent OCR sections from reviewed data; no stale subtotals."""
        from decimal import Decimal
        offer.positions.clear()
        offer.sections.clear()
        totals = {}
        complete = True
        for pos in rows:
            offer.positions.append(runtime.OfferPosition(**pos))
            if not pos['optional']:
                if pos['net_amount'] is None:
                    complete = False
                else:
                    group = pos['section'] or 'Weitere Leistungen'
                    totals[group] = totals.get(group, Decimal('0')) + Decimal(str(pos['net_amount']))
        multiplier = Decimal(str(offer.gross)) / Decimal(str(offer.net)) if offer.net is not None and offer.net > 0 and (offer.gross is not None) else Decimal('1')
        for index, (name, net) in enumerate(totals.items()):
            offer.sections.append(runtime.OfferSection(name=name, net=float(net), gross=float(round(net * multiplier, 2)), sort_order=index, selected=False))
        total = sum(totals.values(), Decimal('0'))
        offer.reconciled = bool(rows and complete and (offer.net is not None) and (abs(total - Decimal(str(offer.net))) <= Decimal('0.02')))

    runtime._update_draft_positions = _update_draft_positions

    @runtime.app.patch('/api/offers/<int:offer_id>/draft')
    def offer_draft_update(offer_id):
        offer = runtime.db.session.get(runtime.Offer, offer_id)
        if not offer:
            return (runtime.jsonify(error='Angebot nicht gefunden.'), 404)
        if offer.status not in ('Entwurf', 'Angebot', 'Abgelehnt', 'Angenommen', 'Beauftragt'):
            return (runtime.jsonify(error='Dieses Angebot kann nicht bearbeitet werden.'), 409)
        values = runtime.request.get_json(silent=True) or {}
        if not isinstance(values, dict):
            return (runtime.jsonify(error='Bitte gültige Angebotsdaten senden.'), 400)
        if 'positions' in values and offer.status != 'Entwurf':
            return (runtime.jsonify(error='Einzelpositionen können nur vor der Übernahme aus dem PDF-Entwurf geändert werden.'), 409)
        try:
            positions = runtime._validated_offer_positions(values['positions']) if 'positions' in values else None
            runtime._apply_offer_fields(offer, values)
            if positions is not None:
                runtime._update_draft_positions(offer, positions)
            if offer.status in ('Angenommen', 'Beauftragt'):
                runtime._sync_offer_costs(offer)
            runtime._sync_current_version(offer)
            runtime.db.session.commit()
            return runtime.jsonify(ok=True, offer=runtime.offer_dict(offer))
        except (ValueError, TypeError) as exc:
            runtime.db.session.rollback()
            return (runtime.jsonify(error=str(exc)), 400)

    runtime.offer_draft_update = offer_draft_update

    @runtime.app.post('/api/offers/<int:offer_id>/accept')
    def offer_accept_with_confirmation(offer_id):
        """Accept a reviewed quote in one transaction and optionally attach its order confirmation.

        The original offer and its version snapshots never get overwritten.
        If there is no confirmation PDF, the quote is accepted exactly 1:1.
        """
        offer = runtime.db.session.get(runtime.Offer, offer_id)
        if not offer:
            return (runtime.jsonify(error='Angebot nicht gefunden.'), 404)
        if offer.status != 'Angebot' or runtime._order_acceptance(offer):
            return (runtime.jsonify(error='Nur ein offenes, geprüftes Angebot kann einmalig angenommen werden.'), 409)
        if any((v.state == 'draft' for v in offer.versions)):
            return (runtime.jsonify(error='Bitte offene Angebotsversionen erst prüfen.'), 409)
        if not offer.vendor.strip() or offer.vendor == 'Firma nicht erkannt' or (not offer.gross) or (not runtime.math.isfinite(offer.gross)) or (offer.gross <= 0):
            return (runtime.jsonify(error='Firma und positive Angebotssumme müssen vor der Annahme geprüft sein.'), 409)
        if runtime.request.form.get('confirm') != 'true':
            return (runtime.jsonify(error='Die verbindliche Angebotsannahme ausdrücklich bestätigen.'), 400)
        mode = runtime.request.form.get('mode')
        uploaded = runtime.request.files.get('confirmation')
        if mode not in ('offer', 'confirmation'):
            return (runtime.jsonify(error='Bitte Angebot übernehmen oder Auftragsbestätigung auswählen.'), 400)
        if mode == 'offer' and uploaded and uploaded.filename:
            return (runtime.jsonify(error='Datei nur bei Auftragsbestätigung erlaubt.'), 400)
        data = None
        filename = None
        if mode == 'confirmation':
            if not uploaded or not uploaded.filename or runtime.Path(uploaded.filename).suffix.lower() != '.pdf':
                return (runtime.jsonify(error='Bitte die Auftragsbestätigung als PDF hochladen.'), 400)
            data = uploaded.read(15 * 1024 * 1024 + 1)
            if not data or len(data) > 15 * 1024 * 1024 or (not data.startswith(b'%PDF-')):
                return (runtime.jsonify(error='Die Auftragsbestätigung muss ein gültiges PDF bis 15 MB sein.'), 400)
            try:
                from pypdf import PdfReader
                pdf = PdfReader(runtime.io.BytesIO(data))
                if pdf.is_encrypted or not pdf.pages:
                    return (runtime.jsonify(error='Die Auftragsbestätigung ist verschlüsselt oder leer.'), 400)
            except Exception:
                return (runtime.jsonify(error='Das PDF ist beschädigt oder nicht lesbar.'), 400)
            filename = runtime.Path(uploaded.filename).name[:240]
            if 'agreed_gross' not in runtime.request.form or not runtime.request.form['agreed_gross'].strip():
                return (runtime.jsonify(error='Bitte den endgültigen Auftragswert prüfen und eintragen.'), 400)
            try:
                amount = runtime._offer_amount(runtime.request.form['agreed_gross'], 'Auftragswert')
            except ValueError as exc:
                return (runtime.jsonify(error=str(exc)), 400)
        else:
            amount = float(offer.gross)
            if runtime.request.form.get('agreed_gross') not in (None, ''):
                try:
                    requested = runtime._offer_amount(runtime.request.form['agreed_gross'], 'Auftragswert')
                except ValueError as exc:
                    return (runtime.jsonify(error=str(exc)), 400)
                if abs(requested - amount) > 0.001:
                    return (runtime.jsonify(error='Ohne Auftragsbestätigung muss die Angebotssumme 1:1 übernommen werden.'), 409)
        if not amount or amount <= 0 or (not runtime.math.isfinite(amount)):
            return (runtime.jsonify(error='Der bestätigte Auftragswert muss größer als 0 € sein.'), 400)
        stored = None
        try:
            if data is not None:
                runtime.DOCUMENT_ROOT.mkdir(parents=True, exist_ok=True)
                stored = runtime.uuid4().hex + '.pdf'
                (runtime.DOCUMENT_ROOT / stored).write_bytes(data)
                doc = runtime.Document(original_name=filename, stored_name=stored, kind='Auftragsbestätigung', notes='Auftragsbestätigung zu Angebot #' + str(offer.id) + '; verbindlicher Auftragswert', contractor_id=offer.contractor_id, budget_line_id=offer.budget_line_id)
                runtime.db.session.add(doc)
                runtime.db.session.flush()
                doc_id = doc.id
            else:
                doc_id = None
            runtime.db.session.add(runtime.OrderAcceptance(offer_id=offer.id, mode=mode, confirmation_document_id=doc_id, quoted_gross=offer.gross, agreed_gross=amount))
            runtime.db.session.flush()
            offer.status = 'Angenommen'
            offer.deletion_locked = True
            if offer.contractor_id is None:
                company = runtime.db.session.scalar(runtime.select(runtime.Contractor).where(runtime.db.func.lower(runtime.Contractor.name) == offer.vendor.lower()).limit(1))
                if company is None:
                    company = runtime.Contractor(name=offer.vendor, trade=offer.category or 'Sonstiges', notes='Aus angenommenem Angebot angelegt.')
                    runtime.db.session.add(company)
                    runtime.db.session.flush()
                offer.contractor_id = company.id
            if doc_id is not None:
                doc.contractor_id = offer.contractor_id
            runtime._sync_offer_costs(offer)
            runtime._sync_current_version(offer)
            runtime.db.session.commit()
            return (runtime.jsonify(ok=True, offer=runtime.offer_dict(offer)), 201)
        except (ValueError, TypeError) as exc:
            runtime.db.session.rollback()
            if stored:
                (runtime.DOCUMENT_ROOT / stored).unlink(missing_ok=True)
            return (runtime.jsonify(error=str(exc)), 409)
        except Exception:
            runtime.db.session.rollback()
            if stored:
                (runtime.DOCUMENT_ROOT / stored).unlink(missing_ok=True)
            runtime.app.logger.exception('Auftragsannahme fehlgeschlagen')
            return (runtime.jsonify(error='Auftragsannahme fehlgeschlagen; keine Kosten übernommen.'), 500)

    runtime.offer_accept_with_confirmation = offer_accept_with_confirmation

    @runtime.app.patch('/api/offers/<int:offer_id>')
    def offer_update(offer_id):
        offer = runtime.db.session.get(runtime.Offer, offer_id)
        if not offer:
            return (runtime.jsonify(error='Angebot nicht gefunden.'), 404)
        target = (runtime.request.get_json(silent=True) or {}).get('status')
        if target not in ('Angebot', 'Angenommen', 'Abgelehnt'):
            return (runtime.jsonify(error='Erlaubt sind In Liste übernehmen, Annehmen und Ablehnen.'), 400)
        if offer.status == 'Entwurf' and target != 'Angebot':
            return (runtime.jsonify(error='Entwurf erst prüfen und in die Angebotsliste übernehmen.'), 409)
        if runtime._order_acceptance(offer) and target != 'Angenommen':
            return (runtime.jsonify(error='Fixierter Auftrag: Rücknahme nur über einen geprüften gesonderten Korrekturprozess möglich.'), 409)
        if offer.status in ('Angenommen', 'Beauftragt') and target == 'Angenommen':
            return runtime.jsonify(ok=True, offer=runtime.offer_dict(offer))
        if target == 'Angebot' and (not offer.vendor.strip() or offer.vendor == 'Firma nicht erkannt' or offer.gross is None or (not runtime.math.isfinite(offer.gross)) or (offer.gross <= 0)):
            return (runtime.jsonify(error='Vor Übernahme Firma und positive Bruttogesamtsumme prüfen.'), 409)
        if target == 'Angenommen' and (offer.status not in ('Angebot', 'Angenommen', 'Beauftragt') or offer.gross is None or offer.gross <= 0):
            return (runtime.jsonify(error='Nur ein geprüftes, gelistetes Angebot mit Betrag kann angenommen werden.'), 409)
        try:
            if offer.status != target and (not (offer.status == 'Entwurf' and target == 'Angebot')):
                offer.deletion_locked = True
            offer.status = target
            if target == 'Angenommen' and offer.contractor_id is None and offer.vendor.strip() and (offer.vendor != 'Firma nicht erkannt'):
                company = runtime.db.session.scalar(runtime.select(runtime.Contractor).where(runtime.db.func.lower(runtime.Contractor.name) == offer.vendor.lower()).limit(1))
                if company is None:
                    company = runtime.Contractor(name=offer.vendor, trade=offer.category or 'Sonstiges', notes='Aus angenommenem Angebot angelegt.')
                    runtime.db.session.add(company)
                    runtime.db.session.flush()
                offer.contractor_id = company.id
            runtime._sync_offer_costs(offer)
            runtime._sync_current_version(offer)
            runtime.db.session.commit()
            return runtime.jsonify(ok=True, offer=runtime.offer_dict(offer))
        except ValueError as exc:
            runtime.db.session.rollback()
            return (runtime.jsonify(error=str(exc)), 409)

    runtime.offer_update = offer_update

    @runtime.app.get('/api/documents/<int:doc_id>/preview')
    def offer_document_preview(doc_id):
        item = runtime.db.session.get(runtime.Document, doc_id)
        if not item:
            return (runtime.jsonify(error='Dokument nicht gefunden.'), 404)
        path = runtime.DOCUMENT_ROOT / item.stored_name
        if not path.is_file():
            return (runtime.jsonify(error='Originaldatei fehlt.'), 404)
        mime={'.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.txt':'text/plain'}.get(path.suffix.lower())
        if not mime:
            return (runtime.jsonify(error='Eine Vorschau ist für PDF, Bilder und Textdateien möglich.'), 415)
        response = runtime.send_file(path, as_attachment=False, mimetype=mime, download_name=item.original_name)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Cache-Control'] = 'private, no-store'
        return response

    runtime.offer_document_preview = offer_document_preview

    @runtime.app.patch('/api/offer-sections/<int:section_id>')
    def offer_section_update(section_id):
        return (runtime.jsonify(error='Leistungsgruppen werden nur angezeigt. Kosten werden ausschließlich über die Angebotsannahme übertragen.'), 409)

    runtime.offer_section_update = offer_section_update

    @runtime.app.patch('/api/offer-costs/<int:item_id>')
    def offer_cost_payment(item_id):
        obj = runtime.db.session.get(runtime.CostItem, item_id)
        if not obj or not obj.offer_id:
            return (runtime.jsonify(error='Importierte Kostenposition nicht gefunden.'), 404)
        data = runtime.request.get_json(force=True) or {}
        try:
            if 'paid' in data:
                paid = float(data['paid'] or 0)
                if not runtime.math.isfinite(paid) or paid < 0:
                    raise ValueError('Zahlungsbetrag muss nicht-negativ sein.')
                if paid > 0 and runtime.db.session.scalar(runtime.select(runtime.Receipt.id).where(runtime.Receipt.cost_item_id == obj.id, runtime.Receipt.status == 'Gebucht').limit(1)):
                    raise ValueError('Zu diesem Auftrag liegen bereits gebuchte Belege vor. Zahlung bitte dort erfassen.')
                obj.paid = paid
            if 'notes' in data:
                obj.notes = str(data['notes'] or '')[:2000]
            runtime.db.session.commit()
            return runtime.jsonify(ok=True)
        except (ValueError, TypeError) as exc:
            runtime.db.session.rollback()
            return (runtime.jsonify(error=str(exc)), 400)

    runtime.offer_cost_payment = offer_cost_payment

    @runtime.app.delete('/api/offers/<int:offer_id>')
    def offer_delete(offer_id):
        offer = runtime.db.session.get(runtime.Offer, offer_id)
        if not offer:
            return (runtime.jsonify(error='Angebot nicht gefunden.'), 404)
        reason = runtime._offer_deletion_reason(offer)
        if reason:
            return (runtime.jsonify(error=reason), 409)
        linked = runtime.db.session.scalars(runtime.select(runtime.CostItem).where(runtime.CostItem.offer_id == offer_id)).all()
        documents = runtime.db.session.scalars(runtime.select(runtime.Document).where(runtime.Document.id.in_(runtime._offer_document_ids(offer)))).all()
        moved = []
        quarantine = None
        try:
            paths = [runtime.DOCUMENT_ROOT / doc.stored_name for doc in documents if (runtime.DOCUMENT_ROOT / doc.stored_name).is_file()]
            if paths:
                quarantine = runtime.tempfile.TemporaryDirectory(prefix='.offer-delete-', dir=runtime.DOCUMENT_ROOT)
                for path in paths:
                    destination = runtime.Path(quarantine.name) / path.name
                    path.replace(destination)
                    moved.append((path, destination))
            for item in linked:
                runtime.db.session.delete(item)
            runtime.db.session.flush()
            for doc in documents:
                if doc.offer_id==offer.id:doc.offer_id=None
            runtime.db.session.flush()
            runtime.db.session.delete(offer)
            runtime.db.session.flush()
            for doc in documents:
                runtime.db.session.delete(doc)
            for job in runtime.db.session.scalars(runtime.select(runtime.ImportJob).where(runtime.ImportJob.kind.in_(['offers', 'versions']), runtime.ImportJob.result_id == offer_id)):
                job.result_id = None
                job.status = 'Übernommen'
                job.stage = 'Angebot gelöscht'
            runtime.db.session.commit()
        except Exception:
            runtime.db.session.rollback()
            for path, destination in moved:
                if destination.exists():
                    destination.replace(path)
            return (runtime.jsonify(error='Angebot konnte nicht entfernt werden. Daten und Originale bleiben erhalten.'), 409)
        finally:
            if quarantine:
                quarantine.cleanup()
        return runtime.jsonify(ok=True)

    runtime.offer_delete = offer_delete

    def _offer_document_ids(offer):
        return {identifier for identifier in [offer.document_id, *[v.document_id for v in offer.versions], *runtime.db.session.scalars(runtime.select(runtime.Document.id).where(runtime.Document.offer_id==offer.id))] if identifier is not None}

    runtime._offer_document_ids = _offer_document_ids

    def _offer_deletion_reason(offer):
        if offer.deletion_locked or offer.status not in ('Entwurf', 'Angebot') or runtime._order_acceptance(offer):
            return 'Dieses Angebot wurde bereits angenommen, abgelehnt oder anderweitig entschieden und bleibt als Nachweis erhalten.'
        linked = runtime.db.session.scalars(runtime.select(runtime.CostItem).where(runtime.CostItem.offer_id == offer.id)).all()
        if any((x.committed or x.selected or x.state in ('Beauftragt', 'Abgelehnt') or runtime._offer_has_dependencies(x) for x in linked)):
            return 'Rechnungen, Aufträge, Zahlungen oder weitere Belege sind mit diesem Angebot verknüpft.'
        if runtime.db.session.scalar(runtime.select(runtime.FundingPlanOffer.funding_id).where(runtime.FundingPlanOffer.offer_id == offer.id).limit(1)):
            return 'Das Angebot ist Teil einer Förderplanung. Zuerst die Zuordnung in Energetische Planung entfernen.'
        if runtime.db.session.scalar(runtime.select(runtime.FundingDetail.funding_id).where(runtime.FundingDetail.offer_id == offer.id).limit(1)):
            return 'Eine Förderung ist mit diesem Angebot verknüpft. Zuerst die Zuordnung in Energetische Planung entfernen.'
        documents = runtime._offer_document_ids(offer)
        if documents and (runtime.db.session.scalar(runtime.select(runtime.Offer.id).where(runtime.Offer.document_id.in_(documents), runtime.Offer.id != offer.id).limit(1)) or runtime.db.session.scalar(runtime.select(runtime.OfferVersion.id).where(runtime.OfferVersion.document_id.in_(documents), runtime.OfferVersion.offer_id != offer.id).limit(1)) or runtime.db.session.scalar(runtime.select(runtime.CostPlanImport.id).where(runtime.CostPlanImport.document_id.in_(documents)).limit(1)) or runtime.db.session.scalar(runtime.select(runtime.OrderAcceptance.id).where(runtime.OrderAcceptance.confirmation_document_id.in_(documents)).limit(1))):
            return 'Ein Originaldokument wird noch an anderer Stelle verwendet und kann nicht vollständig gelöscht werden.'
        return ''

    runtime._offer_deletion_reason = _offer_deletion_reason

    @runtime.app.patch('/api/offers/<int:offer_id>/diy')
    def offer_diy_update(offer_id):
        offer=runtime.db.session.get(runtime.Offer,offer_id)
        if not offer:return runtime.jsonify(error='Angebot nicht gefunden.'),404
        data=runtime.request.get_json(silent=True)
        ids=data.get('position_ids') if isinstance(data,dict) else None
        if not isinstance(ids,list) or any(type(ident) is not int for ident in ids) or not set(ids)<=set(p.id for p in offer.positions):
            return runtime.jsonify(error='Bitte nur Positionen dieses Angebots auswählen.'),400
        for position in offer.positions:position.own_work=position.id in ids
        runtime._sync_current_version(offer)
        runtime.db.session.commit()
        return runtime.jsonify(ok=True,offer=runtime.offer_dict(offer))

    @runtime.app.post('/api/offers/<int:offer_id>/attachments')
    def offer_attachment_upload(offer_id):
        offer=runtime.db.session.get(runtime.Offer,offer_id)
        if not offer:return runtime.jsonify(error='Angebot nicht gefunden.'),404
        upload=runtime.request.files.get('file')
        if not upload or not upload.filename:return runtime.jsonify(error='Bitte eine Datei auswählen.'),400
        from pypdf.errors import PdfReadError
        raw=upload.read()
        try:
            name,extension,_,_=runtime.inspect_upload(upload.filename,raw)
        except (ValueError,OSError,PdfReadError) as error:
            return runtime.jsonify(error=str(error)),400
        runtime.DOCUMENT_ROOT.mkdir(parents=True,exist_ok=True)
        checksum=runtime.sha256(raw).digest()
        for existing in runtime.db.session.scalars(runtime.select(runtime.Document).where(runtime.Document.offer_id==offer.id,runtime.Document.original_name==name)):
            original=runtime.DOCUMENT_ROOT/existing.stored_name
            if original.is_file() and original.stat().st_size==len(raw):
                digest=runtime.sha256()
                with original.open('rb') as source:
                    for block in iter(lambda:source.read(1024*1024),b''):digest.update(block)
                if digest.digest()==checksum:return runtime.jsonify(ok=True,offer=runtime.offer_dict(offer))
        path=runtime.DOCUMENT_ROOT/(runtime.uuid4().hex+extension)
        try:
            path.write_bytes(raw)
            doc=runtime.Document(original_name=name,stored_name=path.name,kind='Angebotsanhang',offer_id=offer.id,contractor_id=offer.contractor_id)
            runtime.db.session.add(doc);runtime.db.session.commit()
            return runtime.jsonify(ok=True,offer=runtime.offer_dict(offer)),201
        except Exception:
            runtime.db.session.rollback();path.unlink(missing_ok=True)
            raise

    @runtime.app.delete('/api/offers/<int:offer_id>/attachments/<int:document_id>')
    def offer_attachment_delete(offer_id,document_id):
        offer=runtime.db.session.get(runtime.Offer,offer_id)
        doc=runtime.db.session.get(runtime.Document,document_id)
        if not offer or not doc or doc.offer_id!=offer.id or doc.kind!='Angebotsanhang':
            return runtime.jsonify(error='Anhang nicht gefunden.'),404
        path=runtime.DOCUMENT_ROOT/doc.stored_name
        with runtime.tempfile.TemporaryDirectory(prefix='.attachment-delete-',dir=runtime.DOCUMENT_ROOT) as trash:
            moved=runtime.Path(trash)/path.name
            if path.exists():path.replace(moved)
            try:
                runtime.db.session.delete(doc);runtime.db.session.commit()
            except Exception:
                runtime.db.session.rollback()
                if moved.exists():moved.replace(path)
                raise
        return runtime.jsonify(ok=True,offer=runtime.offer_dict(offer))
