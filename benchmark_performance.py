#!/usr/bin/env python3
"""
benchmark_performance.py
------------------------
Comprehensive performance and latency benchmark tool for OpenCubee2.
Measures and compares:
  1. Video Stream Throughput & Time-To-First-Byte (TTFB)
  2. Video Scrubbing / Byte-Range Seeking Latency (HTTP 206 Partial Content)
  3. Keyframe Burst Loading (Grid Render Simulation)
  4. Backend Isolation / Anti-Starvation Test (API responsiveness under heavy video streaming)

Usage:
  python3 benchmark_performance.py --help
  python3 benchmark_performance.py --backend http://localhost:2108 --nginx http://localhost:2408
"""

import argparse
import asyncio
import statistics
import sys
import time
from typing import Any, Dict, List, Optional
import urllib.parse

try:
    import httpx
except ImportError:
    print("Error: 'httpx' is required for async benchmarking. Please install it with: pip install httpx")
    sys.exit(1)


def format_bytes(num_bytes: float) -> str:
    for unit in ['B', 'KB', 'MB', 'GB']:
        if abs(num_bytes) < 1024.0:
            return f"{num_bytes:3.1f} {unit}"
        num_bytes /= 1024.0
    return f"{num_bytes:.1f} TB"


def format_ms(seconds: float) -> str:
    return f"{seconds * 1000.0:.2f} ms"


class BenchmarkRunner:
    def __init__(
        self,
        base_url: str,
        name: str,
        video_id: str = "K01_V001",
        sample_frames: Optional[List[str]] = None,
        concurrency: int = 20,
    ):
        self.base_url = base_url.rstrip("/")
        self.name = name
        self.video_id = video_id
        self.sample_frames = sample_frames or [f"K01_V001_{i:06d}.webp" for i in range(1, 41)]
        self.concurrency = concurrency

    async def create_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(30.0, connect=5.0),
            limits=httpx.Limits(max_keepalive_connections=50, max_connections=100),
            follow_redirects=True,
        )

    async def benchmark_video_ttfb_throughput(self, client: httpx.AsyncClient, duration_secs: float = 5.0) -> Dict[str, Any]:
        """Test streaming video chunks to measure TTFB and continuous download bandwidth."""
        url = f"/videos/{urllib.parse.quote(self.video_id)}"
        ttfb_list: List[float] = []
        total_bytes = 0
        
        start_time = time.time()
        chunks_downloaded = 0
        try:
            req_start = time.time()
            async with client.stream("GET", url) as response:
                if response.status_code not in (200, 206):
                    return {"error": f"HTTP {response.status_code}", "ttfb_ms": 0, "throughput_mbps": 0}
                
                ttfb = time.time() - req_start
                ttfb_list.append(ttfb)
                
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    total_bytes += len(chunk)
                    chunks_downloaded += 1
                    if time.time() - start_time >= duration_secs:
                        break
        except Exception as e:
            return {"error": str(e), "ttfb_ms": 0, "throughput_mbps": 0}

        elapsed = time.time() - start_time
        throughput_mbps = (total_bytes / (1024 * 1024)) / elapsed if elapsed > 0 else 0.0

        return {
            "ttfb_ms": ttfb_list[0] * 1000 if ttfb_list else 0.0,
            "throughput_mbps": throughput_mbps,
            "total_bytes_transferred": total_bytes,
            "elapsed_seconds": elapsed,
        }

    async def benchmark_video_scrubbing(self, client: httpx.AsyncClient, num_requests: int = 50) -> Dict[str, Any]:
        """Simulate video scrubbing / random seek by sending concurrent HTTP 206 Byte-Range requests."""
        url = f"/videos/{urllib.parse.quote(self.video_id)}"
        latencies: List[float] = []
        status_codes: Dict[int, int] = {}
        
        # Test range chunks representing 1MB blocks at various offsets
        ranges = [
            f"bytes={offset}-{offset + 1048575}"
            for offset in [0, 1048576, 5242880, 10485760, 20971520, 52428800]
        ]

        sem = asyncio.Semaphore(self.concurrency)

        async def fetch_range(range_header: str):
            async with sem:
                t0 = time.time()
                try:
                    res = await client.get(url, headers={"Range": range_header})
                    dt = time.time() - t0
                    latencies.append(dt)
                    status_codes[res.status_code] = status_codes.get(res.status_code, 0) + 1
                except Exception:
                    latencies.append(time.time() - t0)
                    status_codes[-1] = status_codes.get(-1, 0) + 1

        start_time = time.time()
        tasks = [fetch_range(ranges[i % len(ranges)]) for i in range(num_requests)]
        await asyncio.gather(*tasks)
        total_time = time.time() - start_time

        if not latencies:
            return {"error": "No successful requests"}

        return {
            "total_requests": len(latencies),
            "duration_secs": total_time,
            "rps": len(latencies) / total_time if total_time > 0 else 0.0,
            "mean_ms": statistics.mean(latencies) * 1000,
            "p50_ms": statistics.median(latencies) * 1000,
            "p95_ms": statistics.quantiles(latencies, n=20)[18] * 1000 if len(latencies) >= 20 else max(latencies) * 1000,
            "status_codes": status_codes,
        }

    async def benchmark_keyframe_burst(self, client: httpx.AsyncClient, count: int = 50) -> Dict[str, Any]:
        """Simulate loading a grid of search result keyframes simultaneously."""
        latencies: List[float] = []
        status_codes: Dict[int, int] = {}
        sem = asyncio.Semaphore(self.concurrency)

        async def fetch_frame(frame_name: str):
            async with sem:
                t0 = time.time()
                try:
                    res = await client.get(f"/keyframes/{urllib.parse.quote(frame_name)}")
                    dt = time.time() - t0
                    latencies.append(dt)
                    status_codes[res.status_code] = status_codes.get(res.status_code, 0) + 1
                except Exception:
                    latencies.append(time.time() - t0)
                    status_codes[-1] = status_codes.get(-1, 0) + 1

        start_time = time.time()
        tasks = [fetch_frame(self.sample_frames[i % len(self.sample_frames)]) for i in range(count)]
        await asyncio.gather(*tasks)
        total_time = time.time() - start_time

        return {
            "total_requests": len(latencies),
            "duration_secs": total_time,
            "rps": len(latencies) / total_time if total_time > 0 else 0.0,
            "mean_ms": statistics.mean(latencies) * 1000 if latencies else 0.0,
            "p50_ms": statistics.median(latencies) * 1000 if latencies else 0.0,
            "p95_ms": statistics.quantiles(latencies, n=20)[18] * 1000 if len(latencies) >= 20 else (max(latencies) * 1000 if latencies else 0.0),
            "status_codes": status_codes,
        }

    async def benchmark_api_starvation(self, client: httpx.AsyncClient, num_api_queries: int = 20) -> Dict[str, Any]:
        """Measure API responsiveness while heavy concurrent video streaming is ongoing."""
        stop_stream_flag = False
        api_latencies: List[float] = []

        # Background worker simulating 4 continuous video download streams
        async def continuous_video_stream():
            while not stop_stream_flag:
                try:
                    async with client.stream("GET", f"/videos/{urllib.parse.quote(self.video_id)}") as res:
                        async for _ in res.aiter_bytes(chunk_size=131072):
                            if stop_stream_flag:
                                break
                except Exception:
                    await asyncio.sleep(0.05)

        streamers = [asyncio.create_task(continuous_video_stream()) for _ in range(4)]

        # Let streaming saturate worker for a moment
        await asyncio.sleep(0.3)

        # Fire API requests concurrently
        sem = asyncio.Semaphore(5)
        async def call_api():
            async with sem:
                t0 = time.time()
                try:
                    res = await client.get(f"/video_info/{urllib.parse.quote(self.video_id)}")
                    api_latencies.append(time.time() - t0)
                except Exception:
                    api_latencies.append(time.time() - t0)

        tasks = [call_api() for _ in range(num_api_queries)]
        await asyncio.gather(*tasks)

        # Stop background streaming
        stop_stream_flag = True
        await asyncio.gather(*streamers, return_exceptions=True)

        return {
            "api_mean_ms": statistics.mean(api_latencies) * 1000 if api_latencies else 0.0,
            "api_p95_ms": statistics.quantiles(api_latencies, n=20)[18] * 1000 if len(api_latencies) >= 20 else (max(api_latencies) * 1000 if api_latencies else 0.0),
        }

    async def run_all(self) -> Dict[str, Any]:
        print(f"\n=======================================================")
        print(f" Running Benchmarks on: {self.name} ({self.base_url})")
        print(f"=======================================================")
        
        async with await self.create_client() as client:
            print("▶ [1/4] Measuring Video Streaming Throughput & TTFB...")
            stream_res = await self.benchmark_video_ttfb_throughput(client)
            print(f"   - TTFB: {stream_res.get('ttfb_ms', 0):.2f} ms")
            print(f"   - Throughput: {stream_res.get('throughput_mbps', 0):.2f} MB/s")

            print("\n▶ [2/4] Measuring Video Scrubbing / Byte-Range Seek Latency...")
            seek_res = await self.benchmark_video_scrubbing(client, num_requests=50)
            print(f"   - Median (p50): {seek_res.get('p50_ms', 0):.2f} ms")
            print(f"   - 95th Percentile (p95): {seek_res.get('p95_ms', 0):.2f} ms")
            print(f"   - Throughput: {seek_res.get('rps', 0):.1f} req/sec")

            print("\n▶ [3/4] Measuring Keyframe Burst Loading (50 concurrent frames)...")
            frame_res = await self.benchmark_keyframe_burst(client, count=50)
            print(f"   - Median (p50): {frame_res.get('p50_ms', 0):.2f} ms")
            print(f"   - 95th Percentile (p95): {frame_res.get('p95_ms', 0):.2f} ms")
            print(f"   - Throughput: {frame_res.get('rps', 0):.1f} req/sec")

            print("\n▶ [4/4] Measuring API Latency Under Heavy Video Load (Starvation Test)...")
            starve_res = await self.benchmark_api_starvation(client, num_api_queries=20)
            print(f"   - API Mean Latency: {starve_res.get('api_mean_ms', 0):.2f} ms")
            print(f"   - API p95 Latency: {starve_res.get('api_p95_ms', 0):.2f} ms")

            return {
                "stream": stream_res,
                "seek": seek_res,
                "keyframe": frame_res,
                "starvation": starve_res,
            }


def print_comparison_table(res_before: Dict[str, Any], res_after: Dict[str, Any], name_a: str, name_b: str):
    print("\n" + "=" * 78)
    print(f"{'PERFORMANCE COMPARISON SUMMARY':^78}")
    print("=" * 78)
    header = f"{'Metric':<38} | {name_a:<16} | {name_b:<16} | {'Speedup'}"
    print(header)
    print("-" * 78)

    # 1. Video TTFB
    t_a = res_before["stream"].get("ttfb_ms", 0.0)
    t_b = res_after["stream"].get("ttfb_ms", 0.0)
    spd = f"{t_a/t_b:.1f}x faster" if t_b > 0 and t_a > 0 else "-"
    print(f"{'Video TTFB (Time to First Byte)':<38} | {t_a:13.2f} ms | {t_b:13.2f} ms | {spd}")

    # 2. Video Streaming Bandwidth
    bw_a = res_before["stream"].get("throughput_mbps", 0.0)
    bw_b = res_after["stream"].get("throughput_mbps", 0.0)
    spd = f"{bw_b/bw_a:.1f}x higher" if bw_a > 0 and bw_b > 0 else "-"
    print(f"{'Video Streaming Throughput':<38} | {bw_a:11.2f} MB/s | {bw_b:11.2f} MB/s | {spd}")

    # 3. Video Scrubbing p95 Latency
    p95_a = res_before["seek"].get("p95_ms", 0.0)
    p95_b = res_after["seek"].get("p95_ms", 0.0)
    spd = f"{p95_a/p95_b:.1f}x faster" if p95_b > 0 and p95_a > 0 else "-"
    print(f"{'Video Scrubbing (p95 Latency)':<38} | {p95_a:13.2f} ms | {p95_b:13.2f} ms | {spd}")

    # 4. Keyframe Burst RPS
    rps_a = res_before["keyframe"].get("rps", 0.0)
    rps_b = res_after["keyframe"].get("rps", 0.0)
    spd = f"{rps_b/rps_a:.1f}x higher" if rps_a > 0 and rps_b > 0 else "-"
    print(f"{'Keyframe Burst Loading (RPS)':<38} | {rps_a:13.1f} rps | {rps_b:13.1f} rps | {spd}")

    # 5. API Starvation Latency
    st_a = res_before["starvation"].get("api_p95_ms", 0.0)
    st_b = res_after["starvation"].get("api_p95_ms", 0.0)
    spd = f"{st_a/st_b:.1f}x faster" if st_b > 0 and st_a > 0 else "-"
    print(f"{'API Latency During Video Load (p95)':<38} | {st_a:13.2f} ms | {st_b:13.2f} ms | {spd}")
    print("=" * 78)


async def main():
    parser = argparse.ArgumentParser(description="OpenCubee2 Video & Media Performance Benchmark Tool")
    parser.add_argument("--backend", default="http://localhost:2108", help="Direct FastAPI backend URL (e.g., http://localhost:2108)")
    parser.add_argument("--nginx", default="http://localhost:2408", help="Nginx Gateway URL (e.g., http://localhost:2408)")
    parser.add_argument("--video-id", default="K01_V001", help="Sample Video ID to benchmark")
    parser.add_argument("--concurrency", type=int, default=20, help="Concurrency for burst requests")
    parser.add_argument("--single-target", default=None, help="Benchmark only a single target URL instead of comparing")

    args = parser.parse_args()

    if args.single_target:
        runner = BenchmarkRunner(base_url=args.single_target, name="Single Target", video_id=args.video_id, concurrency=args.concurrency)
        await runner.run_all()
        return

    print("OpenCubee2 Performance Benchmarking Tool Initialized.")
    print(f"Target A (Before - Direct FastAPI): {args.backend}")
    print(f"Target B (After - Nginx Gateway):   {args.nginx}")
    print(f"Test Video: {args.video_id}")

    runner_a = BenchmarkRunner(base_url=args.backend, name="Direct FastAPI (Port 2108)", video_id=args.video_id, concurrency=args.concurrency)
    res_a = await runner_a.run_all()

    runner_b = BenchmarkRunner(base_url=args.nginx, name="Nginx Zero-Copy Gateway (Port 2408)", video_id=args.video_id, concurrency=args.concurrency)
    res_b = await runner_b.run_all()

    print_comparison_table(res_a, res_b, "Direct FastAPI", "Nginx Gateway")


if __name__ == "__main__":
    asyncio.run(main())
