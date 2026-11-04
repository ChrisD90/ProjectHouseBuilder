"""Project todos/notes, funding context/documents and acceptance reversal history."""
from alembic import op
from app import ProjectWork, FundingAssessment, FundingDocument, OfferAcceptanceReversal
revision = '0026'
down_revision = '0025'
branch_labels = None
depends_on = None

def upgrade():
    for model in (ProjectWork, FundingAssessment, FundingDocument, OfferAcceptanceReversal):
        model.__table__.create(bind=op.get_bind(), checkfirst=True)

def downgrade():
    raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
