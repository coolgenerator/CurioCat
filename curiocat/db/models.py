import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, Boolean, func, Column
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "project"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(500))
    input_text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(), nullable=True
    )
    has_temporal: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )

    # Relationships
    claims: Mapped[list["Claim"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    edges: Mapped[list["CausalEdge"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    scenarios: Mapped[list["Scenario"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Claim(Base):
    __tablename__ = "claim"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("project.id", ondelete="CASCADE")
    )
    text: Mapped[str] = mapped_column(Text)
    claim_type: Mapped[str] = mapped_column(
        String(50), comment="FACT, ASSUMPTION, PREDICTION, or OPINION"
    )
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    embedding = mapped_column(Vector(1536), nullable=True)
    metadata_: Mapped[dict | None] = mapped_column(
        "metadata", JSON, nullable=True
    )
    source_sentence: Mapped[str | None] = mapped_column(Text, nullable=True)
    logic_gate: Mapped[str] = mapped_column(String(10), default="or")
    order_index: Mapped[int] = mapped_column(Integer)
    layer: Mapped[int] = mapped_column(Integer, default=0)

    # Relationships
    project: Mapped["Project"] = relationship(back_populates="claims")


class CausalEdge(Base):
    __tablename__ = "causal_edge"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("project.id", ondelete="CASCADE")
    )
    source_claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("claim.id", ondelete="CASCADE")
    )
    target_claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("claim.id", ondelete="CASCADE")
    )
    mechanism: Mapped[str] = mapped_column(Text)
    strength: Mapped[float] = mapped_column(Float, comment="0.0 to 1.0")
    time_delay: Mapped[str | None] = mapped_column(String(100), nullable=True)
    conditions: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reversible: Mapped[bool] = mapped_column(Boolean, default=False)
    evidence_score: Mapped[float] = mapped_column(Float, default=0.5)
    causal_type: Mapped[str] = mapped_column(String(50), default="direct")
    condition_type: Mapped[str] = mapped_column(String(50), default="contributing")
    temporal_window: Mapped[str | None] = mapped_column(String(100), nullable=True)
    decay_type: Mapped[str] = mapped_column(String(50), default="none")
    bias_warnings = mapped_column(JSON, nullable=True)

    # Relationships
    project: Mapped["Project"] = relationship(back_populates="edges")
    source_claim: Mapped["Claim"] = relationship(foreign_keys=[source_claim_id])
    target_claim: Mapped["Claim"] = relationship(foreign_keys=[target_claim_id])
    evidences: Mapped[list["Evidence"]] = relationship(
        back_populates="edge", cascade="all, delete-orphan"
    )


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    edge_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("causal_edge.id", ondelete="CASCADE")
    )
    evidence_type: Mapped[str] = mapped_column(
        String(50), comment="supporting or contradicting"
    )
    source_url: Mapped[str] = mapped_column(String(2048))
    source_title: Mapped[str] = mapped_column(String(500))
    source_type: Mapped[str] = mapped_column(
        String(50), comment="academic, news, blog, forum, or other"
    )
    snippet: Mapped[str] = mapped_column(Text)
    relevance_score: Mapped[float] = mapped_column(Float)
    credibility_score: Mapped[float] = mapped_column(Float)
    source_tier: Mapped[int] = mapped_column(Integer, default=4)
    published_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    freshness_score: Mapped[float] = mapped_column(Float, default=0.5)

    # Relationships
    edge: Mapped["CausalEdge"] = relationship(back_populates="evidences")


class Scenario(Base):
    __tablename__ = "scenario"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("project.id", ondelete="CASCADE")
    )
    parent_scenario_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scenario.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    edge_overrides: Mapped[dict] = mapped_column(JSON, default=dict)
    injected_events: Mapped[list] = mapped_column(JSON, default=list)
    narrative: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_insights: Mapped[list | None] = mapped_column(JSON, nullable=True)
    conclusion: Mapped[str | None] = mapped_column(Text, nullable=True)
    edge_change_reasons: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    project: Mapped["Project"] = relationship(back_populates="scenarios")
    parent: Mapped["Scenario | None"] = relationship(
        remote_side=[id], foreign_keys=[parent_scenario_id]
    )
