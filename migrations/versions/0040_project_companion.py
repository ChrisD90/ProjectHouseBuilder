"""Project companion: local documentation, calendar planning and payment terms."""
from alembic import op
revision='0040'
down_revision='0039'
branch_labels=None
depends_on=None

def upgrade():
    from app import CompanionRecord,CalendarPreferences,WorkRecurrence,ReceiptTerms
    for model in (CompanionRecord,CalendarPreferences,WorkRecurrence,ReceiptTerms):model.__table__.create(op.get_bind(),checkfirst=True)

def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
