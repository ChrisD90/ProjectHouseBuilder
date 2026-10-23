"""Indexed, private project documents for opt-in AI use.

Revision ID: 0013
Revises: 0012
"""
from alembic import op
import sqlalchemy as sa

revision='0013'
down_revision='0012'
branch_labels=None
depends_on=None


def upgrade():
    if not sa.inspect(op.get_bind()).has_table('project_document'):
        op.create_table('project_document',
            sa.Column('id',sa.Integer(),primary_key=True),
            sa.Column('title',sa.String(200),nullable=False),
            sa.Column('original_name',sa.String(220),nullable=False),
            sa.Column('stored_name',sa.String(80),nullable=False,unique=True),
            sa.Column('extension',sa.String(12),nullable=False),
            sa.Column('digest',sa.String(64),nullable=False),
            sa.Column('size_bytes',sa.Integer(),nullable=False),
            sa.Column('category',sa.String(60),nullable=False),
            sa.Column('area',sa.String(60),nullable=False),
            sa.Column('status',sa.String(20),nullable=False,server_default='Aktuell'),
            sa.Column('tags',sa.String(400),nullable=False,server_default=''),
            sa.Column('description',sa.String(1500),nullable=False,server_default=''),
            sa.Column('extracted_text',sa.Text(),nullable=False,server_default=''),
            sa.Column('extraction_note',sa.String(260),nullable=False,server_default=''),
            sa.Column('uploaded_at',sa.DateTime(),nullable=False,
                      server_default=sa.func.current_timestamp()),
        )
        op.create_index('idx_project_document_digest','project_document',['digest'])
    if inspector.has_table('schedule_history'):
        columns={item['name'] for item in inspector.get_columns('schedule_history')}
        if 'source_documents' not in columns:
            op.add_column('schedule_history',sa.Column(
                'source_documents',sa.Text(),nullable=False,server_default='[]'))


def downgrade():
    raise RuntimeError('Bitte geprüftes Komplettbackup wiederherstellen.')
