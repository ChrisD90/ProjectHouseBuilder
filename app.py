"""Lokaler Sanierungsplaner. Start: python app.py"""
import csv
import io
import json
import os
from uuid import uuid4
from hashlib import sha256
from shutil import copyfile
import math
import sqlite3
import tempfile
import zipfile
from datetime import date, datetime
from financials import effective_offer, forecast_lines, monetary_totals
from offer_parser import parse_pdf
from receipt_parser import parse_receipt, extract_text, CATEGORIES
from scheduler import schedule
from pathlib import Path
import hmac
from werkzeug.middleware.proxy_fix import ProxyFix
from flask import Flask, jsonify, render_template, request, Response, send_file, session, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import select, text, inspect as sa_inspect

ROOT = Path(__file__).resolve().parent
app = Flask(__name__)
# Authentication is opt-in for local tests, mandatory in the Docker/LAN deployment.
app.secret_key = os.environ.get('APP_SECRET_KEY', 'development-only-not-for-LAN')
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict',
                  SESSION_COOKIE_SECURE=os.environ.get('SECURE_COOKIES') == '1',
                  PERMANENT_SESSION_LIFETIME=__import__('datetime').timedelta(days=7))
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

@app.before_request
def require_local_login():
    secret = os.environ.get('APP_PASSWORD')
    if not secret or request.endpoint in ('login','pwa_manifest','service_worker','app_icon','static'):
        return None
    if session.get('signed_in') is not True:
        if request.path.startswith('/api/'):
            return jsonify(error='Nicht angemeldet'), 401
        return redirect(url_for('login'))
    if request.method not in ('GET','HEAD','OPTIONS'):
        origin = request.headers.get('Origin')
        if origin and origin.rstrip('/') != request.host_url.rstrip('/'):
            return jsonify(error='Ungültiger Anfrage-Ursprung'),403
    return None

@app.route('/login', methods=['GET','POST'])
def login():
    if request.method == 'POST':
        expected=os.environ.get('APP_PASSWORD','')
        provided=request.form.get('password','')
        if expected and hmac.compare_digest(provided,expected):
            session.clear(); session['signed_in']=True;session.permanent=True
            return redirect('/')
        return render_template('login.html',error='Passwort nicht korrekt'),401
    if session.get('signed_in'):return redirect('/')
    return render_template('login.html',error='')

@app.post('/logout')
def logout():
    session.clear()
    return redirect('/login')

@app.get('/manifest.webmanifest')
def pwa_manifest():
    return send_file(ROOT/'static'/'manifest.webmanifest',mimetype='application/manifest+json')

@app.get('/sw.js')
def service_worker():
    response=send_file(ROOT/'static'/'sw.js',mimetype='text/javascript')
    response.headers['Service-Worker-Allowed']='/'
    response.headers['Cache-Control']='no-store'
    return response

@app.get('/static/icons/<path:filename>')
def app_icon(filename):
    return send_file(ROOT/'static'/'icons'/filename)

DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///' + str(ROOT / 'sanierung.db'))
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
app.config.update(SQLALCHEMY_DATABASE_URI=DATABASE_URL, SQLALCHEMY_TRACK_MODIFICATIONS=False, JSON_AS_ASCII=False)
db = SQLAlchemy(app)
app.config['MAX_CONTENT_LENGTH'] = 30 * 1024 * 1024  # 30 MB je Datei
DOCUMENT_ROOT = ROOT / 'private' / 'documents'
DOCUMENT_EXTENSIONS = {'.pdf', '.docx', '.xlsx', '.jpg', '.jpeg', '.png', '.txt'}

class Setting(db.Model):
    key = db.Column(db.String(80), primary_key=True)
    value = db.Column(db.String(255), nullable=False)

class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), unique=True, nullable=False)
    sort_order = db.Column(db.Integer, nullable=False, default=0)


def category_names():
    return [row.name for row in db.session.scalars(select(Category).order_by(Category.sort_order, Category.name)).all()]


class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(30), unique=True, nullable=False)
    phase = db.Column(db.String(140), nullable=False, default='Allgemein')
    trade = db.Column(db.String(140), nullable=False, default='Sonstiges')
    name = db.Column(db.String(300), nullable=False)
    company = db.Column(db.String(300), nullable=False, default='')
    contractor_id = db.Column(db.Integer, db.ForeignKey('contractor.id'), nullable=True)
    duration = db.Column(db.Integer, nullable=False, default=1)
    lag_days = db.Column(db.Integer, nullable=False, default=0)
    earliest_start = db.Column(db.Date)
    actual_start = db.Column(db.Date)
    actual_end = db.Column(db.Date)
    status = db.Column(db.String(40), nullable=False, default='Offen')
    progress = db.Column(db.Integer, nullable=False, default=0)
    notes = db.Column(db.Text, nullable=False, default='')
    position = db.Column(db.Integer, nullable=False, default=0)
    dependencies = db.relationship('Dependency', foreign_keys='Dependency.task_id', cascade='all, delete-orphan', lazy='select')

class Dependency(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('task.id', ondelete='CASCADE'), nullable=False)
    predecessor_id = db.Column(db.Integer, db.ForeignKey('task.id', ondelete='CASCADE'), nullable=False)
    __table_args__ = (db.UniqueConstraint('task_id','predecessor_id'),)

class Contractor(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    trade=db.Column(db.String(140),default='')
    name=db.Column(db.String(200),nullable=False)
    contact=db.Column(db.String(200),default='')
    phone=db.Column(db.String(100),default='')
    email=db.Column(db.String(200),default='')
    address=db.Column(db.String(400),default='')
    notes=db.Column(db.Text,default='')

class CostItem(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    category=db.Column(db.String(120),nullable=False,default='Sonstiges')
    title=db.Column(db.String(300),nullable=False)
    contractor_id=db.Column(db.Integer,db.ForeignKey('contractor.id'),nullable=True)
    task_id=db.Column(db.Integer,db.ForeignKey('task.id'),nullable=True)
    kind=db.Column(db.String(40),nullable=False,default='Fremdleistung')
    state=db.Column(db.String(40),nullable=False,default='Schätzung')
    estimate=db.Column(db.Float,nullable=False,default=0)
    offer=db.Column(db.Float,nullable=False,default=0)
    committed=db.Column(db.Float,nullable=False,default=0)
    paid=db.Column(db.Float,nullable=False,default=0)
    own_hours=db.Column(db.Float,nullable=False,default=0)
    own_hourly=db.Column(db.Float,nullable=False,default=0)
    source_ref=db.Column(db.String(300),default='')
    notes=db.Column(db.Text,default='')
    budget_line_id=db.Column(db.Integer, db.ForeignKey('budget_line.id'), nullable=True)
    selected=db.Column(db.Boolean, nullable=False, default=False)
    offer_id=db.Column(db.Integer,db.ForeignKey('offer.id'),nullable=True)

class BudgetLine(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    code=db.Column(db.String(40),unique=True,nullable=False)
    category=db.Column(db.String(160),nullable=False)
    title=db.Column(db.String(300),nullable=False)
    parent_code=db.Column(db.String(40),default='')
    marker=db.Column(db.String(10),default='')
    estimate=db.Column(db.Float,nullable=False,default=0)
    company_hint=db.Column(db.String(200),default='')
    kind=db.Column(db.String(40),nullable=False,default='Fremdleistung')
    notes=db.Column(db.Text,default='')
    source_row=db.Column(db.Integer)
    sort_order=db.Column(db.Integer,nullable=False,default=0)
    is_group=db.Column(db.Boolean,nullable=False,default=False)
    active=db.Column(db.Boolean,nullable=False,default=True)

class Funding(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    name=db.Column(db.String(200),nullable=False)
    expected=db.Column(db.Float,nullable=False,default=0)
    confirmed=db.Column(db.Float,nullable=False,default=0)
    received=db.Column(db.Float,nullable=False,default=0)
    notes=db.Column(db.Text,default='')

class Document(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    original_name = db.Column(db.String(260), nullable=False)
    stored_name = db.Column(db.String(80), unique=True, nullable=False)
    kind = db.Column(db.String(40), default='Angebot')
    contractor_id = db.Column(db.Integer, db.ForeignKey('contractor.id'), nullable=True)
    budget_line_id = db.Column(db.Integer, db.ForeignKey('budget_line.id'), nullable=True)
    cost_item_id = db.Column(db.Integer, db.ForeignKey('cost_item.id'), nullable=True)
    notes = db.Column(db.Text, default='')
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

class Receipt(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    digest=db.Column(db.String(64),nullable=False,unique=True)
    original_name=db.Column(db.String(260),nullable=False)
    stored_name=db.Column(db.String(90),nullable=False,unique=True)
    source=db.Column(db.String(35),default='')
    ocr_text=db.Column(db.Text,default='')
    warnings=db.Column(db.Text,default='[]')
    supplier=db.Column(db.String(200),default='')
    invoice_number=db.Column(db.String(100),default='')
    document_date=db.Column(db.String(10),default='')
    due_date=db.Column(db.String(10),default='')
    gross_amount=db.Column(db.Numeric(12,2),nullable=True)
    net_amount=db.Column(db.Numeric(12,2),nullable=True)
    vat_amount=db.Column(db.Numeric(12,2),nullable=True)
    category=db.Column(db.String(120),default='Sonstiges')
    kind=db.Column(db.String(30),default='Rechnung')
    notes=db.Column(db.Text,default='')
    status=db.Column(db.String(20),nullable=False,default='Entwurf')
    paid_amount=db.Column(db.Numeric(12,2),nullable=False,default=0)
    budget_line_id=db.Column(db.Integer,db.ForeignKey('budget_line.id'))
    cost_item_id=db.Column(db.Integer,db.ForeignKey('cost_item.id'))
    created_at=db.Column(db.DateTime,nullable=False,default=datetime.utcnow)

class Offer(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    digest=db.Column(db.String(64),unique=True,nullable=False)
    document_id=db.Column(db.Integer,db.ForeignKey('document.id'))
    contractor_id=db.Column(db.Integer,db.ForeignKey('contractor.id'))
    vendor=db.Column(db.String(200),nullable=False)
    number=db.Column(db.String(100),default='')
    issued=db.Column(db.String(20),default='')
    expires=db.Column(db.String(20),default='')
    gross=db.Column(db.Float)
    net=db.Column(db.Float)
    vat=db.Column(db.Float)
    tax_rate=db.Column(db.Float,default=0)
    status=db.Column(db.String(30),nullable=False,default='Angebot')
    reconciled=db.Column(db.Boolean,nullable=False,default=False)
    warnings=db.Column(db.Text,nullable=False,default='[]')
    filename=db.Column(db.String(260),nullable=False)
    created_at=db.Column(db.DateTime,default=datetime.utcnow)
    sections=db.relationship('OfferSection',cascade='all,delete-orphan',lazy='select')
    positions=db.relationship('OfferPosition',cascade='all,delete-orphan',lazy='select')

class OfferSection(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    offer_id=db.Column(db.Integer,db.ForeignKey('offer.id',ondelete='CASCADE'),nullable=False)
    name=db.Column(db.String(170),nullable=False)
    net=db.Column(db.Float,nullable=False,default=0)
    gross=db.Column(db.Float,nullable=False,default=0)
    budget_line_id=db.Column(db.Integer,db.ForeignKey('budget_line.id'))
    selected=db.Column(db.Boolean,nullable=False,default=False)
    sort_order=db.Column(db.Integer,nullable=False,default=0)

class OfferPosition(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    offer_id=db.Column(db.Integer,db.ForeignKey('offer.id',ondelete='CASCADE'),nullable=False)
    number=db.Column(db.String(30),nullable=False)
    section=db.Column(db.String(170),nullable=False)
    description=db.Column(db.String(300),nullable=False)
    quantity=db.Column(db.Float)
    unit=db.Column(db.String(40),default='')
    unit_price=db.Column(db.Float)
    net_amount=db.Column(db.Float)
    optional_amount=db.Column(db.Float)
    optional=db.Column(db.Boolean,nullable=False,default=False)
    page=db.Column(db.Integer)

class HistoricalEstimate(db.Model):
    id=db.Column(db.Integer,primary_key=True)
    sheet_row=db.Column(db.Integer)
    name=db.Column(db.String(200),nullable=False)
    architect_estimate=db.Column(db.Float,nullable=False,default=0)
    own_estimate=db.Column(db.Float,nullable=False,default=0)
    supplier_note=db.Column(db.String(200),default='')

def setting(name, default=''):
    obj = db.session.get(Setting, name)
    return obj.value if obj else default

def parse_date(value):
    if not value: return None
    return date.fromisoformat(str(value)[:10])

def serialize(tasks):
    start = parse_date(setting('start', '2027-03-01'))
    sched = schedule(tasks, start)
    by_id = {t.id:t for t in tasks}
    output = []
    for t in tasks:
        s,e = sched[t.id]
        output.append({'id':t.id,'code':t.code,'phase':t.phase,'trade':t.trade,'name':t.name,'company':t.company,'contractor_id':t.contractor_id,
                       'duration':t.duration,'lag_days':t.lag_days,'earliest_start':t.earliest_start.isoformat() if t.earliest_start else '',
                       'actual_start':t.actual_start.isoformat() if t.actual_start else '',
                       'actual_end':t.actual_end.isoformat() if t.actual_end else '',
                       'status':t.status,'progress':t.progress,'notes':t.notes,'position':t.position,
                       'predecessors':[by_id[d.predecessor_id].code for d in t.dependencies if d.predecessor_id in by_id],
                       'start':s.isoformat(),'end':e.isoformat()})
    return output

def all_tasks():
    return db.session.scalars(select(Task).order_by(Task.position, Task.id)).all()

def initialize():
    # Additive migration for existing SQLite/PostgreSQL user databases (never drop old entries).
    db.create_all()
    receipt_columns={col['name'] for col in sa_inspect(db.engine).get_columns('receipt')}
    if 'due_date' not in receipt_columns:
        db.session.execute(text("ALTER TABLE receipt ADD COLUMN due_date VARCHAR(10) NOT NULL DEFAULT ''"))
    task_columns={col['name'] for col in sa_inspect(db.engine).get_columns('task')}
    if 'contractor_id' not in task_columns:
        db.session.execute(text('ALTER TABLE task ADD COLUMN contractor_id INTEGER'))
    old_columns={col['name'] for col in sa_inspect(db.engine).get_columns('cost_item')}
    if 'budget_line_id' not in old_columns:
        db.session.execute(text('ALTER TABLE cost_item ADD COLUMN budget_line_id INTEGER'))
    if 'selected' not in old_columns:
        db.session.execute(text('ALTER TABLE cost_item ADD COLUMN selected BOOLEAN NOT NULL DEFAULT FALSE'))
    if 'offer_id' not in old_columns:
        db.session.execute(text('ALTER TABLE cost_item ADD COLUMN offer_id INTEGER'))
    db.session.commit()
    # Seed once only: renamed/deleted defaults must not reappear on restart.
    if not db.session.scalar(select(Category.id).limit(1)):
        for index,name in enumerate(CATEGORIES):
            db.session.add(Category(name=name,sort_order=index))
        db.session.commit()
    if not db.session.get(Setting,'start'):
        db.session.add(Setting(key='start', value='2027-03-01'))
    if not db.session.scalar(select(Task.id).limit(1)):
        initial = json.loads((ROOT/'seed.json').read_text(encoding='utf-8'))
        for i,data in enumerate(initial):
            db.session.add(Task(code=data['code'], phase=data['phase'],trade=data['trade'],name=data['name'],
                                company=data['company'],duration=data['duration'],lag_days=data['lag_days'],
                                earliest_start=parse_date(data['earliest_start']), status=data['status'],
                                progress=data['progress'], actual_start=parse_date(data['actual_start']),
                                actual_end=parse_date(data['actual_end']), notes=data['notes'],position=i))
        db.session.flush()
        by_code={t.code:t.id for t in all_tasks()}
        for data in initial:
            for code in data['predecessors']:
                db.session.add(Dependency(task_id=by_code[data['code']], predecessor_id=by_code[code]))
    db.session.commit()
    initialize_budget()

@app.get('/')
def home():
    return render_template('index.html')

@app.get('/api/project')
def project():
    tasks=serialize(all_tasks())
    contractors=db.session.scalars(select(Contractor).order_by(Contractor.name)).all()
    return jsonify({'start':setting('start'), 'tasks':tasks,'contractors':[{'id':x.id,'name':x.name,'trade':x.trade,'phone':x.phone,'email':x.email} for x in contractors]})

@app.patch('/api/project')
def update_project():
    body=request.get_json(force=True)
    try:
        start=parse_date(body.get('start'))
        if not start: raise ValueError('Projektstart fehlt.')
        obj=db.session.get(Setting,'start');obj.value=start.isoformat()
        schedule(all_tasks(), start)
        db.session.commit()
        return jsonify({'start':start.isoformat()})
    except (ValueError,TypeError) as err:
        db.session.rollback();return jsonify(error=str(err)),400

FIELDS={'code','phase','trade','name','company','contractor_id','duration','lag_days','earliest_start','actual_start','actual_end','status','progress','notes','position'}

def update_task_fields(t,body):
    for f in FIELDS:
        if f not in body:continue
        v=body[f]
        if f in ('earliest_start','actual_start','actual_end'):v=parse_date(v)
        elif f=='contractor_id':v=int(v) if v not in ('',None) else None
        elif f in ('duration','lag_days','progress','position'):v=int(v)
        else:v=str(v or '')
        setattr(t,f,v)
    if not t.name.strip():raise ValueError('Aufgabenname fehlt.')
    if not t.code.strip():raise ValueError('ID fehlt.')
    if t.duration<1 or t.lag_days<0 or t.progress<0 or t.progress>100:raise ValueError('Ungültige Dauer, Abstand oder Fortschritt.')
    if t.status not in ('Offen','In Arbeit','Erledigt','Pausiert'):raise ValueError('Ungültiger Status.')
    if t.contractor_id and not db.session.get(Contractor,t.contractor_id):raise ValueError('Firma existiert nicht.')

def set_predecessors(t,codes):
    if len(codes)!=len(set(codes)):raise ValueError('Vorgänger doppelt angegeben.')
    by_code={x.code:x for x in all_tasks()}
    db.session.flush()
    t.dependencies.clear()
    db.session.flush()
    for code in codes:
        if code not in by_code:raise ValueError('Unbekannter Vorgänger: '+code)
        if by_code[code].id==t.id:raise ValueError('Eine Aufgabe kann nicht von sich selbst abhängen.')
        t.dependencies.append(Dependency(predecessor_id=by_code[code].id))

@app.post('/api/tasks')
def create_task():
    body=request.get_json(force=True)
    try:
        task=Task(code='',name='',position=len(all_tasks()))
        db.session.add(task)
        update_task_fields(task,body)
        db.session.flush()
        set_predecessors(task,body.get('predecessors',[]))
        schedule(all_tasks(),parse_date(setting('start')))
        db.session.commit()
        return jsonify({'ok':True,'id':task.id}),201
    except (ValueError,TypeError) as err:
        db.session.rollback();return jsonify(error=str(err)),400
    except Exception as err:
        db.session.rollback();return jsonify(error='ID bereits vergeben oder Eingabe ungültig.'),400

@app.put('/api/tasks/<int:task_id>')
def update_task(task_id):
    t=db.session.get(Task,task_id)
    if not t:return jsonify(error='Aufgabe nicht gefunden.'),404
    body=request.get_json(force=True)
    try:
        update_task_fields(t,body)
        db.session.flush()
        if 'predecessors' in body:set_predecessors(t,body['predecessors'])
        schedule(all_tasks(),parse_date(setting('start')))
        db.session.commit()
        return jsonify({'ok':True})
    except (ValueError,TypeError) as err:
        db.session.rollback();return jsonify(error=str(err)),400
    except Exception:
        db.session.rollback();return jsonify(error='ID bereits vergeben oder Eingabe ungültig.'),400

@app.delete('/api/tasks/<int:task_id>')
def delete_task(task_id):
    t=db.session.get(Task,task_id)
    if not t:return jsonify(error='Aufgabe nicht gefunden.'),404
    dependents=db.session.scalars(select(Dependency).where(Dependency.predecessor_id==task_id)).all()
    if dependents:return jsonify(error='Andere Aufgaben hängen davon ab. Zuerst die Abhängigkeiten entfernen.'),409
    db.session.delete(t);db.session.commit()
    return jsonify({'ok':True})

@app.get('/api/export.csv')
def export_csv():
    data=serialize(all_tasks());buf=io.StringIO();fields=['code','phase','trade','name','company','predecessors','lag_days','duration','earliest_start','start','end','status','progress','actual_start','actual_end','notes']
    writer=csv.DictWriter(buf,fieldnames=fields,extrasaction='ignore',delimiter=';');writer.writeheader()
    for row in data:writer.writerow({**row,'predecessors':', '.join(row['predecessors'])})
    return Response('\ufeff'+buf.getvalue(),mimetype='text/csv; charset=utf-8',headers={'Content-Disposition':'attachment; filename=Sanierungsprojekt_Plan.csv'})

@app.get('/api/backup.json')
def backup():
    return Response(json.dumps({'start':setting('start'),'tasks':serialize(all_tasks()),'costs':[as_dict(x,COST_FIELDS) for x in db.session.scalars(select(CostItem))], 'budget_lines':[budget_dict(x) for x in all_budget_lines()], 'funding':[funding_dict(x) for x in db.session.scalars(select(Funding))], 'contractors':[as_dict(x,CONTACT_FIELDS) for x in db.session.scalars(select(Contractor))], 'documents':[document_dict(x) for x in db.session.scalars(select(Document))], 'offers':[offer_dict(x) for x in db.session.scalars(select(Offer))]},ensure_ascii=False,indent=2),mimetype='application/json',headers={'Content-Disposition':'attachment; filename=Sanierungsprojekt_Backup.json'})

COST_FIELDS={'category','title','contractor_id','task_id','budget_line_id','selected','kind','state','estimate','offer','committed','paid','own_hours','own_hourly','source_ref','notes'}
CONTACT_FIELDS={'trade','name','contact','phone','email','address','notes'}

def as_dict(obj,fields):
    return {f:getattr(obj,f) for f in fields}|{'id':obj.id}

def update_record(obj,body,fields):
    for f in fields:
        if f not in body:continue
        v=body[f]
        if f in ('contractor_id','task_id','budget_line_id'):v=int(v) if v not in ('',None) else None
        elif f=='selected':v=v is True or str(v).lower() in ('true','on','1','yes')
        elif f in ('estimate','offer','committed','paid','own_hours','own_hourly'):
            v=float(v or 0)
            if not math.isfinite(v) or v<0:raise ValueError('Beträge und Stunden müssen endliche, nicht negative Zahlen sein.')
        else:v=str(v or '')
        setattr(obj,f,v)
    if not getattr(obj,'name',getattr(obj,'title','')).strip():raise ValueError('Name/Bezeichnung fehlt.')
    if isinstance(obj,CostItem):
        if obj.kind not in ('Fremdleistung','Eigenleistung'):raise ValueError('Ungültige Leistungsart.')
        if obj.state not in ('Schätzung','Angebot','Beauftragt','Abgeschlossen','Alternative','Abgelehnt'):raise ValueError('Ungültiger Status.')
        if obj.budget_line_id and not db.session.get(BudgetLine,obj.budget_line_id):raise ValueError('Budgetzeile nicht vorhanden.')
        if obj.selected and obj.state in ('Alternative','Abgelehnt'):raise ValueError('Abgelehntes/alternatives Angebot kann nicht ausgewählt sein.')
        if obj.selected and obj.budget_line_id:
            other=db.session.scalar(select(CostItem.id).where(CostItem.budget_line_id==obj.budget_line_id,CostItem.selected.is_(True),CostItem.id!=obj.id).limit(1))
            if other:raise ValueError('Für diese Budgetposition ist bereits ein anderes Angebot ausgewählt. Dort zuerst die Auswahl entfernen.')
        if obj.contractor_id and not db.session.get(Contractor,obj.contractor_id):raise ValueError('Firma nicht vorhanden.')
        if obj.task_id and not db.session.get(Task,obj.task_id):raise ValueError('Arbeitspaket nicht vorhanden.')

def all_budget_lines():
    return db.session.scalars(select(BudgetLine).order_by(BudgetLine.sort_order, BudgetLine.id)).all()

def budget_dict(x):
    return {key:getattr(x,key) for key in ('id','code','category','title','parent_code','marker','estimate','company_hint','kind','notes','source_row','sort_order','is_group','active')}

def funding_dict(x):
    return {key:getattr(x,key) for key in ('id','name','expected','confirmed','received','notes')}

def initialize_budget():
    # Import private spreadsheet data once only; does not overwrite subsequent user changes.
    if db.session.get(Setting,'excel_budget_initialized'):return
    seed=ROOT/'data'/'initial_budget.json'
    if not seed.exists():return
    data=json.loads(seed.read_text(encoding='utf-8'))
    if not db.session.scalar(select(BudgetLine.id).limit(1)):
        for seq,line in enumerate(data['lines']):
            db.session.add(BudgetLine(code=line['code'],category=line['category'],title=line['title'],parent_code=line['parent_code'],marker=line['marker'],estimate=line['amount'],company_hint=line['company_hint'],kind='Eigenleistung' if line['own_work'] else 'Fremdleistung',notes=line['notes'],source_row=line['source_row'],sort_order=seq,is_group=line['is_group']))
    if not db.session.scalar(select(Funding.id).limit(1)):
        for row in data['funding']:db.session.add(Funding(name=row['name'],expected=row['value']))
    if not db.session.scalar(select(HistoricalEstimate.id).limit(1)):
        for row in data['historical']:
            db.session.add(HistoricalEstimate(sheet_row=row['row'],name=row['name'],architect_estimate=row['architect_estimate'],own_estimate=row['own_estimate'],supplier_note=row['supplier_note']))
    # Hints from the user's spreadsheet are NOT verified awarded contracts.
    known={c.name.lower() for c in db.session.scalars(select(Contractor))}
    for line in data['lines']:
        name=line['company_hint'].strip()
        if name and name!='Eigenleistung' and name.lower() not in known:
            db.session.add(Contractor(name=name,trade=line['category'],notes='Aus Kostenplanung übernommen; Kontaktdaten und Beauftragungsstatus prüfen.'))
            known.add(name.lower())
    db.session.add(Setting(key='excel_budget_initialized',value='1'))
    if not db.session.get(Setting,'initial_budget'):db.session.add(Setting(key='initial_budget',value=str(data['budget_total'])))
    if not db.session.get(Setting,'historical_funding'):db.session.add(Setting(key='historical_funding',value=json.dumps(data.get('historical_funding',{}),ensure_ascii=False)))
    db.session.commit()

def budget_summary(items):
    lines=all_budget_lines()
    active=[x for x in lines if x.active and not x.is_group]
    valid=[x for x in items if x.state not in ('Alternative','Abgelehnt')]
    previews,basis,extras=forecast_lines(lines,items)
    # Reviewed receipts are tracked separately from quotations and contracts.
    booked=db.session.scalars(select(Receipt).where(Receipt.status=='Gebucht')).all()
    receipt_by_line={};unplanned_receipts=[]
    for receipt in booked:
        if receipt.budget_line_id in previews:
            receipt_by_line.setdefault(receipt.budget_line_id,[]).append(receipt)
        elif receipt.cost_item_id and db.session.get(CostItem,receipt.cost_item_id):
            # An already forecast unlinked contractor item is not a second new expense.
            pass
        else:
            unplanned_receipts.append(receipt)
    for line_id, receipts in receipt_by_line.items():
        actual=sum(float(x.gross_amount) for x in receipts)
        if actual>previews[line_id]:
            previews[line_id]=round(actual,2)
            basis[line_id]='Belege über Planansatz'
    linked={}
    for x in valid:
        if x.budget_line_id:linked.setdefault(x.budget_line_id,[]).append(x)
    outside=sum(effective_offer(x) for x in extras)
    extra_receipts=sum(float(x.gross_amount) for x in unplanned_receipts)
    forecast=sum(previews.values())+outside+extra_receipts
    spent=sum(x.paid for x in items)+sum(float(x.paid_amount or 0) for x in booked)
    committed=sum(x.committed for x in items if x.state in ('Beauftragt','Abgeschlossen'))
    funds=db.session.scalars(select(Funding)).all()
    funding_confirmed=sum(f.confirmed for f in funds)
    funding_expected=sum(f.expected for f in funds)
    budget=float(setting('initial_budget','0'))
    grouped={}
    for line in active:
        group=grouped.setdefault(line.category,{'category':line.category,'estimate':0,'planned':0,'paid':0})
        group['estimate']+=line.estimate;group['planned']+=previews[line.id];group['paid']+=sum(x.paid for x in linked.get(line.id,[]))
    for x in extras:
        group=grouped.setdefault(x.category,{'category':x.category,'estimate':0,'planned':0,'paid':0})
        group['planned']+=effective_offer(x);group['paid']+=x.paid
    for r in booked:
        category=next((line.category for line in active if line.id==r.budget_line_id),r.category)
        group=grouped.setdefault(category,{'category':category,'estimate':0,'planned':0,'paid':0})
        group['paid']+=float(r.paid_amount or 0)
    for r in unplanned_receipts:
        group=grouped.setdefault(r.category,{'category':r.category,'estimate':0,'planned':0,'paid':0})
        group['planned']+=float(r.gross_amount)
    return {'budget':round(budget,2),'planned':round(forecast,2),'overrun':round(forecast-budget,2),'paid':round(spent,2),
            'remaining':round(forecast-spent,2),'committed':round(committed,2),
            'funding_confirmed':round(funding_confirmed,2),'funding_expected':round(funding_expected,2),
            'net_after_confirmed':round(forecast-funding_confirmed,2),
            'own_budget':round(sum(previews[x.id] for x in active if x.kind=='Eigenleistung') + sum(effective_offer(x) for x in extras if x.kind=='Eigenleistung'),2),
            'own_hours':round(sum(x.own_hours for x in valid if x.kind=='Eigenleistung'),1),
            'own_imputed_value':round(sum(x.own_hours*x.own_hourly for x in valid if x.kind=='Eigenleistung'),2),
            'receipt_booked':round(sum(float(x.gross_amount) for x in booked),2),
            'receipt_paid':round(sum(float(x.paid_amount or 0) for x in booked),2),
            'receipt_drafts':db.session.scalar(select(db.func.count(Receipt.id)).where(Receipt.status=='Entwurf')) or 0,
            'categories':[{'category':k,'estimate':round(v['estimate'],2),'planned':round(v['planned'],2),'paid':round(v['paid'],2)} for k,v in grouped.items()],
            'line_forecasts':previews,'line_basis':basis,'additional_items':len(extras)}


def _get_or_add_contractor(name, family):
    existing=db.session.scalar(select(Contractor).where(db.func.lower(Contractor.name)==name.lower()).limit(1))
    if existing:return existing
    obj=Contractor(name=name,trade={'WP':'Wärmepumpe / Heizung','PV':'Photovoltaik','P3':'Elektro'}.get(family,'Sonstiges'),notes='Aus PDF-Angebot eingelesen; keine Beauftragung bestätigt.')
    db.session.add(obj);db.session.flush();return obj


def add_parsed_offer(parsed,digest,source_document=None):
    if db.session.scalar(select(Offer.id).where(Offer.digest==digest)):
        raise ValueError('Dieses PDF-Angebot wurde bereits importiert (identischer Dateiinhalt).')
    contractor=_get_or_add_contractor(parsed['vendor'],parsed['family'])
    offer=Offer(digest=digest,document_id=source_document.id if source_document else None,
                contractor_id=contractor.id,vendor=parsed['vendor'],number=parsed['number'],
                issued=parsed['issued'],expires=parsed['expires'],net=parsed['net'],vat=parsed['vat'],
                gross=parsed['gross'],tax_rate=parsed['tax_rate'],status='Angebot',
                reconciled=parsed['reconciled'],warnings=json.dumps(parsed['warnings'],ensure_ascii=False),
                filename=parsed['filename'])
    db.session.add(offer);db.session.flush()
    for idx,section in enumerate(parsed['groups']):
        db.session.add(OfferSection(offer_id=offer.id,name=section['name'],net=section['net'],gross=section['gross'],
                        budget_line_id=None,sort_order=idx,selected=False))
    for entry in parsed['positions']:
        db.session.add(OfferPosition(offer_id=offer.id,**{k:entry.get(k) for k in ('number','section','description','quantity','unit','unit_price','net_amount','optional_amount','optional','page')}))
    return offer


def _sync_offer_costs(offer):
    """Synchronize accepted/selected PDF sections into distinct, counted budget costs.

    An accepted offer includes all non-optional sections. A section without a budget
    assignment is counted as an extra cost, never silently dropped.
    """
    existing={x.budget_line_id:x for x in db.session.scalars(select(CostItem).where(CostItem.offer_id==offer.id)).all()}
    grouped={}
    for section in offer.sections:
        if not section.selected:continue
        if not offer.reconciled:raise ValueError('PDF-Gesamtsumme ist nicht abgeglichen; vor Annahme prüfen.')
        line_id=section.budget_line_id
        if line_id is not None:
            line=db.session.get(BudgetLine,line_id)
            if not line or not line.active or line.is_group:
                raise ValueError('Zuordnung nur zu einer aktiven Kostenposition möglich.')
        grouped.setdefault(line_id,[]).append(section)
    for line_id, sections in grouped.items():
        if line_id is not None:
            other=db.session.scalar(select(CostItem.id).where(CostItem.budget_line_id==line_id,
                    CostItem.selected.is_(True),CostItem.offer_id!=offer.id).limit(1))
            if other:raise ValueError('Für diese Budgetposition ist bereits ein anderes Angebot gewählt. Bitte Zuordnung korrigieren.')
        line=db.session.get(BudgetLine,line_id) if line_id else None
        item=existing.pop(line_id,None)
        if item is None:item=CostItem(offer_id=offer.id,budget_line_id=line_id,title='',category=line.category if line else 'Nicht zugeordnet')
        total=round(sum(x.gross for x in sections),2)
        item.category=line.category if line else 'Nicht zugeordnet'
        item.title=f'{offer.vendor}: {", ".join(x.name for x in sections)}'[:300]
        item.contractor_id=offer.contractor_id;item.kind='Fremdleistung'
        item.offer=total;item.source_ref=offer.number
        item.state='Beauftragt' if offer.status in ('Angenommen','Beauftragt') else 'Angebot'
        item.committed=total if offer.status in ('Angenommen','Beauftragt') else 0
        item.selected=True
        db.session.add(item)
    for stale in existing.values():
        if stale.paid or db.session.scalar(select(Document.id).where(Document.cost_item_id==stale.id).limit(1)):
            raise ValueError('Diese Position hat Zahlungen/Dokumente und kann nicht automatisch entfernt werden.')
        db.session.delete(stale)


def offer_dict(o):
    return {'id':o.id,'number':o.number,'vendor':o.vendor,'filename':o.filename,
            'issued':o.issued,'expires':o.expires,'net':o.net,'vat':o.vat,'gross':o.gross,
            'tax_rate':o.tax_rate,'status':o.status,'reconciled':o.reconciled,
            'warnings':json.loads(o.warnings or '[]'),'document_id':o.document_id,'contractor_id':o.contractor_id,
            'sections':[{'id':g.id,'name':g.name,'net':g.net,'gross':g.gross,'budget_line_id':g.budget_line_id,
                         'selected':g.selected} for g in sorted(o.sections,key=lambda x:x.sort_order)],
            'positions':[{'number':p.number,'section':p.section,'description':p.description,
                          'quantity':p.quantity,'unit':p.unit,'unit_price':p.unit_price,
                          'net_amount':p.net_amount,'optional_amount':p.optional_amount,
                          'optional':p.optional,'page':p.page} for p in o.positions]}


@app.get('/api/offers')
def offers_list():
    return jsonify(offers=[offer_dict(x) for x in db.session.scalars(select(Offer).order_by(Offer.id.desc()))])


@app.post('/api/offers/import')
def offers_import():
    f=request.files.get('file')
    if not f or not f.filename or Path(f.filename).suffix.lower()!='.pdf':
        return jsonify(error='Bitte eine PDF-Datei auswählen.'),400
    data=f.read()
    if not data or not data.startswith(b'%PDF'):
        return jsonify(error='Die Datei ist kein gültiges PDF.'),400
    digest=sha256(data).hexdigest()
    if db.session.scalar(select(Offer.id).where(Offer.digest==digest)):
        return jsonify(error='Dieses PDF wurde bereits als Angebot importiert.'),409
    name=Path(f.filename).name[:240]
    try:parsed=parse_pdf(data,name)
    except Exception as exc:return jsonify(error='PDF konnte nicht ausgewertet werden: '+str(exc)),422
    DOCUMENT_ROOT.mkdir(parents=True,exist_ok=True)
    stored=uuid4().hex+'.pdf'
    (DOCUMENT_ROOT/stored).write_bytes(data)
    try:
        doc=Document(original_name=name,stored_name=stored,kind='Angebot',
                     notes='Automatisch analysiert; bitte Angebot/Zuordnungen prüfen.')
        db.session.add(doc);db.session.flush()
        obj=add_parsed_offer(parsed,digest,doc)
        doc.contractor_id=obj.contractor_id
        db.session.commit()
        return jsonify(ok=True,id=obj.id,offer=offer_dict(obj)),201
    except (ValueError,Exception) as exc:
        db.session.rollback();(DOCUMENT_ROOT/stored).unlink(missing_ok=True)
        return jsonify(error=str(exc)),400


@app.patch('/api/offers/<int:offer_id>')
def offer_update(offer_id):
    obj=db.session.get(Offer,offer_id)
    if not obj:return jsonify(error='Angebot nicht gefunden.'),404
    state=(request.get_json(force=True) or {}).get('status')
    if state not in ('Angebot','Angenommen','Beauftragt'):
        return jsonify(error='Erlaubt sind Angebot und Angenommen.'),400
    try:
        if state in ('Angenommen','Beauftragt'):
            if not obj.reconciled:
                raise ValueError('Das Angebot hat keine abgeglichene Gesamtsumme. Bitte erst prüfen.')
            # Accept all base sections. Optional positions are excluded by the parser.
            for section in obj.sections:section.selected=True
            if not obj.sections:
                raise ValueError('Keine auswertbaren Angebotsgruppen vorhanden.')
            obj.status='Angenommen'
        else:
            # Refuse changing a paid/accepted order back to a mere offer.
            linked=db.session.scalars(select(CostItem).where(CostItem.offer_id==obj.id)).all()
            if any(x.paid for x in linked):
                raise ValueError('Zu diesem angenommenen Angebot sind bereits Zahlungen erfasst.')
            obj.status='Angebot'
            for section in obj.sections:section.selected=False
        _sync_offer_costs(obj)
        db.session.commit();return jsonify(ok=True)
    except ValueError as exc:
        db.session.rollback();return jsonify(error=str(exc)),409


@app.patch('/api/offer-sections/<int:section_id>')
def offer_section_update(section_id):
    obj=db.session.get(OfferSection,section_id)
    if not obj:return jsonify(error='Abschnitt nicht gefunden.'),404
    body=request.get_json(force=True) or {}
    try:
        if 'budget_line_id' in body:
            raw=body['budget_line_id']; obj.budget_line_id=int(raw) if raw not in ('',None) else None
        if 'selected' in body:
            if db.session.get(Offer,obj.offer_id).status in ('Angenommen','Beauftragt') and not body['selected']:
                raise ValueError('Angenommene Angebote können nicht teilweise deaktiviert werden. Status zuerst zurücksetzen.')
            if not isinstance(body['selected'],bool):raise ValueError('Ungültiger Auswahlwert.')
            obj.selected=body['selected']
        db.session.flush()
        _sync_offer_costs(db.session.get(Offer,obj.offer_id))
        db.session.commit();return jsonify(ok=True)
    except (ValueError,TypeError) as exc:
        db.session.rollback();return jsonify(error=str(exc)),409


@app.patch('/api/offer-costs/<int:item_id>')
def offer_cost_payment(item_id):
    """Allow recording real payments without corrupting an imported offer amount."""
    obj=db.session.get(CostItem,item_id)
    if not obj or not obj.offer_id:return jsonify(error='Importierte Kostenposition nicht gefunden.'),404
    data=request.get_json(force=True) or {}
    try:
        if 'paid' in data:
            paid=float(data['paid'] or 0)
            if not math.isfinite(paid) or paid<0:raise ValueError('Zahlungsbetrag muss nicht-negativ sein.')
            if paid>0 and db.session.scalar(select(Receipt.id).where(Receipt.cost_item_id==obj.id,Receipt.status=='Gebucht').limit(1)):
                raise ValueError('Zu diesem Auftrag liegen bereits gebuchte Belege vor. Zahlung bitte dort erfassen.')
            obj.paid=paid
        if 'notes' in data:obj.notes=str(data['notes'] or '')[:2000]
        db.session.commit();return jsonify(ok=True)
    except (ValueError,TypeError) as exc:
        db.session.rollback();return jsonify(error=str(exc)),400


@app.delete('/api/offers/<int:offer_id>')
def offer_delete(offer_id):
    obj=db.session.get(Offer,offer_id)
    if not obj:return jsonify(error='Angebot nicht gefunden.'),404
    linked=db.session.scalars(select(CostItem).where(CostItem.offer_id==offer_id)).all()
    if any(x.paid or x.committed for x in linked):
        return jsonify(error='Zu diesem Angebot sind Zahlungen oder Aufträge gespeichert. Erst manuell prüfen.'),409
    doc=db.session.get(Document,obj.document_id) if obj.document_id else None
    try:
        for x in linked:db.session.delete(x)
        db.session.delete(obj)
        # Linked PDF is preserved as a document (do not discard private documents).
        db.session.commit();return jsonify(ok=True,document_id=doc.id if doc else None)
    except Exception:
        db.session.rollback();return jsonify(error='Angebot konnte nicht gelöscht werden.'),409

# Receipts are a separate, reviewed ledger; OCR guesses never change financial totals.
RECEIPT_ROOT=ROOT/'private'/'receipts'
RECEIPT_EXTENSIONS={'.pdf','.jpg','.jpeg','.png','.webp'}

def _receipt_json(r, include_text=False):
    obj={'id':r.id,'filename':r.original_name,'source':r.source,'supplier':r.supplier,'invoice_number':r.invoice_number,
         'document_date':r.document_date,'due_date':r.due_date,'gross_amount':float(r.gross_amount) if r.gross_amount is not None else None,
         'net_amount':float(r.net_amount) if r.net_amount is not None else None,
         'vat_amount':float(r.vat_amount) if r.vat_amount is not None else None,'category':r.category,
         'kind':r.kind,'notes':r.notes,'status':r.status,'paid_amount':float(r.paid_amount or 0),
         'budget_line_id':r.budget_line_id,'cost_item_id':r.cost_item_id,
         'warnings':json.loads(r.warnings or '[]'),'created_at':r.created_at.isoformat()}
    if include_text:obj['ocr_text']=r.ocr_text
    return obj

def _receipt_amount(value, name, optional=True):
    from decimal import Decimal, InvalidOperation
    if value in (None,''):
        if optional:return None
        raise ValueError(name+' fehlt.')
    try:
        result=Decimal(str(value).replace(',','.'))
        if not result.is_finite() or result<0 or result.as_tuple().exponent < -2 or result>Decimal('99999999.99'):
            raise ValueError()
        return result
    except (InvalidOperation, ValueError):raise ValueError('Ungültiger Betrag für '+name+'.')

@app.post('/api/receipts')
def receipt_upload():
    file=request.files.get('file')
    if not file or not file.filename:return jsonify(error='Bitte einen Beleg auswählen.'),400
    name=Path(file.filename).name[:240]; ext=Path(name).suffix.lower()
    if ext not in RECEIPT_EXTENSIONS:return jsonify(error='Nur PDF, JPG, PNG und WEBP erlaubt.'),400
    data=file.read(15*1024*1024+1)
    if not data or len(data)>15*1024*1024:return jsonify(error='Belege dürfen maximal 15 MB groß sein.'),400
    if ext=='.pdf' and not data.startswith(b'%PDF-'):return jsonify(error='Keine gültige PDF-Datei.'),400
    if ext!='.pdf':
        from PIL import Image, UnidentifiedImageError
        from io import BytesIO
        try:
            im=Image.open(BytesIO(data))
            if im.width*im.height>25_000_000:raise ValueError('Bildauflösung zu groß.')
            im.verify()
        except (ValueError, UnidentifiedImageError, OSError) as exc:return jsonify(error='Ungültiges oder zu großes Bild.'),400
    digest=sha256(data).hexdigest()
    original=db.session.scalar(select(Receipt).where(Receipt.digest==digest))
    if original:return jsonify(error='Dieser Beleg wurde bereits hochgeladen.',existing_id=original.id),409
    try:
        content,source=extract_text(data,name)
        guessed=parse_receipt(content)
    except (ValueError,Exception) as err:
        # Store the original even if OCR is unavailable: manual processing stays possible.
        content='';source='Nicht ausgelesen';guessed={'supplier':'','invoice_number':'','document_date':'',
          'gross_amount':None,'net_amount':None,'vat_amount':None,'category':'Sonstiges',
          'warnings':['Automatische Erkennung fehlgeschlagen: '+str(err)[:180]]}
    RECEIPT_ROOT.mkdir(parents=True,exist_ok=True)
    stored=uuid4().hex+ext; target=RECEIPT_ROOT/stored
    target.write_bytes(data)
    try:
        row=Receipt(digest=digest,original_name=name,stored_name=stored,source=source,ocr_text=content,
                    warnings=json.dumps(guessed['warnings'],ensure_ascii=False),supplier=guessed['supplier'],
                    invoice_number=guessed['invoice_number'],document_date=guessed['document_date'],
                    gross_amount=_receipt_amount(guessed['gross_amount'],'Bruttobetrag'),
                    net_amount=_receipt_amount(guessed['net_amount'],'Nettobetrag'),
                    vat_amount=_receipt_amount(guessed['vat_amount'],'Umsatzsteuer'),category=guessed['category'] if guessed['category'] in category_names() else 'Sonstiges')
        db.session.add(row);db.session.commit()
        return jsonify(_receipt_json(row,True)),201
    except Exception:
        db.session.rollback();target.unlink(missing_ok=True)
        return jsonify(error='Beleg konnte nicht gespeichert werden.'),500


@app.get('/api/categories')
def categories_list():
    return jsonify(categories=[{'id':c.id,'name':c.name} for c in db.session.scalars(select(Category).order_by(Category.sort_order,Category.name))])


def _category_name(value):
    name=str(value or '').strip()
    if not name or len(name)>120 or any(ord(c)<32 for c in name):
        raise ValueError('Kategorie muss zwischen 1 und 120 Zeichen enthalten.')
    return name


@app.post('/api/categories')
def categories_add():
    try:
        name=_category_name((request.get_json(silent=True) or {}).get('name'))
        if name.casefold() in {x.casefold() for x in category_names()}:
            raise ValueError('Diese Kategorie existiert bereits.')
        record=Category(name=name,sort_order=(db.session.scalar(select(db.func.max(Category.sort_order))) or 0)+1)
        db.session.add(record);db.session.commit()
        return jsonify(id=record.id,name=name),201
    except ValueError as exc:
        db.session.rollback();return jsonify(error=str(exc)),400


@app.patch('/api/categories/<int:cid>')
def categories_rename(cid):
    record=db.session.get(Category,cid)
    if not record:return jsonify(error='Kategorie nicht gefunden.'),404
    try:
        name=_category_name((request.get_json(silent=True) or {}).get('name'))
        if any(x.casefold()==name.casefold() and x!=record.name for x in category_names()):
            raise ValueError('Diese Kategorie existiert bereits.')
        old=record.name
        if old=='Sonstiges':raise ValueError('Die Standardkategorie Sonstiges kann nicht umbenannt werden.')
        if name!=old:
            for model in (Receipt,CostItem,BudgetLine):
                for item in db.session.scalars(select(model).where(model.category==old)):
                    item.category=name
            record.name=name
        db.session.commit()
        return jsonify(id=record.id,name=record.name)
    except ValueError as exc:
        db.session.rollback();return jsonify(error=str(exc)),400


@app.delete('/api/categories/<int:cid>')
def categories_remove(cid):
    record=db.session.get(Category,cid)
    if not record:return jsonify(error='Kategorie nicht gefunden.'),404
    if record.name=='Sonstiges':return jsonify(error='Die Kategorie Sonstiges kann nicht gelöscht werden.'),409
    for model in (Receipt,CostItem,BudgetLine):
        if db.session.scalar(select(model.id).where(model.category==record.name).limit(1)) is not None:
            return jsonify(error='Kategorie wird bereits verwendet. Bitte zuerst umbenennen oder Zuordnungen ändern.'),409
    db.session.delete(record);db.session.commit()
    return jsonify(ok=True)

@app.get('/api/receipts')
def receipt_list():
    rows=db.session.scalars(select(Receipt).order_by(Receipt.id.desc())).all()
    return jsonify(receipts=[_receipt_json(r) for r in rows],categories=category_names(),
                   booked_gross=round(sum(float(r.gross_amount or 0) for r in rows if r.status=='Gebucht'),2),
                   paid=round(sum(float(r.paid_amount or 0) for r in rows if r.status=='Gebucht'),2),
                   drafts=sum(r.status=='Entwurf' for r in rows))

@app.get('/api/receipts/<int:rid>')
def receipt_get(rid):
    r=db.session.get(Receipt,rid)
    if not r:return jsonify(error='Beleg nicht gefunden.'),404
    return jsonify(_receipt_json(r,True))

@app.get('/api/receipts/<int:rid>/download')
def receipt_download(rid):
    r=db.session.get(Receipt,rid)
    if not r:return jsonify(error='Beleg nicht gefunden.'),404
    path=RECEIPT_ROOT/r.stored_name
    if not path.is_file():return jsonify(error='Originaldatei fehlt.'),404
    return send_file(path,as_attachment=True,download_name=r.original_name)

@app.patch('/api/receipts/<int:rid>')
def receipt_edit(rid):
    r=db.session.get(Receipt,rid)
    if not r:return jsonify(error='Beleg nicht gefunden.'),404
    data=request.get_json(silent=True) or {}
    if r.status=='Gebucht' and any(k in data for k in ('gross_amount','budget_line_id','cost_item_id','category','supplier','invoice_number','document_date','kind')):
        return jsonify(error='Zum Ändern der Zuordnung oder Belegsumme zunächst Buchung zurücknehmen.'),409
    try:
        for f in ('supplier','invoice_number','document_date','due_date','category','kind','notes'):
            if f in data:
                value=str(data[f] or '')
                if len(value)>({'supplier':200,'invoice_number':100,'document_date':10,'due_date':10,'category':120,'kind':30,'notes':3000}[f]):raise ValueError('Text zu lang: '+f)
                if f=='category' and value not in category_names():raise ValueError('Unbekannte Kategorie.')
                if f=='kind' and value not in ('Rechnung','Kassenzettel','Gutschrift'):raise ValueError('Ungültige Belegart.')
                if f in ('document_date','due_date') and value:date.fromisoformat(value)
                setattr(r,f,value)
        for f in ('gross_amount','net_amount','vat_amount','paid_amount'):
            if f in data:
                amount=_receipt_amount(data[f],f,optional=f!='paid_amount')
                if f=='paid_amount':
                    allocations=db.session.scalar(select(db.func.count(ReceiptFinancingPayment.id)).where(ReceiptFinancingPayment.receipt_id==r.id)) or 0
                    if allocations and amount != r.paid_amount:raise ValueError('Diese Zahlung ist über die Finanzierungsverwaltung aufgeteilt. Dort bearbeiten.')
                setattr(r,f,amount)
        for field,model in (('budget_line_id',BudgetLine),('cost_item_id',CostItem)):
            if field in data:
                value=data[field];key=int(value) if value not in ('',None) else None
                if key and not db.session.get(model,key):raise ValueError('Zuordnung nicht vorhanden.')
                setattr(r,field,key)
        if r.status=='Gebucht':_validate_receipt_booking(r)
        db.session.commit();return jsonify(_receipt_json(r))
    except (ValueError,TypeError) as err:
        db.session.rollback();return jsonify(error=str(err)),400

def _validate_receipt_booking(r):
    from decimal import Decimal
    if r.gross_amount is None or r.gross_amount<=0:raise ValueError('Bitte zuerst einen gültigen Bruttobetrag prüfen.')
    if not r.supplier.strip():raise ValueError('Lieferant fehlt.')
    if not r.document_date:raise ValueError('Belegdatum fehlt.')
    if r.kind=='Gutschrift':raise ValueError('Gutschriften müssen separat als Korrektur erfasst werden; derzeit keine automatische Buchung.')
    if r.paid_amount<0 or r.paid_amount>r.gross_amount:raise ValueError('Gezahlter Betrag darf die Belegsumme nicht überschreiten.')
    if r.cost_item_id:
        item=db.session.get(CostItem,r.cost_item_id)
        if not item or item.state in ('Alternative','Abgelehnt'):raise ValueError('Ungültiger oder abgelehnter Auftrag.')
        if float(item.paid or 0)>0:raise ValueError('Für diese Kostenposition wurden Zahlungen bereits manuell erfasst. Bitte diese vor der Belegbuchung bereinigen, um Doppelzählung zu vermeiden.')
        if item.budget_line_id and r.budget_line_id and r.budget_line_id!=item.budget_line_id:raise ValueError('Budgetposition und verknüpfter Auftrag widersprechen sich.')
        if item.budget_line_id and not r.budget_line_id:r.budget_line_id=item.budget_line_id
    if r.budget_line_id:
        line=db.session.get(BudgetLine,r.budget_line_id)
        if not line or not line.active or line.is_group:raise ValueError('Bitte eine aktive, einzelne Budgetposition wählen.')
    # Unknown purchases may be booked as explicit extra costs; never auto-link to a category budget.

@app.post('/api/receipts/<int:rid>/book')
def receipt_book(rid):
    r=db.session.get(Receipt,rid)
    if not r:return jsonify(error='Beleg nicht gefunden.'),404
    if r.status=='Gebucht':return jsonify(_receipt_json(r))
    try:
        _validate_receipt_booking(r)
        # Warn on duplicate reference but rely on identical-file hash as a hard duplicate.
        if r.invoice_number:
            other=db.session.scalar(select(Receipt.id).where(Receipt.id!=r.id,Receipt.status=='Gebucht',
                Receipt.invoice_number==r.invoice_number,Receipt.supplier==r.supplier).limit(1))
            if other:raise ValueError('Mögliche Doppelbuchung: Lieferant und Rechnungsnummer bereits gebucht (#'+str(other)+').')
        r.status='Gebucht';db.session.commit();return jsonify(_receipt_json(r))
    except ValueError as err:
        db.session.rollback();return jsonify(error=str(err)),409

@app.post('/api/receipts/<int:rid>/unbook')
def receipt_unbook(rid):
    r=db.session.get(Receipt,rid)
    if not r:return jsonify(error='Beleg nicht gefunden.'),404
    if db.session.scalar(select(ReceiptFinancingPayment.id).where(ReceiptFinancingPayment.receipt_id==rid).limit(1)) is not None:
        return jsonify(error='Zuerst die zugeordneten Zahlungen unter Finanzierung entfernen.'),409
    r.status='Entwurf';db.session.commit();return jsonify(_receipt_json(r))

@app.delete('/api/receipts/<int:rid>')
def receipt_delete(rid):
    r=db.session.get(Receipt,rid)
    if not r:return jsonify(error='Beleg nicht gefunden.'),404
    if r.status=='Gebucht':return jsonify(error='Gebuchten Beleg erst zurücknehmen.'),409
    if db.session.scalar(select(ReceiptFinancingPayment.id).where(ReceiptFinancingPayment.receipt_id==rid).limit(1)) is not None:
        return jsonify(error='Zuerst Finanzierungszahlungen entfernen.'),409
    path=RECEIPT_ROOT/r.stored_name
    db.session.delete(r);db.session.commit();path.unlink(missing_ok=True)
    return jsonify(ok=True)


@app.get('/belege')
def receipts_page():
    return render_template('belege.html')

@app.get('/kosten')
def costs_page():return render_template('kosten.html')

@app.get('/api/costs')
def get_costs():
    items=db.session.scalars(select(CostItem).order_by(CostItem.category,CostItem.id)).all()
    contacts=db.session.scalars(select(Contractor).order_by(Contractor.name)).all()
    return jsonify({'items':[as_dict(x,COST_FIELDS)|{'offer_id':x.offer_id} for x in items],
                    'contractors':[as_dict(x,CONTACT_FIELDS) for x in contacts],
                    'tasks':[{'id':x.id,'code':x.code,'name':x.name} for x in all_tasks()],
                    'summary':budget_summary(items),
                    'budget_lines':[budget_dict(x) for x in all_budget_lines()],
                    'funding':[funding_dict(x) for x in db.session.scalars(select(Funding).order_by(Funding.id))],
                    'historical':[{'row':x.sheet_row,'name':x.name,'architect_estimate':x.architect_estimate,'own_estimate':x.own_estimate,'supplier_note':x.supplier_note} for x in db.session.scalars(select(HistoricalEstimate).order_by(HistoricalEstimate.sheet_row))],
                    'historical_funding':json.loads(setting('historical_funding','{}')), 'documents':[document_dict(x) for x in db.session.scalars(select(Document).order_by(Document.id.desc()))],
                    'offers':[offer_dict(x) for x in db.session.scalars(select(Offer).order_by(Offer.id.desc()))]})

@app.route('/api/costs/<int:item_id>',methods=['PUT','DELETE'])
@app.post('/api/costs')
def cost_edit(item_id=None):
    obj=db.session.get(CostItem,item_id) if item_id else CostItem(title='')
    if item_id and not obj:return jsonify(error='Position nicht gefunden.'),404
    if item_id and obj.offer_id:return jsonify(error='Diese Position stammt aus dem Angebotsimport. Bitte den Angebotsabschnitt bearbeiten.'),409
    try:
        if request.method=='DELETE':
            if db.session.scalar(select(Receipt.id).where(Receipt.cost_item_id==item_id,Receipt.status=='Gebucht').limit(1)):
                return jsonify(error='Gebuchte Belege zugeordnet. Bitte die Buchung zuerst zurücknehmen.'),409
            if db.session.scalar(select(Document.id).where(Document.cost_item_id==item_id).limit(1)):
                return jsonify(error='Dokumente zugeordnet. Bitte diese erst löschen oder umhängen.'),409
            db.session.delete(obj)
        else:
            body=request.get_json(force=True)
            if item_id and 'paid' in body and float(body['paid'] or 0)>0 and db.session.scalar(select(Receipt.id).where(Receipt.cost_item_id==obj.id,Receipt.status=='Gebucht').limit(1)):
                raise ValueError('Zu dieser Kostenposition wurden Belege gebucht. Zahlungen bitte im Belegjournal erfassen.')
            update_record(obj,body,COST_FIELDS)
            db.session.add(obj)
        db.session.commit();return jsonify(ok=True)
    except (ValueError,TypeError) as exc:
        db.session.rollback();return jsonify(error=str(exc)),400
    except Exception:
        db.session.rollback();return jsonify(error='Ungültige Daten oder Referenzen.'),400

@app.route('/api/contractors/<int:item_id>',methods=['PUT','DELETE'])
@app.post('/api/contractors')
def contractor_edit(item_id=None):
    obj=db.session.get(Contractor,item_id) if item_id else Contractor(name='')
    if item_id and not obj:return jsonify(error='Firma nicht gefunden.'),404
    try:
        if request.method=='DELETE':
            if db.session.scalar(select(CostItem.id).where(CostItem.contractor_id==item_id).limit(1)) or db.session.scalar(select(Document.id).where(Document.contractor_id==item_id).limit(1)) or db.session.scalar(select(Task.id).where(Task.contractor_id==item_id).limit(1)):
                return jsonify(error='Firma ist mit Kostenpositionen verknüpft.'),409
            db.session.delete(obj)
        else:
            update_record(obj,request.get_json(force=True),CONTACT_FIELDS)
            db.session.add(obj)
        db.session.commit();return jsonify(ok=True)
    except (ValueError,TypeError) as exc:
        db.session.rollback();return jsonify(error=str(exc)),400

@app.get('/api/costs.csv')
def costs_csv():
    buf=io.StringIO();writer=csv.DictWriter(buf,fieldnames=['category','title','kind','state','estimate','offer','committed','paid','own_hours','own_hourly','source_ref','notes','budget_line_id','selected'],delimiter=';')
    writer.writeheader()
    for item in db.session.scalars(select(CostItem).order_by(CostItem.id)):writer.writerow({k:getattr(item,k) for k in writer.fieldnames})
    return Response('\ufeff'+buf.getvalue(),mimetype='text/csv; charset=utf-8',headers={'Content-Disposition':'attachment; filename=Sanierung_Kosten.csv'})

@app.patch('/api/budget/config')
def budget_config():
    body=request.get_json(force=True)
    try:
        amount=float(body.get('budget',0))
        if not math.isfinite(amount) or amount<0 or amount>100000000:raise ValueError('Ungültiges Gesamtbudget.')
        key=db.session.get(Setting,'initial_budget')
        if key:key.value=str(amount)
        else:db.session.add(Setting(key='initial_budget',value=str(amount)))
        db.session.commit()
        return jsonify(ok=True)
    except (ValueError,TypeError) as e:return jsonify(error=str(e)),400

@app.route('/api/budget/lines/<int:line_id>', methods=['PUT','DELETE'])
@app.post('/api/budget/lines')
def budget_line_edit(line_id=None):
    obj=db.session.get(BudgetLine,line_id) if line_id else BudgetLine(code='')
    if line_id and not obj:return jsonify(error='Kostenplanposition nicht gefunden.'),404
    try:
        if request.method=='DELETE':
            if db.session.scalar(select(CostItem.id).where(CostItem.budget_line_id==line_id).limit(1)) or db.session.scalar(select(Document.id).where(Document.budget_line_id==line_id).limit(1)):
                raise ValueError('Es sind Angebote/Beauftragungen verknüpft; zuerst diese Zuordnung entfernen.')
            if db.session.scalar(select(Receipt.id).where(Receipt.budget_line_id==line_id,Receipt.status=='Gebucht').limit(1)):
                raise ValueError('Gebuchte Belege verknüpft. Zuerst deren Buchung zurücknehmen.')
            if db.session.scalar(select(BudgetLine.id).where(BudgetLine.parent_code==obj.code).limit(1)):
                raise ValueError('Gruppenposition kann erst gelöscht werden, wenn die Unterpositionen entfernt wurden.')
            db.session.delete(obj)
        else:
            b=request.get_json(force=True)
            for key in ('title','category','parent_code','marker','company_hint','kind','notes'):
                if key in b:setattr(obj,key,str(b[key] or '').strip())
            if 'estimate' in b:obj.estimate=float(b['estimate'] or 0)
            if 'active' in b:obj.active=b['active'] is True or str(b['active']).lower() in ('1','true','on')
            if 'is_group' in b:obj.is_group=b['is_group'] is True
            if 'sort_order' in b:obj.sort_order=int(b['sort_order'])
            if not line_id:
                obj.code='KNEW'+str((db.session.scalar(select(db.func.max(BudgetLine.id))) or 0)+1)
                obj.sort_order=1000+int(obj.code[4:]);obj.source_row=None
            if not obj.title or not obj.category:raise ValueError('Titel und Kategorie fehlen.')
            if not math.isfinite(obj.estimate) or obj.estimate<0:raise ValueError('Kosten dürfen nicht negativ sein.')
            if obj.kind not in ('Eigenleistung','Fremdleistung'):raise ValueError('Ungültige Leistungsart.')
            if obj.parent_code and obj.parent_code==obj.code:raise ValueError('Eigenverknüpfung nicht erlaubt.')
            db.session.add(obj)
        db.session.commit();return jsonify(ok=True)
    except (ValueError,TypeError) as e:
        db.session.rollback();return jsonify(error=str(e)),400

@app.put('/api/funding/<int:funding_id>')
def funding_edit(funding_id):
    obj=db.session.get(Funding,funding_id)
    if not obj:return jsonify(error='Förderung nicht gefunden.'),404
    try:
        b=request.get_json(force=True)
        for key in ('expected','confirmed','received'):
            if key in b:
                value=float(b[key] or 0)
                if not math.isfinite(value) or value<0:raise ValueError('Betrag darf nicht negativ sein.')
                setattr(obj,key,value)
        if 'notes' in b:obj.notes=str(b['notes'] or '')
        if 'name' in b:obj.name=str(b['name'] or '')
        db.session.commit();return jsonify(ok=True)
    except (ValueError,TypeError) as e:
        db.session.rollback();return jsonify(error=str(e)),400

@app.post('/api/funding')
def funding_create():
    b=request.get_json(force=True)
    if not str(b.get('name','')).strip():return jsonify(error='Name fehlt.'),400
    obj=Funding(name=b['name'])
    db.session.add(obj);db.session.commit();return jsonify(ok=True,id=obj.id)

@app.get('/api/budget.csv')
def budget_csv():
    data=budget_summary(db.session.scalars(select(CostItem)).all())
    buf=io.StringIO();w=csv.writer(buf,delimiter=';')
    w.writerow(['Excel-Zeile','Gruppe','Bezeichnung','Excel-Marker (unbestätigt)','Schätzung (€)','Aktuelle Prognose (€)','Prognosebasis','Eigenleistung','Firma (Hinweis)','Notiz'])
    for row in all_budget_lines():
        w.writerow([row.source_row or '',row.category,row.title,row.marker,row.estimate,data['line_forecasts'].get(row.id,0),data['line_basis'].get(row.id,'Gruppenzeile'),row.kind=='Eigenleistung',row.company_hint,row.notes])
    return Response('\ufeff'+buf.getvalue(),mimetype='text/csv; charset=utf-8',headers={'Content-Disposition':'attachment; filename=Sanierungsprojekt_Budget.csv'})

def document_dict(x):
    return {'id':x.id,'name':x.original_name,'kind':x.kind,'contractor_id':x.contractor_id,'budget_line_id':x.budget_line_id,'cost_item_id':x.cost_item_id,'notes':x.notes,'uploaded_at':x.uploaded_at.isoformat() if x.uploaded_at else ''}

@app.post('/api/documents')
def upload_document():
    f = request.files.get('file')
    if not f or not f.filename:
        return jsonify(error='Bitte eine Datei auswählen.'),400
    original=Path(f.filename).name[:240]
    ext=Path(original).suffix.lower()
    if ext not in DOCUMENT_EXTENSIONS:
        return jsonify(error='Dateityp nicht erlaubt (PDF, DOCX, XLSX, Bild oder TXT).'),400
    kind=(request.form.get('kind','Angebot') or 'Angebot')[:40]
    def linked_id(field, model):
        raw=request.form.get(field)
        if not raw:return None
        try:ident=int(raw)
        except ValueError:raise ValueError('Ungültiger Verweis: '+field)
        if db.session.get(model,ident) is None:raise ValueError('Zuordnung nicht gefunden: '+field)
        return ident
    try:
        contractor=linked_id('contractor_id',Contractor)
        budget=linked_id('budget_line_id',BudgetLine)
        cost=linked_id('cost_item_id',CostItem)
    except ValueError as e:return jsonify(error=str(e)),400
    DOCUMENT_ROOT.mkdir(parents=True,exist_ok=True)
    stored=uuid4().hex+ext
    f.save(DOCUMENT_ROOT/stored)
    try:
        row=Document(original_name=original,stored_name=stored,kind=kind,contractor_id=contractor,budget_line_id=budget,cost_item_id=cost,notes=(request.form.get('notes','') or '')[:2000])
        db.session.add(row);db.session.commit()
        return jsonify(ok=True,id=row.id),201
    except Exception:
        db.session.rollback();(DOCUMENT_ROOT/stored).unlink(missing_ok=True)
        return jsonify(error='Datei konnte nicht gespeichert werden.'),400

@app.get('/api/documents/<int:doc_id>/download')
def download_document(doc_id):
    row=db.session.get(Document,doc_id)
    if not row:return jsonify(error='Dokument nicht gefunden.'),404
    p=DOCUMENT_ROOT/row.stored_name
    if not p.is_file():return jsonify(error='Datei fehlt auf diesem Rechner.'),404
    return send_file(p,as_attachment=True,download_name=row.original_name)

@app.delete('/api/documents/<int:doc_id>')
def delete_document(doc_id):
    row=db.session.get(Document,doc_id)
    if not row:return jsonify(error='Dokument nicht gefunden.'),404
    if db.session.scalar(select(Offer.id).where(Offer.document_id==doc_id).limit(1)):
        return jsonify(error='PDF gehört zu einem importierten Angebot. Zuerst Angebot löschen.'),409
    p=DOCUMENT_ROOT/row.stored_name
    db.session.delete(row);db.session.commit();p.unlink(missing_ok=True)
    return jsonify(ok=True)

@app.get('/api/project-archive.zip')
def project_archive():
    """Lokales Archiv inklusive Uploads; unter SQLite auch konsistente DB-Kopie."""
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('HINWEISE.txt',
            'Persönliche Sanierungsunterlagen: nur privat aufbewahren.\n'
            'Unter SQLite enthält das Archiv sanierung.db, die im ausgeschalteten\n'
            'Projektplaner an ihren bisherigen Speicherort zurückkopiert werden kann.\n'
            'Bei PostgreSQL enthält dieses Archiv keine vollständige Datenbanksicherung.\n'
            'Dafür separat pg_dump nutzen.\n')
        if db.engine.url.get_backend_name() == 'sqlite':
            db.session.flush()
            with tempfile.TemporaryDirectory() as temp:
                dest=Path(temp)/'sanierung.db'
                with sqlite3.connect(str(db.engine.url.database)) as source, sqlite3.connect(dest) as target:
                    source.backup(target)
                archive.write(dest,arcname='sanierung.db')
        else:
            archive.writestr('POSTGRESQL_BACKUP_NOETIG.txt','Bei PostgreSQL bitte zusätzlich pg_dump zur vollständigen Sicherung ausführen.\n')
        if DOCUMENT_ROOT.exists():
            for document in DOCUMENT_ROOT.iterdir():
                if document.is_file():archive.write(document,arcname='private/documents/'+document.name)
        original=ROOT/'private'/'Geplante Kosten.xlsx'
        if original.is_file():archive.write(original,arcname='private/Geplante Kosten.xlsx')
        initial=ROOT/'data'/'initial_budget.json'
        if initial.is_file():archive.write(initial,arcname='data/initial_budget.json')
        archive.writestr('export.json',json.dumps({
            'tasks':serialize(all_tasks()),
            'costs':[as_dict(x,COST_FIELDS) for x in db.session.scalars(select(CostItem))],
            'budget_lines':[budget_dict(x) for x in all_budget_lines()],
            'funding':[funding_dict(x) for x in db.session.scalars(select(Funding))],
            'contractors':[as_dict(x,CONTACT_FIELDS) for x in db.session.scalars(select(Contractor))],
            'documents':[document_dict(x) for x in db.session.scalars(select(Document))],
            'offers':[offer_dict(x) for x in db.session.scalars(select(Offer))]
        },ensure_ascii=False,indent=2))
    stream.seek(0)
    return send_file(stream,mimetype='application/zip',as_attachment=True,
                     download_name='Sanierungsprojekt_Projektarchiv.zip')

@app.get('/api/excel-original')
def excel_original():
    p=ROOT/'private'/'Geplante Kosten.xlsx'
    if not p.exists():return jsonify(error='Originaldatei liegt auf dieser Installation nicht vor.'),404
    return send_file(p,as_attachment=True,download_name='Geplante Kosten.xlsx')

@app.errorhandler(500)
def server_error(err):
    db.session.rollback()
    return jsonify(error='Interner Fehler: Bitte Serverkonsole prüfen.'),500


# Shared application code: finance models and routes live in a separate module.
from financing import register_financing
(Loan, EquityAccount, FinancingEvent, ReceiptFinancingPayment) = register_financing(
    app, db, Receipt, CostItem, BudgetLine, budget_summary)

@app.get('/api/backup/status')
def backup_status():
    import backup_manager
    if not DATABASE_URL.startswith('sqlite:'):
        return jsonify(configured=False, error='Manuelle ZIP-Backups sind für die lokale SQLite-Version vorgesehen.')
    try:
        config=backup_manager.load_config()
        files=sorted(config['folder'].glob(backup_manager.PREFIX+'*.zip'),reverse=True)
        return jsonify(configured=True,folder=str(config['folder']),keep=config['keep'],
                       latest=files[0].name if files else None, count=len(files))
    except (ValueError, OSError) as e:
        return jsonify(configured=False,error=str(e))

@app.post('/api/backup/create')
def create_manual_backup():
    import backup_manager
    if not DATABASE_URL.startswith('sqlite:'):
        return jsonify(error='Für PostgreSQL bitte den separaten PostgreSQL-Backupweg verwenden.'),409
    try:
        destination=backup_manager.make_backup()
        return jsonify(ok=True, filename=destination.name, verified=True,
                       bytes=destination.stat().st_size),201
    except (ValueError, OSError, sqlite3.DatabaseError, zipfile.BadZipFile) as e:
        return jsonify(error='Backup nicht erstellt: '+str(e)),409

if __name__=='__main__':
    if DATABASE_URL.startswith('sqlite:'):
        from schema_manager import upgrade_database
        upgrade_database()
    with app.app_context():initialize()
    app.run(host=os.environ.get('HOST','127.0.0.1'),port=int(os.environ.get('PORT','5000')),debug=False)
