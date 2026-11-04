"""Backfill known decisions and retain deletion locks across repeated startup checks."""
import unittest
from sqlalchemy import create_engine,text
from offer_lifecycle import ensure_offer_deletion_guard


class OfferLifecycleMigrationTests(unittest.TestCase):
    def test_existing_decisions_and_versions_are_protected_without_locking_new_quotes(self):
        engine=create_engine('sqlite:///:memory:')
        with engine.begin() as connection:
            connection.execute(text('CREATE TABLE offer (id INTEGER PRIMARY KEY,status TEXT,current_version INTEGER)'))
            connection.execute(text('CREATE TABLE offer_version (offer_id INTEGER,state TEXT,snapshot TEXT)'))
            connection.execute(text('CREATE TABLE order_acceptance (offer_id INTEGER)'))
            for identifier,status,version in [(1,'Entwurf',1),(2,'Angebot',1),(3,'Abgelehnt',1),(4,'Angebot',2),(5,'Angebot',1),(6,'Angebot',1)]:
                connection.execute(text('INSERT INTO offer VALUES (:id,:status,:version)'),dict(id=identifier,status=status,version=version))
            connection.execute(text('INSERT INTO order_acceptance VALUES (5)'))
            connection.execute(text('INSERT INTO offer_version VALUES (6,\'current\',\'{"status":"Abgelehnt"}\')'))
            ensure_offer_deletion_guard(connection)
            self.assertEqual(dict(connection.execute(text('SELECT id,deletion_locked FROM offer')).all()),{1:0,2:0,3:1,4:1,5:1,6:1})
            connection.execute(text("UPDATE offer SET status='Angebot' WHERE id=3"))
            ensure_offer_deletion_guard(connection)
            self.assertEqual(connection.execute(text('SELECT deletion_locked FROM offer WHERE id=3')).scalar(),1)
        engine.dispose()
