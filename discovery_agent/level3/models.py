from __future__ import annotations
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class ApiProfile(BaseModel):
    """Auth and endpoint profile for one side of an integration (source or destination)."""
    system_name: str
    api_base_url: str
    auth_type: Literal["bearer", "api_key", "oauth2_client_credentials", "basic"]
    auth_header_name: str = "Authorization"
    auth_header_prefix: str = "Bearer "
    auth_notes: str = ""
    list_endpoint: str = ""
    list_response_key: str = ""
    create_endpoint: str = ""
    pagination_style: Literal["cursor", "offset", "page", "none", "link_header"] = "offset"
    pagination_cursor_field: str = "next_cursor"
    rate_limit_header: str = "Retry-After"
    # Field names whose values the LLM inferred rather than verified from documentation.
    # Rendered in the README "Verify before deploying" section.
    inferred_fields: List[str] = Field(default_factory=list)


class ConnectorSpec(BaseModel):
    """LLM-extracted API details for a two-sided source→destination integration."""
    source_system: str
    destination_system: str
    # Separate profiles for each side — avoids single-model bias toward the destination.
    source: ApiProfile
    destination: ApiProfile
    entity_name: str
    # mock_list_response represents the SOURCE system's list response (1-2 sample records).
    mock_list_response: Dict[str, Any]
    retry_status_codes: List[int] = Field(default_factory=lambda: [429, 503])


class AgentDefSpec(BaseModel):
    """LLM-generated content for the agent YAML definition."""
    system_prompt: str
    tools: List[str]
    workflow: List[str]
    test_scenarios: List[str]


class ValidationReport(BaseModel):
    connector_compiles: bool = False
    connector_imports: bool = False
    agent_def_valid: bool = False
    tests_pass: bool = False
    failures: List[str] = Field(default_factory=list)

    @property
    def valid(self) -> bool:
        return (
            self.connector_compiles
            and self.connector_imports
            and self.agent_def_valid
            and self.tests_pass
        )


class GeneratedBundle(BaseModel):
    gap_key: str
    source_system: str
    destination_system: str
    connector_code: str
    agent_def_yaml: str
    test_code: str
    readme: str
    requirements: str
    validation: ValidationReport
    artifacts_dir: Optional[str] = None
    # Paradigm classification — set by pipeline.classify_gap() before generation.
    # When manual_setup_required=True, no connector code is generated and the
    # validation gate is not run; paradigm_notes explains why.
    paradigm: str = "rest_api"
    manual_setup_required: bool = False
    paradigm_notes: str = ""

    def model_dump(self, **kwargs) -> Dict[str, Any]:
        d = super().model_dump(**kwargs)
        d["validation"]["valid"] = self.validation.valid
        return d
