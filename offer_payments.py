"""Manual payment completion is a marker, never a payment or financing booking."""
from decimal import Decimal

ACCEPTED=('Angenommen','Beauftragt')

def payment_totals(offers):
    totals={'agreed':Decimal(0),'paid':Decimal(0),'open':Decimal(0)}
    for offer in offers:
        if offer['status'] not in ACCEPTED:continue
        agreed=Decimal(str(offer.get('agreed_gross') or offer.get('gross') or 0))
        paid=Decimal(str((offer.get('billing') or {}).get('paid') or 0))
        totals['agreed']+=agreed
        totals['paid']+=paid
        # A surplus on one order must never cover another order's outstanding sum.
        if not offer.get('payment_completed'):totals['open']+=max(Decimal(0),agreed-paid)
    return {key:float(value.quantize(Decimal('.01'))) for key,value in totals.items()}

def register(r):
    @r.app.post('/api/offers/<int:offer_id>/payment-completion')
    def offer_payment_completion(offer_id):
        offer=r.db.session.get(r.Offer,offer_id)
        if offer is None:return r.jsonify(error='Angebot nicht gefunden.'),404
        body=r.request.get_json(silent=True)
        if not isinstance(body,dict) or set(body)!={'completed','confirm'} or type(body.get('completed')) is not bool or body.get('confirm') is not True:
            return r.jsonify(error='Bitte den Zahlungsabschluss ausdrücklich bestätigen.'),400
        if offer.status not in ACCEPTED:
            return r.jsonify(error='Der Zahlungsabschluss ist nur bei angenommenen Angeboten möglich.'),409
        offer.payment_completed=body['completed']
        r.db.session.flush()
        response=r.jsonify(offer=r.offer_dict(offer))
        r.db.session.commit()
        return response
