"""Company assignments and derived daily calendar time entries (additive)."""
from alembic import op
revision = '0039'
down_revision = '0038'
branch_labels = None
depends_on = None


def upgrade():
    from app import CalendarEventCompany, CalendarCompanyTime
    for model in (CalendarEventCompany, CalendarCompanyTime):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
