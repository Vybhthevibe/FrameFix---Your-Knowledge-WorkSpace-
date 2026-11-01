/**
 * FrameFix — Your Knowledge Workspace
 * Frontend Controller & API Integration
 * Features:
 * - Persistent chat history with SQLite backend
 * - Multi-turn conversation thread preservation
 * - Grounding sources and interactive citation jumps
 * - Zero-inference conversation reopening (pure database read)
 * - Rename and delete conversation management
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const appLayout = document.getElementById('app-layout');
    const sidebar = document.getElementById('sidebar');
    const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const workspaceContent = document.getElementById('workspace-content');
    const btnNewQuery = document.getElementById('btn-new-query');
    
    // Navigation & Tabs
    const navAskMode = document.getElementById('nav-ask-mode');
    const navSearchMode = document.getElementById('nav-search-mode');
    const navKbBtn = document.getElementById('nav-kb-btn');
    const tabAsk = document.getElementById('tab-ask');
    const tabSearch = document.getElementById('tab-search');
    
    // Query Inputs & Controls
    const queryInput = document.getElementById('query-input');
    const submitBtn = document.getElementById('submit-btn');
    const submitBtnText = document.getElementById('submit-btn-text');
    const topkSelect = document.getElementById('topk-select');
    const suggestionChips = document.querySelectorAll('.suggestion-chip');
    
    // Conversation & Results
    const conversationTurns = document.getElementById('conversation-turns');
    const resultsArea = document.getElementById('results-area');
    const loadingState = document.getElementById('loading');
    const loadingMessage = document.getElementById('loading-message');
    const loadingSubmessage = document.getElementById('loading-submessage');
    const errorBox = document.getElementById('error-box');
    const errorMessage = document.getElementById('error-message');
    const errorRetryBtn = document.getElementById('error-retry-btn');
    const emptyState = document.getElementById('empty-state');
    
    // Knowledge Base Drawer
    const kbDrawer = document.getElementById('kb-drawer');
    const kbDrawerBackdrop = document.getElementById('kb-drawer-backdrop');
    const kbDrawerClose = document.getElementById('kb-drawer-close');
    const kbDocCount = document.getElementById('kb-doc-count');
    const drawerDocCount = document.getElementById('drawer-doc-count');
    const docsList = document.getElementById('docs-list');
    const docFilterInput = document.getElementById('doc-filter-input');
    const uploadForm = document.getElementById('upload-form');
    const fileInput = document.getElementById('file-input');
    const uploadBtn = document.getElementById('upload-btn');
    const uploadStatus = document.getElementById('upload-status');
    const selectedFileLabel = document.getElementById('selected-file-label');
    
    // Conversations Sidebar List
    const recentQueriesList = document.getElementById('recent-queries-list');
    const recentClearBtn = document.getElementById('recent-clear-btn');
    
    // Settings & Status
    const statusDot = document.getElementById('status-dot');
    const mobileStatusDot = document.getElementById('mobile-status-dot');
    const statusTitle = document.getElementById('status-title');
    const statusSubtitle = document.getElementById('status-subtitle');
    const apiStatusBanner = document.getElementById('api-status-banner');
    const bannerMessage = document.getElementById('banner-message');
    const bannerClose = document.getElementById('banner-close');
    const settingsTriggerBtn = document.getElementById('settings-trigger-btn');
    const settingsModal = document.getElementById('settings-modal');
    const settingsModalBackdrop = document.getElementById('settings-modal-backdrop');
    const settingsModalClose = document.getElementById('settings-modal-close');
    const settingsModalDone = document.getElementById('settings-modal-done');
    const clearAllLocalDataBtn = document.getElementById('clear-all-local-data');
    const cfgGeminiStatus = document.getElementById('cfg-gemini-status');
    const footerCorpusStatus = document.getElementById('footer-corpus-status');

    // --- State ---
    const STORAGE_ACTIVE_CONV = 'framefix_active_conversation_id';
    let currentMode = 'ask-mode'; // 'ask-mode' | 'search-mode'
    let activeConversationId = null;
    let conversations = [];
    let allDocuments = [];
    let isRequestRunning = false;
    let lastQuery = '';
    let abortController = null;
    let loadingTimer1 = null;
    let loadingTimer2 = null;

    function clearLoadingTimers() {
        if (loadingTimer1) {
            clearTimeout(loadingTimer1);
            loadingTimer1 = null;
        }
        if (loadingTimer2) {
            clearTimeout(loadingTimer2);
            loadingTimer2 = null;
        }
    }

    // ==========================================================================
    // Initialization
    // ==========================================================================
    checkHealth();
    loadDocuments();
    loadConversations(true); // true = auto-restore active conversation if present
    setupEventListeners();
    setupAutoResizeTextarea();

    // ==========================================================================
    // Health Check & Status
    // ==========================================================================
    async function checkHealth() {
        try {
            const res = await fetch('/api/health');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            if (data.status === 'ok') {
                if (data.ollama_configured || data.gemini_configured) {
                    const modelName = data.ollama_model || 'qwen3:4b';
                    setStatus('online', 'System Operational', `Ollama (${modelName})`);
                    if (cfgGeminiStatus) {
                        cfgGeminiStatus.textContent = `Ollama: ${modelName} (Local)`;
                        cfgGeminiStatus.style.color = '#10B981';
                    }
                    apiStatusBanner.classList.add('hidden');
                } else {
                    const modelName = data.ollama_model || 'qwen3:4b';
                    const ollamaUrl = data.ollama_url || 'http://localhost:11434';
                    setStatus('warning', 'Semantic Search Only', 'Ollama Model Unavailable');
                    if (cfgGeminiStatus) {
                        cfgGeminiStatus.textContent = 'Ollama Unavailable (Search Only)';
                        cfgGeminiStatus.style.color = '#F59E0B';
                    }
                    showBanner(`Notice: Local Ollama model '${modelName}' is not accessible at ${ollamaUrl}. Ensure Ollama is running ('ollama serve') and '${modelName}' is installed.`);
                }
            } else {
                setStatus('warning', 'Degraded', 'Unexpected health response');
            }
        } catch (err) {
            console.error('Health check failed:', err);
            setStatus('offline', 'Backend Unreachable', 'http://127.0.0.1:8000');
            if (cfgGeminiStatus) {
                cfgGeminiStatus.textContent = 'Disconnected';
                cfgGeminiStatus.style.color = '#EF4444';
            }
            showBanner('Warning: Unable to reach FrameFix backend at http://127.0.0.1:8000. Ensure uvicorn is running.');
        }
    }

    function setStatus(state, title, subtitle) {
        statusDot.className = `status-dot ${state}`;
        if (mobileStatusDot) mobileStatusDot.className = `status-dot ${state}`;
        statusTitle.textContent = title;
        statusSubtitle.textContent = subtitle;
    }

    function showBanner(msg) {
        bannerMessage.textContent = msg;
        apiStatusBanner.classList.remove('hidden');
    }

    if (bannerClose) {
        bannerClose.addEventListener('click', () => {
            apiStatusBanner.classList.add('hidden');
        });
    }

    // ==========================================================================
    // Document Management (Knowledge Base)
    // ==========================================================================
    async function loadDocuments() {
        try {
            const res = await fetch('/api/documents');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            
            allDocuments = data.documents || [];
            updateDocCountUI(allDocuments.length);
            renderDocumentList(allDocuments);
        } catch (err) {
            console.error('Failed to load documents:', err);
            docsList.innerHTML = '<li class="doc-item-loading" style="color:var(--color-danger)">Failed to load corpus documents.</li>';
            updateDocCountUI(0);
        }
    }

    function updateDocCountUI(count) {
        kbDocCount.textContent = count;
        drawerDocCount.textContent = `${count} files`;
        footerCorpusStatus.textContent = `${count} docs indexed`;
    }

    function renderDocumentList(docs) {
        docsList.innerHTML = '';
        if (docs.length === 0) {
            docsList.innerHTML = '<li class="doc-item-loading">No documents indexed yet.</li>';
            return;
        }

        docs.forEach(doc => {
            const ext = doc.filename.endsWith('.md') ? 'MD' : 'TXT';
            const li = document.createElement('li');
            li.className = 'doc-item';
            li.innerHTML = `
                <div class="doc-item-left">
                    <span class="doc-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                            <polyline points="14 2 14 8 20 8"/>
                        </svg>
                    </span>
                    <span class="doc-name" title="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</span>
                </div>
                <span class="doc-badge">${ext}</span>
            `;
            docsList.appendChild(li);
        });
    }

    // Document Filter in Drawer
    if (docFilterInput) {
        docFilterInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            const filtered = allDocuments.filter(doc => doc.filename.toLowerCase().includes(term));
            renderDocumentList(filtered);
        });
    }

    // Document File Upload
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) {
            selectedFileLabel.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
            selectedFileLabel.classList.remove('hidden');
            uploadBtn.disabled = false;
        } else {
            selectedFileLabel.classList.add('hidden');
            uploadBtn.disabled = true;
        }
    });

    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const file = fileInput.files[0];
        if (!file) return;

        uploadBtn.disabled = true;
        uploadStatus.className = 'upload-status-box';
        uploadStatus.textContent = `Indexing ${file.name}...`;
        uploadStatus.classList.remove('hidden');

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/documents/upload', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (res.ok) {
                uploadStatus.className = 'upload-status-box success';
                uploadStatus.textContent = `✓ Successfully indexed "${file.name}" into knowledge base`;
                fileInput.value = '';
                selectedFileLabel.classList.add('hidden');
                loadDocuments();
            } else {
                throw new Error(data.detail || 'Upload failed');
            }
        } catch (err) {
            uploadStatus.className = 'upload-status-box error';
            uploadStatus.textContent = `Upload error: ${err.message}`;
        } finally {
            uploadBtn.disabled = false;
        }
    });

    // ==========================================================================
    // Persistent Conversations (SQLite Integration)
    // ==========================================================================
    async function loadConversations(autoRestore = false) {
        try {
            const res = await fetch('/api/conversations');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            conversations = data.conversations || [];
            renderConversationList();

            if (autoRestore) {
                const savedId = localStorage.getItem(STORAGE_ACTIVE_CONV);
                if (savedId && conversations.some(c => c.id === savedId)) {
                    openConversation(savedId);
                }
            }
        } catch (err) {
            console.error('Failed to load conversations:', err);
            recentQueriesList.innerHTML = '<div class="recent-empty">Failed to load chat history</div>';
        }
    }

    function renderConversationList() {
        recentQueriesList.innerHTML = '';
        if (conversations.length === 0) {
            recentQueriesList.innerHTML = '<div class="recent-empty">No previous chats yet</div>';
            return;
        }

        conversations.forEach(conv => {
            const item = document.createElement('div');
            const isActive = conv.id === activeConversationId;
            item.className = `recent-item${isActive ? ' active' : ''}`;
            item.dataset.id = conv.id;
            item.title = conv.title;

            item.innerHTML = `
                <span class="recent-item-title">${escapeHtml(conv.title)}</span>
                <span class="recent-item-time">${formatTimeAgo(conv.updated_at || conv.created_at)}</span>
                <div class="recent-item-actions">
                    <button type="button" class="recent-action-btn rename-btn" title="Rename conversation" aria-label="Rename conversation">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 20h9"/>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                        </svg>
                    </button>
                    <button type="button" class="recent-action-btn delete-btn" title="Delete conversation" aria-label="Delete conversation">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            `;

            // Click conversation to open
            item.addEventListener('click', (e) => {
                if (e.target.closest('.recent-action-btn')) return;
                openConversation(conv.id);
            });

            // Rename button
            const renameBtn = item.querySelector('.rename-btn');
            if (renameBtn) {
                renameBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    renameConversation(conv.id, conv.title);
                });
            }

            // Delete button
            const deleteBtn = item.querySelector('.delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id, conv.title);
                });
            }

            recentQueriesList.appendChild(item);
        });
    }

    /**
     * Open an existing conversation from SQLite.
     * ZERO inference or retrieval: purely reads messages from backend.
     */
    async function openConversation(convId) {
        if (!convId) return;

        try {
            clearLoadingTimers();
            isRequestRunning = false;
            abortController = null;

            const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}`);
            if (!res.ok) {
                console.error(`Failed to load conversation (${res.status})`);
                return;
            }

            const data = await res.json();
            activeConversationId = data.id;
            localStorage.setItem(STORAGE_ACTIVE_CONV, activeConversationId);

            // Update sidebar highlighting
            const items = recentQueriesList.querySelectorAll('.recent-item');
            items.forEach(el => {
                el.classList.toggle('active', el.dataset.id === activeConversationId);
            });

            // Switch workspace to conversation view
            if (workspaceContent) {
                workspaceContent.classList.add('has-conversation');
            }

            // Hide loading, error, empty states
            errorBox.classList.add('hidden');
            loadingState.classList.add('hidden');
            emptyState.classList.add('hidden');

            // Clear conversation turns container
            if (conversationTurns) {
                conversationTurns.innerHTML = '';
            }

            // Render all stored messages in chronological order
            const messages = data.messages || [];
            messages.forEach(msg => {
                if (msg.role === 'user') {
                    const userEl = createTurnUserElement(msg.content);
                    conversationTurns.appendChild(userEl);
                } else if (msg.role === 'assistant') {
                    const asstEl = createTurnAssistantElement(msg.content, msg.sources, msg.created_at);
                    conversationTurns.appendChild(asstEl);
                }
            });

            // Scroll to the latest message
            if (conversationTurns && conversationTurns.lastElementChild) {
                conversationTurns.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        } catch (err) {
            console.error('Error opening conversation:', err);
        }
    }

    // Start fresh new query / new conversation
    function startNewQuery() {
        clearLoadingTimers();
        activeConversationId = null;
        localStorage.removeItem(STORAGE_ACTIVE_CONV);

        // Update sidebar highlighting
        const items = recentQueriesList.querySelectorAll('.recent-item');
        items.forEach(el => el.classList.remove('active'));

        if (conversationTurns) {
            conversationTurns.innerHTML = '';
        }

        if (workspaceContent) {
            workspaceContent.classList.remove('has-conversation');
        }
        if (errorBox) errorBox.classList.add('hidden');
        if (emptyState) emptyState.classList.add('hidden');
        if (loadingState) loadingState.classList.add('hidden');

        queryInput.value = '';
        autoResizeTextarea(queryInput);
        queryInput.focus();
    }

    // Rename a conversation
    async function renameConversation(convId, currentTitle) {
        const newTitle = prompt('Rename conversation:', currentTitle);
        if (!newTitle || !newTitle.trim() || newTitle.trim() === currentTitle) return;

        try {
            const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle.trim() })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            await loadConversations();
        } catch (err) {
            console.error('Failed to rename conversation:', err);
            alert(`Failed to rename conversation: ${err.message}`);
        }
    }

    // Delete a conversation with confirmation
    async function deleteConversation(convId, title) {
        const confirmed = confirm(`Delete "${title || 'this conversation'}"?\nThis cannot be undone.`);
        if (!confirmed) return;

        try {
            const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            if (activeConversationId === convId) {
                startNewQuery();
            }

            await loadConversations();
        } catch (err) {
            console.error('Failed to delete conversation:', err);
            alert(`Failed to delete conversation: ${err.message}`);
        }
    }

    // Clear all conversations
    async function clearAllConversations() {
        if (conversations.length === 0) return;
        const confirmed = confirm(`Are you sure you want to delete all ${conversations.length} conversation(s)?\nThis cannot be undone.`);
        if (!confirmed) return;

        try {
            for (const conv of conversations) {
                await fetch(`/api/conversations/${encodeURIComponent(conv.id)}`, { method: 'DELETE' });
            }
            startNewQuery();
            await loadConversations();
        } catch (err) {
            console.error('Failed to clear conversations:', err);
            await loadConversations();
        }
    }

    if (recentClearBtn) {
        recentClearBtn.addEventListener('click', clearAllConversations);
    }

    if (clearAllLocalDataBtn) {
        clearAllLocalDataBtn.addEventListener('click', clearAllConversations);
    }

    // ==========================================================================
    // Turn Element Creators
    // ==========================================================================
    function createTurnUserElement(text) {
        const wrapper = document.createElement('div');
        wrapper.className = 'user-turn-wrapper';
        wrapper.innerHTML = `
            <div class="user-turn-bubble">
                <div class="turn-author">You</div>
                <div class="user-turn-text">${escapeHtml(text)}</div>
            </div>
        `;
        return wrapper;
    }

    function createTurnAssistantElement(answerText, sources = [], timestamp = null) {
        const pair = document.createElement('div');
        pair.className = 'turn-pair';

        const timeStr = timestamp ? formatTimestamp(timestamp) : 'Just now';

        // Answer Box
        const answerContainer = document.createElement('div');
        answerContainer.className = 'answer-container';
        answerContainer.innerHTML = `
            <div class="answer-header">
                <div class="answer-title-group">
                    <div class="answer-badge">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect width="18" height="18" x="3" y="3" rx="4" />
                            <path d="M9 9l3 6 3-6" />
                        </svg>
                        <span>FrameFix</span>
                    </div>
                    <span class="answer-timestamp">${escapeHtml(timeStr)}</span>
                </div>

                <div class="answer-actions">
                    <button class="action-btn copy-btn" title="Copy answer to clipboard" type="button">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                        </svg>
                        <span class="copy-text">Copy</span>
                    </button>

                    <div class="feedback-group" aria-label="Answer feedback">
                        <button class="feedback-btn feedback-up" title="Accurate and grounded" aria-label="Helpful" type="button">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M7 10v12"/>
                                <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/>
                            </svg>
                        </button>
                        <button class="feedback-btn feedback-down" title="Needs improvement" aria-label="Not helpful" type="button">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M17 14V2"/>
                                <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            <div class="answer-body markdown-rendered">
                ${renderMarkdownWithCitations(answerText)}
            </div>

            <div class="feedback-toast hidden">
                <span>Thank you for your feedback!</span>
            </div>
        `;

        // Copy full answer button listener
        const copyBtn = answerContainer.querySelector('.copy-btn');
        const copyText = answerContainer.querySelector('.copy-text');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(answerText);
                    copyText.textContent = 'Copied!';
                    copyBtn.style.color = 'var(--color-success)';
                    setTimeout(() => {
                        copyText.textContent = 'Copy';
                        copyBtn.style.color = '';
                    }, 2000);
                } catch (err) {
                    console.error('Copy failed:', err);
                }
            });
        }

        // Feedback buttons
        const upBtn = answerContainer.querySelector('.feedback-up');
        const downBtn = answerContainer.querySelector('.feedback-down');
        const toast = answerContainer.querySelector('.feedback-toast');
        if (upBtn && downBtn) {
            upBtn.addEventListener('click', () => {
                upBtn.classList.add('active');
                downBtn.classList.remove('active');
                if (toast) {
                    toast.textContent = 'Feedback logged: Helpful and grounded.';
                    toast.classList.remove('hidden');
                    setTimeout(() => toast.classList.add('hidden'), 2500);
                }
            });
            downBtn.addEventListener('click', () => {
                downBtn.classList.add('active');
                upBtn.classList.remove('active');
                if (toast) {
                    toast.textContent = 'Feedback logged: Needs refinement.';
                    toast.classList.remove('hidden');
                    setTimeout(() => toast.classList.add('hidden'), 2500);
                }
            });
        }

        attachCodeCopyListenersTo(answerContainer);
        pair.appendChild(answerContainer);

        // Grounding Sources (if any)
        if (sources && sources.length > 0) {
            const sourcesContainer = document.createElement('div');
            sourcesContainer.className = 'sources-container';
            sourcesContainer.innerHTML = `
                <div class="sources-header">
                    <div class="sources-title-group">
                        <span class="sources-label">Grounding Sources</span>
                        <span class="sources-count">${sources.length} sources</span>
                    </div>
                    <div class="sources-controls">
                        <button class="btn-toggle-all" type="button">Expand All</button>
                    </div>
                </div>
                <div class="sources-list"></div>
            `;

            const sourcesListEl = sourcesContainer.querySelector('.sources-list');
            sources.forEach((item, index) => {
                const citationId = `S${index + 1}`;
                const filename = (item.metadata && item.metadata.filename) || 'Unknown Document';
                const chunkIndex = (item.metadata && item.metadata.chunk_index !== undefined) ? item.metadata.chunk_index : 0;
                const distance = item.distance !== undefined && item.distance !== null ? `Distance: ${item.distance.toFixed(3)}` : `Chunk #${chunkIndex}`;

                const card = document.createElement('div');
                card.className = 'source-card open';
                card.dataset.citation = citationId;
                card.innerHTML = `
                    <div class="source-card-header" role="button" aria-expanded="true">
                        <div class="source-meta-left">
                            <span class="source-badge">[${citationId}]</span>
                            <span class="source-filename" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
                        </div>
                        <div class="source-meta-right">
                            <span class="source-score">${distance}</span>
                            <span class="source-chevron">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="6 9 12 15 18 9"/>
                                </svg>
                            </span>
                        </div>
                    </div>
                    <div class="source-card-body">
                        <pre class="source-passage-text"><code>${escapeHtml(item.text)}</code></pre>
                    </div>
                `;

                const header = card.querySelector('.source-card-header');
                header.addEventListener('click', () => {
                    const isOpen = card.classList.toggle('open');
                    header.setAttribute('aria-expanded', isOpen);
                });

                sourcesListEl.appendChild(card);
            });

            // Toggle All button
            const toggleAllBtn = sourcesContainer.querySelector('.btn-toggle-all');
            if (toggleAllBtn) {
                toggleAllBtn.addEventListener('click', () => {
                    const cards = sourcesListEl.querySelectorAll('.source-card');
                    const anyClosed = Array.from(cards).some(card => !card.classList.contains('open'));
                    cards.forEach(card => {
                        if (anyClosed) {
                            card.classList.add('open');
                        } else {
                            card.classList.remove('open');
                        }
                    });
                    toggleAllBtn.textContent = anyClosed ? 'Collapse All' : 'Expand All';
                });
            }

            pair.appendChild(sourcesContainer);
        }

        return pair;
    }

    function createErrorTurnElement(errorMsg, retryQuery) {
        const div = document.createElement('div');
        div.className = 'turn-pair';
        div.innerHTML = `
            <div class="error-alert">
                <div class="error-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" x2="12" y1="8" y2="12"/>
                        <line x1="12" x2="12.01" y1="16" y2="16"/>
                    </svg>
                </div>
                <div class="error-body">
                    <div class="error-title">Local LLM Notice</div>
                    <p class="error-message">${escapeHtml(errorMsg)}</p>
                    <div class="error-actions">
                        <button type="button" class="btn-retry retry-btn">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
                            </svg>
                            <span>Retry Query</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
        const retryBtn = div.querySelector('.retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                executeQuery(retryQuery);
            });
        }
        return div;
    }

    function createSearchTurnElement(results) {
        const pair = document.createElement('div');
        pair.className = 'turn-pair';
        const container = document.createElement('div');
        container.className = 'sources-container';
        container.innerHTML = `
            <div class="sources-header">
                <div class="sources-title-group">
                    <span class="sources-label">Semantic Search Results</span>
                    <span class="sources-count">${results.length} matches</span>
                </div>
                <div class="sources-controls">
                    <button class="btn-toggle-all" type="button">Expand All</button>
                </div>
            </div>
            <div class="sources-list"></div>
        `;

        const sourcesListEl = container.querySelector('.sources-list');
        results.forEach((item, index) => {
            const citationId = `S${index + 1}`;
            const filename = (item.metadata && item.metadata.filename) || 'Unknown Document';
            const chunkIndex = (item.metadata && item.metadata.chunk_index !== undefined) ? item.metadata.chunk_index : 0;
            const distance = item.distance !== undefined && item.distance !== null ? `Distance: ${item.distance.toFixed(3)}` : `Chunk #${chunkIndex}`;

            const card = document.createElement('div');
            card.className = 'source-card open';
            card.dataset.citation = citationId;
            card.innerHTML = `
                <div class="source-card-header" role="button" aria-expanded="true">
                    <div class="source-meta-left">
                        <span class="source-badge">[${citationId}]</span>
                        <span class="source-filename" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
                    </div>
                    <div class="source-meta-right">
                        <span class="source-score">${distance}</span>
                        <span class="source-chevron">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                        </span>
                    </div>
                </div>
                <div class="source-card-body">
                    <pre class="source-passage-text"><code>${escapeHtml(item.text)}</code></pre>
                </div>
            `;

            const header = card.querySelector('.source-card-header');
            header.addEventListener('click', () => {
                const isOpen = card.classList.toggle('open');
                header.setAttribute('aria-expanded', isOpen);
            });

            sourcesListEl.appendChild(card);
        });

        const toggleAllBtn = container.querySelector('.btn-toggle-all');
        if (toggleAllBtn) {
            toggleAllBtn.addEventListener('click', () => {
                const cards = sourcesListEl.querySelectorAll('.source-card');
                const anyClosed = Array.from(cards).some(card => !card.classList.contains('open'));
                cards.forEach(card => {
                    if (anyClosed) {
                        card.classList.add('open');
                    } else {
                        card.classList.remove('open');
                    }
                });
                toggleAllBtn.textContent = anyClosed ? 'Collapse All' : 'Expand All';
            });
        }

        pair.appendChild(container);
        return pair;
    }

    // ==========================================================================
    // Query Execution Flow
    // ==========================================================================
    async function executeQuery(queryText) {
        const query = (queryText || queryInput.value).trim();
        if (!query || isRequestRunning) return;

        lastQuery = query;
        isRequestRunning = true;
        submitBtn.disabled = true;
        if (submitBtnText) submitBtnText.textContent = 'Running...';

        // Transition to conversation view (ChatGPT style)
        if (workspaceContent) {
            workspaceContent.classList.add('has-conversation');
        }

        // Append user turn bubble immediately
        const userTurnEl = createTurnUserElement(query);
        conversationTurns.appendChild(userTurnEl);

        // Clear input box
        queryInput.value = '';
        autoResizeTextarea(queryInput);

        // Reset display states
        errorBox.classList.add('hidden');
        emptyState.classList.add('hidden');
        loadingState.classList.remove('hidden');

        clearLoadingTimers();

        // Update loading messaging based on mode with natural sequence
        if (currentMode === 'ask-mode') {
            loadingMessage.textContent = 'Searching your knowledge base...';
            if (loadingSubmessage) loadingSubmessage.textContent = 'Scanning your documents';

            loadingTimer1 = setTimeout(() => {
                if (isRequestRunning) {
                    loadingMessage.textContent = 'Finding relevant information...';
                    if (loadingSubmessage) loadingSubmessage.textContent = 'Analyzing context passages';
                }
            }, 1200);

            loadingTimer2 = setTimeout(() => {
                if (isRequestRunning) {
                    loadingMessage.textContent = 'Putting your answer together...';
                    if (loadingSubmessage) loadingSubmessage.textContent = 'Synthesizing response';
                }
            }, 2800);
        } else {
            loadingMessage.textContent = 'Searching your knowledge base...';
            if (loadingSubmessage) loadingSubmessage.textContent = 'Scanning your documents';

            loadingTimer1 = setTimeout(() => {
                if (isRequestRunning) {
                    loadingMessage.textContent = 'Finding relevant information...';
                    if (loadingSubmessage) loadingSubmessage.textContent = 'Matching passages';
                }
            }, 1000);
        }

        loadingState.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        const topK = parseInt(topkSelect ? topkSelect.value : '5', 10);
        abortController = new AbortController();

        try {
            if (currentMode === 'ask-mode') {
                const res = await fetch('/api/ask', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: query,
                        top_k: topK,
                        conversation_id: activeConversationId
                    }),
                    signal: abortController.signal
                });

                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.detail || `Server returned error (${res.status})`);
                }

                loadingState.classList.add('hidden');

                if (data.conversation_id) {
                    activeConversationId = data.conversation_id;
                    localStorage.setItem(STORAGE_ACTIVE_CONV, activeConversationId);
                }

                const answer = data.answer || '';
                const sources = data.sources || [];

                if (answer.startsWith('Error generating answer')) {
                    const errEl = createErrorTurnElement(answer, query);
                    conversationTurns.appendChild(errEl);
                } else {
                    const asstEl = createTurnAssistantElement(answer, sources);
                    conversationTurns.appendChild(asstEl);
                }

                if (conversationTurns.lastElementChild) {
                    conversationTurns.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }

                // Refresh sidebar so conversation title & ordering update
                await loadConversations();

            } else {
                // Semantic Search mode
                const res = await fetch('/api/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: query, top_k: topK }),
                    signal: abortController.signal
                });

                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.detail || `Server returned error (${res.status})`);
                }

                loadingState.classList.add('hidden');

                const results = data.results || [];
                if (results.length === 0) {
                    emptyState.classList.remove('hidden');
                } else {
                    const searchEl = createSearchTurnElement(results);
                    conversationTurns.appendChild(searchEl);
                    searchEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }

        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('Query was cancelled');
                loadingState.classList.add('hidden');
                return;
            }

            console.error('Query error:', err);
            loadingState.classList.add('hidden');
            errorMessage.textContent = err.message || 'Failed to communicate with FrameFix API.';
            errorBox.classList.remove('hidden');
            errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } finally {
            clearLoadingTimers();
            isRequestRunning = false;
            submitBtn.disabled = false;
            if (submitBtnText) submitBtnText.textContent = 'Submit';
            abortController = null;
        }
    }

    // ==========================================================================
    // Markdown & Citation Parsing Engine
    // ==========================================================================
    function renderMarkdownWithCitations(rawText) {
        if (!rawText) return '';

        let text = escapeHtml(rawText);

        // 1. Process fenced code blocks with language tags ```lang ... ```
        text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
            const langName = lang || 'plaintext';
            return `
                <div class="code-block-wrapper">
                    <div class="code-block-header">
                        <span class="code-lang-label">${langName}</span>
                        <button class="copy-code-btn" type="button" data-code="${encodeURIComponent(code)}">Copy</button>
                    </div>
                    <pre><code class="language-${langName}">${code}</code></pre>
                </div>
            `;
        });

        // 2. Process inline code `foo`
        text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

        // 3. Process interactive citation badges [S1], [S2]
        text = text.replace(/\[S(\d+)\]/g, (match, num) => {
            return `<button type="button" class="citation-badge" data-citation="S${num}" title="Jump to grounding source S${num}">[S${num}]</button>`;
        });

        // 4. Headers: ## and ###
        text = text.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        text = text.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        text = text.replace(/^# (.*$)/gim, '<h2>$1</h2>');

        // 5. Bold & Italic
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

        // 6. Unordered lists
        text = text.replace(/^\s*[-*]\s+(.*)$/gim, '<li>$1</li>');
        text = text.replace(/(<li>.*<\/li>(\n)?)+/g, '<ul>$&</ul>');

        // 7. Paragraphs & line breaks
        const paragraphs = text.split(/\n{2,}/);
        text = paragraphs.map(p => {
            p = p.trim();
            if (!p) return '';
            if (p.startsWith('<h') || p.startsWith('<div class="code-block-wrapper"') || p.startsWith('<ul') || p.startsWith('<ol')) {
                return p;
            }
            return `<p>${p.replace(/\n/g, '<br>')}</p>`;
        }).join('');

        return text;
    }

    // Citation badge click jump & highlight (scoped to nearest turn pair or entire document)
    document.addEventListener('click', (e) => {
        const badge = e.target.closest('.citation-badge');
        if (!badge) return;

        const citationId = badge.dataset.citation; // e.g. "S1"
        const turnPair = badge.closest('.turn-pair') || document;
        const sourceCard = turnPair.querySelector(`.source-card[data-citation="${citationId}"]`) || document.querySelector(`.source-card[data-citation="${citationId}"]`);
        if (sourceCard) {
            sourceCard.classList.add('open');
            sourceCard.classList.add('highlight');
            sourceCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => {
                sourceCard.classList.remove('highlight');
            }, 2500);
        }
    });

    // Copy Code Block Handler within a container
    function attachCodeCopyListenersTo(container) {
        const copyBtns = container.querySelectorAll('.copy-code-btn');
        copyBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                const code = decodeURIComponent(btn.dataset.code || '');
                try {
                    await navigator.clipboard.writeText(code);
                    const originalText = btn.textContent;
                    btn.textContent = 'Copied!';
                    btn.style.color = 'var(--color-success)';
                    setTimeout(() => {
                        btn.textContent = originalText;
                        btn.style.color = '';
                    }, 2000);
                } catch (e) {
                    console.error('Clipboard copy failed:', e);
                }
            });
        });
    }

    // ==========================================================================
    // UI Event Handlers & Interactions
    // ==========================================================================
    function setupEventListeners() {
        // Mode switching
        function setMode(mode) {
            currentMode = mode;
            if (mode === 'ask-mode') {
                tabAsk.classList.add('active');
                tabAsk.setAttribute('aria-selected', 'true');
                tabSearch.classList.remove('active');
                tabSearch.setAttribute('aria-selected', 'false');

                navAskMode.classList.add('active');
                navSearchMode.classList.remove('active');
                queryInput.placeholder = "Ask anything about internal architecture, outages, or configs...";
            } else {
                tabSearch.classList.add('active');
                tabSearch.setAttribute('aria-selected', 'true');
                tabAsk.classList.remove('active');
                tabAsk.setAttribute('aria-selected', 'false');

                navSearchMode.classList.add('active');
                navAskMode.classList.remove('active');
                queryInput.placeholder = "Search documents by semantic keywords or phrase...";
            }
        }

        tabAsk.addEventListener('click', () => setMode('ask-mode'));
        tabSearch.addEventListener('click', () => setMode('search-mode'));
        navAskMode.addEventListener('click', () => {
            setMode('ask-mode');
            if (workspaceContent && workspaceContent.classList.contains('has-conversation')) {
                startNewQuery();
            }
        });
        navSearchMode.addEventListener('click', () => setMode('search-mode'));

        // New Query Button
        if (btnNewQuery) {
            btnNewQuery.addEventListener('click', startNewQuery);
        }

        // Submit query button
        submitBtn.addEventListener('click', () => executeQuery());

        // Error retry
        if (errorRetryBtn) {
            errorRetryBtn.addEventListener('click', () => {
                if (lastQuery) executeQuery(lastQuery);
            });
        }

        // Suggested question chips
        suggestionChips.forEach(chip => {
            chip.addEventListener('click', () => {
                const query = chip.dataset.query;
                if (query) {
                    queryInput.value = query;
                    autoResizeTextarea(queryInput);
                    executeQuery(query);
                }
            });
        });

        // Knowledge Base Drawer Open/Close
        function openKbDrawer() {
            kbDrawer.classList.remove('hidden');
            kbDrawerBackdrop.classList.remove('hidden');
        }

        function closeKbDrawer() {
            kbDrawer.classList.add('hidden');
            kbDrawerBackdrop.classList.add('hidden');
        }

        navKbBtn.addEventListener('click', openKbDrawer);
        kbDrawerClose.addEventListener('click', closeKbDrawer);
        kbDrawerBackdrop.addEventListener('click', closeKbDrawer);

        // Settings Modal Open/Close
        function openSettingsModal() {
            settingsModal.classList.remove('hidden');
            settingsModalBackdrop.classList.remove('hidden');
        }

        function closeSettingsModal() {
            settingsModal.classList.add('hidden');
            settingsModalBackdrop.classList.add('hidden');
        }

        settingsTriggerBtn.addEventListener('click', openSettingsModal);
        settingsModalClose.addEventListener('click', closeSettingsModal);
        settingsModalDone.addEventListener('click', closeSettingsModal);
        settingsModalBackdrop.addEventListener('click', closeSettingsModal);

        // Sidebar Desktop Collapse
        sidebarCollapseBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });

        // Mobile Sidebar Toggle
        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', () => {
                sidebar.classList.toggle('mobile-open');
            });
        }

        // Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            // Close modals / drawers on Escape
            if (e.key === 'Escape') {
                closeKbDrawer();
                closeSettingsModal();
                sidebar.classList.remove('mobile-open');
            }

            // Quick focus query input on '/' (when not already typing)
            if (e.key === '/' && document.activeElement !== queryInput && !document.activeElement.matches('input, textarea')) {
                e.preventDefault();
                queryInput.focus();
            }

            // Enter submission handling in textarea (Enter to submit, Shift+Enter for newline)
            if (e.target === queryInput && e.key === 'Enter') {
                if (e.ctrlKey || e.metaKey || !e.shiftKey) {
                    e.preventDefault();
                    executeQuery();
                }
            }
        });
    }

    // ==========================================================================
    // Auto-resizing Textarea
    // ==========================================================================
    function setupAutoResizeTextarea() {
        queryInput.addEventListener('input', () => {
            autoResizeTextarea(queryInput);
        });
    }

    function autoResizeTextarea(el) {
        el.style.height = 'auto';
        const newHeight = Math.min(Math.max(el.scrollHeight, 48), 200);
        el.style.height = `${newHeight}px`;
    }

    // ==========================================================================
    // Utilities
    // ==========================================================================
    function formatTimeAgo(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (isNaN(seconds) || seconds < 60) return 'now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h`;
        const days = Math.floor(hours / 24);
        return `${days}d`;
    }

    function formatTimestamp(isoString) {
        if (!isoString) return 'Just now';
        try {
            const d = new Date(isoString);
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch {
            return 'Just now';
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
});
