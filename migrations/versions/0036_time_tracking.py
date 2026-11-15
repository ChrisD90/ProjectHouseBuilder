"""Project-owned people, company time sheets and minute-accurate entries."""
from alembic import op
revision='0036'
down_revision='0035'
branch_labels=None
depends_on=None

def upgrade():
    from app import TimePerson, TimeEntry
    for model in (TimePerson, TimeEntry):
        model.__table__.create(op.get_bind(), checkfirst=True)

def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
