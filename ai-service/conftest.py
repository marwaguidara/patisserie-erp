import os
import sys

# Allow `pytest ai-service/` (launched from the repository root) to resolve the
# `app` package, which lives under ai-service/. This mirrors the sys.path shim
# that some test modules inline today; centralised here so every test module
# collects cleanly without per-file hacks.
_AI_SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
if _AI_SERVICE_DIR not in sys.path:
    sys.path.insert(0, _AI_SERVICE_DIR)
