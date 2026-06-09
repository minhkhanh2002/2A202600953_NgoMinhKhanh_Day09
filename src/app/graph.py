import json
from pathlib import Path
from typing import Any

from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, START, END

from app.config import Settings
from app.state import ShoppingState
from app.data_access import ShoppingDataStore, build_data_tools
from app.prompts import (
    SUPERVISOR_PROMPT,
    POLICY_WORKER_PROMPT,
    DATA_WORKER_PROMPT,
    RESPONSE_WORKER_PROMPT,
)
from app.utils import extract_json_payload
from provider import get_chat_model
from rag.embeddings import SentenceTransformerEmbeddings
from rag.vector_store import ChromaPolicyStore


class ShoppingAssistant:
    """Student scaffold.

    Mục tiêu:
    - Dùng `Settings` để load config.
    - Dùng provider trong `src/provider/`.
    - Dùng embedding loader thật trong `src/rag/embeddings.py`.
    - Tự hoàn thiện phần còn lại: graph, routing, tool calling, RAG search, response synthesis.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or Settings.load()

        # Load chat model từ provider tương ứng
        self.llm = get_chat_model(self.settings)
        
        # Load dataset order/customer
        self.data_store = ShoppingDataStore(self.settings.orders_path)
        
        # Load vector store cho policy
        self.embeddings = SentenceTransformerEmbeddings(self.settings.embedding_model_name)
        self.policy_store = ChromaPolicyStore(self.settings.chroma_dir, self.embeddings)
        
        # Build worker tools
        self.data_tools = build_data_tools(self.data_store)
        
        # Compile LangGraph
        self.graph = build_graph()

    def ask(
        self,
        question: str,
        trace_file: Path | None = None,
        rebuild_index: bool = False,
    ) -> dict[str, Any]:
        if rebuild_index:
            self.policy_store.rebuild(self.settings.policy_path)
        else:
            self.policy_store.ensure_index(self.settings.policy_path)
            
        config = {"configurable": {"assistant": self}}
        state_input = {
            "question": question,
            "trace": []
        }
        
        res = self.graph.invoke(state_input, config=config)
        
        if trace_file:
            trace_file.parent.mkdir(parents=True, exist_ok=True)
            with open(trace_file, "w", encoding="utf-8") as f:
                json.dump(res.get("trace", []), f, ensure_ascii=False, indent=2)
                
        return {
            "route": res.get("route"),
            "policy_result": res.get("policy_result"),
            "data_result": res.get("data_result"),
            "final_answer": res.get("final_answer"),
            "trace": res.get("trace", [])
        }

    def run_batch(
        self,
        test_file: Path,
        output_dir: Path,
        rebuild_index: bool = False,
    ) -> dict[str, Any]:
        if not test_file.exists():
            raise FileNotFoundError(f"Test file not found at {test_file}")
            
        with open(test_file, "r", encoding="utf-8") as f:
            tests = json.load(f)
            
        output_dir.mkdir(parents=True, exist_ok=True)
        
        passed = 0
        results_list = []
        
        for t in tests:
            qid = t["id"]
            question = t["question"]
            expected_route = t["expected_route"]
            expected_status = t["expected_status"]
            expected_contains = t.get("expected_contains", [])
            
            trace_path = output_dir / f"trace_{qid}.json"
            res = self.ask(question, trace_file=trace_path, rebuild_index=rebuild_index)
            
            # Evaluate route
            route_dict = res.get("route") or {}
            actual_route_set = set()
            if route_dict.get("needs_policy"):
                actual_route_set.add("policy")
            if route_dict.get("needs_data"):
                actual_route_set.add("data")
            route_ok = (actual_route_set == set(expected_route))
            
            # Evaluate status
            final_answer = res.get("final_answer") or ""
            actual_status = "ok"
            if "Status: clarification_needed" in final_answer:
                actual_status = "clarification_needed"
            elif "Status: not_found" in final_answer:
                actual_status = "not_found"
            status_ok = (actual_status == expected_status)
            
            # Evaluate contains
            contains_ok = True
            for substr in expected_contains:
                if substr.lower() not in final_answer.lower():
                    contains_ok = False
                    break
                    
            success = route_ok and status_ok and contains_ok
            if success:
                passed += 1
                
            results_list.append({
                "id": qid,
                "question": question,
                "expected_route": expected_route,
                "actual_route": list(actual_route_set),
                "route_ok": route_ok,
                "expected_status": expected_status,
                "actual_status": actual_status,
                "status_ok": status_ok,
                "success": success,
                "final_answer": final_answer
            })
            
        summary = {
            "metrics": {
                "total": len(tests),
                "passed": passed,
                "failed": len(tests) - passed,
                "pass_rate": passed / len(tests) if tests else 0.0
            },
            "results": results_list
        }
        
        summary_path = output_dir / "summary.json"
        with open(summary_path, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
            
        return summary


def route_edge(state: ShoppingState) -> str:
    route = state.get("route") or {}
    if route.get("status") == "clarification_needed":
        return "worker_3_response"
        
    if route.get("needs_policy"):
        return "worker_1_policy"
        
    if route.get("needs_data"):
        return "worker_2_data"
        
    return "worker_3_response"


def after_policy_edge(state: ShoppingState) -> str:
    route = state.get("route") or {}
    if route.get("needs_data"):
        return "worker_2_data"
    return "worker_3_response"


def build_graph() -> Any:
    workflow = StateGraph(ShoppingState)
    
    workflow.add_node("supervisor", supervisor_node)
    workflow.add_node("worker_1_policy", worker_1_policy_node)
    workflow.add_node("worker_2_data", worker_2_data_node)
    workflow.add_node("worker_3_response", worker_3_response_node)
    
    workflow.add_edge(START, "supervisor")
    
    workflow.add_conditional_edges(
        "supervisor",
        route_edge,
        {
            "worker_1_policy": "worker_1_policy",
            "worker_2_data": "worker_2_data",
            "worker_3_response": "worker_3_response"
        }
    )
    
    workflow.add_conditional_edges(
        "worker_1_policy",
        after_policy_edge,
        {
            "worker_2_data": "worker_2_data",
            "worker_3_response": "worker_3_response"
        }
    )
    
    workflow.add_edge("worker_2_data", "worker_3_response")
    workflow.add_edge("worker_3_response", END)
    
    return workflow.compile()


def supervisor_node(state: ShoppingState, config: RunnableConfig) -> ShoppingState:
    assistant = config["configurable"]["assistant"]
    llm = assistant.llm
    
    messages = [
        SystemMessage(content=SUPERVISOR_PROMPT),
        HumanMessage(content=f"Câu hỏi: {state['question']}")
    ]
    
    response = llm.invoke(messages)
    route_dict = extract_json_payload(response.content)
    
    if not route_dict:
        route_dict = {
            "status": "ok",
            "needs_policy": True,
            "needs_data": True,
            "clarification_question": None
        }
        
    return {
        "route": route_dict,
        "trace": [{"node": "supervisor", "output": route_dict}]
    }


def worker_1_policy_node(state: ShoppingState, config: RunnableConfig) -> ShoppingState:
    assistant = config["configurable"]["assistant"]
    llm = assistant.llm
    policy_store = assistant.policy_store
    top_k = assistant.settings.top_k
    
    question = state["question"]
    hits = policy_store.search(question, top_k=top_k)
    
    context_str = "\n\n".join([
        f"Dẫn chứng: {h['citation']}\nNội dung:\n{h['content']}"
        for h in hits
    ])
    
    prompt = f"Tài liệu chính sách liên quan:\n{context_str}\n\nCâu hỏi: {question}"
    messages = [
        SystemMessage(content=POLICY_WORKER_PROMPT),
        HumanMessage(content=prompt)
    ]
    
    response = llm.invoke(messages)
    policy_res = extract_json_payload(response.content)
    
    if not policy_res:
        policy_res = {
            "status": "ok",
            "summary": "Không thể tóm tắt chính sách.",
            "facts": [],
            "citations": []
        }
        
    return {
        "policy_result": policy_res,
        "trace": [{
            "node": "worker_1_policy",
            "search_results": hits,
            "output": policy_res
        }]
    }


def worker_2_data_node(state: ShoppingState, config: RunnableConfig) -> ShoppingState:
    assistant = config["configurable"]["assistant"]
    llm = assistant.llm
    data_tools = assistant.data_tools
    question = state["question"]
    
    model_with_tools = llm.bind_tools(data_tools)
    messages = [
        SystemMessage(content=DATA_WORKER_PROMPT),
        HumanMessage(content=f"Câu hỏi: {question}")
    ]
    
    tool_calls_trace = []
    
    for _ in range(5):
        res = model_with_tools.invoke(messages)
        messages.append(res)
        if not res.tool_calls:
            break
            
        for tc in res.tool_calls:
            name = tc["name"]
            args = tc["args"]
            tool_obj = next((t for t in data_tools if t.name == name), None)
            if tool_obj:
                try:
                    output = tool_obj.invoke(args)
                except Exception as e:
                    output = {"status": "error", "message": str(e)}
            else:
                output = {"status": "error", "message": f"Tool {name} not found"}
                
            messages.append(ToolMessage(
                content=json.dumps(output, ensure_ascii=False),
                tool_call_id=tc["id"]
            ))
            tool_calls_trace.append({
                "tool": name,
                "args": args,
                "output": output
            })
            
    final_content = messages[-1].content
    data_res = extract_json_payload(final_content)
    
    if not data_res:
        data_res = {
            "status": "ok",
            "summary": str(final_content),
            "facts": [str(final_content)],
            "missing_fields": [],
            "not_found_entities": []
        }
        
    return {
        "data_result": data_res,
        "trace": [{
            "node": "worker_2_data",
            "tool_calls": tool_calls_trace,
            "output": data_res
        }]
    }


def worker_3_response_node(state: ShoppingState, config: RunnableConfig) -> ShoppingState:
    assistant = config["configurable"]["assistant"]
    llm = assistant.llm
    
    route = state.get("route") or {}
    policy_res = state.get("policy_result") or {}
    data_res = state.get("data_result") or {}
    
    prompt = RESPONSE_WORKER_PROMPT.format(
        question=state["question"],
        route=json.dumps(route, ensure_ascii=False),
        policy_result=json.dumps(policy_res, ensure_ascii=False),
        data_result=json.dumps(data_res, ensure_ascii=False)
    )
    
    messages = [
        HumanMessage(content=prompt)
    ]
    
    response = llm.invoke(messages)
    final_answer = response.content.strip()
    
    return {
        "final_answer": final_answer,
        "trace": [{
            "node": "worker_3_response",
            "output": final_answer
        }]
    }

