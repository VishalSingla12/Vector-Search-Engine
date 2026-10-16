import time
import numpy as np
import libvecdb

def benchmark_simd():
    print("=== 1. Distance Functions SIMD vs Naive Benchmark ===")
    dim = 384
    n_trials = 100000
    a = np.random.randn(dim).astype(np.float32)
    b = np.random.randn(dim).astype(np.float32)

    # L2 Naive vs SIMD
    t0 = time.perf_counter()
    for _ in range(n_trials):
        _ = libvecdb.compute_distance_benchmark(a.tolist(), b.tolist(), libvecdb.MetricType.L2, False)
    t_naive = time.perf_counter() - t0

    t0 = time.perf_counter()
    for _ in range(n_trials):
        _ = libvecdb.compute_distance_benchmark(a.tolist(), b.tolist(), libvecdb.MetricType.L2, True)
    t_simd = time.perf_counter() - t0

    speedup = t_naive / t_simd if t_simd > 0 else 1.0
    print(f"L2 Distance ({n_trials} trials, dim={dim}):")
    print(f"  Naive: {t_naive*1000:.2f} ms | AVX2 SIMD: {t_simd*1000:.2f} ms | Speedup: {speedup:.2f}x")

def test_flat_and_hnsw():
    print("\n=== 2. HNSW vs Flat Index Accuracy & Latency ===")
    dim = 64
    n_vectors = 2000
    np.random.seed(42)
    vectors = np.random.randn(n_vectors, dim).astype(np.float32)
    
    flat = libvecdb.FlatIndex(dim, libvecdb.MetricType.L2)
    cfg = libvecdb.HNSWConfig()
    cfg.M = 16
    cfg.efConstruction = 100
    cfg.efSearch = 64
    hnsw = libvecdb.HNSWIndex(dim, libvecdb.MetricType.L2, cfg)

    print(f"Inserting {n_vectors} vectors...")
    t0 = time.perf_counter()
    for i in range(n_vectors):
        v = vectors[i].tolist()
        flat.add(i, v)
        hnsw.add(i, v)
    t_build = time.perf_counter() - t0
    print(f"Built both indexes in {t_build:.3f} s")
    print(f"HNSW max level: {hnsw.get_max_level()}, level counts: {hnsw.get_level_counts()}")

    # Measure Recall@10
    n_queries = 100
    k = 10
    recalls = []
    t_flat_total = 0.0
    t_hnsw_total = 0.0

    for q_i in range(n_queries):
        query = np.random.randn(dim).astype(np.float32).tolist()
        
        t0 = time.perf_counter()
        flat_res = flat.search(query, k, True)
        t_flat_total += (time.perf_counter() - t0)

        t0 = time.perf_counter()
        hnsw_res = hnsw.search(query, k, 64)
        t_hnsw_total += (time.perf_counter() - t0)

        flat_ids = set([r.id for r in flat_res])
        hnsw_ids = set([r.id for r in hnsw_res])
        intersect = len(flat_ids.intersection(hnsw_ids))
        recalls.append(intersect / float(k))

    avg_recall = np.mean(recalls) * 100
    avg_t_flat_ms = (t_flat_total / n_queries) * 1000
    avg_t_hnsw_ms = (t_hnsw_total / n_queries) * 1000

    print(f"Recall@{k}: {avg_recall:.2f}%")
    print(f"Average Flat query latency: {avg_t_flat_ms:.3f} ms")
    print(f"Average HNSW query latency: {avg_t_hnsw_ms:.3f} ms")

def test_ivf():
    print("\n=== 3. IVF Index Test ===")
    dim = 32
    n_vecs = 1000
    data = np.random.randn(n_vecs, dim).astype(np.float32)
    ivf = libvecdb.IVFIndex(dim, 16, 4, libvecdb.MetricType.L2)
    print("Training IVF centroids...")
    ivf.train(data.flatten().tolist(), 15)
    print(f"IVF trained: {ivf.is_trained()}")
    for i in range(n_vecs):
        ivf.add(i, data[i].tolist())
    print(f"IVF populated size: {ivf.size()}")
    res = ivf.search(data[0].tolist(), 5)
    print(f"IVF top-1 match for query vector 0: id={res[0].id}, dist={res[0].score:.4f}")

if __name__ == "__main__":
    benchmark_simd()
    test_flat_and_hnsw()
    test_ivf()
