"""Local-only receipt text extraction. Suggestions are never booked automatically."""
from datetime import datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
import re
import subprocess
import tempfile
from pathlib import Path
from pypdf import PdfReader

CATEGORY_RULES = {
    'Elektro': ['elektro', 'kabel', 'leitung', 'steckdose', 'shelly', 'schalter', 'sicherung', 'voltus'],
    'Sanitär': ['sanitär', 'wasserrohr', 'armatur', 'wc', 'waschtisch', 'dusch', 'viega', 'geberit'],
    'Heizung': ['wärmepumpe', 'heizung', 'heizkörper', 'fußbodenheizung', 'heizkreis'],
    'Werkzeug': ['werkzeug', 'bohrer', 'akkuschrauber', 'bit-set', 'sägeblatt', 'bosch professional', 'makita'],
    'Eigenleistungen / Material': ['baustoff', 'baumarkt', 'hornbach', 'bauhaus', 'obi', 'schraube', 'spachtel', 'osb'],
    'Dach': ['dachziegel', 'dachdecker', 'dachstuhl', 'sparren'],
    'Fenster & Türen': ['fenster', 'haustür', 'rollladen', 'fensterbank'],
    'Innenausbau': ['trockenbau', 'rigips', 'gipskarton', 'putz', 'estrich', 'bodenbelag'],
    'Photovoltaik': ['photovoltaik', 'wechselrichter', 'solarmodul', 'batteriespeicher'],
}
CATEGORIES = list(CATEGORY_RULES) + ['Sonstiges']
AMOUNT = re.compile(r'(?<![\d./])(?:\d{1,3}(?:[.\s]\d{3})+|\d{1,8}),\d{2}(?!\d)|(?<![\d./])\d{1,8}\.\d{2}(?!\d)')
DATE = re.compile(r'\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b')
MONEY_LINE = re.compile(r'(?:€|\beur\b|\beuro\b)', re.I)


def decimal_amount(s):
    """Parse standard German money and simple dot decimals without silent rounding."""
    if not isinstance(s, str):
        return None
    raw = s.strip().replace('\N{NO-BREAK SPACE}', '').replace(' ', '')
    if ',' in raw:
        raw = raw.replace('.', '').replace(',', '.')
    try:
        value = Decimal(raw)
        return value.quantize(Decimal('0.01')) if value.is_finite() and value >= 0 else None
    except (InvalidOperation, ValueError):
        return None


def extract_text(data, filename):
    suffix=Path(filename).suffix.lower()
    if suffix=='.pdf':
        pdf=PdfReader(BytesIO(data))
        if pdf.is_encrypted: raise ValueError('PDF ist verschlüsselt.')
        if len(pdf.pages)>15: raise ValueError('Maximal 15 PDF-Seiten pro Beleg.')
        pages=[p.extract_text() or '' for p in pdf.pages]
        text='\n'.join(pages)
        if len(text.strip())>35: return text[:80000], 'PDF-Text'
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'input.pdf';path.write_bytes(data)
            try:
                subprocess.run(['pdftoppm','-f','1','-l',str(min(len(pages),5)),'-r','170','-gray','-png',str(path),str(Path(tmp)/'page')],timeout=40,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
                results=[]
                for image in sorted(Path(tmp).glob('page-*.png')):
                    results.append(_ocr(str(image)))
                return '\n'.join(results)[:80000], 'OCR (PDF)'
            except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.CalledProcessError) as e:
                raise ValueError('OCR nicht verfügbar oder fehlgeschlagen (Tesseract/Poppler prüfen).') from e
    if suffix in ('.jpg','.jpeg','.png','.webp'):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/('scan'+suffix);path.write_bytes(data)
            return _ocr(str(path))[:80000], 'OCR (Foto)'
    raise ValueError('Nur PDF, JPG, PNG oder WEBP unterstützt.')

def _ocr(path):
    try:
        r=subprocess.run(['tesseract',path,'stdout','-l','deu+eng','--psm','3'],timeout=35,check=True,capture_output=True,text=True)
        return r.stdout
    except (FileNotFoundError, subprocess.TimeoutExpired, subprocess.CalledProcessError) as e:
        raise ValueError('OCR nicht verfügbar. Tesseract mit deutscher Sprache installieren.') from e

def category_for(text):
    lower=text.lower()
    scores={k:sum(2 if token in lower[:280] else 1 for token in words if token in lower) for k,words in CATEGORY_RULES.items()}
    winner=max(scores,key=scores.get)
    return winner if scores[winner]>0 else 'Sonstiges'

def _date_iso(value):
    raw=value.replace('/','.').replace('-','.')
    for fmt in ('%d.%m.%Y','%d.%m.%y'):
        try: return datetime.strptime(raw,fmt).date().isoformat()
        except ValueError: pass
    return ''


def _extract_labeled_date(lines, pattern):
    for idx,line in enumerate(lines):
        if re.search(pattern,line,re.I):
            match=DATE.search(line)
            if not match and idx+1<len(lines):match=DATE.search(lines[idx+1])
            if match:return _date_iso(match.group(1))
    return ''


def _line_money(lines, idx):
    # Invoice labels are sometimes followed by the amount on the next line.
    here=AMOUNT.findall(lines[idx])
    if here:return decimal_amount(here[-1])
    if idx+1<len(lines):
        following=lines[idx+1]
        if len(following)<55 or MONEY_LINE.search(following):
            amounts=AMOUNT.findall(following)
            if amounts:return decimal_amount(amounts[-1])
    return None



LABOR_LABEL = re.compile(
    r'\b(?:lohn(?:kosten|anteil)?|arbeits(?:lohn|kosten|leistung(?:en)?|zeit)|'
    r'handwerker(?:leistung(?:en)?|lohn|kosten)|montage(?:leistung(?:en)?|arbeit(?:en)?|kosten|lohn)?|'
    r'personalkosten)\b', re.I
)
LABOR_EXCLUDE = re.compile(
    r'(?:material|waren|lieferung|montagematerial|lohnsteuer|lohnnebenkosten|'
    r'(?:ohne|keine)\s+(?:arbeits|lohn)kosten)', re.I
)
LABOR_TOTAL = re.compile(
    r'(?:summe|gesamt|davon|anteil|nach\s+§?\s*35\s*a|absetzbar|steuerlich)', re.I
)
VAT_RATE = re.compile(
    r'(?:\b(?:mwst|ust|umsatzsteuer|mehrwertsteuer)\b.{0,22}?\b(7|19)\s*%'
    r'|\b(7|19)\s*%.{0,22}?\b(?:mwst|ust|umsatzsteuer|mehrwertsteuer)\b)',re.I
)


def extract_labor_amount(text, gross=None):
    """Find explicitly billed labor amounts, never derive them from full invoice totals.

    A labor figure without a stated tax basis is only a draft, with a warning.
    Net labor is converted to gross only if one unambiguous VAT rate is printed.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    matched = []
    warnings = []
    rates = {int(a or b) for a,b in VAT_RATE.findall(text)}
    rate = next(iter(rates)) if len(rates) == 1 else None
    for ix, line in enumerate(lines):
        found = LABOR_LABEL.search(line)
        if not found or LABOR_EXCLUDE.search(line):
            continue
        # Prefer the value after "Lohnkosten". Do not confuse the number of
        # hours or the percentage with the line item's euro amount.
        trailing = line[found.end():]
        values = AMOUNT.findall(trailing)
        if not values and ix+1 < len(lines):
            follow = lines[ix+1]
            if len(follow) <= 35 and (AMOUNT.fullmatch(follow) or MONEY_LINE.search(follow)):
                values = AMOUNT.findall(follow)
        if not values:
            continue
        value = decimal_amount(values[-1])
        if value is None:
            continue
        context=line.lower()
        label_net=bool(re.search(r'\bnetto\b|\bohne\s+(?:mwst|ust|steuer)\b',context))
        label_gross=bool(re.search(r'\bbrutto\b|\binkl?\.?\s*(?:mwst|ust|steuer)\b|einschl',context))
        if label_net and label_gross:
            warnings.append('Lohnkosten weisen widersprüchliche Netto-/Bruttoangaben auf.')
            continue
        if label_net:
            if rate is None:
                warnings.append('Lohnkosten nur netto angegeben: USt-Satz nicht eindeutig, Brutto-Lohnanteil bitte selbst eintragen.')
                continue
            value = (value * (Decimal('1')+Decimal(rate)/100)).quantize(Decimal('0.01'))
        elif not label_gross:
            warnings.append('Lohnkosten erkannt, aber Netto-/Bruttoausweis unklar. Bitte den Bruttoanteil prüfen.')
        matched.append((bool(LABOR_TOTAL.search(line)), value))
    if not matched:
        return None, list(dict.fromkeys(warnings))
    totals={value for subtotal,value in matched if subtotal}
    if len(totals)==1:
        labor=next(iter(totals))
    elif len(totals)>1:
        warnings.append('Mehrere unterschiedliche Lohnkosten-Summen erkannt. Bitte manuell prüfen.')
        return None, list(dict.fromkeys(warnings))
    else:
        labor=sum((value for _is_total,value in matched),Decimal('0.00'))
        if len(matched)>1:
            warnings.append('Mehrere Arbeitspositionen addiert. Bitte prüfen, ob Teilbeträge bereits enthalten sind.')
    amount=decimal_amount(str(gross)) if gross not in ('',None) else None
    if amount is not None and labor > amount:
        warnings.append('Erkannter Arbeitslohn liegt über dem Rechnungsbrutto – Lohnanteil bitte manuell prüfen.')
        return None, list(dict.fromkeys(warnings))
    return labor, list(dict.fromkeys(warnings))

def parse_receipt(text):
    lines=[x.strip() for x in text.splitlines() if x.strip()]
    warnings=[]
    header=lines[:12]
    skip=re.compile(
        r'^(?:rechnung|invoice|kassenbon|quittung|beleg|bon|datum|seite|tel|fax|'
        r'www[.]|https?://|mail|e-?mail|ust-?id|steuer|kundennr|kunde|'
        r'anschrift|adresse|artikel|pos[.]?|betrag|summe|[0-9]{4,5}\s)',re.I)
    supplier=next((line[:140] for line in header
                   if len(line)>3 and not skip.match(line)
                   and not re.match(r'^[\d\s./:+-]+$',line)), '')
    invoice_number=''
    number_label=re.compile(
        r'(?:rechnungs(?:nummer|nr|[- ]?nr)[.:]?|rechnung\s*(?:nr|nummer)[.:]?|'
        r'beleg(?:nummer|[- ]?nr)[.:]?|bon[- ]?nr[.:]?|invoice\s*(?:no|number)[.:]?)'
        r'\s*[:#-]?\s*([A-Za-z0-9][\w./-]{1,50})',re.I)
    for idx,line in enumerate(lines):
        match=number_label.search(line)
        if match:
            candidate=match.group(1).strip()
            if candidate.lower() not in ('vom','datum','nr','no','number'):
                invoice_number=candidate[:100]
                break
        if re.search(r'(?:rechnungsnummer|rechnungs[- ]?nr|belegnummer)',line,re.I):
            if idx+1<len(lines) and re.fullmatch(r'[\w./-]{2,50}',lines[idx+1]):
                invoice_number=lines[idx+1][:100]
                break
    issued=_extract_labeled_date(lines,r'\b(?:rechnungsdatum|belegdatum|ausstellungsdatum|kaufdatum|datum)\b')
    due=_extract_labeled_date(lines,r'\b(?:fälligkeit|fällig\s*(?:am|bis)|zahlbar\s*bis|zahlungsziel)\b')
    if not issued:
        for line in lines[:25]:
            match=DATE.search(line)
            if match:
                issued=_date_iso(match.group(1))
                if issued:break

    gross_candidates=[]
    net_candidates=[]
    tax_candidates=[]
    gross_label=re.compile(
        r'(?:rechnungs[- ]?betrag|gesamt[- ]?betrag|brutto[- ]?betrag|'
        r'gesamt(?:summe|preis)?|summe\s*brutto|endbetrag|'
        r'zu\s+zahlen|zahlbetrag|betrag\s*fällig|zu\s+überweisen|'
        r'zu\s+begleichen|total\s*(?:eur|€)|grand\s*total|'
        r'kartenzahlung|ec-karte)',re.I)
    balance_label=re.compile(r'(?:offen(?:er\s+betrag)?|restbetrag|noch\s+zu\s+zahlen)',re.I)
    net_label=re.compile(r'(?:netto(?:betrag|summe)?|summe\s*netto|zwischensumme\s*netto)',re.I)
    tax_label=re.compile(r'(?:mehrwertsteuer|umsatzsteuer|mwst[.]?|ust[.]?|steuerbetrag)',re.I)
    exclude_gross=re.compile(
        r'(?:netto|zwischensumme|mwst|ust[.]?|steuer|rabatt|'
        r'gutschein|anzahlung|abschlag|bereits\s+(?:bezahlt|gezahlt)|'
        r'erhalten|rückgeld|gegeben)',re.I)
    for idx,line in enumerate(lines):
        amounts=AMOUNT.findall(line)
        if not amounts and idx+1<len(lines):
            # A separate value line is allowed for explicitly labeled amounts.
            pass
        if gross_label.search(line) and not exclude_gross.search(line):
            value=_line_money(lines,idx)
            if value is not None:
                gross_candidates.append((3 if not balance_label.search(line) else 1,idx,value))
        elif balance_label.search(line):
            value=_line_money(lines,idx)
            if value is not None:gross_candidates.append((1,idx,value))
        elif re.search(r'\b(?:summe|total|betrag)\b',line,re.I) and not exclude_gross.search(line):
            value=_line_money(lines,idx)
            if value is not None:gross_candidates.append((2,idx,value))
        if net_label.search(line):
            value=_line_money(lines,idx)
            if value is not None:net_candidates.append((idx,value))
        if tax_label.search(line) and not net_label.search(line):
            value=_line_money(lines,idx)
            if value is not None:tax_candidates.append((idx,value))
    if gross_candidates:
        highest=max(item[0] for item in gross_candidates)
        preferred=[x for x in gross_candidates if x[0]==highest]
        gross=preferred[-1][2]
        if len({x[2] for x in preferred})>1:
            warnings.append('Mehrere unterschiedliche Gesamtbeträge erkannt. Bitte Bruttobetrag prüfen.')
        gross_text=str(gross)
    else:
        gross_text=''
        warnings.append('Gesamtbetrag nicht sicher erkannt. Bitte manuell eintragen.')
    net=net_candidates[-1][1] if net_candidates else None
    tax=tax_candidates[-1][1] if tax_candidates else None
    if gross_text and net is not None and tax is not None and abs((net+tax)-gross)>Decimal('0.02'):
        warnings.append('Netto + Steuer weicht vom erkannten Brutto ab. Bitte prüfen.')
    if not issued:warnings.append('Belegdatum nicht sicher erkannt.')
    if not supplier:warnings.append('Lieferant nicht erkannt.')
    if not invoice_number:warnings.append('Rechnungs-/Bonnummer nicht sicher erkannt.')
    labor, labor_warnings=extract_labor_amount(text,gross_text)
    warnings.extend(labor_warnings)
    lowered=text.lower()
    billing=('Schlussrechnung' if re.search(r'\bschlussrechnung\b',lowered) else
             'Abschlagsrechnung' if re.search(r'\b(?:abschlagsrechnung|teilrechnung)\b',lowered)
             else 'Normal')
    kind=('Gutschrift' if re.search(r'\bgutschrift\b',lowered[:600]) else
          'Kassenzettel' if re.search(r'\b(?:kassenbon|kassenzettel|bonnummer)\b',lowered[:600])
          else 'Rechnung')
    return {'supplier':supplier,'document_date':issued,'due_date':due,
            'invoice_number':invoice_number,'gross_amount':gross_text,
            'net_amount':str(net) if net is not None else '',
            'vat_amount':str(tax) if tax is not None else '',
            'labor_amount':str(labor) if labor is not None else None,
            'category':category_for(text),'kind':kind,'billing_type':billing,'warnings':warnings}
