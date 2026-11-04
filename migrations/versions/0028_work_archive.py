"""Archive todos and notes without changing completion or source links."""
from alembic import op
from project_work import ensure_work_archive_schema
revision = '0028'
down_revision = '0027'
branch_labels = None
depends_on = None


def upgrade():
    ensure_work_archive_schema(op.get_bind())


def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
