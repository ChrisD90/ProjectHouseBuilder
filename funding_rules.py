"""Shared funding stages: early planning versus application-ready technical proof."""
from datetime import date
from calendar import monthrange
PROGRAMS={'bafa_envelope','kfw_458'}

def technical_requirements(inputs):
    return [
      ('technical','Technische Mindestanforderungen',inputs.get('technical_verified')=='yes','Noch nicht bestätigte technische Angaben bleiben ausdrücklich unter Vorbehalt.'),
      ('expert','Energieberatung / Fachbetrieb',inputs.get('expert_involved')=='yes','Erforderliche Fachleute rechtzeitig einbinden; kein Hindernis allein für einen frühen Entwurf.'),
      ('proof','TPB / BzA vorbereiten',inputs.get('proof') in ('prepared','available'),'Für die Antragstellung technische Projektbeschreibung (BAFA) bzw. Bestätigung zum Antrag (KfW) vorbereiten.')]

def planning_checklist(snap):
    i = snap['inputs']
    key = i.get('program_key')
    checks = []
    targets = {'measure': ['measure'], 'program': ['program_key'], 'object': ['postcode', 'units', 'ownership', 'usage'], 'dates': ['building_application', 'application_date'], 'start': ['contract', 'started'], 'costs': ['selections'], 'budget': ['vat_deductible', 'used_budget', 'cumulation_reviewed'], 'technical': ['technical_verified'], 'technical_failed': ['technical_verified'], 'expert': ['expert_involved'], 'proof': ['proof'], 'isfp': ['isfp', 'isfp_date', 'isfp_measure', 'document_ids'], 'heating': ['old_heating', 'old_heating_year', 'new_heating', 'natural_refrigerant'], 'bonus': ['bonus_requested', 'usage', 'household_income', 'children']}
    labels = {'measure': 'Beschreibung (mindestens 10 Zeichen)', 'program_key': 'Programm', 'postcode': 'Objekt-Postleitzahl', 'units': 'Wohneinheiten (mindestens 1)', 'ownership': 'Privateigentum – andere Antragsteller individuell prüfen', 'usage': 'Nutzung', 'building_application': 'Datum des Bauantrags / der Bauanzeige', 'application_date': 'geplanter Förderantrag', 'contract': 'Vertragsstatus (noch nicht unterschrieben oder förderkonforme Bedingung)', 'started': 'Ausführung noch nicht begonnen', 'selections': 'Angebot, ausgewählte Positionen und positiver Kostenanteil', 'vat_deductible': 'Vorsteuerabzug', 'used_budget': 'bereits genutzte förderfähige Kosten (ggf. 0)', 'cumulation_reviewed': 'Prüfung weiterer Förderungen und Steuerermäßigungen', 'technical_verified': 'fachliche Prüfung der technischen Mindestanforderungen', 'expert_involved': 'Einbindung von Energieberatung / Fachbetrieb', 'proof': 'TPB / BzA', 'isfp': 'iSFP ja/nein', 'isfp_date': 'Datum des iSFP vor dem Förderantrag', 'isfp_measure': 'Bestätigung der Maßnahme im iSFP', 'document_ids': 'zugeordnete aktuelle Unterlage der Kategorie iSFP', 'old_heating': 'bisherige Heizung', 'old_heating_year': 'Inbetriebnahmejahr der alten Heizung', 'new_heating': 'geplante Heizung', 'natural_refrigerant': 'Kältemittel', 'bonus_requested': 'persönliche Boni ja/nein', 'household_income': 'maßgebliches Haushaltseinkommen (ggf. 0)', 'children': 'berücksichtigungsfähige Kinder (ggf. 0)'}
    field_valid = {'measure': len(i.get('measure', '')) >= 10, 'program_key': key in PROGRAMS, 'postcode': bool(i.get('postcode')), 'units': 1 <= i.get('units', 0) <= 10000, 'ownership': i.get('ownership') == 'private_owner', 'usage': i.get('usage') in ('self', 'rented', 'mixed'), 'building_application': bool(i.get('building_application')), 'application_date': bool(i.get('application_date')), 'contract': i.get('contract') in ('not_signed', 'conditional'), 'started': i.get('started') == 'no', 'selections': False, 'vat_deductible': i.get('vat_deductible') in ('yes', 'no'), 'used_budget': 'used_budget' in i, 'cumulation_reviewed': i.get('cumulation_reviewed') == 'yes', 'technical_verified': i.get('technical_verified') == 'yes', 'expert_involved': i.get('expert_involved') == 'yes', 'proof': i.get('proof') in ('prepared', 'available'), 'isfp': i.get('isfp') in ('yes', 'no'), 'isfp_date': bool(i.get('isfp_date') and i.get('application_date') and (i['isfp_date'] <= i['application_date'])), 'isfp_measure': i.get('isfp_measure') == 'yes', 'document_ids': any((d['category'] == 'iSFP' and d['status'] != 'Überholt' for d in snap['documents'])), 'old_heating': bool(i.get('old_heating')), 'new_heating': bool(i.get('new_heating')), 'old_heating_year': 1900 <= i.get('old_heating_year', 0) <= date.today().year, 'natural_refrigerant': i.get('natural_refrigerant') in ('yes', 'no', 'not_applicable'), 'bonus_requested': i.get('bonus_requested') in ('yes', 'no'), 'household_income': 'household_income' in i, 'children': 'children' in i}

    def add(code, title, ok, detail, blocking=True):
        fields = targets[code]
        if code == 'isfp' and i.get('isfp') != 'yes':
            fields = ['isfp']
        if code == 'bonus' and i.get('bonus_requested') != 'yes':
            fields = ['bonus_requested']
        missing = [field for field in fields if not field_valid[field]] if not ok else []
        if code == 'bonus' and i.get('bonus_requested') == 'yes' and (i.get('usage') != 'self') and ('usage' not in missing):
            missing.insert(0, 'usage')
        if not ok and (not missing):
            missing = fields
        checks.append(dict(key=code, title=title, status='present' if ok else 'open' if blocking else 'confirm', detail=detail, fields=fields, missing_fields=missing, missing_labels=[labels[field] for field in missing], blocks_estimate=not ok and blocking))
    add('measure', 'Vorhaben beschreiben', len(i.get('measure', '')) >= 10, 'Maßnahme und technische Ausführung beschreiben.')
    add('program', 'Programm wählen', key in PROGRAMS, 'BAFA Gebäudehülle oder KfW 458 wählen; vorher ist eine offene Programmrecherche möglich.')
    add('object', 'Objekt und Antragsteller', bool(i.get('postcode')) and 1 <= i.get('units', 0) <= 10000 and (i.get('ownership') == 'private_owner') and (i.get('usage') in ('self', 'rented', 'mixed')), 'PLZ, Wohneinheiten, Privateigentum und Nutzung angeben. Spezialfälle bleiben manuell prüfbar.')
    old = False
    try:
        applied = date.fromisoformat(i.get('application_date', ''))
        built = date.fromisoformat(i.get('building_application', ''))
        old = built <= date(applied.year - 5, applied.month, min(applied.day, monthrange(applied.year - 5, applied.month)[1]))
    except (ValueError, TypeError):
        pass
    add('dates', 'Gebäudealter und Antragstermin', old, 'Bauantrag/Bauanzeige mindestens fünf Jahre vor dem geplanten Förderantrag.')
    add('start', 'Vertrag und Vorhabenbeginn', i.get('contract') in ('not_signed', 'conditional') and i.get('started') == 'no', 'Unbedingte Beauftragung und bereits begonnene Ausführung individuell klären.')
    selected = snap['offers']
    cap = 0
    costs = bool(selected)
    for o in selected:
        limit = o.get('net') if i.get('vat_deductible') == 'yes' and o.get('net') is not None else o['gross']
        value = o['eligible_cost']
        valid = o['status'] not in ('Entwurf', 'Abgelehnt', 'Entfernt') and (not o['missing_positions']) and (not o['positions'] or bool(o['position_ids'])) and (value is not None) and (0 < value <= limit)
        costs = costs and valid
        if valid:
            cap += value
    add('costs', 'Angebote und förderfähige Kosten', costs, 'Geprüfte Angebote, betroffene Positionen und Kostenanteile festlegen. Bei Vorsteuerabzug Nettokosten verwenden.')
    add('budget', 'Weitere Förderung und Steuern', i.get('vat_deductible') in ('yes', 'no') and 'used_budget' in i and (i.get('cumulation_reviewed') == 'yes'), 'Vorsteuer, bereits genutzte Kostengrenzen und Doppelförderung prüfen, auch außerhalb dieses Projekts.')
    for code,title,ok,detail in technical_requirements(i):
        add(code,title,ok,detail,False)
    if i.get('technical_verified')=='no':
        add('technical_failed','Technik fachlich klären',False,'Die technischen Mindestanforderungen sind laut Angabe nicht erfüllt.')
    if key == 'bafa_envelope':
        isfp = i.get('isfp') == 'no'
        if i.get('isfp') == 'yes':
            isfp = bool(i.get('isfp_date') and i.get('application_date') and (i['isfp_date'] <= i['application_date']) and (i.get('isfp_measure') == 'yes') and any((d['category'] == 'iSFP' and d['status'] != 'Überholt' for d in snap['documents'])))
        add('isfp', 'iSFP einordnen', isfp, 'Ohne Bonus planen oder passenden iSFP mit Datum, enthaltener Maßnahme und Unterlage angeben. Kein automatischer Bonus.')
    if key == 'kfw_458':
        add('heating', 'Bisherige und neue Heizung', bool(i.get('old_heating')) and bool(i.get('new_heating')) and (1900 <= i.get('old_heating_year', 0) <= date.today().year) and (i.get('natural_refrigerant') in ('yes', 'no', 'not_applicable')), 'Heizungstechnik, Inbetriebnahme und Kältemittel/Effizienzbonus einordnen.')
        bonus = i.get('bonus_requested') == 'no' or (i.get('bonus_requested') == 'yes' and i.get('usage') == 'self' and ('household_income' in i) and ('children' in i))
        add('bonus', 'Persönliche Boni', bonus, 'Boni ausschließen oder Selbstnutzung und erforderliche persönliche Angaben ergänzen.')
    return dict(items=checks, orientation_ready=bool(snap['name'] and len(i.get('measure', '')) >= 10), estimate_ready=not any((c['blocks_estimate'] for c in checks)), eligible_cost=round(cap, 2))
