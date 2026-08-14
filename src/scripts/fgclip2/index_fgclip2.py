from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import sqlite3
import uuid
from pathlib import Path

import numpy as np
from PIL import Image, UnidentifiedImageError

from src.host_model.fgclip2_runtime import FGClip2Embedder

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
POINT_NAMESPACE = uuid.UUID("d4b95135-9b2a-4667-a29b-e06619d3f78c")
DEFAULT_MODEL_REVISION = "4d1d5dc35c716902f07c172dbfc23b82a7bc6bf3"
STOP_REQUESTED = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build and embed resumable FG-CLIP 2 keyframe shards."
    )
    parser.add_argument(
        "--state-dir",
        type=Path,
        default=Path(os.getenv("FGCLIP2_STATE_DIR", "/root/fgclip2-state")),
        help="Fast local state directory for the manifest and completed chunks.",
    )
    parser.add_argument(
        "--model-revision",
        default=os.getenv("FGCLIP2_MODEL_REVISION", DEFAULT_MODEL_REVISION),
    )
    commands = parser.add_subparsers(dest="command", required=True)

    manifest = commands.add_parser("manifest", help="Create or resume the manifest.")
    manifest.add_argument(
        "--keyframe-dir",
        type=Path,
        default=Path(
            os.getenv(
                "FGCLIP2_KEYFRAME_DIR",
                "/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/"
                "Opencubee2_HCMAI25/results/keyframes/beit3_096",
            )
        ),
    )
    manifest.add_argument(
        "--shard-count",
        type=int,
        default=64,
        help="Stable number of independent shards.",
    )

    embed = commands.add_parser("embed", help="Export one manifest shard.")
    embed.add_argument("--shard-id", type=int, required=True)
    embed.add_argument("--chunk-size", type=int, default=5000)
    embed.add_argument("--max-items", type=int)
    return parser.parse_args()


def keyframes(root: Path):
    for directory, subdirectories, filenames in os.walk(root):
        subdirectories.sort()
        for filename in sorted(filenames):
            path = Path(directory, filename)
            if path.suffix.lower() in IMAGE_SUFFIXES:
                yield path


def payload_for(path: Path) -> dict[str, str | int]:
    stem = path.stem
    parts = stem.split("_")
    if len(parts) < 4:
        raise ValueError(f"Unexpected keyframe filename: {path.name}")

    return {
        "frame_name": path.name,
        "video_id": "_".join(parts[:2]),
        "shot_id": parts[-2],
        "frame_id": int(parts[-1]),
    }


def shard_for(frame_name: str, shard_count: int) -> int:
    digest = hashlib.blake2b(frame_name.encode(), digest_size=8).digest()
    return int.from_bytes(digest, "big") % shard_count


def manifest_path(state_dir: Path) -> Path:
    return state_dir / "manifest.sqlite3"


def open_manifest(state_dir: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(manifest_path(state_dir))
    connection.execute(
        "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS frames (
            frame_name TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            video_id TEXT NOT NULL,
            shot_id TEXT NOT NULL,
            frame_id INTEGER NOT NULL,
            shard_id INTEGER NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS frames_by_shard ON frames (shard_id, frame_name)"
    )
    return connection


def get_metadata(connection: sqlite3.Connection, key: str) -> str | None:
    row = connection.execute("SELECT value FROM metadata WHERE key = ?", (key,)).fetchone()
    return None if row is None else str(row[0])


def set_metadata(connection: sqlite3.Connection, key: str, value: str) -> None:
    connection.execute(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", (key, value)
    )


def ensure_manifest_metadata(
    connection: sqlite3.Connection,
    keyframe_dir: Path,
    shard_count: int,
    model_revision: str,
) -> None:
    expected = {
        "schema_version": "1",
        "keyframe_dir": str(keyframe_dir.resolve()),
        "shard_count": str(shard_count),
        "model_revision": model_revision,
    }
    for key, value in expected.items():
        existing = get_metadata(connection, key)
        if existing is not None and existing != value:
            raise ValueError(
                f"Manifest {key} is {existing!r}, but this run requires {value!r}."
            )
        set_metadata(connection, key, value)


def build_manifest(args: argparse.Namespace) -> None:
    if args.shard_count < 1:
        raise ValueError("shard-count must be positive.")
    if not args.keyframe_dir.is_dir():
        raise FileNotFoundError(f"Keyframe directory not found: {args.keyframe_dir}")

    args.state_dir.mkdir(parents=True, exist_ok=True)
    connection = open_manifest(args.state_dir)
    ensure_manifest_metadata(
        connection, args.keyframe_dir, args.shard_count, args.model_revision
    )
    if get_metadata(connection, "complete") == "true":
        count = connection.execute("SELECT COUNT(*) FROM frames").fetchone()[0]
        print(f"Manifest already complete with {count} keyframes.")
        return

    inserted = 0
    try:
        for path in keyframes(args.keyframe_dir):
            try:
                payload = payload_for(path)
            except ValueError as exc:
                print(f"Skipping invalid keyframe name {path.name}: {exc}")
                continue
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO frames
                    (frame_name, path, video_id, shot_id, frame_id, shard_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    payload["frame_name"],
                    str(path),
                    payload["video_id"],
                    payload["shot_id"],
                    payload["frame_id"],
                    shard_for(str(payload["frame_name"]), args.shard_count),
                ),
            )
            inserted += cursor.rowcount
            if inserted and inserted % 1000 == 0:
                connection.commit()
                print(f"Recorded {inserted} new keyframes.")
        set_metadata(connection, "complete", "true")
        connection.commit()
    finally:
        connection.close()

    connection = open_manifest(args.state_dir)
    count = connection.execute("SELECT COUNT(*) FROM frames").fetchone()[0]
    connection.close()
    print(f"Manifest complete with {count} keyframes.")


def request_stop(_: int, __: object) -> None:
    global STOP_REQUESTED
    STOP_REQUESTED = True


def write_chunk(
    output: Path,
    vectors: list[np.ndarray],
    point_ids: list[str],
    payloads: list[str],
    metadata: dict[str, str | int],
) -> None:
    partial = output.with_suffix(".partial")
    partial.unlink(missing_ok=True)
    with partial.open("wb") as file:
        np.savez_compressed(
            file,
            vectors=np.stack(vectors),
            point_ids=np.array(point_ids),
            payloads=np.array(payloads),
            metadata=np.array(json.dumps(metadata, sort_keys=True)),
        )
        file.flush()
        os.fsync(file.fileno())
    os.replace(partial, output)


def embed_shard(args: argparse.Namespace) -> None:
    if args.chunk_size < 1:
        raise ValueError("chunk-size must be positive.")

    connection = open_manifest(args.state_dir)
    shard_count = int(get_metadata(connection, "shard_count") or "0")
    if not 0 <= args.shard_id < shard_count:
        raise ValueError(f"shard-id must be within [0, {shard_count}).")
    if get_metadata(connection, "complete") != "true":
        raise RuntimeError("Manifest is incomplete. Run the manifest command first.")
    if get_metadata(connection, "model_revision") != args.model_revision:
        raise ValueError("Model revision does not match this manifest.")

    total = connection.execute(
        "SELECT COUNT(*) FROM frames WHERE shard_id = ?", (args.shard_id,)
    ).fetchone()[0]
    if args.max_items is not None:
        total = min(total, args.max_items)
    if total == 0:
        raise RuntimeError(f"No keyframes in shard {args.shard_id}.")

    output_dir = args.state_dir / "chunks" / f"shard-{args.shard_id:03d}"
    output_dir.mkdir(parents=True, exist_ok=True)
    embedder = FGClip2Embedder()
    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    for offset in range(0, total, args.chunk_size):
        if STOP_REQUESTED:
            print("Stop requested; completed chunks are safe to resume.")
            break
        part = offset // args.chunk_size
        output = output_dir / f"chunk-{part:06d}.npz"
        if output.exists():
            print(f"Skipping completed {output.name}")
            continue

        rows = connection.execute(
            """
            SELECT frame_name, path, video_id, shot_id, frame_id
            FROM frames WHERE shard_id = ?
            ORDER BY frame_name LIMIT ? OFFSET ?
            """,
            (args.shard_id, min(args.chunk_size, total - offset), offset),
        ).fetchall()
        vectors: list[np.ndarray] = []
        point_ids: list[str] = []
        payloads: list[str] = []

        for frame_name, path, video_id, shot_id, frame_id in rows:
            if STOP_REQUESTED:
                break
            try:
                with Image.open(path) as image:
                    vectors.append(embedder.embed_image(image))
            except (OSError, UnidentifiedImageError) as exc:
                print(f"Skipping unreadable image {path}: {exc}")
                continue
            payload = {
                "frame_name": frame_name,
                "video_id": video_id,
                "shot_id": shot_id,
                "frame_id": frame_id,
            }
            payloads.append(json.dumps(payload, ensure_ascii=False))
            point_ids.append(str(uuid.uuid5(POINT_NAMESPACE, f"fgclip2:{frame_name}")))

        if STOP_REQUESTED:
            print("Stop requested; current incomplete chunk was discarded.")
            break
        if not vectors:
            print(f"Skipping empty chunk {part}.")
            continue
        write_chunk(
            output,
            vectors,
            point_ids,
            payloads,
            {
                "model_revision": args.model_revision,
                "shard_id": args.shard_id,
                "part": part,
                "source_count": len(rows),
            },
        )
        print(
            f"Completed shard {args.shard_id}, chunk {part}: "
            f"{len(vectors)} vectors ({min(offset + len(rows), total)}/{total})."
        )

    connection.close()


def main() -> None:
    args = parse_args()
    if args.command == "manifest":
        build_manifest(args)
    else:
        embed_shard(args)


if __name__ == "__main__":
    main()
