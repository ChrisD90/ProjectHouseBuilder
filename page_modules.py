"""Explicit, local-only page entrypoints sharing one lexical scope per mount.

The Gantt companion scripts intentionally share app.js's bindings. Serving a
module factory keeps those bindings private and reusable without eval or global
script reinjection. Every external resource is owned by the supplied lifecycle.
"""
from pathlib import Path

PAGE_MODULES = {
    'zeitplan': ('app.js', 'task_completion.js', 'gantt_drag.js', 'initial_schedule.js', 'schedule_chat.js'),
    'kosten': ('costs.js',),
    'angebote': ('offers.js',),
    'belege': ('receipts.js', 'receipt_cancellations.js'),
    'finanzierung': ('finanzierung.js',),
    'energieplanung': ('energieplanung.js',),
    'stammdaten': ('stammdaten.js',),
    'dokumente': ('dokumente.js',),
    'daten': ('daten.js',),
}


def page_module(name):
    files = PAGE_MODULES.get(name)
    if files is None:
        return None
    root = Path(__file__).resolve().parent / 'static'
    bindings = ('URL,document,window,location,history,fetch,setTimeout,clearTimeout,'
                'setInterval,clearInterval,MutationObserver,PHBFlow,PHBUI')
    return ('export function mount(scope) {\n"use strict";\nconst {' + bindings + '} = scope;\n' +
            '\n;\n'.join((root / file).read_text(encoding='utf-8') for file in files) + '\n}\n')
