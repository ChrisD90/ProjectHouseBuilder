"""Explicit acceptance correction preserving the old confirmation as an audit record."""
from datetime import datetime, timezone
import math
from flask import jsonify, request
from sqlalchemy import select


def register_offer_reversals(app, db, Offer, CostItem, OrderAcceptance, *, has_dependencies, sync_costs, sync_version, serialize):
    class OfferAcceptanceReversal(db.Model):
        __tablename__ = 'offer_acceptance_reversal'
        id = db.Column(db.Integer, primary_key=True)
        offer_id = db.Column(db.Integer, db.ForeignKey('offer.id'), nullable=False)
        confirmation_document_id = db.Column(db.Integer, db.ForeignKey('document.id'), nullable=True)
        quoted_gross = db.Column(db.Numeric(12, 2), nullable=False)
        agreed_gross = db.Column(db.Numeric(12, 2), nullable=False)
        accepted_at = db.Column(db.DateTime, nullable=True)
        reversed_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    @app.post('/api/offers/<int:offer_id>/reverse-acceptance')
    def reverse_offer_acceptance(offer_id):
        offer = db.session.get(Offer, offer_id)
        if offer is None: return jsonify(error='Angebot nicht gefunden.'), 404
        body=request.get_json(silent=True)
        if not isinstance(body,dict) or body.get('confirm') is not True:
            return jsonify(error='Rücknahme ausdrücklich bestätigen.'), 400
        if offer.status not in ('Angenommen', 'Beauftragt'):
            return jsonify(error='Dieses Angebot ist nicht angenommen.'), 409
        costs = db.session.scalars(select(CostItem).where(CostItem.offer_id == offer_id)).all()
        if any(has_dependencies(item) for item in costs):
            return jsonify(error='Zugeordnete Rechnungen, Zahlungen oder Belege zuerst prüfen und ihre Zuordnung korrigieren. Die Annahme bleibt bestehen.'), 409
        try:
            accepted = db.session.scalar(select(OrderAcceptance).where(OrderAcceptance.offer_id == offer_id))
            if not accepted and (not math.isfinite(float(offer.gross or 0)) or float(offer.gross or 0)<=0):
                return jsonify(error='Die ursprüngliche Angebotssumme fehlt. Bitte zuerst im Bearbeitungsdialog prüfen und speichern.'),409
            claimed=db.session.query(Offer).filter(Offer.id==offer_id,Offer.status.in_(('Angenommen','Beauftragt'))).update({'status':'Angebot','deletion_locked':True},synchronize_session=False)
            if claimed!=1:
                db.session.rollback()
                return jsonify(error='Die Annahme wurde bereits zurückgenommen. Bitte die Ansicht aktualisieren.'),409
            db.session.add(OfferAcceptanceReversal(offer_id=offer_id,
                confirmation_document_id=accepted.confirmation_document_id if accepted else None,
                quoted_gross=accepted.quoted_gross if accepted else offer.gross,
                agreed_gross=accepted.agreed_gross if accepted else offer.gross,
                accepted_at=accepted.created_at if accepted else None))
            if accepted: db.session.delete(accepted)
            offer.status = 'Angebot'; offer.deletion_locked = True
            db.session.flush()
            sync_costs(offer); sync_version(offer)
            db.session.commit()
            return jsonify(ok=True, offer=serialize(offer))
        except ValueError as exc:
            db.session.rollback()
            return jsonify(error=str(exc)), 409

    return OfferAcceptanceReversal
