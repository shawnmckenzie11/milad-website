#!/usr/bin/env python3
"""
Legend item extraction + observability-tier fixtures for the lung cutaway.

Two legend layouts are supported by the same extractor:

1. **Badged LAYER MAP** (`Lung Cutaway Legend Template.png`): hairline-ruled
   rows, an `A1`/`B1` code badge per row, plus `(location)` and `Supports:`
   lines. Codes and pathway text come straight from the legend.
2. **Icon + label card**: a plain card with one icon per row and a single line
   of label text, no code badges and often no rules at all. The label line *is*
   the name; codes are auto-assigned `A1…An`, restarting at `B1` after each
   divider rule. `location` / `supports` stay empty — nothing in the legend
   states them, so they are left for the operator to classify.

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

from lung_io_paths import add_io_root_argument, analysis_layout, site_layout

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LEGEND = ROOT / "public/figures/lung-health/Lung Cutaway Legend Template.png"
ITEMS_DIR = ROOT / "public/figures/lung-health/debug/legend-items"
#: Checked-in crop dir; never pruned, unlike an analysis's own copy.
SITE_ITEMS_DIR = site_layout()["legend_items"]
EXTRACT_JSON = ROOT / "public/figures/lung-health/debug/legend-extract.json"
CLASSIFICATION_JSON = ROOT / "public/figures/lung-health/legend-classification.json"
LAYERS_TS = ROOT / "src/data/lungHealthLayers.ts"
MATCH_REPORT = ROOT / "public/figures/lung-health/debug/template-match-report.json"

#: Set by --io-root; when present extraction stays inside that analysis.
IO_ROOT: Path | None = None


def apply_io_root(io_root: Path) -> None:
    """
    Write extracted legend rows/glyphs into one analysis's own folder.

    Two analyses use the same legend codes (``A1``…``B9``), so a shared crop
    directory means the second extract silently replaces the first analysis's
    glyph images.

    :param io_root: Analysis folder (``workspace/analyses/{id}``).
    """
    global IO_ROOT, ITEMS_DIR, EXTRACT_JSON, CLASSIFICATION_JSON, MATCH_REPORT
    layout = analysis_layout(io_root)
    IO_ROOT = layout["root"]
    ITEMS_DIR = layout["legend_items"]
    EXTRACT_JSON = layout["extract"]
    CLASSIFICATION_JSON = layout["classification"]
    MATCH_REPORT = layout["match_report"]

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
    """One extracted legend row."""

    code: str
    name: str
    location: str
    supports: str
    row_y0: int
    row_y1: int
    glyph_path: str
    row_path: str


# Layout heuristics shared by both extraction paths. Legend cards are light with
# dark ink, so a single luminance cut separates ink from card/background.
INK_THRESHOLD = 235
# A rule spanning most of the card is a frame/divider, not glyph or text ink.
RULE_COVERAGE = 0.7
# Slack when deciding whether an OCR line starts at the label column.
LABEL_COLUMN_TOLERANCE = 9
# A legend row needs a glyph beside its label; below this it is a header/rule.
MIN_GLYPH_INK = 12
# Fewer icon+label rows than this means the layout guess was wrong.
MIN_ICON_LABEL_ROWS = 3
# Section letters for auto-assigned codes (A before the first divider, then B…).
SECTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
# Icon+label OCR upscale. 2× is enough for single-line names and ~2× faster than 3×.
ICON_LABEL_OCR_SCALE = 2.0
# Give up on the badged LAYER MAP path after this many consecutive non-badge rows
# so a plain card with spurious hairlines does not OCR every strip before falling back.
BADGED_FAIL_ABORT = 2


@dataclass
class OcrBox:
    """One OCR word box in legend-image pixel coordinates."""

    left: int
    top: int
    right: int
    bottom: int
    text: str
    conf: float
    line_key: tuple[int, int, int]


@dataclass
class OcrLine:
    """One OCR text line in legend-image pixel coordinates."""

    left: int
    top: int
    right: int
    bottom: int
    text: str


def normalize_name(name: str) -> str:
    """Collapse whitespace/punctuation for name comparison."""
    cleaned = re.sub(r"[^A-Z0-9]+", " ", name.upper()).strip()
    return re.sub(r"\s+", " ", cleaned)


def clean_label_text(text: str) -> str:
    """
    Tidy a single OCR'd legend label into a display name.

    Collapses whitespace and repairs systematic Tesseract confusions on these
    cards: bare `|` for roman `I`, and `Il` / `I1` for roman `II`
    (e.g. `Type Il alveolar cells`).
    """
    collapsed = re.sub(r"\s+", " ", text.replace("\n", " ")).strip()
    collapsed = re.sub(r"(?<![A-Za-z0-9])[|]+(?![A-Za-z0-9])", "I", collapsed)
    collapsed = re.sub(r"\bType\s+Il\b", "Type II", collapsed, flags=re.I)
    collapsed = re.sub(r"\bType\s+I1\b", "Type II", collapsed, flags=re.I)
    collapsed = re.sub(r"\bType\s+!\b", "Type I", collapsed, flags=re.I)
    return re.sub(r"\s+", " ", collapsed).strip(" -_·")


def repo_rel(path: Path) -> str:
    """Repo-relative path when possible, else absolute (`--io-root` may be anywhere)."""
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def ink_mask(gray: np.ndarray) -> np.ndarray:
    """Boolean mask of non-background pixels on a light legend card."""
    return gray < INK_THRESHOLD


def rule_columns(ink: np.ndarray) -> list[int]:
    """X positions of near-full-height vertical rules (the card frame)."""
    coverage = ink.mean(axis=0)
    return [int(x) for x in np.nonzero(coverage > RULE_COVERAGE)[0]]


def rule_rows(ink: np.ndarray, x0: int, x1: int) -> list[int]:
    """Y positions of near-full-width horizontal rules within `x0`–`x1`."""
    if x1 <= x0:
        return []
    coverage = ink[:, x0:x1].mean(axis=1)
    return [int(y) for y in np.nonzero(coverage > RULE_COVERAGE)[0]]


def frame_bounds(positions: list[int], extent: int) -> tuple[int, int]:
    """
    Inner edges of the card border along one axis.

    Only rules hugging the card edge are border; a section divider drawn across
    the card is also a full-width rule, and treating it as the border would
    silently discard every row on one side of it.
    """
    margin = max(4, int(extent * 0.15))
    start = 0
    low = sorted(p for p in positions if p <= margin)
    if low:
        start = low[0]
        for p in low[1:]:
            # A gap means a separate rule, not more of the border stroke.
            if p - start > 2:
                break
            start = p
        start += 1
    end = extent
    high = sorted((p for p in positions if p >= extent - margin), reverse=True)
    if high:
        end = high[0]
        for p in high[1:]:
            if end - p > 2:
                break
            end = p
    return start, end


def card_interior(ink: np.ndarray) -> tuple[int, int, int, int]:
    """
    Bounds just inside the card frame as `(x0, x1, y0, y1)`.

    Cards without a drawn frame fall back to the full image.
    """
    h, w = ink.shape
    x0, x1 = frame_bounds(rule_columns(ink), w)
    y0, y1 = frame_bounds(rule_rows(ink, x0, x1), h)
    return x0, x1, y0, y1


def ocr_boxes(
    image: np.ndarray,
    *,
    scale: float = 3.0,
    x_offset: int = 0,
    y_offset: int = 0,
    config: str = "--psm 6",
) -> list[OcrBox]:
    """
    OCR `image` and return word boxes mapped back to legend-image coordinates.

    `x_offset` / `y_offset` re-apply the crop origin so callers can OCR a strip
    of the card and still reason in full-image pixels.
    """
    up = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    rgb = cv2.cvtColor(up, cv2.COLOR_BGR2RGB)
    data = pytesseract.image_to_data(rgb, config=config, output_type=pytesseract.Output.DICT)
    boxes: list[OcrBox] = []
    for i, raw_text in enumerate(data["text"]):
        text = str(raw_text).strip()
        if not text:
            continue
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1.0
        left = x_offset + int(data["left"][i] / scale)
        top = y_offset + int(data["top"][i] / scale)
        boxes.append(
            OcrBox(
                left=left,
                top=top,
                right=left + int(data["width"][i] / scale),
                bottom=top + int(data["height"][i] / scale),
                text=text,
                conf=conf,
                line_key=(
                    int(data["block_num"][i]),
                    int(data["par_num"][i]),
                    int(data["line_num"][i]),
                ),
            )
        )
    return boxes


def group_ocr_lines(boxes: list[OcrBox]) -> list[OcrLine]:
    """Merge word boxes into text lines using Tesseract's block/par/line ids."""
    grouped: dict[tuple[int, int, int], list[OcrBox]] = {}
    for box in boxes:
        grouped.setdefault(box.line_key, []).append(box)
    lines: list[OcrLine] = []
    for words in grouped.values():
        ordered = sorted(words, key=lambda b: b.left)
        lines.append(
            OcrLine(
                left=min(b.left for b in ordered),
                top=min(b.top for b in ordered),
                right=max(b.right for b in ordered),
                bottom=max(b.bottom for b in ordered),
                text=" ".join(b.text for b in ordered),
            )
        )
    lines.sort(key=lambda ln: ln.top)
    return lines


def detect_label_column(boxes: list[OcrBox]) -> int | None:
    """
    X where the label text column starts (icons sit to its left).

    Labels share one left edge across every row, so the modal left edge of
    text-height word boxes is the column; icon strokes OCR'd as junk scatter.
    """
    candidates = [b for b in boxes if 6 <= (b.bottom - b.top) <= 26 and b.conf >= 50]
    if len(candidates) < MIN_ICON_LABEL_ROWS:
        return None
    bins: dict[int, list[int]] = {}
    for box in candidates:
        bins.setdefault(box.left // 4, []).append(box.left)
    best = max(bins.values(), key=len)
    if len(best) < MIN_ICON_LABEL_ROWS:
        return None
    return min(best)


def is_label_like(text: str) -> bool:
    """Whether an OCR line reads as a real label rather than rule/border noise."""
    words = re.findall(r"[A-Za-z][A-Za-z'’\-]*", text)
    return any(len(w) >= 3 for w in words) and len(re.sub(r"[^A-Za-z0-9]", "", text)) >= 3


def band_bounds(centers: list[int], y0: int, y1: int) -> list[tuple[int, int]]:
    """
    Split `y0`–`y1` into one band per label center, cutting at midpoints.

    Icons are taller than their label text, so bands are grown to the midpoint
    between neighbouring labels (using the local gap at the ends) rather than to
    the text box itself.
    """
    bands: list[tuple[int, int]] = []
    for i, center in enumerate(centers):
        above = center - centers[i - 1] if i > 0 else 0
        below = centers[i + 1] - center if i + 1 < len(centers) else 0
        # Single-row legends have no neighbour gap to borrow from.
        gap = above or below or 40
        top = center - (above or gap) // 2
        bottom = center + (below or gap) // 2
        bands.append((max(y0, top), min(y1, bottom)))
    return bands


def detect_divider_ys(gray: np.ndarray, interior: tuple[int, int, int, int]) -> list[int]:
    """
    Y positions of section dividers inside the card.

    Both hairline rules and solid full-width rules count; the card's own top and
    bottom borders are excluded by `card_interior`.
    """
    x0, x1, y0, y1 = interior
    ink = ink_mask(gray)
    candidates = set(detect_hairline_separators(gray)) | set(rule_rows(ink, x0, x1))
    inside = sorted(y for y in candidates if y0 < y < y1)
    merged: list[int] = []
    for y in inside:
        if not merged or y - merged[-1] > 8:
            merged.append(y)
    return merged


def auto_assign_codes(lines: list[OcrLine], dividers: list[int]) -> list[str]:
    """
    Assign `A1…An` down the legend, starting a new letter after each divider.

    A divider counts when it falls in the gap between two labels. A legend with
    no dividers yields one `A` section; one divider yields `A…` then `B…`,
    matching the badged LAYER MAP convention. Cards ruled between *every* row
    carry no section information, so those rules are ignored.
    """
    if len(lines) > 2 and len(dividers) >= len(lines) - 1:
        dividers = []
    codes: list[str] = []
    section = 0
    index = 0
    for i, line in enumerate(lines):
        if i > 0 and any(lines[i - 1].bottom <= d <= line.top for d in dividers):
            section = min(section + 1, len(SECTION_LETTERS) - 1)
            index = 0
        index += 1
        codes.append(f"{SECTION_LETTERS[section]}{index}")
    return codes


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

    # First line should start with a code badge (A1, B12, …)
    m = re.match(r"^([A-Z])\s*([1-9][0-9]?)\s*[_\-]?\s*(.+)$", lines[0], re.I)
    if m:
        code = f"{m.group(1).upper()}{m.group(2)}"
        name_parts.append(m.group(3).strip(" _-"))
    else:
        # Code alone on first token
        m2 = re.match(r"^([A-Z])\s*([1-9][0-9]?)\s*$", lines[0], re.I)
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


def write_item_crops(
    bgr: np.ndarray,
    code: str,
    band: tuple[int, int],
    glyph_x: tuple[int, int],
    items_dir: Path,
) -> tuple[Path, Path]:
    """Write the row strip and its glyph crop for one legend item."""
    y0, y1 = band
    gx0, gx1 = glyph_x
    row_bgr = bgr[y0:y1, :]
    row_path = items_dir / f"{code}-row.png"
    glyph_path = items_dir / f"{code}-glyph.png"
    cv2.imwrite(str(row_path), row_bgr)
    cv2.imwrite(str(glyph_path), bgr[y0:y1, gx0:gx1].copy())
    return glyph_path, row_path


def extract_badged_rows(
    bgr: np.ndarray,
    gray: np.ndarray,
    items_dir: Path,
) -> list[LegendItem]:
    """
    Extract a hairline-ruled LAYER MAP legend whose rows carry `A1`/`B1` badges.

    Returns `[]` when the card is not this layout so the caller can fall back.
    Aborts after a few consecutive non-badge OCRs so plain icon+label cards with
    spurious hairlines do not pay for a full-card OCR marathon.
    """
    rows = row_bounds(gray.shape[0], detect_hairline_separators(gray))
    if len(rows) < 8:
        return []

    items: list[LegendItem] = []
    consecutive_fails = 0
    for y0, y1 in rows:
        text_crop = bgr[y0:y1, 90:]
        up = cv2.resize(text_crop, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
        rgb = cv2.cvtColor(up, cv2.COLOR_BGR2RGB)
        parsed = parse_row_text(pytesseract.image_to_string(rgb, config="--psm 6"))
        if parsed is None:
            consecutive_fails += 1
            if consecutive_fails >= BADGED_FAIL_ABORT:
                return []
            continue
        consecutive_fails = 0

        code, name, location, supports = parsed
        # Glyph: left column ink before the badge (~x 0–95)
        glyph_path, row_path = write_item_crops(bgr, code, (y0, y1), (8, 95), items_dir)
        items.append(
            LegendItem(
                code=code,
                name=name,
                location=location,
                supports=supports,
                row_y0=y0,
                row_y1=y1,
                glyph_path=repo_rel(glyph_path),
                row_path=repo_rel(row_path),
            )
        )
    # A real LAYER MAP yields most rows as badges; a handful of lucky parses from
    # a plain card must not win over the icon+label path.
    if len(items) < 8:
        return []
    return items


def read_label_line(bgr: np.ndarray, line: OcrLine, x0: int, x1: int) -> str:
    """
    Re-read one label line on its own for a cleaner name than the page pass.

    A single-line crop lets Tesseract use `--psm 7`, which recovers words the
    full-card pass garbles next to icon strokes (e.g. `Red` in `Red blood cells`).
    Prefer the strip/page text when it is already clean — per-row OCR was the
    main timeout cost on 20-row Test 2 legends.
    """
    top = max(0, line.top - 3)
    crop = bgr[top : min(bgr.shape[0], line.bottom + 3), x0:x1]
    if crop.size == 0:
        return ""
    up = cv2.resize(
        crop,
        None,
        fx=ICON_LABEL_OCR_SCALE,
        fy=ICON_LABEL_OCR_SCALE,
        interpolation=cv2.INTER_CUBIC,
    )
    rgb = cv2.cvtColor(up, cv2.COLOR_BGR2RGB)
    return clean_label_text(pytesseract.image_to_string(rgb, config="--psm 7"))


def label_needs_reread(text: str) -> bool:
    """
    Whether the page-pass label looks garbled enough to warrant a per-line OCR.

    Clean single-line names from the strip pass are kept as-is so a 20-row legend
    does not pay for twenty extra Tesseract launches. Common Tesseract slips on
    this card (`Type!`, `Type Il` for Type I/II) still force a cheap `--psm 7`
    reread.
    """
    cleaned = clean_label_text(text)
    if len(cleaned) < 3:
        return True
    # Punctuation / symbols that are not part of normal legend vocabulary.
    if re.search(r"[|!{}[\]@_]", cleaned):
        return True
    # Roman-numeral Type I / II lines often OCR as Type! / Type Il / Type 1.
    if re.search(r"\btype\s+i[l1!]\b", cleaned, re.I) or re.search(
        r"\btype\s*!\b", cleaned, re.I
    ):
        return True
    letters = sum(ch.isalpha() for ch in cleaned)
    if letters < max(3, int(0.55 * max(len(cleaned.replace(" ", "")), 1))):
        return True
    return False


def extract_icon_label_rows(
    bgr: np.ndarray,
    gray: np.ndarray,
    items_dir: Path,
) -> list[LegendItem]:
    """
    Extract a plain icon + single-line-label legend card.

    The label line is the item name; codes are auto-assigned (`A1…`, restarting
    at `B1` after a section divider). `location` / `supports` stay empty because
    this layout states neither — the operator classifies those in the lab.

    Uses **one** OCR pass over the card interior (not full-card + strip +
    per-row re-OCR). Only garbled names get a targeted `--psm 7` reread.
    """
    interior = card_interior(ink_mask(gray))
    x0, x1, y0, y1 = interior
    print(f"· icon+label extract: OCR card interior {x1 - x0}×{y1 - y0} @ {ICON_LABEL_OCR_SCALE}×…")
    boxes = ocr_boxes(
        bgr[y0:y1, x0:x1],
        scale=ICON_LABEL_OCR_SCALE,
        x_offset=x0,
        y_offset=y0,
    )
    label_x = detect_label_column(boxes)
    if label_x is None or label_x - x0 < 4:
        return []

    strip_x = max(x0, label_x - 4)
    # Keep words in the label column (and a little to the right); drop icon junk.
    label_boxes = [b for b in boxes if b.left >= label_x - LABEL_COLUMN_TOLERANCE]
    lines = group_ocr_lines(label_boxes)
    glyph_x = (x0 + 2, max(x0 + 3, label_x - 4))
    ink = ink_mask(gray)
    rows = [
        line
        for line in lines
        if line.left - label_x <= LABEL_COLUMN_TOLERANCE
        and is_label_like(line.text)
        and _has_glyph_ink(ink, line, glyph_x, interior)
    ]
    if len(rows) < MIN_ICON_LABEL_ROWS:
        return []

    bands = band_bounds([(ln.top + ln.bottom) // 2 for ln in rows], y0, y1)
    codes = auto_assign_codes(rows, detect_divider_ys(gray, interior))
    print(f"· icon+label extract: {len(rows)} rows → codes {codes[0]}…{codes[-1]}")

    items: list[LegendItem] = []
    reread_count = 0
    for i, (code, band, line) in enumerate(zip(codes, bands, rows), start=1):
        name = clean_label_text(line.text)
        if label_needs_reread(name):
            reread_count += 1
            name = read_label_line(bgr, line, strip_x, x1) or name
        glyph_path, row_path = write_item_crops(bgr, code, band, glyph_x, items_dir)
        items.append(
            LegendItem(
                code=code,
                name=name,
                location="",
                supports="",
                row_y0=band[0],
                row_y1=band[1],
                glyph_path=repo_rel(glyph_path),
                row_path=repo_rel(row_path),
            )
        )
        if i % 5 == 0 or i == len(rows):
            print(f"· icon+label extract: wrote {i}/{len(rows)} crops")
    if reread_count:
        print(f"· icon+label extract: re-OCR'd {reread_count}/{len(rows)} garbled names")
    return items


def _has_glyph_ink(
    ink: np.ndarray,
    line: OcrLine,
    glyph_x: tuple[int, int],
    interior: tuple[int, int, int, int],
) -> bool:
    """
    Whether a glyph sits left of this text line.

    Card borders and the `LEGEND` heading also OCR as lines; only real items have
    icon ink beside them, so this is what separates rows from chrome.
    """
    x0, x1, y0, y1 = interior
    top = max(y0, line.top - 4)
    bottom = min(y1, line.bottom + 4)
    if bottom <= top:
        return False
    region = ink[top:bottom, glyph_x[0] : glyph_x[1]]
    # Ignore rows the frame detector already flagged as rules.
    rules = set(rule_rows(ink, x0, x1))
    keep = [i for i in range(top, bottom) if i not in rules]
    if not keep:
        return False
    return int(region[[i - top for i in keep], :].sum()) >= MIN_GLYPH_INK


def prune_stale_crops(items_dir: Path, codes: set[str]) -> int:
    """
    Delete row/glyph crops in `items_dir` for codes this legend no longer has.

    Only used for per-analysis item folders: a previous legend's `B9-glyph.png`
    left beside a new `A9-glyph.png` would otherwise be served as this legend's
    icon.
    """
    if not items_dir.is_dir():
        return 0
    keep = {f"{code}-glyph.png" for code in codes} | {f"{code}-row.png" for code in codes}
    removed = 0
    for path in items_dir.glob("*.png"):
        if path.name in keep:
            continue
        path.unlink()
        removed += 1
    return removed


def extract_legend_items(
    legend_path: Path,
    items_dir: Path | None = None,
) -> list[LegendItem]:
    """
    Extract legend items from a legend PNG, detecting which layout it uses.

    Tries the badged LAYER MAP layout first, then the plain icon + label card.
    Writes per-row / glyph crops into `items_dir` (default `ITEMS_DIR`, which
    ``--io-root`` repoints at one analysis) and returns items in code order.
    """
    if not legend_path.is_file():
        raise FileNotFoundError(f"Legend PNG not found: {legend_path}")

    bgr = cv2.imread(str(legend_path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError(f"Failed to read legend PNG: {legend_path}")

    target_dir = items_dir or ITEMS_DIR
    target_dir.mkdir(parents=True, exist_ok=True)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    items = extract_badged_rows(bgr, gray, target_dir)
    if not items:
        items = extract_icon_label_rows(bgr, gray, target_dir)
    if not items:
        raise RuntimeError(
            f"No legend rows found in {legend_path.name}. Expected either a "
            "hairline-ruled LAYER MAP with A#/B# badges, or a card with one "
            "icon plus one line of label text per row."
        )

    items.sort(key=lambda it: (it.code[0], int(it.code[1:])))
    # The site dir holds checked-in crops for the published figure; only an
    # analysis-scoped dir may be pruned back to this legend's own codes.
    if target_dir.resolve() != SITE_ITEMS_DIR.resolve():
        prune_stale_crops(target_dir, {it.code for it in items})
    return items


def write_extract_json(
    items: list[LegendItem],
    path: Path | None = None,
    source: Path | None = None,
) -> None:
    """Persist extracted legend items for inspection / downstream tools."""
    # Resolved at call time so --io-root redirection applies.
    path = path or EXTRACT_JSON
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


def write_classification_json(path: Path | None = None) -> None:
    """Write owner-known classifications for the current legend."""
    path = path or CLASSIFICATION_JSON
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
        default=None,
        help="Path to LAYER MAP legend PNG (default: this analysis's legend, else the site legend)",
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
    add_io_root_argument(parser)
    args = parser.parse_args()
    if args.io_root is not None:
        apply_io_root(args.io_root)
    legend = args.legend or (
        analysis_layout(IO_ROOT)["legend"] if IO_ROOT is not None else DEFAULT_LEGEND
    )

    if args.prompt:
        return run_prompt_future(legend)
    if args.extract_only:
        items = extract_legend_items(legend)
        write_extract_json(items, source=legend)
        for it in items:
            print(f"{it.code}\t{it.name}\t{it.supports}")
        print(f"✓ Wrote {EXTRACT_JSON}")
        return 0
    # default: self-test
    return run_self_test(legend)


if __name__ == "__main__":
    sys.exit(main())
