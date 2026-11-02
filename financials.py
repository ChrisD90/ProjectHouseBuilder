"""One decimal calculation path for selected offers, budgets and additional costs.

The existing API/legacy views receive numeric floats only after cent rounding.
Hours and quantities are not stored or rounded as currency.
"""
from money_values import dec,rounded,total
EXCLUDED_STATES={'Alternative','Abgelehnt'}

def effective_offer(item):
    baseline=item.committed if dec(item.committed)>0 else item.offer if dec(item.offer)>0 else item.estimate
    return float(rounded(max(dec(baseline),dec(item.paid))))

def forecast_lines(lines,items):
    active=[line for line in lines if line.active and not line.is_group]
    relevant=[item for item in items if item.state not in EXCLUDED_STATES]
    by_line={}
    for item in relevant:
        if item.budget_line_id is not None:by_line.setdefault(item.budget_line_id,[]).append(item)
    amounts,bases={},{}
    for line in active:
        positions=by_line.get(line.id,[])
        jobs=[p for p in positions if p.state in ('Beauftragt','Abgeschlossen') and dec(p.committed)>0]
        selected=next((p for p in positions if p.selected),None)
        if jobs:
            amount=total(max(dec(p.committed),dec(p.paid)) for p in jobs);basis='Beauftragt'
        elif selected:amount=dec(effective_offer(selected));basis='Ausgewähltes Angebot'
        else:amount=dec(line.estimate);basis='Schätzung'
        amounts[line.id]=float(rounded(amount));bases[line.id]=basis
    return amounts,bases,[item for item in relevant if item.budget_line_id is None]

def monetary_totals(lines,items):
    amounts,bases,extras=forecast_lines(lines,items)
    return {'line_forecasts':amounts,'line_basis':bases,'extra_items':extras,
        'forecast':float(rounded(total(amounts.values())+total(effective_offer(x) for x in extras))),
        'paid':float(rounded(total(x.paid for x in items))),
        'committed':float(rounded(total(x.committed for x in items if x.state in ('Beauftragt','Abgeschlossen'))))}
