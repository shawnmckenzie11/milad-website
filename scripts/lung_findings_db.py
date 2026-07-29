#!/usr/bin/env python3
"""
Durable legend findings database for lung cutaway template-match observability.

Merges classification fixtures + latest template-match-report.json into
`public/figures/lung-health/debug/legend-findings-db.json`, preserving
firstFoundAt / cumulativeFindCount across runs. Optionally rewrites the
maintainer Cursor Canvas with an embedded snapshot (canvas cannot fetch).
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from lung_io_paths import add_io_root_argument, analysis_layout

ROOT = Path(__file__).resolve().parents[1]
DEBUG_DIR = ROOT / "public/figures/lung-health/debug"
FINDINGS_DB = DEBUG_DIR / "legend-findings-db.json"
CLASSIFICATION_JSON = ROOT / "public/figures/lung-health/legend-classification.json"
EXTRACT_JSON = DEBUG_DIR / "legend-extract.json"
MATCH_REPORT = DEBUG_DIR / "template-match-report.json"
CANVAS_PATH = (
    Path.home()
    / ".cursor/projects/Users-shawnscomputer-Documents-milad-website"
    / "canvases/lung-legend-findings.canvas.tsx"
)

#: Set by --io-root; when present the run only touches that analysis's files.
IO_ROOT: Path | None = None


def apply_io_root(io_root: Path) -> None:
    """
    Point the findings DB at one analysis's own classification / report / DB.

    Each analysis keeps a separate findings database, so an upsert triggered by
    a job for analysis A must never merge analysis B's match report or overwrite
    B's DB — which is what a single fixed path made unavoidable.

    :param io_root: Analysis folder (``workspace/analyses/{id}``).
    """
    global IO_ROOT, DEBUG_DIR, FINDINGS_DB, CLASSIFICATION_JSON, EXTRACT_JSON, MATCH_REPORT
    layout = analysis_layout(io_root)
    IO_ROOT = layout["root"]
    DEBUG_DIR = layout["debug"]
    FINDINGS_DB = layout["findings"]
    CLASSIFICATION_JSON = layout["classification"]
    EXTRACT_JSON = layout["extract"]
    MATCH_REPORT = layout["match_report"]

# Owner-facing phase note for the dashboard header.
META_PHASE = (
    "Tier-1 refinement in progress (exact replicas: B3/B4/B5/B9). "
    "Tier-2 next (B6/B7/A1/B1)."
)

TIER_SUMMARIES = [
    {
        "tier": 1,
        "label": "Top — exact replicas",
        "summary": (
            "Exact legend replicas in the diagram; find with high confidence first. "
            "A structure may match the legend exactly but still be absent from the "
            "figure — do not search those."
        ),
        "focus": True,
    },
    {
        "tier": 2,
        "label": "Middle — partial / explicit marks",
        "summary": (
            "Eventually find; not 100% replicas. Explicitly present marks "
            "(mediators / signaling) and structures that appear as adjacent "
            "multiples in the legend but may show as individuals or a long row "
            "(~70% similarity)."
        ),
        "focus": False,
    },
    {
        "tier": 3,
        "label": "Lowest — scale / fractal hard",
        "summary": (
            "Present but difficult: fractal/scale continuations of a parent "
            "structure, or large fields that greatly differ in scale and are "
            "<60% similar to the glyph."
        ),
        "focus": False,
    },
    {
        "tier": 0,
        "label": "Skip — not searchable",
        "summary": (
            "Not properly diagrammed in the legend, or absent from the figure. "
            "Do not search."
        ),
        "focus": False,
    },
]

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

# Fallback when classification fixture lacks iconInterpretation.
ICON_BY_CODE: dict[str, str] = {
    "A1": "multiple-adjacent-as-one",
    "A2": "multiple-adjacent-as-one",
    "A3": "multiple-adjacent-as-one",
    "A4": "1-discrete",
    "B1": "multiple-adjacent-as-one",
    "B2": "1-discrete",
    "B3": "1-discrete",
    "B4": "1-discrete",
    "B5": "1-discrete",
    "B6": "2-discrete",
    "B7": "1-discrete",
    "B8": "1-discrete",
    "B9": "1-discrete",
}


def utc_now_iso() -> str:
    """Return an ISO-8601 UTC timestamp with second precision."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json(path: Path) -> dict[str, Any] | None:
    """Load a JSON object from disk, or None if missing/invalid."""
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _name_map(extract: dict[str, Any] | None) -> dict[str, str]:
    """Map legend code → display name from legend-extract.json."""
    out: dict[str, str] = {}
    if not extract:
        return out
    for item in extract.get("items") or []:
        code = item.get("code")
        name = item.get("name")
        if code and name:
            out[str(code)] = str(name)
    return out


def _extract_field_map(
    extract: dict[str, Any] | None, field: str
) -> dict[str, str]:
    """Map legend code → a string field from legend-extract.json items."""
    out: dict[str, str] = {}
    if not extract:
        return out
    for item in extract.get("items") or []:
        code = item.get("code")
        value = item.get(field)
        if code and value not in (None, ""):
            out[str(code)] = str(value)
    return out


def _report_by_code(report: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """
    Index template-match report layers by analysis letter code when present.

    Accepts either ``legendCode`` (legacy) or ``sourceCode`` (slug-first reports).
    Layers with neither are skipped here and joined later by slug.
    """
    by_code: dict[str, dict[str, Any]] = {}
    if not report:
        return by_code
    for slug, layer in (report.get("layers") or {}).items():
        code = layer.get("legendCode") or layer.get("sourceCode")
        if not code:
            continue
        entry = dict(layer)
        entry["slug"] = slug
        by_code[str(code)] = entry
    return by_code


def _report_by_slug(report: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Index template-match report layers by stable slug (report key / layer.slug)."""
    by_slug: dict[str, dict[str, Any]] = {}
    if not report:
        return by_slug
    for slug, layer in (report.get("layers") or {}).items():
        key = str(layer.get("slug") or slug or "").strip()
        if not key:
            continue
        entry = dict(layer)
        entry["slug"] = key
        by_slug[key] = entry
    return by_slug


def _slugify_name(name: str | None) -> str:
    """Kebab-case stable id from a legend item name (no letter-code fallback)."""
    import re

    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")


def _mean(scores: list[float]) -> float | None:
    """Return rounded mean or None for an empty list."""
    if not scores:
        return None
    return round(float(statistics.mean(scores)), 4)


def upsert_findings_db(
    *,
    match_report: dict[str, Any] | None = None,
    classification: dict[str, Any] | None = None,
    extract: dict[str, Any] | None = None,
    prior: dict[str, Any] | None = None,
    run_id: str | None = None,
    write_canvas: bool = True,
) -> dict[str, Any]:
    """
    Build/upsert the legend findings database from classification + match report.

    Preserves prior firstFoundAt and cumulativeFindCount when the DB already
    exists. Writes FINDINGS_DB and optionally regenerates the Cursor Canvas.
    """
    classification = classification or load_json(CLASSIFICATION_JSON) or {}
    extract = extract if extract is not None else load_json(EXTRACT_JSON)
    match_report = match_report if match_report is not None else load_json(MATCH_REPORT)
    prior = prior if prior is not None else load_json(FINDINGS_DB)

    now = utc_now_iso()
    run_id = run_id or now
    names = _name_map(extract)
    supports_map = _extract_field_map(extract, "supports")
    location_map = _extract_field_map(extract, "location")
    report_by_code = _report_by_code(match_report)
    report_by_slug = _report_by_slug(match_report)
    prior_items = (prior or {}).get("items") or {}
    prior_runs = list((prior or {}).get("runs") or [])

    classifications = classification.get("classifications") or {}
    if not classifications and "classifications" not in classification:
        # No classification document at all → the checked-in legend's fixture is
        # the intended source. A document that *declares* an empty map is a new
        # analysis with nothing classified yet: seeding it with the other
        # legend's A1–B9 rows is how Test 1 codes leaked into a Test 2 session.
        # Import late to avoid circular import when observability imports us.
        from lung_legend_observability import KNOWN_CLASSIFICATION  # type: ignore

        classifications = KNOWN_CLASSIFICATION

    try:
        from lung_legend_observability import KNOWN_CLASSIFICATION as _KNOWN_SLUGS  # type: ignore
    except ImportError:  # pragma: no cover
        _KNOWN_SLUGS = {}

    guidelines = classification.get("guidelines") or ""
    sub_tier_help = classification.get("subTierHelp") or {}

    items: dict[str, dict[str, Any]] = {}
    run_summary: dict[str, Any] = {
        "runId": run_id,
        "timestamp": now,
        "source": "template-match-report" if match_report else "classification-only",
        "tier1_mean_score": (match_report or {}).get("tier1_mean_score"),
        "qa_errors": list((match_report or {}).get("qa_errors") or []),
        "byCode": {},
    }

    def _code_sort_key(c: str) -> tuple:
        if len(c) >= 2 and c[1:].isdigit():
            return (c[0], int(c[1:]))
        return (c, 0)

    codes = sorted(classifications.keys(), key=_code_sort_key)
    for code in codes:
        cls = classifications[code]
        name = names.get(code) or ""
        # Prefer classification slug; else name→slug; else prior / known map.
        slug = (
            (cls.get("slug") or "").strip()
            or _slugify_name(name)
            or (prior_items.get(code) or {}).get("slug")
            or (_KNOWN_SLUGS.get(code) or {}).get("slug")
            or ""
        )
        layer = report_by_code.get(code) or (report_by_slug.get(slug) if slug else None)
        prior_item = prior_items.get(code) or {}
        if not slug and layer:
            slug = str(layer.get("slug") or "")
        raw_tier = cls.get("tier", 0)
        tier = int(raw_tier) if raw_tier is not None and raw_tier != "" else 0
        searchable = bool(cls.get("searchable")) if "searchable" in cls else tier > 0
        icon = cls.get("iconInterpretation") or ICON_BY_CODE.get(code, "1-discrete")

        matches = list((layer or {}).get("matches") or []) if layer else []
        scores = [float(m["score"]) for m in matches if m.get("score") is not None]
        best = max(scores) if scores else None
        mean_score = _mean(scores)
        instance_count = len(matches)

        if not searchable or tier == 0:
            status = "skipped"
        elif instance_count > 0:
            status = "found"
        elif match_report is not None and searchable:
            status = "missed"
        else:
            status = "missed" if searchable else "skipped"

        first_found = prior_item.get("firstFoundAt")
        last_found = prior_item.get("lastFoundAt")
        cumulative = int(prior_item.get("cumulativeFindCount") or 0)

        instances: list[dict[str, Any]] = []
        if status == "found":
            if first_found is None:
                first_found = now
            last_found = now
            cumulative += instance_count
            for m in matches:
                instances.append(
                    {
                        "cx": m.get("cx"),
                        "cy": m.get("cy"),
                        "score": m.get("score"),
                        "scale": m.get("scale"),
                        "mode": m.get("mode"),
                        "w": m.get("w"),
                        "h": m.get("h"),
                        "runId": run_id,
                        "timestamp": now,
                    }
                )

        item: dict[str, Any] = {
            "code": code,
            "name": names.get(code) or prior_item.get("name") or code,
            "slug": slug,
            "tier": tier,
            "subTier": cls.get("subTier"),
            "iconInterpretation": icon,
            "searchable": searchable,
            "group": cls.get("group"),
            "supports": supports_map.get(code)
            or prior_item.get("supports")
            or "",
            "location": location_map.get(code)
            or prior_item.get("location")
            or "",
            "status": status,
            "firstFoundAt": first_found,
            "lastFoundAt": last_found,
            "findCount": instance_count,
            "instanceCount": instance_count,
            "cumulativeFindCount": cumulative,
            "bestScore": best if best is not None else (layer or {}).get("bestScore"),
            "meanScore": mean_score,
            "minScore": (layer or {}).get("minScore"),
            "instances": instances,
        }
        if cls.get("note"):
            item["note"] = cls["note"]
        items[code] = item
        run_summary["byCode"][code] = {
            "status": status,
            "instanceCount": instance_count,
            "bestScore": items[code]["bestScore"],
        }

    # Keep a bounded run history (newest last).
    prior_runs.append(run_summary)
    runs = prior_runs[-40:]

    # Aggregate stats for dashboard header.
    def _tier_stats(t: int) -> dict[str, Any]:
        tier_items = [it for it in items.values() if it["tier"] == t]
        expected = [it for it in tier_items if it["searchable"]]
        found = [it for it in expected if it["status"] == "found"]
        scores = [
            float(it["bestScore"])
            for it in found
            if it.get("bestScore") is not None
        ]
        return {
            "expected": len(expected),
            "found": len(found),
            "missed": len(expected) - len(found),
            "skipped": len([it for it in tier_items if it["status"] == "skipped"]),
            "instanceTotal": sum(int(it["instanceCount"]) for it in found),
            "meanBestScore": _mean(scores),
        }

    db: dict[str, Any] = {
        "meta": {
            "updatedAt": now,
            "runId": run_id,
            "phase": META_PHASE,
            "focusTier": [1],
            "nextTier": 2,
            "sources": {
                "classification": str(CLASSIFICATION_JSON.relative_to(ROOT)),
                "extract": str(EXTRACT_JSON.relative_to(ROOT)),
                "matchReport": str(MATCH_REPORT.relative_to(ROOT)),
            },
        },
        "criteria": {
            "guidelines": guidelines,
            "tiers": TIER_SUMMARIES,
            "subTierHelp": sub_tier_help,
            "iconInterpretationHelp": ICON_INTERPRETATION_HELP,
        },
        "stats": {
            "tier0": _tier_stats(0),
            "tier1": _tier_stats(1),
            "tier2": _tier_stats(2),
            "tier3": _tier_stats(3),
            "tier1_mean_score_report": (match_report or {}).get("tier1_mean_score"),
        },
        "items": items,
        "runs": runs,
    }

    FINDINGS_DB.parent.mkdir(parents=True, exist_ok=True)
    FINDINGS_DB.write_text(json.dumps(db, indent=2), encoding="utf-8")
    print(f"✓ Findings DB → {FINDINGS_DB.relative_to(ROOT)}")

    if write_canvas:
        try:
            write_findings_canvas(db)
        except OSError as err:
            print(f"⚠ Findings canvas skipped ({err})")

    return db


def write_findings_canvas(db: dict[str, Any], path: Path = CANVAS_PATH) -> None:
    """
    Rewrite the maintainer Cursor Canvas with an embedded findings snapshot.

    Canvas files may only import from `cursor/canvas` and cannot fetch JSON,
    so the pipeline embeds the latest DB payload inline.
    """
    payload = json.dumps(db, indent=2)
    # Escape for TS template: embedded as const FINDINGS = ...
    tsx = _CANVAS_TEMPLATE.replace("__FINDINGS_JSON__", payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(tsx, encoding="utf-8")
    print(f"✓ Findings canvas → {path}")


_CANVAS_TEMPLATE = r'''/**
 * Maintainer dashboard: lung cutaway legend classification + template-match findings.
 * Regenerated by `npm run lung:findings` / `lung:generate` from legend-findings-db.json.
 * Not visitor-facing — do not surface on /projects.
 * Open beside chat for the live filterable dashboard.
 */
import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Spacer,
  Stack,
  Stat,
  Table,
  Text,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

type Instance = {
  cx: number | null;
  cy: number | null;
  score: number | null;
  scale?: number;
  mode?: string;
  runId?: string;
  timestamp?: string;
};

type LegendItem = {
  code: string;
  name: string;
  slug: string;
  tier: number;
  subTier: string;
  iconInterpretation: string;
  searchable: boolean;
  group: string;
  note?: string | null;
  status: "found" | "missed" | "skipped";
  firstFoundAt: string | null;
  lastFoundAt: string | null;
  findCount: number;
  instanceCount: number;
  cumulativeFindCount: number;
  bestScore: number | null;
  meanScore: number | null;
  minScore?: number;
  instances: Instance[];
};

type TierStats = {
  expected?: number;
  found?: number;
  missed?: number;
  skipped?: number;
  instanceTotal?: number;
  meanBestScore?: number | null;
};

type FindingsDb = {
  meta: {
    updatedAt: string;
    runId: string;
    phase: string;
    focusTier: number[];
    nextTier: number;
  };
  criteria: {
    guidelines: string;
    tiers: Array<{
      tier: number;
      label: string;
      summary: string;
      focus: boolean;
    }>;
    subTierHelp: Record<string, string>;
    iconInterpretationHelp: Record<string, string>;
  };
  stats: Record<string, TierStats>;
  items: Record<string, LegendItem>;
};

type TierFilter = "all" | "1" | "2" | "3" | "0";

const FINDINGS = __FINDINGS_JSON__ as unknown as FindingsDb;

/**
 * Format a confidence score for table display.
 */
function fmtScore(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(3);
}

/**
 * Format an ISO timestamp for compact table cells.
 */
function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.replace("T", " ").replace("+00:00", "Z");
}

/**
 * Format match centers as a short (cx,cy) list.
 */
function fmtLocs(instances: Instance[]): string {
  if (!instances.length) return "—";
  return instances
    .map((i) => `(${Math.round(Number(i.cx))},${Math.round(Number(i.cy))})`)
    .join(" · ");
}

/**
 * Map legend item status to a table row tone marker.
 */
function statusTone(
  status: LegendItem["status"],
): "success" | "danger" | "neutral" | undefined {
  if (status === "found") return "success";
  if (status === "missed") return "danger";
  if (status === "skipped") return "neutral";
  return undefined;
}

export default function LungLegendFindingsDashboard() {
  const theme = useHostTheme();
  const [tierFilter, setTierFilter] = useCanvasState<TierFilter>("tierFilter", "all");

  const items = Object.values(FINDINGS.items).sort((a, b) => {
    if (a.tier !== b.tier) {
      const order: Record<number, number> = { 1: 0, 2: 1, 3: 2, 0: 3 };
      return (order[a.tier] ?? 9) - (order[b.tier] ?? 9);
    }
    return a.code.localeCompare(b.code);
  });

  const filtered =
    tierFilter === "all"
      ? items
      : items.filter((it) => String(it.tier) === tierFilter);

  const t1 = FINDINGS.stats.tier1 ?? {};
  const t2 = FINDINGS.stats.tier2 ?? {};
  const t0 = FINDINGS.stats.tier0 ?? {};
  const t3 = FINDINGS.stats.tier3 ?? {};
  const tier1Complete =
    (t1.found ?? 0) === (t1.expected ?? 0) && (t1.expected ?? 0) > 0;

  return (
    <Stack gap={20} style={{ padding: 20 }}>
      <Stack gap={6}>
        <H1>Lung legend findings</H1>
        <Text tone="secondary" size="small">
          Maintainer observability DB · updated {fmtWhen(FINDINGS.meta.updatedAt)} · run{" "}
          {FINDINGS.meta.runId}
        </Text>
        <Callout tone="info" title="Current phase">
          {FINDINGS.meta.phase}
        </Callout>
      </Stack>

      <Stack gap={10}>
        <H2>Tier classification criteria</H2>
        <Text tone="secondary" size="small">
          Observability of mask — how clearly a legend glyph can be found in the cutaway.
        </Text>
        <Grid columns={2} gap={12}>
          {FINDINGS.criteria.tiers.map((t) => (
            <div key={t.tier}>
              <Card
                style={
                  t.focus
                    ? {
                        outline: `2px solid ${theme.accent.primary}`,
                        outlineOffset: 0,
                      }
                    : undefined
                }
              >
                <CardHeader
                  trailing={t.focus ? <Pill active size="sm">Focus</Pill> : undefined}
                >
                  {`Tier ${t.tier} — ${t.label}`}
                </CardHeader>
                <CardBody>
                  <Text size="small">{t.summary}</Text>
                </CardBody>
              </Card>
            </div>
          ))}
        </Grid>
        <H3>Icon interpretation</H3>
        <Table
          headers={["Mode", "Meaning"]}
          rows={Object.entries(FINDINGS.criteria.iconInterpretationHelp).map(
            ([k, v]) => [k, v],
          )}
          striped
        />
      </Stack>

      <Divider />

      <Stack gap={10}>
        <H2>Summary</H2>
        <Grid columns={4} gap={12}>
          <Stat
            value={`${t1.found ?? 0}/${t1.expected ?? 0}`}
            label="Tier-1 found / expected"
            tone={tier1Complete ? "success" : "warning"}
          />
          <Stat
            value={`${t2.found ?? 0}/${t2.expected ?? 0}`}
            label="Tier-2 progress"
            tone="info"
          />
          <Stat value={String(t0.skipped ?? 0)} label="Tier-0 skipped" />
          <Stat
            value={fmtScore(t1.meanBestScore)}
            label="Tier-1 mean best score"
            tone="success"
          />
        </Grid>
        <Grid columns={3} gap={12}>
          <Stat value={String(t1.instanceTotal ?? 0)} label="Tier-1 instances (latest)" />
          <Stat value={fmtScore(t2.meanBestScore)} label="Tier-2 mean best score" />
          <Stat
            value={`${t3.found ?? 0}/${t3.expected ?? 0}`}
            label="Tier-3 found / expected"
          />
        </Grid>
      </Stack>

      <Stack gap={10}>
        <Row gap={8} align="center" wrap>
          <H2>Legend items</H2>
          <Spacer />
          {(
            [
              ["all", "All"],
              ["1", "Tier 1"],
              ["2", "Tier 2"],
              ["3", "Tier 3"],
              ["0", "Tier 0"],
            ] as const
          ).map(([key, label]) => (
            <span key={key}>
              <Pill active={tierFilter === key} onClick={() => setTierFilter(key)}>
                {label}
              </Pill>
            </span>
          ))}
        </Row>
        <Table
          stickyHeader
          striped
          headers={[
            "Code",
            "Name",
            "Tier / sub",
            "Icon",
            "Status",
            "n",
            "Best",
            "Locations (cx,cy)",
            "First found",
            "Last found",
          ]}
          columnAlign={[
            "left",
            "left",
            "left",
            "left",
            "left",
            "right",
            "right",
            "left",
            "left",
            "left",
          ]}
          rowTone={filtered.map((it) => statusTone(it.status))}
          rows={filtered.map((it) => [
            it.tier === 1 ? (
              <Text weight="semibold" as="span">
                {it.code}
              </Text>
            ) : (
              it.code
            ),
            it.name,
            `T${it.tier} · ${it.subTier}`,
            it.iconInterpretation,
            it.status,
            String(it.instanceCount),
            fmtScore(it.bestScore),
            fmtLocs(it.instances),
            fmtWhen(it.firstFoundAt),
            fmtWhen(it.lastFoundAt),
          ])}
        />
        <Text tone="tertiary" size="small">
          Source: legend-findings-db.json · instance counts from latest
          template-match-report.json (not hardcoded). Cumulative counts preserved across runs.
        </Text>
      </Stack>
    </Stack>
  );
}
'''


def main() -> int:
    """CLI: upsert findings DB from on-disk classification + match report."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--no-canvas",
        action="store_true",
        help="Skip rewriting the Cursor Canvas snapshot",
    )
    add_io_root_argument(parser)
    args = parser.parse_args()
    if args.io_root is not None:
        apply_io_root(args.io_root)
    db = upsert_findings_db(write_canvas=not args.no_canvas)
    t1 = db["stats"]["tier1"]
    print(
        f"· Tier-1: {t1['found']}/{t1['expected']} found, "
        f"{t1['instanceTotal']} instances, mean best={t1['meanBestScore']}"
    )
    for code, item in db["items"].items():
        if item["tier"] != 1:
            continue
        print(
            f"  · {code} {item['slug']}: n={item['instanceCount']} "
            f"best={item['bestScore']} status={item['status']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
