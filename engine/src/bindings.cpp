#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <pybind11/numpy.h>
#include <chrono>

#include "vecdb/distance.hpp"
#include "vecdb/flat_index.hpp"
#include "vecdb/hnsw_index.hpp"
#include "vecdb/ivf_index.hpp"
#include "vecdb/wal.hpp"

namespace py = pybind11;
using namespace vecdb;

PYBIND11_MODULE(libvecdb, m) {
    m.doc() = "libvecdb - High-performance C++ Vector Search Engine with AVX2 SIMD, HNSW, IVF, and WAL";

    py::enum_<MetricType>(m, "MetricType")
        .value("L2", MetricType::L2)
        .value("INNER_PRODUCT", MetricType::INNER_PRODUCT)
        .value("COSINE", MetricType::COSINE)
        .export_values();

    py::class_<SearchResult>(m, "SearchResult")
        .def_readonly("id", &SearchResult::id)
        .def_readonly("score", &SearchResult::score)
        .def("__repr__", [](const SearchResult& r) {
            return "<SearchResult id=" + std::to_string(r.id) + " score=" + std::to_string(r.score) + ">";
        });

    // SIMD benchmark function exposed directly
    m.def("compute_distance_benchmark", [](const std::vector<float>& a, const std::vector<float>& b, MetricType metric, bool use_simd) {
        if (a.size() != b.size()) throw std::invalid_argument("Vectors must have same length");
        return compute_distance(a.data(), b.data(), a.size(), metric, use_simd);
    }, py::arg("a"), py::arg("b"), py::arg("metric") = MetricType::L2, py::arg("use_simd") = true);

    m.def("benchmark_kernel_speedup", [](size_t dim, size_t iterations, MetricType metric) {
        std::vector<float> a(dim, 1.234f);
        std::vector<float> b(dim, 2.345f);
        for (size_t i = 0; i < dim; ++i) {
            a[i] = static_cast<float>(i * 0.137f);
            b[i] = static_cast<float>(i * 0.241f);
        }

        // Measure naive
        auto t0 = std::chrono::high_resolution_clock::now();
        volatile float sum_naive = 0.0f;
        for (size_t iter = 0; iter < iterations; ++iter) {
            sum_naive += compute_distance(a.data(), b.data(), dim, metric, false);
        }
        auto t1 = std::chrono::high_resolution_clock::now();

        // Measure SIMD AVX2
        volatile float sum_simd = 0.0f;
        for (size_t iter = 0; iter < iterations; ++iter) {
            sum_simd += compute_distance(a.data(), b.data(), dim, metric, true);
        }
        auto t2 = std::chrono::high_resolution_clock::now();

        double naive_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
        double simd_ms = std::chrono::duration<double, std::milli>(t2 - t1).count();
        double speedup = (simd_ms > 0.0001) ? (naive_ms / simd_ms) : 1.0;

        py::dict res;
        res["naive_ms"] = naive_ms;
        res["simd_ms"] = simd_ms;
        res["speedup"] = speedup;
        res["dim"] = dim;
        res["iterations"] = iterations;
        return res;
    }, py::arg("dim") = 384, py::arg("iterations") = 100000, py::arg("metric") = MetricType::L2);

    // ==========================================
    // Flat Index
    // ==========================================
    py::class_<FlatIndex>(m, "FlatIndex")
        .def(py::init<size_t, MetricType>(), py::arg("dim"), py::arg("metric") = MetricType::L2)
        .def("dimension", &FlatIndex::dimension)
        .def("metric", &FlatIndex::metric)
        .def("size", &FlatIndex::size)
        .def("add", &FlatIndex::add, py::arg("id"), py::arg("vec"))
        .def("add_batch", &FlatIndex::add_batch, py::arg("ids"), py::arg("vectors"))
        .def("search", &FlatIndex::search, py::arg("query"), py::arg("k"), py::arg("use_simd") = true)
        .def("remove", &FlatIndex::remove, py::arg("id"))
        .def("save", &FlatIndex::save, py::arg("filepath"))
        .def("load", &FlatIndex::load, py::arg("filepath"));

    // ==========================================
    // HNSW Index
    // ==========================================
    py::class_<HNSWConfig>(m, "HNSWConfig")
        .def(py::init<>())
        .def_readwrite("M", &HNSWConfig::M)
        .def_readwrite("M0", &HNSWConfig::M0)
        .def_readwrite("efConstruction", &HNSWConfig::efConstruction)
        .def_readwrite("efSearch", &HNSWConfig::efSearch)
        .def_readwrite("mL", &HNSWConfig::mL);

    py::class_<HNSWIndex>(m, "HNSWIndex")
        .def(py::init<size_t, MetricType, HNSWConfig>(), 
             py::arg("dim"), py::arg("metric") = MetricType::L2, py::arg("config") = HNSWConfig())
        .def("dimension", &HNSWIndex::dimension)
        .def("metric", &HNSWIndex::metric)
        .def("size", &HNSWIndex::size)
        .def("get_max_level", &HNSWIndex::get_max_level)
        .def("get_level_counts", &HNSWIndex::get_level_counts)
        .def("set_ef_search", &HNSWIndex::set_ef_search, py::arg("ef"))
        .def("add", &HNSWIndex::add, py::arg("id"), py::arg("vec"))
        .def("search", &HNSWIndex::search, py::arg("query"), py::arg("k"), py::arg("ef") = 0)
        .def("remove", &HNSWIndex::remove, py::arg("id"))
        .def("save", &HNSWIndex::save, py::arg("filepath"))
        .def("load", &HNSWIndex::load, py::arg("filepath"));

    // ==========================================
    // IVF Index
    // ==========================================
    py::class_<IVFIndex>(m, "IVFIndex")
        .def(py::init<size_t, size_t, size_t, MetricType>(),
             py::arg("dim"), py::arg("nlist") = 16, py::arg("nprobe") = 4, py::arg("metric") = MetricType::L2)
        .def("dimension", &IVFIndex::dimension)
        .def("nlist", &IVFIndex::nlist)
        .def("nprobe", &IVFIndex::nprobe)
        .def("set_nprobe", &IVFIndex::set_nprobe, py::arg("nprobe"))
        .def("is_trained", &IVFIndex::is_trained)
        .def("size", &IVFIndex::size)
        .def("train", &IVFIndex::train, py::arg("train_vectors"), py::arg("max_iters") = 20)
        .def("add", &IVFIndex::add, py::arg("id"), py::arg("vec"))
        .def("search", &IVFIndex::search, py::arg("query"), py::arg("k"))
        .def("save", &IVFIndex::save, py::arg("filepath"))
        .def("load", &IVFIndex::load, py::arg("filepath"));

    // ==========================================
    // Write-Ahead Log
    // ==========================================
    py::class_<WriteAheadLog>(m, "WriteAheadLog")
        .def(py::init<std::string>(), py::arg("wal_path"))
        .def("log_insert", &WriteAheadLog::log_insert, py::arg("id"), py::arg("vec"), py::arg("metadata") = "")
        .def("log_delete", &WriteAheadLog::log_delete, py::arg("id"))
        .def("truncate", &WriteAheadLog::truncate);
}
