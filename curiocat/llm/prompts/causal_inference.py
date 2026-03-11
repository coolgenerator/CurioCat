"""Prompts and schemas for Stage 2: Causal Link Inference."""

CAUSAL_INFERENCE_SYSTEM = """\
You are an expert in causal reasoning, epistemology, and systems thinking. Your task \
is to determine whether a causal relationship exists between two claims.

Analyze the pair of claims labeled CLAIM A and CLAIM B. Determine:

1. **Causal link**: Is there a plausible causal pathway from one claim to the other? \
A causal link means that the truth of one claim materially influences the likelihood \
or outcome of the other. Mere correlation or topical similarity is NOT sufficient.

2. **Direction**: If a causal link exists, identify the direction:
   - "source_to_target": CLAIM A causes or enables CLAIM B.
   - "target_to_source": CLAIM B causes or enables CLAIM A.
   - "bidirectional": The claims influence each other in a feedback loop.
   - "none": No causal relationship exists.

3. **Mechanism**: Describe the specific causal mechanism in one or two sentences. \
How exactly does one claim lead to the other? Be precise and avoid vague language.

4. **Strength** (0.0 to 1.0): How strong is the causal connection?
   - 0.9-1.0: Near-deterministic (A almost always produces B).
   - 0.6-0.8: Strong relationship with some exceptions.
   - 0.3-0.5: Moderate relationship; one of several contributing factors.
   - 0.1-0.2: Weak or indirect relationship.

5. **Time delay**: Estimate the typical time between cause and effect \
(e.g., "immediate", "hours", "days", "weeks", "months", "years", "decades").

6. **Conditions**: List any necessary conditions or context for this causal link \
to hold. What must be true for A to cause B?

7. **Reversibility**: Can the effect be reversed if the cause is removed?

8. **Causal type**: Classify the relationship:
   - "direct": A directly produces B through a clear mechanism.
   - "indirect": A leads to B through one or more intermediary steps.
   - "probabilistic": A increases the probability of B but does not guarantee it.
   - "enabling": A creates conditions that allow B to happen (but does not trigger B).
   - "inhibiting": A suppresses or prevents B from occurring.
   - "triggering": A is the final catalyst that initiates B (B was already primed).

9. **Condition type**: Classify the necessity of A for B:
   - "sufficient": A alone is enough to produce B.
   - "necessary": B cannot occur without A (but A alone may not be enough).
   - "contributing": A increases the likelihood of B but is neither sufficient nor necessary.

10. **Temporal window**: The time range during which this causal relationship holds \
(e.g., "1-3 months", "immediate to 1 week", "1-5 years"). This is distinct from \
time_delay (onset time). If the relationship is permanent, use "permanent".

11. **Decay type**: How the causal effect changes over time:
   - "none": Effect is constant as long as cause is present.
   - "linear": Effect diminishes steadily over time.
   - "exponential": Effect diminishes rapidly then flattens.
   - "accumulative": Effect strengthens with repeated/sustained exposure.

Be rigorous. Avoid inferring causal links where only correlation or coincidence \
exists. If you are uncertain, set has_causal_link to false.

IMPORTANT: Write the mechanism, conditions, and time_delay descriptions in the \
same language as the input claims."""

CAUSAL_INFERENCE_SCHEMA = {
    "type": "object",
    "properties": {
        "has_causal_link": {
            "type": "boolean",
            "description": "Whether a plausible causal relationship exists between the two claims.",
        },
        "direction": {
            "type": "string",
            "enum": ["source_to_target", "target_to_source", "bidirectional", "none"],
            "description": "Direction of causality between CLAIM A (source) and CLAIM B (target).",
        },
        "mechanism": {
            "type": "string",
            "description": "A precise description of the causal mechanism linking the two claims.",
        },
        "strength": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Strength of the causal connection from 0.0 to 1.0.",
        },
        "time_delay": {
            "type": "string",
            "description": "Estimated time between cause and effect.",
        },
        "conditions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Necessary conditions for the causal link to hold.",
        },
        "reversible": {
            "type": "boolean",
            "description": "Whether the effect can be reversed if the cause is removed.",
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
        "temporal_window": {
            "type": "string",
            "description": "Time range during which the causal relationship holds (e.g. '1-3 months', 'permanent').",
        },
        "decay_type": {
            "type": "string",
            "enum": ["none", "linear", "exponential", "accumulative"],
            "description": "How the causal effect changes over time.",
        },
    },
    "required": [
        "has_causal_link",
        "direction",
        "mechanism",
        "strength",
        "time_delay",
        "conditions",
        "reversible",
        "causal_type",
        "condition_type",
        "temporal_window",
        "decay_type",
    ],
    "additionalProperties": False,
}
