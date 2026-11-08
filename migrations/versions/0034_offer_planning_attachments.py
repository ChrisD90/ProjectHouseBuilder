"""Non-binding DIY position scenarios and additional quote attachments."""
from alembic import op
import sqlalchemy as sa
revision='0034'
down_revision='0033'
branch_labels=None
depends_on=None

def upgrade():
    bind=op.get_bind()
    if 'own_work' not in {c['name'] for c in sa.inspect(bind).get_columns('offer_position')}:
        op.add_column('offer_position',sa.Column('own_work',sa.Boolean(),nullable=False,server_default=sa.false()))
    if 'offer_id' not in {c['name'] for c in sa.inspect(bind).get_columns('document')}:
        with op.batch_alter_table('document') as batch:
            batch.add_column(sa.Column('offer_id',sa.Integer(),nullable=True))
            batch.create_foreign_key('fk_document_offer_id_offer','offer',['offer_id'],['id'])
            batch.create_index('ix_document_offer_id',['offer_id'])

def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
