"""Project-owned financial simulations. No endpoint writes operational finance data."""
import copy
import json
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from uuid import uuid4
from flask import jsonify, request
from sqlalchemy import select
from project_documents import plain

ZERO=Decimal(0)
ACCEPTED=('Angenommen','Beauftragt')

def money(value, label='Betrag'):
    if isinstance(value,bool):raise ValueError(label+': Bitte einen gültigen Betrag eingeben.')
    try:result=Decimal(str(value).replace(',','.'))
    except (InvalidOperation,ValueError,TypeError):raise ValueError(label+': Bitte einen gültigen Betrag eingeben.') from None
    if not result.is_finite() or result<0 or result>Decimal('1000000000000'):raise ValueError(label+': Betrag muss zwischen 0 und einer Billion Euro liegen.')
    return result.quantize(Decimal('.01'))

def digest(value):return sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def calculate(data):
    accounts={x['key']:x for x in data['basis']['accounts']}
    used={key:ZERO for key in accounts};future=ZERO;unassigned=ZERO;rows=[]
    def allocation(raw,due,title):
        if not isinstance(raw,dict) or len(raw)>100:raise ValueError(title+': Ungültige Finanzierungsaufteilung.')
        result={}
        for key,value in raw.items():
            if key not in accounts:raise ValueError(title+': Finanzierungsquelle gehört nicht zu diesem Szenario.')
            amount=money(value,'Finanzierung')
            if amount:result[key]=amount
        assigned=sum(result.values(),ZERO)
        if assigned>due:raise ValueError(title+': Die Finanzierungsaufteilung übersteigt den noch geplanten Betrag.')
        for key,value in result.items():used[key]+=value
        return due-assigned
    for line in data['lines']:
        amount=money(line['amount'],line['title']);paid=money(line['paid'])
        if amount<paid:raise ValueError(line['title']+': Der Planbetrag darf die bereits bezahlte Summe nicht unterschreiten.')
        due=max(ZERO,amount-paid) if line['enabled'] else ZERO
        # Disabled alternatives keep their allocations, but consume no funding.
        missing=allocation(line['allocations'],due,line['title']) if line['enabled'] else ZERO
        future+=due;unassigned+=missing
        rows.append(dict(id=line['id'],future=float(due),unassigned=float(missing)))
    reserve=data['reserve'];value=money(reserve['value'],'Reserve')
    if reserve['mode']=='percent' and value>100:raise ValueError('Die Reserve darf höchstens 100 Prozent betragen.')
    buffer=(future*value/100).quantize(Decimal('.01')) if reserve['mode']=='percent' else value
    unassigned+=allocation(reserve['allocations'],buffer,'Reserve')
    required=future+buffer;capacity=ZERO;remaining={'loan':ZERO,'equity':ZERO};sources=[];warnings=[]
    for key,account in accounts.items():
        available=Decimal(str(account['available']));protected=money(account['reserve']);left=available-used[key]
        capacity+=available-protected;remaining[account['kind']]+=left
        sources.append(dict(**account,allocated=float(used[key]),remaining=float(left)))
        if left<0:warnings.append(account['name']+': Finanzierungsrahmen um '+format(-left,'.2f')+' € überschritten.')
        elif left<protected:warnings.append(account['name']+': Die hinterlegte Eigenkapitalreserve wird unterschritten.')
    unassigned_paid=money(data['basis'].get('unassigned_paid',0))
    if unassigned_paid:warnings.append('Im Ausgangsstand sind '+format(unassigned_paid,'.2f')+' € bereits bezahlt, aber keiner Finanzierungsquelle zugeordnet. Kontosalden berücksichtigen diese Beträge noch nicht.')
    paid=money(data['basis']['paid'])
    return dict(total=float(paid+required),paid=float(paid),future=float(future),reserve=float(buffer),required=float(required),
                unassigned=float(unassigned),gap=float(max(ZERO,required-capacity)),credit_remaining=float(remaining['loan']),
                equity_remaining=float(remaining['equity']),accounts=sources,lines=rows,warnings=warnings)


def clean(body,previous):
    if not isinstance(body,dict) or set(body)!={'revision','title','notes','lines','reserve'}:raise ValueError('Ungültige Szenariodaten.')
    title=plain(body['title'],'Titel',120,required=True);notes=plain(body['notes'],'Notizen',4000)
    if not isinstance(body['lines'],list) or len(body['lines'])>500:raise ValueError('Bitte höchstens 500 Planpositionen verwenden.')
    existing={x['id']:x for x in previous['lines']};lines=[];seen=set()
    for item in body['lines']:
        if not isinstance(item,dict) or set(item)!={'id','title','amount','enabled','allocations'}:raise ValueError('Ungültige Planposition.')
        ident=item['id']
        if not isinstance(ident,str) or not re.fullmatch(r'[a-f0-9-]{32,36}',ident) or ident in seen:raise ValueError('Planpositionen brauchen eindeutige Kennungen.')
        seen.add(ident)
        if type(item['enabled'])is not bool:raise ValueError('Ungültige Auswahl einer Planposition.')
        if not isinstance(item['allocations'],dict):raise ValueError('Ungültige Finanzierungsaufteilung.')
        # Sources and already-paid values are immutable snapshots, never client input.
        base=existing.get(ident,dict(id=ident,paid=0,source=None))
        allocations={k:float(money(v,'Finanzierung')) for k,v in item['allocations'].items()}
        if set(allocations)-{a['key'] for a in previous['basis']['accounts']}:raise ValueError('Ungültige Finanzierungsquelle.')
        lines.append(dict(base,title=plain(item['title'],'Positionstitel',180,required=True),amount=float(money(item['amount'])),enabled=item['enabled'],allocations=allocations))
    reserve=body['reserve']
    if not isinstance(reserve,dict) or set(reserve)!={'mode','value','allocations'} or reserve['mode']not in ('fixed','percent'):raise ValueError('Ungültige Reserve.')
    data=dict(previous,lines=lines,reserve=copy.deepcopy(reserve));data['reserve']['value']=float(money(reserve['value'],'Reserve'))
    calculate(data)
    if len(json.dumps(data))>600000:raise ValueError('Das Szenario ist zu groß.')
    return title,notes,data


def validate_snapshot(raw):
    """Validate archived simulations before a project restore deletes any live row."""
    try:
        def pairs(items):
            result={}
            for key,value in items:
                if key in result:raise ValueError('Doppelte Eigenschaften im Szenario.')
                result[key]=value
            return result
        data=json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Ungültige Zahl im Szenario.')))
        if not isinstance(data,dict) or set(data)!={'version','basis','lines','reserve'} or type(data['version'])is not int or data['version']!=1:raise ValueError('Unbekanntes Szenarioformat.')
        base=data['basis']
        if not isinstance(base,dict) or set(base)!={'captured_at','paid','accounts','unassigned_paid','finance_token'}:raise ValueError('Ungültiger Szenario-Ausgangsstand.')
        datetime.fromisoformat(base['captured_at']);money(base['paid']);money(base['unassigned_paid'])
        if not re.fullmatch(r'[0-9a-f]{64}',base['finance_token']):raise ValueError('Ungültige Szenariorevision.')
        if not isinstance(base['accounts'],list) or len(base['accounts'])>100:raise ValueError('Zu viele Finanzierungsquellen im Szenario.')
        seen=set()
        for account in base['accounts']:
            if not isinstance(account,dict) or set(account)!={'key','kind','name','available','reserve'}:raise ValueError('Ungültige Finanzierungsquelle im Szenario.')
            key=account['key']
            if not isinstance(key,str) or not re.fullmatch(r'(loan|equity):[1-9][0-9]*',key) or key in seen or account['kind']!=key.split(':')[0]:raise ValueError('Ungültige Kontokennung im Szenario.')
            seen.add(key);plain(account['name'],'Kontoname',160,required=True);money(account['reserve'])
            available=Decimal(str(account['available']))
            if not available.is_finite() or abs(available)>Decimal('1000000000000'):raise ValueError('Ungültiger Kontostand im Szenario.')
        if not isinstance(data['lines'],list) or len(data['lines'])>500:raise ValueError('Zu viele Szenariopositionen.')
        for line in data['lines']:
            if not isinstance(line,dict) or set(line)!={'id','title','amount','paid','enabled','allocations','source'}:raise ValueError('Ungültige Szenarioposition.')
            money(line['paid']);src=line['source']
            if src is not None:
                if not isinstance(src,dict) or src.get('kind')not in ('offer','receipt','self_work') or type(src.get('id'))is not int or src['id']<1:raise ValueError('Ungültige Szenarioquelle.')
                plain(src['title'],'Quellentitel',260)
                if src['kind']=='offer':
                    if set(src)!={'kind','id','title','amount','token'} or not re.fullmatch(r'[0-9a-f]{64}',src['token']):raise ValueError('Ungültiger Angebotsstand im Szenario.')
                    money(src['amount'])
                elif set(src)!={'kind','id','title'}:raise ValueError('Ungültige Szenarioquelle.')
        clean(dict(revision='',title='Prüfung',notes='',lines=[{k:line[k] for k in ('id','title','amount','enabled','allocations')} for line in data['lines']],reserve=data['reserve']),data)
        return data
    except (KeyError,TypeError,InvalidOperation,OverflowError) as exc:raise ValueError('Ungültige Szenariodaten im Backup.') from exc


def register(r):
    app,db=r.app,r.db
    class FinanceScenario(db.Model):
        __tablename__='finance_scenario'
        id=db.Column(db.Integer,primary_key=True)
        title=db.Column(db.String(120),nullable=False)
        notes=db.Column(db.Text,nullable=False,default='')
        data_json=db.Column(db.Text,nullable=False)
        revision=db.Column(db.String(32),nullable=False,default=lambda:uuid4().hex)
        created_at=db.Column(db.DateTime,nullable=False,default=lambda:datetime.now(timezone.utc))
        updated_at=db.Column(db.DateTime,nullable=False,default=lambda:datetime.now(timezone.utc))
    def source(offer):
        agreed=r._contract_gross(offer)
        info=dict(id=offer.id,vendor=offer.vendor,number=offer.number or '',status=offer.status,amount=agreed,completed=bool(offer.payment_completed))
        return dict(kind='offer',id=offer.id,title=offer.vendor[:180],amount=agreed,token=digest(info))
    def frame():
        svc=r.finance_services;events=svc['all_rows'](r.FinancingEvent);payments=svc['all_rows'](r.ReceiptFinancingPayment);usages=svc['all_rows'](r.LoanUsage)
        accounts=[]
        for loan in svc['all_rows'](r.Loan):
            a=svc['loan_account'](loan,events,payments,usages)
            accounts.append(dict(key='loan:'+str(loan.id),kind='loan',name=loan.name,available=float(a['undrawn']+a['unallocated_drawn']),reserve=0))
        for equity in svc['all_rows'](r.EquityAccount):
            a=svc['equity_account'](equity,events,payments)
            accounts.append(dict(key='equity:'+str(equity.id),kind='equity',name=equity.name,available=float(a['available']),reserve=float(equity.reserve)))
        receipts=list(db.session.scalars(select(r.Receipt).where(r.Receipt.status=='Gebucht').order_by(r.Receipt.id)))
        paid=sum((Decimal(x.paid_amount or 0) for x in receipts),ZERO)
        paid+=sum((Decimal(x.amount) for x in usages if x.kind=='manual' and x.status=='Aktiv'),ZERO)
        assigned=sum((Decimal(x.amount) for x in payments),ZERO)
        result=dict(captured_at=datetime.now(timezone.utc).isoformat(),paid=float(paid),accounts=accounts,unassigned_paid=float(max(ZERO,sum((Decimal(x.paid_amount or 0) for x in receipts),ZERO)-assigned)))
        result['finance_token']=digest(dict(accounts=accounts,paid=float(paid),receipts=[(x.id,str(x.paid_amount),str(x.gross_amount),x.cost_item_id) for x in receipts]))
        return result,receipts
    def basis():
        base,receipts=frame()
        rows=[];consumed=set()
        for offer in db.session.scalars(select(r.Offer).where(r.Offer.status.in_((*ACCEPTED,'Angebot'))).order_by(r.Offer.id)):
            billing=r.offer_billing_dict(offer);done=Decimal(str((billing or {}).get('paid') or 0));amount=Decimal(str(r._contract_gross(offer)))
            if billing:
                consumed.update(x['id'] for x in billing['invoices'])
                if offer.payment_completed:amount=done
                else:amount=max(amount,done)
            rows.append(dict(id=uuid4().hex,title=(offer.vendor+((' · '+offer.number) if offer.number else ''))[:180],amount=float(amount),paid=float(done),enabled=offer.status in ACCEPTED,allocations={},source=source(offer)))
        # Include planned DIY costs, grouping their receipts once, independently of quotes.
        for plan in r.self_work_costs():
            if plan['archived']:continue
            ids={x['id'] for x in plan['receipts']}-consumed
            related=[x for x in receipts if x.id in ids];consumed.update(ids)
            done=sum((Decimal(x.paid_amount or 0) for x in related),ZERO)
            billed=sum((Decimal(str(r._receipt_increment(x))) for x in related),ZERO)
            amount=max(Decimal(str(plan['estimated_cost'])),billed,done)
            rows.append(dict(id=uuid4().hex,title=plan['title'][:180],amount=float(amount),paid=float(done),enabled=True,allocations={},source=dict(kind='self_work',id=plan['id'],title=plan['title'])))
        for receipt in receipts:
            if receipt.id in consumed:continue
            amount=max(Decimal(str(r._receipt_increment(receipt))),Decimal(receipt.paid_amount or 0))
            rows.append(dict(id=uuid4().hex,title=(receipt.supplier or receipt.original_name)[:180],amount=float(amount),paid=float(receipt.paid_amount or 0),enabled=True,allocations={},source=dict(kind='receipt',id=receipt.id,title=receipt.supplier or receipt.original_name)))
        return dict(version=1,basis=base,lines=rows,reserve=dict(mode='percent',value=0,allocations={}))
    def live_changes(data):
        changes=[]
        for line in data['lines']:
            src=line.get('source') or {}
            if src.get('kind')!='offer':continue
            offer=db.session.get(r.Offer,src['id'])
            if not offer:changes.append(dict(line_id=line['id'],title=line['title'],missing=True));continue
            current=source(offer)
            if current['token']!=src['token']:changes.append(dict(line_id=line['id'],title=line['title'],missing=False,current_amount=current['amount']))
        return changes
    def wire(row,full=True):
        data=json.loads(row.data_json)
        result=dict(id=row.id,title=row.title,notes=row.notes,revision=row.revision,created_at=row.created_at.isoformat(),updated_at=row.updated_at.isoformat(),captured_at=data['basis']['captured_at'],summary=calculate(data))
        if full:result.update(data=data,changes=live_changes(data),basis_changed=frame()[0]['finance_token']!=data['basis']['finance_token'])
        return result
    def update(row,data):row.data_json=json.dumps(data,ensure_ascii=False,allow_nan=False);row.revision=uuid4().hex;row.updated_at=datetime.now(timezone.utc)
    def checked(ident,body):
        row=db.session.get(FinanceScenario,ident)
        if row is None:return None,(jsonify(error='Szenario nicht gefunden.'),404)
        if not isinstance(body,dict) or body.get('revision')!=row.revision:return None,(jsonify(error='Das Szenario wurde inzwischen geändert. Bitte den aktuellen Stand laden; deine Eingaben bleiben erhalten.'),409)
        return row,None
    @app.route('/api/finance-scenarios',methods=['GET','POST'])
    def finance_scenarios_list():
        if request.method=='GET':return jsonify(scenarios=[wire(x,False) for x in db.session.scalars(select(FinanceScenario).order_by(FinanceScenario.updated_at.desc(),FinanceScenario.id.desc()))])
        try:
            body=request.get_json(silent=True)
            if not isinstance(body,dict) or set(body)-{'title','copy_id'}:raise ValueError('Ungültiges neues Szenario.')
            title=plain(body.get('title',''),'Titel',120,required=True)
            if body.get('copy_id') is not None:
                if type(body['copy_id'])is not int:raise ValueError('Ungültige Vorlage.')
                previous=db.session.get(FinanceScenario,body['copy_id'])
                if previous is None:return jsonify(error='Szenariovorlage nicht gefunden.'),404
                data=json.loads(previous.data_json);notes=previous.notes
            else:data=basis();notes=''
            validate_snapshot(json.dumps(data,ensure_ascii=False,allow_nan=False))
            row=FinanceScenario(title=title,notes=notes,data_json=json.dumps(data,ensure_ascii=False));db.session.add(row);db.session.flush()
            response=jsonify(scenario=wire(row));db.session.commit();return response,201
        except (ValueError,TypeError,InvalidOperation) as exc:db.session.rollback();return jsonify(error=str(exc)),400
    @app.route('/api/finance-scenarios/<int:ident>',methods=['GET','PUT','DELETE'])
    def finance_scenario_detail(ident):
        if request.method=='GET':
            row=db.session.get(FinanceScenario,ident)
            return jsonify(scenario=wire(row)) if row else (jsonify(error='Szenario nicht gefunden.'),404)
        try:
            body=request.get_json(silent=True);row,failure=checked(ident,body)
            if failure:return failure
            if request.method=='DELETE':
                if set(body)!={'revision','confirm'} or body.get('confirm')is not True:raise ValueError('Löschen des Szenarios bitte bestätigen.')
                db.session.delete(row);db.session.commit();return jsonify(ok=True)
            title,notes,data=clean(body,json.loads(row.data_json));row.title=title;row.notes=notes;update(row,data);db.session.flush()
            response=jsonify(scenario=wire(row));db.session.commit();return response
        except (ValueError,TypeError,InvalidOperation) as exc:db.session.rollback();return jsonify(error=str(exc)),400
    @app.post('/api/finance-scenarios/<int:ident>/preview')
    def finance_scenario_preview(ident):
        try:
            body=request.get_json(silent=True);row,failure=checked(ident,body)
            if failure:return failure
            _,_,data=clean(body,json.loads(row.data_json));return jsonify(summary=calculate(data))
        except (ValueError,TypeError,InvalidOperation) as exc:db.session.rollback();return jsonify(error=str(exc)),400
    @app.post('/api/finance-scenarios/<int:ident>/offer-price')
    def finance_scenario_offer_price(ident):
        try:
            body=request.get_json(silent=True);row,failure=checked(ident,body)
            if failure:return failure
            if set(body)!={'revision','line_id'}:raise ValueError('Ungültige Angebotsauswahl.')
            data=json.loads(row.data_json);line=next((x for x in data['lines'] if x['id']==body['line_id']),None)
            if not line or (line.get('source') or {}).get('kind')!='offer':raise ValueError('Diese Position ist kein Angebot.')
            offer=db.session.get(r.Offer,line['source']['id'])
            if offer is None:return jsonify(error='Angebot nicht mehr vorhanden.'),404
            src=source(offer);line['amount']=src['amount'];line['source']=src
            calculate(data);update(row,data);db.session.flush();response=jsonify(scenario=wire(row));db.session.commit();return response
        except (ValueError,TypeError,InvalidOperation) as exc:db.session.rollback();return jsonify(error=str(exc)),400
    return FinanceScenario
