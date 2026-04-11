"""Add three-layer causal analysis tables.

New tables:
  - multi_layer_evidence: Multi-layer causal evidence (Layer 1/2/3)
  - event_timeline: PM intervention/change event tracking
  - metric_series: Parsed time-series data for statistical analysis

Revision ID: 003
Revises: 002
Create Date: 2026-04-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSON

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── MultiLayerEvidence ──
    op.create_table(
        "multi_layer_evidence",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=True),
        sa.Column("source_claim_id", UUID(as_uuid=True), sa.ForeignKey("claim.id", ondelete="SET NULL"), nullable=True),
        sa.Column("target_claim_id", UUID(as_uuid=True), sa.ForeignKey("claim.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_label", sa.String(500), nullable=False),
        sa.Column("target_label", sa.String(500), nullable=False),
        sa.Column("layer", sa.Integer, nullable=False),
        sa.Column("algorithm", sa.String(50), nullable=False),
        sa.Column("edge_type", sa.String(30), server_default="directed"),
        sa.Column("lag", sa.Integer, nullable=True),
        sa.Column("confidence", sa.Float, server_default="0.5"),
        sa.Column("p_value", sa.Float, nullable=True),
        sa.Column("effect_size", sa.Float, nullable=True),
        sa.Column("sample_size", sa.Integer, nullable=True),
        sa.Column("data_type", sa.String(30), server_default="unknown"),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("metadata", JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_mle_project_id", "multi_layer_evidence", ["project_id"])
    op.create_index("ix_mle_layer", "multi_layer_evidence", ["layer"])

    # ── EventTimeline ──
    op.create_table(
        "event_timeline",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("event_type", sa.String(30), nullable=False),
        sa.Column("event_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(20), server_default="manual"),
        sa.Column("affected_metrics", JSON, nullable=True),
        sa.Column("evidence_ids", JSON, nullable=True),
        sa.Column("metadata", JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_et_project_id", "event_timeline", ["project_id"])
    op.create_index("ix_et_event_date", "event_timeline", ["event_date"])

    # ── MetricSeries ──
    op.create_table(
        "metric_series",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("unit", sa.String(50), nullable=True),
        sa.Column("frequency", sa.String(20), nullable=True),
        sa.Column("data_points", JSON, nullable=False),
        sa.Column("source_file", sa.String(500), nullable=True),
        sa.Column("metadata", JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_ms_project_id", "metric_series", ["project_id"])


    # ── Statistical validation columns on causal_edge ──
    op.add_column("causal_edge", sa.Column("statistical_validation", sa.String(20), nullable=True))
    op.add_column("causal_edge", sa.Column("stat_p_value", sa.Float, nullable=True))
    op.add_column("causal_edge", sa.Column("stat_f_statistic", sa.Float, nullable=True))
    op.add_column("causal_edge", sa.Column("stat_effect_size", sa.Float, nullable=True))
    op.add_column("causal_edge", sa.Column("stat_lag", sa.Integer, nullable=True))


def downgrade() -> None:
    op.drop_column("causal_edge", "stat_lag")
    op.drop_column("causal_edge", "stat_effect_size")
    op.drop_column("causal_edge", "stat_f_statistic")
    op.drop_column("causal_edge", "stat_p_value")
    op.drop_column("causal_edge", "statistical_validation")
    op.drop_table("metric_series")
    op.drop_table("event_timeline")
    op.drop_table("multi_layer_evidence")
