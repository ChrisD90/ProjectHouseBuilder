"""Deterministic ChatGPT fixture, installed only by the disposable browser runner."""
import json
from flask import request, jsonify

def install(b):
    state={'sharing':False,'calls':0}
    b.chatgpt.status=lambda:dict(sharing=state['sharing'],connected=state['sharing'],credits_acknowledged=True)
    b.chatgpt.models=lambda:[dict(slug='fixture-model',title='Testmodell',description='Für kurze Listen und schnelle Antworten.'),dict(slug='fixture-model-2',title='Testmodell 2',description='Für komplexe Planung mit ausführlichen Antworten.',context_window=128000)]
    def run(prompt,instruction,model='',**kwargs):
        state['calls']+=1;state['last_model']=model;payload=json.loads(prompt)
        if '{answer:string' in instruction:
            ready='20' in payload['conversation'][-1]['content']
            return json.dumps(dict(answer='Damit können wir planen.' if ready else 'Für eine passende Materialmenge fehlt die Fläche.',questions=[] if ready else ['Wie groß ist die zu streichende Fläche?'],ready=ready))
        return json.dumps(dict(summary='Abkleben und den Raum streichen.',assumptions=['Fest haftender Putz; Materialbedarf vor Ort prüfen.'],steps=[dict(title='Flächen vorbereiten',notes='Untergrund prüfen und abkleben.'),dict(title='Wände streichen',notes='Herstellerangaben und Trocknung beachten.')],materials=[dict(title='Wandfarbe',quantity=5,unit='l',unit_price=None,notes='Mengenansatz für 20 m²; Ergiebigkeit prüfen.')],tools=[dict(title='Farbrolle',source='Noch offen',cost=None,notes='Für den Untergrund passende Rolle auswählen.')]))
    b.chatgpt.run=run
    @b.app.post('/__fixture/self-work/connection')
    def connection():
        state['sharing']=request.get_json()['sharing'];return jsonify(ok=True)
    @b.app.get('/__fixture/self-work/state')
    def current():return jsonify(state)
