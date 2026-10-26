"""Persist offer lifecycle decisions to protect them from permanent deletion."""
from alembic import op
from offer_lifecycle import ensure_offer_deletion_guard
revision='0017'
down_revision='0016'
branch_labels=None
depends_on=None


def upgrade():
    ensure_offer_deletion_guard(op.get_bind())


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
