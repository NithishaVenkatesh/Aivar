from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# LLM output — single call per use case
# ---------------------------------------------------------------------------

class DataFlow(BaseModel):
    source: str
    destination: str
    entity: str    # e.g. "Lead", "Invoice", "Employee"
    trigger: str   # e.g. "on new record", "nightly batch", "webhook"


class RawUseCaseAnalysis(BaseModel):
    """What the LLM returns for one use case — systems + flows in one shot."""
    systems: List[str] = Field(default_factory=list)
    flows: List[DataFlow] = Field(default_factory=list)
    frequency: str   # real-time / daily / weekly / monthly / ad-hoc
    criticality: str  # high / medium / low

    @model_validator(mode="after")
    def flows_only_reference_listed_systems(self) -> "RawUseCaseAnalysis":
        valid = {s.lower() for s in self.systems}
        for f in self.flows:
            if f.source.lower() not in valid:
                raise ValueError(
                    f"Flow source '{f.source}' is not in the systems list {self.systems}"
                )
            if f.destination.lower() not in valid:
                raise ValueError(
                    f"Flow destination '{f.destination}' is not in the systems list {self.systems}"
                )
        return self


# ---------------------------------------------------------------------------
# Validated use case (after system cross-check against Level 1 inventory)
# ---------------------------------------------------------------------------

class UseCaseResult(BaseModel):
    text: str
    involved_systems: List[str]          # canonical names confirmed in Level 1
    flows: List[DataFlow]                # only flows between confirmed systems
    frequency: str
    criticality: str
    rejected_systems: List[str] = Field(default_factory=list)   # LLM named, not in inventory
    missing_capabilities: List[str] = Field(default_factory=list)  # generic needs not in inventory


# ---------------------------------------------------------------------------
# Gap
# ---------------------------------------------------------------------------

class Gap(BaseModel):
    source_system: str
    destination_system: str
    entities: List[str]          # all entity types flowing through this integration
    triggers: List[str]          # all triggers across use cases
    status: str                  # available / missing — pure Level 1 EXISTS lookup
    effort: Optional[str] = None          # S / M / L / XL (missing only)
    effort_rationale: Optional[str] = None
    use_cases_blocked: List[str] = Field(default_factory=list)
    priority_score: float = 0.0


# ---------------------------------------------------------------------------
# Dependency graph
# ---------------------------------------------------------------------------

class DependencyLink(BaseModel):
    integration: str             # "SystemA → SystemB"
    required_before: List[str]   # use case texts that need this integration


# ---------------------------------------------------------------------------
# Skipped items — everything the agent couldn't handle
# ---------------------------------------------------------------------------

class SkippedItem(BaseModel):
    text: str
    reason: str


class RejectedSystem(BaseModel):
    use_case: str
    system: str
    reason: str


class MissingCapability(BaseModel):
    use_case: str
    capability_needed: str


class Skipped(BaseModel):
    unmapped_use_cases: List[SkippedItem] = Field(default_factory=list)
    rejected_systems: List[RejectedSystem] = Field(default_factory=list)
    missing_capabilities: List[MissingCapability] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Final Level 2 output
# ---------------------------------------------------------------------------

class GapReport(BaseModel):
    use_cases_analyzed: int
    total_gaps: int
    missing_integrations: int
    gaps: List[Gap]
    dependency_graph: List[DependencyLink]
    skipped: Skipped
