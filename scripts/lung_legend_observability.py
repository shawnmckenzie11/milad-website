#!/usr/bin/env python3
"""
Legend item extraction + observability-tier fixtures for the lung cutaway.

Extracts linear legend text (code, name, location, supports) from a LAYER MAP
PNG in the same format as `Lung Cutaway Legend Template.png`, then self-tests
against the user's established observability classifications.

Interactive prompting is available for *future* legends (`--prompt`); for the
current legend, classifications are already known — use `--self-test` (default).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import cv2
import numpy as np
import pytesseract

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LEGEND = ROOT / "public/figures/lung-health/Lung Cutaway Legend Template.png"
ITEMS_DIR = ROOT / "public/figures/lung-health/debug/legend-items"
EXTRACT_JSON = ROOT / "public/figures/lung-health/debug/legend-extract.json"
CLASSIFICATION_JSON = ROOT / "public/figures/lung-health/legend-classification.json"
LAYERS_TS = ROOT / "src/data/lungHealthLayers.ts"
MATCH_REPORT = ROOT / "public/figures/lung-health/debug/template-match-report.json"

# ---------------------------------------------------------------------------
# Classification guidelines (verbatim intent from the project owner)
# ---------------------------------------------------------------------------

GUIDELINES = """
Observability of mask — how clearly a legend glyph can be found in the cutaway:

1. Top tier (obvious to see; find with high confidence first):
   Exact legend replicas in the diagram. (A structure may match the legend
   exactly but still be absent from the figure — do not search those.)

2. Middle tier (eventually find; not 100% replicas):
   - Explicitly present marks (mediators / signaling clusters)
   - Structures that appear as adjacent multiples in the legend but may show
     in the diagram as individuals or a long row (~70% similarity to neighbors)

3. Lowest tier (present but very difficult to identify accurately):
   - Fractal / scale continuations of a larger parent structure
   - Large fields that greatly differ in scale and are <60% similar to the glyph

4. Not properly diagrammed in the legend (or absent from the figure):
   Do not search.
""".strip()

SUBTIER_HELP = {
    "exact-replica": "Tier 1 — shows exactly as in the legend; searchable with high confidence",
    "exact-replica-absent": "Tier 1 style but not present in the diagram → treat as non-searchable",
    "explicitly-present": "Tier 2 — mark is explicitly present (not a perfect cell replica)",
    "partial-neighbor-similarity": "Tier 2 — legend shows adjacent multiples; diagram may show individuals/rows (~70% similarity)",
    "fractal-scale-continuation": "Tier 3 — parent structure 'turns into' these at larger scale",
    "scale-divergent-low-similarity": "Tier 3 — greatly differs in scale and <60% glyph similarity",
    "not-diagrammed-in-legend": "Tier 0 — not properly diagrammed; do not search",
    "absent-from-figure": "Tier 0 — may look exact in the legend but is not in the cutaway; do not search",
}

ICON_INTERPRETATION_HELP = {
    "1-discrete": "Single glyph in the legend row — crop one template",
    "2-discrete": (
        "Two different glyph types side-by-side in one legend icon — "
        "crop each independently and search both (union outlines)"
    ),
    "multiple-adjacent-as-one": (
        "Adjacent multiples treated as one template (tier-2 style like A1/B1)"
    ),
}

# Ground truth for the current Milad Lab legend (owner-provided).
# B8 is exact-legend style but absent from the figure → non-searchable.
# iconInterpretation: how the legend glyph maps to match instances.
KNOWN_CLASSIFICATION: dict[str, dict] = {
    "A1": {
        "tier": 2,
        "subTier": "partial-neighbor-similarity",
        "iconInterpretation": "multiple-adjacent-as-one",
        "searchable": True,
        "group": "base",
        "slug": "trachea-conducting-airway",
    },
    "A2": {
        "tier": 3,
        "subTier": "fractal-scale-continuation",
        "iconInterpretation": "multiple-adjacent-as-one",
        "searchable": True,
        "group": "base",
        "slug": "bronchial-branches",
    },
    "A3": {
        "tier": 3,
        "subTier": "scale-divergent-low-similarity",
        "iconInterpretation": "multiple-adjacent-as-one",
        "searchable": True,
        "group": "base",
        "slug": "alveolar-fields",
    },
    "A4": {
        "tier": 0,
        "subTier": "not-diagrammed-in-legend",
        "iconInterpretation": "1-discrete",
        "searchable": False,
        "group": "base",
        "slug": "airway-lumen",
    },
    "B1": {
        "tier": 2,
        "subTier": "partial-neighbor-similarity",
        "iconInterpretation": "multiple-adjacent-as-one",
        "searchable": True,
        "group": "highlight",
        "slug": "airway-epithelium",
    },
    "B2": {
        "tier": 0,
        "subTier": "not-diagrammed-in-legend",
        "iconInterpretation": "1-discrete",
        "searchable": False,
        "group": "highlight",
        "slug": "airway-immune-compartment",
    },
    "B3": {
        "tier": 1,
        "subTier": "exact-replica",
        "iconInterpretation": "1-discrete",
        "searchable": True,
        "group": "highlight",
        "slug": "neutrophils",
    },
    "B4": {
        "tier": 1,
        "subTier": "exact-replica",
        "iconInterpretation": "1-discrete",
        "searchable": True,
        "group": "highlight",
        "slug": "alveolar-macrophages",
    },
    "B5": {
        "tier": 1,
        "subTier": "exact-replica",
        "iconInterpretation": "1-discrete",
        "searchable": True,
        "group": "highlight",
        "slug": "dendritic-cells",
    },
    "B6": {
        "tier": 2,
        "subTier": "explicitly-present",
        # Legend icon = 5-dot mediators + antibody-Y side-by-side.
        "iconInterpretation": "2-discrete",
        "searchable": True,
        "group": "highlight",
        "slug": "antiviral-immune-mediators",
    },
    "B7": {
        "tier": 2,
        "subTier": "explicitly-present",
        "iconInterpretation": "1-discrete",
        "searchable": True,
        "group": "highlight",
        "slug": "inflammatory-signaling",
    },
    "B8": {
        "tier": 0,
        "subTier": "absent-from-figure",
        "iconInterpretation": "1-discrete",
        "searchable": False,
        "group": "highlight",
        "slug": "copd-inflammatory-structures",
        "note": "Exact legend style, but not in the cutaway diagram",
    },
    "B9": {
        "tier": 1,
        "subTier": "exact-replica",
        "iconInterpretation": "1-discrete",
        "searchable": True,
        "group": "highlight",
        "slug": "infection-antiviral-pathway",
    },
}

EXPECTED_NAMES: dict[str, str] = {
    "A1": "TRACHEA / CONDUCTING AIRWAY",
    "A2": "BRONCHIAL BRANCHES",
    "A3": "ALVEOLAR FIELDS",
    "A4": "AIRWAY LUMEN",
    "B1": "AIRWAY EPITHELIUM",
    "B2": "AIRWAY IMMUNE COMPARTMENT",
    "B3": "NEUTROPHILS",
    "B4": "ALVEOLAR MACROPHAGES",
    "B5": "DENDRITIC CELLS",
    "B6": "ANTIVIRAL IMMUNE MEDIATORS",
    "B7": "INFLAMMATORY SIGNALING",
    "B8": "COPD-RELEVANT INFLAMMATORY STRUCTURES",
    "B9": "INFECTION / ANTIVIRAL PATHWAY",
}


@dataclass
class LegendItem:
    """One extracted LAYER MAP row."""

    code: str
    name: str
    location: str
    supports: str
    row_y0: int
    row_y1: int
    glyph_path: str
    row_path: str


def normalize_name(name: str) -> str:
    """Collapse whitespace/punctuation for name comparison."""
    cleaned = re.sub(r"[^A-Z0-9]+", " ", name.upper()).strip()
    return re.sub(r"\s+", " ", cleaned)


def detect_hairline_separators(gray: np.ndarray) -> list[int]:
    """
    Find horizontal hairline rule Y coordinates in a white-card legend.

    Hairlines are mid-gray rows sandwiched between near-white neighbors.
    """
    h = gray.shape[0]
    seps: list[int] = []
    for y in range(20, h - 5):
        row = gray[y]
        mid = float(((row > 195) & (row < 230)).mean())
        if mid <= 0.55:
            continue
        above = float(gray[y - 2].mean()) if y >= 2 else 255.0
        below = float(gray[y + 2].mean()) if y + 2 < h else 255.0
        if above > 235 and below > 235:
            seps.append(y)
    merged: list[int] = []
    for y in seps:
        if not merged or y - merged[-1] > 8:
            merged.append(y)
    return merged


def row_bounds(height: int, separators: list[int]) -> list[tuple[int, int]]:
    """Convert hairline Ys into inclusive-exclusive row bands of legend items."""
    bounds = [0] + separators + [height]
    rows: list[tuple[int, int]] = []
    for a, b in zip(bounds, bounds[1:]):
        if 45 <= (b - a) <= 130:
            rows.append((a + 1, b))
    return rows


def parse_row_text(text: str) -> tuple[str, str, str, str] | None:
    """
    Parse OCR text from one legend row into (code, name, location, supports).

    Expects linear standard text: `A1 NAME`, optional `(location)`, then supports.
    """
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return None

    code = ""
    name_parts: list[str] = []
    location = ""
    supports = ""

    # First line should start with A#/B#
    m = re.match(r"^([AB])\s*([1-9])\s*[_\-]?\s*(.+)$", lines[0], re.I)
    if m:
        code = f"{m.group(1).upper()}{m.group(2)}"
        name_parts.append(m.group(3).strip(" _-"))
    else:
        # Code alone on first token
        m2 = re.match(r"^([AB])\s*([1-9])\s*$", lines[0], re.I)
        if not m2:
            return None
        code = f"{m2.group(1).upper()}{m2.group(2)}"

    for ln in lines[1:]:
        if ln.startswith("(") and ")" in ln:
            location = ln.strip("() ").strip()
            continue
        if re.match(r"^supports\s*:", ln, re.I) or re.match(r"^all pathways", ln, re.I):
            supports = re.sub(r"^supports\s*:\s*", "", ln, flags=re.I).strip()
            continue
        # Continuation of wrapped title (e.g. B8)
        if not location and not supports and ln.isupper():
            name_parts.append(ln)

    name = " ".join(name_parts).strip()
    name = re.sub(r"\s+", " ", name)
    if not code or not name:
        return None
    return code, name, location, supports


def extract_legend_items(legend_path: Path) -> list[LegendItem]:
    """
    Extract legend items from a LAYER MAP PNG (hairline rows + OCR names).

    Writes per-row / glyph crops under debug/legend-items/ and returns items.
    """
    if not legend_path.is_file():
        raise FileNotFoundError(f"Legend PNG not found: {legend_path}")

    bgr = cv2.imread(str(legend_path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError(f"Failed to read legend PNG: {legend_path}")

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    separators = detect_hairline_separators(gray)
    rows = row_bounds(gray.shape[0], separators)
    if len(rows) < 8:
        raise RuntimeError(
            f"Expected ~13 legend rows from hairlines; got {len(rows)}. "
            "Legend format may differ from LAYER MAP template."
        )

    ITEMS_DIR.mkdir(parents=True, exist_ok=True)
    items: list[LegendItem] = []

    for y0, y1 in rows:
        row_bgr = bgr[y0:y1, :]
        text_crop = row_bgr[:, 90:]
        up = cv2.resize(text_crop, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
        rgb = cv2.cvtColor(up, cv2.COLOR_BGR2RGB)
        ocr_text = pytesseract.image_to_string(rgb, config="--psm 6")
        parsed = parse_row_text(ocr_text)
        if parsed is None:
            raise RuntimeError(f"Failed to parse legend row y={y0}-{y1}:\n{ocr_text}")

        code, name, location, supports = parsed
        # Glyph: left column ink before the badge (~x 0–95)
        glyph = row_bgr[:, 8:95].copy()
        row_path = ITEMS_DIR / f"{code}-row.png"
        glyph_path = ITEMS_DIR / f"{code}-glyph.png"
        cv2.imwrite(str(row_path), row_bgr)
        cv2.imwrite(str(glyph_path), glyph)

        items.append(
            LegendItem(
                code=code,
                name=name,
                location=location,
                supports=supports,
                row_y0=y0,
                row_y1=y1,
                glyph_path=str(glyph_path.relative_to(ROOT)),
                row_path=str(row_path.relative_to(ROOT)),
            )
        )

    # Stable A/B then numeric order
    items.sort(key=lambda it: (it.code[0], int(it.code[1:])))
    return items


def write_extract_json(
    items: list[LegendItem],
    path: Path = EXTRACT_JSON,
    source: Path | None = None,
) -> None:
    """Persist extracted legend items for inspection / downstream tools."""
    path.parent.mkdir(parents=True, exist_ok=True)
    src = source or DEFAULT_LEGEND
    try:
        source_rel = str(src.resolve().relative_to(ROOT))
    except ValueError:
        source_rel = str(src)
    payload = {
        "source": source_rel,
        "guidelines": GUIDELINES,
        "items": [asdict(it) for it in items],
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def write_classification_json(path: Path = CLASSIFICATION_JSON) -> None:
    """Write owner-known classifications for the current legend."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": str(DEFAULT_LEGEND.relative_to(ROOT)),
        "guidelines": GUIDELINES,
        "subTierHelp": SUBTIER_HELP,
        "iconInterpretationHelp": ICON_INTERPRETATION_HELP,
        "classifications": KNOWN_CLASSIFICATION,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def parse_layers_ts_tiers(path: Path = LAYERS_TS) -> dict[str, int]:
    """Pull legendCode → observabilityTier pairs from lungHealthLayers.ts."""
    text = path.read_text(encoding="utf-8")
    # Match objects with legendCode + observabilityTier nearby
    blocks = re.findall(
        r"legendCode:\s*'([AB][1-9])'[\s\S]*?observabilityTier:\s*([0-3])",
        text,
    )
    return {code: int(tier) for code, tier in blocks}


def run_self_test(legend_path: Path) -> int:
    """
    Extract legend items and verify against known names + classifications.

    Also checks `lungHealthLayers.ts` tiers and, when present, that tier-1
    template-match scores cleared their gates in the last generate report.
    """
    print("✓ Legend observability self-test")
    print(GUIDELINES)
    print()

    errors: list[str] = []
    items = extract_legend_items(legend_path)
    write_extract_json(items, source=legend_path)
    write_classification_json()

    codes = [it.code for it in items]
    expected_codes = sorted(KNOWN_CLASSIFICATION.keys(), key=lambda c: (c[0], int(c[1:])))
    print(f"· Extracted {len(items)} legend items → {EXTRACT_JSON.relative_to(ROOT)}")

    if codes != expected_codes:
        errors.append(f"codes {codes} != expected {expected_codes}")

    for it in items:
        print(f"  · {it.code:2s}  {it.name}")
        exp_name = EXPECTED_NAMES.get(it.code, "")
        if normalize_name(it.name) != normalize_name(exp_name):
            errors.append(
                f"{it.code}: name {it.name!r} != expected {exp_name!r} "
                f"(norm {normalize_name(it.name)!r} vs {normalize_name(exp_name)!r})"
            )
        if it.code not in KNOWN_CLASSIFICATION:
            errors.append(f"{it.code}: missing from known classification fixture")
            continue
        cls = KNOWN_CLASSIFICATION[it.code]
        icon = cls.get("iconInterpretation", "?")
        if icon not in ICON_INTERPRETATION_HELP:
            errors.append(f"{it.code}: invalid iconInterpretation {icon!r}")
        print(
            f"       tier={cls['tier']} subTier={cls['subTier']} "
            f"icon={icon} searchable={cls['searchable']} slug={cls['slug']}"
        )

    # Registry consistency
    if LAYERS_TS.is_file():
        ts_tiers = parse_layers_ts_tiers(LAYERS_TS)
        for code, cls in KNOWN_CLASSIFICATION.items():
            if code not in ts_tiers:
                errors.append(f"{code}: missing from lungHealthLayers.ts")
                continue
            if ts_tiers[code] != cls["tier"]:
                errors.append(
                    f"{code}: lungHealthLayers.ts tier {ts_tiers[code]} != "
                    f"known classification tier {cls['tier']}"
                )
        print(f"· Registry tiers checked ({len(ts_tiers)} codes in lungHealthLayers.ts)")

    # Tier-1 visual/match gate from last generate (when available)
    if MATCH_REPORT.is_file():
        report = json.loads(MATCH_REPORT.read_text(encoding="utf-8"))
        qa = report.get("qa_errors") or []
        if qa:
            errors.append(f"template-match report still has QA errors: {qa[:3]}")
        tier1_slugs = [
            cls["slug"]
            for cls in KNOWN_CLASSIFICATION.values()
            if cls["tier"] == 1 and cls["searchable"]
        ]
        layers = report.get("layers") or {}
        for slug in tier1_slugs:
            layer = layers.get(slug)
            if not layer or not layer.get("matches"):
                errors.append(f"tier-1 {slug}: no accepted matches in last generate")
                continue
            score = float(layer.get("bestScore") or 0)
            if score < 0.78:
                errors.append(f"tier-1 {slug}: bestScore {score:.3f} < 0.78")
        mean = report.get("tier1_mean_score")
        print(f"· Last generate tier-1 mean score: {mean}")
    else:
        print("· No template-match-report.json yet — skip match-score check")

    print(f"· Classification fixture → {CLASSIFICATION_JSON.relative_to(ROOT)}")

    # Refresh durable findings DB (classification + latest match report when present).
    try:
        from lung_findings_db import upsert_findings_db

        upsert_findings_db(write_canvas=True)
    except Exception as exc:  # noqa: BLE001 — keep self-test useful if canvas path missing
        print(f"· Findings DB refresh skipped: {exc}", file=sys.stderr)

    if errors:
        print("\n✗ Legend observability self-test FAILED:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    print("\n✓ Extraction names + known tier/sub-tier classifications verified")
    return 0


def run_prompt_future(legend_path: Path) -> int:
    """
    Interactive classification for a *new* legend in the same format.

    Defaults to refusing on the current checked-in legend so we do not
    re-ask for classifications already provided by the owner.
    """
    if legend_path.resolve() == DEFAULT_LEGEND.resolve():
        print(
            "This legend already has owner classifications.\n"
            "Run with --self-test (default), or pass a different --legend path "
            "to classify a new LAYER MAP interactively.",
            file=sys.stderr,
        )
        return 1

    print(GUIDELINES)
    print("\nSub-tier options:")
    for key, help_text in SUBTIER_HELP.items():
        print(f"  {key}\n      {help_text}")
    print("\nIcon interpretation options:")
    for key, help_text in ICON_INTERPRETATION_HELP.items():
        print(f"  {key}\n      {help_text}")

    items = extract_legend_items(legend_path)
    write_extract_json(items)
    classifications: dict[str, dict] = {}

    for it in items:
        print("\n" + "=" * 60)
        print(f"{it.code}  {it.name}")
        print(f"location: {it.location or '—'}")
        print(f"supports: {it.supports or '—'}")
        print(f"glyph:    {it.glyph_path}")
        print(f"row:      {it.row_path}")
        while True:
            raw = input("Tier [0/1/2/3]: ").strip()
            if raw in {"0", "1", "2", "3"}:
                tier = int(raw)
                break
            print("Enter 0, 1, 2, or 3.")
        while True:
            sub = input("subTier (see list above): ").strip()
            if sub in SUBTIER_HELP:
                break
            print("Unknown subTier — paste one of the keys exactly.")
        while True:
            icon = input(
                "iconInterpretation [1-discrete|2-discrete|multiple-adjacent-as-one]: "
            ).strip()
            if icon in ICON_INTERPRETATION_HELP:
                break
            print("Unknown iconInterpretation — paste one of the keys exactly.")
        group = "base" if it.code.startswith("A") else "highlight"
        searchable = tier > 0 and sub not in {"exact-replica-absent", "absent-from-figure"}
        if tier == 0:
            searchable = False
        classifications[it.code] = {
            "tier": tier,
            "subTier": sub,
            "iconInterpretation": icon,
            "searchable": searchable,
            "group": group,
            "name": it.name,
            "location": it.location,
            "supports": it.supports,
        }

    out = {
        "source": str(legend_path),
        "guidelines": GUIDELINES,
        "subTierHelp": SUBTIER_HELP,
        "iconInterpretationHelp": ICON_INTERPRETATION_HELP,
        "classifications": classifications,
    }
    CLASSIFICATION_JSON.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\n✓ Wrote {CLASSIFICATION_JSON}")
    return 0


def main() -> int:
    """CLI: --self-test (default) or --prompt for a new legend."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--legend",
        type=Path,
        default=DEFAULT_LEGEND,
        help="Path to LAYER MAP legend PNG",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Extract + verify against known classifications (default)",
    )
    parser.add_argument(
        "--prompt",
        action="store_true",
        help="Interactively classify a new legend (not the current one)",
    )
    parser.add_argument(
        "--extract-only",
        action="store_true",
        help="Extract items to JSON without classification checks",
    )
    args = parser.parse_args()

    if args.prompt:
        return run_prompt_future(args.legend)
    if args.extract_only:
        items = extract_legend_items(args.legend)
        write_extract_json(items, source=args.legend)
        for it in items:
            print(f"{it.code}\t{it.name}\t{it.supports}")
        print(f"✓ Wrote {EXTRACT_JSON}")
        return 0
    # default: self-test
    return run_self_test(args.legend)


if __name__ == "__main__":
    sys.exit(main())
