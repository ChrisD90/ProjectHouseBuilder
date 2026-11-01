"""Persistent funding planning, offer selection and explicit adoption reports."""
from alembic import op
from app import FundingPlan, FundingPlanOffer
revision='0029'
down_revision='0028'
branch_labels=None
depends_on=None


def upgrade():
    for model in (FundingPlan,FundingPlanOffer):
        model.__table__.create(bind=op.get_bind(),checkfirst=True)


def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
