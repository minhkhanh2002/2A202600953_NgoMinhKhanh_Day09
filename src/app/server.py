import json
from pathlib import Path
from typing import Any, Dict
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel

from app.graph import ShoppingAssistant

app = FastAPI(title="Shopping Assistant Visualization")

# Allow CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Assistant
assistant = ShoppingAssistant()
assistant.policy_store.ensure_index(assistant.settings.policy_path)

# Shared state for background test runner
test_run_state = {
    "is_running": False,
    "summary": None,
    "error": None
}

class ChatRequest(BaseModel):
    question: str

@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        res = assistant.ask(request.question)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/database")
async def get_database():
    return {
        "customers": assistant.data_store.customers,
        "orders": assistant.data_store.orders,
        "vouchers": assistant.data_store.vouchers
    }

@app.get("/api/policies")
async def get_policies():
    try:
        collection = assistant.policy_store.collection
        data = collection.get()
        chunks = []
        ids = data.get("ids", [])
        documents = data.get("documents", [])
        metadatas = data.get("metadatas", []) or [None] * len(ids)
        
        for cid, doc, meta in zip(ids, documents, metadatas):
            chunks.append({
                "id": cid,
                "content": doc,
                "metadata": meta or {}
            })
        return {"chunks": chunks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/tests")
async def get_tests():
    test_file = Path("data/test.json")
    if not test_file.exists():
        return {"tests": [], "summary": None}
        
    with open(test_file, "r", encoding="utf-8") as f:
        tests = json.load(f)
        
    summary_path = Path("src/artifacts/traces/summary.json")
    summary = None
    if summary_path.exists():
        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                summary = json.load(f)
        except Exception:
            pass
            
    return {
        "tests": tests,
        "summary": summary
    }

def run_batch_task():
    global test_run_state
    test_file = Path("data/test.json")
    output_dir = Path("src/artifacts/traces")
    
    try:
        summary = assistant.run_batch(test_file, output_dir)
        test_run_state["summary"] = summary
        test_run_state["error"] = None
    except Exception as e:
        test_run_state["error"] = str(e)
    finally:
        test_run_state["is_running"] = False

@app.post("/api/tests/run")
async def run_tests(background_tasks: BackgroundTasks):
    global test_run_state
    if test_run_state["is_running"]:
        return {"status": "already_running"}
        
    test_run_state["is_running"] = True
    test_run_state["summary"] = None
    test_run_state["error"] = None
    background_tasks.add_task(run_batch_task)
    return {"status": "started"}

@app.get("/api/tests/status")
async def get_tests_status():
    return test_run_state

@app.get("/api/traces/{qid}")
async def get_trace(qid: str):
    trace_path = Path(f"src/artifacts/traces/trace_{qid}.json")
    if not trace_path.exists():
        raise HTTPException(status_code=404, detail="Trace not found")
    try:
        with open(trace_path, "r", encoding="utf-8") as f:
            trace = json.load(f)
        return {"trace": trace}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Setup Static Files serving
static_dir = Path("src/app/static")
static_dir.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

@app.get("/")
async def root():
    return RedirectResponse(url="/static/index.html")
