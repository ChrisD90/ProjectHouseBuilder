"""Project registry, ownership of all records, and per-project business identifiers."""
from alembic import op
from project_schema import upgrade_project_schema
revision='0027'
down_revision='0026'
branch_labels=None
depends_on=None

def upgrade():
    upgrade_project_schema(op.get_bind())

def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
