"""Export the FastAPI contract without starting a server."""

import json
import sys
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.main import create_app  # noqa: E402

target = ROOT / "docs" / "generated" / "openapi.json"
parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
arguments = parser.parse_args()
schema = create_app().openapi()
if arguments.check:
    if not target.exists() or json.loads(target.read_text()) != schema:
        sys.exit("OpenAPI is stale. Run cd frontend && npm run generate:api.")
    print("OpenAPI matches FastAPI models")
    sys.exit(0)
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n")
print(target.relative_to(ROOT))
