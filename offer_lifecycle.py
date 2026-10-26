"""Add a persistent deletion guard without losing existing offer decisions."""
import json
from sqlalchemy import inspect,text


def ensure_offer_deletion_guard(connection):
    inspector=inspect(connection)
    if not inspector.has_table('offer'):return
    columns={c['name'] for c in inspector.get_columns('offer')}
    if 'deletion_locked' not in columns:
        connection.execute(text('ALTER TABLE offer ADD COLUMN deletion_locked BOOLEAN NOT NULL DEFAULT FALSE'))
    if 'status' in columns:
        connection.execute(text("UPDATE offer SET deletion_locked=TRUE WHERE status NOT IN ('Entwurf','Angebot')"))
    if 'current_version' in columns:
        connection.execute(text('UPDATE offer SET deletion_locked=TRUE WHERE current_version>1'))
    if inspector.has_table('order_acceptance'):
        connection.execute(text('UPDATE offer SET deletion_locked=TRUE WHERE id IN (SELECT offer_id FROM order_acceptance)'))
    if inspector.has_table('offer_version'):
        for row in connection.execute(text('SELECT offer_id,state,snapshot FROM offer_version')):
            try:status=json.loads(row.snapshot).get('status')
            except (TypeError,ValueError,AttributeError):status=None
            if row.state in ('historical','discarded') or status in ('Angenommen','Beauftragt','Abgelehnt'):
                connection.execute(text('UPDATE offer SET deletion_locked=TRUE WHERE id=:id'),{'id':row.offer_id})
