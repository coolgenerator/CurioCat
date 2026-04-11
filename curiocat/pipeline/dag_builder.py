"""Stage 4: DAG Construction.

Builds a directed acyclic graph from claims and causal edges,
breaking cycles at the weakest edge and pruning weak connections.
"""

from __future__ import annotations

import logging
from typing import Any

import networkx as nx

from curiocat.exceptions import DAGError

logger = logging.getLogger(__name__)

# Edges with strength below this threshold are pruned
_MIN_EDGE_STRENGTH = 0.1


class DAGBuilder:
    """Constructs a clean directed acyclic graph from claims and edges.

    Handles cycle detection and breaking, weak-edge pruning, and
    populates node/edge attributes for downstream graph algorithms.
    """

    def build(
        self,
        claims: list[dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> tuple[nx.DiGraph, dict[str, str], list[tuple[str, str]]]:
        """Build a DAG from extracted claims and inferred causal edges.

        Pipeline:
        1. Create a DiGraph with claim nodes and causal edges.
        2. Detect cycles using topological sort.
        3. Break cycles at the weakest edge (lowest strength * evidence_score).
        4. Prune edges with strength < 0.1.
        5. Determine logic gates for multi-parent nodes.
        6. Return a clean DAG, logic gate map, and feedback edges.

        Args:
            claims: List of claim dicts with text, type, confidence,
                embedding, and order_index.
            edges: List of edge dicts with source_idx, target_idx,
                mechanism, strength, evidence_score, etc.

        Returns:
            A tuple of (networkx DiGraph, logic_gate_map, feedback_edges)
            where logic_gate_map maps node_id -> "or" | "and" and
            feedback_edges is a list of (source_id, target_id) tuples
            that were removed to break cycles.

        Raises:
            DAGError: If graph construction fails irrecoverably.
        """
        graph = nx.DiGraph()

        # Add claim nodes
        for i, claim in enumerate(claims):
            node_id = str(i)
            graph.add_node(
                node_id,
                text=claim["text"],
                claim_type=claim["type"],
                confidence=claim["confidence"],
                embedding=claim.get("embedding"),
                order_index=claim.get("order_index", i),
                belief=claim["confidence"],  # Initial belief = confidence
            )

        # Add causal edges
        for edge in edges:
            source_id = str(edge["source_idx"])
            target_id = str(edge["target_idx"])

            # Skip self-loops
            if source_id == target_id:
                logger.warning("Skipping self-loop on node %s", source_id)
                continue

            evidence_score = edge.get("evidence_score", 0.5)
            strength = edge.get("strength", 0.5)

            graph.add_edge(
                source_id,
                target_id,
                mechanism=edge.get("mechanism", ""),
                strength=strength,
                time_delay=edge.get("time_delay"),
                conditions=edge.get("conditions", []),
                reversible=edge.get("reversible", False),
                evidence_score=evidence_score,
                direction=edge.get("direction", "source_to_target"),
                causal_type=edge.get("causal_type", "direct"),
                condition_type=edge.get("condition_type", "contributing"),
                temporal_window=edge.get("temporal_window"),
                decay_type=edge.get("decay_type", "none"),
                bias_warnings=edge.get("bias_warnings", []),
            )

        # Prune weak edges before cycle detection
        edges_to_remove = [
            (u, v)
            for u, v, data in graph.edges(data=True)
            if data.get("strength", 0) < _MIN_EDGE_STRENGTH
        ]
        if edges_to_remove:
            logger.info("Pruning %d weak edges (strength < %.2f)", len(edges_to_remove), _MIN_EDGE_STRENGTH)
            graph.remove_edges_from(edges_to_remove)

        # Break cycles
        graph, feedback_edges = self._break_cycles(graph)

        # Determine logic gates for multi-parent nodes
        logic_gate_map = self._determine_logic_gates(graph)

        # Set logic_gate on nodes
        for node_id, gate in logic_gate_map.items():
            graph.nodes[node_id]["logic_gate"] = gate

        logger.info(
            "Built DAG with %d nodes and %d edges",
            graph.number_of_nodes(),
            graph.number_of_edges(),
        )

        return graph, logic_gate_map, feedback_edges

    def _break_cycles(self, graph: nx.DiGraph) -> tuple[nx.DiGraph, list[tuple[str, str]]]:
        """Detect and break cycles by removing the weakest edge in each cycle.

        Iteratively finds cycles and removes the edge with the lowest
        combined score (strength * evidence_score) until the graph is a DAG.

        Args:
            graph: The directed graph, potentially containing cycles.

        Returns:
            A tuple of (modified graph, feedback_edges) where feedback_edges
            is the list of (source, target) edges removed to break cycles.
        """
        feedback_edges: list[tuple[str, str]] = []
        max_iterations = graph.number_of_edges()
        iteration = 0

        while iteration < max_iterations:
            try:
                # If topological_sort succeeds, there are no cycles
                list(nx.topological_sort(graph))
                break
            except nx.NetworkXUnfeasible:
                # Find a cycle
                try:
                    cycle = nx.find_cycle(graph)
                except nx.NetworkXError:
                    break

                # Find the weakest edge in the cycle
                weakest_edge = None
                weakest_score = float("inf")

                for u, v, *_ in cycle:
                    edge_data = graph.edges[u, v]
                    score = edge_data.get("strength", 0.5) * edge_data.get(
                        "evidence_score", 0.5
                    )
                    if score < weakest_score:
                        weakest_score = score
                        weakest_edge = (u, v)

                if weakest_edge is None:
                    raise DAGError("Failed to identify weakest edge in cycle")

                logger.info(
                    "Breaking cycle by removing edge %s -> %s (score=%.3f)",
                    weakest_edge[0],
                    weakest_edge[1],
                    weakest_score,
                )
                feedback_edges.append(weakest_edge)
                graph.remove_edge(*weakest_edge)
                iteration += 1

        return graph, feedback_edges

    @staticmethod
    def _determine_logic_gates(graph: nx.DiGraph) -> dict[str, str]:
        """Determine logic gate (AND/OR) for each multi-parent node.

        Rules:
        - All incoming edges have causal_type "enabling" -> AND
        - Any incoming edge has condition_type "necessary" -> AND
        - Otherwise -> OR (default, preserves current behavior)

        Returns:
            Dict mapping node_id -> "or" | "and".
        """
        logic_gates: dict[str, str] = {}

        for node_id in graph.nodes():
            predecessors = list(graph.predecessors(node_id))
            if len(predecessors) <= 1:
                logic_gates[node_id] = "or"
                continue

            incoming_edges = [
                graph.edges[p, node_id] for p in predecessors
            ]

            all_enabling = all(
                e.get("causal_type") == "enabling" for e in incoming_edges
            )
            any_necessary = any(
                e.get("condition_type") == "necessary" for e in incoming_edges
            )

            if all_enabling or any_necessary:
                logic_gates[node_id] = "and"
            else:
                logic_gates[node_id] = "or"

        return logic_gates
