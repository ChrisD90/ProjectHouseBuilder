"""Persistent background PDF/import task registry.

Revision ID: 0014
Revises: 0013
"""
from alembic import op
import sqlalchemy as sa
revision='0014'
down_revision='0013'
branch_labels=None
depends_on=None

def upgrade():
    if sa.inspect(op.get_bind()).has_table('import_job'):
        return
    op.create_table('import_job',
        sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('batch_id',sa.String(32),nullable=False),
        sa.Column('kind',sa.String(20),nullable=False),
        sa.Column('filename',sa.String(240),nullable=False),
        sa.Column('stored_name',sa.String(90),nullable=False),
        sa.Column('analysis_mode',sa.String(10),nullable=False),
        sa.Column('model',sa.String(100),nullable=False,server_default=''),
        sa.Column('extra_json',sa.Text(),nullable=False,server_default='{}'),
        sa.Column('status',sa.String(20),nullable=False,server_default='Wartend'),
        sa.Column('stage',sa.String(250),nullable=False,server_default='In Warteschlange'),
        sa.Column('error',sa.String(500),nullable=False,server_default=''),
        sa.Column('result_id',sa.Integer(),nullable=True),
        sa.Column('created_at',sa.DateTime(),nullable=False,server_default=sa.func.current_timestamp()),
        sa.Column('updated_at',sa.DateTime(),nullable=False,server_default=sa.func.current_timestamp()),
        sa.Column('finished_at',sa.DateTime(),nullable=True))
    op.create_index('idx_import_job_batch','import_job',['batch_id'])
    op.create_index('idx_import_job_status','import_job',['status'])

def downgrade():
    raise RuntimeError('Nur durch geprüfte Wiederherstellung eines Komplettbackups rückgängig machen.')
