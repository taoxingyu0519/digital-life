"""Host-only DPAPI boundary. Payloads use stdin/stdout, never process arguments or logs."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'airi/services/local-vision'))
from identity import protect

if len(sys.argv) != 2 or sys.argv[1] not in ('encrypt', 'decrypt'):
    raise SystemExit(2)
try:
    sys.stdout.buffer.write(protect(sys.stdin.buffer.read(), sys.argv[1] == 'decrypt'))
except Exception:
    sys.stderr.write('Shared settings secret store unavailable.\n')
    raise SystemExit(1)
