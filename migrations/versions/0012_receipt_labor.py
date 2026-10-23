"""Store a separately reviewable labor/service share on receipts.

Revision ID: 0012
Revises: 0011
"""
from alembic import op
import sqlalchemy as sa

revision='0012'
down_revision='0011'
branch_labels=None
depends_on=None


def upgrade():
    inspector=sa.inspect(op.get_bind())
    if not inspector.has_table('receipt'):
        return
    columns={c['name'] for c in inspector.get_columns('receipt')}
    if 'labor_amount' not in columns:
        op.add_column('receipt',sa.Column('labor_amount',sa.Numeric(12,2),nullable=True))
    if 'labor_source' not in columns:
        op.add_column('receipt',sa.Column('labor_source',sa.String(20),nullable=False,server_default=''))
    # No backfill: NULL means genuinely unknown, not zero labor costs.


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
