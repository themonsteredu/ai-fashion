import http.server, functools, mimetypes, sys
mimetypes.add_type('text/javascript', '.mjs'); mimetypes.add_type('text/javascript', '.js'); mimetypes.add_type('application/wasm', '.wasm')
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=sys.argv[1])
class Q(H.func):
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', 8017), functools.partial(Q, directory=sys.argv[1])).serve_forever()
