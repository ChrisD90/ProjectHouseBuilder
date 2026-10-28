"""Local-only Sign in with ChatGPT integration (OSS dynamic registration).

Never accepts an API key or client secret. Credentials are stored outside the
project/backup tree in owner-only local files. No implicit paid fallback.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import urlencode
from uuid import uuid4

import jwt
from jwt import PyJWKClient
import requests

AUTHORIZATION = 'https://auth.openai.com/api/accounts/authorize'
TOKEN = 'https://auth.openai.com/api/accounts/oauth/token'
JWKS = 'https://auth.openai.com/.well-known/jwks.json'
REVOCATION_CONFIG = 'https://auth.openai.com/.well-known/openid-configuration'
RESOURCE = 'https://api.openai.com/v1'
ISSUER = 'https://auth.openai.com'
USAGE_URL = 'https://chatgpt.com/#settings/usage'
REQUIRED_SCOPES = {'resource.invoke', 'chatgpt.tokens.use.direct'}
SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
MAX_STREAM_TEXT = 140_000
# Set only within one trusted background import worker thread.
_background_hooks=threading.local()

class AIError(Exception):
    """Safe, user-facing error from ChatGPT plan usage."""


class IdentityValidationError(AIError):
    """ID token was rejected; expose only a fixed diagnostic code, never JWT data."""

    def __init__(self, reason_code):
        self.reason_code = reason_code
        super().__init__('ChatGPT-Identität konnte nicht sicher bestätigt werden.')


class JWKSFetchError(jwt.PyJWKClientConnectionError):
    """Safe JWKS transport failure category (no URL, response or token details)."""

    def __init__(self, reason_code):
        self.reason_code = reason_code
        super().__init__('OpenAI-Signaturschlüssel konnten nicht geladen werden.')


class RequestsJWKClient(PyJWKClient):
    """Use the same TLS trust store and proxy handling as our OAuth token exchange.

    PyJWT normally fetches JWKS using urllib, while token exchange uses requests.
    The fixed, HTTPS JWKS endpoint remains mandatory. PyJWT still selects
    the signing key and verifies the JWT signature and all identity claims.
    """

    def fetch_data(self):
        if self.uri != JWKS:
            raise JWKSFetchError('jwks_endpoint_invalid')
        try:
            response = requests.get(
                self.uri, headers={'Accept': 'application/json'},
                timeout=15, allow_redirects=False)
        except requests.exceptions.SSLError:
            raise JWKSFetchError('jwks_tls_error') from None
        except requests.exceptions.Timeout:
            raise JWKSFetchError('jwks_timeout') from None
        except requests.exceptions.RequestException:
            raise JWKSFetchError('jwks_network_error') from None

        if response.status_code in (301, 302, 303, 307, 308):
            raise JWKSFetchError('jwks_unexpected_redirect')
        if response.status_code != 200:
            reason = ('jwks_http_403' if response.status_code == 403
                      else 'jwks_http_429' if response.status_code == 429
                      else 'jwks_http_error')
            raise JWKSFetchError(reason)
        if len(response.content) > 128 * 1024:
            raise JWKSFetchError('jwks_invalid_payload')
        try:
            data = response.json()
        except ValueError:
            raise JWKSFetchError('jwks_invalid_payload') from None
        if not isinstance(data, dict) or not isinstance(data.get('keys'), list):
            raise JWKSFetchError('jwks_invalid_payload')
        # Preserve PyJWT's expiring JWKS cache and refresh-on-unknown-kid behavior.
        if self.jwk_set_cache is not None:
            self.jwk_set_cache.put(data)
        return data


def _profile_home():
    # Not in a git checkout, uploaded documents or complete project backups.
    return Path(os.environ.get('PHB_CHATGPT_HOME') or
                (Path.home() / '.config' / 'ProjectHouseBuilder' / 'chatgpt')).expanduser().resolve()


def _ensure_home():
    root = _profile_home()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink():
        raise AIError('Zugangsdatenordner darf kein symbolischer Link sein.')
    os.chmod(root, 0o700)
    return root


def _write_secret(name, data):
    root = _ensure_home()
    dest = root / name
    tmp = root / ('.' + secrets.token_hex(10))
    try:
        fd = os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as file:
            json.dump(data, file, ensure_ascii=False)
            file.flush()
            os.fsync(file.fileno())
        os.replace(tmp, dest)
        os.chmod(dest, 0o600)
    finally:
        tmp.unlink(missing_ok=True)


def _read_secret(name):
    path = _profile_home() / name
    if not path.exists(): return None
    if path.is_symlink(): raise AIError('Unsicherer Zugangsdatenpfad.')
    with path.open('r', encoding='utf-8') as file:
        return json.load(file)


def _host_id():
    record = _read_secret('host.json')
    if record and str(record.get('host_id', '')).startswith('urn:uuid:'):
        return record['host_id']
    host = 'urn:uuid:' + str(uuid4())
    _write_secret('host.json', {'host_id': host})
    return host


def _urlsafe(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


class ChatGPTLocal:
    def __init__(self):
        self._pending = {}
        self._lock = threading.RLock()
        self._jwk = None

    def _profile(self):
        profile = _read_secret('profile.json')
        return profile if isinstance(profile, dict) else None

    def _usage(self, profile):
        empty={'available':False,'last_request':None,'cumulative_tokens':0,
               'rate_limits':{},'plan_remaining_available':False,
               'notice':'ChatGPT stellt der App kein gesamtes verbleibendes Plan-Kontingent bereit.'}
        if not profile:return empty
        record=_read_secret('usage.json')
        if not isinstance(record,dict) or record.get('subject')!=profile.get('subject'):
            return empty
        return {**empty,**{key:record.get(key,empty[key]) for key in empty}}

    @staticmethod
    def _rate_limit_headers(headers):
        result={}
        for output,name in (
            ('token_limit','x-ratelimit-limit-tokens'),
            ('token_remaining','x-ratelimit-remaining-tokens'),
            ('token_reset','x-ratelimit-reset-tokens'),
            ('request_limit','x-ratelimit-limit-requests'),
            ('request_remaining','x-ratelimit-remaining-requests'),
            ('request_reset','x-ratelimit-reset-requests')):
            try:value=headers.get(name) if headers is not None else None
            except Exception:value=None
            if isinstance(value,(str,int,float)) and str(value).strip():result[output]=str(value).strip()[:80]
        return result

    def _record_usage(self, model, usage, limits):
        profile=self._profile()
        if not profile or not profile.get('subject'):return
        previous=_read_secret('usage.json')
        if not isinstance(previous,dict) or previous.get('subject')!=profile['subject']:previous={}
        clean={}
        if isinstance(usage,dict):
            for key in ('input_tokens','output_tokens','total_tokens'):
                value=usage.get(key)
                if isinstance(value,int) and value>=0:clean[key]=value
        total=clean.get('total_tokens',clean.get('input_tokens',0)+clean.get('output_tokens',0))
        record={'subject':profile['subject'],'available':bool(clean or limits),
                'last_request':({'model':model,'at':int(time.time()),**clean} if clean else None),
                'cumulative_tokens':int(previous.get('cumulative_tokens',0) or 0)+total,
                'rate_limits':limits or previous.get('rate_limits',{}),
                'plan_remaining_available':False,
                'notice':'ChatGPT stellt der App kein gesamtes verbleibendes Plan-Kontingent bereit.'}
        _write_secret('usage.json',record)

    def status(self):
        record = self._profile()
        scopes = set(record.get('scopes', [])) if record else set()
        return {'connected': bool(record and record.get('refresh_token')),
                'sharing': bool(record and record.get('refresh_token') and REQUIRED_SCOPES <= scopes),
                'credits_acknowledged': bool(record and record.get('credits_acknowledged')),
                'email': record.get('email', '') if record else '',
                'usage_url': USAGE_URL,
                'usage':self._usage(record),
                'local_only': True, 'api_keys_supported': False,
                'credits_warning': 'Credits in ChatGPT Einstellungen → Nutzung für Apps deaktivieren. Die App kann dies nicht auslesen.'}

    def acknowledge_credits(self):
        """Store acknowledgement alongside this locally verified ChatGPT identity."""
        with self._lock:
            record=self._profile()
            if not record or not record.get('refresh_token') or not REQUIRED_SCOPES <= set(record.get('scopes', [])):
                raise AIError('Bitte zuerst erfolgreich bei ChatGPT anmelden.')
            if not record.get('credits_acknowledged'):
                record['credits_acknowledged']=True
                _write_secret('profile.json', record)
            return self.status()

    def begin(self, redirect_uri, browser_nonce):
        # Exact 127.0.0.1 loopback redirect is required by dynamic registration.
        if not redirect_uri.startswith('http://127.0.0.1:') or not redirect_uri.endswith('/auth/callback'):
            raise AIError('ChatGPT-Anmeldung ist nur über http://127.0.0.1:PORT/auth/callback möglich.')
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = _urlsafe(hashlib.sha256(verifier.encode('ascii')).digest())
        record = self._profile()
        client = record.get('client_id') if record else 'dynamic_agent_client'
        params = {'client_id': client, 'ext_agent_host_id': _host_id(),
                  'redirect_uri': redirect_uri, 'response_type': 'code', 'scope': SCOPES,
                  'resource': RESOURCE, 'state': state, 'nonce': nonce,
                  'code_challenge_method': 'S256', 'code_challenge': challenge}
        if client == 'dynamic_agent_client':
            params['agent_name_hint'] = 'ProjectHouseBuilder'
        else:
            if record.get('id_token'):params['id_token_hint'] = record['id_token']
            if record.get('email'):params['login_hint'] = record['email']
        with self._lock:
            self._pending = {state: {'nonce': nonce, 'verifier': verifier,
                                      'client_id': client, 'browser_nonce': browser_nonce,
                                      'redirect_uri': redirect_uri, 'started': time.monotonic()}}
        return AUTHORIZATION + '?' + urlencode(params)

    def finish(self, args, browser_nonce):
        state = args.get('state', '')
        with self._lock:
            txn = self._pending.pop(state, None)
        if not txn or time.monotonic() - txn['started'] > 600 or not secrets.compare_digest(txn['browser_nonce'], browser_nonce or ''):
            raise AIError('Anmeldung abgelaufen oder nicht verifiziert. Bitte erneut verbinden.')
        if args.get('error'):
            raise AIError('ChatGPT-Anmeldung wurde abgebrochen oder nicht erlaubt.')
        if not args.get('code'):
            raise AIError('ChatGPT hat keinen Anmeldecode zurückgegeben.')
        issued = args.get('client_id') or (txn['client_id'] if txn['client_id']!='dynamic_agent_client' else None)
        if not issued or not issued.startswith('oaiapp_'):
            raise AIError('Kein gültiger ChatGPT-Client für die Anmeldung zurückgegeben.')
        if txn['client_id'] != 'dynamic_agent_client' and txn['client_id'] != issued:
            raise AIError('Die ChatGPT-Registrierung stimmt nicht überein.')
        token = self._token_request({'grant_type': 'authorization_code', 'client_id': issued,
                                     'code': args['code'], 'code_verifier': txn['verifier'],
                                     'redirect_uri': txn['redirect_uri'], 'resource': RESOURCE})
        claims = self._verify_identity(token.get('id_token'), issued, txn['nonce'])
        old = self._profile()
        if old and old.get('client_id') == issued and old.get('subject') != claims['sub']:
            raise AIError('Die Anmeldung gehört nicht zum zuvor verbundenen ChatGPT-Konto.')
        if not token.get('access_token') or not token.get('refresh_token'):
            raise AIError('ChatGPT hat keine erneuerbaren Zugangsdaten geliefert.')
        stored = {'credits_acknowledged': bool(old and old.get('subject')==claims['sub'] and old.get('credits_acknowledged')),
                   'client_id': issued, 'host_id': _host_id(), 'subject': claims['sub'],
                  'email': claims.get('email', ''), 'id_token': token['id_token'],
                  'access_token': token['access_token'], 'refresh_token': token['refresh_token'],
                  'scopes': token.get('scope', '').split(),
                  'expires_at': time.time()+int(token.get('expires_in', 3600))}
        _write_secret('profile.json', stored)
        return self.status()

    def _verify_identity(self, raw, client_id, nonce):
        if not raw: raise AIError('ChatGPT hat kein Identitätstoken ausgestellt.')
        if self._jwk is None:
            self._jwk = RequestsJWKClient(JWKS, lifespan=300)
        try:
            # Never trust JWT headers or claims before cryptographic verification.
            key = self._jwk.get_signing_key_from_jwt(raw)
        except JWKSFetchError as exc:
            raise IdentityValidationError(exc.reason_code) from None
        except jwt.PyJWKClientConnectionError:
            raise IdentityValidationError('jwks_unavailable') from None
        except jwt.PyJWKClientError:
            raise IdentityValidationError('jwks_signing_key_missing') from None
        except (jwt.PyJWTError, ValueError, TypeError):
            raise IdentityValidationError('id_token_malformed') from None
        try:
            claims = jwt.decode(raw, key.key, algorithms=['RS256'],
                                audience=client_id, issuer=ISSUER, leeway=5,
                                options={'require': ['sub', 'exp', 'iat', 'iss', 'aud']})
        except jwt.ExpiredSignatureError:
            raise IdentityValidationError('id_token_expired') from None
        except (jwt.ImmatureSignatureError, jwt.InvalidIssuedAtError):
            raise IdentityValidationError('id_token_time_invalid') from None
        except jwt.InvalidAudienceError:
            raise IdentityValidationError('id_token_audience_mismatch') from None
        except jwt.InvalidIssuerError:
            raise IdentityValidationError('id_token_issuer_mismatch') from None
        except jwt.MissingRequiredClaimError:
            raise IdentityValidationError('id_token_claim_missing') from None
        except jwt.InvalidSignatureError:
            raise IdentityValidationError('id_token_signature_invalid') from None
        except jwt.InvalidAlgorithmError:
            raise IdentityValidationError('id_token_algorithm_invalid') from None
        except (jwt.PyJWTError, ValueError, TypeError):
            raise IdentityValidationError('id_token_invalid') from None
        if not isinstance(claims.get('sub'), str) or not claims['sub']:
            raise IdentityValidationError('id_token_subject_invalid')
        if not secrets.compare_digest(str(claims.get('nonce', '')), nonce):
            raise AIError('ChatGPT-Sicherheitsprüfung fehlgeschlagen (Nonce).')
        return claims

    def _token_request(self, form):
        try:
            r = requests.post(TOKEN, data=form, timeout=25)
            data = r.json()
        except (requests.RequestException, ValueError) as exc:
            raise AIError('ChatGPT-Anmeldedienst ist nicht erreichbar.') from exc
        if r.status_code != 200 or not isinstance(data, dict):
            code = data.get('error', 'OAuth-Fehler') if isinstance(data, dict) else 'OAuth-Fehler'
            raise AIError('ChatGPT-Zugriff fehlgeschlagen: ' + str(code)[:90])
        return data

    def token(self):
        with self._lock:
            p = self._profile()
            if not p or not p.get('refresh_token') or not REQUIRED_SCOPES <= set(p.get('scopes', [])):
                raise AIError('Bitte mit ChatGPT verbinden und die Nutzung deines Plans erlauben.')
            if float(p.get('expires_at', 0)) > time.time()+90:
                return p['access_token']
            try:
                updated = self._token_request({'grant_type':'refresh_token',
                    'client_id':p['client_id'], 'refresh_token':p['refresh_token'], 'resource':RESOURCE})
            except AIError:
                raise AIError('ChatGPT-Sitzung konnte nicht erneuert werden. Bitte erneut anmelden.')
            if not updated.get('refresh_token') or not updated.get('access_token'):
                raise AIError('ChatGPT-Erneuerung fehlgeschlagen; bitte neu anmelden.')
            p.update(access_token=updated['access_token'], refresh_token=updated['refresh_token'],
                     scopes=updated.get('scope','').split(),
                     expires_at=time.time()+int(updated.get('expires_in',3600)))
            if not REQUIRED_SCOPES <= set(p['scopes']):
                raise AIError('Die Berechtigung zur ChatGPT-Plannutzung fehlt.')
            _write_secret('profile.json', p)
            return p['access_token']

    def disconnect(self):
        with self._lock:
            p=self._profile()
            warning=''
            if p and p.get('refresh_token'):
                try:
                    info=requests.get(REVOCATION_CONFIG, timeout=12).json()
                    endpoint=info.get('revocation_endpoint')
                    if endpoint and endpoint.startswith('https://auth.openai.com/'):
                        result=requests.post(endpoint, data={'token':p['refresh_token'],
                            'token_type_hint':'refresh_token', 'client_id':p['client_id']},timeout=12)
                        if result.status_code!=200: warning='Remote-Widerruf nicht bestätigt. App zusätzlich in ChatGPT trennen.'
                    else:warning='Remote-Widerruf nicht verfügbar. App zusätzlich in ChatGPT trennen.'
                except (requests.RequestException,ValueError):
                    warning='Remote-Widerruf nicht bestätigt. App zusätzlich in ChatGPT trennen.'
            path=_profile_home()/'profile.json'
            path.unlink(missing_ok=True)
            return {'ok':True,'warning':warning}

    def models(self):
        try:
            res=requests.get(RESOURCE+'/models', headers={'Authorization':'Bearer '+self.token()},timeout=25)
            if res.status_code!=200:raise AIError('Verfügbare ChatGPT-Modelle konnten nicht abgerufen werden.')
            data=res.json()
            return [{'slug':x['slug'],'name':x.get('display_name',x['slug'])}
                    for x in data.get('models', []) if x.get('visibility')=='list' and isinstance(x.get('slug'),str)]
        except (requests.RequestException,ValueError,KeyError) as exc:
            raise AIError('ChatGPT-Modellliste nicht verfügbar.') from exc

    def run(self, input_data, instructions, model, *, web_search=False):
        if not isinstance(model,str) or not model or len(model)>100:
            raise AIError('Bitte ein verfügbares ChatGPT-Modell auswählen.')
        catalog=self.models()
        if model not in {x['slug'] for x in catalog}:
            raise AIError('Das gewählte Modell steht für dieses Konto nicht zur Verfügung.')
        # ChatGPT plan-sharing requires Responses.input to be an array, even
        # when the context is a single text prompt. Keep multimodal items intact.
        if isinstance(input_data, str):
            input_items=[{'role':'user','content':input_data}]
        elif isinstance(input_data, list) and input_data:
            input_items=input_data
        else:
            raise AIError('KI-Eingabe muss aus Text oder einer nichtleeren Nachrichtenliste bestehen.')
        payload={'model':model,'input':input_items,'instructions':instructions,
                 'store':False,'stream':True}
        if web_search:
            payload['tools']=[{'type':'web_search'}]
            payload['tool_choice']='required'
        output=[];total=0;complete=False;first_delta=False;searched=False;usage={};limits={}
        progress=getattr(_background_hooks,'progress',None)
        def phase(message):
            if callable(progress):
                try:progress(message)
                except Exception:pass  # UI status must never break the actual AI request.
        phase('Verbindung zu ChatGPT wird aufgebaut …')
        try:
            with requests.post(RESOURCE+'/responses', json=payload,headers={
                'Authorization':'Bearer '+self.token(), 'Content-Type':'application/json',
                'Accept':'text/event-stream'}, stream=True,timeout=(20,145)) as response:
                if response.status_code!=200:
                    if web_search:
                        raise AIError('ChatGPT-Webrecherche ist für dieses Konto oder Modell derzeit nicht verfügbar. Bitte ein anderes verfügbares Modell wählen oder Firmendaten manuell ergänzen.')
                    try:detail=response.json()
                    except ValueError:detail={}
                    err=detail.get('error',detail) if isinstance(detail,dict) else {}
                    code=err.get('code',err.get('detail','ChatGPT nicht verfügbar')) if isinstance(err,dict) else 'ChatGPT nicht verfügbar'
                    raise AIError('ChatGPT-Anfrage abgelehnt: '+str(code)[:150])
                limits=self._rate_limit_headers(getattr(response,'headers',None))
                phase('ChatGPT prüft die hochgeladene Datei …')
                for raw in response.iter_lines(decode_unicode=True):
                    if isinstance(raw,bytes):raw=raw.decode('utf-8','replace')
                    if not raw or not raw.startswith('data: '):continue
                    try:event=json.loads(raw[6:])
                    except ValueError:continue
                    typ=event.get('type')
                    if typ=='response.output_item.done' and event.get('item',{}).get('type')=='web_search_call':
                        searched=searched or event['item'].get('status')=='completed'
                    if typ=='response.output_text.delta':
                        if not first_delta:
                            first_delta=True
                            phase('ChatGPT liefert die Auswertung – Daten werden empfangen …')
                        delta=event.get('delta','')
                        total+=len(delta)
                        if total>MAX_STREAM_TEXT:raise AIError('Antwort überschreitet die maximale Länge.')
                        output.append(delta)
                    elif typ=='response.completed':
                        complete=True
                        if isinstance(event.get('response',{}).get('usage'),dict):
                            usage=event['response']['usage']
                        searched=searched or any(x.get('type')=='web_search_call' and x.get('status')=='completed' for x in event.get('response',{}).get('output',[]))
                        phase('ChatGPT-Antwort vollständig – der Entwurf wird angelegt …')
                    elif typ in ('response.failed','error','response.incomplete'):
                        detail=event.get('response',{}).get('error') or event.get('error') or {}
                        code=detail.get('code','Anfrage fehlgeschlagen') if isinstance(detail,dict) else 'Anfrage fehlgeschlagen'
                        raise AIError('KI-Anfrage nicht abgeschlossen: '+str(code)[:130])
        except requests.RequestException as exc:
            raise AIError('ChatGPT-Verbindung unterbrochen. Es wurden keine Projektdaten verändert.') from exc
        if not complete:raise AIError('ChatGPT-Antwort unvollständig. Es wurden keine Projektdaten verändert.')
        if web_search and not searched:
            raise AIError('ChatGPT hat keine abgeschlossene Webrecherche bestätigt. Es wurden keine Firmendaten übernommen.')
        result=''.join(output).strip()
        if not result:raise AIError('ChatGPT hat keine auswertbare Antwort zurückgegeben.')
        self._record_usage(model,usage,limits)
        return result


chatgpt = ChatGPTLocal()


def extract_json(text):
    result=text.strip()
    if result.startswith('```'):
        result=result.split('\n',1)[-1].rsplit('```',1)[0].strip()
    try:return json.loads(result)
    except ValueError as exc:raise AIError('KI hat kein gültiges JSON geliefert. Bitte erneut versuchen oder lokal auswerten.') from exc
