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
AMOUNT = re.compile(r'(?<!\d)(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?!\d)')
DATE = re.compile(r'\b(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})\b')

def decimal_amount(s):
    try: return Decimal(s.replace('.', '').replace(',', '.')).quantize(Decimal('0.01'))
    except (InvalidOperation, AttributeError): return None

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

def parse_receipt(text):
    lines=[x.strip() for x in text.splitlines() if x.strip()]
    supplier=next((l[:140] for l in lines[:9] if len(l)>2 and not re.match(r'^(Rechnung|Kassenbon|Bon|Datum|Seite|Tel)',l,re.I)), '')
    date_match=DATE.search(text)
    date_value=''
    if date_match:
        raw=date_match.group(1).replace('/','.').replace('-','.')
        for fmt in ('%d.%m.%Y','%d.%m.%y'):
            try: date_value=datetime.strptime(raw,fmt).date().isoformat();break
            except ValueError:pass
    ref=re.search(r'(?:Rechnungs(?:nummer|nr\.?|[- ]?nr\.)|Beleg(?:nummer|[- ]?nr\.)|Bon[- ]?Nr\.?|Rechnung\s*Nr\.?)\s*[:#]?\s*([A-Za-z0-9][\w/.-]{2,40})',text,re.I)
    net='';tax='';gross='';notes=[]
    candidates=[]
    for l in lines:
        amounts=[decimal_amount(x) for x in AMOUNT.findall(l)]
        amounts=[x for x in amounts if x is not None]
        if not amounts:continue
        val=amounts[-1]
        # Don't mistake a VAT rate or an item price for the amount payable.
        if re.search(r'(?:gesamtbetrag|rechnungsbetrag|zu zahlen|endbetrag|summe brutto|bruttobetrag|gesamt\s*€|betrag fällig|kartenzahlung|ec-karte|zahlbetrag)',l,re.I):candidates.append((3,val))
        elif re.search(r'\b(?:summe|gesamt|total|betrag)\b',l,re.I) and not re.search(r'netto|mwst|ust|steuer|rückgeld|gegeben',l,re.I):candidates.append((2,val))
        if re.search(r'\b(netto|zwischensumme)\b',l,re.I):net=str(val)
        if re.search(r'(?:mwst|umsatzsteuer|mehrwertsteuer|\bust\b)',l,re.I) and not re.search(r'\b19\s*%|\b7\s*%',l):tax=str(val)
    if candidates:
        level=max(x[0] for x in candidates);gross=str([value for score,value in candidates if score==level][-1])
    else:notes.append('Gesamtbetrag nicht sicher erkannt. Bitte manuell eintragen.')
    if not date_value:notes.append('Datum nicht sicher erkannt.')
    if not supplier:notes.append('Lieferant nicht erkannt.')
    return {'supplier':supplier,'document_date':date_value,'invoice_number':ref.group(1) if ref else '',
            'gross_amount':gross,'net_amount':net,'vat_amount':tax,'category':category_for(text),
            'warnings':notes}
