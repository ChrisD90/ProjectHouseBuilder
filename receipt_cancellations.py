"""Atomic invoice cancellation with retained original and immutable reversal snapshot."""
from datetime import datetime
from hashlib import sha256
import json
from flask import jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError


def register_cancellations(app, db, Receipt, Payment, *, receipt_offer):
    class ReceiptCancellation(db.Model):
        __tablename__='receipt_cancellation'
        id=db.Column(db.Integer,primary_key=True)
        receipt_id=db.Column(db.Integer,db.ForeignKey('receipt.id'),nullable=False,unique=True)
        created_at=db.Column(db.DateTime,nullable=False,default=datetime.utcnow)
        reason=db.Column(db.String(500),nullable=False,default='')
        snapshot_json=db.Column(db.Text,nullable=False)

    def snapshot(receipt):
        payments=db.session.scalars(select(Payment).where(Payment.receipt_id==receipt.id).order_by(Payment.id)).all()
        fields={column.name:str(getattr(receipt,column.name)) if getattr(receipt,column.name) is not None else None
                for column in Receipt.__table__.columns}
        return dict(receipt=fields,payments=[{column.name:str(getattr(p,column.name)) if getattr(p,column.name) is not None else None
                                             for column in Payment.__table__.columns} for p in payments])

    def check(receipt):
        if receipt.status!='Gebucht':raise ValueError('Nur eine gebuchte Rechnung kann storniert werden.')
        offer=receipt_offer(receipt)
        if offer and receipt.billing_type!='Schlussrechnung':
            from app import CostItem
            ids=list(db.session.scalars(select(CostItem.id).where(CostItem.offer_id==offer.id)))
            final=db.session.scalar(select(Receipt.id).where(Receipt.status=='Gebucht',Receipt.id!=receipt.id,
                Receipt.cost_item_id.in_(ids),Receipt.billing_type=='Schlussrechnung').limit(1))
            if final:raise ValueError('Zuerst die Schlussrechnung stornieren oder deren Buchung zurücknehmen; sie verrechnet diese Abschlagsrechnung.')

    def digest(data):return sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()

    @app.get('/api/receipts/<int:rid>/cancel-preview')
    def cancellation_preview(rid):
        receipt=db.session.get(Receipt,rid)
        if not receipt:return jsonify(error='Rechnung nicht gefunden.'),404
        try:
            check(receipt);data=snapshot(receipt)
            response=jsonify(receipt_id=rid,supplier=receipt.supplier,number=receipt.invoice_number,
                paid=float(receipt.paid_amount or 0),counted=float((receipt.gross_amount or 0)-(receipt.advance_deduction or 0)),
                payment_count=len(data['payments']),allocation_count=sum(p['source'] in ('loan','equity') for p in data['payments']),plan_digest=digest(data))
            response.headers['Cache-Control']='no-store';return response
        except ValueError as exc:return jsonify(error=str(exc)),409

    @app.post('/api/receipts/<int:rid>/cancel')
    def cancellation_commit(rid):
        receipt=db.session.scalar(select(Receipt).where(Receipt.id==rid).with_for_update())
        if not receipt:return jsonify(error='Rechnung nicht gefunden.'),404
        body=request.get_json(silent=True) or {}
        try:
            if not isinstance(body,dict) or body.get('confirm') is not True:raise ValueError('Stornierung ausdrücklich bestätigen.')
            check(receipt);data=snapshot(receipt)
            if body.get('plan_digest')!=digest(data):raise ValueError('Rechnung oder Zahlungen wurden geändert. Vorschau erneut öffnen.')
            reason=body.get('reason','')
            if not isinstance(reason,str) or len(reason)>500:raise ValueError('Stornogrund maximal 500 Zeichen.')
            db.session.add(ReceiptCancellation(receipt_id=rid,reason=reason.strip(),snapshot_json=json.dumps(data,ensure_ascii=False)))
            for payment in db.session.scalars(select(Payment).where(Payment.receipt_id==rid)).all():db.session.delete(payment)
            receipt.paid_amount=0;receipt.status='Storniert'
            db.session.commit();return jsonify(ok=True,status='Storniert')
        except (ValueError,TypeError,IntegrityError) as exc:
            db.session.rollback()
            return jsonify(error=str(exc) if isinstance(exc,ValueError) else 'Stornierung konnte nicht sicher gespeichert werden.'),409

    return ReceiptCancellation
