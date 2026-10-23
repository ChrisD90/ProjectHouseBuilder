"""Persist schedule conversations, approvals and manual change audit.

Revision ID: 0011
Revises: 0010
"""
from alembic import op
import sqlalchemy as sa

revision='0011'
down_revision='0010'
branch_labels=None
depends_on=None


def upgrade():
    if not sa.inspect(op.get_bind()).has_table('schedule_history'):
        op.create_table('schedule_history',
            sa.Column('id',sa.Integer(),primary_key=True),
            sa.Column('created_at',sa.DateTime(),nullable=False,
                      server_default=sa.func.current_timestamp()),
            sa.Column('kind',sa.String(24),nullable=False,server_default='KI'),
            sa.Column('status',sa.String(24),nullable=False,server_default='Vorschlag'),
            sa.Column('request_text',sa.Text(),nullable=False,server_default=''),
            sa.Column('answer_text',sa.Text(),nullable=False,server_default=''),
            sa.Column('decision',sa.String(1200),nullable=False,server_default=''),
            sa.Column('changes_json',sa.Text(),nullable=False,server_default='[]'),
            sa.Column('plan_digest',sa.String(64),nullable=False,server_default=''))


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
