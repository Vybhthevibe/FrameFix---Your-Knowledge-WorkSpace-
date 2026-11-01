import os
import re
import uuid
import logging
import inspect
from typing import List, Dict, Any, Optional, Union
from pathlib import Path
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
import ollama
import httpx

logger = logging.getLogger(__name__)

class RAGSystem:
    def __init__(self, persist_directory: Optional[str] = None):
        if persist_directory is None:
            persist_directory = os.getenv("CHROMA_DB_DIR")
            
        if persist_directory is None:
            project_root = Path(__file__).resolve().parent.parent
            self.persist_directory = str(project_root / "data" / "chroma_db")
        else:
            self.persist_directory = str(Path(persist_directory).resolve())
            
        Path(self.persist_directory).mkdir(parents=True, exist_ok=True)
        print(f"ChromaDB path: {self.persist_directory}")
        
        # Initialize embedding model
        # Using a small, fast model for CPU compatibility
        print("Loading embedding model (this might take a moment on first run)...")
        self.embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
        
        # Initialize ChromaDB
        self.chroma_client = chromadb.PersistentClient(path=self.persist_directory)
        self.collection = self.chroma_client.get_or_create_collection(name="engimemory_docs")
        print(f"Collection document count: {self.collection.count()}")
        
        # Ollama local inference configuration
        self.ollama_model = os.getenv("OLLAMA_MODEL", "qwen3:4b")
        self.ollama_base_url = (
            os.getenv("OLLAMA_BASE_URL")
            or os.getenv("OLLAMA_HOST")
            or "http://localhost:11434"
        )
        self.timeout = float(os.getenv("OLLAMA_TIMEOUT", "660.0"))

        # Check if the installed Ollama Python client supports thinking mode
        chat_params = inspect.signature(ollama.Client.chat).parameters
        self.supports_think = "think" in chat_params

        # Thinking mode configuration
        # If supported by client, disable thinking mode by default to reduce generation time.
        # Remains configurable through OLLAMA_THINK in .env
        think_env = os.getenv("OLLAMA_THINK")
        if think_env is not None:
            if think_env.lower() in ("true", "1", "yes"):
                self.think: Optional[Union[bool, str]] = True
            elif think_env.lower() in ("false", "0", "no"):
                self.think = False
            elif think_env.lower() in ("low", "medium", "high"):
                self.think = think_env.lower()
            else:
                self.think = False
        elif self.supports_think:
            self.think = False
        else:
            self.think = None

        self.ollama_client = ollama.Client(host=self.ollama_base_url, timeout=self.timeout)
        self.gemini_client = None  # Deprecated; retained for backward compatibility
            
    def _chunk_text(self, text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
        """Splits text into overlapping chunks."""
        chunks = []
        start = 0
        text_len = len(text)
        
        while start < text_len:
            end = start + chunk_size
            chunks.append(text[start:end])
            start += chunk_size - overlap
            
        return chunks

    def add_document(self, text: str, filename: str, doc_id: str):
        """Chunks a document, embeds it, and stores it in ChromaDB."""
        chunks = self._chunk_text(text)
        
        if not chunks:
            return
            
        embeddings = self.embedding_model.encode(chunks).tolist()
        
        ids = [f"{doc_id}_{i}" for i in range(len(chunks))]
        metadatas = [{"filename": filename, "doc_id": doc_id, "chunk_index": i} for i in range(len(chunks))]
        
        # Store in ChromaDB
        self.collection.add(
            embeddings=embeddings,
            documents=chunks,
            metadatas=metadatas,
            ids=ids
        )

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Searches for the most relevant document chunks."""
        query_embedding = self.embedding_model.encode([query]).tolist()[0]
        
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k
        )
        
        formatted_results = []
        if results and results['documents'] and results['documents'][0]:
            for i in range(len(results['documents'][0])):
                formatted_results.append({
                    "id": results['ids'][0][i],
                    "text": results['documents'][0][i],
                    "metadata": results['metadatas'][0][i],
                    "distance": results['distances'][0][i] if 'distances' in results else None
                })
                
        return formatted_results

    def is_available(self) -> bool:
        """Checks if local Ollama service is reachable and the configured model is installed."""
        try:
            models_resp = self.ollama_client.list()
            available = [m.model for m in getattr(models_resp, "models", [])]
            target = self.ollama_model
            target_base = target.split(":")[0]
            return any(
                m == target or m.split(":")[0] == target_base or target in m
                for m in available
            )
        except Exception as e:
            logger.debug("Ollama is_available check failed: %s", e)
            return False

    def generate_answer(self, query: str, search_results: List[Dict[str, Any]]) -> str:
        """Generates an answer using local Ollama model based on retrieved context."""
        if not search_results:
            return "I could not find any relevant information in the uploaded documents to answer your question."

        # Construct context with numbered citations
        context_parts = []
        for i, res in enumerate(search_results):
            source_id = f"S{i+1}"
            filename = res.get('metadata', {}).get('filename', 'Unknown File')
            text = res.get('text', '')
            context_parts.append(f"[{source_id}] (Source: {filename}):\n{text}")
            
        context_str = "\n\n".join(context_parts)
        
        system_instruction = (
            "You are an internal engineering knowledge assistant for a company.\n"
            "Answer the user's question using ONLY the provided context from internal documents.\n"
            "Do not invent facts, APIs, configuration options, bug fixes, or company policies.\n"
            "If the context does not contain enough information to answer the question, explicitly state that you don't know based on the available documents.\n"
            "When using information from the context, you MUST include inline citations referring to the source number, like [S1] or [S2].\n"
            "Do not output raw thinking tags. Provide only the clear, direct answer with appropriate citations."
        )
        
        user_message = f"CONTEXT:\n{context_str}\n\nQUESTION:\n{query}"
        
        messages = [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_message}
        ]
        
        chat_kwargs: Dict[str, Any] = {
            "model": self.ollama_model,
            "messages": messages,
            "options": {"temperature": 0.2},
        }
        if self.supports_think and self.think is not None:
            chat_kwargs["think"] = self.think

        try:
            response = self.ollama_client.chat(**chat_kwargs)
            raw_text = response.message.content or ""
            # Strip any residual thinking tags if present
            clean_text = re.sub(r'<think>.*?</think>', '', raw_text, flags=re.DOTALL).strip()
            if "</think>" in clean_text:
                clean_text = clean_text.split("</think>", 1)[-1].strip()
            if "<think>" in clean_text:
                clean_text = clean_text.split("<think>", 1)[0].strip()
            if not clean_text:
                fallback = re.sub(r'</?think>', '', raw_text).strip()
                clean_text = fallback or "No response could be generated from the model."
            return clean_text
        except (ConnectionError, httpx.ConnectError):
            logger.error("Failed to connect to local Ollama service at %s", self.ollama_base_url)
            return (
                f"Error generating answer. Could not connect to local Ollama service at {self.ollama_base_url}. "
                "Please verify that Ollama is running ('ollama serve')."
            )
        except ollama.ResponseError as e:
            logger.error("Ollama ResponseError: code=%s, error=%s", getattr(e, "status_code", None), getattr(e, "error", str(e)))
            if getattr(e, "status_code", None) == 404 or "not found" in str(e).lower():
                return (
                    f"Error generating answer. Model '{self.ollama_model}' was not found in Ollama. "
                    f"Please download it locally by running: ollama pull {self.ollama_model}"
                )
            return f"Error generating answer. Ollama returned an error: {e.error}"
        except (httpx.TimeoutException, TimeoutError):
            logger.error("Timeout during Ollama inference for model %s", self.ollama_model)
            return (
                f"Error generating answer. Local inference timed out while waiting for model '{self.ollama_model}'. "
                f"The request exceeded the {self.timeout}s timeout."
            )
        except Exception as e:
            logger.error("Unexpected error during local Ollama inference: %s", type(e).__name__)
            return f"Error generating answer. Local inference failed: {str(e)}"

