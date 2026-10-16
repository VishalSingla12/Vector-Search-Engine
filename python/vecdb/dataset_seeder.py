import random
import time
from typing import List, Dict, Any

CATEGORIES = {
    "Computer Science": [
        "Distributed consensus protocols like Raft and Paxos ensure replicated state machine durability.",
        "Hierarchical Navigable Small World graphs enable logarithmic approximate nearest neighbor retrieval in vector search.",
        "AVX2 and AVX-512 SIMD vectorization compute eight to sixteen floating-point operations per CPU cycle.",
        "Log-Structured Merge-Trees optimize write throughput by batching append-only logs prior to sorted SSTable disk flushes.",
        "Memory-mapped files allow direct zero-copy kernel page caching for multi-gigabyte vector indexes.",
        "Branch prediction algorithms inside modern out-of-order execution pipelines minimize instruction pipeline flushes.",
        "Garbage collection algorithms with generational hypothesis balance latency pauses and memory fragmentation.",
        "B-Trees and B+ Trees remain the gold standard index for high fan-out disk retrieval with guaranteed O(log N) operations."
    ],
    "Quantum & Physics": [
        "Quantum superposition allows qubits to represent linear combinations of orthogonal basis states |0> and |1>.",
        "Quantum entanglement exhibits non-local correlations that violate Bell inequalities in quantum information theory.",
        "General relativity formulates gravity as the curvature of four-dimensional spacetime induced by mass-energy distributions.",
        "The James Webb Space Telescope operates at the Sun-Earth L2 Lagrange point to detect high-redshift cosmic infrared signatures.",
        "Superconducting transmons maintain coherence times through dilution refrigeration at millikelvin temperatures.",
        "Thermodynamic entropy increases monotonically in closed systems according to the second law of thermodynamics.",
        "Photonic crystal waveguides confine light propagation within periodic dielectric microstructures."
    ],
    "Biology & Genetics": [
        "CRISPR-Cas9 endonuclease complexes introduce targeted double-strand breaks guided by synthetic single-guide RNAs.",
        "Messenger RNA vaccines encode viral spike glycoproteins encapsulated in ionizable lipid nanoparticles.",
        "AlphaFold predicts three-dimensional protein structures with atomic accuracy from primary amino acid sequences.",
        "Cellular senescence involves irreversible cell cycle arrest triggered by telomere attrition or oncogenic stress.",
        "The human gut microbiome synthesizes essential neuroactive metabolites including gamma-aminobutyric acid.",
        "Epigenetic methylation of cytosine residues modulates chromatin accessibility and transcriptional repression."
    ],
    "Philosophy & History": [
        "The Scientific Revolution transformed epistemology through empirical observation and mathematical formulation.",
        "The Apollo missions achieved manned lunar landings utilizing the Saturn V three-stage liquid-fueled rocket.",
        "Aristotelian virtue ethics posits that moral excellence lies in the golden mean between excess and deficiency.",
        "The Library of Alexandria served as the intellectual epicenter of classical Hellenistic scholarship and preservation.",
        "The Renaissance marked the resurgence of humanist philosophies and classical architectural symmetry in Europe.",
        "The Industrial Revolution mechanized textile production and initiated steam-powered locomotion networks."
    ],
    "Finance & Economics": [
        "Quantitative market-making firms quote bid-ask spreads using stochastic inventory control models.",
        "Central bank interest rate decisions modulate commercial credit creation and systemic inflation expectations.",
        "The Black-Scholes-Merton model derives continuous-time European option valuations via risk-neutral arbitrage pricing.",
        "Automated order routing networks optimize limit order execution across fragmented electronic communication networks.",
        "Macroeconomic liquidity traps render nominal monetary easing ineffective when risk premia remain elevated."
    ]
}

def generate_sample_chunks(target_count: int = 5000) -> List[Dict[str, Any]]:
    """
    Generate at least target_count realistic semantic documents across 5 diverse domains.
    """
    dataset = []
    doc_id = 1
    
    for category, passages in CATEGORIES.items():
        # Generate variations and composite passages
        for i in range(target_count // len(CATEGORIES) + 50):
            base_passage = passages[i % len(passages)]
            secondary_passage = passages[(i + 3) % len(passages)]
            
            title = f"{category} Thesis #{i+1}: {base_passage[:45]}..."
            content = f"{base_passage} Furthermore, research indicates that {secondary_passage.lower()} This has significant implications for experimental verification and applied system architectures."
            
            dataset.append({
                "id": doc_id,
                "title": title,
                "content": content,
                "category": category,
                "chunk_index": i
            })
            doc_id += 1
            if len(dataset) >= target_count:
                break
        if len(dataset) >= target_count:
            break

    return dataset
