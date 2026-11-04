"""Editable records and reusable loan drawdown profiles.

Revision ID: 0021
Revises: 0020
"""
from alembic import op
import sqlalchemy as sa

revision='0021'
down_revision='0020'
branch_labels=None
depends_on=None


def upgrade():
    bind=op.get_bind();inspector=sa.inspect(bind)
    if not inspector.has_table('finance_loan'):
        return
    columns={column['name'] for column in inspector.get_columns('finance_loan')}
    if 'drawdown_profile_json' not in columns:
        op.add_column('finance_loan',sa.Column('drawdown_profile_json',sa.Text,
            nullable=False,server_default='{}'))


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
