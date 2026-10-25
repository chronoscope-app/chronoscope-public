"""Bounded attached-native MCP transport shared by local GUI checks."""
import json
import queue
import threading
import subprocess
import time


class NativeMcp:
    def __init__(self, binary, profile, output, ui=False):
        self.sequence = 0
        self.notifications = []
        self.messages = queue.Queue(maxsize=128)
        command = [str(binary), '--data-dir', str(profile)]
        subprocess.run([*command, 'agent', 'enable'], check=True, capture_output=True, timeout=10)
        deadline = time.monotonic() + 20
        while True:
            status = subprocess.run([*command, 'agent', 'status'], check=True, capture_output=True, text=True, timeout=5)
            if json.loads(status.stdout).get('connected'):
                break
            if time.monotonic() > deadline:
                raise TimeoutError('Disposable native app agent did not start')
            time.sleep(.2)
        self.stderr = (output/'mcp-stderr.log').open('w')
        self.process = subprocess.Popen([*command, 'mcp', '--attach'], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=self.stderr, text=True)
        def read():
            try:
                for line in self.process.stdout:
                    self.messages.put(json.loads(line), timeout=5)
            finally:
                self.messages.put(None, timeout=5)
        threading.Thread(target=read, daemon=True).start()
        capabilities = {'extensions': {'io.modelcontextprotocol/ui': {'mimeTypes': ['text/html;profile=mcp-app']}}} if ui else {}
        self.rpc('initialize', {'protocolVersion': '2025-11-25', 'capabilities': capabilities,
                               'clientInfo': {'name': 'chronoscope-native-qa', 'version': '1'}})

    def rpc(self, method, params):
        self.sequence += 1
        process = self.process
        process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': self.sequence, 'method': method, 'params': params})+'\n')
        process.stdin.flush()
        deadline = time.monotonic()+90
        while time.monotonic() < deadline:
            try:
                response = self.messages.get(timeout=max(.01, deadline-time.monotonic()))
            except queue.Empty:
                break
            if response is None:
                raise RuntimeError('Native MCP disconnected')
            if 'method' in response:
                self.notifications.append(response)
                self.notifications = self.notifications[-128:]
            if response.get('id') == self.sequence:
                if 'error' in response:
                    raise RuntimeError(response['error'])
                return response['result']
        raise TimeoutError(method)

    def call(self, name, arguments=None):
        result = self.rpc('tools/call', {'name': 'chronoscope_'+name, 'arguments': arguments or {}})
        if result.get('isError'):
            raise RuntimeError(result)
        value = result['structuredContent']
        return value['result'] if set(value) == {'result'} else value

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.stderr.close()
