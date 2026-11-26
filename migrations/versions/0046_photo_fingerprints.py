"""Remember source bytes across optional photo compression; preserve originals."""
from alembic import op
revision='0046'
down_revision='0045'
branch_labels=None
depends_on=None

def upgrade():
    from app import PhotoFingerprint
    PhotoFingerprint.__table__.create(op.get_bind(),checkfirst=True)

def downgrade():raise RuntimeError('Bitte ein geprüftes Projektbackup wiederherstellen.')
