"""
backend/database.py
Persistent SQLite storage for FrameFix chat history.
Provides conversation and message management with foreign key constraints,
cascading deletions, and indexing.
"""

import os
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Any, Optional

def get_default_db_path() -> str:
    env_path = os.getenv("CHAT_DB_PATH")
    if env_path:
        return str(Path(env_path).resolve())
    project_root = Path(__file__).resolve().parent.parent
    return str(project_root / "data" / "chat_history.db")

class ChatDatabase:
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or get_default_db_path()
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self.init_db()

    def get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")
        return conn

    def init_db(self):
        """Creates conversations and messages tables and indexes if they do not exist."""
        with self.get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    sources TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                );
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_conversations_updated_at 
                ON conversations(updated_at DESC);
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_messages_conv_created 
                ON messages(conversation_id, created_at ASC);
            """)
            conn.commit()

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def generate_title_from_query(query: str, max_chars: int = 48) -> str:
        """Generates a concise, clean conversation title from the first question."""
        cleaned = " ".join(query.strip().split())
        if not cleaned:
            return "New Conversation"
        if len(cleaned) <= max_chars:
            return cleaned
        truncated = cleaned[:max_chars].rsplit(" ", 1)[0]
        if not truncated:
            truncated = cleaned[:max_chars]
        return truncated.rstrip("?,.:;") + "..."

    def create_conversation(self, title: str = "New Conversation", conv_id: Optional[str] = None) -> Dict[str, Any]:
        """Creates a new conversation record."""
        conv_id = conv_id or str(uuid.uuid4())
        now = self._now_iso()
        with self.get_connection() as conn:
            conn.execute(
                "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (conv_id, title, now, now)
            )
            conn.commit()
        return {
            "id": conv_id,
            "title": title,
            "created_at": now,
            "updated_at": now,
            "message_count": 0
        }

    def get_conversation(self, conv_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a conversation and all its messages in chronological order."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?", (conv_id,))
            row = cursor.fetchone()
            if not row:
                return None

            conv = dict(row)
            cursor.execute(
                "SELECT id, conversation_id, role, content, sources, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC",
                (conv_id,)
            )
            msg_rows = cursor.fetchall()
            messages = []
            for m in msg_rows:
                msg = dict(m)
                if msg["sources"]:
                    try:
                        msg["sources"] = json.loads(msg["sources"])
                    except Exception:
                        msg["sources"] = []
                else:
                    msg["sources"] = None
                messages.append(msg)

            conv["messages"] = messages
            conv["message_count"] = len(messages)
            return conv

    def list_conversations(self) -> List[Dict[str, Any]]:
        """Lists all conversations ordered by most recently updated."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT c.id, c.title, c.created_at, c.updated_at,
                       COUNT(m.id) as message_count
                FROM conversations c
                LEFT JOIN messages m ON c.id = m.conversation_id
                GROUP BY c.id
                ORDER BY c.updated_at DESC
            """)
            rows = cursor.fetchall()
            return [dict(r) for r in rows]

    def update_conversation_title(self, conv_id: str, title: str) -> Optional[Dict[str, Any]]:
        """Renames a conversation and updates its updated_at timestamp."""
        now = self._now_iso()
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
                (title.strip(), now, conv_id)
            )
            conn.commit()
            if cursor.rowcount == 0:
                return None
        return self.get_conversation(conv_id)

    def touch_conversation(self, conv_id: str):
        """Updates the updated_at timestamp of a conversation."""
        now = self._now_iso()
        with self.get_connection() as conn:
            conn.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?",
                (now, conv_id)
            )
            conn.commit()

    def delete_conversation(self, conv_id: str) -> bool:
        """Deletes a conversation and its cascaded messages."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
            conn.commit()
            return cursor.rowcount > 0

    def add_message(
        self,
        conv_id: str,
        role: str,
        content: str,
        sources: Optional[List[Dict[str, Any]]] = None,
        msg_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Saves a message (user or assistant) and updates the conversation's updated_at."""
        msg_id = msg_id or str(uuid.uuid4())
        now = self._now_iso()
        sources_json = json.dumps(sources) if sources is not None else None

        with self.get_connection() as conn:
            conn.execute(
                """
                INSERT INTO messages (id, conversation_id, role, content, sources, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (msg_id, conv_id, role, content, sources_json, now)
            )
            conn.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?",
                (now, conv_id)
            )
            conn.commit()

        return {
            "id": msg_id,
            "conversation_id": conv_id,
            "role": role,
            "content": content,
            "sources": sources,
            "created_at": now
        }
