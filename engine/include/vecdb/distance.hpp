#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>
#include <cmath>
#include <stdexcept>
#include <immintrin.h>

namespace vecdb {

enum class MetricType {
    L2 = 0,
    INNER_PRODUCT = 1,
    COSINE = 2
};

struct SearchResult {
    uint64_t id{0};
    float score{0.0f}; // For L2: distance; for IP/Cosine: similarity (or inverted depending on ranking)
    
    bool operator>(const SearchResult& other) const {
        return score > other.score;
    }
    bool operator<(const SearchResult& other) const {
        return score < other.score;
    }
};

// ==========================================
// Distance Functions (Naive & SIMD AVX2)
// ==========================================

inline float l2_distance_naive(const float* a, const float* b, size_t dim) {
    float sum = 0.0f;
    for (size_t i = 0; i < dim; ++i) {
        float diff = a[i] - b[i];
        sum += diff * diff;
    }
    return sum;
}

inline float inner_product_naive(const float* a, const float* b, size_t dim) {
    float sum = 0.0f;
    for (size_t i = 0; i < dim; ++i) {
        sum += a[i] * b[i];
    }
    return sum;
}

inline float cosine_similarity_naive(const float* a, const float* b, size_t dim) {
    float dot = 0.0f;
    float norm_a = 0.0f;
    float norm_b = 0.0f;
    for (size_t i = 0; i < dim; ++i) {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    if (norm_a <= 0.0f || norm_b <= 0.0f) return 0.0f;
    return dot / (std::sqrt(norm_a) * std::sqrt(norm_b));
}

// AVX2 Distance Implementations
#if defined(__AVX2__) || defined(_M_AMD64) || defined(_M_X64)
inline float l2_distance_avx2(const float* a, const float* b, size_t dim) {
    size_t i = 0;
    __m256 sum256 = _mm256_setzero_ps();
    for (; i + 8 <= dim; i += 8) {
        __m256 va = _mm256_loadu_ps(a + i);
        __m256 vb = _mm256_loadu_ps(b + i);
        __m256 diff = _mm256_sub_ps(va, vb);
        sum256 = _mm256_fmadd_ps(diff, diff, sum256);
    }
    
    // Horizontal sum of sum256
    __m128 vlow = _mm256_castps256_ps128(sum256);
    __m128 vhigh = _mm256_extractf128_ps(sum256, 1);
    __m128 vsum = _mm_add_ps(vlow, vhigh);
    vsum = _mm_hadd_ps(vsum, vsum);
    vsum = _mm_hadd_ps(vsum, vsum);
    float total = _mm_cvtss_f32(vsum);

    // Remaining tail
    for (; i < dim; ++i) {
        float diff = a[i] - b[i];
        total += diff * diff;
    }
    return total;
}

inline float inner_product_avx2(const float* a, const float* b, size_t dim) {
    size_t i = 0;
    __m256 sum256 = _mm256_setzero_ps();
    for (; i + 8 <= dim; i += 8) {
        __m256 va = _mm256_loadu_ps(a + i);
        __m256 vb = _mm256_loadu_ps(b + i);
        sum256 = _mm256_fmadd_ps(va, vb, sum256);
    }

    __m128 vlow = _mm256_castps256_ps128(sum256);
    __m128 vhigh = _mm256_extractf128_ps(sum256, 1);
    __m128 vsum = _mm_add_ps(vlow, vhigh);
    vsum = _mm_hadd_ps(vsum, vsum);
    vsum = _mm_hadd_ps(vsum, vsum);
    float total = _mm_cvtss_f32(vsum);

    for (; i < dim; ++i) {
        total += a[i] * b[i];
    }
    return total;
}

inline float cosine_similarity_avx2(const float* a, const float* b, size_t dim) {
    size_t i = 0;
    __m256 dot256 = _mm256_setzero_ps();
    __m256 norm_a256 = _mm256_setzero_ps();
    __m256 norm_b256 = _mm256_setzero_ps();

    for (; i + 8 <= dim; i += 8) {
        __m256 va = _mm256_loadu_ps(a + i);
        __m256 vb = _mm256_loadu_ps(b + i);
        dot256 = _mm256_fmadd_ps(va, vb, dot256);
        norm_a256 = _mm256_fmadd_ps(va, va, norm_a256);
        norm_b256 = _mm256_fmadd_ps(vb, vb, norm_b256);
    }

    auto hsum256 = [](const __m256& v) -> float {
        __m128 vlow = _mm256_castps256_ps128(v);
        __m128 vhigh = _mm256_extractf128_ps(v, 1);
        __m128 vsum = _mm_add_ps(vlow, vhigh);
        vsum = _mm_hadd_ps(vsum, vsum);
        vsum = _mm_hadd_ps(vsum, vsum);
        return _mm_cvtss_f32(vsum);
    };

    float dot = hsum256(dot256);
    float norm_a = hsum256(norm_a256);
    float norm_b = hsum256(norm_b256);

    for (; i < dim; ++i) {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }

    if (norm_a <= 0.0f || norm_b <= 0.0f) return 0.0f;
    return dot / (std::sqrt(norm_a) * std::sqrt(norm_b));
}
#endif

// Fast Dispatchers
inline float compute_distance(const float* a, const float* b, size_t dim, MetricType metric, bool use_simd = true) {
    if (use_simd) {
#if defined(__AVX2__) || defined(_M_AMD64) || defined(_M_X64)
        switch (metric) {
            case MetricType::L2: return l2_distance_avx2(a, b, dim);
            case MetricType::INNER_PRODUCT: return -inner_product_avx2(a, b, dim); // negative IP so smaller is better
            case MetricType::COSINE: return 1.0f - cosine_similarity_avx2(a, b, dim); // 1 - cos so smaller is better
        }
#endif
    }
    switch (metric) {
        case MetricType::L2: return l2_distance_naive(a, b, dim);
        case MetricType::INNER_PRODUCT: return -inner_product_naive(a, b, dim);
        case MetricType::COSINE: return 1.0f - cosine_similarity_naive(a, b, dim);
    }
    return 0.0f;
}

} // namespace vecdb
