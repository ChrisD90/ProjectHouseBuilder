"""Domain model definitions, independent of route registration and application startup."""
from datetime import date,datetime
from sqlalchemy import text
from multi_projects import current_project_id
from money_values import Money

def define_models(db):
    class Project(db.Model):
        __global__ = True
        id=db.Column(db.Integer,primary_key=True)
        title=db.Column(db.String(160),nullable=False)
        kind=db.Column(db.String(80),nullable=False,default='Sanierung')
        description=db.Column(db.String(2000),nullable=False,default='')
        created_at=db.Column(db.DateTime,nullable=False,default=datetime.utcnow)
        archived_at=db.Column(db.DateTime,nullable=True)


    class Setting(db.Model):
        project_id=db.Column(db.Integer,db.ForeignKey('project.id'),primary_key=True,default=current_project_id,server_default='1')
        key = db.Column(db.String(80), primary_key=True)
        value = db.Column(db.String(255), nullable=False)


    class Category(db.Model):
        __table_args__=(db.UniqueConstraint('project_id','name',name='uq_category_project_name'),)
        id = db.Column(db.Integer, primary_key=True)
        name = db.Column(db.String(120), nullable=False)
        sort_order = db.Column(db.Integer, nullable=False, default=0)


    class BuildPhase(db.Model):
        __table_args__=(db.UniqueConstraint('project_id','title',name='uq_build_phase_project_title'),)
        __tablename__ = 'build_phase'
        completed_at=db.Column(db.Date,nullable=True)
        id = db.Column(db.Integer, primary_key=True)
        title = db.Column(db.String(140), nullable=False)
        description = db.Column(db.String(1000), nullable=False, default='')
        start_date = db.Column(db.Date, nullable=False)
        end_date = db.Column(db.Date)
        position = db.Column(db.Integer, nullable=False, default=0)


    class Task(db.Model):
        __table_args__=(db.UniqueConstraint('project_id','code',name='uq_task_project_code'),)
        id = db.Column(db.Integer, primary_key=True)
        code = db.Column(db.String(30), nullable=False)
        phase = db.Column(db.String(140), nullable=False, default='Allgemein')
        phase_id = db.Column(db.Integer, db.ForeignKey('build_phase.id'), nullable=True)
        phase_record = db.relationship('BuildPhase')
        trade = db.Column(db.String(140), nullable=False, default='Sonstiges')
        execution_type = db.Column(db.String(24), nullable=False, default='Noch offen', server_default='Noch offen')
        name = db.Column(db.String(300), nullable=False)
        company = db.Column(db.String(300), nullable=False, default='')
        contractor_id = db.Column(db.Integer, db.ForeignKey('contractor.id'), nullable=True)
        duration = db.Column(db.Integer, nullable=False, default=1)
        lag_days = db.Column(db.Integer, nullable=False, default=0)
        earliest_start = db.Column(db.Date)
        planned_end = db.Column(db.Date)
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


    class ScheduleHistory(db.Model):
        """Project-local conversation and audit trail, persisted in the backed-up DB."""
        __tablename__='schedule_history'
        id=db.Column(db.Integer,primary_key=True)
        created_at=db.Column(db.DateTime,nullable=False,default=datetime.utcnow)
        kind=db.Column(db.String(24),nullable=False,default='KI')
        status=db.Column(db.String(24),nullable=False,default='Vorschlag')
        request_text=db.Column(db.Text,nullable=False,default='')
        answer_text=db.Column(db.Text,nullable=False,default='')
        decision=db.Column(db.String(1200),nullable=False,default='')
        changes_json=db.Column(db.Text,nullable=False,default='[]')
        plan_digest=db.Column(db.String(64),nullable=False,default='')
        source_documents=db.Column(db.Text,nullable=False,default='[]',server_default='[]')


    class ImportJob(db.Model):
        lease_owner=db.Column(db.String(80),nullable=False,default='queued',server_default='queued')
        lease_until=db.Column(db.DateTime,nullable=True)
        __tablename__='import_job'
        id=db.Column(db.Integer,primary_key=True)
        batch_id=db.Column(db.String(32),nullable=False,index=True)
        kind=db.Column(db.String(20),nullable=False)
        filename=db.Column(db.String(240),nullable=False)
        stored_name=db.Column(db.String(90),nullable=False)
        analysis_mode=db.Column(db.String(10),nullable=False)
        model=db.Column(db.String(100),nullable=False,default='')
        extra_json=db.Column(db.Text,nullable=False,default='{}')
        status=db.Column(db.String(20),nullable=False,default='Wartend')
        stage=db.Column(db.String(250),nullable=False,default='In Warteschlange')
        error=db.Column(db.String(500),nullable=False,default='')
        result_id=db.Column(db.Integer,nullable=True)
        created_at=db.Column(db.DateTime,nullable=False,default=datetime.utcnow)
        updated_at=db.Column(db.DateTime,nullable=False,default=datetime.utcnow)
        finished_at=db.Column(db.DateTime,nullable=True)


    class ProjectDocument(db.Model):
        __tablename__='project_document'
        id=db.Column(db.Integer,primary_key=True)
        title=db.Column(db.String(200),nullable=False)
        original_name=db.Column(db.String(220),nullable=False)
        stored_name=db.Column(db.String(80),unique=True,nullable=False)
        extension=db.Column(db.String(12),nullable=False)
        digest=db.Column(db.String(64),nullable=False)
        size_bytes=db.Column(db.Integer,nullable=False)
        category=db.Column(db.String(60),nullable=False)
        area=db.Column(db.String(60),nullable=False)
        status=db.Column(db.String(20),nullable=False,default='Aktuell',server_default='Aktuell')
        tags=db.Column(db.String(400),nullable=False,default='',server_default='')
        description=db.Column(db.String(1500),nullable=False,default='',server_default='')
        extracted_text=db.Column(db.Text,nullable=False,default='',server_default='')
        extraction_note=db.Column(db.String(260),nullable=False,default='',server_default='')
        uploaded_at=db.Column(db.DateTime,nullable=False,server_default=db.func.current_timestamp())


    class Trade(db.Model):
        __table_args__=(db.UniqueConstraint('project_id','name',name='uq_trade_project_name'),)
        """Editable trade names; distinct from financial/receipt categories."""
        id=db.Column(db.Integer,primary_key=True)
        name=db.Column(db.String(140),nullable=False)


    class Contractor(db.Model):
        id=db.Column(db.Integer,primary_key=True)
        trade=db.Column(db.String(140),default='')
        name=db.Column(db.String(200),nullable=False)
        contact=db.Column(db.String(200),default='')
        phone=db.Column(db.String(100),default='')
        mobile=db.Column(db.String(100),nullable=False,default='',server_default='')
        phone_other=db.Column(db.String(100),nullable=False,default='',server_default='')
        contact_secondary=db.Column(db.String(200),nullable=False,default='',server_default='')
        email=db.Column(db.String(200),default='')
        website=db.Column(db.String(240),nullable=False,default='',server_default='')
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
        estimate=db.Column(Money(),nullable=False,default=0)
        offer=db.Column(Money(),nullable=False,default=0)
        committed=db.Column(Money(),nullable=False,default=0)
        paid=db.Column(Money(),nullable=False,default=0)
        own_hours=db.Column(db.Float,nullable=False,default=0)
        own_hourly=db.Column(Money(),nullable=False,default=0)
        source_ref=db.Column(db.String(300),default='')
        notes=db.Column(db.Text,default='')
        budget_line_id=db.Column(db.Integer, db.ForeignKey('budget_line.id'), nullable=True)
        selected=db.Column(db.Boolean, nullable=False, default=False)
        offer_id=db.Column(db.Integer,db.ForeignKey('offer.id'),nullable=True)


    class BudgetLine(db.Model):
        __table_args__=(db.UniqueConstraint('project_id','code',name='uq_budget_line_project_code'),)
        id=db.Column(db.Integer,primary_key=True)
        code=db.Column(db.String(40),nullable=False)
        category=db.Column(db.String(160),nullable=False)
        title=db.Column(db.String(300),nullable=False)
        parent_code=db.Column(db.String(40),default='')
        estimate=db.Column(Money(),nullable=False,default=0)
        company_hint=db.Column(db.String(200),default='')
        kind=db.Column(db.String(40),nullable=False,default='Fremdleistung')
        notes=db.Column(db.Text,default='')
        sort_order=db.Column(db.Integer,nullable=False,default=0)
        is_group=db.Column(db.Boolean,nullable=False,default=False)
        active=db.Column(db.Boolean,nullable=False,default=True)


    class Funding(db.Model):
        id=db.Column(db.Integer,primary_key=True)
        name=db.Column(db.String(200),nullable=False)
        expected=db.Column(Money(),nullable=False,default=0)
        confirmed=db.Column(Money(),nullable=False,default=0)
        received=db.Column(Money(),nullable=False,default=0)
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
        __table_args__=(db.UniqueConstraint('project_id','digest',name='uq_receipt_project_digest'),)
        id=db.Column(db.Integer,primary_key=True)
        digest=db.Column(db.String(64),nullable=False)
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
        labor_amount=db.Column(db.Numeric(12,2),nullable=True)
        labor_source=db.Column(db.String(20),nullable=False,default='',server_default='')
        trade=db.Column(db.String(120),nullable=False,default='',server_default='')
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
        contractor_id=db.Column(db.Integer,db.ForeignKey('contractor.id'),nullable=True)
        assignment_type=db.Column(db.String(24),nullable=False,default='',server_default='')
        created_at=db.Column(db.DateTime,nullable=False,default=datetime.utcnow)


    class Offer(db.Model):
        __table_args__=(db.UniqueConstraint('project_id','digest',name='uq_offer_project_digest'),)
        id=db.Column(db.Integer,primary_key=True)
        digest=db.Column(db.String(64),nullable=False)
        document_id=db.Column(db.Integer,db.ForeignKey('document.id'))
        contractor_id=db.Column(db.Integer,db.ForeignKey('contractor.id'))
        vendor=db.Column(db.String(200),nullable=False)
        number=db.Column(db.String(100),default='')
        issued=db.Column(db.String(20),default='')
        expires=db.Column(db.String(20),default='')
        gross=db.Column(Money())
        net=db.Column(Money())
        vat=db.Column(Money())
        tax_rate=db.Column(db.Float,default=0)
        status=db.Column(db.String(30),nullable=False,default='Entwurf')
        category=db.Column(db.String(120),nullable=False,default='Sonstiges')
        budget_line_id=db.Column(db.Integer,db.ForeignKey('budget_line.id'))
        notes=db.Column(db.Text,nullable=False,default='')
        reconciled=db.Column(db.Boolean,nullable=False,default=False)
        warnings=db.Column(db.Text,nullable=False,default='[]')
        filename=db.Column(db.String(260),nullable=False)
        created_at=db.Column(db.DateTime,default=datetime.utcnow)
        current_version=db.Column(db.Integer,nullable=False,default=1,server_default='1')
        deletion_locked=db.Column(db.Boolean,nullable=False,default=False,server_default=text('FALSE'))
        versions=db.relationship('OfferVersion',cascade='all,delete-orphan',lazy='select',order_by='OfferVersion.version_number')
        sections=db.relationship('OfferSection',cascade='all,delete-orphan',lazy='select')
        positions=db.relationship('OfferPosition',cascade='all,delete-orphan',lazy='select')


    class OrderAcceptance(db.Model):
        """Immutable accepted-order amount, keeping the quoted PDF and values intact."""
        __tablename__='order_acceptance'
        id=db.Column(db.Integer,primary_key=True)
        offer_id=db.Column(db.Integer,db.ForeignKey('offer.id',ondelete='RESTRICT'),nullable=False,unique=True)
        confirmation_document_id=db.Column(db.Integer,db.ForeignKey('document.id'),nullable=True)
        quoted_gross=db.Column(db.Numeric(12,2),nullable=False)
        agreed_gross=db.Column(db.Numeric(12,2),nullable=False)
        mode=db.Column(db.String(20),nullable=False)  # 'offer' or 'confirmation'
        created_at=db.Column(db.DateTime,nullable=False,default=datetime.utcnow)


    class OfferVersion(db.Model):
        """Immutable snapshot of historic quotes, plus editable pending revisions."""
        __tablename__='offer_version'
        id=db.Column(db.Integer,primary_key=True)
        offer_id=db.Column(db.Integer,db.ForeignKey('offer.id',ondelete='CASCADE'),nullable=False)
        version_number=db.Column(db.Integer,nullable=False)
        state=db.Column(db.String(16),nullable=False,default='draft')
        snapshot=db.Column(db.Text,nullable=False)
        document_id=db.Column(db.Integer,db.ForeignKey('document.id'))
        created_at=db.Column(db.DateTime,nullable=False,default=datetime.utcnow)
        __table_args__=(db.UniqueConstraint('offer_id','version_number',name='uq_offer_version_number'),)


    class OfferSection(db.Model):
        id=db.Column(db.Integer,primary_key=True)
        offer_id=db.Column(db.Integer,db.ForeignKey('offer.id',ondelete='CASCADE'),nullable=False)
        name=db.Column(db.String(170),nullable=False)
        net=db.Column(Money(),nullable=False,default=0)
        gross=db.Column(Money(),nullable=False,default=0)
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
        unit_price=db.Column(Money())
        net_amount=db.Column(Money())
        optional_amount=db.Column(Money())
        optional=db.Column(db.Boolean,nullable=False,default=False)
        page=db.Column(db.Integer)

    return {'Project':Project, 'Setting':Setting, 'Category':Category, 'BuildPhase':BuildPhase, 'Task':Task, 'Dependency':Dependency, 'ScheduleHistory':ScheduleHistory, 'ImportJob':ImportJob, 'ProjectDocument':ProjectDocument, 'Trade':Trade, 'Contractor':Contractor, 'CostItem':CostItem, 'BudgetLine':BudgetLine, 'Funding':Funding, 'Document':Document, 'Receipt':Receipt, 'Offer':Offer, 'OrderAcceptance':OrderAcceptance, 'OfferVersion':OfferVersion, 'OfferSection':OfferSection, 'OfferPosition':OfferPosition}
