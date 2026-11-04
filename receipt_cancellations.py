"""Atomic invoice cancellation with retained original and immutable reversal snapshot."""
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json
from flask import jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError


def register_cancellations(app, db, Receipt, Payment, *, receipt_offer,
                           receipt_has_drawdown=lambda _rid:False,
                           validate_receipt_booking=lambda _receipt:None,
                           validate_ledger=lambda:None,
                           payment_source_exists=lambda _source,_ref:True):
    class ReceiptCancellation(db.Model):
        __tablename__='receipt_cancellation'
        id=db.Column(db.Integer,primary_key=True)
        receipt_id=db.Column(db.Integer,db.ForeignKey('receipt.id'),nullable=False,unique=True)
        created_at=db.Column(db.DateTime,nullable=False,default=datetime.utcnow)
        reason=db.Column(db.String(500),nullable=False,default='')
        snapshot_json=db.Column(db.Text,nullable=False)

    class ReceiptCancellationReversal(db.Model):
        __tablename__='receipt_cancellation_reversal'
        id=db.Column(db.Integer,primary_key=True)
        receipt_id=db.Column(db.Integer,db.ForeignKey('receipt.id',ondelete='CASCADE'),nullable=False)
        cancellation_created_at=db.Column(db.DateTime,nullable=False)
        cancellation_reason=db.Column(db.String(500),nullable=False,default='')
        cancellation_snapshot_json=db.Column(db.Text,nullable=False)
        reversed_at=db.Column(db.DateTime,nullable=False,default=datetime.utcnow)
        reason=db.Column(db.String(500),nullable=False,default='')

    def snapshot(receipt):
        payments=db.session.scalars(select(Payment).where(Payment.receipt_id==receipt.id).order_by(Payment.id)).all()
        fields={column.name:str(getattr(receipt,column.name)) if getattr(receipt,column.name) is not None else None
                for column in Receipt.__table__.columns}
        return dict(receipt=fields,payments=[{column.name:str(getattr(p,column.name)) if getattr(p,column.name) is not None else None
                                             for column in Payment.__table__.columns} for p in payments])

    def check(receipt):
        if receipt.status!='Gebucht':raise ValueError('Nur eine gebuchte Rechnung kann storniert werden.')
        if receipt_has_drawdown(receipt.id):
            raise ValueError('Die Rechnung gehört zu einem Mittelabruf. Bitte zuerst den Mittelabruf mit seinen Umbuchungen zurücknehmen.')
        offer=receipt_offer(receipt)
        if offer and receipt.billing_type!='Schlussrechnung':
            from app import CostItem
            ids=list(db.session.scalars(select(CostItem.id).where(CostItem.offer_id==offer.id)))
            final=db.session.scalar(select(Receipt.id).where(Receipt.status=='Gebucht',Receipt.id!=receipt.id,
                Receipt.cost_item_id.in_(ids),Receipt.billing_type=='Schlussrechnung').limit(1))
            if final:raise ValueError('Zuerst die Schlussrechnung stornieren oder deren Buchung zurücknehmen; sie verrechnet diese Abschlagsrechnung.')

    def digest(data):return sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()

    def cancellation_data(cancellation):
        try:data=json.loads(cancellation.snapshot_json)
        except (TypeError,json.JSONDecodeError):raise ValueError('Der gespeicherte Stornonachweis ist beschädigt.') from None
        if not isinstance(data,dict) or not isinstance(data.get('receipt'),dict) or not isinstance(data.get('payments'),list):
            raise ValueError('Der gespeicherte Stornonachweis ist unvollständig.')
        return data

    def reversal_state(receipt,cancellation):
        return {'cancellation_id':cancellation.id,
                'cancellation_created_at':cancellation.created_at.isoformat(),
                'cancellation_snapshot':cancellation.snapshot_json,
                'current_receipt':snapshot(receipt)['receipt']}

    def optional_id(value,label):
        if value in (None,'','None'):return None
        try:
            parsed=int(value)
            if parsed<=0:raise ValueError()
            return parsed
        except (TypeError,ValueError):raise ValueError(label+' im Stornonachweis ist ungültig.') from None

    def snapshot_paid(data):
        try:
            paid=Decimal(str(data['receipt'].get('paid_amount') or 0))
            if not paid.is_finite() or paid<0 or paid.as_tuple().exponent < -2:raise ValueError()
            return paid
        except (InvalidOperation,TypeError,ValueError):
            raise ValueError('Der frühere Zahlungsstand im Stornonachweis ist ungültig.') from None

    def restore_payment(receipt_id,raw):
        if not isinstance(raw,dict) or optional_id(raw.get('receipt_id'),'Rechnung')!=receipt_id:
            raise ValueError('Eine Zahlungszuordnung im Stornonachweis gehört nicht zu dieser Rechnung.')
        source=raw.get('source')
        if source not in ('loan','equity','unassigned'):
            raise ValueError('Eine Zahlungsquelle im Stornonachweis ist ungültig.')
        try:
            amount=Decimal(str(raw.get('amount')))
            if not amount.is_finite() or amount<=0 or amount.as_tuple().exponent < -2:raise ValueError()
        except (InvalidOperation,TypeError,ValueError):
            raise ValueError('Ein Zahlungsbetrag im Stornonachweis ist ungültig.') from None
        payment_date=str(raw.get('payment_date') or '')
        try:date.fromisoformat(payment_date)
        except ValueError:raise ValueError('Ein Zahlungsdatum im Stornonachweis ist ungültig.') from None
        loan_id=optional_id(raw.get('loan_id'),'Kredit')
        equity_id=optional_id(raw.get('equity_id'),'Eigenkapitalkonto')
        if (source=='loan' and (not loan_id or equity_id)
                or source=='equity' and (not equity_id or loan_id)
                or source=='unassigned' and (loan_id or equity_id)):
            raise ValueError('Eine Finanzierungszuordnung im Stornonachweis ist widersprüchlich.')
        reference=loan_id if source=='loan' else equity_id
        if source in ('loan','equity') and not payment_source_exists(source,reference):
            raise ValueError(('Der frühere Kredit' if source=='loan' else 'Das frühere Eigenkapitalkonto')+' existiert nicht mehr.')
        notes=str(raw.get('notes') or '')
        if len(notes)>2000:raise ValueError('Eine Zahlungsnotiz im Stornonachweis ist zu lang.')
        return Payment(receipt_id=receipt_id,source=source,loan_id=loan_id,equity_id=equity_id,
                       amount=amount,payment_date=payment_date,notes=notes)

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

    @app.get('/api/receipts/<int:rid>/cancel-reversal-preview')
    def cancellation_reversal_preview(rid):
        receipt=db.session.get(Receipt,rid)
        if not receipt:return jsonify(error='Rechnung nicht gefunden.'),404
        cancellation=db.session.scalar(select(ReceiptCancellation).where(ReceiptCancellation.receipt_id==rid))
        try:
            if receipt.status!='Storniert' or not cancellation:
                raise ValueError('Für diese Rechnung liegt kein aktives Storno vor.')
            data=cancellation_data(cancellation);state=reversal_state(receipt,cancellation)
            paid=snapshot_paid(data)
            response=jsonify(receipt_id=rid,supplier=receipt.supplier,number=receipt.invoice_number,
                restore_paid=float(paid),payment_count=len(data['payments']),
                allocation_count=sum(p.get('source') in ('loan','equity') for p in data['payments'] if isinstance(p,dict)),
                canceled_at=cancellation.created_at.isoformat(),plan_digest=digest(state))
            response.headers['Cache-Control']='no-store';return response
        except (ValueError,InvalidOperation) as exc:return jsonify(error=str(exc)),409

    @app.post('/api/receipts/<int:rid>/cancel-reversal')
    def cancellation_reversal_commit(rid):
        receipt=db.session.scalar(select(Receipt).where(Receipt.id==rid).with_for_update())
        if not receipt:return jsonify(error='Rechnung nicht gefunden.'),404
        cancellation=db.session.scalar(select(ReceiptCancellation).where(
            ReceiptCancellation.receipt_id==rid).with_for_update())
        body=request.get_json(silent=True) or {}
        try:
            if not isinstance(body,dict) or body.get('confirm') is not True:
                raise ValueError('Rücknahme des Stornos ausdrücklich bestätigen.')
            if receipt.status!='Storniert' or not cancellation:
                raise ValueError('Für diese Rechnung liegt kein aktives Storno vor.')
            state=reversal_state(receipt,cancellation)
            if body.get('plan_digest')!=digest(state):
                raise ValueError('Rechnung oder Stornonachweis wurden geändert. Vorschau erneut öffnen.')
            reason=body.get('reason','')
            if not isinstance(reason,str) or len(reason)>500:raise ValueError('Grund maximal 500 Zeichen.')
            if db.session.scalar(select(Payment.id).where(Payment.receipt_id==rid).limit(1)):
                raise ValueError('Zur stornierten Rechnung bestehen bereits neue Zahlungen. Rücknahme abgebrochen.')
            data=cancellation_data(cancellation)
            paid=snapshot_paid(data)
            receipt.status='Gebucht';receipt.paid_amount=paid
            for raw in data['payments']:db.session.add(restore_payment(rid,raw))
            validate_receipt_booking(receipt)
            db.session.flush();validate_ledger()
            db.session.add(ReceiptCancellationReversal(receipt_id=rid,
                cancellation_created_at=cancellation.created_at,
                cancellation_reason=cancellation.reason,
                cancellation_snapshot_json=cancellation.snapshot_json,
                reason=reason.strip()))
            db.session.delete(cancellation);db.session.commit()
            return jsonify(ok=True,status='Gebucht',paid=float(paid),payment_count=len(data['payments']))
        except (ValueError,TypeError,InvalidOperation,IntegrityError) as exc:
            db.session.rollback()
            return jsonify(error=str(exc) if isinstance(exc,ValueError) else 'Storno konnte nicht sicher zurückgenommen werden.'),409

    return ReceiptCancellation,ReceiptCancellationReversal
