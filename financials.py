"""Unabhängige Kostenlogik für Angebotsauswahl und Eigenleistungen.

Die Projekt-Prognose setzt sich aus jeder aktiven Budgetposition genau einmal
plus unzugeordneten Zusatzpositionen zusammen. Alternativangebote zählen nicht.
"""

EXCLUDED_STATES = {'Alternative', 'Abgelehnt'}


def effective_offer(item):
    """Vorsichtige Prognose für eine einzeln ausgewählte Position."""
    if item.committed > 0:
        return max(item.committed, item.paid)
    if item.offer > 0:
        return max(item.offer, item.paid)
    return max(item.estimate, item.paid)


def forecast_lines(lines, items):
    """Returns line_forecasts, line_basis, and extra (unlinked) items.

    Verbindliche Teilaufträge können sich addieren. Nicht beauftragte
    Alternativangebote werden niemals addiert; stattdessen zählt genau das
    ausdrücklich ausgewählte Angebot oder der Schätzwert der Kostenplanposition.
    """
    active = [line for line in lines if line.active and not line.is_group]
    relevant = [item for item in items if item.state not in EXCLUDED_STATES]
    by_line = {}
    for item in relevant:
        if item.budget_line_id is not None:
            by_line.setdefault(item.budget_line_id, []).append(item)
    amounts, bases = {}, {}
    for line in active:
        positions = by_line.get(line.id, [])
        jobs = [p for p in positions if p.state in ('Beauftragt', 'Abgeschlossen') and p.committed > 0]
        selected = next((p for p in positions if p.selected), None)
        if jobs:
            amounts[line.id] = round(sum(max(p.committed, p.paid) for p in jobs), 2)
            bases[line.id] = 'Beauftragt'
        elif selected:
            amounts[line.id] = round(effective_offer(selected), 2)
            bases[line.id] = 'Ausgewähltes Angebot'
        else:
            amounts[line.id] = round(line.estimate, 2)
            bases[line.id] = 'Schätzung'
    extras = [item for item in relevant if item.budget_line_id is None]
    return amounts, bases, extras


def monetary_totals(lines, items):
    amounts, bases, extras = forecast_lines(lines, items)
    return {
        'line_forecasts': amounts,
        'line_basis': bases,
        'extra_items': extras,
        'forecast': round(sum(amounts.values()) + sum(effective_offer(x) for x in extras), 2),
        'paid': round(sum(x.paid for x in items), 2),
        'committed': round(sum(x.committed for x in items if x.state in ('Beauftragt', 'Abgeschlossen')), 2),
    }
