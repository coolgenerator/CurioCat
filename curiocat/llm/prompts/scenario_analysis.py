"""Prompts and schemas for LLM-driven scenario hypothesis analysis."""

SCENARIO_ANALYSIS_SYSTEM = """\
You are an expert analyst. Given a causal graph with evidence and a \
hypothetical scenario, produce a comprehensive research-grade report.

## Input

You will receive:
1. A rich causal graph: critical path, causal chains with evidence, \
root causes, terminal outcomes, and indexed edges.
2. A scenario hypothesis with name, description, and/or injected events.

## How to Analyze

### Step 1: Understand the Question
Read the scenario name and description carefully. Identify what the user \
actually wants to know. If the scenario is a question (e.g. "What \
would happen if…"), your report must directly and concretely answer it.

### Step 2: Identify Affected Subgraphs
Walk the causal chains in the graph context. For each injected event, \
trace which root causes, intermediate nodes, and terminal outcomes are \
affected. Group related effects into thematic clusters.

For example, a scenario about "AI replacing white-collar jobs" might \
yield clusters like: technology adoption dynamics, labor market shifts, \
regulatory & policy responses, education system adaptation.

### Step 3: Produce the Analysis
Write the "analysis" field as a structured Markdown report. Include \
the following sections as appropriate — skip any that don't apply:

#### 3a. Direct Answer
If the scenario poses a question, answer it first with concrete, \
specific items. Each item should cite supporting nodes, edges, or \
evidence from the graph.

Example structure for a career-direction question:
> ### AI Safety Research
> The graph shows "AI capability growth" → "alignment risk increase" \
(strength=0.85, evidence=0.78). Multiple high-credibility sources \
support this path. However, edge [3] has a bias warning for \
confirmation_bias — the field may be overestimating near-term risk.
> **Risks**: Funding concentration, unclear career ladder…

#### 3b. Thematic Deep-Dives
For each cluster, write a subsection covering:
- **What changes**: Which edges shift and why, citing mechanism and evidence
- **Cascade path**: Trace the chain using A → B → C notation, noting \
strength and evidence quality at each hop
- **Counter-evidence**: What contradicts this path? Cite contradicting \
evidence snippets, low evidence scores, or bias warnings
- **Net assessment**: On balance, how confident should we be?

#### 3c. Cross-Cutting Risks & Uncertainties
Identify weak links — edges with low evidence scores or bias warnings. \
Explain what could go wrong if these assumptions fail, and which \
conclusions depend on them.

#### 3d. Second-Order & Emergent Effects
Look for interactions between multiple changing edges. Are there \
feedback loops, tipping points, or surprising convergences that only \
emerge from the combined changes?

### Step 4: Key Insights
Each insight should be a substantive paragraph, not a one-liner. \
Cite specific evidence or edge data to justify the claim.

### Step 5: Conclusion
Summarize the overall picture. Distinguish what is well-supported \
from what remains uncertain. Give a clear bottom-line assessment.

### Step 6: Edge Changes
For each edge the scenario affects, specify its index, new strength, \
and a reason. Only change edges with clear justification.

## Formatting Rules

- Use Markdown: ## headings, ### subheadings, **bold**, bullet lists
- Cite evidence using > blockquote: > "snippet…" — Source (credibility=X)
- Use A → B → C notation for causal chains
- Depth should match the complexity of the scenario — simple scenarios \
need concise reports, complex ones need thorough analysis
- Write all output in the SAME LANGUAGE as the graph content
- Strength 0.0 = link severed; 1.0 = certain"""

SCENARIO_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "edge_changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "edge_index": {
                        "type": "integer",
                        "description": "The index number of the edge to modify.",
                    },
                    "new_strength": {
                        "type": "number",
                        "description": "New strength value between 0.0 and 1.0.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Brief explanation referencing evidence or mechanism.",
                    },
                },
                "required": ["edge_index", "new_strength", "reason"],
                "additionalProperties": False,
            },
        },
        "analysis": {
            "type": "string",
            "description": "Comprehensive Markdown report with ## headings, "
            "thematic deep-dives, causal chain traces, evidence citations, "
            "counter-arguments, and second-order effects.",
        },
        "key_insights": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Substantive insights, each citing specific "
            "evidence or edge data from the graph.",
        },
        "conclusion": {
            "type": "string",
            "description": "Bottom-line assessment: what is well-supported, "
            "what is uncertain, and the overall verdict.",
        },
    },
    "required": ["edge_changes", "analysis", "key_insights", "conclusion"],
    "additionalProperties": False,
}
