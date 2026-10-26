"""Retain invoice reversal snapshots without changing existing invoices or payments."""
from alembic import op
from app import ReceiptCancellation
revision='0016'
down_revision='0015'
branch_labels=None
depends_on=None


def upgrade():
    ReceiptCancellation.__table__.create(bind=op.get_bind(),checkfirst=True)


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
