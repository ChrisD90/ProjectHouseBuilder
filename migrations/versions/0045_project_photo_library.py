"""Shared photo metadata and associations; preserve all existing image originals."""
from alembic import op
revision='0045'
down_revision='0044'
branch_labels=None
depends_on=None

def upgrade():
    from app import ProjectPhoto,PhotoTag,PhotoTagging,PhotoObjectLink
    from photos import backfill
    for model in (ProjectPhoto,PhotoTag,PhotoTagging,PhotoObjectLink):model.__table__.create(op.get_bind(),checkfirst=True)
    backfill(op.get_bind())

def downgrade():raise RuntimeError('Bitte ein geprüftes Projektbackup wiederherstellen.')
