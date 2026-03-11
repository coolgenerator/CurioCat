"""Initial schema with pgvector extension and all tables.

Revision ID: 001
Revises:
Create Date: 2026-03-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Create project table
    op.create_table(
        "project",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("input_text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(50), nullable=False, server_default="pending"),
        sa.Column(
            "has_temporal",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Create claim table
    op.create_table(
        "claim",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "project_id",
            sa.UUID(),
            sa.ForeignKey("project.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "claim_type",
            sa.String(50),
            nullable=False,
            comment="FACT, ASSUMPTION, PREDICTION, or OPINION",
        ),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("embedding", Vector(1536), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("layer", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source_sentence", sa.Text(), nullable=True),
    )

    # Create causal_edge table
    op.create_table(
        "causal_edge",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "project_id",
            sa.UUID(),
            sa.ForeignKey("project.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source_claim_id",
            sa.UUID(),
            sa.ForeignKey("claim.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_claim_id",
            sa.UUID(),
            sa.ForeignKey("claim.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("mechanism", sa.Text(), nullable=False),
        sa.Column(
            "strength", sa.Float(), nullable=False, comment="0.0 to 1.0"
        ),
        sa.Column("time_delay", sa.String(100), nullable=True),
        sa.Column("conditions", sa.JSON(), nullable=True),
        sa.Column("reversible", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "evidence_score", sa.Float(), nullable=False, server_default="0.5"
        ),
    )

    # Create evidence table
    op.create_table(
        "evidence",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "edge_id",
            sa.UUID(),
            sa.ForeignKey("causal_edge.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "evidence_type",
            sa.String(50),
            nullable=False,
            comment="supporting or contradicting",
        ),
        sa.Column("source_url", sa.String(2048), nullable=False),
        sa.Column("source_title", sa.String(500), nullable=False),
        sa.Column(
            "source_type",
            sa.String(50),
            nullable=False,
            comment="academic, news, blog, forum, or other",
        ),
        sa.Column("snippet", sa.Text(), nullable=False),
        sa.Column("relevance_score", sa.Float(), nullable=False),
        sa.Column("credibility_score", sa.Float(), nullable=False),
    )

    # Create scenario table
    op.create_table(
        "scenario",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "project_id",
            sa.UUID(),
            sa.ForeignKey("project.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_scenario_id",
            sa.UUID(),
            sa.ForeignKey("scenario.id"),
            nullable=True,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("edge_overrides", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("injected_events", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("narrative", sa.Text(), nullable=True),
        sa.Column("key_insights", sa.JSON(), nullable=True),
        sa.Column("conclusion", sa.Text(), nullable=True),
        sa.Column("edge_change_reasons", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("scenario")
    op.drop_table("evidence")
    op.drop_table("causal_edge")
    op.drop_table("claim")
    op.drop_table("project")
    op.execute("DROP EXTENSION IF EXISTS vector")
