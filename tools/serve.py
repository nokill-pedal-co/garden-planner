"""Dev server: static files from v2/ with caching disabled (ES modules otherwise go stale).
Usage: python tools/serve.py [port]"""
import http.server
import pathlib
import socket
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class NoCache(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


http.server.SimpleHTTPRequestHandler.extensions_map[".js"] = "text/javascript"
http.server.SimpleHTTPRequestHandler.extensions_map[".webmanifest"] = "application/manifest+json"

class DualStack(http.server.ThreadingHTTPServer):
    # Listen on ::1 and 127.0.0.1 so "localhost" doesn't stall on an IPv6 miss first.
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    DualStack(("::", port), NoCache).serve_forever()
