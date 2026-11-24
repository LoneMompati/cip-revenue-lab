"""Build the public demonstration from a Kaggle shipment ZIP and extracted FATURA v1."""
from invoice_references import build_references
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import tempfile
import csv
import hashlib
import io
import json
import re
import subprocess
import zipfile
from decimal import Decimal
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
AMOUNT = re.compile(r'(?<![\d.])(\d[\d,]*\.\d{2})\s*(USD|EUR)\b', re.I)
CSV_SHA = "276c4d04f905254dc4a40bb0779398fdc1a60c08ee3f151bd781d721d61c3271"

def rank(key):
    return hashlib.sha256(key.encode()).hexdigest()

def cents(value):
    return int(Decimal(value.replace(",", "")) * 100)

def shipments(path):
    with zipfile.ZipFile(path) as archive:
        raw = archive.read("trade_customs_dataset.csv")
    if hashlib.sha256(raw).hexdigest() != CSV_SHA:
        raise ValueError("Shipment release differs from the coursework source.")
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    selected = sorted(rows, key=lambda r: rank("3009:" + r["Shipment_ID"]))[:6000]
    return [dict(id=r["Shipment_ID"], commodity=r["Commodity_Type"],
                 declared=cents(r["Declared_Value_USD"])) for r in selected]

def invoice_candidates(folder):
    groups = {"higher": [], "lower": [], "eur": []}
    for filename in sorted((folder / "annotations").glob("*.json")):
        total = json.loads(filename.read_text()).get("TOTAL")
        if not isinstance(total, dict):
            continue
        match = AMOUNT.search(total.get("text", ""))
        if not match or not total.get("bbox"):
            continue
        amount, currency = cents(match[1]), match[2].upper()
        category = "eur" if currency == "EUR" else "higher" if amount >= 130000 else "lower"
        groups[category].append((filename.stem, amount, currency, total["bbox"]))
    result = []
    for category, count in [("higher", 36), ("lower", 8), ("eur", 4)]:
        result.extend(sorted(groups[category], key=lambda r: rank(r[0]))[:count])
    if len(result) != 48:
        raise ValueError("Expected 48 invoice records from FATURA version 1.")
    return result

def read_evidence(folder, name, box, expected_amount, expected_currency):
    with Image.open(folder / "images" / (name + ".jpg")) as page:
        x1, x2 = sorted([box[0][0], box[1][0]])
        y1, y2 = sorted([box[0][1], box[1][1]])
        w, h = page.size
        # FATURA annotations use PDF coordinates measured from the bottom of the page.
        crop = page.crop((max(0, int(x1)-2), max(0, h-int(y2)-3),
                          min(w, int(x2)+4), min(h, h-int(y1)+4)))
        # Make a public page attachment using only non-identity invoice fields.
        # Keep their original positions. All other pixels default to white.
        annotation = json.loads((folder / "annotations" / (name + ".json")).read_text())
        preview = Image.new("RGB", page.size, "white")
        for key in ("TITLE", "DATE", "NUMBER", "TAX", "TOTAL"):
            field = annotation.get(key)
            if not isinstance(field, dict) or not field.get("bbox"):
                continue
            a, b = field["bbox"]
            left, right = sorted((int(a[0]), int(b[0])))
            low, high = sorted((int(a[1]), int(b[1])))
            rect = (max(0,left-1), max(0,h-high-1), min(w,right+2), min(h,h-low+2))
            if rect[2] > rect[0] and rect[3] > rect[1]:
                preview.paste(page.crop(rect), rect[:2])
        ImageDraw.Draw(preview).text((12,h-14), "FATURA | Public extract: other fields omitted", fill="black")
        preview.save(ROOT / "public/evidence" / (name + "-page.png"))
        crop = ImageOps.grayscale(crop).resize((crop.width*4, crop.height*4), Image.Resampling.LANCZOS)
    path = ROOT / "public/evidence" / (name + ".png")
    crop.save(path)
    result = subprocess.run(["tesseract", str(path), "stdout", "--psm", "7", "-l", "eng"],
                            check=True, capture_output=True, text=True)
    match = AMOUNT.search(result.stdout)
    # Benchmark labels validate the OCR. An uncertain result cannot enter a financial sum.
    passed = bool(match and cents(match[1]) == expected_amount and match[2].upper() == expected_currency)
    return dict(document=name, read=cents(match[1]) if match else None,
                currency=match[2].upper() if match else None, checked=passed)

def encoded_png(image):
    stream = io.BytesIO()
    # Four-bit greyscale keeps the line legible and the evidence cheap to load.
    image.convert("L").quantize(colors=16).save(stream, format="PNG", bits=4)
    return base64.b64encode(stream.getvalue()).decode("ascii")


def region(field, page, padding):
    if not isinstance(field, dict) or not field.get("bbox"):
        return None
    a, b = field["bbox"]
    left, right = sorted((a[0], b[0]))
    low, high = sorted((a[1], b[1]))
    w, h = page.size
    rect = (max(0, int(left)-padding), max(0, h-int(high)-padding),
            min(w, int(right)+padding+1), min(h, h-int(low)+padding+1))
    return rect if rect[2] > rect[0] and rect[3] > rect[1] else None


TOTAL_TOKEN = re.compile(r"(\d[\d,]*\.\d{2})\s*(USD\b|EUR\b|\$)", re.I)


def process_batch(task):
    batch, names, folder, output = task
    evidence, assets, ocr_jobs = {}, {}, []
    with tempfile.TemporaryDirectory() as tmp:
        for name in names:
            fields = json.loads((folder / "annotations" / (name+".json")).read_bytes())
            with Image.open(folder / "images" / (name+".jpg")) as page:
                preview = Image.new("L", page.size, "white")
                for key in ("TITLE", "DATE", "NUMBER", "TAX", "TOTAL"):
                    box = region(fields.get(key), page, 1)
                    if box:
                        preview.paste(page.crop(box).convert("L"), box[:2])
                assets[name] = {"page": encoded_png(preview)}
                entry = dict(document=name, batch=batch, read=None, currency=None,
                             checked=False, reason="no_total")
                evidence[name] = entry
                box = region(fields.get("TOTAL"), page, 3)
                if not box:
                    continue
                crop = page.crop(box).convert("L")
                crop = crop.resize((crop.width*4, crop.height*4), Image.Resampling.LANCZOS)
                assets[name]["line"] = encoded_png(crop)
                path = Path(tmp) / (name+".png")
                crop.save(path)
                ocr_jobs.append((name, path, fields["TOTAL"].get("text","")))
        if ocr_jobs:
            listing = Path(tmp) / "pages.txt"
            listing.write_text("".join(str(path)+"\n" for _,path,_ in ocr_jobs))
            proc = subprocess.run(["tesseract",str(listing),"stdout","-l","eng","--psm","7"],
                                  check=True, capture_output=True)
            pages = proc.stdout.decode("utf-8").split("\f")
            if pages and pages[-1] == "":
                pages.pop()
            if len(pages) != len(ocr_jobs):
                raise ValueError(f"OCR page count differs in batch {batch}")
            for (name, _, label), text in zip(ocr_jobs, pages, strict=True):
                result = TOTAL_TOKEN.search(text)
                reference = TOTAL_TOKEN.search(label)
                entry = evidence[name]
                entry["reason"] = "unverified"
                if result:
                    value, token = cents(result[1]), result[2].upper()
                    entry["read"] = value
                    if token != "$":
                        entry["currency"] = token
                    if reference and (value,token)==(cents(reference[1]),reference[2].upper()):
                        if token == "$":
                            entry["reason"] = "ambiguous_currency"
                        else:
                            entry.update(checked=True, reason="currency" if token=="EUR" else "comparable")
    (output / f"{batch}.json").write_text(json.dumps(assets,separators=(",",":")))
    return evidence


def prepare(customs, folder):
    rows = shipments(customs)
    pool = sorted(rows, key=lambda r: (r["declared"],r["id"]))[:48]
    for i, ((name, amount, currency, box), row) in enumerate(zip(invoice_candidates(folder), pool, strict=True)):
        row.update(evidence=read_evidence(folder,name,box,amount,currency),
                   account=f"Account {i % 12 + 1:02}",example=i)
    used = {row["evidence"]["document"] for row in pool}
    remaining = [row for row in rows if "evidence" not in row]
    candidates = (p.stem for p in (folder / "annotations").glob("*.json") if p.stem not in used)
    names = sorted(candidates,key=lambda s:rank("scale:"+s))[:len(remaining)]
    if len(names) != len(remaining):
        raise ValueError("Not enough distinct invoices")
    output = ROOT / "public/evidence-batches"
    output.mkdir(exist_ok=True)
    size = 32
    tasks = [(i//size,names[i:i+size],folder,output) for i in range(0,len(names),size)]
    lookup = {}
    with ThreadPoolExecutor(max_workers=4) as workers:
        for evidence in workers.map(process_batch,tasks):
            lookup.update(evidence)
    for i, (row,name) in enumerate(zip(remaining,names,strict=True)):
        row.update(evidence=lookup[name], account=f"Account {13+i%240:02}")
    build_references(rows, folder)
    print(f"Screened {len(rows)} declarations and {len(used)+len(lookup)} distinct invoices.")
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("shipment_zip", type=Path)
    parser.add_argument("fatura_folder", type=Path, help="Directory containing annotations and images")
    args = parser.parse_args()
    prepare(args.shipment_zip, args.fatura_folder)
