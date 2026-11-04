"""Accepted-offer billing tracking and safe final-invoice advance offsets.

Revision ID: 0005
Revises: 0004
"""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade():
    inspector=sa.inspect(op.get_bind())
    if not inspector.has_table('receipt'):
        # An unusual pre-baseline legacy database may lack the entire table.
        # db.create_all creates the latest schema on application startup.
        return
    existing={col['name'] for col in inspector.get_columns('receipt')}
    if 'billing_type' not in existing:
        op.add_column('receipt',sa.Column('billing_type',sa.String(24),nullable=False,server_default='Normal'))
    if 'advance_deduction' not in existing:
        op.add_column('receipt',sa.Column('advance_deduction',sa.Numeric(12,2),nullable=False,server_default='0'))


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
