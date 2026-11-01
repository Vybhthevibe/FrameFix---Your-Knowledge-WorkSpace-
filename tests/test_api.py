import pytest
from fastapi.testclient import TestClient
import os
import shutil

import sys

# Make sure we don't mess up real data during tests
os.environ["CHROMA_DB_DIR"] = "./test_chroma_db"
os.environ["UPLOAD_DIR"] = "./test_uploads"

# Add parent directory to path so it can import backend
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Import after setting env vars
from backend.main import app, UPLOAD_DIR
from backend.rag import RAGSystem

client = TestClient(app)

@pytest.fixture(scope="session", autouse=True)
def setup_teardown():
    # Setup
    os.makedirs("./test_uploads", exist_ok=True)
    yield
    # Teardown
    if os.path.exists("./test_uploads"):
        shutil.rmtree("./test_uploads")
    if os.path.exists("./test_chroma_db"):
        shutil.rmtree("./test_chroma_db")
    if os.path.exists("./chroma_db"): # Just in case
        shutil.rmtree("./chroma_db")

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert data["status"] == "ok"
    assert "ollama_configured" in data
    assert "ollama_model" in data
    assert data["gemini_configured"] is False

def test_document_upload_and_search():
    # 1. Upload a document
    test_content = "The super secret Acme API key is 12345-abcde. Only use it in the dev environment."
    files = {"file": ("secret.txt", test_content.encode("utf-8"), "text/plain")}
    
    response = client.post("/api/documents/upload", files=files)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "success"
    assert response.json()["filename"] == "secret.txt"
    
    # 2. List documents
    response = client.get("/api/documents")
    assert response.status_code == 200
    docs = response.json()["documents"]
    assert any(d["filename"] == "secret.txt" for d in docs)
    
    # 3. Search for the document
    search_payload = {"query": "What is the Acme API key?", "top_k": 1}
    response = client.post("/api/search", json=search_payload)
    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) > 0
    assert "12345-abcde" in results[0]["text"]

def test_empty_retrieval_safe_response():
    """Verify that empty retrieval returns safe informative text without calling LLM."""
    from backend.main import rag
    ans = rag.generate_answer("What is the quantum flux capacitor?", [])
    assert "could not find any relevant information" in ans.lower()

def test_unavailable_ollama_service_error():
    """Verify that an unreachable Ollama service returns a clear actionable error."""
    import ollama
    from backend.main import rag
    original_client = rag.ollama_client
    original_url = rag.ollama_base_url
    try:
        rag.ollama_base_url = "http://127.0.0.1:59999"
        rag.ollama_client = ollama.Client(host=rag.ollama_base_url, timeout=1.0)
        
        mock_results = [{
            "id": "1",
            "text": "Some text",
            "metadata": {"filename": "test.md"}
        }]
        ans = rag.generate_answer("Test query?", mock_results)
        assert ans.startswith("Error generating answer.")
        assert "Could not connect to local Ollama service" in ans
        # Ensure no fallback to cloud
        assert "gemini" not in ans.lower()
    finally:
        rag.ollama_client = original_client
        rag.ollama_base_url = original_url

def test_missing_ollama_model_error():
    """Verify that requesting a missing model returns an actionable error to pull the model."""
    from backend.main import rag
    import ollama
    from unittest.mock import patch
    original_model = rag.ollama_model
    try:
        rag.ollama_model = "nonexistent_model_xyz_999"
        mock_results = [{
            "id": "1",
            "text": "Acme system uses token RS256.",
            "metadata": {"filename": "auth.md"}
        }]
        if not rag.is_available():
            err = ollama.ResponseError("model 'nonexistent_model_xyz_999' not found", status_code=404)
            with patch.object(rag.ollama_client, 'chat', side_effect=err):
                ans = rag.generate_answer("What token does Acme use?", mock_results)
        else:
            ans = rag.generate_answer("What token does Acme use?", mock_results)
        assert ans.startswith("Error generating answer.")
        assert "was not found in Ollama" in ans
        assert "ollama pull" in ans
    finally:
        rag.ollama_model = original_model

def test_no_gemini_active_dependency():
    """Verify Gemini client is not initialized or required."""
    from backend.main import rag
    assert rag.gemini_client is None

def test_ask_endpoint_with_ollama():
    """Integration test: ask question, retrieve context, generate answer with citations via Ollama."""
    from backend.main import rag
    if not rag.is_available():
        pytest.skip(f"Ollama model '{rag.ollama_model}' is not currently available locally")
        
    ask_payload = {"query": "What is the secret Acme API key?", "top_k": 1}
    response = client.post("/api/ask", json=ask_payload)
    assert response.status_code == 200
    data = response.json()
    assert "answer" in data
    assert "sources" in data
    assert len(data["sources"]) > 0
    answer = data["answer"]
    assert len(answer) > 0
    # Citations check
    assert "[S1]" in answer or "secret.txt" in answer or "12345-abcde" in answer
    # No leaked thinking tags
    assert "<think>" not in answer
    assert "</think>" not in answer

def test_ollama_timeout_and_thinking_defaults():
    """Verify default OLLAMA_TIMEOUT is 660.0 and thinking mode is disabled by default."""
    from backend.main import rag
    assert rag.timeout == 660.0
    assert rag.ollama_model == "qwen3:4b"
    if rag.supports_think:
        assert rag.think is False

