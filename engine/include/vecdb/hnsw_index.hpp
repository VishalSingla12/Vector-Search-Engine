#pragma once
#include "distance.hpp"
#include <vector>
#include <queue>
#include <unordered_map>
#include <unordered_set>
#include <random>
#include <shared_mutex>
#include <mutex>
#include <fstream>
#include <algorithm>
#include <cmath>
#include <atomic>

namespace vecdb {

struct HNSWConfig {
    size_t M = 16;              // Max connections per element at layers > 0
    size_t M0 = 32;             // Max connections per element at layer 0 (typically 2 * M)
    size_t efConstruction = 128;// Beam search depth during index construction
    size_t efSearch = 64;       // Beam search depth during query
    float mL = 1.0f / std::log(16.0f); // Normalization factor for level generation
};

class HNSWIndex {
public:
    HNSWIndex(size_t dim, MetricType metric = MetricType::L2, HNSWConfig config = {})
        : dim_(dim), metric_(metric), config_(config), enter_node_(-1), max_level_(-1) {
        if (config_.M0 == 0) config_.M0 = 2 * config_.M;
        if (config_.mL <= 0.0f) config_.mL = 1.0f / std::log(static_cast<float>(config_.M));
        rng_.seed(42);
    }

    size_t dimension() const { return dim_; }
    MetricType metric() const { return metric_; }
    const HNSWConfig& config() const { return config_; }
    void set_ef_search(size_t ef) { config_.efSearch = ef; }

    size_t size() const {
        std::shared_lock lock(global_rw_mutex_);
        return num_nodes_.load();
    }

    int get_max_level() const {
        std::shared_lock lock(global_rw_mutex_);
        return max_level_;
    }

    std::vector<size_t> get_level_counts() const {
        std::shared_lock lock(global_rw_mutex_);
        if (max_level_ < 0) return {};
        std::vector<size_t> counts(max_level_ + 1, 0);
        for (const auto& node : nodes_) {
            if (!node.deleted) {
                for (int l = 0; l <= node.level; ++l) {
                    counts[l]++;
                }
            }
        }
        return counts;
    }

    void add(uint64_t id, const std::vector<float>& vec) {
        if (vec.size() != dim_) throw std::invalid_argument("Vector dimension mismatch");

        std::unique_lock global_lock(global_rw_mutex_);
        
        // Check if ID exists
        if (id_to_internal_.find(id) != id_to_internal_.end()) {
            size_t internal_id = id_to_internal_[id];
            // Update vector data
            std::copy(vec.begin(), vec.end(), vectors_.begin() + internal_id * dim_);
            nodes_[internal_id].deleted = false;
            return;
        }

        int node_level = get_random_level();
        size_t internal_id = nodes_.size();
        id_to_internal_[id] = internal_id;
        internal_to_id_.push_back(id);

        Node new_node;
        new_node.level = node_level;
        new_node.friends.resize(node_level + 1);
        nodes_.push_back(new_node);

        vectors_.insert(vectors_.end(), vec.begin(), vec.end());
        num_nodes_++;

        int curr_obj = enter_node_;
        int max_l = max_level_;

        if (curr_obj == -1) {
            enter_node_ = static_cast<int>(internal_id);
            max_level_ = node_level;
            return;
        }

        const float* q_vec = vec.data();
        float cur_dist = compute_dist(q_vec, curr_obj);

        // 1. Greedy search from top level down to node_level + 1
        for (int level = max_l; level > node_level; --level) {
            bool changed = true;
            while (changed) {
                changed = false;
                std::vector<int> neighbors = get_neighbors(curr_obj, level);
                for (int neighbor : neighbors) {
                    if (nodes_[neighbor].deleted) continue;
                    float d = compute_dist(q_vec, neighbor);
                    if (d < cur_dist) {
                        cur_dist = d;
                        curr_obj = neighbor;
                        changed = true;
                    }
                }
            }
        }

        // 2. Insert at level min(node_level, max_l) down to 0
        int top_connect_level = std::min(node_level, max_l);
        for (int level = top_connect_level; level >= 0; --level) {
            std::vector<std::pair<float, int>> candidates = search_level(q_vec, curr_obj, config_.efConstruction, level);
            
            // Heuristic selection of M nearest neighbors
            size_t M_curr = (level == 0) ? config_.M0 : config_.M;
            std::vector<int> neighbors = select_neighbors_simple(candidates, M_curr);

            for (int neighbor : neighbors) {
                add_edge(internal_id, neighbor, level);
                add_edge(neighbor, internal_id, level);

                // Shrink neighbor connections if exceeded limit
                shrink_connections(neighbor, level, M_curr);
            }

            if (!candidates.empty()) {
                curr_obj = candidates[0].second; // closest element becomes next entry point
            }
        }

        if (node_level > max_l) {
            max_level_ = node_level;
            enter_node_ = static_cast<int>(internal_id);
        }
    }

    std::vector<SearchResult> search(const std::vector<float>& query, size_t k, size_t ef = 0) const {
        if (query.size() != dim_) throw std::invalid_argument("Query dimension mismatch");
        std::shared_lock lock(global_rw_mutex_);

        if (enter_node_ == -1 || num_nodes_.load() == 0 || k == 0) return {};
        if (ef == 0) ef = std::max(k, config_.efSearch);

        const float* q_vec = query.data();
        int curr_obj = enter_node_;
        float cur_dist = compute_dist(q_vec, curr_obj);

        // Greedy descent through top layers
        for (int level = max_level_; level > 0; --level) {
            bool changed = true;
            while (changed) {
                changed = false;
                std::vector<int> neighbors = get_neighbors(curr_obj, level);
                for (int neighbor : neighbors) {
                    if (nodes_[neighbor].deleted) continue;
                    float d = compute_dist(q_vec, neighbor);
                    if (d < cur_dist) {
                        cur_dist = d;
                        curr_obj = neighbor;
                        changed = true;
                    }
                }
            }
        }

        // Search at level 0
        std::vector<std::pair<float, int>> candidates = search_level(q_vec, curr_obj, ef, 0);

        std::vector<SearchResult> results;
        results.reserve(std::min(k, candidates.size()));
        for (const auto& item : candidates) {
            if (!nodes_[item.second].deleted) {
                results.push_back({internal_to_id_[item.second], item.first});
                if (results.size() >= k) break;
            }
        }
        return results;
    }

    bool remove(uint64_t id) {
        std::unique_lock lock(global_rw_mutex_);
        auto it = id_to_internal_.find(id);
        if (it == id_to_internal_.end()) return false;

        size_t internal_id = it->second;
        if (nodes_[internal_id].deleted) return false;

        nodes_[internal_id].deleted = true;
        num_nodes_--;

        // If the entry node was deleted, find an active replacement
        if (enter_node_ == static_cast<int>(internal_id)) {
            enter_node_ = -1;
            max_level_ = -1;
            for (size_t i = 0; i < nodes_.size(); ++i) {
                if (!nodes_[i].deleted) {
                    if (enter_node_ == -1 || nodes_[i].level > max_level_) {
                        enter_node_ = static_cast<int>(i);
                        max_level_ = nodes_[i].level;
                    }
                }
            }
        }
        return true;
    }

    void save(const std::string& filepath) const {
        std::shared_lock lock(global_rw_mutex_);
        std::ofstream out(filepath, std::ios::binary);
        if (!out) throw std::runtime_error("Cannot open file for HNSW save: " + filepath);

        uint32_t magic = 0x484E5357; // 'HNSW'
        out.write(reinterpret_cast<const char*>(&magic), sizeof(magic));

        uint64_t d = dim_;
        uint32_t m = static_cast<uint32_t>(metric_);
        out.write(reinterpret_cast<const char*>(&d), sizeof(d));
        out.write(reinterpret_cast<const char*>(&m), sizeof(m));
        out.write(reinterpret_cast<const char*>(&config_), sizeof(config_));
        out.write(reinterpret_cast<const char*>(&enter_node_), sizeof(enter_node_));
        out.write(reinterpret_cast<const char*>(&max_level_), sizeof(max_level_));

        uint64_t total_nodes = nodes_.size();
        out.write(reinterpret_cast<const char*>(&total_nodes), sizeof(total_nodes));

        // Vectors
        out.write(reinterpret_cast<const char*>(vectors_.data()), sizeof(float) * vectors_.size());

        // IDs
        out.write(reinterpret_cast<const char*>(internal_to_id_.data()), sizeof(uint64_t) * total_nodes);

        // Nodes & edges
        for (size_t i = 0; i < total_nodes; ++i) {
            const auto& n = nodes_[i];
            int lvl = n.level;
            uint8_t del = n.deleted ? 1 : 0;
            out.write(reinterpret_cast<const char*>(&lvl), sizeof(lvl));
            out.write(reinterpret_cast<const char*>(&del), sizeof(del));
            
            for (int l = 0; l <= lvl; ++l) {
                uint32_t deg = static_cast<uint32_t>(n.friends[l].size());
                out.write(reinterpret_cast<const char*>(&deg), sizeof(deg));
                if (deg > 0) {
                    out.write(reinterpret_cast<const char*>(n.friends[l].data()), sizeof(int) * deg);
                }
            }
        }
    }

    void load(const std::string& filepath) {
        std::unique_lock lock(global_rw_mutex_);
        std::ifstream in(filepath, std::ios::binary);
        if (!in) throw std::runtime_error("Cannot open file for HNSW load: " + filepath);

        uint32_t magic = 0;
        in.read(reinterpret_cast<char*>(&magic), sizeof(magic));
        if (magic != 0x484E5357) throw std::runtime_error("Invalid HNSW file magic header");

        uint64_t d = 0;
        uint32_t m = 0;
        in.read(reinterpret_cast<char*>(&d), sizeof(d));
        in.read(reinterpret_cast<char*>(&m), sizeof(m));
        in.read(reinterpret_cast<char*>(&config_), sizeof(config_));
        in.read(reinterpret_cast<char*>(&enter_node_), sizeof(enter_node_));
        in.read(reinterpret_cast<char*>(&max_level_), sizeof(max_level_));

        dim_ = d;
        metric_ = static_cast<MetricType>(m);

        uint64_t total_nodes = 0;
        in.read(reinterpret_cast<char*>(&total_nodes), sizeof(total_nodes));

        vectors_.resize(total_nodes * dim_);
        in.read(reinterpret_cast<char*>(vectors_.data()), sizeof(float) * vectors_.size());

        internal_to_id_.resize(total_nodes);
        in.read(reinterpret_cast<char*>(internal_to_id_.data()), sizeof(uint64_t) * total_nodes);

        nodes_.resize(total_nodes);
        id_to_internal_.clear();
        size_t active_count = 0;

        for (size_t i = 0; i < total_nodes; ++i) {
            id_to_internal_[internal_to_id_[i]] = i;
            auto& n = nodes_[i];
            int lvl = 0;
            uint8_t del = 0;
            in.read(reinterpret_cast<char*>(&lvl), sizeof(lvl));
            in.read(reinterpret_cast<char*>(&del), sizeof(del));
            n.level = lvl;
            n.deleted = (del != 0);
            if (!n.deleted) active_count++;

            n.friends.resize(lvl + 1);
            for (int l = 0; l <= lvl; ++l) {
                uint32_t deg = 0;
                in.read(reinterpret_cast<char*>(&deg), sizeof(deg));
                n.friends[l].resize(deg);
                if (deg > 0) {
                    in.read(reinterpret_cast<char*>(n.friends[l].data()), sizeof(int) * deg);
                }
            }
        }
        num_nodes_.store(active_count);
    }

private:
    struct Node {
        int level{0};
        bool deleted{false};
        std::vector<std::vector<int>> friends; // friends[level][index]
    };

    float compute_dist(const float* a, int internal_b) const {
        return compute_distance(a, vectors_.data() + internal_b * dim_, dim_, metric_, true);
    }

    int get_random_level() {
        std::uniform_real_distribution<float> dist(0.0f, 1.0f);
        float r = dist(rng_);
        if (r == 0.0f) r = 0.0000001f;
        int lvl = static_cast<int>(-std::log(r) * config_.mL);
        return lvl;
    }

    std::vector<int> get_neighbors(int node_id, int level) const {
        if (node_id < 0 || static_cast<size_t>(node_id) >= nodes_.size()) return {};
        if (level > nodes_[node_id].level) return {};
        return nodes_[node_id].friends[level];
    }

    void add_edge(size_t src, size_t dst, int level) {
        auto& f = nodes_[src].friends[level];
        if (std::find(f.begin(), f.end(), static_cast<int>(dst)) == f.end()) {
            f.push_back(static_cast<int>(dst));
        }
    }

    void shrink_connections(int node_id, int level, size_t max_m) {
        auto& f = nodes_[node_id].friends[level];
        if (f.size() <= max_m) return;

        // Sort by distance to node_id
        const float* node_vec = vectors_.data() + node_id * dim_;
        std::vector<std::pair<float, int>> scored;
        scored.reserve(f.size());
        for (int neighbor : f) {
            scored.push_back({compute_dist(node_vec, neighbor), neighbor});
        }
        std::sort(scored.begin(), scored.end());

        f.clear();
        for (size_t i = 0; i < max_m && i < scored.size(); ++i) {
            f.push_back(scored[i].second);
        }
    }

    std::vector<std::pair<float, int>> select_neighbors_simple(
        const std::vector<std::pair<float, int>>& candidates, size_t M) const {
        std::vector<int> result;
        size_t take = std::min(M, candidates.size());
        result.reserve(take);
        for (size_t i = 0; i < take; ++i) {
            result.push_back(candidates[i].second);
        }
        return candidates; // callers can iterate or take first M
    }

    std::vector<int> select_neighbors_simple(
        const std::vector<std::pair<float, int>>& candidates, size_t M) {
        std::vector<int> res;
        size_t count = std::min(candidates.size(), M);
        res.reserve(count);
        for (size_t i = 0; i < count; ++i) {
            res.push_back(candidates[i].second);
        }
        return res;
    }

    std::vector<std::pair<float, int>> search_level(const float* q_vec, int ep, size_t ef, int level) const {
        std::vector<std::pair<float, int>> W; // dynamic result set (min-heap sorted when returning)
        std::unordered_set<int> visited;

        using MinElem = std::pair<float, int>; // <dist, id>
        std::priority_queue<MinElem, std::vector<MinElem>, std::greater<MinElem>> candidates;
        std::priority_queue<MinElem> furthest; // max-heap of nearest elements discovered

        float d_ep = compute_dist(q_vec, ep);
        candidates.push({d_ep, ep});
        furthest.push({d_ep, ep});
        visited.insert(ep);

        while (!candidates.empty()) {
            auto curr = candidates.top();
            candidates.pop();

            if (curr.first > furthest.top().first && furthest.size() >= ef) {
                break;
            }

            std::vector<int> neighbors = get_neighbors(curr.second, level);
            for (int neighbor : neighbors) {
                if (visited.find(neighbor) == visited.end()) {
                    visited.insert(neighbor);
                    float d = compute_dist(q_vec, neighbor);

                    if (furthest.size() < ef || d < furthest.top().first) {
                        candidates.push({d, neighbor});
                        furthest.push({d, neighbor});
                        if (furthest.size() > ef) {
                            furthest.pop();
                        }
                    }
                }
            }
        }

        std::vector<std::pair<float, int>> result;
        result.reserve(furthest.size());
        while (!furthest.empty()) {
            result.push_back(furthest.top());
            furthest.pop();
        }
        std::reverse(result.begin(), result.end()); // now sorted ascending by distance
        return result;
    }

    size_t dim_;
    MetricType metric_;
    HNSWConfig config_;
    int enter_node_;
    int max_level_;
    std::atomic<size_t> num_nodes_{0};

    std::vector<float> vectors_;
    std::vector<Node> nodes_;
    std::unordered_map<uint64_t, size_t> id_to_internal_;
    std::vector<uint64_t> internal_to_id_;

    std::default_random_engine rng_;
    mutable std::shared_mutex global_rw_mutex_;
};

} // namespace vecdb
