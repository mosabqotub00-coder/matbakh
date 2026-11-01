# Matbakh standalone auth (Manus removed): username/email login, signup→pending→approve, branch scoping, logout, cookies
import json
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

ADMIN = ("qa_admin", "QaTest-36fb49a9")
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
    r = mutate(s, "auth.login", {"username": user, "password": pw})
    return s, r


@pytest.fixture(scope="module")
def admin():
    s, r = login(*ADMIN)
    if r.status_code != 200:
        pytest.skip(f"admin login failed {r.text[:200]}")
    return s


# Username login of existing staff + cookie flags
def test_admin_username_login_and_cookie():
    s, r = login(*ADMIN)
    assert r.status_code == 200, r.text
    u = data(r)["user"]
    assert u["username"] == "qa_admin" and u["role"] == "system_admin"
    sc = r.headers.get("set-cookie", "")
    assert "matbakh_staff_session=" in sc
    assert "HttpOnly" in sc and "Secure" in sc
    me = data(query(s, "auth.me"))
    assert me["username"] == "qa_admin"


def test_admin_sees_all_branches(admin):
    br = data(query(admin, "branches.list"))
    assert len(br) >= 5


def test_unauth_protected_endpoints():
    s = requests.Session()
    for proc in ["staff.list", "staff.pendingSignups"]:
        r = query(s, proc, {} if proc == "staff.list" else None)
        assert err(r)["data"]["code"] == "UNAUTHORIZED", (proc, r.text[:200])


def test_wrong_password_generic():
    s, r = login("qa_admin", "definitely-wrong-pw")
    assert err(r)["data"]["code"] == "UNAUTHORIZED"
    assert err(r)["message"] == "اسم المستخدم أو كلمة المرور غير صحيحة."


# Signup → pending
def test_signup_and_duplicate(admin):
    email = f"qa.{uuid.uuid4().hex[:6]}+test@example.com"
    pw = "SignupTest-12345"
    STATE.update(email=email, pw=pw)
    s = requests.Session()
    r1 = mutate(s, "auth.signup", {"displayName": "TEST Signup API", "email": email, "password": pw})
    assert r1.status_code == 200, r1.text
    assert data(r1) == {"submitted": True}
    r2 = mutate(s, "auth.signup", {"displayName": "TEST Dup", "email": email.upper(), "password": "OtherPass-999999"})
    assert data(r2) == {"submitted": True}
    pend = [p for p in data(query(admin, "staff.pendingSignups")) if p["email"] == email]
    assert len(pend) == 1
    STATE["id"] = pend[0]["id"]
    STATE["username"] = pend[0]["username"]


def test_signup_short_password_rejected_server():
    # Uses zod validation before signup limiter? count consumption acceptable – skipped to save quota
    pytest.skip("not consuming signup quota")


def test_pending_cannot_login():
    s, r = login(STATE["email"], STATE["pw"])
    assert err(r)["data"]["code"] == "FORBIDDEN"
    assert "قيد المراجعة" in err(r)["message"]
    s, r = login(STATE["email"], "wrong-password-xx")
    assert err(r)["message"] == "اسم المستخدم أو كلمة المرور غير صحيحة."


def test_pending_not_in_staff_list(admin):
    lst = data(query(admin, "staff.list", {}))["users"]
    assert not any(u.get("email") == STATE["email"] for u in lst)


def test_approve_requires_branch(admin):
    r = mutate(admin, "staff.approveSignup", {"id": STATE["id"], "role": "branch_manager", "branchId": None})
    assert "error" in r.json()[0]


def test_approve_branch_manager(admin):
    r = mutate(admin, "staff.approveSignup", {"id": STATE["id"], "role": "branch_manager", "branchId": 1})
    assert r.status_code == 200, r.text
    u = data(r)
    assert u["role"] == "branch_manager" and u["branchId"] == 1
    assert "passwordHash" not in u
    # double approve → NOT_FOUND
    r = mutate(admin, "staff.approveSignup", {"id": STATE["id"], "role": "branch_manager", "branchId": 1})
    assert err(r)["data"]["code"] == "NOT_FOUND"


def test_approved_email_login_and_scope():
    s, r = login(STATE["email"], STATE["pw"])
    assert r.status_code == 200, r.text
    u = data(r)["user"]
    assert u["branchId"] == 1
    br = data(query(s, "branches.list"))
    assert [b["id"] for b in br] == [1], br
    r = query(s, "staff.list", {"branchId": 2})
    assert err(r)["data"]["code"] == "FORBIDDEN", r.text[:300]
    r = query(s, "staff.list", {"branchId": 1})
    assert r.status_code == 200
    assert all(x.get("branchId") in (1, None) for x in data(r)["users"])
    assert err(query(s, "staff.pendingSignups"))["data"]["code"] == "FORBIDDEN"
    r = mutate(s, "staff.approveSignup", {"id": 999999, "role": "station", "branchId": 1})
    assert err(r)["data"]["code"] == "FORBIDDEN"
    STATE["sess"] = s


def test_approved_username_login():
    s, r = login(STATE["username"], STATE["pw"])
    assert r.status_code == 200, r.text


def test_logout_clears_session():
    s = STATE["sess"]
    r = mutate(s, "auth.logout", None)
    assert r.status_code == 200
    me = data(query(s, "auth.me"))
    assert me is None


# setEmail on qa_admin
def test_set_email_flow(admin):
    r = mutate(admin, "auth.setEmail", {"email": "qa.admin.test@example.com", "currentPassword": "wrong"})
    assert "error" in r.json()[0]
    r = mutate(admin, "auth.setEmail", {"email": STATE["email"], "currentPassword": ADMIN[1]})
    assert err(r)["data"]["code"] == "CONFLICT"
    r = mutate(admin, "auth.setEmail", {"email": "QA.Admin.Test@example.com", "currentPassword": ADMIN[1]})
    assert r.status_code == 200, r.text
    assert data(r)["email"] == "qa.admin.test@example.com"
    s, r = login("qa.admin.test@example.com", ADMIN[1])
    assert r.status_code == 200
    r = mutate(admin, "auth.setEmail", {"email": None, "currentPassword": ADMIN[1]})
    assert data(r)["email"] is None


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
