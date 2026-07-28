#!/usr/bin/env python3
"""
OpenCV multi-scale template-matching pipeline for lung cutaway highlights.

Sole detection method for searchable layers (tiers 1–3). Standard stack:

1. Crop legend glyphs once → templates/{slug}.png
2. cv2.matchTemplate (TM_CCOEFF_NORMED) multi-scale inside lumen/junction ROIs
3. Threshold by tier → stamp matched silhouette
4. Emit {slug}-outline.png; fail if outline does not overlap the match
5. Runtime stays: original cutaway-neutral.png + outline overlays

Same pipeline for every searchable layer; only confidence / ROI / scales /
iconInterpretation differ. Flood-fill / chroma segmentation is not used.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE_PNG = ROOT / "public/figures/lung-health/cutaway-neutral.png"
LEGEND_PNG = ROOT / "public/figures/lung-health/Lung Cutaway Legend Template.png"
CLASSIFICATION_JSON = ROOT / "public/figures/lung-health/legend-classification.json"
TEMPLATE_DIR = ROOT / "public/figures/lung-health/templates"
LAYER_DIR = ROOT / "public/figures/lung-health/layers"
PREVIEW_DIR = ROOT / "public/figures/lung-health/previews"
DEBUG_DIR = ROOT / "public/figures/lung-health/debug"
GENERATED_TS = ROOT / "src/data/lungHealthLayers.generated.ts"
MATCH_REPORT = DEBUG_DIR / "template-match-report.json"

CANVAS_W = 1024
CANVAS_H = 953
OUTLINE_STROKE_PX = 22
OUTLINE_COLOR_BGR = (10, 214, 255)  # yellow in BGR

LUMEN = dict(x0=640, y0=60, x1=970, y1=380)
# Includes far-left lumen neutrophil (~635,318) clipped by the circular inset edge.
LUMEN_ACCEPT = dict(x0=610, y0=60, x1=970, y1=380)
# Extended below y=900 so the left junction macrophage (~492,904) stays in-frame.
JUNCTION = dict(x0=340, y0=660, x1=700, y1=935)
MAIN_TREE = dict(x0=180, y0=40, x1=860, y1=620)
LUMEN_UPPER = dict(x0=640, y0=70, x1=780, y1=180)
# Expanded left/up for the second spiked virus; still excludes B6 dots ~757,113.
VIRUS_ZONE = dict(x0=610, y0=70, x1=720, y1=155)
LUMEN_SUBEPI = dict(x0=650, y0=250, x1=920, y1=370)
# Top-inset neutrophil sits left of the dendritic (~712,334); keep ROI clear of B5 arms.
LUMEN_NEUTROPHIL = dict(x0=615, y0=280, x1=680, y1=355)
# Upper lumen mediators only — avoids B7 red-dot cluster at ~876,313 (tier-2 FP zone).
MEDIATOR_ZONE = dict(x0=700, y0=70, x1=940, y1=200)

# Short names for debug/verify labels (legend code → display).
LEGEND_SHORT_NAMES: dict[str, str] = {
    "A1": "Trachea",
    "A2": "Bronchi",
    "A3": "Alveoli",
    "B1": "Epithelium",
    "B3": "Neutrophil",
    "B4": "Macrophage",
    "B5": "Dendritic",
    "B6": "Mediator",
    "B7": "Signaling",
    "B9": "Virus",
}

# Legend glyph crops (icon only, excluding A#/B# badges). Calibrated 2026-07-28.
# Values are either one (x,y,w,h) or a list of parts for iconInterpretation=2-discrete.
LEGEND_CROPS: dict[str, tuple[int, int, int, int] | list[tuple[int, int, int, int]]] = {
    "trachea-conducting-airway": (30, 53, 41, 58),
    "bronchial-branches": (24, 128, 51, 59),
    "alveolar-fields": (24, 205, 52, 56),
    "airway-epithelium": (24, 355, 51, 51),
    # Tight B3 crop — legend white padding tanks TM_CCOEFF_NORMED vs the figure.
    "neutrophils": (34, 501, 30, 30),
    "alveolar-macrophages": (26, 567, 47, 43),
    "dendritic-cells": (24, 637, 51, 54),
    # B6 2-discrete: mediator-dot cluster + antibody-Y (search each independently).
    "antiviral-immune-mediators": [
        (22, 715, 36, 42),  # dots
        (55, 718, 28, 36),  # antibody Y
    ],
    # B7: red-dot cluster + curved arrow
    "inflammatory-signaling": (20, 780, 70, 35),
    "infection-antiviral-pathway": (26, 936, 47, 44),
}

# Part labels written beside multi-part template PNGs (debug / report).
LEGEND_CROP_PART_NAMES: dict[str, list[str]] = {
    "antiviral-immune-mediators": ["dots", "antibody"],
}

SKIP_SLUGS = {
    "airway-lumen",
    "airway-immune-compartment",
    "copd-inflammatory-structures",
}

PATHWAY_HIGHLIGHTS = {
    "cannabis": ["airway-epithelium", "antiviral-immune-mediators"],
    "cigarette": ["neutrophils", "alveolar-macrophages", "inflammatory-signaling"],
    "air": [],
    "vaping": ["dendritic-cells"],
    "viruses": ["infection-antiviral-pathway"],
}

PATHWAY_ACCENT_BGR = {
    "cannabis": (78, 143, 47),
    "cigarette": (26, 90, 212),
    "air": (154, 111, 47),
    "vaping": (186, 61, 122),
    "viruses": (191, 111, 31),
}


@dataclass
class LayerSpec:
    """Search configuration for one searchable cutaway layer."""

    slug: str
    legend_code: str
    tier: int
    rois: list[dict]
    scales: list[float]
    min_score: float
    # Color spaces tried for TM_CCOEFF_NORMED (best score wins).
    modes: tuple[str, ...] = ("gray", "color")
    max_matches: int = 4
    # Soft prior: prefer matches near these points (pixel space).
    expected_centers: list[tuple[int, int]] = field(default_factory=list)
    # Hard QA: match center must land in one of these ROIs.
    accept_rois: list[dict] = field(default_factory=list)
    # Cell-scale gate (tier 1): max component bbox side in px.
    max_component_side: int = 140
    max_pixel_count: int = 2500
    nms_min_dist: int = 28
    peaks_per_scale: int = 3
    # Lower floor for additional peaks near expected_centers (None → min_score).
    min_score_secondary: float | None = None
    # Radius (px) for expected-center recovery of secondary peaks.
    expected_radius: int = 55
    # From legend-classification.json; drives multi-part template cropping.
    icon_interpretation: str = "1-discrete"
    # Hard reject matches near confusable neighbors (e.g. B3 vs B5 dendrite arms).
    exclude_centers: list[tuple[int, int]] = field(default_factory=list)
    exclude_radius: int = 48


def _scale_range(start: float, stop: float, step: float) -> list[float]:
    """Build an inclusive-ish float scale list."""
    vals: list[float] = []
    x = start
    while x <= stop + 1e-9:
        vals.append(round(x, 4))
        x += step
    return vals


def load_icon_interpretations() -> dict[str, str]:
    """Map legendCode → iconInterpretation from the classification fixture."""
    if not CLASSIFICATION_JSON.is_file():
        return {}
    try:
        data = json.loads(CLASSIFICATION_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    out: dict[str, str] = {}
    for code, cls in (data.get("classifications") or {}).items():
        icon = cls.get("iconInterpretation")
        if isinstance(icon, str):
            out[code] = icon
    return out


def near_exclude(cx: float, cy: float, spec: LayerSpec) -> bool:
    """Return True when (cx, cy) falls inside an exclusion prior."""
    if not spec.exclude_centers:
        return False
    r2 = spec.exclude_radius**2
    return any((cx - ex) ** 2 + (cy - ey) ** 2 <= r2 for ex, ey in spec.exclude_centers)


LAYER_SPECS: list[LayerSpec] = [
    LayerSpec(
        slug="neutrophils",
        legend_code="B3",
        tier=1,
        # Dedicated left-lumen ROI — LUMEN_SUBEPI x0=650 clipped the top-inset neutrophil.
        rois=[JUNCTION, LUMEN_NEUTROPHIL],
        scales=_scale_range(0.7, 1.25, 0.04),
        min_score=0.78,
        # True lumen neutrophil ~0.62 purple; old 0.47 floor accepted a B5-arm FP.
        min_score_secondary=0.55,
        modes=("purple", "gray", "color"),
        max_matches=2,
        expected_centers=[(546, 883), (635, 318)],
        accept_rois=[LUMEN_ACCEPT, JUNCTION],
        max_component_side=90,
        max_pixel_count=3200,
        nms_min_dist=26,
        peaks_per_scale=5,
        expected_radius=40,
        icon_interpretation="1-discrete",
        exclude_centers=[(712, 334)],
        exclude_radius=50,
    ),
    LayerSpec(
        slug="alveolar-macrophages",
        legend_code="B4",
        tier=1,
        rois=[JUNCTION, LUMEN_SUBEPI],
        scales=_scale_range(0.55, 1.55, 0.04),
        min_score=0.75,
        modes=("green", "color", "gray"),
        max_matches=3,
        # Left junction macrophage sits lower (~492,904); lumen prior kept soft.
        expected_centers=[(606, 870), (492, 904), (812, 341)],
        accept_rois=[LUMEN, JUNCTION],
        max_component_side=130,
        max_pixel_count=3600,
        nms_min_dist=24,
        peaks_per_scale=5,
        icon_interpretation="1-discrete",
    ),
    LayerSpec(
        slug="dendritic-cells",
        legend_code="B5",
        tier=1,
        rois=[LUMEN_SUBEPI, JUNCTION],
        scales=_scale_range(0.7, 2.15, 0.06),
        min_score=0.75,
        # Top lumen dendritic peaks ~0.71 purple at expected center.
        min_score_secondary=0.68,
        modes=("purple", "gray", "color"),
        max_matches=2,
        expected_centers=[(712, 328), (456, 854)],
        accept_rois=[LUMEN, JUNCTION],
        max_component_side=140,
        max_pixel_count=4000,
        nms_min_dist=40,
        peaks_per_scale=5,
        expected_radius=50,
        icon_interpretation="1-discrete",
    ),
    LayerSpec(
        slug="infection-antiviral-pathway",
        legend_code="B9",
        tier=1,
        # Virus zone only — never search near the B6 5-dot cluster at ~757,113.
        rois=[VIRUS_ZONE],
        scales=_scale_range(0.55, 1.35, 0.03),
        min_score=0.80,
        modes=("gray", "blue", "color"),
        max_matches=2,
        expected_centers=[(676, 116), (630, 102)],
        accept_rois=[VIRUS_ZONE],
        max_component_side=100,
        max_pixel_count=1800,
        nms_min_dist=18,
        peaks_per_scale=4,
        icon_interpretation="1-discrete",
    ),
    LayerSpec(
        slug="antiviral-immune-mediators",
        legend_code="B6",
        tier=2,
        # Upper lumen only — lower LUMEN search hit B7 red-dot clusters (tier-2 FPs).
        rois=[MEDIATOR_ZONE],
        scales=_scale_range(0.65, 1.4, 0.05),
        min_score=0.74,
        modes=("gray", "blue", "color"),
        max_matches=5,
        expected_centers=[
            (757, 128),
            (861, 114),
            (884, 129),
            (821, 134),
        ],
        accept_rois=[MEDIATOR_ZONE, LUMEN],
        max_component_side=120,
        max_pixel_count=4000,
        nms_min_dist=18,
        peaks_per_scale=5,
        icon_interpretation="2-discrete",
    ),
    LayerSpec(
        slug="inflammatory-signaling",
        legend_code="B7",
        tier=2,
        # Junction red-dot cluster is the reliable replica; keep lumen sub-epi secondary.
        rois=[JUNCTION, dict(x0=820, y0=280, x1=920, y1=360)],
        scales=_scale_range(0.7, 1.2, 0.05),
        min_score=0.65,
        modes=("color", "gray"),
        max_matches=2,
        expected_centers=[(562, 805), (876, 313)],
        accept_rois=[JUNCTION, LUMEN_SUBEPI],
        max_component_side=120,
        max_pixel_count=2500,
        nms_min_dist=36,
    ),
    LayerSpec(
        slug="trachea-conducting-airway",
        legend_code="A1",
        tier=2,
        rois=[dict(x0=440, y0=40, x1=590, y1=260)],
        scales=_scale_range(0.4, 2.4, 0.1),
        # Legend A1 glyph is a short segment; cutaway trachea is larger — medium tier.
        min_score=0.45,
        modes=("gray", "color"),
        max_matches=2,
        expected_centers=[(515, 65), (512, 140)],
        accept_rois=[dict(x0=420, y0=30, x1=610, y1=280)],
        max_component_side=280,
        max_pixel_count=20000,
    ),
    LayerSpec(
        slug="airway-epithelium",
        legend_code="B1",
        tier=2,
        rois=[dict(x0=680, y0=180, x1=960, y1=290), dict(x0=350, y0=700, x1=520, y1=800)],
        scales=_scale_range(0.35, 1.4, 0.06),
        # Tier-2 partial similarity: legend epithelium glyph ≠ full wall segment.
        min_score=0.40,
        modes=("gray", "color"),
        max_matches=2,
        expected_centers=[(777, 256), (441, 748)],
        accept_rois=[LUMEN, JUNCTION],
        max_component_side=160,
        max_pixel_count=5000,
    ),
    LayerSpec(
        slug="bronchial-branches",
        legend_code="A2",
        tier=3,
        rois=[MAIN_TREE],
        scales=_scale_range(0.45, 2.2, 0.1),
        min_score=0.48,
        modes=("gray", "color"),
        max_matches=3,
        expected_centers=[(305, 295), (420, 380), (620, 380)],
        accept_rois=[MAIN_TREE],
        max_component_side=220,
        max_pixel_count=25000,
    ),
    LayerSpec(
        slug="alveolar-fields",
        legend_code="A3",
        tier=3,
        rois=[
            dict(x0=120, y0=580, x1=450, y1=940),
            dict(x0=600, y0=560, x1=1000, y1=940),
        ],
        scales=_scale_range(0.35, 2.0, 0.08),
        # Tier-3 scale-divergent: legend alveoli icon vs field clusters.
        min_score=0.42,
        modes=("gray", "color"),
        max_matches=4,
        expected_centers=[(280, 780), (857, 632), (936, 727)],
        accept_rois=[dict(x0=100, y0=540, x1=1020, y1=950)],
        max_component_side=220,
        max_pixel_count=30000,
    ),
]


def point_in_roi(x: float, y: float, roi: dict) -> bool:
    """Return True when (x, y) lies inside an inclusive axis-aligned ROI."""
    return roi["x0"] <= x <= roi["x1"] and roi["y0"] <= y <= roi["y1"]


def clamp_roi(roi: dict, width: int, height: int) -> tuple[int, int, int, int]:
    """Clamp an ROI to image bounds and return (x0, y0, x1, y1)."""
    x0 = max(0, int(roi["x0"]))
    y0 = max(0, int(roi["y0"]))
    x1 = min(width, int(roi["x1"]))
    y1 = min(height, int(roi["y1"]))
    return x0, y0, x1, y1


def make_alpha_template(bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Build a BGRA template with near-white background made transparent.

    Returns (bgra, binary_mask) where mask is 255 on glyph pixels.
    """
    if bgr.ndim != 3 or bgr.shape[2] < 3:
        raise ValueError("template crop must be BGR/BGRA")
    rgb = bgr[:, :, :3]
    # Near-white / card background → transparent
    white = (
        (rgb[:, :, 0] > 235)
        & (rgb[:, :, 1] > 235)
        & (rgb[:, :, 2] > 235)
    )
    # Also drop very light gray card fills
    light = (rgb.astype(np.int16).max(axis=2) - rgb.astype(np.int16).min(axis=2) < 12) & (
        rgb[:, :, 0] > 220
    )
    mask = (~(white | light)).astype(np.uint8) * 255
    # Keep only the largest connected ink blob(s) so badges/noise stay out
    num, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    cleaned = np.zeros_like(mask)
    keep = []
    for i in range(1, num):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < 12:
            continue
        keep.append((area, i))
    keep.sort(reverse=True)
    # Keep up to 12 components (cells / mediator / antibody parts)
    for _, i in keep[:12]:
        cleaned[labels == i] = 255
    # Soft morph close to fill tiny holes inside glyphs
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel)
    bgra = cv2.cvtColor(rgb, cv2.COLOR_BGR2BGRA)
    bgra[:, :, 3] = cleaned
    return bgra, cleaned


def normalize_legend_crops(
    crop_spec: tuple[int, int, int, int] | list[tuple[int, int, int, int]],
) -> list[tuple[int, int, int, int]]:
    """Normalize a single crop or 2-discrete part list into a list of boxes."""
    if isinstance(crop_spec, list):
        return list(crop_spec)
    return [crop_spec]


def extract_legend_templates(legend_bgr: np.ndarray) -> dict[str, list[np.ndarray]]:
    """
    Crop calibrated legend glyphs and write alpha PNGs under templates/.

    For iconInterpretation=2-discrete slugs, writes `{slug}.png` (first part /
    union preview) plus `{slug}--{part}.png` for each discrete part. Returns a
    map of slug → list of BGRA templates to search independently.
    """
    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
    icons = load_icon_interpretations()
    out: dict[str, list[np.ndarray]] = {}
    for slug, crop_spec in LEGEND_CROPS.items():
        boxes = normalize_legend_crops(crop_spec)
        part_names = LEGEND_CROP_PART_NAMES.get(slug) or [
            f"part{i}" for i in range(len(boxes))
        ]
        # Prefer fixture iconInterpretation when present.
        code = next((s.legend_code for s in LAYER_SPECS if s.slug == slug), "")
        icon = icons.get(code, "1-discrete" if len(boxes) == 1 else "2-discrete")
        templates: list[np.ndarray] = []
        for i, (x, y, w, h) in enumerate(boxes):
            crop = legend_bgr[y : y + h, x : x + w].copy()
            bgra, _ = make_alpha_template(crop)
            templates.append(bgra)
            if len(boxes) == 1:
                path = TEMPLATE_DIR / f"{slug}.png"
                cv2.imwrite(str(path), bgra)
                print(
                    f"  · template {slug}.png {w}×{h} "
                    f"alpha={int(np.count_nonzero(bgra[:, :, 3]))}px icon={icon}"
                )
            else:
                part = part_names[i] if i < len(part_names) else f"part{i}"
                part_path = TEMPLATE_DIR / f"{slug}--{part}.png"
                cv2.imwrite(str(part_path), bgra)
                print(
                    f"  · template {slug}--{part}.png {w}×{h} "
                    f"alpha={int(np.count_nonzero(bgra[:, :, 3]))}px icon={icon}"
                )
        if len(boxes) > 1:
            # Canonical slug PNG = horizontally concatenated parts (debug/compat).
            heights = [t.shape[0] for t in templates]
            max_h = max(heights)
            pads = []
            for t in templates:
                if t.shape[0] == max_h:
                    pads.append(t)
                else:
                    pad = np.zeros((max_h, t.shape[1], 4), dtype=np.uint8)
                    pad[: t.shape[0]] = t
                    pads.append(pad)
            concat = np.concatenate(pads, axis=1)
            cv2.imwrite(str(TEMPLATE_DIR / f"{slug}.png"), concat)
        out[slug] = templates
    return out


def ink_trim_bgra(bgra: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Trim a BGRA template to its non-transparent ink bounding box.

    Returns (bgr_crop, mask_crop).
    """
    mask = bgra[:, :, 3]
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return bgra[:, :, :3].copy(), mask.copy()
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    return bgra[y0:y1, x0:x1, :3].copy(), mask[y0:y1, x0:x1].copy()


def purple_boost(bgr: np.ndarray) -> np.ndarray:
    """Emphasize purple/magenta (high R+B vs G) for neutrophil/dendritic glyphs."""
    b, g, r = cv2.split(bgr)
    score = cv2.subtract(cv2.addWeighted(r, 0.5, b, 0.5, 0), g)
    return cv2.cvtColor(score, cv2.COLOR_GRAY2BGR)


def green_boost(bgr: np.ndarray) -> np.ndarray:
    """Emphasize green cytoplasm for alveolar-macrophage glyphs."""
    b, g, r = cv2.split(bgr)
    score = cv2.subtract(g, cv2.addWeighted(r, 0.5, b, 0.5, 0))
    return cv2.cvtColor(score, cv2.COLOR_GRAY2BGR)


def blue_boost(bgr: np.ndarray) -> np.ndarray:
    """Emphasize blue channel for virus / mediator glyphs."""
    b, g, r = cv2.split(bgr)
    score = cv2.subtract(b, cv2.addWeighted(r, 0.4, g, 0.4, 0))
    return cv2.cvtColor(score, cv2.COLOR_GRAY2BGR)


def edge_map(bgr: np.ndarray) -> np.ndarray:
    """Canny edge map as a 3-channel image for structural template matching."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 40, 120)
    edges = cv2.dilate(edges, np.ones((2, 2), np.uint8))
    return cv2.cvtColor(edges, cv2.COLOR_GRAY2BGR)


def apply_mode(bgr: np.ndarray, mode: str) -> np.ndarray:
    """Map a BGR image into the requested match-template color space."""
    if mode == "gray":
        g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        return cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
    if mode == "purple":
        return purple_boost(bgr)
    if mode == "green":
        return green_boost(bgr)
    if mode == "blue":
        return blue_boost(bgr)
    if mode == "edge":
        return edge_map(bgr)
    return bgr


def score_with_prior(
    score: float,
    center: tuple[float, float],
    expected: Iterable[tuple[int, int]],
) -> float:
    """Boost scores near expected centers so near-miss duplicates lose NMS."""
    if not expected:
        return score
    cx, cy = center
    dist = min(((cx - ex) ** 2 + (cy - ey) ** 2) ** 0.5 for ex, ey in expected)
    boost = max(0.0, 0.04 * (1.0 - min(dist, 80.0) / 80.0))
    return score + boost


def nms_matches(
    matches: list[dict],
    min_dist: int,
    max_keep: int,
) -> list[dict]:
    """Greedy non-maximum suppression on match centers."""
    matches = sorted(matches, key=lambda m: m.get("ranked", m["score"]), reverse=True)
    kept: list[dict] = []
    for m in matches:
        cx, cy = m["cx"], m["cy"]
        if any((cx - k["cx"]) ** 2 + (cy - k["cy"]) ** 2 < min_dist**2 for k in kept):
            continue
        kept.append(m)
        if len(kept) >= max_keep:
            break
    return kept


def accept_matches(candidates: list[dict], spec: LayerSpec) -> list[dict]:
    """
    Keep primary peaks ≥ min_score, plus secondary peaks near expected centers.

    Secondary recovery is the general multi-instance gate: a weaker second hit
    is accepted only when it clears min_score_secondary and lands near a prior
    that is not already covered by a stronger match.
    """
    if not candidates:
        return []
    secondary_floor = (
        spec.min_score_secondary if spec.min_score_secondary is not None else spec.min_score
    )
    primary = [m for m in candidates if m["score"] >= spec.min_score and not near_exclude(m["cx"], m["cy"], spec)]
    accepted = list(primary)

    for ex, ey in spec.expected_centers:
        if any(
            (m["cx"] - ex) ** 2 + (m["cy"] - ey) ** 2 < spec.nms_min_dist**2 for m in accepted
        ):
            continue
        nearby = [
            m
            for m in candidates
            if m["score"] >= secondary_floor
            and not near_exclude(m["cx"], m["cy"], spec)
            and (m["cx"] - ex) ** 2 + (m["cy"] - ey) ** 2 <= spec.expected_radius**2
        ]
        if not nearby:
            continue
        best = max(nearby, key=lambda m: m.get("ranked", m["score"]))
        if best not in accepted:
            accepted.append(best)

    return nms_matches(accepted, spec.nms_min_dist, spec.max_matches)


def collect_template_candidates(
    hay_bgr: np.ndarray,
    template_bgra: np.ndarray,
    spec: LayerSpec,
    part_name: str | None = None,
) -> list[dict]:
    """
    Multi-scale, multi-mode peak harvest for one template (no score gate yet).

    White legend backgrounds are replaced with each ROI's mean color before
    TM_CCOEFF_NORMED. Silhouette masks still come from the template alpha.
    """
    tmpl_bgr, tmpl_mask = ink_trim_bgra(template_bgra)
    if int(np.count_nonzero(tmpl_mask)) < 12:
        return []

    candidates: list[dict] = []
    for roi in spec.rois:
        x0, y0, x1, y1 = clamp_roi(roi, hay_bgr.shape[1], hay_bgr.shape[0])
        region = hay_bgr[y0:y1, x0:x1]
        if region.size == 0:
            continue
        fill = tuple(int(v) for v in region.reshape(-1, 3).mean(axis=0))
        filled = tmpl_bgr.copy()
        filled[tmpl_mask == 0] = fill

        for mode in spec.modes:
            region_m = apply_mode(region, mode)
            tmpl_m = apply_mode(filled, mode)
            for scale in spec.scales:
                th = max(8, int(round(tmpl_m.shape[0] * scale)))
                tw = max(8, int(round(tmpl_m.shape[1] * scale)))
                if region_m.shape[0] < th or region_m.shape[1] < tw:
                    continue
                interp = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR
                rt = cv2.resize(tmpl_m, (tw, th), interpolation=interp)
                rm = cv2.resize(tmpl_mask, (tw, th), interpolation=cv2.INTER_NEAREST)
                if int(np.count_nonzero(rm)) < 12:
                    continue
                result = cv2.matchTemplate(region_m, rt, cv2.TM_CCOEFF_NORMED)
                result = np.nan_to_num(result, nan=-1.0, posinf=-1.0, neginf=-1.0)
                work = result.copy()
                for _ in range(spec.peaks_per_scale):
                    _, max_val, _, max_loc = cv2.minMaxLoc(work)
                    if max_val < 0.35:
                        break
                    tx = x0 + int(max_loc[0])
                    ty = y0 + int(max_loc[1])
                    cx = tx + tw / 2.0
                    cy = ty + th / 2.0
                    # Discard oversized windows before NMS (prevents canvas smears).
                    if tw > spec.max_component_side or th > spec.max_component_side:
                        work[
                            max(0, max_loc[1] - th // 2) : min(work.shape[0], max_loc[1] + th // 2),
                            max(0, max_loc[0] - tw // 2) : min(work.shape[1], max_loc[0] + tw // 2),
                        ] = -1.0
                        continue
                    ranked = score_with_prior(float(max_val), (cx, cy), spec.expected_centers)
                    if near_exclude(cx, cy, spec):
                        work[
                            max(0, max_loc[1] - th // 2) : min(work.shape[0], max_loc[1] + th // 2),
                            max(0, max_loc[0] - tw // 2) : min(work.shape[1], max_loc[0] + tw // 2),
                        ] = -1.0
                        continue
                    cand = {
                        "score": float(max_val),
                        "ranked": ranked,
                        "scale": float(scale),
                        "mode": mode,
                        "x": tx,
                        "y": ty,
                        "w": tw,
                        "h": th,
                        "cx": cx,
                        "cy": cy,
                        "mask": (rm > 0).astype(np.uint8),
                    }
                    if part_name:
                        cand["part"] = part_name
                    candidates.append(cand)
                    # Suppress neighborhood for additional peaks
                    sy0 = max(0, max_loc[1] - th // 2)
                    sx0 = max(0, max_loc[0] - tw // 2)
                    sy1 = min(work.shape[0], max_loc[1] + th // 2)
                    sx1 = min(work.shape[1], max_loc[0] + tw // 2)
                    work[sy0:sy1, sx0:sx1] = -1.0

    return candidates


def search_layer(
    hay_bgr: np.ndarray,
    templates: list[np.ndarray] | np.ndarray,
    spec: LayerSpec,
) -> list[dict]:
    """
    Multi-scale template search for one layer (optionally multi-part).

    For 2-discrete layers, each legend part is searched independently and
    candidates are unioned before NMS + primary/secondary acceptance.
    """
    if isinstance(templates, np.ndarray):
        template_list = [templates]
        part_names: list[str | None] = [None]
    else:
        template_list = list(templates)
        names = LEGEND_CROP_PART_NAMES.get(spec.slug) or []
        part_names = [
            names[i] if i < len(names) else f"part{i}" for i in range(len(template_list))
        ]
        if len(template_list) == 1:
            part_names = [None]

    candidates: list[dict] = []
    for tmpl, part in zip(template_list, part_names):
        candidates.extend(collect_template_candidates(hay_bgr, tmpl, spec, part))

    secondary_floor = (
        spec.min_score_secondary if spec.min_score_secondary is not None else spec.min_score
    )
    floor = min(spec.min_score, secondary_floor)
    # Keep a wider pool through NMS so second instances survive peak competition.
    pool = nms_matches(candidates, spec.nms_min_dist, max(spec.max_matches * 4, 12))
    pool = [m for m in pool if m["score"] >= floor]
    return accept_matches(pool, spec)


def stamp_matches(canvas_h: int, canvas_w: int, matches: list[dict]) -> np.ndarray:
    """Union template alpha silhouettes from accepted matches into a binary mask."""
    mask = np.zeros((canvas_h, canvas_w), dtype=np.uint8)
    for m in matches:
        mh, mw = m["mask"].shape
        x, y = int(m["x"]), int(m["y"])
        x1 = min(canvas_w, x + mw)
        y1 = min(canvas_h, y + mh)
        if x1 <= x or y1 <= y:
            continue
        patch = m["mask"][: y1 - y, : x1 - x]
        region = mask[y:y1, x:x1]
        region[:] = np.maximum(region, patch)
    return mask


def silhouette_with_border(mask: np.ndarray, stroke_px: int) -> np.ndarray:
    """
    Build a thick outer RING around the silhouette (no solid fill smear).

    Dilates by ~stroke_px/2 and subtracts the original silhouette so the
    highlight is a hollow border hugging the glyph. For very small glyphs
    (<40 ink px) a 1px silhouette cue is retained so the mark stays visible.
    """
    mask = (mask > 0).astype(np.uint8)
    radius = max(1, stroke_px // 2)
    outer_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    outer = cv2.dilate(mask, outer_k, iterations=1)
    ring = cv2.subtract(outer, mask)
    ink = int(np.count_nonzero(mask))
    if ink < 40:
        # Tiny mediator/dot glyphs need a filled cue or they vanish
        return np.maximum(ring, mask)
    return ring


def mask_to_bgra_extract(hay_bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Copy source pixels under mask into a transparent BGRA canvas."""
    out = np.zeros((hay_bgr.shape[0], hay_bgr.shape[1], 4), dtype=np.uint8)
    sel = mask > 0
    out[sel, :3] = hay_bgr[sel]
    out[sel, 3] = 255
    return out


def ring_to_bgra(ring: np.ndarray, color_bgr: tuple[int, int, int]) -> np.ndarray:
    """Paint a binary ring as an opaque colored BGRA image."""
    out = np.zeros((ring.shape[0], ring.shape[1], 4), dtype=np.uint8)
    sel = ring > 0
    out[sel, 0] = color_bgr[0]
    out[sel, 1] = color_bgr[1]
    out[sel, 2] = color_bgr[2]
    out[sel, 3] = 255
    return out


def component_stats(mask: np.ndarray) -> list[dict]:
    """Measure connected-component bounding boxes on a binary mask."""
    num, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    comps = []
    for i in range(1, num):
        x, y, w, h, area = stats[i]
        if area <= 0:
            continue
        comps.append({"x": int(x), "y": int(y), "w": int(w), "h": int(h), "n": int(area)})
    return comps


def outline_overlaps_match(
    outline_bgra: np.ndarray,
    match: dict,
    radius: int = 18,
) -> bool:
    """
    Return True when the outline PNG has opaque pixels near the match center.

    This is the verify-composite gate: an accepted match must produce a visible
    outline that overlaps the matched instance (not a blank or displaced layer).
    """
    if outline_bgra is None or outline_bgra.size == 0:
        return False
    h, w = outline_bgra.shape[:2]
    cx, cy = int(round(match["cx"])), int(round(match["cy"]))
    x0, x1 = max(0, cx - radius), min(w, cx + radius + 1)
    y0, y1 = max(0, cy - radius), min(h, cy + radius + 1)
    if x1 <= x0 or y1 <= y0:
        return False
    return int(np.count_nonzero(outline_bgra[y0:y1, x0:x1, 3])) > 0


def match_meets_score_gate(match: dict, spec: LayerSpec) -> bool:
    """
    Return True when a match clears the primary or secondary score gate.

    Primary: score ≥ min_score. Secondary: score ≥ min_score_secondary and
    within expected_radius of an expected_center (multi-instance recovery).
    """
    if match["score"] >= spec.min_score:
        return True
    secondary_floor = (
        spec.min_score_secondary if spec.min_score_secondary is not None else spec.min_score
    )
    if match["score"] < secondary_floor:
        return False
    if not spec.expected_centers:
        return False
    return any(
        (match["cx"] - ex) ** 2 + (match["cy"] - ey) ** 2 <= spec.expected_radius**2
        for ex, ey in spec.expected_centers
    )


def assert_layer_qa(
    spec: LayerSpec,
    matches: list[dict],
    mask: np.ndarray,
    outline_bgra: np.ndarray | None = None,
) -> list[str]:
    """Hard QA gates: score, ROI center, cell-scale bounds, outline overlap."""
    errors: list[str] = []
    if not matches:
        errors.append(f"{spec.slug}: no matches ≥ {spec.min_score:.2f}")
        return errors

    if not any(m["score"] >= spec.min_score for m in matches):
        errors.append(
            f"{spec.slug}: no primary match ≥ {spec.min_score:.2f} "
            f"(best={max(m['score'] for m in matches):.3f})"
        )

    for i, m in enumerate(matches):
        if not match_meets_score_gate(m, spec):
            floor = (
                spec.min_score_secondary
                if spec.min_score_secondary is not None
                else spec.min_score
            )
            errors.append(
                f"{spec.slug}[{i}]: score {m['score']:.3f} below gates "
                f"(primary≥{spec.min_score:.2f} / secondary≥{floor:.2f}+prior)"
            )
        rois = spec.accept_rois or spec.rois
        if not any(point_in_roi(m["cx"], m["cy"], r) for r in rois):
            errors.append(
                f"{spec.slug}[{i}]: center ({m['cx']:.0f},{m['cy']:.0f}) outside accept ROIs"
            )
        # Reject giant template windows that smear half the canvas.
        if m["w"] > spec.max_component_side or m["h"] > spec.max_component_side:
            errors.append(
                f"{spec.slug}[{i}]: match window {m['w']}×{m['h']} exceeds "
                f"{spec.max_component_side}px"
            )
        if outline_bgra is not None and not outline_overlaps_match(outline_bgra, m):
            errors.append(
                f"{spec.slug}[{i}]: outline does not overlap match "
                f"({m['cx']:.0f},{m['cy']:.0f})"
            )

    pixel_count = int(np.count_nonzero(mask))
    if pixel_count > spec.max_pixel_count:
        errors.append(f"{spec.slug}: pixelCount {pixel_count} > {spec.max_pixel_count}")
    if pixel_count == 0:
        errors.append(f"{spec.slug}: empty mask")

    # Majority of mask must lie in accept ROIs
    if pixel_count and spec.accept_rois:
        ys, xs = np.where(mask > 0)
        inside = sum(
            1
            for x, y in zip(xs, ys)
            if any(point_in_roi(int(x), int(y), r) for r in spec.accept_rois)
        )
        ratio = inside / pixel_count
        if ratio < 0.85:
            errors.append(f"{spec.slug}: only {100*ratio:.1f}% pixels in accept ROIs (need ≥85%)")

    for c in component_stats(mask):
        if c["w"] > spec.max_component_side or c["h"] > spec.max_component_side:
            errors.append(
                f"{spec.slug}: component {c['w']}×{c['h']} exceeds "
                f"{spec.max_component_side}px cell bound ({c['n']}px)"
            )
    return errors


def write_empty_layer(slug: str, h: int, w: int) -> dict:
    """Write transparent PNGs for skipped (tier-0) layers."""
    empty = np.zeros((h, w, 4), dtype=np.uint8)
    cv2.imwrite(str(LAYER_DIR / f"{slug}.png"), empty)
    cv2.imwrite(str(LAYER_DIR / f"{slug}-outline.png"), empty)
    return {
        "x": 0,
        "y": 0,
        "width": 0,
        "height": 0,
        "pixelCount": 0,
        "components": 0,
        "tier": 0,
        "skipped": True,
        "method": "template-match-skip",
    }


def bbox_from_mask(mask: np.ndarray) -> dict | None:
    """Compute axis-aligned bbox + centroid for a binary mask."""
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return None
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    return {
        "x": x0,
        "y": y0,
        "width": x1 - x0 + 1,
        "height": y1 - y0 + 1,
        "cx": float(xs.mean()),
        "cy": float(ys.mean()),
        "count": int(len(xs)),
    }


def overlay_outline(
    base_bgr: np.ndarray,
    outline_bgra: np.ndarray,
    accent_bgr: tuple[int, int, int] | None = None,
) -> np.ndarray:
    """Composite a BGRA outline onto a BGR base, optionally recoloring the stroke."""
    out = base_bgr.copy()
    alpha = outline_bgra[:, :, 3].astype(np.float32) / 255.0
    if accent_bgr is not None:
        color = np.array(accent_bgr, dtype=np.float32)
    else:
        color = outline_bgra[:, :, :3].astype(np.float32)
    for c in range(3):
        out[:, :, c] = (
            alpha * color[c] + (1.0 - alpha) * out[:, :, c].astype(np.float32)
        ).astype(np.uint8)
    return out


def label_matches(
    img: np.ndarray,
    matches: list[dict],
    legend_code: str,
    color: tuple[int, int, int] = (0, 0, 255),
    tier: int | None = None,
) -> None:
    """
    Draw match centers with readable classification labels (debug/verify only).

    Format: `{code} {shortName}[:{part}] T{tier} {score}` e.g. `B3 Neutrophil T1 0.82`.
    """
    short = LEGEND_SHORT_NAMES.get(legend_code, legend_code)
    tier_tag = f" T{tier}" if tier is not None else ""
    for m in matches:
        cx, cy = int(m["cx"]), int(m["cy"])
        cv2.circle(img, (cx, cy), 7, color, 2)
        part = m.get("part")
        part_tag = f":{part}" if part else ""
        text = f"{legend_code} {short}{part_tag}{tier_tag} {m['score']:.2f}"
        # Dark halo for readability on busy artwork.
        origin = (cx + 10, max(14, cy - 10))
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (0, 0)):
            cv2.putText(
                img,
                text,
                (origin[0] + dx, origin[1] + dy),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.40,
                (0, 0, 0) if (dx, dy) != (0, 0) else color,
                2 if (dx, dy) != (0, 0) else 1,
                cv2.LINE_AA,
            )


def write_debug_composites(
    hay_bgr: np.ndarray,
    outlines: dict[str, np.ndarray],
    matches_by_slug: dict[str, list[dict]],
) -> None:
    """Write pathway verify composites and tight B5/B9 crops for visual QA."""
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    tier_by_slug = {s.slug: s.tier for s in LAYER_SPECS}
    code_by_slug = {s.slug: s.legend_code for s in LAYER_SPECS}

    def pathway_composite(pathway: str) -> np.ndarray:
        """Build a labeled pathway overlay for verify/preview QA."""
        img = hay_bgr.copy()
        accent = PATHWAY_ACCENT_BGR.get(pathway)
        for slug in PATHWAY_HIGHLIGHTS.get(pathway, []):
            if slug in outlines:
                img = overlay_outline(img, outlines[slug], accent)
            label_matches(
                img,
                matches_by_slug.get(slug, []),
                code_by_slug.get(slug, "?"),
                (0, 0, 255),
                tier=tier_by_slug.get(slug),
            )
        return img

    # Viruses
    viruses = pathway_composite("viruses")
    cv2.imwrite(str(DEBUG_DIR / "verify-viruses.png"), viruses)
    crop = viruses[60:180, 600:760].copy()
    cv2.imwrite(str(DEBUG_DIR / "verify-b9-crop.png"), crop)

    # Cigarette
    cig = pathway_composite("cigarette")
    cv2.imwrite(str(DEBUG_DIR / "verify-cigarette.png"), cig)
    cv2.imwrite(str(DEBUG_DIR / "verify-cigarette-junction.png"), cig[740:935, 420:700])
    cv2.imwrite(str(DEBUG_DIR / "verify-cigarette-lumen.png"), cig[200:380, 610:920])

    # Cannabis
    can = pathway_composite("cannabis")
    cv2.imwrite(str(DEBUG_DIR / "verify-cannabis.png"), can)

    # Vaping / B5
    vap = pathway_composite("vaping")
    cv2.imwrite(str(DEBUG_DIR / "verify-vaping.png"), vap)
    cv2.imwrite(str(DEBUG_DIR / "verify-b5-full.png"), vap)
    b5_matches = matches_by_slug.get("dendritic-cells", [])
    if b5_matches:
        xs = [int(m["cx"]) for m in b5_matches]
        ys = [int(m["cy"]) for m in b5_matches]
        x0, y0 = max(0, min(xs) - 100), max(0, min(ys) - 100)
        x1, y1 = min(CANVAS_W, max(xs) + 100), min(CANVAS_H, max(ys) + 100)
        cv2.imwrite(str(DEBUG_DIR / "verify-b5-crop.png"), vap[y0:y1, x0:x1])
        cv2.imwrite(str(DEBUG_DIR / "verify-b5-lumen-region.png"), vap[250:390, 650:860])
    else:
        cv2.imwrite(str(DEBUG_DIR / "verify-b5-crop.png"), vap[250:380, 650:860])


def write_previews(
    hay_bgr: np.ndarray,
    outlines: dict[str, np.ndarray],
    matches_by_slug: dict[str, list[dict]] | None = None,
) -> None:
    """Write pathway preview PNGs under previews/ (with QA labels when matches given)."""
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    matches_by_slug = matches_by_slug or {}
    tier_by_slug = {s.slug: s.tier for s in LAYER_SPECS}
    code_by_slug = {s.slug: s.legend_code for s in LAYER_SPECS}
    for pathway, slugs in PATHWAY_HIGHLIGHTS.items():
        img = hay_bgr.copy()
        accent = PATHWAY_ACCENT_BGR.get(pathway)
        for slug in slugs:
            if slug in outlines:
                img = overlay_outline(img, outlines[slug], accent)
            label_matches(
                img,
                matches_by_slug.get(slug, []),
                code_by_slug.get(slug, "?"),
                (0, 0, 255),
                tier=tier_by_slug.get(slug),
            )
        cv2.imwrite(str(PREVIEW_DIR / f"{pathway}.png"), img)


def write_generated_ts(bboxes: dict, width: int, height: int, report: dict) -> None:
    """Emit lungHealthLayers.generated.ts consumed by the runtime."""
    mean_score = report.get("tier1_mean_score")
    GENERATED_TS.write_text(
        f"""/**
 * AUTO-GENERATED by scripts/lung_template_match.py — do not edit by hand.
 */

export const lungHealthCutawayMeta = {{
	viewBox: '0 0 {width} {height}',
	width: {width},
	height: {height},
	sourceImage: '/figures/lung-health/cutaway-neutral.png',
	entryAnchor: {{ x: 512, y: 48 }},
	outdoorPortalAnchor: {{ x: 29, y: 49 }},
	transitionPortalScale: 0.3,
	outlineStrokePx: {OUTLINE_STROKE_PX},
	detectionMethod: 'opencv-template-match',
	tier1MeanMatchScore: {mean_score if mean_score is not None else 'null'},
}} as const;

export const lungHealthLayerBBoxes = {json.dumps(bboxes, indent='\t')} as const;

export type LungHealthLayerBBox = (typeof lungHealthLayerBBoxes)[keyof typeof lungHealthLayerBBoxes];
""",
        encoding="utf-8",
    )


def run_generate(
    source_png: Path | None = None,
    legend_png: Path | None = None,
) -> int:
    """
    Execute full template-match generation + hard QA.

    Optional source/legend paths override the checked-in defaults so the
    maintainer lab can try alternate diagram uploads without rewriting assets.
    """
    source = source_png or SOURCE_PNG
    legend = legend_png or LEGEND_PNG
    if not source.is_file():
        print(f"✗ Missing source PNG: {source}", file=sys.stderr)
        return 1
    if not legend.is_file():
        print(f"✗ Missing legend PNG: {legend}", file=sys.stderr)
        return 1

    hay_bgr = cv2.imread(str(source), cv2.IMREAD_COLOR)
    legend_bgr = cv2.imread(str(legend), cv2.IMREAD_COLOR)
    if hay_bgr is None or legend_bgr is None:
        print("✗ Failed to read source or legend PNG", file=sys.stderr)
        return 1
    h, w = hay_bgr.shape[:2]
    if (w, h) != (CANVAS_W, CANVAS_H):
        print(f"✗ Unexpected cutaway size {w}×{h}, expected {CANVAS_W}×{CANVAS_H}", file=sys.stderr)
        return 1

    LAYER_DIR.mkdir(parents=True, exist_ok=True)
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)

    print("✓ OpenCV multi-scale template match (TM_CCOEFF_NORMED)")
    print(f"✓ Outline stroke {OUTLINE_STROKE_PX}px (silhouette + border)")
    print("· Extracting legend templates…")
    templates = extract_legend_templates(legend_bgr)

    bboxes: dict[str, dict] = {}
    outlines: dict[str, np.ndarray] = {}
    matches_by_slug: dict[str, list[dict]] = {}
    qa_errors: list[str] = []
    report: dict = {"layers": {}, "method": "opencv-template-match"}

    # Search tier-1 first (specs list is already ordered)
    for spec in LAYER_SPECS:
        tmpl = templates.get(spec.slug)
        if tmpl is None:
            qa_errors.append(f"{spec.slug}: missing legend template")
            continue
        matches = search_layer(hay_bgr, tmpl, spec)
        # Drop heavy arrays from report serialization later
        matches_by_slug[spec.slug] = matches
        mask = stamp_matches(h, w, matches)
        ring = silhouette_with_border(mask, OUTLINE_STROKE_PX)
        extract = mask_to_bgra_extract(hay_bgr, mask)
        outline = ring_to_bgra(ring, OUTLINE_COLOR_BGR)
        cv2.imwrite(str(LAYER_DIR / f"{spec.slug}.png"), extract)
        cv2.imwrite(str(LAYER_DIR / f"{spec.slug}-outline.png"), outline)
        outlines[spec.slug] = outline

        bb = bbox_from_mask(mask)
        best = max((m["score"] for m in matches), default=0.0)
        if bb is None:
            bboxes[spec.slug] = {
                "x": 0,
                "y": 0,
                "width": 0,
                "height": 0,
                "pixelCount": 0,
                "components": 0,
                "tier": spec.tier,
                "method": "opencv-template-match",
                "bestScore": best,
            }
            print(f"  · T{spec.tier} {spec.legend_code} {spec.slug}: NO MATCH (need ≥{spec.min_score})")
        else:
            bboxes[spec.slug] = {
                "x": bb["x"],
                "y": bb["y"],
                "width": bb["width"],
                "height": bb["height"],
                "pixelCount": bb["count"],
                "components": len(matches),
                "tier": spec.tier,
                "cx": round(bb["cx"], 1),
                "cy": round(bb["cy"], 1),
                "method": "opencv-template-match",
                "bestScore": round(best, 4),
                "matches": [
                    {
                        "cx": m["cx"],
                        "cy": m["cy"],
                        "score": round(m["score"], 3),
                        "scale": m["scale"],
                        "mode": m.get("mode"),
                        **({"part": m["part"]} if m.get("part") else {}),
                    }
                    for m in matches
                ],
            }
            modes = ",".join(sorted({str(m.get("mode")) for m in matches}))
            parts = ",".join(sorted({str(m.get("part")) for m in matches if m.get("part")}))
            part_note = f" parts={parts}" if parts else ""
            print(
                f"  · T{spec.tier} {spec.legend_code} {spec.slug}: "
                f"{len(matches)} hit(s) best={best:.3f} mode={modes}{part_note} @ "
                f"({bb['cx']:.0f},{bb['cy']:.0f}) bbox {bb['width']}×{bb['height']} "
                f"px={bb['count']}"
            )

        qa_errors.extend(assert_layer_qa(spec, matches, mask, outline))
        report["layers"][spec.slug] = {
            "tier": spec.tier,
            "legendCode": spec.legend_code,
            "iconInterpretation": spec.icon_interpretation,
            "minScore": spec.min_score,
            "minScoreSecondary": spec.min_score_secondary,
            "bestScore": best,
            "matches": [
                {
                    "score": m["score"],
                    "scale": m["scale"],
                    "mode": m.get("mode"),
                    "cx": m["cx"],
                    "cy": m["cy"],
                    "w": m["w"],
                    "h": m["h"],
                    **({"part": m["part"]} if m.get("part") else {}),
                }
                for m in matches
            ],
        }

    for slug in SKIP_SLUGS:
        bboxes[slug] = write_empty_layer(slug, h, w)
        print(f"  · T0 {slug}: skipped")

    tier1_scores = [
        report["layers"][s]["bestScore"]
        for s in (
            "neutrophils",
            "alveolar-macrophages",
            "dendritic-cells",
            "infection-antiviral-pathway",
        )
        if s in report["layers"]
    ]
    report["tier1_mean_score"] = round(float(np.mean(tier1_scores)), 4) if tier1_scores else None
    report["qa_errors"] = qa_errors

    write_debug_composites(hay_bgr, outlines, matches_by_slug)
    write_previews(hay_bgr, outlines, matches_by_slug)
    write_generated_ts(bboxes, w, h, report)
    MATCH_REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"✓ Debug composites → {DEBUG_DIR}")
    print(f"✓ Match report → {MATCH_REPORT}")

    # Upsert durable findings DB + maintainer canvas (preserve firstFoundAt / cumulatives).
    try:
        from lung_findings_db import upsert_findings_db

        upsert_findings_db(match_report=report, write_canvas=True)
    except Exception as exc:  # noqa: BLE001 — generate should not fail solely on DB/canvas I/O
        print(f"· Findings DB refresh skipped: {exc}", file=sys.stderr)

    if qa_errors:
        print("\n✗ Template-match QA FAILED:", file=sys.stderr)
        for err in qa_errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    print("✓ QA passed (score / ROI / cell-scale)")
    print(f"✓ Tier-1 mean match score: {report['tier1_mean_score']}")
    return 0


def run_validate() -> int:
    """Validate that generated assets and last match report satisfy hard gates."""
    if not MATCH_REPORT.is_file():
        print("✗ No template-match-report.json — run lung:generate first", file=sys.stderr)
        return 1
    report = json.loads(MATCH_REPORT.read_text(encoding="utf-8"))
    errors: list[str] = list(report.get("qa_errors") or [])

    # Re-check outline assets exist for searchable layers
    for spec in LAYER_SPECS:
        outline = LAYER_DIR / f"{spec.slug}-outline.png"
        extract = LAYER_DIR / f"{spec.slug}.png"
        tmpl = TEMPLATE_DIR / f"{spec.slug}.png"
        if not outline.is_file() or not extract.is_file():
            errors.append(f"{spec.slug}: missing layer PNG(s)")
        if not tmpl.is_file():
            errors.append(f"{spec.slug}: missing template PNG")
        layer = report.get("layers", {}).get(spec.slug)
        if not layer:
            errors.append(f"{spec.slug}: missing from match report")
            continue
        if layer.get("bestScore", 0) < spec.min_score:
            errors.append(
                f"{spec.slug}: bestScore {layer.get('bestScore')} < {spec.min_score}"
            )
        if not layer.get("matches"):
            errors.append(f"{spec.slug}: zero accepted matches")
        else:
            outline_img = cv2.imread(str(outline), cv2.IMREAD_UNCHANGED)
            for i, m in enumerate(layer["matches"]):
                if not any(point_in_roi(m["cx"], m["cy"], r) for r in (spec.accept_rois or spec.rois)):
                    errors.append(
                        f"{spec.slug}[{i}]: center ({m['cx']:.0f},{m['cy']:.0f}) outside ROI"
                    )
                if outline_img is not None and outline_img.ndim == 3 and outline_img.shape[2] == 4:
                    if not outline_overlaps_match(outline_img, m):
                        errors.append(
                            f"{spec.slug}[{i}]: outline PNG does not overlap match "
                            f"({m['cx']:.0f},{m['cy']:.0f})"
                        )

    # Required verify composites
    for name in (
        "verify-viruses.png",
        "verify-cigarette.png",
        "verify-b9-crop.png",
        "verify-b5-crop.png",
    ):
        if not (DEBUG_DIR / name).is_file():
            errors.append(f"missing debug composite {name}")

    # Pathway verify composites must show outline ink where tier-1 matches land.
    verify_checks = (
        ("verify-viruses.png", "infection-antiviral-pathway"),
        ("verify-cigarette.png", "neutrophils"),
        ("verify-cigarette.png", "alveolar-macrophages"),
        ("verify-b5-full.png", "dendritic-cells"),
    )
    for fname, slug in verify_checks:
        path = DEBUG_DIR / fname
        layer = report.get("layers", {}).get(slug) or {}
        matches = layer.get("matches") or []
        if not path.is_file() or not matches:
            continue
        # Re-check via outline asset (verify PNG is RGB composite; use outline alpha).
        outline_img = cv2.imread(str(LAYER_DIR / f"{slug}-outline.png"), cv2.IMREAD_UNCHANGED)
        if outline_img is None:
            errors.append(f"{slug}: missing outline for verify overlap")
            continue
        for i, m in enumerate(matches):
            if not outline_overlaps_match(outline_img, m):
                errors.append(f"{fname}: {slug}[{i}] outline misses match center")

    if errors:
        print("✗ lung:validate-layers FAILED:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    print("✓ lung:validate-layers passed (template-match report + assets)")
    for slug in (
        "neutrophils",
        "alveolar-macrophages",
        "dendritic-cells",
        "infection-antiviral-pathway",
    ):
        layer = report["layers"][slug]
        print(f"  · T1 {slug}: best={layer['bestScore']:.3f} n={len(layer['matches'])}")
    return 0


def main() -> int:
    """CLI entry: --generate (default) or --validate."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validate", action="store_true", help="Validate last generate outputs")
    parser.add_argument("--generate", action="store_true", help="Run template-match generation")
    parser.add_argument(
        "--source",
        type=Path,
        default=None,
        help="Override cutaway PNG path (default: cutaway-neutral.png)",
    )
    parser.add_argument(
        "--legend",
        type=Path,
        default=None,
        help="Override legend PNG path (default: Lung Cutaway Legend Template.png)",
    )
    args = parser.parse_args()
    if args.validate and not args.generate:
        return run_validate()
    return run_generate(source_png=args.source, legend_png=args.legend)


if __name__ == "__main__":
    sys.exit(main())
