"""Extract only the printed invoice number from each public FATURA NUMBER label."""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NUMBER = re.compile(r"invoice\s*(?:number|id|#)\s*([A-Za-z0-9/-]+)", re.I)


def build_references(rows, folder):
    references = {}
    for row in rows:
        name = row["evidence"]["document"]
        fields = json.loads((folder / "annotations" / (name + ".json")).read_bytes())
        number = fields.get("NUMBER")
        if isinstance(number, dict):
            match = NUMBER.fullmatch(number.get("text", "").strip())
            if match:
                references[name] = match[1]
    # Kaggle shipments have no invoice number; persist the coursework declaration
    # field during preparation so runtime matching can use the submitted field alone.
    for row in rows:
        row["invoiceRef"] = references.get(row["evidence"]["document"], "")
    (ROOT / "data/shipments.json").write_text(json.dumps(rows, separators=(",", ":")) + "\n")
    (ROOT / "data/invoice-references.json").write_text(json.dumps(references, sort_keys=True, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    cli = argparse.ArgumentParser()
    cli.add_argument("fatura_folder", type=Path)
    args = cli.parse_args()
    build_references(json.loads((ROOT / "data/shipments.json").read_text()), args.fatura_folder)
