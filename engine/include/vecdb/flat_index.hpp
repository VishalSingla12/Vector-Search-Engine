#pragma once
#include "distance.hpp"
#include <queue>
#include <mutex>
#include <shared_mutex>
#include <algorithm>
#include <fstream>
#include <unordered_map>

namespace vecdb {

class FlatIndex {
public:
    FlatIndex(size_t dim, MetricType metric = MetricType::L2)
        : dim_(dim), metric_(metric) {}

    size_t dimension() const { return dim_; }
    MetricType metric() const { return metric_; }
    size_t size() const {
        std::shared_lock lock(rw_mutex_);
        return ids_.size();
    }

    void add(uint64_t id, const std::vector<float>& vec) {
        if (vec.size() != dim_) {
            throw std::invalid_argument("Vector dimension mismatch");
        }
        std::unique_lock lock(rw_mutex_);
        if (id_to_idx_.find(id) != id_to_idx_.end()) {
            // Overwrite existing
            size_t idx = id_to_idx_[id];
            std::copy(vec.begin(), vec.end(), data_.begin() + idx * dim_);
            return;
        }
        size_t idx = ids_.size();
        ids_.push_back(id);
        id_to_idx_[id] = idx;
        data_.insert(data_.end(), vec.begin(), vec.end());
    }

    void add_batch(const std::vector<uint64_t>& ids, const std::vector<float>& vectors) {
        if (vectors.size() != ids.size() * dim_) {
            throw std::invalid_argument("Vectors data size does not match ids * dim");
        }
        std::unique_lock lock(rw_mutex_);
        for (size_t i = 0; i < ids.size(); ++i) {
            uint64_t id = ids[i];
            const float* vec_ptr = vectors.data() + i * dim_;
            if (id_to_idx_.find(id) != id_to_idx_.end()) {
                size_t idx = id_to_idx_[id];
                std::copy(vec_ptr, vec_ptr + dim_, data_.begin() + idx * dim_);
            } else {
                size_t idx = ids_.size();
                ids_.push_back(id);
                id_to_idx_[id] = idx;
                data_.insert(data_.end(), vec_ptr, vec_ptr + dim_);
            }
        }
    }

    std::vector<SearchResult> search(const std::vector<float>& query, size_t k, bool use_simd = true) const {
        if (query.size() != dim_) {
            throw std::invalid_argument("Query dimension mismatch");
        }
        std::shared_lock lock(rw_mutex_);
        if (ids_.empty() || k == 0) return {};

        // Max-heap of pairs (distance, id) to keep track of the k smallest distances
        using Element = std::pair<float, uint64_t>;
        std::priority_queue<Element> max_heap;

        const float* q_ptr = query.data();
        size_t n = ids_.size();

        for (size_t i = 0; i < n; ++i) {
            const float* v_ptr = data_.data() + i * dim_;
            float dist = compute_distance(q_ptr, v_ptr, dim_, metric_, use_simd);

            if (max_heap.size() < k) {
                max_heap.push({dist, ids_[i]});
            } else if (dist < max_heap.top().first) {
                max_heap.pop();
                max_heap.push({dist, ids_[i]});
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

    bool remove(uint64_t id) {
        std::unique_lock lock(rw_mutex_);
        auto it = id_to_idx_.find(id);
        if (it == id_to_idx_.end()) return false;

        size_t idx = it->second;
        size_t last_idx = ids_.size() - 1;

        if (idx != last_idx) {
            uint64_t last_id = ids_[last_idx];
            // Swap last element into deleted slot
            ids_[idx] = last_id;
            id_to_idx_[last_id] = idx;
            std::copy(data_.begin() + last_idx * dim_,
                      data_.begin() + (last_idx + 1) * dim_,
                      data_.begin() + idx * dim_);
        }
        ids_.pop_back();
        data_.resize(ids_.size() * dim_);
        id_to_idx_.erase(it);
        return true;
    }

    void save(const std::string& filepath) const {
        std::shared_lock lock(rw_mutex_);
        std::ofstream out(filepath, std::ios::binary);
        if (!out) throw std::runtime_error("Failed to open file for save: " + filepath);

        uint32_t magic = 0x56454331; // 'VEC1'
        out.write(reinterpret_cast<const char*>(&magic), sizeof(magic));
        uint64_t d = dim_;
        uint32_t m = static_cast<uint32_t>(metric_);
        uint64_t n = ids_.size();
        out.write(reinterpret_cast<const char*>(&d), sizeof(d));
        out.write(reinterpret_cast<const char*>(&m), sizeof(m));
        out.write(reinterpret_cast<const char*>(&n), sizeof(n));

        if (n > 0) {
            out.write(reinterpret_cast<const char*>(ids_.data()), sizeof(uint64_t) * n);
            out.write(reinterpret_cast<const char*>(data_.data()), sizeof(float) * n * dim_);
        }
    }

    void load(const std::string& filepath) {
        std::unique_lock lock(rw_mutex_);
        std::ifstream in(filepath, std::ios::binary);
        if (!in) throw std::runtime_error("Failed to open file for load: " + filepath);

        uint32_t magic = 0;
        in.read(reinterpret_cast<char*>(&magic), sizeof(magic));
        if (magic != 0x56454331) throw std::runtime_error("Invalid binary magic header");

        uint64_t d = 0;
        uint32_t m = 0;
        uint64_t n = 0;
        in.read(reinterpret_cast<char*>(&d), sizeof(d));
        in.read(reinterpret_cast<char*>(&m), sizeof(m));
        in.read(reinterpret_cast<char*>(&n), sizeof(n));

        dim_ = d;
        metric_ = static_cast<MetricType>(m);
        ids_.resize(n);
        data_.resize(n * dim_);
        id_to_idx_.clear();

        if (n > 0) {
            in.read(reinterpret_cast<char*>(ids_.data()), sizeof(uint64_t) * n);
            in.read(reinterpret_cast<char*>(data_.data()), sizeof(float) * n * dim_);
            for (size_t i = 0; i < n; ++i) {
                id_to_idx_[ids_[i]] = i;
            }
        }
    }

private:
    size_t dim_;
    MetricType metric_;
    std::vector<uint64_t> ids_;
    std::vector<float> data_;
    std::unordered_map<uint64_t, size_t> id_to_idx_;
    mutable std::shared_mutex rw_mutex_;
};

} // namespace vecdb
