from __future__ import annotations

import argparse
import io
import json
import os
import tarfile
import uuid
from itertools import chain
from pathlib import Path
from typing import Iterator

import numpy as np
from qdrant_client import QdrantClient, models

POINT_NAMESPACE = uuid.UUID("d4b95135-9b2a-4667-a29b-e06619d3f78c")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import FG-CLIP 2 NPZ embedding shards into Qdrant."
    )
    parser.add_argument("shards", nargs="*", type=Path)
    parser.add_argument(
        "--pc-archive",
        type=Path,
        help="PC export tar containing exports/fgclip2 batch NPZ files.",
    )
    parser.add_argument(
        "--audit-only",
        action="store_true",
        help="Validate source batches without creating or writing Qdrant data.",
    )
    parser.add_argument(
        "--max-vectors",
        type=int,
        help="Stop after this many vectors; useful for staging and audit.",
    )
    parser.add_argument(
        "--collection",
        default=os.getenv("QDRANT_COLLECTION_FGCLIP2", "fgclip2"),
    )
    parser.add_argument("--host", default=os.getenv("QDRANT_HOST", "localhost"))
    parser.add_argument("--port", type=int, default=int(os.getenv("QDRANT_PORT", "6333")))
    parser.add_argument("--batch-size", type=int, default=1024)
    return parser.parse_args()


def ensure_collection(client: QdrantClient, collection: str, dimension: int) -> None:
    collections = {item.name for item in client.get_collections().collections}
    if collection not in collections:
        client.create_collection(
            collection_name=collection,
            vectors_config=models.VectorParams(
                size=dimension,
                distance=models.Distance.COSINE,
            ),
        )
        return

    info = client.get_collection(collection)
    vector_params = info.config.params.vectors
    size = vector_params.size if isinstance(vector_params, models.VectorParams) else None
    if size != dimension:
        raise ValueError(
            f"Collection {collection!r} has dimension {size}, expected {dimension}."
        )


def existing_point_ids(client: QdrantClient, collection: str) -> set[str]:
    point_ids: set[str] = set()
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=collection,
            limit=2048,
            with_payload=False,
            with_vectors=False,
            offset=offset,
        )
        point_ids.update(str(point.id) for point in points)
        if offset is None:
            return point_ids


def points_from_shard(shard: Path) -> list[models.PointStruct]:
    with np.load(shard, allow_pickle=False) as data:
        vectors = data["vectors"]
        point_ids = data["point_ids"]
        payloads = data["payloads"]

    if not (len(vectors) == len(point_ids) == len(payloads)):
        raise ValueError(f"Invalid shard lengths in {shard}")
    return [
        models.PointStruct(
            id=str(point_id),
            vector=vector.tolist(),
            payload=json.loads(str(payload)),
        )
        for point_id, vector, payload in zip(point_ids, vectors, payloads)
    ]


def points_from_pc_batch(data: np.lib.npyio.NpzFile, source: str) -> list[models.PointStruct]:
    required = {"vectors", "frame_names", "video_ids", "frame_ids", "shot_ids"}
    missing = required.difference(data.files)
    if missing:
        raise ValueError(f"PC batch {source} is missing keys: {sorted(missing)}")

    vectors = data["vectors"]
    frame_names = data["frame_names"]
    video_ids = data["video_ids"]
    frame_ids = data["frame_ids"]
    shot_ids = data["shot_ids"]
    if not (
        len(vectors)
        == len(frame_names)
        == len(video_ids)
        == len(frame_ids)
        == len(shot_ids)
    ):
        raise ValueError(f"Invalid PC batch lengths in {source}")

    return [
        models.PointStruct(
            id=str(uuid.uuid5(POINT_NAMESPACE, f"fgclip2:{frame_name}")),
            vector=vector.tolist(),
            payload={
                "frame_name": str(frame_name),
                "video_id": str(video_id),
                "frame_id": int(frame_id),
                "shot_id": str(shot_id),
            },
        )
        for vector, frame_name, video_id, frame_id, shot_id in zip(
            vectors, frame_names, video_ids, frame_ids, shot_ids
        )
    ]


def pc_archive_batches(archive: Path) -> Iterator[tuple[str, list[models.PointStruct]]]:
    with tarfile.open(archive, "r|") as tar:
        for member in tar:
            if not member.isfile() or not member.name.endswith(".npz"):
                continue
            if not member.name.startswith("exports/fgclip2/"):
                continue
            file = tar.extractfile(member)
            if file is None:
                continue
            with np.load(io.BytesIO(file.read()), allow_pickle=False) as data:
                yield member.name, points_from_pc_batch(data, member.name)


def source_batches(args: argparse.Namespace) -> Iterator[tuple[str, list[models.PointStruct]]]:
    if args.pc_archive:
        if not args.pc_archive.is_file():
            raise FileNotFoundError(args.pc_archive)
        yield from pc_archive_batches(args.pc_archive)
        return

    if not args.shards:
        raise ValueError("Provide shard paths or --pc-archive.")
    for shard in args.shards:
        if not shard.is_file():
            raise FileNotFoundError(shard)
        yield str(shard), points_from_shard(shard)


def limited(
    batches: Iterator[tuple[str, list[models.PointStruct]]],
    max_vectors: int | None,
) -> Iterator[tuple[str, list[models.PointStruct]]]:
    remaining = max_vectors
    for source, points in batches:
        if remaining is not None and remaining <= 0:
            return
        selected = points if remaining is None else points[:remaining]
        if selected:
            yield source, selected
            if remaining is not None:
                remaining -= len(selected)


def main() -> None:
    args = parse_args()
    batches = limited(source_batches(args), args.max_vectors)
    try:
        first_source, first_points = next(batches)
    except StopIteration as exc:
        raise ValueError("Source contains no vectors.") from exc
    if not first_points:
        raise ValueError(f"Source batch is empty: {first_source}")

    if args.audit_only:
        sample = first_points[0]
        print(
            f"Audit passed: source={first_source} vectors={len(first_points)} "
            f"dimension={len(sample.vector)} frame={sample.payload['frame_name']}"
        )
        return

    dimension = len(first_points[0].vector)

    client = QdrantClient(host=args.host, port=args.port, timeout=120)
    ensure_collection(client, args.collection, dimension)
    imported_ids = existing_point_ids(client, args.collection)

    pending: list[models.PointStruct] = []
    total = 0
    skipped = 0
    for _source, points in chain([(first_source, first_points)], batches):
        original_count = len(points)
        points = [point for point in points if str(point.id) not in imported_ids]
        skipped += original_count - len(points)
        pending.extend(points)
        total += len(points)
        while len(pending) >= args.batch_size:
            client.upsert(
                collection_name=args.collection,
                points=pending[: args.batch_size],
                wait=True,
            )
            del pending[: args.batch_size]

    if pending:
        client.upsert(
            collection_name=args.collection,
            points=pending,
            wait=True,
        )
    print(f"Imported {total} vectors into {args.collection}; skipped {skipped} existing vectors.")


if __name__ == "__main__":
    main()
