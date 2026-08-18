#!/usr/bin/env python3
"""Static dev server for local work.

Identical to `python -m http.server` except that it sends `Cache-Control:
no-store`. Browsers cache ES modules aggressively, so without this an edit to a
file under js/ can keep running the previous version after a reload — which
looks exactly like a code bug.
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    http.server.test(HandlerClass=NoCacheHandler, port=port, bind="127.0.0.1")
