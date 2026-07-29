#!/usr/bin/env python3
"""
Analysis-scoped IO layout for the lung pipeline scripts.

The template-match / findings / legend-extract steps used to read and write one
fixed set of paths under `public/figures/lung-health/**`. That made every run an
implicit write to "whatever the lab happened to have live", so a second UI
session (or a second agent) could overwrite or blank the artifacts a running job
depended on.

Each script now accepts `--io-root DIR`, and this module is the single place that
says which file lives where inside such a root. The layout must stay identical to
`analysisPaths()` in `tools/lung-legend-lab/server/analyses.mjs`, since the lab
passes an analysis folder (`workspace/analyses/{id}/`) as the IO root.

Without `--io-root` the scripts keep writing the checked-in site tree, so
`npm run lung:generate` still regenerates the published figure assets.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

#: Checked-in site tree (the default IO root when no analysis is given).
SITE_FIGURES = ROOT / "public/figures/lung-health"


def analysis_layout(io_root: Path) -> dict[str, Path]:
    """
    Resolve every pipeline artifact path inside an analysis-scoped IO root.

    Keys mirror the JS `analysisPaths()` helper so both sides of the lab agree on
    where an analysis keeps its own database files.

    :param io_root: Analysis folder (``workspace/analyses/{id}``) or any private
        working directory a job may own.
    :returns: Mapping of artifact key to absolute path.
    """
    root = Path(io_root).resolve()
    return {
        "root": root,
        "cutaway": root / "cutaway.png",
        "legend": root / "legend.png",
        "extract": root / "legend-extract.json",
        "classification": root / "legend-classification.json",
        "findings": root / "legend-findings-db.json",
        "match_report": root / "template-match-report.json",
        "annotations": root / "lab-annotations.json",
        "training_feedback": root / "lab-training-feedback.json",
        "layers": root / "layers",
        "legend_items": root / "legend-items",
        "freehand_icons": root / "freehand-icons",
        "templates": root / "templates",
        "previews": root / "previews",
        "debug": root / "debug",
    }


def site_layout() -> dict[str, Path]:
    """
    Resolve the checked-in site-tree layout (historic fixed pipeline paths).

    :returns: Mapping with the same keys as :func:`analysis_layout`.
    """
    debug = SITE_FIGURES / "debug"
    return {
        "root": SITE_FIGURES,
        "cutaway": SITE_FIGURES / "cutaway-neutral.png",
        "legend": SITE_FIGURES / "Lung Cutaway Legend Template.png",
        "extract": debug / "legend-extract.json",
        "classification": SITE_FIGURES / "legend-classification.json",
        "findings": debug / "legend-findings-db.json",
        "match_report": debug / "template-match-report.json",
        "annotations": debug / "lab-annotations.json",
        "training_feedback": ROOT / "tools/lung-legend-lab/workspace/lab-training-feedback.json",
        "layers": SITE_FIGURES / "layers",
        "legend_items": debug / "legend-items",
        "freehand_icons": ROOT / "tools/lung-legend-lab/workspace/freehand-icons",
        "templates": SITE_FIGURES / "templates",
        "previews": SITE_FIGURES / "previews",
        "debug": debug,
    }


def resolve_layout(io_root: Path | str | None) -> dict[str, Path]:
    """
    Pick the analysis layout when an IO root is given, else the site layout.

    :param io_root: Analysis folder / private working dir, or ``None``.
    :returns: Artifact path mapping.
    """
    if io_root in (None, ""):
        return site_layout()
    return analysis_layout(Path(io_root))


def add_io_root_argument(parser) -> None:
    """
    Register the shared ``--io-root`` flag on an argparse parser.

    :param parser: ``argparse.ArgumentParser`` to extend.
    """
    parser.add_argument(
        "--io-root",
        type=Path,
        default=None,
        help=(
            "Read/write pipeline artifacts inside this analysis folder "
            "(tools/lung-legend-lab/workspace/analyses/{id}) instead of the "
            "checked-in site tree. Keeps concurrent analyses from sharing files."
        ),
    )
