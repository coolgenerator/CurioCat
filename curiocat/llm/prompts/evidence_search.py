"""Prompts and schemas for Stage 3: Evidence Relevance Scoring."""

EVIDENCE_RELEVANCE_SYSTEM = """\
You are evaluating whether a piece of evidence is relevant to a specific causal claim.

You will be given:
- A CAUSAL CLAIM describing a cause-and-effect relationship between two statements.
- An EVIDENCE SNIPPET retrieved from a web search result.

Your task is to assess:

1. **Relevance score** (0.0 to 1.0): How directly does this evidence relate to the \
causal claim?
   - 0.9-1.0: The evidence directly addresses the specific causal mechanism.
   - 0.6-0.8: The evidence is about the same topic and partially addresses causality.
   - 0.3-0.5: The evidence is tangentially related.
   - 0.0-0.2: The evidence is unrelated or off-topic.

2. **Supporting or contradicting**: Does this evidence support or contradict the \
causal claim? Consider:
   - Supporting: The evidence provides data, examples, or expert analysis that \
strengthens the causal link.
   - Contradicting: The evidence provides counter-examples, conflicting data, or \
arguments against the causal link.
   - If the evidence is neutral or irrelevant, lean toward marking it as \
non-supporting with a low relevance score.

3. **Summary**: Write a one-sentence summary of how this evidence relates to the \
causal claim. Be specific about what it supports or contradicts.

Be objective and critical. Do not assume evidence supports a claim merely because \
it mentions the same topic."""

EVIDENCE_RELEVANCE_SCHEMA = {
    "type": "object",
    "properties": {
        "relevance_score": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "How directly the evidence relates to the causal claim (0.0 to 1.0).",
        },
        "is_supporting": {
            "type": "boolean",
            "description": "True if the evidence supports the causal claim, false if it contradicts.",
        },
        "summary": {
            "type": "string",
            "description": "A one-sentence summary of how the evidence relates to the causal claim.",
        },
    },
    "required": ["relevance_score", "is_supporting", "summary"],
    "additionalProperties": False,
}

# --- Batched evidence scoring (all snippets for one edge in a single LLM call) ---

EVIDENCE_BATCH_RELEVANCE_SYSTEM = """\
You are evaluating multiple evidence snippets against a single causal claim.

You will be given:
- A CAUSAL CLAIM describing a cause-and-effect relationship.
- Multiple EVIDENCE SNIPPETS, each with an index number.

For EACH snippet, assess:
1. **Relevance score** (0.0 to 1.0): How directly it relates to the causal claim.
2. **Supporting or contradicting**: Does it support or contradict the claim?
3. **Summary**: One-sentence summary of how it relates to the claim.

Be objective and critical. Do not assume evidence supports a claim merely because \
it mentions the same topic."""

EVIDENCE_BATCH_RELEVANCE_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {
                        "type": "integer",
                        "description": "The snippet index number (starting from 0).",
                    },
                    "relevance_score": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                        "description": "How directly the evidence relates to the causal claim.",
                    },
                    "is_supporting": {
                        "type": "boolean",
                        "description": "True if the evidence supports the causal claim.",
                    },
                    "summary": {
                        "type": "string",
                        "description": "One-sentence summary of how the evidence relates to the claim.",
                    },
                },
                "required": ["index", "relevance_score", "is_supporting", "summary"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["results"],
    "additionalProperties": False,
}
