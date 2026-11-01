"""Thin reverse proxy: forwards /api/* to the original Matbakh Node (Express/tRPC) server."""
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from starlette.background import BackgroundTask
from starlette.responses import FileResponse, JSONResponse, StreamingResponse

load_dotenv(Path(__file__).parent / '.env')

UPSTREAM = os.environ['MATBAKH_UPSTREAM_URL']
HOP_HEADERS = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade",
               "proxy-authorization", "proxy-authenticate", "host", "content-length"}

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
client = httpx.AsyncClient(base_url=UPSTREAM, timeout=httpx.Timeout(120.0, connect=10.0))


DOWNLOADS = Path("/app/downloads")


@app.get("/api/dl/{name}")
async def download(name: str):
    # Unguessable one-off file names only; no directory traversal.
    target = DOWNLOADS / name
    if "/" in name or "--" not in name or len(name) < 40 or not target.is_file():
        return JSONResponse({"error": "not_found"}, status_code=404)
    base, rest = name.split("--", 1)
    return FileResponse(target, filename=base + rest[rest.find("."):])


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy(path: str, request: Request):
    headers = [(k, v) for k, v in request.headers.items() if k.lower() not in HOP_HEADERS]
    headers.append(("x-forwarded-host", request.headers.get("host", "")))
    headers.append(("x-forwarded-proto", request.headers.get("x-forwarded-proto", "https")))
    if request.client:
        prior = request.headers.get("x-forwarded-for")
        headers = [(k, v) for k, v in headers if k.lower() != "x-forwarded-for"]
        headers.append(("x-forwarded-for", f"{prior}, {request.client.host}" if prior else request.client.host))
    upstream_req = client.build_request(
        request.method, f"/api/{path}", params=request.query_params.multi_items(),
        headers=headers, content=await request.body(),
    )
    resp = await client.send(upstream_req, stream=True)
    out_headers = [(k, v) for k, v in resp.headers.multi_items() if k.lower() not in HOP_HEADERS]
    response = StreamingResponse(resp.aiter_raw(), status_code=resp.status_code,
                                 background=BackgroundTask(resp.aclose))
    response.raw_headers = [(k.encode("latin-1"), v.encode("latin-1")) for k, v in out_headers]
    return response


@app.on_event("shutdown")
async def shutdown():
    await client.aclose()
