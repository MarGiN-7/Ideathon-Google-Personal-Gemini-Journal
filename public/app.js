(function () {
  const auth = firebase.auth();
  const googleProvider = new firebase.auth.GoogleAuthProvider();

  let currentUser = null;
  let idToken = null;
  let currentConversationId = null;
  let currentHistory = [];
  let currentView = 'chat';

  const MOOD_EMOJIS = {
    joyful: '😄', peaceful: '😌', grateful: '🙏', hopeful: '🌟',
    content: '😊', neutral: '😐', anxious: '😰', sad: '😢',
    frustrated: '😤', overwhelmed: '😵', angry: '😠', confused: '🤔'
  };

  const DEFAULT_QUICK_PROMPTS = [
    "What's something I'm grateful for today and why?",
    "Describe a challenge I'm facing and how I might approach it",
    "What's a goal I'm working toward and what's my next step?",
    "Reflect on a recent conversation that stuck with me",
    "What does my ideal day look like?"
  ];

  function $(id) { return document.getElementById(id); }

  function showToast(msg, duration = 3000) {
    const t = $('toast');
    t.textContent = msg;
    t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, duration);
  }

  async function apiRequest(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {}),
    };
    const res = await fetch(path, {
      ...options,
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed: ${res.status}`);
    }
    return data;
  }

  function showAuthScreen() {
    $('auth-screen').style.display = 'flex';
    $('app-screen').style.display = 'none';
  }

  function showAppScreen() {
    $('auth-screen').style.display = 'none';
    $('app-screen').style.display = 'flex';
  }

  function getInitials(name) {
    return (name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  }

  function updateUserUI(user) {
    $('user-name').textContent = user.displayName || user.email?.split('@')[0] || 'User';
    $('user-email').textContent = user.email || '';
    const avatar = $('user-avatar');
    if (user.photoURL) {
      avatar.style.backgroundImage = `url(${user.photoURL})`;
      avatar.textContent = '';
    } else {
      avatar.textContent = getInitials(user.displayName || user.email);
    }
  }

  function renderConversationList(conversations) {
    const list = $('conversation-list');
    if (!conversations || conversations.length === 0) {
      list.innerHTML = '<div class="loading-text" style="opacity:0.7">No entries yet.<br>Start journaling above!</div>';
      return;
    }
    list.innerHTML = conversations.map(c => `
      <button class="conv-item ${c.id === currentConversationId ? 'active' : ''}" data-id="${c.id}">
        <div class="conv-title">${escapeHtml(c.title || 'Untitled')}</div>
        <div class="conv-meta">
          <span>${c.messageCount || 0} msgs</span>
          ${c.mood ? `<span>${MOOD_EMOJIS[c.mood.primaryMood] || '📝'}</span>` : ''}
          ${c.updatedAt ? `<span>${formatDate(c.updatedAt)}</span>` : ''}
        </div>
      </button>
    `).join('');

    list.querySelectorAll('.conv-item').forEach(btn => {
      btn.addEventListener('click', () => loadConversation(btn.dataset.id));
    });
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diff = (now - d) / 1000;
      if (diff < 60) return 'just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
      return d.toLocaleDateString();
    } catch { return ''; }
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderMessages(messages) {
    const container = $('messages-container');
    const empty = $('empty-state');

    if (!messages || messages.length === 0) {
      if (currentView === 'chat') {
        container.innerHTML = '';
        container.appendChild(empty);
        empty.style.display = 'block';
        renderQuickPrompts();
      }
      return;
    }

    const userPhoto = currentUser?.photoURL;

    container.innerHTML = messages.map(m => `
      <div class="message ${m.role}">
        <div class="message-avatar" ${m.role === 'user' && userPhoto ? `style="background-image:url('${userPhoto}')"` : ''}>
          ${m.role === 'user' ? (userPhoto ? '' : getInitials(currentUser?.displayName || currentUser?.email)) : 'G'}
        </div>
        <div class="message-bubble">${escapeHtml(m.text)}</div>
      </div>
    `).join('');

    container.scrollTop = container.scrollHeight;
  }

  function renderQuickPrompts() {
    const qp = $('quick-prompts');
    if (!qp) return;
    const shuffled = [...DEFAULT_QUICK_PROMPTS].sort(() => Math.random() - 0.5).slice(0, 4);
    qp.innerHTML = shuffled.map(p => `
      <button class="quick-prompt">${escapeHtml(p)}</button>
    `).join('');
    qp.querySelectorAll('.quick-prompt').forEach(b => {
      b.addEventListener('click', () => {
        $('message-input').value = b.textContent.trim();
        handleSend();
      });
    });
  }

  function addTempUserMessage(text) {
    const container = $('messages-container');
    const empty = $('empty-state');
    if (empty && empty.parentNode) empty.style.display = 'none';

    const div = document.createElement('div');
    div.className = 'message user';
    const userPhoto = currentUser?.photoURL;
    div.innerHTML = `
      <div class="message-avatar" ${userPhoto ? `style="background-image:url('${userPhoto}')"` : ''}>${userPhoto ? '' : getInitials(currentUser?.displayName || currentUser?.email)}</div>
      <div class="message-bubble">${escapeHtml(text)}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function addTypingIndicator() {
    const container = $('messages-container');
    const div = document.createElement('div');
    div.className = 'message model';
    div.id = 'typing-indicator';
    div.innerHTML = `
      <div class="message-avatar">G</div>
      <div class="message-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function removeTypingIndicator() {
    const el = $('typing-indicator');
    if (el) el.remove();
  }

  function replaceTypingWithResponse(text) {
    removeTypingIndicator();
    const container = $('messages-container');
    const div = document.createElement('div');
    div.className = 'message model';
    div.innerHTML = `
      <div class="message-avatar">G</div>
      <div class="message-bubble">${escapeHtml(text)}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  async function handleSend() {
    const input = $('message-input');
    const text = input.value.trim();
    if (!text) return;

    $('send-btn').disabled = true;
    input.value = '';
    input.style.height = 'auto';
    $('empty-state')?.remove();

    addTempUserMessage(text);
    addTypingIndicator();

    try {
      const res = await apiRequest('/api/chat', {
        method: 'POST',
        body: {
          message: text,
          conversationId: currentConversationId,
          history: currentHistory,
        }
      });

      if (!currentConversationId) {
        currentConversationId = res.conversationId;
      }

      currentHistory.push({ role: 'user', parts: [{ text }] });
      currentHistory.push({ role: 'model', parts: [{ text: res.response }] });

      replaceTypingWithResponse(res.response);
      updateChatHeaderUI();
      loadConversations();
    } catch (e) {
      removeTypingIndicator();
      showToast('Error: ' + e.message);
    } finally {
      $('send-btn').disabled = false;
      input.focus();
    }
  }

  async function loadConversations() {
    try {
      const data = await apiRequest('/api/conversations');
      renderConversationList(data.conversations);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadConversation(id) {
    try {
      switchView('chat');
      const data = await apiRequest(`/api/conversations/${id}`);
      currentConversationId = id;
      currentHistory = (data.messages || []).map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      $('chat-title').textContent = data.title || 'Journal Entry';
      $('chat-subtitle').textContent = data.updatedAt ? `Last updated ${formatDate(data.updatedAt)}` : '';
      $('chat-actions').style.display = 'flex';

      renderMoodPanel(data.mood);
      renderSummaryPanel(data.summary);

      renderMessages(data.messages);
      loadConversations();
    } catch (e) {
      showToast('Failed to load conversation');
    }
  }

  function newConversation() {
    currentConversationId = null;
    currentHistory = [];
    $('chat-title').textContent = 'New Journal Entry';
    $('chat-subtitle').textContent = 'Start writing. Your thoughts are safe here.';
    $('chat-actions').style.display = 'none';
    $('mood-panel').style.display = 'none';
    $('summary-panel').style.display = 'none';
    renderMessages([]);
    loadConversations();
    $('message-input').focus();
  }

  function updateChatHeaderUI() {
    if (currentConversationId) {
      $('chat-actions').style.display = 'flex';
      if (currentHistory.length > 1) {
        const firstMsg = currentHistory[0]?.parts?.[0]?.text || '';
        $('chat-title').textContent = firstMsg.slice(0, 50) + (firstMsg.length > 50 ? '...' : '');
      }
    }
  }

  function renderMoodPanel(mood) {
    if (!mood) {
      $('mood-panel').style.display = 'none';
      return;
    }
    const panel = $('mood-panel');
    const filledDots = Math.min(10, Math.max(1, mood.intensity || 5));
    const dots = Array.from({ length: 10 }, (_, i) =>
      `<span class="intensity-dot ${i < filledDots ? 'filled' : ''}"></span>`
    ).join('');

    panel.innerHTML = `
      <div class="mood-display">
        <div class="mood-emoji">${MOOD_EMOJIS[mood.primaryMood] || '📊'}</div>
        <div class="mood-details">
          <h4>${escapeHtml(mood.primaryMood || 'Mood analyzed')}</h4>
          <p>${escapeHtml(mood.summary || '')}</p>
          ${mood.themes?.length ? `<div class="mood-themes">${mood.themes.map(t => `<span class="mood-theme-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
          <div class="intensity-bar">
            <span>Intensity:</span>
            <div class="intensity-dots">${dots}</div>
          </div>
          ${mood.suggestion ? `<p style="margin-top:10px;font-size:12px;opacity:0.8"><strong>Gentle suggestion:</strong> ${escapeHtml(mood.suggestion)}</p>` : ''}
        </div>
      </div>
    `;
    panel.style.display = 'block';
  }

  function renderSummaryPanel(summary) {
    if (!summary) {
      $('summary-panel').style.display = 'none';
      return;
    }
    const panel = $('summary-panel');
    panel.innerHTML = `
      <div class="summary-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        AI Summary
      </div>
      <div class="summary-text">${escapeHtml(summary).replace(/\n/g, '<br>')}</div>
    `;
    panel.style.display = 'block';
  }

  async function handleSummarize() {
    if (!currentConversationId) return;
    try {
      showToast('Generating summary...');
      const res = await apiRequest(`/api/conversations/${currentConversationId}/summarize`, { method: 'POST' });
      renderSummaryPanel(res.summary);
      showToast('Summary generated!');
    } catch (e) {
      showToast('Failed: ' + e.message);
    }
  }

  async function handleMoodAnalysis() {
    if (!currentConversationId) return;
    try {
      showToast('Analyzing mood...');
      const res = await apiRequest(`/api/conversations/${currentConversationId}/analyze-mood`, { method: 'POST' });
      renderMoodPanel(res.mood);
      loadConversations();
      showToast('Mood analyzed!');
    } catch (e) {
      showToast('Failed: ' + e.message);
    }
  }

  async function handleDelete() {
    if (!currentConversationId) return;
    if (!confirm('Delete this journal entry permanently?')) return;
    try {
      await apiRequest(`/api/conversations/${currentConversationId}`, { method: 'DELETE' });
      showToast('Entry deleted');
      newConversation();
    } catch (e) {
      showToast('Failed to delete');
    }
  }

  async function loadDailyPrompts() {
    switchView('prompts');
    const container = $('prompts-container');
    container.innerHTML = '<div class="loading-text">Generating today\'s prompts...</div>';
    try {
      const data = await apiRequest('/api/daily-prompts');
      container.innerHTML = data.prompts.map((p, i) => `
        <div class="prompt-card" data-prompt="${escapeHtml(p)}">
          <div class="prompt-number">Prompt ${i + 1}</div>
          <div class="prompt-text">${escapeHtml(p)}</div>
        </div>
      `).join('');
      container.querySelectorAll('.prompt-card').forEach(card => {
        card.addEventListener('click', () => {
          const text = card.dataset.prompt;
          switchView('chat');
          newConversation();
          setTimeout(() => {
            $('message-input').value = text + '\n\n';
            $('message-input').focus();
          }, 100);
        });
      });
    } catch (e) {
      container.innerHTML = `<div class="loading-text" style="color:var(--danger)">Failed: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadStats() {
    switchView('stats');
    const container = $('stats-container');
    container.innerHTML = '<div class="loading-text">Loading stats...</div>';
    try {
      const data = await apiRequest('/api/stats');
      const moodEntries = Object.entries(data.moodCounts || {});
      const maxMood = moodEntries.length ? Math.max(...moodEntries.map(([, v]) => v)) : 0;

      container.innerHTML = `
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${data.totalConversations || 0}</div>
            <div class="stat-label">Journal Entries</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${data.totalEntries || 0}</div>
            <div class="stat-label">Total Messages</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${data.summarizedCount || 0}</div>
            <div class="stat-label">Summarized</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${moodEntries.length}</div>
            <div class="stat-label">Moods Tracked</div>
          </div>
        </div>
        ${moodEntries.length ? `
          <div class="mood-chart-title">Mood Distribution</div>
          <div class="mood-bars">
            ${moodEntries.map(([mood, count]) => `
              <div class="mood-bar-row">
                <div class="mood-bar-label">${MOOD_EMOJIS[mood] || ''} ${escapeHtml(mood)}</div>
                <div class="mood-bar-track">
                  <div class="mood-bar-fill" style="width:${maxMood ? (count / maxMood * 100) : 0}%"></div>
                </div>
                <div class="mood-bar-count">${count}</div>
              </div>
            `).join('')}
          </div>
        ` : '<p style="text-align:center;color:var(--text-muted);margin-top:40px">Analyze mood in entries to see distribution patterns.</p>'}
      `;
    } catch (e) {
      container.innerHTML = `<div class="loading-text" style="color:var(--danger)">Failed: ${escapeHtml(e.message)}</div>`;
    }
  }

  function switchView(view) {
    currentView = view;
    ['view-chat', 'view-prompts', 'view-stats'].forEach(id => {
      $(id).style.display = 'none';
    });
    $(`view-${view}`).style.display = 'flex';

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navMap = { prompts: 'nav-prompts', stats: 'nav-stats' };
    if (navMap[view]) $(navMap[view]).classList.add('active');
  }

  function setupAuthHandlers() {
    $('signin-btn').addEventListener('click', () => {
      const email = $('email-input').value.trim();
      const pw = $('password-input').value;
      if (!email || !pw) { showAuthError('Enter email and password'); return; }
      auth.signInWithEmailAndPassword(email, pw).catch(e => showAuthError(e.message));
    });

    $('signup-btn').addEventListener('click', () => {
      const email = $('email-input').value.trim();
      const pw = $('password-input').value;
      if (!email || !pw) { showAuthError('Enter email and password'); return; }
      if (pw.length < 6) { showAuthError('Password must be at least 6 characters'); return; }
      auth.createUserWithEmailAndPassword(email, pw).catch(e => showAuthError(e.message));
    });

    $('google-signin').addEventListener('click', () => {
      auth.signInWithPopup(googleProvider).catch(e => showAuthError(e.message));
    });

    $('signout-btn').addEventListener('click', () => auth.signOut());
  }

  function showAuthError(msg) {
    const el = $('auth-error');
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 5000);
  }

  function setupAppHandlers() {
    $('new-chat-btn').addEventListener('click', newConversation);
    $('nav-prompts').addEventListener('click', loadDailyPrompts);
    $('nav-stats').addEventListener('click', loadStats);

    const input = $('message-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    input.addEventListener('input', () => {
      $('send-btn').disabled = !input.value.trim();
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    });
    $('send-btn').addEventListener('click', handleSend);

    $('btn-summarize').addEventListener('click', handleSummarize);
    $('btn-mood').addEventListener('click', handleMoodAnalysis);
    $('btn-delete').addEventListener('click', handleDelete);
  }

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      currentUser = null;
      idToken = null;
      showAuthScreen();
      return;
    }

    currentUser = user;
    try {
      idToken = await user.getIdToken(true);
    } catch (e) {
      console.error('Token refresh failed', e);
    }

    updateUserUI(user);
    showAppScreen();
    newConversation();
    loadConversations();
  });

  document.addEventListener('DOMContentLoaded', () => {
    setupAuthHandlers();
    setupAppHandlers();
  });
})();
