"""Add independent project appointments without changing phases or work packages."""
from alembic import op
revision = '0038'
down_revision = '0037'
branch_labels = None
depends_on = None


def upgrade():
    from app import CalendarEvent, CalendarEventTrade
    for model in (CalendarEvent, CalendarEventTrade):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
