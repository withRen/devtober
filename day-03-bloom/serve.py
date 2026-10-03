#!/usr/bin/env python3
"""Serveur local pour le jour 03.

Le décodeur RAW (LibRaw en WebAssembly) tourne sur plusieurs threads,
ce qui demande SharedArrayBuffer, donc une page « isolée » :
les en-têtes COOP et COEP ci-dessous. Le serveur sert la racine du dépôt
pour que le lien de retour vers le calendrier fonctionne.

    python3 day-03-bloom/serve.py      puis http://localhost:8766/day-03-bloom/
"""
import http.server
import os
import socketserver

PORT = int(os.environ.get("PORT", 8766))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".wasm": "application/wasm", ".js": "text/javascript"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    # La page charge une dizaine de modules d'un coup : la file par défaut (5) en refuserait.
    request_queue_size = 64


with Server(("", PORT), Handler) as httpd:
    print(f"http://localhost:{PORT}/day-03-bloom/")
    httpd.serve_forever()
