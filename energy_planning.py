"""Manual funding records, linked to offers/budget without changing gross costs."""
import json
from datetime import date
from urllib.parse import urlsplit
from flask import jsonify, render_template, request
from sqlalchemy import select
from cost_plan_parser import amount
from funding_estimates import clean_inputs

SOURCES = [
    {'name': 'KfW – Förderung bestehender Immobilien', 'url': 'https://www.kfw.de/inlandsfoerderung/Privatpersonen/Bestehende-Immobilie/',
     'description': 'Heizungstausch, Effizienzhaus-Sanierung und ergänzende Finanzierung prüfen.'},
    {'name': 'BAFA – effiziente Gebäude', 'url': 'https://www.bafa.de/DE/Energie/Effiziente_Gebaeude/effiziente_gebaeude_node.html',
     'description': 'Gebäudehülle, Anlagentechnik, Heizungsoptimierung und Energieberatung prüfen.'},
    {'name': 'Förderdatenbank des Bundes', 'url': 'https://www.foerderdatenbank.de/FDB/DE/Home/home.html',
     'description': 'Zusätzliche Programme von Bund, Ländern und Kommunen nach Standort suchen.'},
    {'name': 'Energieeffizienz-Expertenliste', 'url': 'https://www.energie-effizienz-experten.de/',
     'description': 'Qualifizierte Energieberatung und erforderliche Fachplanung finden.'},
]
STATUSES = ('Geplant', 'In Prüfung', 'Beantragt', 'Bewilligt', 'Ausgezahlt', 'Abgelehnt')


def register_energy_planning(app, db, Funding, Offer, BudgetLine, budget_summary, CostItem, ProjectDocument):
    class FundingDetail(db.Model):
        __tablename__ = 'funding_detail'
        funding_id = db.Column(db.Integer, db.ForeignKey('funding.id'), primary_key=True)
        provider = db.Column(db.String(200), nullable=False, default='')
        program = db.Column(db.String(200), nullable=False, default='')
        status = db.Column(db.String(24), nullable=False, default='In Prüfung')
        deadline = db.Column(db.String(10), nullable=False, default='')
        applied_on = db.Column(db.String(10), nullable=False, default='')
        reference = db.Column(db.String(160), nullable=False, default='')
        source_url = db.Column(db.String(1000), nullable=False, default='')
        offer_id = db.Column(db.Integer, db.ForeignKey('offer.id'), nullable=True)
        budget_line_id = db.Column(db.Integer, db.ForeignKey('budget_line.id'), nullable=True)

    class FundingAssessment(db.Model):
        __tablename__ = 'funding_assessment'
        funding_id = db.Column(db.Integer, db.ForeignKey('funding.id'), primary_key=True)
        inputs = db.Column(db.Text, nullable=False, default='{}')

    class FundingDocument(db.Model):
        __tablename__ = 'funding_document'
        funding_id = db.Column(db.Integer, db.ForeignKey('funding.id'), primary_key=True)
        document_id = db.Column(db.Integer, db.ForeignKey('project_document.id'), primary_key=True)

    def serialize(item):
        result = {key: getattr(item, key) for key in ('id', 'name', 'expected', 'confirmed', 'received', 'notes')}
        detail = db.session.get(FundingDetail, item.id)
        for key in ('provider', 'program', 'status', 'deadline', 'applied_on', 'reference', 'source_url', 'offer_id', 'budget_line_id'):
            result[key] = getattr(detail, key) if detail else ('In Prüfung' if key == 'status' else None if key.endswith('_id') else '')
        assessment = db.session.get(FundingAssessment, item.id)
        result['assessment_inputs'] = json.loads(assessment.inputs) if assessment else {}
        result['document_ids'] = list(db.session.scalars(select(FundingDocument.document_id).where(FundingDocument.funding_id == item.id)))
        planner=app.extensions.get('phb_funding_plans')
        result['planning']=planner['summary'](item) if planner else None
        return result

    def apply_fields(item, data):
        if not isinstance(data, dict):
            raise ValueError('Ungültige Förderdaten.')
        for key, limit in [('name', 200), ('notes', 3000)]:
            if key in data:
                value = data[key]
                if not isinstance(value, str) or len(value) > limit:
                    raise ValueError('Name oder Notizen ungültig.')
                setattr(item, key, value.strip())
        if not item.name:
            raise ValueError('Fördermaßnahme fehlt.')
        for key in ('expected', 'confirmed', 'received'):
            if key in data:
                setattr(item, key, amount(data[key]))
        db.session.add(item); db.session.flush()
        detail = db.session.get(FundingDetail, item.id)
        if detail is None:
            detail = FundingDetail(funding_id=item.id)
            db.session.add(detail)
        for key, limit in [('provider', 200), ('program', 200), ('reference', 160), ('source_url', 1000), ('status', 24)]:
            if key in data:
                value = data[key]
                if not isinstance(value, str) or len(value) > limit:
                    raise ValueError('Ungültiges Förderfeld: ' + key)
                if key == 'status' and value not in STATUSES:
                    raise ValueError('Unbekannter Förderstatus.')
                if key == 'source_url' and value:
                    url = urlsplit(value)
                    if url.scheme not in ('https', 'http') or not url.hostname or url.username or url.password:
                        raise ValueError('Quellenlink muss eine HTTP(S)-Adresse sein.')
                setattr(detail, key, value.strip())
        for key in ('deadline', 'applied_on'):
            if key in data:
                value = data[key] or ''
                if value and (not isinstance(value, str) or date.fromisoformat(value).isoformat() != value):
                    raise ValueError('Ungültiges Datum.')
                setattr(detail, key, value)
        if 'assessment_inputs' in data:
            planner=app.extensions.get('phb_funding_plans')
            if planner and db.session.get(planner['models'][0],item.id):
                from funding_plans import clean_plan_inputs
                fields=clean_plan_inputs(data['assessment_inputs'])
            else:fields = clean_inputs(data['assessment_inputs'])
            record = db.session.get(FundingAssessment, item.id)
            if record is None:
                record = FundingAssessment(funding_id=item.id); db.session.add(record)
            record.inputs = json.dumps(fields, ensure_ascii=False)
        if 'document_ids' in data:
            ids = data['document_ids']
            if not isinstance(ids, list) or len(ids) > 30 or any(type(i) is not int or i <= 0 or db.session.get(ProjectDocument, i) is None for i in ids):
                raise ValueError('Ungültige Förderunterlagen.')
            for link in db.session.scalars(select(FundingDocument).where(FundingDocument.funding_id == item.id)):
                db.session.delete(link)
            db.session.flush()
            for ident in set(ids): db.session.add(FundingDocument(funding_id=item.id, document_id=ident))
        for key, model in [('offer_id', Offer), ('budget_line_id', BudgetLine)]:
            if key in data:
                value = data[key]
                key_id = int(value) if value not in ('', None) else None
                if key_id is not None and (key_id <= 0 or db.session.get(model, key_id) is None):
                    raise ValueError('Verknüpftes Angebot oder Planposition nicht gefunden.')
                setattr(detail, key, key_id)

    @app.get('/energieplanung')
    def energy_planning_page():
        return render_template('energieplanung.html', sources=SOURCES)

    @app.get('/api/energy-planning')
    def energy_planning_data():
        funding = [serialize(x) for x in db.session.scalars(select(Funding).order_by(Funding.id.desc()))]
        offers = [dict(id=x.id, vendor=x.vendor, category=x.category, status=x.status, gross=x.gross)
                  for x in db.session.scalars(select(Offer)).all()]
        lines = [dict(id=x.id, title=x.title, category=x.category) for x in db.session.scalars(select(BudgetLine)) if not x.is_group]
        summary = budget_summary(db.session.scalars(select(CostItem)).all())
        linked_ids = select(FundingDocument.document_id)
        documents = [dict(id=d.id, title=d.title, filename=d.original_name, category=d.category, extension=d.extension)
                     for d in db.session.scalars(select(ProjectDocument).where(
                         (ProjectDocument.area == 'Energetische Planung') | ProjectDocument.id.in_(linked_ids)).order_by(ProjectDocument.id.desc()))]
        return jsonify(documents=documents, funding=funding, offers=offers, budget_lines=lines, statuses=STATUSES, sources=SOURCES,
                       summary={key: summary[key] for key in ('planned', 'funding_expected', 'funding_confirmed', 'net_after_confirmed')},
                       received=round(sum(x['received'] for x in funding), 2))

    @app.post('/api/funding')
    @app.route('/api/funding/<int:funding_id>', methods=['PUT', 'DELETE'])
    def funding_save(funding_id=None):
        item = db.session.get(Funding, funding_id) if funding_id else Funding(name='')
        if item is None:
            return jsonify(error='Förderung nicht gefunden.'), 404
        try:
            if request.method == 'DELETE':
                planner=app.extensions.get('phb_funding_plans')
                if planner:
                    Plan,PlanOffer=planner['models']
                    db.session.query(PlanOffer).filter_by(funding_id=item.id).delete()
                    db.session.query(Plan).filter_by(funding_id=item.id).delete()
                db.session.query(FundingDocument).filter_by(funding_id=item.id).delete()
                db.session.query(FundingAssessment).filter_by(funding_id=item.id).delete()
                detail = db.session.get(FundingDetail, item.id)
                if detail:
                    db.session.delete(detail); db.session.flush()
                db.session.delete(item); db.session.commit()
                return jsonify(ok=True)
            apply_fields(item, request.get_json(silent=True) or {})
            db.session.commit()
            return jsonify(ok=True, **serialize(item))
        except (ValueError, TypeError, OverflowError) as exc:
            db.session.rollback()
            return jsonify(error=str(exc)), 400

    return FundingDetail, FundingAssessment, FundingDocument, serialize
