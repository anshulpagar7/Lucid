"""Recording schema, generated from the TypeScript source (npm run schema)."""
import json
from pathlib import Path

_S = json.loads((Path(__file__).resolve().parent.parent / "schema.json").read_text())
LABEL_COLUMNS: list[str] = _S["label_columns"]
COLUMNS: list[str] = _S["columns"]
BLENDSHAPES: list[str] = _S["blendshapes"]
