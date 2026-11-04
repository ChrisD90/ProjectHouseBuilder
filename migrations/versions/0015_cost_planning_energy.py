"""Cost-plan review drafts and linked energy funding; existing funding remains intact."""
from alembic import op
from app import CostPlanImport, FundingDetail

revision = '0015'
down_revision = '0014'
branch_labels = None
depends_on = None


def upgrade():
    CostPlanImport.__table__.create(bind=op.get_bind(), checkfirst=True)
    FundingDetail.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
