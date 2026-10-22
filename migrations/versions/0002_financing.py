"""Financing sources, actual cashflows, source-attributed receipt payments and due dates.

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    bind=op.get_bind()
    inspector=sa.inspect(bind)
    existing={x['name'] for x in inspector.get_columns('receipt')}
    if 'due_date' not in existing:
        op.add_column('receipt',sa.Column('due_date',sa.String(10),nullable=False,server_default=''))
    if not inspector.has_table('finance_loan'):
        op.create_table('finance_loan',
            sa.Column('id',sa.Integer,primary_key=True),
            sa.Column('name',sa.String(160),nullable=False),
            sa.Column('bank',sa.String(160),nullable=False,server_default=''),
            sa.Column('reference',sa.String(120),nullable=False,server_default=''),
            sa.Column('principal',sa.Numeric(14,2),nullable=False),
            sa.Column('interest_rate',sa.Numeric(6,3),nullable=False,server_default='0'),
            sa.Column('monthly_payment',sa.Numeric(14,2),nullable=False,server_default='0'),
            sa.Column('initial_repayment_rate',sa.Numeric(6,3),nullable=False,server_default='0'),
            sa.Column('extra_repayment_pct',sa.Numeric(6,3),nullable=False,server_default='0'),
            sa.Column('contract_date',sa.String(10),nullable=False,server_default=''),
            sa.Column('fixed_until',sa.String(10),nullable=False,server_default=''),
            sa.Column('interest_free_until',sa.String(10),nullable=False,server_default=''),
            sa.Column('commitment_interest_rate',sa.Numeric(6,3),nullable=False,server_default='0'),
            sa.Column('notes',sa.Text,nullable=False,server_default=''))
    if not inspector.has_table('finance_equity'):
        op.create_table('finance_equity',
            sa.Column('id',sa.Integer,primary_key=True),
            sa.Column('name',sa.String(160),nullable=False),
            sa.Column('opening_balance',sa.Numeric(14,2),nullable=False,server_default='0'),
            sa.Column('reserve',sa.Numeric(14,2),nullable=False,server_default='0'),
            sa.Column('notes',sa.Text,nullable=False,server_default=''))
    if not inspector.has_table('finance_event'):
        op.create_table('finance_event',
            sa.Column('id',sa.Integer,primary_key=True),
            sa.Column('kind',sa.String(30),nullable=False),
            sa.Column('loan_id',sa.Integer,sa.ForeignKey('finance_loan.id',ondelete='RESTRICT')),
            sa.Column('equity_id',sa.Integer,sa.ForeignKey('finance_equity.id',ondelete='RESTRICT')),
            sa.Column('amount',sa.Numeric(14,2),nullable=False),
            sa.Column('event_date',sa.String(10),nullable=False),
            sa.Column('notes',sa.Text,nullable=False,server_default=''))
        op.create_index('ix_finance_event_loan','finance_event',['loan_id'])
        op.create_index('ix_finance_event_equity','finance_event',['equity_id'])
    if not inspector.has_table('finance_receipt_payment'):
        op.create_table('finance_receipt_payment',
            sa.Column('id',sa.Integer,primary_key=True),
            sa.Column('receipt_id',sa.Integer,sa.ForeignKey('receipt.id',ondelete='RESTRICT'),nullable=False),
            sa.Column('source',sa.String(10),nullable=False),
            sa.Column('loan_id',sa.Integer,sa.ForeignKey('finance_loan.id',ondelete='RESTRICT')),
            sa.Column('equity_id',sa.Integer,sa.ForeignKey('finance_equity.id',ondelete='RESTRICT')),
            sa.Column('amount',sa.Numeric(14,2),nullable=False),
            sa.Column('payment_date',sa.String(10),nullable=False),
            sa.Column('notes',sa.Text,nullable=False,server_default=''))
        op.create_index('ix_finance_receipt','finance_receipt_payment',['receipt_id'])
        op.create_index('ix_finance_payment_loan','finance_receipt_payment',['loan_id'])
        op.create_index('ix_finance_payment_equity','finance_receipt_payment',['equity_id'])


def downgrade():
    raise RuntimeError('Downgrade nicht unterstützt. Bitte ein vollständiges Backup wiederherstellen.')
