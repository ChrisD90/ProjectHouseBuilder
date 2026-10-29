"""Track loan uses and payout targets.

Revision ID: 0023
Revises: 0022
"""
from alembic import op
import sqlalchemy as sa

revision='0023'
down_revision='0022'
branch_labels=None
depends_on=None


def upgrade():
    bind=op.get_bind();inspector=sa.inspect(bind)
    if not inspector.has_table('finance_loan_usage'):
        op.create_table('finance_loan_usage',
            sa.Column('id',sa.Integer(),primary_key=True),
            sa.Column('loan_id',sa.Integer(),sa.ForeignKey('finance_loan.id',ondelete='RESTRICT'),nullable=False),
            sa.Column('receipt_id',sa.Integer(),sa.ForeignKey('receipt.id',ondelete='RESTRICT'),nullable=True),
            sa.Column('kind',sa.String(30),nullable=False),
            sa.Column('amount',sa.Numeric(14,2),nullable=False),
            sa.Column('usage_date',sa.String(10),nullable=False),
            sa.Column('purpose',sa.String(240),nullable=False),
            sa.Column('notes',sa.Text(),nullable=False,server_default=''),
            sa.Column('status',sa.String(24),nullable=False,server_default='Aktiv'),
            sa.Column('snapshot_json',sa.Text(),nullable=False,server_default='{}'),
            sa.Column('original_name',sa.String(240),nullable=False,server_default=''),
            sa.Column('stored_name',sa.String(80),nullable=False,server_default=''),
            sa.Column('created_at',sa.DateTime(),nullable=False,server_default=sa.func.current_timestamp()),
            sa.Column('reversed_at',sa.DateTime(),nullable=True))
        op.create_index('ix_finance_usage_loan','finance_loan_usage',['loan_id'])
        op.create_index('ix_finance_usage_receipt','finance_loan_usage',['receipt_id'])
    if inspector.has_table('finance_loan_drawdown'):
        columns={column['name'] for column in inspector.get_columns('finance_loan_drawdown')}
        if 'payout_type' not in columns:
            op.add_column('finance_loan_drawdown',sa.Column('payout_type',sa.String(24),nullable=False,server_default='own_account'))
        bind.execute(sa.text("UPDATE finance_loan_drawdown SET status='Ausgezahlt' WHERE status='Bestätigt'"))


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
