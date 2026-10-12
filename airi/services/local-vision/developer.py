"""Local developer sessions protect maintenance APIs, separate from social identity."""
import hashlib
import json
import secrets
import time

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse

from identity import People
from registry import DATA


class Login(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


class TextEdit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str = Field(min_length=1, max_length=2000)


class NameEdit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=64)


class DeveloperAccess:
    # Sessions live only in this process. A service restart requires another login.
    def __init__(self, path):
        self.path = path
        self.sessions = {}
        self.failures = []

    def status(self, request):
        now = time.time()
        self.sessions = {token: at for token, at in self.sessions.items() if at > now}
        expiry = self.sessions.get(request.cookies.get('airi_developer', ''), 0)
        return dict(authenticated=expiry > now, expires_at=expiry)

    def configure(self, username, password):
        if not username.strip() or len(username) > 128 or not password or len(password) > 256:
            raise ValueError('invalid-credentials')
        salt = secrets.token_bytes(32)
        config = dict(username=username.strip(), salt=salt.hex(), hash=hashlib.scrypt(
            password.encode(), salt=salt, n=16384, r=8, p=1).hex())
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(config), encoding='utf-8')
        temporary.replace(self.path)
        self.sessions.clear()

    def require(self, request):
        if not self.status(request)['authenticated']:
            raise HTTPException(403, 'developer-required')

    def login(self, value):
        now = time.time()
        self.failures = [at for at in self.failures if now - at < 60]
        if len(self.failures) >= 5:
            raise HTTPException(429, 'login-rate-limit')
        if not self.path.exists():
            raise HTTPException(503, 'developer-not-configured')
        config = json.loads(self.path.read_text(encoding='utf-8'))
        digest = hashlib.scrypt(value.password.encode(), salt=bytes.fromhex(config['salt']), n=16384, r=8, p=1).hex()
        if not secrets.compare_digest(value.username.encode(), config['username'].encode()) or not secrets.compare_digest(digest, config['hash']):
            self.failures.append(now)
            raise HTTPException(401, 'invalid-login')
        token = secrets.token_urlsafe(48)
        # Bound abandoned browser sessions without extending their fixed one-hour expiry.
        self.sessions = {key: at for key, at in self.sessions.items() if at > now}
        if len(self.sessions) >= 16:
            del self.sessions[next(iter(self.sessions))]
        expiry = now + 3600
        self.sessions[token] = expiry
        response = JSONResponse(dict(authenticated=True, expires_at=expiry))
        response.set_cookie('airi_developer', token, max_age=3600, httponly=True, samesite='strict', path='/api/local-vision')
        return response


access = DeveloperAccess(DATA / 'developer-auth.json')


def register_routes(app, state):
    def people():
        return state.runtime.people if state.runtime else People(DATA, 'maintenance')

    async def mutate(request, function, *args):
        # Invalidate current projections before changing shared personal data.
        if state.source:
            state.source['privacy_generation'] += 1
        state.snapshot = None
        def apply():
            access.require(request)
            result = function(*args)
            if state.runtime:
                state.runtime.reset()
            return result
        try:
            return await state.worker(apply)
        except ValueError as error:
            raise HTTPException(404, str(error)) from None

    @app.get('/developer/session')
    async def session(request: Request):
        return access.status(request)

    @app.post('/developer/session')
    async def login(value: Login):
        return await state.worker(access.login, value)

    @app.delete('/developer/session')
    async def logout(request: Request):
        access.sessions.pop(request.cookies.get('airi_developer', ''), None)
        response = JSONResponse(dict(authenticated=False, expires_at=0))
        response.delete_cookie('airi_developer', path='/api/local-vision', httponly=True, samesite='strict')
        return response

    @app.get('/admin/overview')
    async def overview(request: Request):
        access.require(request)
        def read():
            access.require(request)
            return people().overview()
        return await state.worker(read)

    @app.get('/admin/persons/{person}')
    async def profile(person: str, request: Request, character: str = 'default'):
        access.require(request)
        if len(character) > 200:
            raise HTTPException(400, 'invalid-character')
        def read():
            access.require(request)
            repository = people()
            result = repository.profile(person, character)
            if result is None:
                raise HTTPException(404, 'person-missing')
            return dict(profile=result, memories=repository.memory_records(person, character),
                        face_extensions=repository.extension_records(person))
        return await state.worker(read)

    @app.patch('/admin/persons/{person}')
    async def rename(person: str, value: NameEdit, request: Request):
        access.require(request)
        await mutate(request, people().rename, person, value.name)
        return {'saved': True}

    @app.delete('/admin/persons/{person}')
    async def delete(person: str, request: Request):
        access.require(request)
        await mutate(request, people().delete, person)
        return {'deleted': True}

    @app.delete('/admin/persons/{person}/face-extensions/{round_id}')
    async def revoke_extensions(person: str, round_id: str, request: Request):
        access.require(request)
        await mutate(request, people().revoke_extensions, person, round_id)
        return {'deleted': True}

    @app.patch('/admin/persons/{person}/memories/{event:path}')
    async def edit_memory(person: str, event: str, value: TextEdit, request: Request, character: str):
        access.require(request)
        await mutate(request, people().edit_memory, person, character, event, value.text)
        return {'saved': True}

    @app.delete('/admin/persons/{person}/memories/{event:path}')
    async def delete_memory(person: str, event: str, request: Request, character: str):
        access.require(request)
        await mutate(request, people().edit_memory, person, character, event)
        return {'deleted': True}

    @app.patch('/admin/rules/{rule}')
    async def edit_rule(rule: str, value: TextEdit, request: Request):
        access.require(request)
        await mutate(request, people().update_rule, rule, value.text)
        return {'saved': True}


if __name__ == '__main__':
    import argparse
    import getpass

    parser = argparse.ArgumentParser(description='配置本机开发者密码摘要，不修改 hosted 账号。')
    parser.add_argument('--username', required=True)
    arguments = parser.parse_args()
    password = getpass.getpass('开发者密码: ')
    if password != getpass.getpass('再次输入密码: '):
        raise SystemExit('两次密码不一致，未修改配置。')
    access.configure(arguments.username, password)
    print('本机密码摘要已保存。请重启视觉服务以撤销运行中的旧会话。')
