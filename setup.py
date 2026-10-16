from setuptools import setup, Extension
import pybind11
import sys

extra_compile_args = []
if sys.platform == 'win32':
    # /arch:AVX2 enables AVX2 instructions, /O2 optimizes
    extra_compile_args = ['/O2', '/arch:AVX2', '/std:c++17', '/EHsc']
else:
    extra_compile_args = ['-O3', '-mavx2', '-std=c++17', '-fPIC']

ext_modules = [
    Extension(
        'libvecdb',
        ['engine/src/bindings.cpp'],
        include_dirs=[
            'engine/include',
            pybind11.get_include(),
        ],
        language='c++',
        extra_compile_args=extra_compile_args,
    ),
]

setup(
    name='libvecdb',
    version='0.1.0',
    author='VectorSearchEngine',
    description='C++ AVX2 SIMD Vector Database with HNSW, IVF, and WAL',
    ext_modules=ext_modules,
)
