from __future__ import annotations
import argparse
import logging
import sys
from pathlib import Path

from rich.console import Console
from rich.logging import RichHandler
from rich.table import Table

from .pipeline import run

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    datefmt="[%X]",
    handlers=[RichHandler(rich_tracebacks=True)],
)
logger = logging.getLogger(__name__)
console = Console()


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="discover",
        description="Discovery Agent — extract enterprise systems from documents",
    )
    parser.add_argument(
        "documents",
        nargs="+",
        help="Files or directories to process",
    )
    parser.add_argument(
        "--output", "-o",
        default="inventory.json",
        help="Output JSON file (default: inventory.json)",
    )
    args = parser.parse_args()

    # Resolve paths — accept individual files or entire directories
    paths: List[str] = []
    for entry in args.documents:
        p = Path(entry)
        if p.is_dir():
            paths.extend(str(f) for f in sorted(p.iterdir()) if f.is_file())
        elif p.is_file():
            paths.append(str(p))
        else:
            console.print(f"[red]Not found: {entry}[/red]")

    if not paths:
        console.print("[red]No valid files found. Exiting.[/red]")
        sys.exit(1)

    console.print(f"\n[bold blue]Discovery Agent[/bold blue]")
    console.print(f"Processing {len(paths)} file(s)...\n")

    output = run(paths, output_path=args.output)

    # -----------------------------------------------------------------------
    # Systems table
    # -----------------------------------------------------------------------
    sys_table = Table(title="Discovered Systems", show_lines=True)
    sys_table.add_column("System", style="cyan", no_wrap=True)
    sys_table.add_column("Category", style="green")
    sys_table.add_column("Confidence", style="yellow")
    sys_table.add_column("Docs", style="white")
    sys_table.add_column("Review?", style="red")

    for system in sorted(output.systems, key=lambda s: s.confidence, reverse=True):
        sys_table.add_row(
            system.canonical_name,
            system.category,
            f"{system.confidence:.1f}%",
            ", ".join(system.source_documents),
            "YES" if system.needs_human_review else "",
        )

    console.print(sys_table)

    # -----------------------------------------------------------------------
    # Relationships table (if any)
    # -----------------------------------------------------------------------
    if output.relationships:
        rel_table = Table(title="Discovered Relationships", show_lines=True)
        rel_table.add_column("Source", style="cyan")
        rel_table.add_column("Relation", style="magenta")
        rel_table.add_column("Target", style="cyan")
        rel_table.add_column("Trigger", style="white")
        rel_table.add_column("Confidence", style="yellow")

        for rel in sorted(output.relationships, key=lambda r: r.confidence, reverse=True):
            rel_table.add_row(
                rel.source,
                rel.relation,
                rel.target,
                rel.trigger or "—",
                f"{rel.confidence:.1f}%",
            )
        console.print(rel_table)

    # -----------------------------------------------------------------------
    # Summary
    # -----------------------------------------------------------------------
    console.print(f"\n[bold]Summary[/bold]")
    console.print(f"  Documents processed : {output.total_documents_processed}")
    console.print(f"  Systems found       : {output.total_systems_found}")
    console.print(f"  Relationships found : {len(output.relationships)}")
    console.print(f"  Graph nodes         : {output.graph_stats.total_nodes}")
    console.print(f"  Graph edges         : {output.graph_stats.total_edges}")
    console.print(f"  Flagged for review  : {output.systems_flagged_for_review}")
    console.print(f"\n[bold green]Inventory written to:[/bold green] {args.output}\n")


if __name__ == "__main__":
    main()
