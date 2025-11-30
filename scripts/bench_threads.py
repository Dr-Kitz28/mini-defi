"""
Benchmark script to find optimal thread count for your CPU.

Usage:
    python scripts/bench_threads.py [--model path/to/model.gguf]

This will test inference with 4, 6, 8, 10, 12 threads and report latencies.
Pick the thread count with the lowest average latency.
"""

import os
import sys
import time
import argparse
from pathlib import Path

# Parse args first
parser = argparse.ArgumentParser(description="Benchmark LLM inference with different thread counts")
parser.add_argument("--model", type=str, default=None, help="Path to GGUF model")
parser.add_argument("--runs", type=int, default=3, help="Number of runs per thread count")
args = parser.parse_args()

# Find model
BASE_DIR = Path(__file__).parent.parent
MODEL_DIR = BASE_DIR / "models"
DEFAULT_MODEL = "mistral-7b-instruct-v0.2.Q4_K_M.gguf"

model_path = args.model or (MODEL_DIR / DEFAULT_MODEL)
if not Path(model_path).exists():
    print(f"ERROR: Model not found at {model_path}")
    print("Please download the model first. See README.local-rag.md")
    sys.exit(1)

print("=" * 60)
print("LLM Thread Benchmark")
print("=" * 60)
print(f"Model: {model_path}")
print(f"Runs per config: {args.runs}")
print("=" * 60)

# Test prompt
PROMPT = """<s>[INST] You are a helpful assistant. Explain in 2-3 sentences how DeFi lending pools work and what is a health factor. [/INST]"""

def benchmark(n_threads: int, runs: int = 3):
    """Run benchmark with specified thread count."""
    # Set env vars before importing
    os.environ["OMP_NUM_THREADS"] = str(n_threads)
    os.environ["MKL_NUM_THREADS"] = str(n_threads)
    os.environ["OPENBLAS_NUM_THREADS"] = str(n_threads)
    
    from llama_cpp import Llama
    
    print(f"\n--- Testing n_threads = {n_threads} ---")
    
    # Load model
    t0 = time.time()
    llm = Llama(
        model_path=str(model_path),
        n_ctx=2048,
        n_threads=n_threads,
        n_gpu_layers=0,
        verbose=False
    )
    load_time = time.time() - t0
    print(f"Model load time: {load_time:.2f}s")
    
    # Warmup
    print("Warmup run...")
    _ = llm(PROMPT, max_tokens=64, echo=False)
    
    # Benchmark runs
    times = []
    tokens_list = []
    for i in range(runs):
        t0 = time.time()
        result = llm(PROMPT, max_tokens=128, echo=False)
        dt = time.time() - t0
        
        output_text = result["choices"][0]["text"]
        tokens = len(output_text.split())  # rough token estimate
        tokens_list.append(tokens)
        times.append(dt)
        
        print(f"  Run {i+1}: {dt:.2f}s (~{tokens} tokens, {tokens/dt:.1f} tok/s)")
    
    avg_time = sum(times) / len(times)
    avg_tokens = sum(tokens_list) / len(tokens_list)
    avg_speed = avg_tokens / avg_time
    
    print(f"  AVERAGE: {avg_time:.2f}s, {avg_speed:.1f} tok/s")
    
    # Cleanup to free memory
    del llm
    
    return {
        "threads": n_threads,
        "avg_time": avg_time,
        "min_time": min(times),
        "max_time": max(times),
        "avg_speed": avg_speed
    }

# Run benchmarks
results = []
thread_counts = [4, 6, 8, 10, 12]

print("\nStarting benchmark (this may take a few minutes)...")

for n in thread_counts:
    try:
        result = benchmark(n, args.runs)
        results.append(result)
    except Exception as e:
        print(f"  ERROR with {n} threads: {e}")

# Summary
print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)
print(f"{'Threads':<10} {'Avg Time':<12} {'Min Time':<12} {'Avg Speed':<12}")
print("-" * 46)

best = None
for r in results:
    print(f"{r['threads']:<10} {r['avg_time']:<12.2f} {r['min_time']:<12.2f} {r['avg_speed']:<12.1f}")
    if best is None or r['avg_time'] < best['avg_time']:
        best = r

if best:
    print("-" * 46)
    print(f"\n✓ RECOMMENDED: --threads {best['threads']} (fastest average: {best['avg_time']:.2f}s)")
    print(f"\nUse this in your server:")
    print(f"  python scripts/local_rag_server.py --threads {best['threads']}")
