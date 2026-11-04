"""Add staged loan drawdowns, PDF previews and manual event documents.

Revision ID: 0020
Revises: 0019
"""
from alembic import op
import sqlalchemy as sa

revision='0020'
down_revision='0019'
branch_labels=None
depends_on=None


def upgrade():
    bind=op.get_bind();inspector=sa.inspect(bind)
    columns={column['name']:column for column in inspector.get_columns('finance_loan_drawdown')}
    additions=(
        ('status',sa.Column('status',sa.String(24),nullable=False,server_default='Bestätigt')),
        ('data_json',sa.Column('data_json',sa.Text,nullable=False,server_default='{}')),
        ('mapping_json',sa.Column('mapping_json',sa.Text,nullable=False,server_default='{}')),
        ('preview_name',sa.Column('preview_name',sa.String(80),nullable=True)),
        ('submitted_at',sa.Column('submitted_at',sa.DateTime,nullable=True)),
        ('confirmed_at',sa.Column('confirmed_at',sa.DateTime,nullable=True)),
        ('rejected_at',sa.Column('rejected_at',sa.DateTime,nullable=True)),
        ('rejection_reason',sa.Column('rejection_reason',sa.String(500),nullable=False,server_default='')),
        ('updated_at',sa.Column('updated_at',sa.DateTime,nullable=False,server_default=sa.func.current_timestamp())),
    )
    for name,column in additions:
        if name not in columns:op.add_column('finance_loan_drawdown',column)
    if not columns['event_id'].get('nullable',True):
        # Some supported legacy databases were stamped at an old revision with
        # only the tables used at that time. Avoid resolving unrelated parent
        # FKs while SQLite performs its copy-and-replace ALTER operation.
        copy_from=None
        if bind.dialect.name=='sqlite':
            copy_from=sa.Table('finance_loan_drawdown',sa.MetaData(),
                autoload_with=bind,resolve_fks=False)
        with op.batch_alter_table('finance_loan_drawdown',copy_from=copy_from) as batch:
            batch.alter_column('event_id',existing_type=sa.Integer(),nullable=True)
    op.execute(sa.text("UPDATE finance_loan_drawdown SET status='Bestätigt', confirmed_at=COALESCE(confirmed_at, created_at), updated_at=COALESCE(updated_at, created_at)"))
    inspector=sa.inspect(bind)
    if not inspector.has_table('finance_event_document'):
        op.create_table('finance_event_document',
            sa.Column('id',sa.Integer,primary_key=True),
            sa.Column('event_id',sa.Integer,sa.ForeignKey('finance_event.id',ondelete='CASCADE'),nullable=False,unique=True),
            sa.Column('original_name',sa.String(240),nullable=False),
            sa.Column('stored_name',sa.String(80),nullable=False,unique=True),
            sa.Column('uploaded_at',sa.DateTime,nullable=False,server_default=sa.func.current_timestamp()))
    indexes={index['name'] for index in sa.inspect(bind).get_indexes('finance_loan_drawdown')}
    if 'ix_finance_drawdown_status' not in indexes:
        op.create_index('ix_finance_drawdown_status','finance_loan_drawdown',['status'])


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
