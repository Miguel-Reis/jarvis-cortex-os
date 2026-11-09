"""Synaptic Memory Engine: SQLite WAL + FTS5 BM25 + 128-D LSH + HippoRAG 2 PPR.

Zero external dependencies: 100% standard library (sqlite3, hashlib, math, random).
Implements biological-inspired associative memory diffusion and strict provenance gates.
"""

from __future__ import annotations

import hashlib
import math
import random
import sqlite3
import time
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional, Set, Tuple


class LSH128:
    """Deterministic 128-Dimension Locality Sensitive Hashing (SimHash) for semantic vector similarity."""

    NUM_BITS = 128
    FEATURE_DIM = 64

    def __init__(self, seed: int = 42) -> None:
        rng = random.Random(seed)
        # 128 hyperplanes in 64-dimensional feature space
        self.hyperplanes: List[List[float]] = []
        for _ in range(self.NUM_BITS):
            plane = [rng.gauss(0.0, 1.0) for _ in range(self.FEATURE_DIM)]
            # Normalize vector
            norm = math.sqrt(sum(x * x for x in plane)) or 1.0
            self.hyperplanes.append([x / norm for x in plane])

    def _text_to_feature_vector(self, text: str) -> List[float]:
        """Maps token hashes to a dense 64-dimensional feature vector."""
        vec = [0.0] * self.FEATURE_DIM
        words = text.lower().split()
        if not words:
            return vec

        for word in words:
            # Hash word into 64 dimensions with alternating weights
            h = int(hashlib.md5(word.encode("utf-8")).hexdigest(), 16)
            for i in range(self.FEATURE_DIM):
                bit = (h >> i) & 1
                vec[i] += 1.0 if bit else -1.0

        # Normalize
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        return [x / norm for x in vec]

    def compute_hash(self, text: str) -> int:
        """Computes a 128-bit integer SimHash."""
        vec = self._text_to_feature_vector(text)
        result = 0
        for i, plane in enumerate(self.hyperplanes):
            dot = sum(v * p for v, p in zip(vec, plane))
            if dot >= 0:
                result |= (1 << i)
        return result

    def compute_hash_hex(self, text: str) -> str:
        """Returns 32-char hexadecimal representation of 128-bit hash."""
        return f"{self.compute_hash(text):032x}"

    @staticmethod
    def hamming_distance(h1: int, h2: int) -> int:
        return (h1 ^ h2).bit_count()

    def similarity(self, text_or_hash1: str | int, text_or_hash2: str | int) -> float:
        """Computes angular/Hamming semantic similarity between 0.0 and 1.0."""
        h1 = self.compute_hash(text_or_hash1) if isinstance(text_or_hash1, str) else text_or_hash1
        h2 = self.compute_hash(text_or_hash2) if isinstance(text_or_hash2, str) else text_or_hash2
        dist = self.hamming_distance(h1, h2)
        return max(0.0, 1.0 - (dist / float(self.NUM_BITS)))


@dataclass
class ProvenanceRecord:
    source_uri: str
    confidence: float
    integrity_hash: str
    verified: bool
    timestamp: float

    @classmethod
    def create(cls, topic: str, content: str, source_uri: str, confidence: float = 1.0) -> ProvenanceRecord:
        payload = f"{topic}::{content}::{source_uri}".encode("utf-8")
        h = hashlib.sha256(payload).hexdigest()
        return cls(
            source_uri=source_uri,
            confidence=max(0.0, min(1.0, confidence)),
            integrity_hash=h,
            verified=confidence >= 0.70,
            timestamp=time.time(),
        )

    def validate(self, topic: str, content: str) -> bool:
        expected = hashlib.sha256(f"{topic}::{content}::{self.source_uri}".encode("utf-8")).hexdigest()
        return expected == self.integrity_hash and self.confidence >= 0.70


@dataclass
class SynapticMemoryEntry:
    id: str
    topic: str
    content: str
    lsh_hex: str
    provenance: ProvenanceRecord
    created_at: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class SynapticDB:
    """Enterprise Synaptic Knowledge Base with SQLite WAL, BM25, LSH, and HippoRAG 2 PPR."""

    def __init__(self, db_path: str = ":memory:") -> None:
        self.db_path = db_path
        self.lsh = LSH128(seed=42)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self._init_db()

    def _init_db(self) -> None:
        cur = self.conn.cursor()
        cur.execute("PRAGMA journal_mode = WAL;")
        cur.execute("PRAGMA foreign_keys = ON;")
        cur.execute("PRAGMA synchronous = NORMAL;")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS synaptic_memories (
                id TEXT PRIMARY KEY,
                topic TEXT NOT NULL,
                content TEXT NOT NULL,
                lsh_hex TEXT NOT NULL,
                source_uri TEXT NOT NULL,
                confidence REAL NOT NULL,
                integrity_hash TEXT NOT NULL,
                verified INTEGER NOT NULL,
                created_at REAL NOT NULL
            );
        """)

        # FTS5 Full-Text Search
        cur.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS synaptic_fts USING fts5(
                id UNINDEXED,
                topic,
                content,
                tokenize = 'porter unicode61'
            );
        """)

        # HippoRAG Knowledge Graph nodes & edges
        cur.execute("""
            CREATE TABLE IF NOT EXISTS synaptic_nodes (
                name TEXT PRIMARY KEY,
                node_type TEXT NOT NULL,
                weight REAL DEFAULT 1.0
            );
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS synaptic_edges (
                source TEXT NOT NULL,
                target TEXT NOT NULL,
                relation TEXT NOT NULL,
                weight REAL DEFAULT 1.0,
                PRIMARY KEY (source, target, relation)
            );
        """)

        self.conn.commit()

    def close(self) -> None:
        if self.conn:
            self.conn.close()

    # ---------------------------------------------------------
    # Ingestion & Provenance Gate
    # ---------------------------------------------------------

    def store_memory(
        self,
        topic: str,
        content: str,
        source_uri: str = "direct_input",
        confidence: float = 1.0,
        enforce_provenance: bool = True,
    ) -> Optional[SynapticMemoryEntry]:
        """Ingests a memory passing through the Provenance Gate and updates FTS and LSH."""
        prov = ProvenanceRecord.create(topic, content, source_uri, confidence)
        if enforce_provenance and not prov.validate(topic, content):
            return None

        mem_id = hashlib.sha1(f"{topic}:{content}:{prov.timestamp}".encode("utf-8")).hexdigest()[:16]
        lsh_hex = self.lsh.compute_hash_hex(f"{topic} {content}")

        cur = self.conn.cursor()
        cur.execute(
            """
            INSERT OR REPLACE INTO synaptic_memories 
            (id, topic, content, lsh_hex, source_uri, confidence, integrity_hash, verified, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                mem_id,
                topic,
                content,
                lsh_hex,
                prov.source_uri,
                prov.confidence,
                prov.integrity_hash,
                1 if prov.verified else 0,
                prov.timestamp,
            ),
        )

        cur.execute("INSERT OR REPLACE INTO synaptic_fts (id, topic, content) VALUES (?, ?, ?)", (mem_id, topic, content))
        self.conn.commit()

        # Auto-connect topic and memory node in HippoRAG
        self.add_node(topic, "Topic")
        self.add_node(mem_id, "Memory")
        self.add_edge(topic, mem_id, "CONTAINS", weight=1.0)

        return SynapticMemoryEntry(
            id=mem_id,
            topic=topic,
            content=content,
            lsh_hex=lsh_hex,
            provenance=prov,
            created_at=prov.timestamp,
        )

    # ---------------------------------------------------------
    # FTS5 BM25 & LSH Hybrid Retrieval
    # ---------------------------------------------------------

    def search_bm25(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Executes FTS5 BM25 full-text query."""
        cur = self.conn.cursor()
        # Clean query tokens for FTS5 syntax
        clean_tokens = [t for t in query.replace('"', " ").replace("'", " ").split() if t.isalnum()]
        if not clean_tokens:
            return []
        fts_query = " OR ".join(f'"{token}"*' for token in clean_tokens)

        try:
            cur.execute(
                """
                SELECT m.id, m.topic, m.content, m.confidence, m.source_uri, bm25(synaptic_fts) as score
                FROM synaptic_fts f
                JOIN synaptic_memories m ON f.id = m.id
                WHERE synaptic_fts MATCH ?
                ORDER BY score ASC
                LIMIT ?
                """,
                (fts_query, limit),
            )
            rows = cur.fetchall()
            return [
                {
                    "id": r["id"],
                    "topic": r["topic"],
                    "content": r["content"],
                    "confidence": r["confidence"],
                    "source_uri": r["source_uri"],
                    "bm25_score": round(abs(float(r["score"])), 4),
                }
                for r in rows
            ]
        except Exception:
            return []

    def search_semantic_lsh(self, query: str, threshold: float = 0.50, limit: int = 10) -> List[Dict[str, Any]]:
        """Performs 128-D LSH Hamming distance scan for semantic similarity."""
        query_hash = self.lsh.compute_hash(query)
        cur = self.conn.cursor()
        cur.execute("SELECT id, topic, content, lsh_hex, confidence, source_uri FROM synaptic_memories WHERE verified = 1")
        rows = cur.fetchall()

        results = []
        for r in rows:
            entry_hash = int(r["lsh_hex"], 16)
            sim = self.lsh.similarity(query_hash, entry_hash)
            if sim >= threshold:
                results.append(
                    {
                        "id": r["id"],
                        "topic": r["topic"],
                        "content": r["content"],
                        "confidence": r["confidence"],
                        "similarity": round(sim, 4),
                    }
                )

        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results[:limit]

    # ---------------------------------------------------------
    # HippoRAG 2 Personalized PageRank (PPR) Engine
    # ---------------------------------------------------------

    def add_node(self, name: str, node_type: str = "Concept", weight: float = 1.0) -> None:
        cur = self.conn.cursor()
        cur.execute(
            "INSERT OR IGNORE INTO synaptic_nodes (name, node_type, weight) VALUES (?, ?, ?)",
            (name, node_type, weight),
        )
        self.conn.commit()

    def add_edge(self, source: str, target: str, relation: str = "RELATED_TO", weight: float = 1.0) -> None:
        self.add_node(source)
        self.add_node(target)
        cur = self.conn.cursor()
        cur.execute(
            "INSERT OR REPLACE INTO synaptic_edges (source, target, relation, weight) VALUES (?, ?, ?, ?)",
            (source, target, relation, weight),
        )
        # Bidirectional synaptic linkage
        cur.execute(
            "INSERT OR REPLACE INTO synaptic_edges (source, target, relation, weight) VALUES (?, ?, ?, ?)",
            (target, source, f"REV_{relation}", weight * 0.8),
        )
        self.conn.commit()

    def run_hipporag_ppr(
        self,
        seed_nodes: Dict[str, float],
        alpha: float = 0.85,
        max_iter: int = 30,
        tol: float = 1e-6,
    ) -> List[Tuple[str, float]]:
        """Executes HippoRAG 2 Personalized PageRank (PPR) power iteration over synaptic graph."""
        cur = self.conn.cursor()
        cur.execute("SELECT name FROM synaptic_nodes")
        all_nodes = [r["name"] for r in cur.fetchall()]
        if not all_nodes:
            return []

        # Graph adjacency
        cur.execute("SELECT source, target, weight FROM synaptic_edges")
        edges = cur.fetchall()

        out_edges: Dict[str, List[Tuple[str, float]]] = {n: [] for n in all_nodes}
        out_weights: Dict[str, float] = {n: 0.0 for n in all_nodes}

        for e in edges:
            src, tgt, w = e["source"], e["target"], float(e["weight"])
            if src in out_edges:
                out_edges[src].append((tgt, w))
                out_weights[src] += w

        # Normalization of seed vector p0
        valid_seeds = {k: v for k, v in seed_nodes.items() if k in out_edges}
        if not valid_seeds:
            # Fallback uniform over all nodes
            p0 = {n: 1.0 / len(all_nodes) for n in all_nodes}
        else:
            seed_sum = sum(valid_seeds.values()) or 1.0
            p0 = {n: (valid_seeds.get(n, 0.0) / seed_sum) for n in all_nodes}

        # Initialize p = p0
        p = dict(p0)

        # Power iteration
        for _ in range(max_iter):
            next_p = {n: (1.0 - alpha) * p0[n] for n in all_nodes}

            # Distribute mass from nodes
            for src, src_weight in p.items():
                if out_weights[src] > 0.0:
                    for tgt, w in out_edges[src]:
                        transfer = alpha * src_weight * (w / out_weights[src])
                        next_p[tgt] += transfer
                else:
                    # Dangling node distribution
                    for n in all_nodes:
                        next_p[n] += alpha * src_weight * (1.0 / len(all_nodes))

            # Check convergence
            diff = sum(abs(next_p[n] - p[n]) for n in all_nodes)
            p = next_p
            if diff < tol:
                break

        ranked = sorted(p.items(), key=lambda x: x[1], reverse=True)
        return [(name, round(score, 6)) for name, score in ranked if score > 1e-5]

    def count_memories(self) -> int:
        cur = self.conn.cursor()
        cur.execute("SELECT COUNT(*) as cnt FROM synaptic_memories")
        return int(cur.fetchone()["cnt"])
