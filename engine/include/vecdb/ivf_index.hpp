#pragma once
#include "distance.hpp"
#include <vector>
#include <queue>
#include <unordered_map>
#include <random>
#include <fstream>
#include <shared_mutex>
#include <algorithm>

namespace vecdb {

class IVFIndex {
public:
    IVFIndex(size_t dim, size_t nlist = 16, size_t nprobe = 4, MetricType metric = MetricType::L2)
        : dim_(dim), nlist_(nlist), nprobe_(nprobe), metric_(metric), is_trained_(false) {
        inv_lists_.resize(nlist_);
        inv_vectors_.resize(nlist_);
    }

    size_t dimension() const { return dim_; }
    size_t nlist() const { return nlist_; }
    size_t nprobe() const { return nprobe_; }
    void set_nprobe(size_t nprobe) { nprobe_ = std::min(nprobe, nlist_); }
    bool is_trained() const { return is_trained_; }

    size_t size() const {
        std::shared_lock lock(rw_mutex_);
        size_t count = 0;
        for (const auto& list : inv_lists_) {
            count += list.size();
        }
        return count;
    }

    // Train centroids using k-means
    void train(const std::vector<float>& train_vectors, size_t max_iters = 20) {
        size_t n = train_vectors.size() / dim_;
        if (n < nlist_) {
            throw std::invalid_argument("Need at least nlist vectors to train centroids");
        }

        std::unique_lock lock(rw_mutex_);
        centroids_.resize(nlist_ * dim_);

        // Initialize centroids randomly from sample
        std::mt19937 rng(42);
        std::vector<size_t> indices(n);
        for (size_t i = 0; i < n; ++i) indices[i] = i;
        std::shuffle(indices.begin(), indices.end(), rng);

        for (size_t c = 0; c < nlist_; ++c) {
            size_t sample_idx = indices[c];
            std::copy(train_vectors.data() + sample_idx * dim_,
                      train_vectors.data() + (sample_idx + 1) * dim_,
                      centroids_.data() + c * dim_);
        }

        std::vector<size_t> cluster_sizes(nlist_, 0);
        std::vector<float> new_centroids(nlist_ * dim_, 0.0f);

        for (size_t iter = 0; iter < max_iters; ++iter) {
            std::fill(cluster_sizes.begin(), cluster_sizes.end(), 0);
            std::fill(new_centroids.begin(), new_centroids.end(), 0.0f);

            // Assignment step
            for (size_t i = 0; i < n; ++i) {
                const float* vec = train_vectors.data() + i * dim_;
                size_t best_c = 0;
                float best_dist = std::numeric_limits<float>::max();

                for (size_t c = 0; c < nlist_; ++c) {
                    float d = compute_distance(vec, centroids_.data() + c * dim_, dim_, metric_, true);
                    if (d < best_dist) {
                        best_dist = d;
                        best_c = c;
                    }
                }

                cluster_sizes[best_c]++;
                for (size_t d = 0; d < dim_; ++d) {
                    new_centroids[best_c * dim_ + d] += vec[d];
                }
            }

            // Update step
            for (size_t c = 0; c < nlist_; ++c) {
                if (cluster_sizes[c] > 0) {
                    float inv_sz = 1.0f / cluster_sizes[c];
                    for (size_t d = 0; d < dim_; ++d) {
                        centroids_[c * dim_ + d] = new_centroids[c * dim_ + d] * inv_sz;
                    }
                }
            }
        }

        is_trained_ = true;
    }

    void add(uint64_t id, const std::vector<float>& vec) {
        if (!is_trained_) {
            throw std::runtime_error("Index must be trained before adding vectors");
        }
        if (vec.size() != dim_) {
            throw std::invalid_argument("Vector dimension mismatch");
        }

        std::unique_lock lock(rw_mutex_);
        // Find closest centroid
        size_t best_c = 0;
        float best_dist = std::numeric_limits<float>::max();
        for (size_t c = 0; c < nlist_; ++c) {
            float d = compute_distance(vec.data(), centroids_.data() + c * dim_, dim_, metric_, true);
            if (d < best_dist) {
                best_dist = d;
                best_c = c;
            }
        }

        inv_lists_[best_c].push_back(id);
        inv_vectors_[best_c].insert(inv_vectors_[best_c].end(), vec.begin(), vec.end());
    }

    std::vector<SearchResult> search(const std::vector<float>& query, size_t k) const {
        if (!is_trained_) return {};
        if (query.size() != dim_) throw std::invalid_argument("Query dimension mismatch");

        std::shared_lock lock(rw_mutex_);

        // 1. Find nprobe closest centroids
        std::vector<std::pair<float, size_t>> centroid_dists;
        centroid_dists.reserve(nlist_);
        for (size_t c = 0; c < nlist_; ++c) {
            float d = compute_distance(query.data(), centroids_.data() + c * dim_, dim_, metric_, true);
            centroid_dists.push_back({d, c});
        }
        std::sort(centroid_dists.begin(), centroid_dists.end());

        // 2. Scan inverted lists for those top centroids
        using Element = std::pair<float, uint64_t>;
        std::priority_queue<Element> max_heap;

        size_t probes = std::min(nprobe_, nlist_);
        for (size_t p = 0; p < probes; ++p) {
            size_t c = centroid_dists[p].second;
            const auto& ids = inv_lists_[c];
            const auto& vecs = inv_vectors_[c];
            size_t list_size = ids.size();

            for (size_t i = 0; i < list_size; ++i) {
                const float* v_ptr = vecs.data() + i * dim_;
                float dist = compute_distance(query.data(), v_ptr, dim_, metric_, true);

                if (max_heap.size() < k) {
                    max_heap.push({dist, ids[i]});
                } else if (dist < max_heap.top().first) {
                    max_heap.pop();
                    max_heap.push({dist, ids[i]});
                }
            }
        }

        std::vector<SearchResult> results;
        results.reserve(max_heap.size());
        while (!max_heap.empty()) {
            results.push_back({max_heap.top().second, max_heap.top().first});
            max_heap.pop();
        }
        std::reverse(results.begin(), results.end());
        return results;
    }

    void save(const std::string& filepath) const {
        std::shared_lock lock(rw_mutex_);
        std::ofstream out(filepath, std::ios::binary);
        if (!out) throw std::runtime_error("Cannot open file for IVF save: " + filepath);

        uint32_t magic = 0x49564631; // 'IVF1'
        out.write(reinterpret_cast<const char*>(&magic), sizeof(magic));
        uint64_t d = dim_;
        uint64_t nl = nlist_;
        uint64_t np = nprobe_;
        uint32_t m = static_cast<uint32_t>(metric_);
        uint8_t trained = is_trained_ ? 1 : 0;

        out.write(reinterpret_cast<const char*>(&d), sizeof(d));
        out.write(reinterpret_cast<const char*>(&nl), sizeof(nl));
        out.write(reinterpret_cast<const char*>(&np), sizeof(np));
        out.write(reinterpret_cast<const char*>(&m), sizeof(m));
        out.write(reinterpret_cast<const char*>(&trained), sizeof(trained));

        if (is_trained_) {
            out.write(reinterpret_cast<const char*>(centroids_.data()), sizeof(float) * centroids_.size());
            for (size_t c = 0; c < nlist_; ++c) {
                uint64_t sz = inv_lists_[c].size();
                out.write(reinterpret_cast<const char*>(&sz), sizeof(sz));
                if (sz > 0) {
                    out.write(reinterpret_cast<const char*>(inv_lists_[c].data()), sizeof(uint64_t) * sz);
                    out.write(reinterpret_cast<const char*>(inv_vectors_[c].data()), sizeof(float) * sz * dim_);
                }
            }
        }
    }

    void load(const std::string& filepath) {
        std::unique_lock lock(rw_mutex_);
        std::ifstream in(filepath, std::ios::binary);
        if (!in) throw std::runtime_error("Cannot open file for IVF load: " + filepath);

        uint32_t magic = 0;
        in.read(reinterpret_cast<char*>(&magic), sizeof(magic));
        if (magic != 0x49564631) throw std::runtime_error("Invalid IVF magic header");

        uint64_t d = 0, nl = 0, np = 0;
        uint32_t m = 0;
        uint8_t trained = 0;

        in.read(reinterpret_cast<char*>(&d), sizeof(d));
        in.read(reinterpret_cast<char*>(&nl), sizeof(nl));
        in.read(reinterpret_cast<char*>(&np), sizeof(np));
        in.read(reinterpret_cast<char*>(&m), sizeof(m));
        in.read(reinterpret_cast<char*>(&trained), sizeof(trained));

        dim_ = d;
        nlist_ = nl;
        nprobe_ = np;
        metric_ = static_cast<MetricType>(m);
        is_trained_ = (trained != 0);

        centroids_.resize(nlist_ * dim_);
        inv_lists_.assign(nlist_, {});
        inv_vectors_.assign(nlist_, {});

        if (is_trained_) {
            in.read(reinterpret_cast<char*>(centroids_.data()), sizeof(float) * centroids_.size());
            for (size_t c = 0; c < nlist_; ++c) {
                uint64_t sz = 0;
                in.read(reinterpret_cast<char*>(&sz), sizeof(sz));
                inv_lists_[c].resize(sz);
                inv_vectors_[c].resize(sz * dim_);
                if (sz > 0) {
                    in.read(reinterpret_cast<char*>(inv_lists_[c].data()), sizeof(uint64_t) * sz);
                    in.read(reinterpret_cast<char*>(inv_vectors_[c].data()), sizeof(float) * sz * dim_);
                }
            }
        }
    }

private:
    size_t dim_;
    size_t nlist_;
    size_t nprobe_;
    MetricType metric_;
    bool is_trained_;

    std::vector<float> centroids_; // nlist_ * dim_
    std::vector<std::vector<uint64_t>> inv_lists_;
    std::vector<std::vector<float>> inv_vectors_;
    mutable std::shared_mutex rw_mutex_;
};

} // namespace vecdb
