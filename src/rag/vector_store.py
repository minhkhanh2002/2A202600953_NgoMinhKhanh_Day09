import chromadb
from pathlib import Path
from typing import Any
from rag.parser import parse_policy_markdown


class ChromaPolicyStore:
    """Student scaffold for the real Chroma-backed policy index."""

    def __init__(
        self,
        persist_directory: Path,
        embedding_model: Any,
        collection_name: str = "policy_chunks",
    ) -> None:
        self.persist_directory = persist_directory
        self.embedding_model = embedding_model
        self.collection_name = collection_name
        
        # Create PersistentClient
        self.client = chromadb.PersistentClient(path=str(persist_directory))
        self.collection = self.client.get_or_create_collection(
            name=collection_name
        )

    def ensure_index(self, markdown_path: Path) -> None:
        if self.collection.count() == 0:
            self.rebuild(markdown_path)

    def rebuild(self, markdown_path: Path) -> None:
        if not markdown_path.exists():
            raise FileNotFoundError(f"Markdown file not found at {markdown_path}")
            
        with open(markdown_path, "r", encoding="utf-8") as f:
            markdown_text = f.read()
            
        chunks = parse_policy_markdown(markdown_text)
        
        # Drop and recreate collection to start clean
        try:
            self.client.delete_collection(self.collection_name)
        except Exception:
            pass
        self.collection = self.client.create_collection(name=self.collection_name)
        
        if not chunks:
            return
            
        ids = [f"chunk_{i}" for i in range(len(chunks))]
        documents = [c["rendered_text"] for c in chunks]
        metadatas = [{
            "section_h2": c["section_h2"] or "",
            "section_h3": c["section_h3"] or "",
            "citation": c["citation"] or ""
        } for c in chunks]
        
        embeddings = self.embedding_model.embed_documents(documents)
        
        self.collection.add(
            ids=ids,
            documents=documents,
            metadatas=metadatas,
            embeddings=embeddings
        )

    def search(self, query: str, top_k: int = 4) -> list[dict[str, Any]]:
        query_embedding = self.embedding_model.embed_query(query)
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k
        )
        
        hits = []
        if results and results.get("documents") and len(results["documents"]) > 0:
            docs = results["documents"][0]
            metas = results["metadatas"][0] if results.get("metadatas") else [None] * len(docs)
            distances = results["distances"][0] if results.get("distances") else [0.0] * len(docs)
            
            for doc, meta, dist in zip(docs, metas, distances):
                citation = meta.get("citation", "") if meta else ""
                hits.append({
                    "citation": citation,
                    "content": doc,
                    "distance": dist
                })
        return hits

