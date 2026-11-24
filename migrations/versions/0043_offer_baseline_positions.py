"""Every existing offer gets at least one position; totals and originals stay intact."""
from alembic import op
from offer_positions import backfill
revision='0043'
down_revision='0042'
branch_labels=None
depends_on=None

def upgrade():backfill(op.get_bind())

def downgrade():raise RuntimeError('Bitte ein geprüftes Projektbackup wiederherstellen.')
