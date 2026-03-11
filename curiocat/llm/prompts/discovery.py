"""LLM prompt for extracting new claims from evidence snippets.

Used during discovery layers to find novel facts in evidence that are
not already represented in the existing claim set.
"""

DISCOVERY_SYSTEM = """You are an evidence analyst. Given a causal relationship \
and its supporting/contradicting evidence snippets, extract NEW claims \
that are not already represented in the existing claim list.

Focus on:
- New statistics, data points, or quantified relationships (type: FACT)
- Previously unknown causes or effects mentioned in evidence (type: FACT)
- Predictions or forecasts about future developments (type: PREDICTION)
- Underlying assumptions that the evidence takes for granted (type: ASSUMPTION)
- Expert opinions, evaluations, or subjective judgments (type: OPINION)
- Conditions, caveats, or qualifications not captured
- Contradictory claims that challenge existing ones

Classify each claim accurately:
- FACT: Empirically verifiable statement about the past or present.
- ASSUMPTION: A premise taken as given without explicit proof.
- PREDICTION: A forward-looking statement about what will or might happen.
- OPINION: A subjective judgment, evaluation, or preference.
Do NOT label predictions or opinions as FACT. Use the full range of types.

Do NOT re-extract claims that are semantically equivalent to existing ones.
Return an empty list if no genuinely new information is found.

IMPORTANT: Write all new claim texts in the same language as the existing claims."""

DISCOVERY_SCHEMA = {
    "type": "object",
    "properties": {
        "new_claims": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "type": {
                        "type": "string",
                        "enum": ["FACT", "ASSUMPTION", "PREDICTION", "OPINION"],
                    },
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "source_snippet": {"type": "string"},
                },
                "required": ["text", "type", "confidence", "source_snippet"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["new_claims"],
    "additionalProperties": False,
}
