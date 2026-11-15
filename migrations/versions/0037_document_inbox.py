"""Project-local watched folders and durable discovery/dispatch records."""
from alembic import op
revision='0037'
down_revision='0036'
branch_labels=None
depends_on=None

def upgrade():
    from app import DocumentInboxConfig,DocumentInboxItem
    for model in (DocumentInboxConfig,DocumentInboxItem):model.__table__.create(op.get_bind(),checkfirst=True)

def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
