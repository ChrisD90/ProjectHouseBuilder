"""Retain every offer revision while keeping a stable accepted offer and invoice link.

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade():
    bind=op.get_bind()
    inspector=sa.inspect(bind)
    if inspector.has_table('offer'):
        cols={c['name'] for c in inspector.get_columns('offer')}
        if 'current_version' not in cols:
            op.add_column('offer',sa.Column('current_version',sa.Integer(),nullable=False,server_default='1'))
    if not inspector.has_table('offer_version'):
        # Do not assume old installations have the complete current offer table;
        # baseline migration preserves very old, partial SQLite databases.
        op.create_table('offer_version',
            sa.Column('id',sa.Integer(),primary_key=True),
            sa.Column('offer_id',sa.Integer(),sa.ForeignKey('offer.id',ondelete='CASCADE'),nullable=False),
            sa.Column('version_number',sa.Integer(),nullable=False),
            sa.Column('state',sa.String(16),nullable=False,server_default='draft'),
            sa.Column('snapshot',sa.Text(),nullable=False),
            sa.Column('document_id',sa.Integer(),sa.ForeignKey('document.id'),nullable=True),
            sa.Column('created_at',sa.DateTime(),nullable=False),
            sa.UniqueConstraint('offer_id','version_number',name='uq_offer_version_number'))


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
