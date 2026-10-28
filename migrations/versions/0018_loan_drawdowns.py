"""Loan drawdown templates, packages and auditable receipt rebookings.

Revision ID: 0018
Revises: 0017
"""
from alembic import op
import sqlalchemy as sa

revision='0018'
down_revision='0017'
branch_labels=None
depends_on=None


def upgrade():
    bind=op.get_bind()
    inspector=sa.inspect(bind)
    document_columns={column['name'] for column in inspector.get_columns('finance_loan_document')}
    if 'document_type' not in document_columns:
        op.add_column('finance_loan_document',sa.Column(
            'document_type',sa.String(30),nullable=False,server_default='attachment'))
    if not inspector.has_table('finance_loan_drawdown'):
        op.create_table('finance_loan_drawdown',
            sa.Column('id',sa.Integer,primary_key=True),
            sa.Column('loan_id',sa.Integer,sa.ForeignKey('finance_loan.id',ondelete='RESTRICT'),nullable=False),
            sa.Column('event_id',sa.Integer,sa.ForeignKey('finance_event.id',ondelete='RESTRICT'),nullable=False,unique=True),
            sa.Column('template_document_id',sa.Integer,sa.ForeignKey('finance_loan_document.id',ondelete='SET NULL')),
            sa.Column('requested_amount',sa.Numeric(14,2),nullable=False),
            sa.Column('stored_name',sa.String(80),nullable=False,unique=True),
            sa.Column('requested_date',sa.String(10),nullable=False),
            sa.Column('borrower_names',sa.String(500),nullable=False,server_default=''),
            sa.Column('property_address',sa.String(500),nullable=False,server_default=''),
            sa.Column('recipient_iban',sa.String(34),nullable=False,server_default=''),
            sa.Column('recipient_name',sa.String(200),nullable=False,server_default=''),
            sa.Column('location',sa.String(160),nullable=False,server_default=''),
            sa.Column('notes',sa.Text,nullable=False,server_default=''),
            sa.Column('ai_prefilled',sa.Boolean,nullable=False,server_default=sa.false()),
            sa.Column('created_at',sa.DateTime,nullable=False,server_default=sa.func.current_timestamp()))
        op.create_index('ix_finance_drawdown_loan','finance_loan_drawdown',['loan_id'])
    if not inspector.has_table('finance_loan_drawdown_item'):
        op.create_table('finance_loan_drawdown_item',
            sa.Column('id',sa.Integer,primary_key=True),
            sa.Column('drawdown_id',sa.Integer,sa.ForeignKey('finance_loan_drawdown.id',ondelete='CASCADE'),nullable=False),
            sa.Column('receipt_id',sa.Integer,sa.ForeignKey('receipt.id',ondelete='RESTRICT'),nullable=False),
            sa.Column('claimed_amount',sa.Numeric(14,2),nullable=False),
            sa.Column('snapshot_json',sa.Text,nullable=False),
            sa.UniqueConstraint('drawdown_id','receipt_id',name='uq_drawdown_receipt'))
        op.create_index('ix_finance_drawdown_item_request','finance_loan_drawdown_item',['drawdown_id'])
        op.create_index('ix_finance_drawdown_item_receipt','finance_loan_drawdown_item',['receipt_id'])


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
