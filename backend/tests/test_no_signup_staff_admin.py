# Matbakh: self-signup removed; admin-created accounts; branch-manager scoping; email login; logout
import json
import os
import subprocess
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

OWNER = ("admin", "Admin-4b926aed-5bd39f")
TEMP_PW = "TempQaPass-123456"
NEW_PW = "ChangedQaPass-987654"
STATE = {}


def mutate(s, proc, payload):
    return s.post(f"{BASE_URL}/api/trpc/{proc}?batch=1", json={"0": {"json": payload}}, timeout=30)


def query(s, proc, payload=None):
    inp = {"0": {"json": payload}} if payload is not None else {"0": {"json": None, "meta": {"values": ["undefined"]}}}
    return s.get(f"{BASE_URL}/api/trpc/{proc}", params={"batch": "1", "input": json.dumps(inp)}, timeout=30)


def data(r):
    return r.json()[0]["result"]["data"]["json"]


def err(r):
    return r.json()[0]["error"]["json"]


def login(user, pw):
    s = requests.Session()
    return s, mutate(s, "auth.login", {"username": user, "password": pw})


def cleanup():
    subprocess.run(["mariadb", "-S", "/app/.mysql-run/mysqld.sock", "-uroot", "matbakh", "-e",
                    "DELETE FROM staff_sessions WHERE user_id IN (SELECT id FROM staff_users WHERE username LIKE 'test_%qa%'); "
                    "DELETE FROM staff_users WHERE username LIKE 'test_%qa%'"], check=False)


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    cleanup()
    yield
    cleanup()


@pytest.fixture(scope="module")
def owner():
    s, r = login(*OWNER)
    if r.status_code != 200:
        pytest.skip(f"owner login failed {r.text[:200]}")
    return s


# Owner admin login
def test_owner_login(owner):
    me = data(query(owner, "auth.me"))
    assert me["username"] == "admin" and me["role"] == "system_admin"
    assert len(data(query(owner, "branches.list"))) == 5


# Removed signup procedures -> NOT_FOUND
@pytest.mark.parametrize("proc,kind", [("auth.signup", "m"), ("staff.pendingSignups", "q"),
                                       ("staff.approveSignup", "m"), ("staff.rejectSignup", "m")])
def test_removed_procedures(owner, proc, kind):
    for s in (requests.Session(), owner):
        r = mutate(s, proc, {"id": 1}) if kind == "m" else query(s, proc)
        assert err(r)["data"]["code"] == "NOT_FOUND", r.text[:300]


# Admin creates station account in branch 1 → login → forced change
def test_admin_create_station_and_login(owner):
    r = mutate(owner, "staff.create", {"username": "test_station_qa", "displayName": "TEST Station QA",
                                        "password": TEMP_PW, "role": "station", "branchId": 1})
    assert r.status_code == 200, r.text
    u = data(r)
    assert u["role"] == "station" and u["branchId"] == 1 and u["mustChangePassword"] is True
    assert "passwordHash" not in u
    STATE["station_id"] = u["id"]
    lst = data(query(owner, "staff.list", {"scope": "branch", "branchId": 1}))["users"]
    assert any(x["username"] == "test_station_qa" for x in lst)
    s, r = login("test_station_qa", TEMP_PW)
    assert r.status_code == 200, r.text
    assert data(r)["user"]["mustChangePassword"] is True
    r = mutate(s, "auth.changePassword", {"currentPassword": TEMP_PW, "newPassword": NEW_PW})
    assert r.status_code == 200, r.text
    assert data(r)["mustChangePassword"] is False
    s2, r = login("test_station_qa", NEW_PW)
    assert r.status_code == 200


def test_admin_deactivate_station(owner):
    r = mutate(owner, "staff.update", {"id": STATE["station_id"], "isActive": False})
    assert r.status_code == 200, r.text
    s, r = login("test_station_qa", NEW_PW)
    assert err(r)["data"]["code"] == "UNAUTHORIZED"


def test_duplicate_username_conflict(owner):
    r = mutate(owner, "staff.create", {"username": "test_station_qa", "displayName": "dup",
                                        "password": TEMP_PW, "role": "station", "branchId": 1})
    assert err(r)["data"]["code"] == "CONFLICT"


# Branch manager scope
def test_branch_manager_scope(owner):
    r = mutate(owner, "staff.create", {"username": "test_bm_qa", "displayName": "TEST BM QA",
                                        "password": TEMP_PW, "role": "branch_manager", "branchId": 1})
    assert r.status_code == 200, r.text
    s, r = login("test_bm_qa", TEMP_PW)
    assert r.status_code == 200
    r = mutate(s, "auth.changePassword", {"currentPassword": TEMP_PW, "newPassword": NEW_PW})
    assert r.status_code == 200, r.text
    s, r = login("test_bm_qa", NEW_PW)
    STATE["bm"] = s
    assert [b["id"] for b in data(query(s, "branches.list"))] == [1]
    assert err(query(s, "staff.list", {"scope": "branch", "branchId": 2}))["data"]["code"] == "FORBIDDEN"
    # create station in own branch OK
    r = mutate(s, "staff.create", {"username": "test_bmstation_qa", "displayName": "TEST BM Station",
                                    "password": TEMP_PW, "role": "station", "branchId": 1})
    assert r.status_code == 200, r.text
    sid = data(r)["id"]
    # other branch forbidden
    r = mutate(s, "staff.create", {"username": "test_bmother_qa", "displayName": "x",
                                    "password": TEMP_PW, "role": "station", "branchId": 2})
    assert err(r)["data"]["code"] == "FORBIDDEN"
    # privileged roles forbidden
    for role, br in [("branch_manager", 1), ("system_admin", None)]:
        r = mutate(s, "staff.create", {"username": "test_bmpriv_qa", "displayName": "x",
                                        "password": TEMP_PW, "role": role, "branchId": br})
        assert err(r)["data"]["code"] == "FORBIDDEN", (role, r.text[:200])
    # move own-branch station to other branch forbidden
    r = mutate(s, "staff.update", {"id": sid, "branchId": 2})
    assert err(r)["data"]["code"] == "FORBIDDEN"
    # list in own branch only shows branch 1 accounts
    users = data(query(s, "staff.list", {"scope": "branch", "branchId": 1}))["users"]
    assert all(u.get("branchId") in (1, None) for u in users)


def test_branch_manager_cannot_touch_other_branch_account(owner):
    lst = data(query(owner, "staff.list", {"scope": "branch", "branchId": 2}))["users"]
    if not lst:
        pytest.skip("no branch 2 accounts")
    r = mutate(STATE["bm"], "staff.update", {"id": lst[0]["id"], "displayName": lst[0]["displayName"]})
    assert "error" in r.json()[0], r.text[:200]


# Email login on owner + removal
def test_email_login_and_removal(owner):
    email = "test.owner.qa@example.com"
    r = mutate(owner, "auth.setEmail", {"email": email, "currentPassword": OWNER[1]})
    assert r.status_code == 200, r.text
    try:
        s, r = login(email, OWNER[1])
        assert r.status_code == 200 and data(r)["user"]["username"] == "admin"
    finally:
        r = mutate(owner, "auth.setEmail", {"email": None, "currentPassword": OWNER[1]})
        assert data(r)["email"] is None
    s, r = login(email, OWNER[1])
    assert err(r)["data"]["code"] == "UNAUTHORIZED"


def test_logout():
    s, r = login(*OWNER)
    assert r.status_code == 200
    assert mutate(s, "auth.logout", None).status_code == 200
    assert data(query(s, "auth.me")) is None
# Manus leftovers
def test_no_manus_routes():
    for path in ["/api/oauth/callback", "/api/platform/config.js"]:
        r = requests.get(BASE_URL + path, timeout=20, allow_redirects=False)
        assert "oauth" not in r.headers.get("content-type", "").lower()
        assert r.status_code in (404, 200, 302)
        if r.status_code == 200:
            assert "<html" in r.text.lower() or "<!doctype" in r.text.lower(), r.text[:200]
    html = requests.get(BASE_URL + "/", timeout=20).text
    assert "platform/config.js" not in html
    assert "manus" not in html.lower()
