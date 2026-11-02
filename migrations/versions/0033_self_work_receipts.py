"""Project-owned receipt links for DIY planning."""
from alembic import op
revision='0033'
down_revision='0032'
branch_labels=None
depends_on=None

def upgrade():
    from app import SelfWorkReceipt
    SelfWorkReceipt.__table__.create(op.get_bind(),checkfirst=True)

def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
