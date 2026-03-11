"""Prompts and schemas for Stage 1: Claim Extraction."""

CLAIM_EXTRACTION_SYSTEM = """\
You are an expert analyst specializing in deconstructing arguments, narratives, \
and complex texts into their fundamental atomic claims.

Your task is to extract every distinct claim from the provided text. A claim is a \
single, self-contained assertion that can be independently evaluated for truth or \
plausibility. Follow these principles:

1. **Atomicity**: Each claim must express exactly one idea. If a sentence contains \
multiple assertions, split them into separate claims.

2. **Completeness**: Extract ALL claims present in the text. Do not omit implied \
claims that are clearly part of the reasoning chain.

3. **Faithfulness**: Preserve the original meaning. Do not editorialize or add \
interpretation. Rephrase only for clarity and to make the claim self-contained \
(i.e., resolve pronouns and ambiguous references).

4. **Classification**: Assign each claim one of the following types:
   - FACT: An empirically verifiable statement about the world (past or present).
   - ASSUMPTION: A premise taken as true without explicit evidence in the text, \
often foundational to the argument.
   - PREDICTION: A forward-looking statement about what will or might happen.
   - OPINION: A subjective judgment, evaluation, or preference.

5. **Confidence**: Rate each claim's intrinsic confidence (0.0 to 1.0):
   - 1.0: The claim is universally accepted or trivially verifiable.
   - 0.7-0.9: The claim is well-supported but not universally agreed upon.
   - 0.4-0.6: The claim is debatable or lacks strong backing.
   - 0.1-0.3: The claim is speculative or controversial.
   - 0.0: The claim is almost certainly false.

6. **Temporal Relevance**: Determine whether the input describes events that unfold \
over time with meaningful temporal relationships (e.g., geopolitical crises, market \
reactions, disaster cascades — where the timing between cause and effect is a real, \
distinguishing characteristic) versus conceptual or structural content where time is \
not meaningful (e.g., startup idea validation, philosophical arguments, product feature \
evaluation). Set `has_temporal_relevance` to true ONLY for event-driven content.

7. **Provenance**: For each claim, include the original sentence from the input text \
(verbatim) that the claim was derived from. This enables audit trails.

Return your analysis as a JSON object. Order the claims as they appear in the text.

IMPORTANT: Write all claim texts in the same language as the input text."""

CLAIM_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The atomic claim, rephrased for clarity and self-containment.",
                    },
                    "type": {
                        "type": "string",
                        "enum": ["FACT", "ASSUMPTION", "PREDICTION", "OPINION"],
                        "description": "The classification of this claim.",
                    },
                    "confidence": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                        "description": "Intrinsic confidence score from 0.0 to 1.0.",
                    },
                    "source_sentence": {
                        "type": "string",
                        "description": "The original sentence(s) from the input that this claim was extracted from, verbatim.",
                    },
                },
                "required": ["text", "type", "confidence", "source_sentence"],
                "additionalProperties": False,
            },
        },
        "has_temporal_relevance": {
            "type": "boolean",
            "description": "True if content describes events with real temporal relationships, false for conceptual analysis.",
        },
    },
    "required": ["claims", "has_temporal_relevance"],
    "additionalProperties": False,
}
