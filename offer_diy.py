"""Non-binding quote scenarios. Never change order acceptance or financial ledgers."""
from decimal import Decimal, ROUND_HALF_UP

def estimate(offer):
    selected=[p for p in offer.positions if p.own_work and not p.optional]
    gross=Decimal(str(offer.gross)) if offer.gross is not None else None
    result=dict(selected_count=len(selected),selected_net=0,selected_gross=0,remaining_gross=float(gross) if gross is not None else None,complete=True,reason='')
    if not selected:return result
    if any(p.net_amount is None for p in selected):
        return {**result,'complete':False,'remaining_gross':None,'reason':'Bei ausgewählten Positionen fehlen Nettobeträge.'}
    net=sum((Decimal(str(p.net_amount)) for p in selected),Decimal('0'))
    result['selected_net']=float(net)
    if gross is None or offer.net is None or Decimal(str(offer.net))<=0:
        return {**result,'complete':False,'selected_gross':None,'remaining_gross':None,'reason':'Für den Bruttopreis müssen Angebotsnetto und Angebotsbrutto bekannt sein.'}
    original_net=Decimal(str(offer.net))
    if net>original_net:
        return {**result,'complete':False,'selected_gross':None,'remaining_gross':None,'reason':'Die ausgewählten Positionen übersteigen die Angebotsnettosumme. Bitte Beträge prüfen.'}
    deduction=(net*gross/original_net).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
    return {**result,'selected_gross':float(deduction),'remaining_gross':float(gross-deduction)}
