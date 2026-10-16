#pragma once
#include <string>
#include <vector>
#include <fstream>
#include <mutex>
#include <functional>
#include <cstdint>

namespace vecdb {

enum class WALOpType : uint8_t {
    INSERT = 1,
    DELETE = 2
};

#pragma pack(push, 1)
struct WALRecordHeader {
    uint8_t op_type;   // WALOpType
    uint64_t id;       // document/vector ID
    uint32_t dim;      // vector dimension (0 if delete)
    uint32_t payload_len; // length of arbitrary metadata string or JSON
};
#pragma pack(pop)

class WriteAheadLog {
public:
    WriteAheadLog(const std::string& wal_path) : path_(wal_path) {
        log_file_.open(path_, std::ios::out | std::ios::binary | std::ios::app);
        if (!log_file_.is_open()) {
            throw std::runtime_error("Failed to open WAL file: " + path_);
        }
    }

    ~WriteAheadLog() {
        if (log_file_.is_open()) {
            log_file_.flush();
            log_file_.close();
        }
    }

    void log_insert(uint64_t id, const std::vector<float>& vec, const std::string& metadata = "") {
        std::lock_guard<std::mutex> lock(mutex_);
        WALRecordHeader hdr;
        hdr.op_type = static_cast<uint8_t>(WALOpType::INSERT);
        hdr.id = id;
        hdr.dim = static_cast<uint32_t>(vec.size());
        hdr.payload_len = static_cast<uint32_t>(metadata.size());

        log_file_.write(reinterpret_cast<const char*>(&hdr), sizeof(hdr));
        if (hdr.dim > 0) {
            log_file_.write(reinterpret_cast<const char*>(vec.data()), sizeof(float) * hdr.dim);
        }
        if (hdr.payload_len > 0) {
            log_file_.write(metadata.data(), hdr.payload_len);
        }
        log_file_.flush();
    }

    void log_delete(uint64_t id) {
        std::lock_guard<std::mutex> lock(mutex_);
        WALRecordHeader hdr;
        hdr.op_type = static_cast<uint8_t>(WALOpType::DELETE);
        hdr.id = id;
        hdr.dim = 0;
        hdr.payload_len = 0;

        log_file_.write(reinterpret_cast<const char*>(&hdr), sizeof(hdr));
        log_file_.flush();
    }

    // Replay WAL on recovery
    static void replay(const std::string& wal_path,
                       std::function<void(uint64_t id, const std::vector<float>& vec, const std::string& meta)> on_insert,
                       std::function<void(uint64_t id)> on_delete) {
        std::ifstream in(wal_path, std::ios::binary);
        if (!in.is_open()) return; // WAL might not exist yet

        while (in.peek() != EOF) {
            WALRecordHeader hdr;
            in.read(reinterpret_cast<char*>(&hdr), sizeof(hdr));
            if (!in) break;

            if (hdr.op_type == static_cast<uint8_t>(WALOpType::INSERT)) {
                std::vector<float> vec(hdr.dim);
                if (hdr.dim > 0) {
                    in.read(reinterpret_cast<char*>(vec.data()), sizeof(float) * hdr.dim);
                }
                std::string meta;
                if (hdr.payload_len > 0) {
                    meta.resize(hdr.payload_len);
                    in.read(&meta[0], hdr.payload_len);
                }
                if (on_insert) on_insert(hdr.id, vec, meta);
            } else if (hdr.op_type == static_cast<uint8_t>(WALOpType::DELETE)) {
                if (on_delete) on_delete(hdr.id);
            }
        }
    }

    void truncate() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (log_file_.is_open()) log_file_.close();
        log_file_.open(path_, std::ios::out | std::ios::binary | std::ios::trunc);
    }

private:
    std::string path_;
    std::ofstream log_file_;
    std::mutex mutex_;
};

} // namespace vecdb
