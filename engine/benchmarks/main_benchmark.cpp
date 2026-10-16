#include <iostream>
#include <vector>
#include <chrono>
#include <random>
#include "vecdb/distance.hpp"
#include "vecdb/flat_index.hpp"
#include "vecdb/hnsw_index.hpp"
#include "vecdb/ivf_index.hpp"

using namespace vecdb;

int main() {
    std::cout << "===========================================\n";
    std::cout << " libvecdb Standalone C++ Engine Benchmark  \n";
    std::cout << "===========================================\n";

    const size_t dim = 384;
    const size_t num_vectors = 5000;
    std::mt19937 rng(1337);
    std::normal_distribution<float> dist(0.0f, 1.0f);

    std::vector<std::vector<float>> dataset(num_vectors, std::vector<float>(dim));
    for (size_t i = 0; i < num_vectors; ++i) {
        for (size_t d = 0; d < dim; ++d) {
            dataset[i][d] = dist(rng);
        }
    }

    // Benchmark SIMD vs Naive L2
    size_t trials = 100000;
    auto t0 = std::chrono::high_resolution_clock::now();
    for (size_t i = 0; i < trials; ++i) {
        l2_distance_naive(dataset[0].data(), dataset[1].data(), dim);
    }
    auto t1 = std::chrono::high_resolution_clock::now();
    for (size_t i = 0; i < trials; ++i) {
        l2_distance_avx2(dataset[0].data(), dataset[1].data(), dim);
    }
    auto t2 = std::chrono::high_resolution_clock::now();

    double naive_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
    double simd_ms = std::chrono::duration<double, std::milli>(t2 - t1).count();
    std::cout << "Distance Kernel (dim=" << dim << ", " << trials << " runs):\n";
    std::cout << "  Naive: " << naive_ms << " ms\n";
    std::cout << "  AVX2:  " << simd_ms << " ms\n";
    std::cout << "  Speedup: " << (naive_ms / simd_ms) << "x\n\n";

    // Build HNSW
    HNSWConfig cfg;
    cfg.M = 16;
    cfg.efConstruction = 128;
    cfg.efSearch = 64;
    HNSWIndex hnsw(dim, MetricType::L2, cfg);

    std::cout << "Building HNSW index for " << num_vectors << " vectors...\n";
    auto build_start = std::chrono::high_resolution_clock::now();
    for (size_t i = 0; i < num_vectors; ++i) {
        hnsw.add(i, dataset[i]);
    }
    auto build_end = std::chrono::high_resolution_clock::now();
    double build_sec = std::chrono::duration<double>(build_end - build_start).count();
    std::cout << "HNSW build complete in " << build_sec << " s\n";
    std::cout << "Max level: " << hnsw.get_max_level() << "\n\n";

    // Query 100 times
    auto q_start = std::chrono::high_resolution_clock::now();
    for (size_t i = 0; i < 100; ++i) {
        auto res = hnsw.search(dataset[i], 10, 64);
    }
    auto q_end = std::chrono::high_resolution_clock::now();
    double q_ms = std::chrono::duration<double, std::milli>(q_end - q_start).count() / 100.0;
    std::cout << "Average HNSW search latency: " << q_ms << " ms\n";
    std::cout << "===========================================\n";

    return 0;
}
