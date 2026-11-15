"""Retain project document files as reviewed versions, preserving existing IDs."""
from alembic import op
import sqlalchemy as sa
revision='0035'
down_revision='0034'
branch_labels=None
depends_on=None

def upgrade():
    from app import ProjectDocumentVersion
    bind=op.get_bind()
    if 'current_version' not in {c['name'] for c in sa.inspect(bind).get_columns('project_document')}:
        op.add_column('project_document',sa.Column('current_version',sa.Integer(),nullable=False,server_default='1'))
    ProjectDocumentVersion.__table__.create(bind,checkfirst=True)

def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
