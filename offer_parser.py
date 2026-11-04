"""PDF-Angebotsanalyse ohne externe Dienste.

Beträge werden aus einem textbasierten PDF extrahiert. Das Parsergebnis ist stets
**unbestätigt** und darf erst nach Prüfung einer Budgetposition zugeordnet werden.
Währungsarithmetik über Decimal, PDF-Tabellen dürfen ungewöhnlich formatiert sein.
"""
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
import re
from pypdf import PdfReader
from receipt_parser import extract_pdf_pages

MONEY = re.compile(r'(?:€\s*([\d.]+,\d{2})|([\d.]+,\d{2})\s*€)')
REW_POSITION = re.compile(r'^\s*(\d{1,2})\s+(\d[\d.]*,\d{2})\s+(Stk\.?|M2\.?|M\.?|kWp\.?)\s+(.+)$', re.I)
P3_POSITION = re.compile(r'^\s*(\d{1,2}(?:\.\d{1,2})?)\s*(\d[\d.]*,\d{2})\s*(Stck|St\.?|mtr|Std|m2)\s*(.+)$', re.I)
CENT = Decimal('0.01')


def euros(value):
    if value is None or value == '':
        return None
    return Decimal(str(value).replace('.', '').replace(',', '.')).quantize(CENT)


def amount(value):
    return float(value.quantize(CENT, rounding=ROUND_HALF_UP))


def pdf_to_pages(data):
    try:
        pages,_=extract_pdf_pages(data, max_pages=40,layout=True)
    except ValueError as exc:
        if 'verschlüsselt' in str(exc).lower():
            raise ValueError('Verschlüsseltes PDF: zuerst lokal entsperren.') from exc
        raise
    if not any(len(page.strip()) > 25 for page in pages):
        raise ValueError('Keine lesbare Textebene oder lokaler OCR-Text vorhanden.')
    return pages


def _find_total(text, label):
    pattern = re.compile(r'^\s*' + label + r'\s*:?[^\n]*?€?\s*([\d.]+,\d{2})\s*€?\s*$', re.I | re.M)
    matches = pattern.findall(text)
    return euros(matches[-1]) if matches else None


def _section_for(number, family, preceding):
    if family == 'P3':
        prefix = number.split('.')[0]
        return {'1':'Elektroverteilungen', '2':'Kabel und Leitungen','3':'Verlegesysteme und Leerrohr',
                '4':'Schaltgeräte und Steckdosen','5':'Schwachstrom / Netzwerk / Sprechanlage',
                '6':'Beleuchtung / Sonstiges', '7':'Stundensätze bei Bedarf', '8':'Stundensätze bei Bedarf',
                '9':'Stundensätze bei Bedarf'}.get(prefix, 'Weitere Leistungen')
    num = int(number)
    if family == 'PV':
        return 'Photovoltaik und Speicher' if num <= 2 else 'PV-Zubehör und Anschlüsse'
    if family == 'WP':
        return ('Wärmepumpe und Speicher' if num <= 10 else 'Energiekonzept und Planung' if num == 11 else
                'Elektroanschluss Wärmepumpe' if num == 12 else 'Fußbodenheizung')
    return preceding or 'Weitere Leistungen'


def _family(text, filename):
    """Decide on known *layout families*, not hard-coded customer/offer IDs."""
    if re.search(r'Summe Photovoltaik:', text, re.I) and re.search(r'PHOTOVOLTAIKANLAGE',text, re.I):
        return 'PV'
    if re.search(r'Summe Wärmepumpe',text,re.I) and re.search(r'FUSS?BODENHEIZUNG|FUßBODENHEIZUNG',text,re.I):
        return 'WP'
    if re.search(r'Elektroverteilungen',text,re.I) and re.search(r'Nettosumme',text,re.I):
        return 'P3'
    return 'Andere'


def _vendor(text):
    for line in text.splitlines()[:28]:
        found=re.search(r'^\s*(.{2,90}?\b(?:GmbH|AG|GbR|e\.K\.|KG))\b',line,re.I)
        if found:
            return found.group(1).strip()
    return 'Firma nicht erkannt'


def parse_offer(pages, filename='Angebot.pdf'):
    if not pages:
        raise ValueError('Das Dokument enthält keine lesbaren Seiten.')
    text = '\n'.join(pages)
    family = _family(text,filename)
    vendor=_vendor(text)
    if family in ('WP','PV'):
        nr=re.search(r'Angebot-Nr\.?:\s*([\w-]+)',text)
        issued=re.search(r'Datum:\s*(\d{2}\.\d{2}\.\d{4})',text)
        expires=re.search(r'Gültig bis:\s*(\d{2}\.\d{2}\.\d{4})',text)
    elif family == 'P3':
        nr=re.search(r'Angebot\s+([0-9]{2}/[0-9A-Z]+)',text,re.I)
        issued=re.search(r'(\d{2}\.\d{2}\.\d{4})',text)
        expires=None
    else:
        nr=re.search(r'Angebot(?:snummer|-Nr\.)?\s*:?\s*([\w/-]+)',text,re.I)
        issued=None; expires=None
    net = _find_total(text, r'(?:Nettosumme|Listenpreis)')
    gross = _find_total(text, r'Gesamtsumme')
    vat = _find_total(text, r'(?:Umsatzsteuer(?:\s+19\s*%)?|Mehrwertsteuer\s*\(MwSt\.?:\s*\d+\s*%\))')
    warnings=[]
    if not gross:
        warnings.append('Keine eindeutige Gesamtsumme erkannt; Import kann nicht für Prognose aktiviert werden.')
    if net is None:
        warnings.append('Nettosumme konnte nicht sicher ermittelt werden.')
    positions=[]
    for page_number,page in enumerate(pages,1):
        lines=page.splitlines()
        for idx,line in enumerate(lines):
            match= (REW_POSITION if family in ('WP','PV') else P3_POSITION).match(line)
            if not match: continue
            no, qty, unit, desc = match.groups()
            # P3 headline rows do not carry any price; ignore these.
            if not ('€' in desc or 'E.P.' in desc): continue
            money=[euros(a or b) for a,b in MONEY.findall(desc)]
            following=[]
            for next_line in lines[idx+1:idx+6]:
                if REW_POSITION.match(next_line) or P3_POSITION.match(next_line):break
                following.append(next_line)
            optional='E.P.' in desc or any('Optionalposition' in x for x in following)
            if family == 'P3' and any('Falls erforderlich' in x for x in lines[max(0,idx-2):idx]):
                optional=True
            unit_price=money[-2] if len(money)>=2 else money[0] if money else None
            total=money[-1] if len(money)>=2 and not ('E.P.' in desc) else None
            # P3 may include E.P. with a single unit price; no total to add.
            if total is None and family != 'P3' and not optional and money:
                total=money[-1]
            desc_clean=desc
            if money:
                left=desc.find('€')
                if family=='P3':
                    mm=re.search(r'\d[\d.]*,\d{2}\s*€',desc)
                    if mm:left=mm.start()
                if left>=0:desc_clean=desc[:left]
            desc_lines=[desc_clean.strip()]
            # include at most one continuing title line (not equipment descriptions / bank footers)
            if idx+1<len(lines):
                continued=lines[idx+1].strip()
                if continued and len(continued)<75 and not continued.startswith(('Optionalposition','Pos.','Übertrag','Liefern','Technische')):
                    if family in ('PV','WP') and (len(desc_clean.strip())>15 or continued.startswith(('BLACK','BATTERY','SMART','AUSSEN'))):
                        desc_lines.append(continued)
            pos={'number':no,'quantity':float(euros(qty)),'unit':unit.strip(),
                 'description':' '.join(desc_lines).strip()[:260],
                 'section':_section_for(no,family,''),'unit_price':amount(unit_price) if unit_price is not None else None,
                 'net_amount':amount(total) if total is not None and not optional else 0.0,
                 'optional_amount':amount(total) if total is not None and optional else None,
                 'optional':optional,'page':page_number}
            positions.append(pos)
    # Reject duplicate numbers if document has repeated summary/recap
    unique={}; duplicates=[]
    for pos in positions:
        if pos['number'] in unique:
            duplicates.append(pos['number'])
        else:unique[pos['number']]=pos
    positions=list(unique.values())
    if duplicates and family != 'P3':warnings.append('Mehrfach gefundene Positionsnummern ignoriert: '+', '.join(duplicates))
    if not positions:warnings.append('Keine eindeutig lesbaren Einzelpositionen erkannt.')
    sums=defaultdict(lambda: Decimal('0.00'))
    for p in positions:
        if not p['optional']:
            sums[p['section']]+=Decimal(str(p['net_amount']))
    included_sum=sum(sums.values(),Decimal('0.00'))
    delta=amount(included_sum-net) if net is not None else None
    if delta is not None and abs(delta)>0.02:
        warnings.append(f'Abweichung: Einzelpositionen {amount(included_sum):,.2f} € netto, Dokument {amount(net):,.2f} € netto. Bitte prüfen.')
    tax_rate=amount((gross/net-1)*100) if net and gross is not None else 0
    groups=[]
    group_names=list(sums)
    for index,name in enumerate(group_names):
        net_value=sums[name]
        gross_value=(net_value*Decimal(str(gross))/net).quantize(CENT,rounding=ROUND_HALF_UP) if gross is not None and net else net_value
        groups.append({'name':name,'net':amount(net_value),'gross':amount(gross_value),
                       'suggested_budget_code':({'PV':'K13','P3':'K11','WP':'K19' if name=='Fußbodenheizung' else 'K15'}.get(family,'')),
                       'selected':False})
    if gross is not None and net is not None and abs(included_sum-net)<=Decimal('0.02') and groups:
        # Allocate VAT rounding cents to final group to reconcile exact gross.
        remainder=gross-sum(Decimal(str(g['gross'])) for g in groups)
        groups[-1]['gross']=amount(Decimal(str(groups[-1]['gross']))+remainder)
    return {'filename':filename,'family':family,'vendor':vendor,'number':nr.group(1) if nr else '',
            'issued':issued.group(1) if issued else '', 'expires':expires.group(1) if expires else '',
            'net':amount(net) if net is not None else None,'vat':amount(vat) if vat is not None else None,
            'gross':amount(gross) if gross is not None else None,'tax_rate':round(tax_rate,2),
            'positions':positions,'groups':groups,'reconciliation_delta':delta,'warnings':warnings,
            'reconciled':bool(net is not None and gross is not None and positions and abs(included_sum-net)<=Decimal('0.02'))}


def parse_pdf(data, filename):
    return parse_offer(pdf_to_pages(data),filename)
