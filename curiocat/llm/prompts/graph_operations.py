"""Prompts and JSON schemas for interactive graph operations."""

# --- Expand: generate consequences of a claim ---

EXPAND_SYSTEM = """\
You are a causal reasoning expert. Given a claim (the "source") and its \
surrounding context in a causal graph, generate 3-5 plausible direct \
consequences that would follow from this claim.

Guidelines:
1. Each consequence must be a distinct, atomic claim.
2. Provide a mechanism explaining HOW the source leads to each consequence.
3. Estimate causal strength (0.0-1.0) — how reliably the source produces the consequence.
4. Estimate confidence (0.0-1.0) — how plausible the consequence is on its own.
5. Classify each consequence as FACT, ASSUMPTION, PREDICTION, or OPINION.
6. Include time delay (e.g. "days", "weeks", "months", "years") and conditions if relevant.
7. Avoid duplicating claims already present in the context.
8. Classify the causal type: direct, indirect, probabilistic, enabling, inhibiting, or triggering.
9. Classify the condition type: sufficient, necessary, or contributing.
10. If the user provides reasoning or questions, incorporate their perspective \
into your analysis. Focus on the aspects they question or highlight.

IMPORTANT: Write all text (claims, mechanisms, conditions) in the same language \
as the input claims.

Return your analysis as JSON."""

EXPAND_SCHEMA = {
    "type": "object",
    "properties": {
        "consequences": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The consequence claim text.",
                    },
                    "type": {
                        "type": "string",
                        "enum": ["FACT", "ASSUMPTION", "PREDICTION", "OPINION"],
                    },
                    "confidence": {
                        "type": "number",
                        "description": "Intrinsic confidence 0.0-1.0.",
                    },
                    "mechanism": {
                        "type": "string",
                        "description": "How the source claim leads to this consequence.",
                    },
                    "strength": {
                        "type": "number",
                        "description": "Causal strength 0.0-1.0.",
                    },
                    "time_delay": {
                        "type": "string",
                        "description": "Expected time delay (e.g. 'weeks', '1-3 months').",
                    },
                    "conditions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Conditions under which this consequence holds.",
                    },
                    "causal_type": {
                        "type": "string",
                        "enum": ["direct", "indirect", "probabilistic", "enabling", "inhibiting", "triggering"],
                        "description": "Classification of the causal relationship type.",
                    },
                    "condition_type": {
                        "type": "string",
                        "enum": ["sufficient", "necessary", "contributing"],
                        "description": "Whether the cause is sufficient, necessary, or contributing.",
                    },
                },
                "required": [
                    "text", "type", "confidence", "mechanism",
                    "strength", "time_delay", "conditions",
                    "causal_type", "condition_type",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["consequences"],
    "additionalProperties": False,
}


# --- Trace Back: generate causes of a claim ---

TRACE_BACK_SYSTEM = """\
You are a causal reasoning expert. Given a claim (the "target") and its \
surrounding context in a causal graph, generate 3-5 plausible direct \
causes that could lead to this claim.

Guidelines:
1. Each cause must be a distinct, atomic claim.
2. Provide a mechanism explaining HOW each cause leads to the target.
3. Estimate causal strength (0.0-1.0) — how reliably the cause produces the target.
4. Estimate confidence (0.0-1.0) — how plausible the cause is on its own.
5. Classify each cause as FACT, ASSUMPTION, PREDICTION, or OPINION.
6. Include time delay and conditions if relevant.
7. Avoid duplicating claims already present in the context.
8. Classify the causal type: direct, indirect, probabilistic, enabling, inhibiting, or triggering.
9. Classify the condition type: sufficient, necessary, or contributing.
10. If the user provides reasoning or questions, incorporate their perspective \
into your analysis. Focus on the aspects they question or highlight.

IMPORTANT: Write all text (claims, mechanisms, conditions) in the same language \
as the input claims.

Return your analysis as JSON."""

TRACE_BACK_SCHEMA = {
    "type": "object",
    "properties": {
        "causes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The cause claim text.",
                    },
                    "type": {
                        "type": "string",
                        "enum": ["FACT", "ASSUMPTION", "PREDICTION", "OPINION"],
                    },
                    "confidence": {
                        "type": "number",
                        "description": "Intrinsic confidence 0.0-1.0.",
                    },
                    "mechanism": {
                        "type": "string",
                        "description": "How this cause leads to the target claim.",
                    },
                    "strength": {
                        "type": "number",
                        "description": "Causal strength 0.0-1.0.",
                    },
                    "time_delay": {
                        "type": "string",
                        "description": "Expected time delay.",
                    },
                    "conditions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Conditions under which this cause applies.",
                    },
                    "causal_type": {
                        "type": "string",
                        "enum": ["direct", "indirect", "probabilistic", "enabling", "inhibiting", "triggering"],
                        "description": "Classification of the causal relationship type.",
                    },
                    "condition_type": {
                        "type": "string",
                        "enum": ["sufficient", "necessary", "contributing"],
                        "description": "Whether the cause is sufficient, necessary, or contributing.",
                    },
                },
                "required": [
                    "text", "type", "confidence", "mechanism",
                    "strength", "time_delay", "conditions",
                    "causal_type", "condition_type",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["causes"],
    "additionalProperties": False,
}


# --- Convergence Confirm: check if two claims are the same ---

CONVERGENCE_CONFIRM_SYSTEM = """\
You are a semantic similarity judge. Given two claims from a causal \
analysis graph, determine whether they refer to the same underlying \
concept, event, or assertion — even if worded differently.

Return your judgment as JSON."""

CONVERGENCE_CONFIRM_SCHEMA = {
    "type": "object",
    "properties": {
        "is_same_claim": {
            "type": "boolean",
            "description": "True if both claims refer to the same concept/event.",
        },
        "explanation": {
            "type": "string",
            "description": "Brief explanation of your judgment.",
        },
    },
    "required": ["is_same_claim", "explanation"],
    "additionalProperties": False,
}
