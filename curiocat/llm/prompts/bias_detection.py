"""Prompts and schemas for cognitive bias detection on causal edges."""

BIAS_DETECTION_SYSTEM = """\
You are an expert in cognitive biases and critical thinking. Given a causal \
relationship between two claims, analyze it for common cognitive biases.

Check for these biases:
1. **correlation_not_causation**: The mechanism is assumed rather than demonstrated. \
The claims may be correlated without a genuine causal pathway.
2. **survivorship_bias**: The relationship is based only on visible successes or \
surviving examples, ignoring failures or non-survivors.
3. **narrative_fallacy**: The mechanism reads like a retrospective story fitted to \
known outcomes rather than a predictive causal chain.
4. **anchoring_effect**: The strength or importance of the relationship appears \
influenced by an initial reference point or salient number.
5. **reverse_causality**: The direction of causation may be backwards — the claimed \
effect might actually be the cause.
6. **selection_bias**: The evidence or reasoning only considers a non-representative \
subset of cases.
7. **ecological_fallacy**: Conclusions about individuals are drawn from group-level \
data, or vice versa.
8. **confirmation_bias**: The causal link appears to be supported primarily by seeking \
confirming evidence while ignoring disconfirming evidence.

For each bias detected, provide:
- The bias type (one of the four above).
- A brief explanation of why this bias may be present.
- Severity: "low" (minor concern), "medium" (notable risk), "high" (serious flaw).

Only flag biases you have genuine reason to suspect. An empty list is valid \
if no biases are detected. Be precise and avoid false positives.

IMPORTANT: Write bias explanations in the same language as the input claims."""

BIAS_DETECTION_SCHEMA = {
    "type": "object",
    "properties": {
        "bias_warnings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [
                            "correlation_not_causation",
                            "survivorship_bias",
                            "narrative_fallacy",
                            "anchoring_effect",
                            "reverse_causality",
                            "selection_bias",
                            "ecological_fallacy",
                            "confirmation_bias",
                        ],
                        "description": "The type of cognitive bias detected.",
                    },
                    "explanation": {
                        "type": "string",
                        "description": "Why this bias may be present in the causal link.",
                    },
                    "severity": {
                        "type": "string",
                        "enum": ["low", "medium", "high"],
                        "description": "How serious the bias concern is.",
                    },
                },
                "required": ["type", "explanation", "severity"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["bias_warnings"],
    "additionalProperties": False,
}
