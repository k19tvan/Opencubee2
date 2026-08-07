#!/usr/bin/env python3
"""Pre-compute INTRO, REUSE and DUP labels for normal search results.

The job scans every BEiT3 vector in Qdrant, finds neighbours above the chosen
similarity threshold, and writes a compact frame-name -> labels lookup table.
It is resumable: rerun the exact same command after interruption.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.models import QueryRequest


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from backend.services.search import classify_similarity_match  # noqa: E402


PAYLOAD_FIELDS = ["frame_name", "video_id", "frame_id", "shot_id"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="Qdrant host")
    parser.add_argument("--port", type=int, default=6353, help="Qdrant HTTP port")
    parser.add_argument("--collection", default="beit3")
    parser.add_argument("--threshold", type=float, default=0.95)
    parser.add_argument("--intro-min-frame-gap", type=int, default=100)
    parser.add_argument("--intro-start-window-frames", type=int, default=300)
    parser.add_argument("--candidate-limit", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument(
        "--max-frames",
        type=int,
        default=0,
        help="Process at most this many frames in this run (0 processes all).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=REPO_ROOT / "storage" / "frame_similarity_labels.json",
    )
    return parser.parse_args()


def load_checkpoint(path: Path) -> tuple[dict[str, set[str]], Any]:
    if not path.exists():
        return {}, None
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    labels = {
        frame_name: set(frame_labels)
        for frame_name, frame_labels in data.get("labels", {}).items()
    }
    return labels, data.get("next_offset")


def save_checkpoint(
    path: Path,
    labels: dict[str, set[str]],
    next_offset: Any,
    args: argparse.Namespace,
    completed: bool,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "format_version": 1,
        "completed": completed,
        "threshold": args.threshold,
        "intro_min_frame_gap": args.intro_min_frame_gap,
        "intro_start_window_frames": args.intro_start_window_frames,
        "next_offset": next_offset,
        "labels": {
            frame_name: sorted(frame_labels)
            for frame_name, frame_labels in labels.items()
        },
    }
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    temp_path.replace(path)


def vector_for(point: Any) -> list[float] | None:
    vector = point.vector
    if isinstance(vector, dict):
        vector = next(iter(vector.values()), None)
    return vector if isinstance(vector, list) else None


def process_batch(
    client: QdrantClient,
    collection: str,
    points: list[Any],
    labels: dict[str, set[str]],
    args: argparse.Namespace,
) -> None:
    sources = [point for point in points if point.payload.get("frame_name") and vector_for(point)]
    if not sources:
        return

    requests = [
        QueryRequest(
            query=vector_for(point),
            limit=args.candidate_limit,
            score_threshold=args.threshold,
            with_payload=PAYLOAD_FIELDS,
        )
        for point in sources
    ]
    responses = client.query_batch_points(
        collection_name=collection,
        requests=requests,
        timeout=300,
    )
    for source, response in zip(sources, responses):
        source_name = source.payload["frame_name"]
        for hit in response.points:
            match_type = classify_similarity_match(
                source.payload,
                hit.payload,
                intro_min_frame_gap=args.intro_min_frame_gap,
                intro_start_window_frames=args.intro_start_window_frames,
            )
            if match_type:
                labels.setdefault(source_name, set()).add(match_type)


def main() -> None:
    args = parse_args()
    if not 0 < args.threshold <= 1:
        raise SystemExit("--threshold must be in (0, 1].")
    if args.batch_size < 1 or args.candidate_limit < 2:
        raise SystemExit("--batch-size must be >= 1 and --candidate-limit must be >= 2.")

    labels, offset = load_checkpoint(args.output)
    client = QdrantClient(host=args.host, port=args.port, prefer_grpc=False, timeout=300)
    processed = 0
    print(f"Resuming at offset={offset!r}; existing labelled frames={len(labels)}")

    while True:
        points, next_offset = client.scroll(
            collection_name=args.collection,
            offset=offset,
            limit=args.batch_size,
            with_vectors=True,
            with_payload=PAYLOAD_FIELDS,
        )
        if not points:
            save_checkpoint(args.output, labels, None, args, completed=True)
            print(f"Completed. Wrote {len(labels)} labelled frames to {args.output}")
            return

        process_batch(client, args.collection, points, labels, args)
        processed += len(points)
        offset = next_offset

        # Checkpoint after every batch so a long scan can be safely stopped.
        save_checkpoint(args.output, labels, offset, args, completed=False)
        print(f"Processed {processed} frames this run; labelled={len(labels)}", flush=True)

        if args.max_frames and processed >= args.max_frames:
            print("Stopped at --max-frames; rerun the same command to resume.")
            return


if __name__ == "__main__":
    main()
