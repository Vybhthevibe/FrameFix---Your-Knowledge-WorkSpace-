import os
import shutil
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

# Use isolated test paths
TEST_DB_PATH = "./test_data/test_chat_history.db"
TEST_UPLOAD_DIR = "./test_data/uploads"
TEST_CHROMA_DIR = "./test_data/chroma"

os.environ["CHAT_DB_PATH"] = TEST_DB_PATH
os.environ["UPLOAD_DIR"] = TEST_UPLOAD_DIR
os.environ["CHROMA_DB_DIR"] = TEST_CHROMA_DIR

import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.database import ChatDatabase
from backend.main import app, db, rag

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_test_db():
    os.makedirs("./test_data", exist_ok=True)
    # Reinitialize a clean test db
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)
    db.db_path = TEST_DB_PATH
    db.init_db()
    yield
    if os.path.exists("./test_data"):
        shutil.rmtree("./test_data", ignore_errors=True)

def test_database_crud_and_cascade():
    """Verify SQLite CRUD, message persistence, source serialization, and cascading deletion."""
    test_db = ChatDatabase(TEST_DB_PATH)
    
    # 1. Create conversation
    conv = test_db.create_conversation("Auth Architecture Discussion")
    conv_id = conv["id"]
    assert conv["title"] == "Auth Architecture Discussion"
    
    # 2. Add user message
    user_msg = test_db.add_message(conv_id, role="user", content="How does AcmeAuth work?")
    assert user_msg["role"] == "user"
    assert user_msg["sources"] is None
    
    # 3. Add assistant message with sources
    sources = [
        {
            "id": "doc1_0",
            "text": "AcmeAuth uses RS256 JWT tokens.",
            "metadata": {"filename": "AcmeAuth_Setup.md", "chunk_index": 0},
            "distance": 0.12
        }
    ]
    asst_msg = test_db.add_message(conv_id, role="assistant", content="AcmeAuth uses RS256 [S1].", sources=sources)
    assert asst_msg["role"] == "assistant"
    assert len(asst_msg["sources"]) == 1
    assert asst_msg["sources"][0]["metadata"]["filename"] == "AcmeAuth_Setup.md"
    
    # 4. Fetch conversation and verify order
    fetched = test_db.get_conversation(conv_id)
    assert fetched is not None
    assert fetched["title"] == "Auth Architecture Discussion"
    assert len(fetched["messages"]) == 2
    assert fetched["messages"][0]["role"] == "user"
    assert fetched["messages"][1]["role"] == "assistant"
    assert fetched["messages"][1]["sources"][0]["id"] == "doc1_0"
    
    # 5. Rename conversation
    updated = test_db.update_conversation_title(conv_id, "Renamed Auth Architecture")
    assert updated["title"] == "Renamed Auth Architecture"
    
    # 6. List conversations
    convs = test_db.list_conversations()
    assert len(convs) == 1
    assert convs[0]["id"] == conv_id
    assert convs[0]["message_count"] == 2
    
    # 7. Delete conversation & verify cascading
    deleted = test_db.delete_conversation(conv_id)
    assert deleted is True
    assert test_db.get_conversation(conv_id) is None
    
    # Verify messages table is empty due to cascade
    with test_db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM messages WHERE conversation_id = ?", (conv_id,))
        count = cursor.fetchone()[0]
        assert count == 0

def test_title_generator():
    """Verify concise title generation from query."""
    q1 = "What caused the INC-402 outage and how was it resolved?"
    title1 = ChatDatabase.generate_title_from_query(q1, max_chars=35)
    assert len(title1) <= 38  # with ellipsis
    assert not title1.endswith("?")

def test_api_conversations_endpoints():
    """Test REST API endpoints for conversations."""
    # Create conversation
    create_res = client.post("/api/conversations", json={"title": "First Chat"})
    assert create_res.status_code == 200
    conv_data = create_res.json()
    conv_id = conv_data["id"]
    assert conv_data["title"] == "First Chat"
    
    # List conversations
    list_res = client.get("/api/conversations")
    assert list_res.status_code == 200
    assert len(list_res.json()["conversations"]) >= 1
    
    # Rename conversation
    patch_res = client.patch(f"/api/conversations/{conv_id}", json={"title": "Updated First Chat"})
    assert patch_res.status_code == 200
    assert patch_res.json()["title"] == "Updated First Chat"
    
    # Delete conversation
    del_res = client.delete(f"/api/conversations/{conv_id}")
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "success"
    
    # Fetch deleted conversation -> 404
    get_res = client.get(f"/api/conversations/{conv_id}")
    assert get_res.status_code == 404

def test_opening_conversation_does_not_invoke_rag_or_ollama():
    """Crucial requirement: Reopening a conversation must be pure SQLite read without calling Ollama or ChromaDB."""
    # Create conversation with saved messages
    conv = db.create_conversation("Existing Cached Chat")
    conv_id = conv["id"]
    db.add_message(conv_id, "user", "What is AcmeRPC timeout?")
    saved_sources = [{
        "id": "chunk_123",
        "text": "AcmeRPC timeout is 5000ms by default.",
        "metadata": {"filename": "AcmeRPC_Overview.md", "chunk_index": 2},
        "distance": 0.05
    }]
    db.add_message(conv_id, "assistant", "The AcmeRPC timeout is 5000ms [S1].", sources=saved_sources)
    
    # Spy/mock rag.search and rag.generate_answer to ensure they are NEVER called
    with patch.object(rag, 'search') as mock_search, \
         patch.object(rag, 'generate_answer') as mock_generate:
        
        response = client.get(f"/api/conversations/{conv_id}")
        assert response.status_code == 200
        data = response.json()
        
        # Verify retrieved data
        assert data["id"] == conv_id
        assert len(data["messages"]) == 2
        assert data["messages"][0]["content"] == "What is AcmeRPC timeout?"
        assert data["messages"][1]["content"] == "The AcmeRPC timeout is 5000ms [S1]."
        assert data["messages"][1]["sources"][0]["metadata"]["filename"] == "AcmeRPC_Overview.md"
        assert "[S1]" in data["messages"][1]["content"]
        
        # Strictly verify no inference or retrieval was invoked
        mock_search.assert_not_called()
        mock_generate.assert_not_called()

def test_ask_endpoint_persists_messages_and_supports_follow_ups():
    """Verify POST /api/ask creates conversation, persists question, answer, sources, and continues conversation."""
    mock_sources = [{
        "id": "chunk_99",
        "text": "Acme uses OAuth2 with PKCE flow.",
        "metadata": {"filename": "AcmeAuth_Setup.md", "chunk_index": 1},
        "distance": 0.08
    }]
    
    with patch.object(rag, 'search', return_value=mock_sources), \
         patch.object(rag, 'generate_answer', return_value="Acme uses PKCE [S1]."):
        
        # 1. First question (new conversation)
        res1 = client.post("/api/ask", json={"query": "How does Acme authenticate?", "top_k": 3})
        assert res1.status_code == 200
        d1 = res1.json()
        assert "conversation_id" in d1
        conv_id = d1["conversation_id"]
        assert d1["answer"] == "Acme uses PKCE [S1]."
        assert len(d1["sources"]) == 1
        
        # Verify saved in SQLite
        conv = db.get_conversation(conv_id)
        assert conv is not None
        assert len(conv["messages"]) == 2
        assert conv["messages"][0]["role"] == "user"
        assert conv["messages"][0]["content"] == "How does Acme authenticate?"
        assert conv["messages"][1]["role"] == "assistant"
        assert conv["messages"][1]["content"] == "Acme uses PKCE [S1]."
        assert conv["messages"][1]["sources"][0]["id"] == "chunk_99"
        
        # 2. Follow-up question in same conversation
        res2 = client.post("/api/ask", json={
            "query": "Is PKCE mandatory?",
            "top_k": 3,
            "conversation_id": conv_id
        })
        assert res2.status_code == 200
        d2 = res2.json()
        assert d2["conversation_id"] == conv_id
        
        # Verify 4 messages now exist in conversation
        conv_after = db.get_conversation(conv_id)
        assert len(conv_after["messages"]) == 4
        assert conv_after["messages"][2]["role"] == "user"
        assert conv_after["messages"][2]["content"] == "Is PKCE mandatory?"
        assert conv_after["messages"][3]["role"] == "assistant"

def test_ask_error_does_not_persist_asst_message():
    """Verify that if generation returns an error, the error is NOT persisted as a successful assistant message."""
    with patch.object(rag, 'search', return_value=[]), \
         patch.object(rag, 'generate_answer', return_value="Error generating answer. Could not connect to local Ollama service."):
        
        res = client.post("/api/ask", json={"query": "Will this fail?"})
        assert res.status_code == 200
        d = res.json()
        assert d["answer"].startswith("Error generating answer")
        conv_id = d["conversation_id"]
        
        # User message was saved, but NO assistant message should be saved
        conv = db.get_conversation(conv_id)
        assert len(conv["messages"]) == 1
        assert conv["messages"][0]["role"] == "user"

def test_persistence_across_restarts():
    """Verify that SQLite persists data across new instances (simulating server restarts)."""
    # Instance 1 writes
    db1 = ChatDatabase(TEST_DB_PATH)
    c = db1.create_conversation("Persistent Restart Test")
    cid = c["id"]
    db1.add_message(cid, "user", "Message from before reboot")
    db1.add_message(cid, "assistant", "Answer from before reboot", sources=[{"id": "c1", "text": "t1", "metadata": {"filename": "f.md"}}])
    
    # Instance 2 reads (new instance, same db path)
    db2 = ChatDatabase(TEST_DB_PATH)
    c_read = db2.get_conversation(cid)
    assert c_read is not None
    assert c_read["title"] == "Persistent Restart Test"
    assert len(c_read["messages"]) == 2
    assert c_read["messages"][1]["sources"][0]["metadata"]["filename"] == "f.md"
