"""
Tests for SalesforceToZendeskConnector.
All HTTP calls are mocked via the `responses` library — no real API calls made.

IMPORTANT: env vars are set BEFORE importing connector so SRC_BASE_URL / DST_BASE_URL
pick up the test values at module load time.  This prevents the URL mismatch where
connector and test would otherwise build mock URLs from different sources.
"""
import os

_SRC_ENV_PREFIX = "SALESFORCE"
_DST_ENV_PREFIX = "ZENDESK"
os.environ[_SRC_ENV_PREFIX + "_BASE_URL"] = "https://test-src.example.local"
os.environ[_DST_ENV_PREFIX + "_BASE_URL"] = "https://test-dst.example.local"

import pytest
import responses as resp_lib
from requests.exceptions import HTTPError

from connector import (
    SalesforceToZendeskConnector,
    SourceClient,
    DestinationClient,
    SRC_BASE_URL,
    SRC_LIST_ENDPOINT,
    DST_BASE_URL,
    DST_CREATE_ENDPOINT,
)

# Build mock URLs from the imported constants — they agree with what the connector
# uses at runtime because they are the SAME objects, not a re-derived copy.
_SRC_LIST_URL = SRC_BASE_URL.rstrip("/") + "/" + SRC_LIST_ENDPOINT.lstrip("/")
_DST_CREATE_URL = DST_BASE_URL.rstrip("/") + "/" + DST_CREATE_ENDPOINT.lstrip("/")

MOCK_LIST_RESPONSE = {'records': [{'Id': '001d300000000abc', 'Name': 'Sample Partner Deal'}, {'Id': '001d300000000def', 'Name': 'Another Partner Deal'}]}
_LIST_KEY = "records"
_MOCK_RECORDS = MOCK_LIST_RESPONSE.get(_LIST_KEY, [])
# Non-empty key: connector reads records via data.get("records", [])
_TERMINAL_LIST_RESPONSE = {_LIST_KEY: _MOCK_RECORDS}


def _make_source() -> SourceClient:
    return SourceClient(api_token="test-src-token")


def _make_destination() -> DestinationClient:
    return DestinationClient(api_token="test-dst-token")


def _make_connector() -> SalesforceToZendeskConnector:
    return SalesforceToZendeskConnector(src_token="test-src-token", dst_token="test-dst-token")


@resp_lib.activate
def test_list_partner_deals_returns_items():
    resp_lib.add(resp_lib.GET, _SRC_LIST_URL, json=_TERMINAL_LIST_RESPONSE, status=200)
    client = _make_source()
    result = client.list_partner_deals()
    assert isinstance(result, list)
    assert result == _MOCK_RECORDS


@resp_lib.activate
def test_create_partner_deal_sends_payload():
    payload = {"name": "test-partner_deal"}
    created = {"id": "new-id", **payload}
    resp_lib.add(resp_lib.POST, _DST_CREATE_URL, json=created, status=201)
    client = _make_destination()
    result = client.create_partner_deal(payload)
    assert result.get("id") == "new-id"
    assert len(resp_lib.calls) == 1
    assert resp_lib.calls[0].request.method == "POST"


@resp_lib.activate
def test_raises_on_server_error():
    resp_lib.add(resp_lib.GET, _SRC_LIST_URL, json={"error": "not found"}, status=404)
    client = _make_source()
    with pytest.raises(HTTPError):
        client.list_partner_deals()


@resp_lib.activate
def test_delete_partner_deal_sends_request():
    record_id = "test-id"
    del_url = _DST_CREATE_URL.rstrip("/") + "/" + record_id
    resp_lib.add(resp_lib.DELETE, del_url, status=204)
    client = _make_destination()
    client.delete_partner_deal(record_id)
    assert len(resp_lib.calls) == 1
    assert resp_lib.calls[0].request.method == "DELETE"


@resp_lib.activate
def test_retries_on_429():
    resp_lib.add(
        resp_lib.GET, _SRC_LIST_URL,
        status=429,
        headers={"Retry-After": "0"},
    )
    resp_lib.add(resp_lib.GET, _SRC_LIST_URL, json=_TERMINAL_LIST_RESPONSE, status=200)
    client = _make_source()
    result = client.list_partner_deals()
    assert isinstance(result, list)
    assert len(resp_lib.calls) == 2, (
        f"Expected 2 calls (1 retry), got {len(resp_lib.calls)} — retry logic may be missing"
    )


@resp_lib.activate
def test_sync_reads_source_and_writes_destination():
    resp_lib.add(resp_lib.GET, _SRC_LIST_URL, json=_TERMINAL_LIST_RESPONSE, status=200)
    for _ in _MOCK_RECORDS:
        resp_lib.add(resp_lib.POST, _DST_CREATE_URL, json={"id": "new-id"}, status=201)
    connector = _make_connector()
    count = connector.sync_partner_deals()
    assert count == len(_MOCK_RECORDS)
