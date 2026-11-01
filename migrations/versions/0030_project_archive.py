"""Archive projects without changing their data or reusing deleted project IDs."""
from alembic import op
from project_lifecycle import ensure_project_lifecycle_schema
revision='0030'
down_revision='0029'
branch_labels=None
depends_on=None


def upgrade():
    ensure_project_lifecycle_schema(op.get_bind())


def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
