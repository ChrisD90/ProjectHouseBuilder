"""Audit invoice cancellation reversals.

Revision ID: 0019
Revises: 0018
"""
from alembic import op
import sqlalchemy as sa

revision='0019'
down_revision='0018'
branch_labels=None
depends_on=None


def upgrade():
    bind=op.get_bind()
    inspector=sa.inspect(bind)
    if not inspector.has_table('receipt_cancellation_reversal'):
        op.create_table('receipt_cancellation_reversal',
            sa.Column('id',sa.Integer,primary_key=True),
            sa.Column('receipt_id',sa.Integer,sa.ForeignKey('receipt.id',ondelete='CASCADE'),nullable=False),
            sa.Column('cancellation_created_at',sa.DateTime,nullable=False),
            sa.Column('cancellation_reason',sa.String(500),nullable=False,server_default=''),
            sa.Column('cancellation_snapshot_json',sa.Text,nullable=False),
            sa.Column('reversed_at',sa.DateTime,nullable=False,server_default=sa.func.current_timestamp()),
            sa.Column('reason',sa.String(500),nullable=False,server_default=''))
        op.create_index('ix_receipt_cancellation_reversal_receipt',
                        'receipt_cancellation_reversal',['receipt_id'])


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
