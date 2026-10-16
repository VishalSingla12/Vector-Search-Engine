cmake_minimum_required(VERSION 3.16)
project(libvecdb VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if (MSVC)
    add_compile_options(/O2 /arch:AVX2 /EHsc /W3)
else()
    add_compile_options(-O3 -mavx2 -Wall -Wextra)
endif()

include_directories(engine/include)

add_library(vecdb INTERFACE)
target_include_directories(vecdb INTERFACE engine/include)

# Executable benchmark
add_executable(benchmark_engine engine/benchmarks/main_benchmark.cpp)
target_link_libraries(benchmark_engine PRIVATE vecdb)
