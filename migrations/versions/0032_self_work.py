"""Independent project-owned DIY plans; no changes to existing business rows."""
from alembic import op
revision='0032'
down_revision='0031'
branch_labels=None
depends_on=None

def upgrade():
    from app import SelfWorkPlan
    SelfWorkPlan.__table__.create(op.get_bind(),checkfirst=True)

def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
