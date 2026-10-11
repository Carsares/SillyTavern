#!/usr/bin/env python3
"""Validate a full-app container with additive Agent, using only owned temporary data.
Build/network access is explicit when this script is invoked; no model calls.
"""
import base64
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import tempfile
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DOCKER = ['docker', '--context', 'desktop-linux']
TAG = 'sillytavern-agent-validation:local'


def docker(*args, env=None):
    result = subprocess.run(DOCKER + list(args), cwd=ROOT, env=env,
                            text=True, capture_output=True)
    if result.returncode:
        # Environment values, container inspection and authentication stay private.
        raise RuntimeError('Docker operation failed: ' + args[0])
    return result.stdout.strip()


def main():
    build = subprocess.run(DOCKER + ['build', '--tag', TAG, '.'], cwd=ROOT)
    if build.returncode:
        return build.returncode
    password = secrets.token_urlsafe(48)
    environment = dict(os.environ)
    authorization = 'Basic ' + base64.b64encode(('validation:' + password).encode()).decode()
    owned_containers, owned_volumes = [], []
    suffix = secrets.token_hex(10)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(port, path, body=None, token=None, authenticated=True):
        headers = {'Authorization': authorization} if authenticated else {}
        if token:
            headers['X-CSRF-Token'] = token
        if body is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request('http://127.0.0.1:' + str(port) + path,
                                     data=None if body is None else json.dumps(body).encode(), headers=headers)
        try:
            with opener.open(req, timeout=5) as response:
                data = response.read()
                return response.status, data
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def start(number):
        name = 'conversation-validation-' + suffix + '-' + str(number)
        volume = name + '-data'
        docker('volume', 'create', '--label', 'conversation.validation=' + suffix, volume)
        owned_volumes.append(volume)
        # Reserve an unpredictable name; cleanup targets only this invocation.
        docker('create', '--name', name, '--label', 'conversation.validation=' + suffix,
               '--mount', 'type=volume,src=' + volume + ',dst=/home/node/app/data',
               '-p', '127.0.0.1::8000', TAG, env=environment)
        owned_containers.append(name)
        # JSON is valid YAML. These credentials belong only to this new test container.
        # No existing user config is read or rewritten.
        with tempfile.TemporaryDirectory(prefix='agent-container-config-') as directory:
            config = Path(directory) / 'config.yaml'
            config.write_text(json.dumps({
                'listen': True, 'port': 8000, 'dataRoot': './data',
                'browserLaunch': {'enabled': False}, 'whitelistMode': False,
                'basicAuthMode': True, 'basicAuthUser': {'username': 'validation', 'password': password},
                'enableUserAccounts': False,
            }))
            config.chmod(0o600)
            docker('cp', str(config), name + ':/home/node/app/config/config.yaml')
        docker('start', name)
        state = json.loads(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', name))
        binding = state['8000/tcp'][0]
        assert binding['HostIp'] == '127.0.0.1'
        port = int(binding['HostPort'])
        for _ in range(45):
            try:
                status, body = request(port, '/modern/')
                if status == 200 and b'<html' in body.lower():
                    break
            except (OSError, ValueError):
                pass
            time.sleep(1)
        else:
            raise RuntimeError('Container health deadline exceeded')
        assert request(port, '/api/conversation/v1/conversations', authenticated=False)[0] == 401
        assert request(port, '/')[0] == 200  # follows the original Modern entry redirect
        status, html = request(port, '/modern/')
        assert status == 200 and b'<html' in html.lower()
        docker('exec', name, 'node', 'src/healthcheck.js')
        assert request(port, '/api/conversation/v1/conversations', {'schemaVersion': 1})[0] == 403
        token = json.loads(request(port, '/csrf-token')[1])['token']
        print('PASS entry/auth/health: container', number, '127.0.0.1:' + str(port), flush=True)
        return name, port, token

    api = '/api/conversation/v1'
    try:
        name, port, token = start(1)
        assert json.loads(request(port, api + '/conversations')[1]) == []
        assert request(port, api + '/conversations', {'schemaVersion': 1, 'title': 'isolated validation'}, token)[0] == 201
        status, body = request(port, api + '/maintenance/backup', {'schemaVersion': 1}, token)
        assert status == 200
        backup = json.loads(body)
        assert backup['format'] == 'conversation-v1-backup'
        assert backup['credentialsIncluded'] is False and backup['files'] == []
        assert len(backup['repository']['conversations']) == 1
        _, target_port, target_token = start(2)
        assert request(target_port, api + '/maintenance/restore', {'schemaVersion': 1, 'backup': backup}, target_token)[0] == 200
        restored = json.loads(request(target_port, api + '/conversations')[1])
        assert len(restored) == 1 and restored[0]['title'] == 'isolated validation'
        print('PASS backup export/restore into second independent volume; no provider calls', flush=True)
    finally:
        errors = []
        for name in reversed(owned_containers):
            try:
                docker('rm', '-f', name)
                assert name not in docker('ps', '-a', '--format', '{{.Names}}').splitlines()
            except Exception:
                errors.append(name)
        for volume in reversed(owned_volumes):
            try:
                docker('volume', 'rm', volume)
                assert volume not in docker('volume', 'ls', '--format', '{{.Name}}').splitlines()
            except Exception:
                errors.append(volume)
        if errors:
            raise RuntimeError('Cleanup requires attention: ' + ', '.join(errors))
        print('PASS owned containers/volumes removed; local image retained', flush=True)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(type(error).__name__ + ': ' + str(error))
        raise SystemExit(1)
