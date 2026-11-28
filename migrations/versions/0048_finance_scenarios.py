"""Independent project finance simulations; operational records stay untouched."""
from alembic import op
revision='0048'
down_revision='0047'
branch_labels=None
depends_on=None

def upgrade():
    from app import FinanceScenario
    FinanceScenario.__table__.create(op.get_bind(),checkfirst=True)

def downgrade():raise RuntimeError('Bitte ein geprüftes Projektbackup wiederherstellen.')
