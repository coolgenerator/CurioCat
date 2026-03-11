"""Prompt and JSON schema for the Strategic Advisor feature."""

# --- Perspective Suggestions ---

SUGGEST_PERSPECTIVES_SYSTEM = """\
You are analyzing a causal graph to suggest relevant stakeholder perspectives \
for strategic analysis. Given a list of claim texts from the graph, generate \
4-6 diverse perspectives (roles/viewpoints) that would find this analysis \
most relevant and actionable.

Guidelines:
- Each perspective should be a specific role or stakeholder type, not a broad \
industry category.
- Cover different angles: direct stakeholders, indirect affected parties, \
investors, regulators, competitors, consumers.
- Make suggestions specific to the graph content — not generic.
- Output in the SAME LANGUAGE as the claims. If claims are in Chinese, \
write labels and descriptions in Chinese.

Return JSON."""

SUGGEST_PERSPECTIVES_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {
                        "type": "string",
                        "description": "Short role/perspective name (2-6 words).",
                    },
                    "description": {
                        "type": "string",
                        "description": "One sentence explaining why this perspective is relevant.",
                    },
                },
                "required": ["label", "description"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["suggestions"],
    "additionalProperties": False,
}

# --- Strategic Advisor ---

STRATEGIC_ADVISOR_SYSTEM = """\
You are a strategic advisor with deep expertise in geopolitics, supply chains, \
finance, and risk management. You are given:

1. A user's business context (their industry, operations, dependencies).
2. A compressed summary of a causal graph — claims, causal edges, beliefs, \
sensitivities, critical paths, and evidence quality.

Your task: produce a structured strategic report that is **specific to the \
user's context** and **grounded in the actual graph data**. Follow these rules:

- Reference specific claims from the graph by their EXACT text (quote them).
- Prioritize claims on the critical path and high-sensitivity nodes — these \
drive the most downstream impact.
- Note where evidence quality is weak (low evidence scores, insufficient \
consensus) — flag these as higher-uncertainty areas.
- For timelines, use the temporal information from edges (time_delay, \
temporal_window, decay_type) when available.
- Be concrete: name specific actions, thresholds, data sources. Avoid \
generic advice like "monitor the situation".
- Output in the SAME LANGUAGE as the claim texts in the graph summary. \
If claims are in Chinese, write the entire report in Chinese. If in English, \
write in English.

Return your analysis as JSON with the five sections described below."""

STRATEGIC_ADVISOR_SCHEMA = {
    "type": "object",
    "properties": {
        "impact_assessment": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Executive summary (2-4 sentences) of overall impact on the user's business.",
                },
                "overall_severity": {
                    "type": "string",
                    "enum": ["critical", "high", "medium", "low"],
                    "description": "Overall severity level for this business context.",
                },
                "direct_impacts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "claim_text": {
                                "type": "string",
                                "description": "Exact text of the graph claim causing direct impact.",
                            },
                            "impact_description": {
                                "type": "string",
                                "description": "How this claim directly affects the user's business.",
                            },
                            "severity": {
                                "type": "string",
                                "enum": ["critical", "high", "medium", "low"],
                            },
                            "timeline": {
                                "type": "string",
                                "description": "When this impact would materialize.",
                            },
                        },
                        "required": ["claim_text", "impact_description", "severity", "timeline"],
                        "additionalProperties": False,
                    },
                },
                "indirect_impacts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "causal_chain": {
                                "type": "string",
                                "description": "The chain of claims leading to this impact (A -> B -> C).",
                            },
                            "impact_description": {
                                "type": "string",
                                "description": "How the end of this chain affects the user's business.",
                            },
                            "severity": {
                                "type": "string",
                                "enum": ["critical", "high", "medium", "low"],
                            },
                            "timeline": {
                                "type": "string",
                                "description": "When this impact would materialize.",
                            },
                        },
                        "required": ["causal_chain", "impact_description", "severity", "timeline"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["summary", "overall_severity", "direct_impacts", "indirect_impacts"],
            "additionalProperties": False,
        },
        "predictions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "prediction": {
                        "type": "string",
                        "description": "A specific prediction for the user's business.",
                    },
                    "probability": {
                        "type": "number",
                        "description": "Estimated probability (0.0-1.0).",
                    },
                    "timeframe": {
                        "type": "string",
                        "description": "When this prediction would play out.",
                    },
                    "basis": {
                        "type": "string",
                        "description": "Which graph claims/edges support this prediction.",
                    },
                    "confidence_note": {
                        "type": "string",
                        "description": "Note on evidence quality or uncertainty.",
                    },
                },
                "required": ["prediction", "probability", "timeframe", "basis", "confidence_note"],
                "additionalProperties": False,
            },
        },
        "recommended_actions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "description": "Specific action the user should take.",
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["immediate", "short-term", "medium-term", "long-term"],
                    },
                    "timeframe": {
                        "type": "string",
                        "description": "When to act.",
                    },
                    "addresses_claim": {
                        "type": "string",
                        "description": "Which graph claim this action addresses.",
                    },
                    "rationale": {
                        "type": "string",
                        "description": "Why this action is recommended.",
                    },
                },
                "required": ["action", "priority", "timeframe", "addresses_claim", "rationale"],
                "additionalProperties": False,
            },
        },
        "escalation_scenarios": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "scenario_name": {
                        "type": "string",
                        "description": "Short name for the escalation scenario.",
                    },
                    "trigger": {
                        "type": "string",
                        "description": "What would trigger this escalation.",
                    },
                    "causal_chain": {
                        "type": "string",
                        "description": "The causal chain from trigger to impact.",
                    },
                    "impact_on_user": {
                        "type": "string",
                        "description": "How this escalation impacts the user's business.",
                    },
                    "probability": {
                        "type": "number",
                        "description": "Estimated probability (0.0-1.0).",
                    },
                    "severity": {
                        "type": "string",
                        "enum": ["critical", "high", "medium", "low"],
                    },
                    "contingency_actions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Actions to take if this scenario materializes.",
                    },
                },
                "required": [
                    "scenario_name",
                    "trigger",
                    "causal_chain",
                    "impact_on_user",
                    "probability",
                    "severity",
                    "contingency_actions",
                ],
                "additionalProperties": False,
            },
        },
        "key_indicators": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "indicator": {
                        "type": "string",
                        "description": "What to monitor.",
                    },
                    "data_source": {
                        "type": "string",
                        "description": "Where to find this data.",
                    },
                    "related_claim": {
                        "type": "string",
                        "description": "Which graph claim this indicator tracks.",
                    },
                    "threshold": {
                        "type": "string",
                        "description": "Action threshold (e.g. 'Brent > $120/bbl').",
                    },
                    "signal_type": {
                        "type": "string",
                        "enum": ["leading", "coincident", "lagging"],
                    },
                },
                "required": ["indicator", "data_source", "related_claim", "threshold", "signal_type"],
                "additionalProperties": False,
            },
        },
    },
    "required": [
        "impact_assessment",
        "predictions",
        "recommended_actions",
        "escalation_scenarios",
        "key_indicators",
    ],
    "additionalProperties": False,
}
