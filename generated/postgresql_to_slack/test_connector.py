"""
Tests for PostgresqlToSlackConnector.
All HTTP calls are mocked via the `responses` library — no real API calls made.
"""
import pytest
import responses as resp_lib
from requests.exceptions import HTTPError

from connector import PostgresqlToSlackConnector

BASE_URL = "https://api.postgresql.local/v1"
_LIST_URL = BASE_URL.rstrip("/") + "/" + "public.shipments".lstrip("/")
_CREATE_URL = BASE_URL.rstrip("/") + "/" + "/shipments".lstrip("/")

MOCK_LIST_RESPONSE = {'rows': [{'id': 123, 'tracking_number': 'ABC123', 'status': 'shipped'}, {'id': 456, 'tracking_number': 'DEF456', 'status': 'delivered'}]}
_LIST_KEY = "rows"

# Terminal response: only the records array, no pagination-continuation fields.
# Prevents the cursor/offset pagination loop from running forever in tests.
_TERMINAL_LIST_RESPONSE = {_LIST_KEY: MOCK_LIST_RESPONSE.get(_LIST_KEY, [])}


def _make_client() -> PostgresqlToSlackConnector:
    return PostgresqlToSlackConnector(api_token="test-token")


@resp_lib.activate
def test_list_records_returns_items():
    resp_lib.add(resp_lib.GET, _LIST_URL, json=_TERMINAL_LIST_RESPONSE, status=200)
    client = _make_client()
    result = client.list_records()
    assert isinstance(result, list)
    assert result == _TERMINAL_LIST_RESPONSE.get(_LIST_KEY, [])


@resp_lib.activate
def test_create_record_sends_payload():
    payload = {"name": "test-record"}
    created = {"id": "new-id", **payload}
    resp_lib.add(resp_lib.POST, _CREATE_URL, json=created, status=201)
    client = _make_client()
    result = client.create_record(payload)
    assert result.get("id") == "new-id"
    assert len(resp_lib.calls) == 1
    assert resp_lib.calls[0].request.method == "POST"


@resp_lib.activate
def test_raises_on_server_error():
    resp_lib.add(resp_lib.GET, _LIST_URL, json={"error": "not found"}, status=404)
    client = _make_client()
    with pytest.raises(HTTPError):
        client.list_records()


@resp_lib.activate
def test_retries_on_429():
    resp_lib.add(
        resp_lib.GET, _LIST_URL,
        status=429,
        headers={"Retry-After": "0"},
    )
    resp_lib.add(resp_lib.GET, _LIST_URL, json=_TERMINAL_LIST_RESPONSE, status=200)
    client = _make_client()
    result = client.list_records()
    assert isinstance(result, list)
    assert len(resp_lib.calls) == 2, (
        f"Expected 2 calls (1 retry), got {len(resp_lib.calls)} — retry logic may be missing"
    )
