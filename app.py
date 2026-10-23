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
import shutil
import ipaddress
import zipfile
from datetime import date, datetime
from financials import effective_offer, forecast_lines, monetary_totals
from offer_parser import parse_pdf, pdf_to_pages, parse_offer
from receipt_parser import parse_receipt, category_for
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
    estimate=db.Column(db.Float,nullable=False,default=0)
    company_hint=db.Column(db.String(200),default='')
    kind=db.Column(db.String(40),nullable=False,default='Fremdleistung')
    notes=db.Column(db.Text,default='')
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
    # A final invoice may state the full contract amount including prior invoices.
    # Only the incremental portion is counted in costs and the payment ledger.
    billing_type=db.Column(db.String(24),nullable=False,default='Normal',server_default='Normal')
    advance_deduction=db.Column(db.Numeric(12,2),nullable=False,default=0,server_default='0')
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
    status=db.Column(db.String(30),nullable=False,default='Entwurf')
    category=db.Column(db.String(120),nullable=False,default='Sonstiges')
    budget_line_id=db.Column(db.Integer,db.ForeignKey('budget_line.id'))
    notes=db.Column(db.Text,nullable=False,default='')
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
    first_setup = db.session.get(Setting, 'project_initialized') is None
    if first_setup and not db.session.scalar(select(Task.id).limit(1)):
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
    if first_setup:
        db.session.add(Setting(key='project_initialized', value='1'))
    db.session.commit()

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
    return {key:getattr(x,key) for key in ('id','code','category','title','parent_code','estimate','company_hint','kind','notes','sort_order','is_group','active')}

def funding_dict(x):
    return {key:getattr(x,key) for key in ('id','name','expected','confirmed','received','notes')}

def _receipt_increment(r):
    """Amount newly invoiced; a final invoice may repeat earlier installments.

    Never change the document's original gross amount; only adjust the amount
    counted toward contractor commitments, budget and remaining payables.
    """
    from decimal import Decimal
    return Decimal(r.gross_amount or 0) - Decimal(r.advance_deduction or 0)


def _accepted_receipt_offer(r):
    if not r.cost_item_id:
        return None
    cost=db.session.get(CostItem,r.cost_item_id)
    if not cost or not cost.offer_id:
        return None
    offer=db.session.get(Offer,cost.offer_id)
    return offer if offer and offer.status in ('Angenommen','Beauftragt') else None


def offer_billing_dict(offer):
    """Sum *booked* net new billables, never invoice OCR drafts or cash payments.

    Return per-invoice details for a single accepted order; other offer states
    cannot expose linked booked invoices. Money is rounded only for JSON.
    """
    from decimal import Decimal
    if offer.status not in ('Angenommen','Beauftragt'):
        return None
    items=db.session.scalars(select(CostItem).where(CostItem.offer_id==offer.id)).all()
    ids=[item.id for item in items]
    receipts=(db.session.scalars(select(Receipt).where(
        Receipt.status=='Gebucht',Receipt.cost_item_id.in_(ids)).order_by(Receipt.id)).all()
        if ids else [])
    billed=sum((_receipt_increment(r) for r in receipts),Decimal('0'))
    paid=sum((Decimal(r.paid_amount or 0) for r in receipts),Decimal('0'))
    agreed=Decimal(str(offer.gross or 0))
    remaining=agreed-billed
    ratio=float(billed/agreed*100) if agreed>0 else 0
    stage='overrun' if billed>agreed else 'fully_billed' if billed==agreed else 'warning' if ratio>=80 else 'normal'
    return {'agreed':float(agreed),'billed':float(billed),'paid':float(paid),
            'remaining':float(remaining),'percent':round(ratio,2),'stage':stage,
            'invoices':[{'id':r.id,'number':r.invoice_number,'date':r.document_date,
                'supplier':r.supplier,'billing_type':r.billing_type,
                'gross':float(r.gross_amount or 0),'advance_deduction':float(r.advance_deduction or 0),
                'counted':float(_receipt_increment(r)), 'paid':float(r.paid_amount or 0)}
                for r in receipts]}


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
        actual=sum(float(_receipt_increment(x)) for x in receipts)
        if actual>previews[line_id]:
            previews[line_id]=round(actual,2)
            basis[line_id]='Belege über Planansatz'
    linked={}
    for x in valid:
        if x.budget_line_id:linked.setdefault(x.budget_line_id,[]).append(x)
    # For unlinked accepted orders the budget has no plan-line ceiling.
    # Once cumulative invoice increments exceed the contracted value, expose the
    # real overrun in the forecast instead of silently retaining offer.gross.
    booked_by_item={}
    for receipt in booked:
        if receipt.cost_item_id is not None:
            booked_by_item[receipt.cost_item_id]=booked_by_item.get(receipt.cost_item_id,0)+float(_receipt_increment(receipt))
    outside=sum(max(effective_offer(x),booked_by_item.get(x.id,0)) for x in extras)
    extra_receipts=sum(float(_receipt_increment(x)) for x in unplanned_receipts)
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
        group['planned']+=max(effective_offer(x),booked_by_item.get(x.id,0));group['paid']+=x.paid
    for r in booked:
        category=next((line.category for line in active if line.id==r.budget_line_id),r.category)
        group=grouped.setdefault(category,{'category':category,'estimate':0,'planned':0,'paid':0})
        group['paid']+=float(r.paid_amount or 0)
    for r in unplanned_receipts:
        group=grouped.setdefault(r.category,{'category':r.category,'estimate':0,'planned':0,'paid':0})
        group['planned']+=float(_receipt_increment(r))
    return {'budget':round(budget,2),'planned':round(forecast,2),'overrun':round(forecast-budget,2),'paid':round(spent,2),
            'remaining':round(forecast-spent,2),'committed':round(committed,2),
            'funding_confirmed':round(funding_confirmed,2),'funding_expected':round(funding_expected,2),
            'net_after_confirmed':round(forecast-funding_confirmed,2),
            'own_budget':round(sum(previews[x.id] for x in active if x.kind=='Eigenleistung') + sum(effective_offer(x) for x in extras if x.kind=='Eigenleistung'),2),
            'own_hours':round(sum(x.own_hours for x in valid if x.kind=='Eigenleistung'),1),
            'own_imputed_value':round(sum(x.own_hours*x.own_hourly for x in valid if x.kind=='Eigenleistung'),2),
            'receipt_booked':round(sum(float(_receipt_increment(x)) for x in booked),2),
            'receipt_paid':round(sum(float(x.paid_amount or 0) for x in booked),2),
            'receipt_drafts':db.session.scalar(select(db.func.count(Receipt.id)).where(Receipt.status=='Entwurf')) or 0,
            'categories':[{'category':k,'estimate':round(v['estimate'],2),'planned':round(v['planned'],2),'paid':round(v['paid'],2)} for k,v in grouped.items()],
            'line_forecasts':previews,'line_basis':basis,'additional_items':len(extras)}


def _get_or_add_contractor(name, family):
    existing=db.session.scalar(select(Contractor).where(db.func.lower(Contractor.name)==name.lower()).limit(1))
    if existing:return existing
    obj=Contractor(name=name,trade={'WP':'Wärmepumpe / Heizung','PV':'Photovoltaik','P3':'Elektro'}.get(family,'Sonstiges'),notes='Aus PDF-Angebot eingelesen; keine Beauftragung bestätigt.')
    db.session.add(obj);db.session.flush();return obj


def add_parsed_offer(parsed, digest, source_document=None, category='Sonstiges'):
    """Persist a non-binding analysis draft. Its PDF is stored in private/documents."""
    if db.session.scalar(select(Offer.id).where(Offer.digest==digest)):
        raise ValueError('Dieses PDF-Angebot wurde bereits hochgeladen.')
    contractor=_get_or_add_contractor(parsed['vendor'],parsed['family']) if parsed['vendor']!='Firma nicht erkannt' else None
    offer=Offer(digest=digest,document_id=source_document.id if source_document else None,
                contractor_id=contractor.id if contractor else None, vendor=parsed['vendor'],
                number=parsed['number'],issued=parsed['issued'],expires=parsed['expires'],
                net=parsed['net'],vat=parsed['vat'],gross=parsed['gross'],tax_rate=parsed['tax_rate'],
                category=category,status='Entwurf',reconciled=parsed['reconciled'],
                warnings=json.dumps(parsed['warnings'],ensure_ascii=False),filename=parsed['filename'])
    db.session.add(offer);db.session.flush()
    for idx,section in enumerate(parsed['groups']):
        db.session.add(OfferSection(offer_id=offer.id,name=section['name'],net=section['net'],
                                   gross=section['gross'],sort_order=idx,selected=False))
    for entry in parsed['positions']:
        db.session.add(OfferPosition(offer_id=offer.id,**{k:entry.get(k) for k in
                      ('number','section','description','quantity','unit','unit_price',
                       'net_amount','optional_amount','optional','page')}))
    return offer


def _offer_has_dependencies(item):
    # An unsaved new CostItem has no ID. Querying cost_item_id IS NULL would
    # accidentally match every unassigned PDF/document in the project.
    if item.id is None:
        return bool(item.paid)
    return bool(item.paid or db.session.scalar(select(Document.id).where(Document.cost_item_id==item.id).limit(1))
        or db.session.scalar(select(Receipt.id).where(Receipt.cost_item_id==item.id).limit(1)))


def _sync_offer_costs(offer):
    """A listed quotation has zero forecast impact; acceptance books exactly one total.

    Previously accepted multi-section legacy orders are retained if they have
    payments/documents, never merged destructively.
    """
    existing=db.session.scalars(select(CostItem).where(CostItem.offer_id==offer.id).order_by(CostItem.id)).all()
    if offer.status not in ('Angenommen','Beauftragt'):
        for item in existing:
            if _offer_has_dependencies(item):
                raise ValueError('Das Angebot hat bereits Zahlungen oder verknüpfte Belege. Bitte zuerst prüfen.')
            db.session.delete(item)
        return
    if offer.gross is None or not math.isfinite(offer.gross) or offer.gross<=0:
        raise ValueError('Vor Annahme muss eine positive Bruttogesamtsumme bestätigt sein.')
    line=None
    if offer.budget_line_id is not None:
        line=db.session.get(BudgetLine,offer.budget_line_id)
        if not line or not line.active or line.is_group:
            raise ValueError('Bitte eine aktive Einzelposition im Kostenplan zuordnen.')
        other=db.session.scalar(select(CostItem.id).where(CostItem.budget_line_id==line.id,
              CostItem.selected.is_(True),CostItem.offer_id!=offer.id).limit(1))
        if other:raise ValueError('Diese Kostenplanposition hat bereits ein ausgewähltes Angebot.')
    if len(existing)>1 and any(_offer_has_dependencies(x) for x in existing):
        # Old section-based orders with real payments must not be collapsed.
        # On repeated acceptance preserve their existing accounted positions.
        return
    item=existing[0] if existing else CostItem(offer_id=offer.id,title='')
    for duplicate in existing[1:]:
        if _offer_has_dependencies(duplicate):
            raise ValueError('Eine frühere Leistungsgruppe hat Zahlungen oder Belege.')
        db.session.delete(duplicate)
    if _offer_has_dependencies(item) and (item.budget_line_id!=offer.budget_line_id
             or abs(float(item.offer or 0)-float(offer.gross))>0.001):
        raise ValueError('Betrag oder Zuordnung eines bereits bezahlten Auftrags dürfen nicht still verändert werden.')
    item.offer_id=offer.id;item.budget_line_id=offer.budget_line_id
    item.title=(f'{offer.vendor}: Angebot {offer.number or "ohne Nummer"}')[:300]
    item.category=line.category if line else offer.category
    item.kind='Fremdleistung';item.contractor_id=offer.contractor_id
    item.offer=float(offer.gross);item.committed=float(offer.gross)
    item.state='Beauftragt';item.selected=True;item.source_ref=offer.number
    db.session.add(item)


def offer_dict(o):
    return {'id':o.id,'number':o.number,'vendor':o.vendor,'filename':o.filename,
            'issued':o.issued,'expires':o.expires,'net':o.net,'vat':o.vat,'gross':o.gross,
            'category':o.category,'budget_line_id':o.budget_line_id,'notes':o.notes,
            'tax_rate':o.tax_rate,'status':o.status,'reconciled':o.reconciled,
            'warnings':json.loads(o.warnings or '[]'),'document_id':o.document_id,
            'contractor_id':o.contractor_id,'billing':offer_billing_dict(o),
            'sections':[{'id':g.id,'name':g.name,'net':g.net,'gross':g.gross,'budget_line_id':g.budget_line_id,
                         'selected':g.selected} for g in sorted(o.sections,key=lambda x:x.sort_order)],
            'positions':[{'number':p.number,'section':p.section,'description':p.description,
                          'quantity':p.quantity,'unit':p.unit,'unit_price':p.unit_price,
                          'net_amount':p.net_amount,'optional_amount':p.optional_amount,
                          'optional':p.optional,'page':p.page} for p in o.positions]}


def _analyse_pdf_offer(data, name):
    """Use the detailed parser first, falling back to local OCR and a general total recognizer.

    A parser failure never silently invents a total or prevents manual review.
    """
    empty={'filename':name,'family':'Andere','vendor':'Firma nicht erkannt','number':'',
           'issued':'','expires':'','net':None,'vat':None,'gross':None,'tax_rate':0,
           'positions':[],'groups':[],'reconciled':False,'warnings':[]}
    try:
        text_pages=pdf_to_pages(data)
        parsed=parse_offer(text_pages,name)
        content='\n'.join(text_pages)
    except Exception as exc:
        if 'Verschlüsseltes PDF' in str(exc):raise ValueError(str(exc)) from exc
        parsed=dict(empty)
        parsed['warnings']=['PDF-Texterkennung nicht ausreichend: '+str(exc)]
        try:
            content,mode=extract_text(data,name)
            if content.strip():
                parsed=parse_offer([content],name)
                parsed['warnings'].append('Analyse über '+mode+'. Bitte den Gesamtbetrag besonders prüfen.')
        except Exception as fallback_error:
            parsed['warnings'].append('OCR nicht verfügbar: '+str(fallback_error)+'. Werte bitte manuell eingeben.')
            content=''
    if content.strip():
        generic=parse_receipt(content)
        if parsed['gross'] is None and generic.get('gross_amount'):
            parsed['gross']=float(generic['gross_amount'])
            parsed['warnings'].append('Gesamtsumme aus allgemeiner Betragserkennung vorgeschlagen. Bitte bestätigen.')
        if parsed['net'] is None and generic.get('net_amount'):
            parsed['net']=float(generic['net_amount'])
        if parsed['vat'] is None and generic.get('vat_amount'):
            parsed['vat']=float(generic['vat_amount'])
        if parsed['vendor']=='Firma nicht erkannt' and generic.get('supplier'):
            parsed['vendor']=generic['supplier']
        if not parsed['number'] and generic.get('invoice_number'):
            parsed['number']=generic['invoice_number']
        if not parsed['issued'] and generic.get('document_date'):
            parsed['issued']=generic['document_date']
    return parsed,content


@app.post('/api/offers/manual')
def offers_manual():
    """Create a reviewed, list-ready offer without a PDF; no forecast until acceptance."""
    values = request.get_json(silent=True)
    if not isinstance(values, dict):
        return jsonify(error='Bitte Angebotsdaten eingeben.'), 400
    obj = Offer(
        digest=sha256(('manual:' + uuid4().hex).encode('utf-8')).hexdigest(),
        filename='Manuell erfasst', vendor='', number='', category='Sonstiges',
        status='Angebot', warnings='[]', reconciled=False)
    try:
        _apply_offer_fields(obj, values)
        if not obj.vendor.strip() or obj.vendor == 'Firma nicht erkannt':
            raise ValueError('Bitte einen Anbieter angeben.')
        if obj.gross is None or obj.gross <= 0:
            raise ValueError('Bitte einen positiven Bruttogesamtbetrag eingeben.')
        db.session.add(obj)
        db.session.commit()
        return jsonify(ok=True, id=obj.id, offer=offer_dict(obj)), 201
    except (ValueError, TypeError) as exc:
        db.session.rollback()
        return jsonify(error=str(exc)), 400


@app.get('/api/offers')
def offers_list():
    return jsonify(offers=[offer_dict(x) for x in db.session.scalars(select(Offer).order_by(Offer.id.desc()))],
                   categories=category_names())


@app.post('/api/offers/import')
def offers_import():
    f=request.files.get('file')
    if not f or not f.filename or Path(f.filename).suffix.lower()!='.pdf':
        return jsonify(error='Bitte eine PDF-Datei auswählen.'),400
    data=f.read()
    if len(data)>15*1024*1024:return jsonify(error='Maximal 15 MB je Angebot.'),413
    if not data.startswith(b'%PDF'):
        return jsonify(error='Die Datei ist kein gültiges PDF.'),400
    digest=sha256(data).hexdigest()
    if db.session.scalar(select(Offer.id).where(Offer.digest==digest)):
        return jsonify(error='Dieses PDF wurde bereits hochgeladen.'),409
    name=Path(f.filename).name[:240]
    try:parsed,content=_analyse_pdf_offer(data,name)
    except ValueError as exc:return jsonify(error=str(exc)),422
    suggested=category_for(content) if content else 'Sonstiges'
    if suggested not in category_names():suggested='Sonstiges'
    DOCUMENT_ROOT.mkdir(parents=True,exist_ok=True)
    stored=uuid4().hex+'.pdf'
    (DOCUMENT_ROOT/stored).write_bytes(data)
    try:
        doc=Document(original_name=name,stored_name=stored,kind='Angebot',
                     notes='PDF-Angebot: Analyse als Entwurf gespeichert.')
        db.session.add(doc);db.session.flush()
        obj=add_parsed_offer(parsed,digest,doc,category=suggested)
        doc.contractor_id=obj.contractor_id
        db.session.commit()
        return jsonify(ok=True,id=obj.id,offer=offer_dict(obj)),201
    except Exception as exc:
        db.session.rollback();(DOCUMENT_ROOT/stored).unlink(missing_ok=True)
        return jsonify(error='Angebot konnte nicht gespeichert werden: '+str(exc)),400


def _offer_amount(raw,field):
    from decimal import Decimal,InvalidOperation
    if raw is None or raw=='':return None
    try:
        formatted=str(raw).strip()
        # Accept 1.234,56 as well as 1234,56 and 1234.56; a bare 1.234
        # stays ambiguous and is rejected rather than silently misread.
        if ',' in formatted and '.' in formatted:
            import re
            if not re.fullmatch(r'\d{1,3}(?:\.\d{3})+,\d{1,2}',formatted):
                raise ValueError()
            formatted=formatted.replace('.','').replace(',','.')
        else:
            formatted=formatted.replace(',','.')
        v=Decimal(formatted)
        if not v.is_finite() or v < 0 or v > Decimal('99999999.99') or v.as_tuple().exponent < -2:
            raise ValueError()
        return float(v)
    except (InvalidOperation,ValueError,TypeError):
        raise ValueError('Ungültiger Betrag für '+field+' (maximal zwei Nachkommastellen).')


def _apply_offer_fields(offer, values):
    """Shared validation for PDF corrections and manually entered offers."""
    for key, limit in [('vendor', 200), ('number', 100), ('issued', 20),
                       ('expires', 20), ('notes', 2000)]:
        if key in values:
            value = str(values[key] or '').strip()
            if len(value) > limit:
                raise ValueError(key + ': Text ist zu lang.')
            setattr(offer, key, value)
    for key in ('gross', 'net', 'vat'):
        if key in values:
            setattr(offer, key, _offer_amount(values[key], key))
    if 'category' in values:
        category = str(values['category'] or '').strip()
        if category not in category_names():
            raise ValueError('Bitte eine vorhandene Kategorie auswählen.')
        offer.category = category
    if 'budget_line_id' in values:
        candidate = values['budget_line_id']
        if candidate in ('', None):
            offer.budget_line_id = None
        else:
            try:
                line_id = int(candidate)
            except (ValueError, TypeError):
                raise ValueError('Ungültige Kostenplanposition.')
            line = db.session.get(BudgetLine, line_id)
            if not line or not line.active or line.is_group:
                raise ValueError('Bitte eine aktive Kostenplanposition wählen.')
            offer.budget_line_id = line_id
    if offer.gross and offer.net:
        offer.tax_rate = round((offer.gross / offer.net - 1) * 100, 2)


@app.patch('/api/offers/<int:offer_id>/draft')
def offer_draft_update(offer_id):
    offer = db.session.get(Offer, offer_id)
    if not offer:
        return jsonify(error='Angebot nicht gefunden.'), 404
    if offer.status not in ('Entwurf', 'Angebot', 'Abgelehnt'):
        return jsonify(error='Ein angenommener Auftrag kann nicht mehr bearbeitet werden.'), 409
    values = request.get_json(silent=True) or {}
    if not isinstance(values, dict):
        return jsonify(error='Bitte gültige Angebotsdaten senden.'), 400
    try:
        _apply_offer_fields(offer, values)
        db.session.commit()
        return jsonify(ok=True, offer=offer_dict(offer))
    except (ValueError, TypeError) as exc:
        db.session.rollback()
        return jsonify(error=str(exc)), 400


@app.patch('/api/offers/<int:offer_id>')
def offer_update(offer_id):
    offer=db.session.get(Offer,offer_id)
    if not offer:return jsonify(error='Angebot nicht gefunden.'),404
    target=(request.get_json(silent=True) or {}).get('status')
    if target not in ('Angebot','Angenommen','Abgelehnt'):
        return jsonify(error='Erlaubt sind In Liste übernehmen, Annehmen und Ablehnen.'),400
    if offer.status=='Entwurf' and target!='Angebot':
        return jsonify(error='Entwurf erst prüfen und in die Angebotsliste übernehmen.'),409
    if offer.status in ('Angenommen','Beauftragt') and target=='Angenommen':
        return jsonify(ok=True,offer=offer_dict(offer))
    if target=='Angebot' and (not offer.vendor.strip() or offer.vendor=='Firma nicht erkannt'
          or offer.gross is None or not math.isfinite(offer.gross) or offer.gross<=0):
        return jsonify(error='Vor Übernahme Firma und positive Bruttogesamtsumme prüfen.'),409
    if target=='Angenommen' and (offer.status not in ('Angebot','Angenommen','Beauftragt')
          or offer.gross is None or offer.gross<=0):
        return jsonify(error='Nur ein geprüftes, gelistetes Angebot mit Betrag kann angenommen werden.'),409
    try:
        offer.status=target
        _sync_offer_costs(offer)
        db.session.commit()
        return jsonify(ok=True,offer=offer_dict(offer))
    except ValueError as exc:
        db.session.rollback();return jsonify(error=str(exc)),409


@app.patch('/api/offer-sections/<int:section_id>')
def offer_section_update(section_id):
    return jsonify(error='Leistungsgruppen werden nur angezeigt. Kosten werden ausschließlich über die Angebotsannahme übertragen.'),409


@app.patch('/api/offer-costs/<int:item_id>')
def offer_cost_payment(item_id):
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
    offer=db.session.get(Offer,offer_id)
    if not offer:return jsonify(error='Angebot nicht gefunden.'),404
    linked=db.session.scalars(select(CostItem).where(CostItem.offer_id==offer_id)).all()
    if any(x.committed or _offer_has_dependencies(x) for x in linked):
        return jsonify(error='Angenommene Angebote mit Aufträgen oder Zahlungen dürfen nicht gelöscht werden.'),409
    doc=db.session.get(Document,offer.document_id) if offer.document_id else None
    try:
        for item in linked:db.session.delete(item)
        db.session.delete(offer)
        # Uploaded PDF stays as a private document for traceability.
        db.session.commit();return jsonify(ok=True,document_id=doc.id if doc else None)
    except Exception:
        db.session.rollback();return jsonify(error='Angebot konnte nicht entfernt werden.'),409

# Receipts are a separate, reviewed ledger; OCR guesses never change financial totals.
RECEIPT_ROOT=ROOT/'private'/'receipts'
RECEIPT_EXTENSIONS={'.pdf','.jpg','.jpeg','.png','.webp'}

def _validate_accepted_invoice_link(r):
    """Reject *any* receipt linkage to an unaccepted offer, even via API calls.

    Standalone cost positions remain available independently of offers.
    """
    if not r.cost_item_id:
        return None
    item=db.session.get(CostItem,r.cost_item_id)
    if not item:
        raise ValueError('Kostenposition nicht vorhanden.')
    if item.offer_id:
        offer=db.session.get(Offer,item.offer_id)
        if not offer or offer.status not in ('Angenommen','Beauftragt') or not item.selected:
            raise ValueError('Rechnungen dürfen nur tatsächlich angenommenen Angeboten zugeordnet werden.')
        return offer
    return None


def _validate_invoice_advance(r, offer):
    """Make advance offsets safe against duplicate final bills and later edits."""
    from decimal import Decimal
    deduction=Decimal(r.advance_deduction or 0)
    if r.billing_type not in ('Normal','Abschlagsrechnung','Schlussrechnung'):
        raise ValueError('Unbekannte Rechnungsart.')
    if deduction < 0 or r.gross_amount is None or deduction > r.gross_amount:
        raise ValueError('Der angerechnete Abschlag muss kleiner als der positive Rechnungsbetrag sein.')
    if (r.billing_type!='Schlussrechnung' or not offer) and deduction:
        raise ValueError('Abschläge können nur bei einer Schlussrechnung zu einem angenommenen Angebot abgezogen werden.')
    if offer and r.billing_type=='Schlussrechnung':
        items=db.session.scalars(select(CostItem).where(CostItem.offer_id==offer.id)).all()
        ids=[item.id for item in items]
        earlier=db.session.scalars(select(Receipt).where(Receipt.status=='Gebucht',
            Receipt.cost_item_id.in_(ids), Receipt.id!=r.id)).all()
        if any(x.billing_type=='Schlussrechnung' for x in earlier):
            raise ValueError('Zu diesem Auftrag ist bereits eine Schlussrechnung gebucht.')
        prior=sum((_receipt_increment(x) for x in earlier),Decimal('0'))
        if deduction > prior:
            raise ValueError('Angerechnete Abschläge übersteigen die zuvor gebuchten Teilrechnungen.')
    elif offer and r.billing_type!='Schlussrechnung':
        items=db.session.scalars(select(CostItem).where(CostItem.offer_id==offer.id)).all()
        ids=[item.id for item in items]
        if db.session.scalar(select(Receipt.id).where(Receipt.status=='Gebucht',
            Receipt.cost_item_id.in_(ids),Receipt.billing_type=='Schlussrechnung',
            Receipt.id!=r.id).limit(1)):
            raise ValueError('Nach einer gebuchten Schlussrechnung sind weitere Teilrechnungen gesperrt. Bitte die Schlussrechnung zuerst korrigieren.')
    if r.paid_amount is not None and Decimal(r.paid_amount)>_receipt_increment(r):
        raise ValueError('Der bezahlte Betrag darf den noch neu abgerechneten Rechnungsanteil nicht überschreiten.')


def _receipt_json(r, include_text=False):
    obj={'id':r.id,'filename':r.original_name,'source':r.source,'supplier':r.supplier,'invoice_number':r.invoice_number,
         'document_date':r.document_date,'due_date':r.due_date,'gross_amount':float(r.gross_amount) if r.gross_amount is not None else None,
         'net_amount':float(r.net_amount) if r.net_amount is not None else None,
         'vat_amount':float(r.vat_amount) if r.vat_amount is not None else None,'category':r.category,
         'kind':r.kind,'billing_type':r.billing_type,'advance_deduction':float(r.advance_deduction or 0),
         'counted_amount':float(_receipt_increment(r)),'notes':r.notes,'status':r.status,'paid_amount':float(r.paid_amount or 0),
         'budget_line_id':r.budget_line_id,'cost_item_id':r.cost_item_id,
         'offer_id':_accepted_receipt_offer(r).id if _accepted_receipt_offer(r) else None,
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
            for model in (Receipt,CostItem,BudgetLine,Offer):
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
    for model in (Receipt,CostItem,BudgetLine,Offer):
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
    if r.status=='Gebucht' and any(k in data for k in ('gross_amount','budget_line_id','cost_item_id','category','supplier','invoice_number','document_date','kind','billing_type','advance_deduction')):
        return jsonify(error='Zum Ändern der Zuordnung oder Belegsumme zunächst Buchung zurücknehmen.'),409
    try:
        for f in ('supplier','invoice_number','document_date','due_date','category','kind','billing_type','notes'):
            if f in data:
                value=str(data[f] or '')
                if len(value)>({'supplier':200,'invoice_number':100,'document_date':10,'due_date':10,'category':120,'kind':30,'billing_type':24,'notes':3000}[f]):raise ValueError('Text zu lang: '+f)
                if f=='category' and value not in category_names():raise ValueError('Unbekannte Kategorie.')
                if f=='kind' and value not in ('Rechnung','Kassenzettel','Gutschrift'):raise ValueError('Ungültige Belegart.')
                if f=='billing_type' and value not in ('Normal','Abschlagsrechnung','Schlussrechnung'):raise ValueError('Ungültige Rechnungsart.')
                if f in ('document_date','due_date') and value:date.fromisoformat(value)
                setattr(r,f,value)
        for f in ('gross_amount','net_amount','vat_amount','paid_amount','advance_deduction'):
            if f in data:
                amount=_receipt_amount(data[f],f,optional=f not in ('paid_amount','advance_deduction'))
                if f=='paid_amount':
                    allocations=db.session.scalar(select(db.func.count(ReceiptFinancingPayment.id)).where(ReceiptFinancingPayment.receipt_id==r.id)) or 0
                    if allocations and amount != r.paid_amount:raise ValueError('Diese Zahlung ist über die Finanzierungsverwaltung aufgeteilt. Dort bearbeiten.')
                setattr(r,f,amount)
        for field,model in (('budget_line_id',BudgetLine),('cost_item_id',CostItem)):
            if field in data:
                value=data[field];key=int(value) if value not in ('',None) else None
                if key and not db.session.get(model,key):raise ValueError('Zuordnung nicht vorhanden.')
                setattr(r,field,key)
        if 'billing_type' in data and r.billing_type!='Schlussrechnung' and 'advance_deduction' not in data:
            r.advance_deduction=0
        _validate_accepted_invoice_link(r)
        if r.billing_type!='Normal' or r.advance_deduction:
            # Draft inputs are validated even before posting; amounts of previous
            # installments are checked when the invoice is booked.
            _validate_invoice_advance(r,_accepted_receipt_offer(r))
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
    if r.paid_amount<0 or r.paid_amount>_receipt_increment(r):raise ValueError('Gezahlter Betrag darf den noch neu abgerechneten Betrag nicht überschreiten.')
    offer=_validate_accepted_invoice_link(r)
    _validate_invoice_advance(r,offer)
    if r.cost_item_id:
        item=db.session.get(CostItem,r.cost_item_id)
        if not item or item.state in ('Alternative','Abgelehnt'):raise ValueError('Ungültiger oder abgelehnter Auftrag.')
        if offer and not item.budget_line_id and r.budget_line_id:
            raise ValueError('Dieses Angebot ist keinem Kostenplan zugeordnet. Die Rechnung darf keine separate Kostenplanposition erhalten.')
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
    offer=_accepted_receipt_offer(r)
    if offer and r.status=='Gebucht' and r.billing_type!='Schlussrechnung':
        ids=[item.id for item in db.session.scalars(select(CostItem).where(CostItem.offer_id==offer.id))]
        final=db.session.scalar(select(Receipt.id).where(Receipt.status=='Gebucht',
            Receipt.cost_item_id.in_(ids),Receipt.billing_type=='Schlussrechnung').limit(1))
        if final is not None:
            return jsonify(error='Zuerst die Schlussrechnung zurücknehmen, da sie bisherige Abschläge verrechnet.'),409
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

@app.get('/angebote')
def offers_page():return render_template('angebote.html')

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
                    'documents':[document_dict(x) for x in db.session.scalars(select(Document).order_by(Document.id.desc()))],
                    'offers':[offer_dict(x) for x in db.session.scalars(select(Offer).order_by(Offer.id.desc()))],
                    'offer_categories':category_names()})

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
            for key in ('title','category','parent_code','company_hint','kind','notes'):
                if key in b:setattr(obj,key,str(b[key] or '').strip())
            if 'estimate' in b:obj.estimate=float(b['estimate'] or 0)
            if 'active' in b:obj.active=b['active'] is True or str(b['active']).lower() in ('1','true','on')
            if 'is_group' in b:obj.is_group=b['is_group'] is True
            if 'sort_order' in b:obj.sort_order=int(b['sort_order'])
            if not line_id:
                obj.code='KNEW'+str((db.session.scalar(select(db.func.max(BudgetLine.id))) or 0)+1)
                obj.sort_order=1000+int(obj.code[4:])
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
    w.writerow(['Gewerk','Bezeichnung','Schätzung (€)','Aktuelle Prognose (€)','Prognosebasis','Eigenleistung','Firmenhinweis','Notiz'])
    for row in all_budget_lines():
        w.writerow([row.category,row.title,row.estimate,data['line_forecasts'].get(row.id,0),data['line_basis'].get(row.id,'Gruppenzeile'),row.kind=='Eigenleistung',row.company_hint,row.notes])
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
        private_dir = ROOT / 'private'
        if private_dir.exists():
            for document in private_dir.rglob('*'):
                if document.is_symlink():
                    return jsonify(error='Unsicherer Dateilink im Dokumentenordner; Archiv abgebrochen.'),409
                if document.is_file():
                    archive.write(document, arcname=document.relative_to(ROOT).as_posix())
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


@app.get('/daten')
def data_management_page():
    return render_template('daten.html')


@app.post('/api/data/reset')
def reset_all_project_data():
    """Clear local project records and uploads, after a mandatory verified complete backup.

    Keep schema and Alembic history so upgrades continue to work. Never touch
    backup archives or the backup configuration. Only permit calls from localhost.
    """
    if db.engine.url.get_backend_name() != 'sqlite' or db.engine.url.database in (None, ':memory:'):
        return jsonify(error='Der vollständige Reset ist nur für die lokale SQLite-Version freigeschaltet.'),409
    try:
        localhost = ipaddress.ip_address(request.remote_addr or '').is_loopback
    except ValueError:
        localhost = False
    origin = request.headers.get('Origin')
    if (not localhost or request.headers.get('X-PHB-Reset') != '1'
            or (origin and origin.rstrip('/') != request.host_url.rstrip('/'))):
        return jsonify(error='Reset nur über die lokale Datenverwaltung erlaubt.'),403
    body = request.get_json(silent=True)
    if not isinstance(body, dict) or body.get('confirmation') != 'ALLE DATEN LÖSCHEN':
        return jsonify(error='Bitte den Bestätigungstext vollständig eingeben.'),400

    import backup_manager
    if Path(db.engine.url.database).resolve() != backup_manager.db_path().resolve():
        return jsonify(error='Backup-Datenbank und aktive Datenbank stimmen nicht überein.'),409
    try:
        archive = backup_manager.make_backup()
        backup_manager.verify_backup(archive)
    except (ValueError, OSError, sqlite3.DatabaseError, zipfile.BadZipFile) as exc:
        return jsonify(error='Keine Daten gelöscht: Vollständiges Backup fehlgeschlagen: '+str(exc)),409

    # Move original files aside *after* the backup. Restore them if the DB reset fails.
    private = ROOT / 'private'
    quarantine = ROOT / ('.reset-quarantine-' + uuid4().hex)
    try:
        if private.exists():
            private.rename(quarantine)
        # Reverse FK dependency order, all user tables, do not touch alembic_version.
        for table in reversed(db.metadata.sorted_tables):
            db.session.execute(table.delete())
        db.session.add(Setting(key='start',value='2027-03-01'))
        db.session.add(Setting(key='initial_budget',value='0'))
        db.session.add(Setting(key='project_initialized',value='1'))
        for idx,name in enumerate(CATEGORIES):
            db.session.add(Category(name=name,sort_order=idx))
        db.session.commit()
    except Exception:
        db.session.rollback()
        if quarantine.exists() and not private.exists():
            quarantine.rename(private)
        app.logger.exception('Projekt-Reset abgebrochen. Backup: %s', archive)
        return jsonify(error='Reset fehlgeschlagen. Der Datenbankvorgang wurde zurückgenommen. Backup: '+str(archive)),500

    warning = None
    if quarantine.exists():
        try:
            shutil.rmtree(quarantine)
        except OSError:
            warning = 'Die Daten sind zurückgesetzt. Alte Dateien konnten nicht bereinigt werden: '+str(quarantine)
    return jsonify(ok=True, backup=str(archive), warning=warning)

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
    app.run(host=os.environ.get('HOST','127.0.0.1'),port=int(os.environ.get('PORT','5055')),debug=False)
