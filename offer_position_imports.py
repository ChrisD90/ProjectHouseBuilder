"""Strict local spreadsheet import. Preview and resolution never persist offer changes."""
import csv
from collections import Counter
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from hashlib import sha256
from io import BytesIO, StringIO
import json
from pathlib import Path
from zipfile import ZipFile, BadZipFile
from xml.etree.ElementTree import ParseError

from itsdangerous import URLSafeTimedSerializer, BadSignature
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
from openpyxl.utils.exceptions import InvalidFileException
from openpyxl.worksheet.datavalidation import DataValidation

HEADERS=('Positionsnummer','Beschreibung','Menge','Einheit','Einzelpreis netto','Positionssumme netto','Leistungsgruppe','Optional','Eigenleistung')
FIELDS=('number','description','quantity','unit','unit_price','net_amount','section','optional','own_work')
EXAMPLE=('1','Beispielposition (bitte ersetzen)',2,'Stk.',50,100,'Allgemein','Nein','Nein')


def key(value):return ' '.join(str(value or '').split()).casefold()
def fingerprint(rows):return sha256(json.dumps(rows,sort_keys=True,ensure_ascii=False,default=str).encode()).hexdigest()


def number(value,quantity=False):
    if value is None or str(value).strip()=='':return None
    if isinstance(value,bool):raise ValueError('Ja/Nein ist kein Zahlenwert.')
    text=str(value).strip().replace('\u00a0','').replace(' ','')
    if ',' in text:text=text.replace('.','').replace(',','.')
    try:
        parsed=Decimal(text)
        if not parsed.is_finite() or parsed<0 or parsed>Decimal('99999999.99') or parsed.as_tuple().exponent < (-6 if quantity else -2):raise ValueError()
        return format(parsed,'f')
    except (InvalidOperation,ValueError):raise ValueError('Ungültige Zahl: '+str(value)[:45]) from None


def flag(value):
    if value in (None,''):return False
    if isinstance(value,bool):return value
    text=str(value).strip().casefold()
    if text in ('ja','true','1'):return True
    if text in ('nein','false','0'):return False
    raise ValueError('Optional und Eigenleistung müssen Ja oder Nein enthalten.')


def read_rows(raw,name):
    suffix=Path(name).suffix.lower()
    if suffix=='.csv':
        try:text=raw.decode('utf-8-sig')
        except UnicodeDecodeError:raise ValueError('CSV bitte als UTF-8 speichern.') from None
        # Delimiters may vary; column names and order may not.
        first=text.splitlines()[0] if text.splitlines() else ''
        delimiter=max((';',',','\t'),key=lambda sep:first.count(sep))
        reader=csv.reader(StringIO(text,newline=''),delimiter=delimiter,strict=True)
        try:
            result=[]
            for row in reader:
                if len(result)>500:raise ValueError('Maximal 500 Positionen pro Import.')
                result.append(row)
            return result
        except csv.Error:raise ValueError('CSV ist nicht korrekt aufgebaut.') from None
    if suffix!='.xlsx':raise ValueError('Bitte eine XLSX- oder CSV-Datei verwenden. Alte XLS-Dateien zuerst als XLSX speichern.')
    try:
        with ZipFile(BytesIO(raw)) as archive:
            if len(archive.infolist())>4096 or sum(item.file_size for item in archive.infolist())>32*1024*1024:raise ValueError('Die Excel-Datei enthält zu viele Daten. Bitte nur das Positionsblatt exportieren.')
        book=load_workbook(BytesIO(raw),read_only=True,data_only=False,keep_links=False)
        try:
            nonempty=[]
            for sheet in book.worksheets:
                if (sheet.max_row or 0)>5000 or (sheet.max_column or 0)>64:raise ValueError('Bitte nur das Positionsblatt mit maximal 500 Positionen exportieren; zu viele Zeilen oder Spalten.')
                rows=[]
                for row in sheet.iter_rows():
                    values=[cell.value for cell in row]
                    if not any(value is not None for value in values):continue
                    if len(rows)>500:raise ValueError('Maximal 500 Positionen pro Import.')
                    # Ignore formatting-only trailing columns, not populated extra fields.
                    while values and values[-1] is None:values.pop()
                    rows.append(values)
                if rows:nonempty.append(rows)
            if len(nonempty)!=1:raise ValueError('Die Excel-Datei muss genau ein befülltes Tabellenblatt enthalten.')
            return nonempty[0]
        finally:book.close()
    except (BadZipFile,KeyError,OSError,ParseError,InvalidFileException) as exc:raise ValueError('Die Excel-Datei ist beschädigt oder kein gültiges XLSX.') from exc


def analyze(raw,name,current,validate):
    rows=read_rows(raw,name)
    if not rows or tuple(str(value or '').strip() for value in rows[0])!=HEADERS:
        raise ValueError('Spaltenüberschriften und Reihenfolge müssen exakt der Vorlage entsprechen: '+'; '.join(HEADERS))
    data=[]
    for index,values in enumerate(rows[1:],2):
        if not any(value is not None and str(value).strip() for value in values):continue
        errors=[];position=None
        if len(values)>len(HEADERS):errors.append('Zusätzliche Spalten sind nicht erlaubt.')
        values=list(values)+[None]*max(0,len(HEADERS)-len(values))
        try:
            if any(isinstance(value,str) and value.lstrip().startswith('=') for value in values):raise ValueError('Formeln sind nicht erlaubt. Bitte als feste Werte exportieren.')
            item=dict(zip(FIELDS,values))
            for field in ('number','description','unit','section'):item[field]=str(item[field] or '').strip()
            if not item['number']:raise ValueError('Positionsnummer fehlt.')
            item['quantity']=number(item['quantity'],True)
            for field in ('unit_price','net_amount'):item[field]=number(item[field])
            product=None
            if item['quantity'] is not None and item['unit_price'] is not None:
                product=(Decimal(item['quantity'])*Decimal(item['unit_price'])).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
            if item['net_amount'] is None:
                if product is None:raise ValueError('Nettobetrag oder Menge und Einzelpreis fehlen.')
                item['net_amount']=format(product,'f')
            elif product is not None and Decimal(item['net_amount'])!=product:
                raise ValueError('Menge × Einzelpreis stimmt nicht mit der Positionssumme überein.')
            item['optional']=flag(item['optional']);item['own_work']=flag(item['own_work'])
            item['optional_amount']=item['net_amount'] if item['optional'] else None
            position=validate([item])[0]
        except (ValueError,TypeError) as exc:errors.append(str(exc))
        data.append(dict(row=index,number=str(values[0] or ''),description=str(values[1] or ''),position=position,errors=errors))
    if not data:raise ValueError('Die Datei enthält keine Positionen.')
    duplicates=Counter(key(row['number']) for row in data)
    for row in data:
        matching=[i for i,pos in enumerate(current) if key(pos['number'])==key(row['number'])]
        same_description=[i for i,pos in enumerate(current) if key(pos['description'])==key(row['description'])]
        targets=matching or same_description
        row['targets']=targets
        if row['errors']:row['status']='invalid';row['message']=' · '.join(row['errors'])
        elif duplicates[key(row['number'])]>1:row['status']='duplicate';row['message']='Positionsnummer mehrfach in der Datei.'
        elif targets:
            same=len(targets)==1 and all(current[targets[0]].get(field)==row['position'].get(field) for field in FIELDS)
            row['status']='identical' if same else 'conflict'
            row['message']='Bereits identisch vorhanden.' if same else ('Positionsnummer bereits vorhanden; Werte vergleichen.' if matching else 'Gleiche Beschreibung mit anderer Positionsnummer vorhanden.')
            if len(targets)>1:row['message']+=' Mehrere vorhandene Treffer; keine automatische Ersetzung möglich.'
        else:row['status']='new';row['message']='Neue Position.'
        row['existing']=[dict(number=current[i]['number'],description=current[i]['description'],net_amount=current[i]['net_amount']) for i in targets]
    return data


class ResolutionError(ValueError):
    def __init__(self,issues):
        self.issues=issues
        super().__init__('Bitte die markierten Zeilen korrigieren oder ausdrücklich überspringen.')


def resolve(current,rows,decisions,validate):
    if not isinstance(decisions,list) or len(decisions)!=len(rows):raise ValueError('Bitte für jede Zeile eine Importentscheidung treffen.')
    merged=[dict(pos) for pos in current];replaced={};added=[];issues=[];origins={}
    def issue(index,message):
        issues.append(dict(index=index,row=rows[index]['row'],message=message))
    before=Counter(key(pos['number']) for pos in current)
    for index,(row,choice) in enumerate(zip(rows,decisions)):
        if not isinstance(choice,dict):issue(index,'Ungültige Importentscheidung.');continue
        action=choice.get('action')
        if action=='skip':continue
        if action not in ('add','replace'):
            issue(index,'Bitte eine Aktion auswählen: '+row['message']);continue
        if row['errors']:issue(index,'Fehlerhafte Zeile bitte ausdrücklich überspringen: '+row['message']);continue
        position=dict(row['position']);position['number']=str(choice.get('number',position['number'])).strip()
        if not position['number'] or len(position['number'])>30 or any(ord(c)<32 for c in position['number']):
            issue(index,'Bitte eine gültige Positionsnummer mit maximal 30 Zeichen eingeben.');continue
        if action=='replace':
            if len(row['targets'])!=1:issue(index,'Ersetzung ist nur bei einem eindeutigen vorhandenen Treffer möglich.');continue
            target=row['targets'][0]
            if target in replaced:
                issue(index,'Diese vorhandene Position wird bereits durch eine andere Zeile ersetzt.');issue(replaced[target],'Diese vorhandene Position wird mehrfach ersetzt.');continue
            replaced[target]=index
            merged[target]={**position,**{name:current[target][name] for name in ('id','page') if name in current[target]}}
        else:added.append(position)
        origins.setdefault(key(position['number']),[]).append(index)
    merged+=added
    after=Counter(key(pos['number']) for pos in merged)
    for number,count in after.items():
        if count>max(1,before[number]):
            for index in origins.get(number,[]):issue(index,'Positionsnummer ist mehrfach vergeben. Bitte umnummerieren, ersetzen oder überspringen.')
    if issues:raise ResolutionError(issues)
    if len(merged)>500:raise ValueError('Ein Angebot darf maximal 500 Positionen enthalten.')
    if not replaced and not added:raise ValueError('Bitte mindestens eine Position zur Übernahme auswählen.')
    validate(merged)
    if not any(not pos['optional'] for pos in merged):raise ValueError('Mindestens eine nicht optionale Position ist erforderlich.')
    return merged,dict(added=len(added),replaced=len(replaced),skipped=len(rows)-len(added)-len(replaced))


def register(runtime,position_token):
    app=runtime.app;serializer=URLSafeTimedSerializer(app.secret_key,salt='offer-position-import-v1')
    @app.get('/api/offers/positions/import-template.<kind>')
    def offer_positions_template(kind):
        if kind=='csv':
            out=StringIO(newline='');writer=csv.writer(out,delimiter=';');writer.writerow(HEADERS);writer.writerow(EXAMPLE)
            return runtime.send_file(BytesIO(out.getvalue().encode('utf-8-sig')),as_attachment=True,download_name='Angebotspositionen-Vorlage.csv',mimetype='text/csv; charset=utf-8')
        if kind!='xlsx':return runtime.jsonify(error='Unbekanntes Vorlagenformat.'),404
        book=Workbook();sheet=book.active;sheet.title='Positionen';sheet.append(HEADERS);sheet.append(EXAMPLE);sheet.freeze_panes='A2'
        for cell in sheet[1]:cell.font=Font(bold=True)
        for column,width in zip('ABCDEFGHI',(20,48,16,14,22,24,26,16,18)):sheet.column_dimensions[column].width=width
        sheet['A2'].number_format='@'
        for cell in ('E2','F2'):sheet[cell].number_format='0.00'
        boolean=DataValidation(type='list',formula1='"Ja,Nein"');sheet.add_data_validation(boolean);boolean.add('H2:I501')
        output=BytesIO();book.save(output);book.close();output.seek(0)
        return runtime.send_file(output,as_attachment=True,download_name='Angebotspositionen-Vorlage.xlsx',mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    def owned(ident):return runtime.db.session.get(runtime.Offer,ident)
    def clean_current(raw,offer):
        rows=runtime._validated_offer_positions(raw);ids=set();known={p.id for p in offer.positions}
        for position,item in zip(rows,raw):
            ident=item.get('id')
            if ident is not None:
                if type(ident)is not int or ident not in known or ident in ids:raise ValueError('Ungültige vorhandene Positionszuordnung.')
                ids.add(ident);position['id']=ident
        return rows

    @app.post('/api/offers/<int:ident>/positions/import-preview')
    def offer_positions_import_preview(ident):
        offer=owned(ident)
        if not offer:return runtime.jsonify(error='Angebot nicht gefunden.'),404
        if runtime.request.form.get('positions_token')!=position_token(offer):return runtime.jsonify(error='Angebot wurde inzwischen geändert. Bitte den Positionsdialog neu öffnen.'),409
        try:
            file=runtime.request.files.get('file')
            if not file or not file.filename:raise ValueError('Bitte eine Datei auswählen.')
            current=clean_current(json.loads(runtime.request.form.get('positions','null')),offer)
            rows=analyze(file.read(),file.filename,current,runtime._validated_offer_positions)
            token=serializer.dumps(dict(project=offer.project_id,offer=ident,version=position_token(offer),current=current,rows=rows))
            return runtime.jsonify(rows=rows,token=token)
        except (ValueError,TypeError) as exc:return runtime.jsonify(error=str(exc)),400

    @app.post('/api/offers/<int:ident>/positions/import-apply')
    def offer_positions_import_apply(ident):
        offer=owned(ident)
        if not offer:return runtime.jsonify(error='Angebot nicht gefunden.'),404
        try:
            body=runtime.request.get_json(silent=True) or {};data=serializer.loads(body.get('token',''),max_age=3600)
            if data['project']!=offer.project_id or data['offer']!=ident:raise ValueError('Import gehört nicht zu diesem Angebot.')
            if data['version']!=position_token(offer):return runtime.jsonify(error='Angebot wurde inzwischen geändert. Bitte den Positionsdialog neu öffnen.'),409
            current=clean_current(body.get('positions'),offer)
            if fingerprint(current)!=fingerprint(data['current']):return runtime.jsonify(error='Deine Positionen wurden seit der Vorschau verändert. Bitte die Datei erneut prüfen.'),409
            merged,summary=resolve(current,data['rows'],body.get('decisions'),runtime._validated_offer_positions)
            return runtime.jsonify(positions=merged,summary=summary)
        except ResolutionError as exc:return runtime.jsonify(error=str(exc),issues=exc.issues),400
        except BadSignature:return runtime.jsonify(error='Importvorschau ist abgelaufen oder ungültig. Bitte Datei erneut prüfen.'),400
        except (ValueError,TypeError,KeyError) as exc:return runtime.jsonify(error=str(exc)),400
