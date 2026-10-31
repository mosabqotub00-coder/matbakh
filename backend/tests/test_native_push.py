# Matbakh nativePush tRPC router + auth regression tests
import json
import os
import secrets
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
USER, PWD = "qa_admin", "QaTest-36fb49a9"


def trpc_post(s, proc, payload):
    return s.post(f"{BASE_URL}/api/trpc/{proc}?batch=1", json={"0": {"json": payload}}, timeout=60)


def trpc_get(s, proc, payload):
    return s.get(f"{BASE_URL}/api/trpc/{proc}", params={"input": json.dumps({"json": payload})}, timeout=30)


def new_iid():
    return "mbx_" + secrets.token_hex(20)


@pytest.fixture(scope="module")
def auth():
    s = requests.Session()
    r = trpc_post(s, "auth.login", {"username": USER, "password": PWD})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    yield s
    trpc_post(s, "auth.logout", {})


# Auth
def test_login_and_me(auth):
    r = auth.get(f"{BASE_URL}/api/trpc/auth.me", timeout=30)
    assert r.status_code == 200
    assert r.json()["result"]["data"]["json"]["username"] == USER


# nativePush register/status/unregister
def test_register_status_unregister(auth):
    iid = new_iid()
    r = trpc_post(auth, "nativePush.register", {"installationId": iid, "expoPushToken": f"ExponentPushToken[TEST{secrets.token_hex(6)}]", "platform": "android", "appVersion": "1.0.0"})
    assert r.status_code == 200, r.text
    assert r.json()[0]["result"]["data"]["json"] == {"registered": True}
    r = trpc_get(auth, "nativePush.status", {"installationId": iid})
    assert r.status_code == 200, r.text
    assert r.json()["result"]["data"]["json"]["registered"] is True
    anon = requests.Session()
    r = trpc_post(anon, "nativePush.unregister", {"installationId": iid})
    assert r.status_code == 200, r.text
    assert r.json()[0]["result"]["data"]["json"] == {"registered": False}
    r = trpc_get(auth, "nativePush.status", {"installationId": iid})
    assert r.json()["result"]["data"]["json"]["registered"] is False


def test_register_unauthenticated():
    r = trpc_post(requests.Session(), "nativePush.register", {"installationId": new_iid(), "expoPushToken": "ExponentPushToken[abc]", "platform": "android"})
    assert r.status_code == 401, r.text
    assert "UNAUTHORIZED" in r.text


@pytest.mark.parametrize("payload", [
    {"installationId": "bad_id", "expoPushToken": "ExponentPushToken[abc]", "platform": "android"},
    {"installationId": "mbx_" + "a" * 40, "expoPushToken": "notatoken", "platform": "android"},
    {"installationId": "mbx_" + "a" * 40, "expoPushToken": "ExponentPushToken[abc]", "platform": "ios"},
])
def test_register_invalid(auth, payload):
    r = trpc_post(auth, "nativePush.register", payload)
    assert r.status_code == 400, r.text
    assert "BAD_REQUEST" in r.text


def test_status_unauth():
    r = trpc_get(requests.Session(), "nativePush.status", {"installationId": new_iid()})
    assert r.status_code == 401


def test_test_with_fake_token_removes_device(auth):
    iid = new_iid()
    r = trpc_post(auth, "nativePush.register", {"installationId": iid, "expoPushToken": f"ExponentPushToken[FAKE{secrets.token_hex(8)}]", "platform": "android"})
    assert r.status_code == 200
    r = trpc_post(auth, "nativePush.test", {"installationId": iid})
    assert r.status_code == 200, r.text
    assert r.json()[0]["result"]["data"]["json"]["success"] is False
    r = trpc_get(auth, "nativePush.status", {"installationId": iid})
    print("status after test:", r.text)
    assert r.json()["result"]["data"]["json"]["registered"] is False, "device not removed (DeviceNotRegistered not returned?)"


def test_test_unregistered_device_404(auth):
    r = trpc_post(auth, "nativePush.test", {"installationId": new_iid()})
    assert r.status_code == 404


def test_acknowledge(auth):
    r = trpc_post(auth, "nativePush.acknowledge", {"installationId": new_iid(), "deliveryId": "1", "state": "received"})
    assert r.status_code == 200
    assert r.json()[0]["result"]["data"]["json"]["success"] is False


# Exact token from review request
def test_register_abc123_token(auth):
    iid = new_iid()
    r = trpc_post(auth, "nativePush.register", {"installationId": iid, "expoPushToken": "ExponentPushToken[abc123]", "platform": "android"})
    assert r.status_code == 200, r.text
    assert r.json()[0]["result"]["data"]["json"]["registered"] is True
    r = trpc_get(auth, "nativePush.status", {"installationId": iid})
    assert r.json()["result"]["data"]["json"]["registered"] is True
    r = trpc_post(requests.Session(), "nativePush.unregister", {"installationId": iid})
    assert r.status_code == 200


def test_unregister_invalid_id():
    r = trpc_post(requests.Session(), "nativePush.unregister", {"installationId": "mbx_XYZ"})
    assert r.status_code == 400
