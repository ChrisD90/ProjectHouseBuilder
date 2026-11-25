"""Validated project dashboards. Layout writes never mutate project source records."""
import json
import re
from hashlib import sha256
from decimal import Decimal
from flask import jsonify, request
from sqlalchemy import select

KEY = 'dashboard_layout_v1'
# Width/height use a twelve-column grid, not viewport pixels.
SIZES = {**{k:(4,2) for k in ('events','todos','receipts','deadlines','offers','self_work','shopping','inbox')},
         **{k:(3,1) for k in ('credit','equity','expenses','pending','hours','metric')},
         'calendar':(6,3),'note':(3,2),'links':(3,2),'list':(4,2),'progress':(3,2)}
SOURCES = ('receipts','offers','todos','self_work','hours')
ROUTES = ('/','/angebote','/belege','/aufgaben','/eigenleistungen','/stunden','/finanzierung','/energieplanung','/projektunterlagen','/daten','/stammdaten')

def default_layout():
    return dict(version=1, widgets=[dict(id=k,type=k,x=x,y=y,w=6,h=2,config={}) for k,x,y in
        [('events',0,0),('todos',6,0),('receipts',0,2),('deadlines',6,2)]])

def validate_layout(value):
    if not isinstance(value,dict) or set(value)!={'version','widgets'} or type(value['version']) is not int or value['version']!=1 or not isinstance(value['widgets'],list) or len(value['widgets'])>30:
        raise ValueError('Ungültige Übersicht. Maximal 30 Kacheln sind möglich.')
    seen=set();occupied=set()
    for w in value['widgets']:
        if not isinstance(w,dict) or set(w)!={'id','type','x','y','w','h','config'}:raise ValueError('Ungültige Kachel.')
        if not isinstance(w['id'],str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',w['id']) or w['id'] in seen:raise ValueError('Kachelkennungen müssen eindeutig sein.')
        seen.add(w['id']);kind=w['type']
        if not isinstance(kind,str) or kind not in SIZES:raise ValueError('Unbekannte Kachelart.')
        if any(type(w[k]) is not int for k in ('x','y','w','h')):raise ValueError('Ungültiges Raster.')
        mw,mh=SIZES[kind]
        if not (0<=w['x']<12 and 0<=w['y']<=1000 and mw<=w['w']<=12 and mh<=w['h']<=12 and w['x']+w['w']<=12):raise ValueError('Kachel liegt außerhalb des Rasters oder ist zu klein.')
        cells={(x,y) for x in range(w['x'],w['x']+w['w']) for y in range(w['y'],w['y']+w['h'])}
        if occupied & cells:raise ValueError('Kacheln dürfen sich nicht überlappen.')
        occupied.update(cells)
        c=w['config']
        if not isinstance(c,dict) or set(c)-{'title','source','status','search','trade','person','month','aggregation','note_id','links'}:raise ValueError('Ungültige Kacheleinstellungen.')
        for key,limit in [('title',80),('status',80),('search',120),('trade',140)]:
            if key in c and (not isinstance(c[key],str) or len(c[key])>limit):raise ValueError('Ungültiger Kacheltext.')
        if 'source' in c and c['source'] not in SOURCES:raise ValueError('Ungültige Datenquelle.')
        if kind in ('metric','list','progress') and c.get('source') not in SOURCES:raise ValueError('Bitte eine Datenquelle auswählen.')
        if kind=='progress' and c.get('source')=='hours':raise ValueError('Stunden haben keinen Abschlussstatus. Bitte Kennzahl oder Liste verwenden.')
        if 'aggregation' in c and c['aggregation'] not in ('sum','count'):raise ValueError('Ungültige Berechnung.')
        for key in ('person','note_id'):
            if key in c and (type(c[key]) is not int or c[key]<1):raise ValueError('Ungültige Auswahl.')
        if 'month' in c and (not isinstance(c['month'],str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',c['month'])):raise ValueError('Ungültiger Monat.')
        if 'links' in c:
            if not isinstance(c['links'],list) or len(c['links'])>12 or any(not isinstance(x,str) or not (x in ROUTES or re.fullmatch(r'/projektwerkstatt\?tab=[a-z_-]{1,40}',x)) for x in c['links']):raise ValueError('Nur interne Schnellzugriffe sind erlaubt.')
    return value

def register_dashboard(r):
    app,db=r.app,r.db
    def wire(row):
        raw=row.value if row else ''
        return dict(layout=json.loads(raw)['layout'] if raw else default_layout(),token=sha256(raw.encode()).hexdigest())

    @app.route('/api/dashboard/layout',methods=['GET','PUT'])
    def dashboard_layout():
        # Shared request-safety hook already locks the project before PUT reads.
        db.session.expire_all()
        row=db.session.get(r.Setting,KEY)
        if request.method=='GET':return jsonify(wire(row))
        body=request.get_json(silent=True)
        try:
            if not isinstance(body,dict) or set(body)!={'layout','token'}:raise ValueError('Ungültige Übersicht.')
            if body['token']!=wire(row)['token']:return jsonify(error='Die Übersicht wurde inzwischen geändert. Bitte neu laden; deine Anordnung bleibt bis dahin erhalten.'),409
            layout=validate_layout(body['layout'])
            previous={x['id']:x['config'] for x in wire(row)['layout']['widgets']}
            for widget in layout['widgets']:
                for field,model in [('note_id',r.ProjectWork),('person',r.TimePerson)]:
                    ident=widget['config'].get(field)
                    if ident and previous.get(widget['id'],{}).get(field)!=ident:
                        selected=db.session.get(model,ident)
                        if selected is None or (field=='note_id' and (selected.kind!='note' or selected.archived_at)):
                            raise ValueError('Auswahl gehört nicht zum Projekt oder ist nicht mehr verfügbar.')
            # A fresh revision prevents ABA edits (including restore of the same layout).
            from uuid import uuid4
            raw=json.dumps(dict(layout=layout,revision=uuid4().hex),ensure_ascii=False,allow_nan=False)
            if len(raw)>100000:raise ValueError('Übersicht ist zu groß.')
            if row:row.value=raw
            else:row=r.Setting(key=KEY,value=raw);db.session.add(row)
            db.session.commit();return jsonify(wire(row))
        except (ValueError,TypeError) as exc:
            db.session.rollback();return jsonify(error=str(exc) or 'Bitte Raster und Eingaben prüfen.'),400

    @app.get('/api/dashboard/source/<name>')
    def dashboard_source(name):
        if name=='finance':
            svc=r.finance_services;events=svc['all_rows'](r.FinancingEvent);payments=svc['all_rows'](r.ReceiptFinancingPayment);usages=svc['all_rows'](r.LoanUsage)
            loans=[svc['loan_account'](x,events,payments,usages) for x in svc['all_rows'](r.Loan)]
            equity=[svc['equity_account'](x,events,payments) for x in svc['all_rows'](r.EquityAccount)]
            drawn=sum((x['drawn'] for x in loans),Decimal(0));spent=sum((x['paid_for_project'] for x in equity),Decimal(0))
            pending=[x for x in r.list_loan_drawdowns() if x['status'] in ('Eingereicht','Teilweise ausgezahlt')]
            return jsonify(frame=float(sum((x.principal for x in svc['all_rows'](r.Loan)),Decimal(0))),credit=float(sum((x['undrawn']+x['unallocated_drawn'] for x in loans),Decimal(0))),equity=float(spent),expenses=float(spent+drawn),pending=sum(x['remaining_amount'] for x in pending),pending_count=len(pending))
        if name=='events':
            return jsonify(items=[r.calendar_event_json(x) for x in db.session.scalars(select(r.CalendarEvent).order_by(r.CalendarEvent.start_date,r.CalendarEvent.start_time))])
        if name=='todos' or name=='notes':
            return jsonify(items=[r.project_work_dict(x) for x in db.session.scalars(select(r.ProjectWork).where(r.ProjectWork.archived_at.is_(None),r.ProjectWork.kind==('note' if name=='notes' else 'todo')).order_by(r.ProjectWork.due_on,r.ProjectWork.id))])
        if name=='receipts':
            items=[]
            for x in db.session.scalars(select(r.Receipt).where(r.Receipt.status=='Gebucht').order_by(r.Receipt.document_date.desc(),r.Receipt.id.desc())):
                amount=r.dec(r._receipt_increment(x));paid=r.dec(x.paid_amount);remaining=max(Decimal(0),amount-paid)
                items.append(dict(id=x.id,title=x.supplier or x.original_name,number=x.invoice_number,amount=float(amount),remaining=float(remaining),paid=float(paid),date=x.document_date,trade=x.trade,due_on=x.due_date,status='unpaid' if remaining>0 else 'paid',url='/belege/'+str(x.id)+('?financing=1' if remaining>0 else '')))
            return jsonify(items=items)
        if name=='offers':
            return jsonify(items=[dict(id=x.id,title=(x.number+' · ' if x.number else '')+x.vendor,status=x.status,amount=float(x.gross or 0),date=x.issued or '',trade=x.category,url='/angebote/'+str(x.id)) for x in db.session.scalars(select(r.Offer).where(r.Offer.status!='Entwurf').order_by(r.Offer.id.desc()))])
        if name=='self_work':
            return jsonify(items=[dict(id=x['id'],title=x['title'],status=x['status'],amount=x['estimated_cost'],actual=x['actual_cost'],url='/eigenleistungen?plan_id='+str(x['id'])) for x in r.self_work_costs() if not x['archived']])
        if name=='hours':
            people={x.id:x for x in db.session.scalars(select(r.TimePerson))};items=[]
            for x in db.session.scalars(select(r.TimeEntry).order_by(r.TimeEntry.worked_on.desc(),r.TimeEntry.id.desc())):
                entry=r.time_entry_json(x)
                if not entry['planned']:
                    person=people.get(x.person_id)
                    items.append(dict(id=x.id,title=person.name if person else 'Person entfernt',description=x.description,person=x.person_id,date=x.worked_on.isoformat(),amount=x.minutes/60,url='/stunden?person_id='+str(x.person_id)))
            return jsonify(items=items,people=[dict(value=str(x.id),label=x.name) for x in people.values()])
        # Reuse read-only domain aggregations; no background writes are replayed.
        endpoints={'deadlines':'overview','shopping':'shopping','inbox':'inbox_status'}
        if name in endpoints:
            response=app.view_functions[endpoints[name]](only='reminders') if name=='deadlines' else app.view_functions[endpoints[name]]()
            data=response.get_json()
            if name=='deadlines':data=dict(items=data['reminders'])
            elif name=='inbox':data=dict(items=[dict(id=x['id'],title=x['filename'],status=x['state'],url='/daten') for x in data['items'] if x['state']=='new'],count=data['count'])
            return jsonify(data)
        return jsonify(error='Unbekannte Datenquelle.'),404
