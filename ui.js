/**
 * ui.js - UI 交互模块
 * 灵动岛、设置面板、角色通讯录、角色编辑、全屏聊天
 */

const UI = (() => {
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let isExpanded = false;
  let isFullscreen = false;

  // 角色编辑状态
  let editingCharId = null;       // null = 新建, string = 编辑
  let editingAvatarBase64 = '';   // 临时头像数据

  const DEFAULT_AVATAR_SVG = '<svg class="default-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></svg>';

  const isElectron = !!(window.electronAPI && window.electronAPI.isElectron);

  // ========== Init ==========
  function init() {
    setupDynamicIsland();
    setupSettings();
    setupContacts();
    setupCharEdit();
    setupFullscreenMode();
    syncVisionButton();

    if (!Store.isOnboarded()) {
      // First time: show onboarding, hide island
      document.getElementById('dynamic-island').style.display = 'none';
      document.getElementById('main-bg').style.display = 'none';
      if (isElectron) {
        window.electronAPI.resizeWindow('onboarding');
      }
      showOnboarding();
    } else {
      // Returning user: show island directly
      if (isElectron) {
        document.body.classList.add('electron-mode');
        document.getElementById('main-bg').style.display = 'none';
        window.electronAPI.resizeWindow('island');
      }
      syncActiveCharacterUI();
      loadAPIConfigToUI();
      loadSettingsToUI();
    }
  }

  // ========== Onboarding ==========
  let obAvatarBase64 = '';

  function showOnboarding() {
    const ob = document.getElementById('onboarding');
    ob.classList.remove('hidden');

    // Step navigation
    ob.querySelectorAll('.onboarding-next, .onboarding-back').forEach(btn => {
      btn.addEventListener('click', () => {
        const goto = parseInt(btn.dataset.goto);
        goToStep(goto);
      });
    });

    // Avatar upload
    document.getElementById('ob-avatar-btn').addEventListener('click', () => {
      document.getElementById('ob-avatar-file').click();
    });
    document.getElementById('ob-avatar-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file || !file.type.startsWith('image/')) return;
      if (file.size > 2 * 1024 * 1024) { alert('Image must be under 2MB'); return; }
      const reader = new FileReader();
      reader.onload = (ev) => {
        obAvatarBase64 = ev.target.result;
        const preview = document.getElementById('ob-avatar-preview');
        preview.style.backgroundImage = `url(${obAvatarBase64})`;
        preview.innerHTML = '';
      };
      reader.readAsDataURL(file);
    });

    // Fetch models button
    document.getElementById('ob-fetch-models').addEventListener('click', () => {
      const key = document.getElementById('ob-api-key').value.trim();
      const url = document.getElementById('ob-base-url').value.trim();
      const select = document.getElementById('ob-model-name');
      const btn = document.getElementById('ob-fetch-models');
      fetchAndPopulateModels(key, url, select, btn);
    });

    // Finish button
    document.getElementById('ob-finish').addEventListener('click', finishOnboarding);
  }

  function goToStep(n) {
    const ob = document.getElementById('onboarding');
    ob.querySelectorAll('.onboarding-step').forEach(s => s.classList.remove('active'));
    const target = ob.querySelector(`.onboarding-step[data-step="${n}"]`);
    if (target) target.classList.add('active');

    ob.querySelectorAll('.onboarding-dots .dot').forEach(d => d.classList.remove('active'));
    const dot = ob.querySelector(`.dot[data-dot="${n}"]`);
    if (dot) dot.classList.add('active');
  }

  function finishOnboarding() {
    // Save API config
    const apiKey = document.getElementById('ob-api-key').value.trim();
    const baseURL = document.getElementById('ob-base-url').value.trim();
    const modelName = document.getElementById('ob-model-name').value.trim();
    if (apiKey || baseURL || modelName) {
      Store.saveAPIConfig({ apiKey, baseURL, modelName });
    }

    // Create first character
    const charName = document.getElementById('ob-char-name').value.trim() || 'Companion';
    const personality = document.getElementById('ob-char-personality').value.trim();
    const background = document.getElementById('ob-char-background').value.trim();
    Store.addCharacter({
      name: charName,
      avatar: obAvatarBase64,
      personality,
      background,
      nickname: ''
    });

    // Mark onboarding done
    Store.setOnboarded();

    // Fade out onboarding, reveal island
    const ob = document.getElementById('onboarding');
    ob.classList.add('fade-out');
    setTimeout(() => {
      ob.classList.add('hidden');
      ob.classList.remove('fade-out');
      document.getElementById('dynamic-island').style.display = '';

      if (isElectron) {
        // Switch to island mode: small window, hide bg
        document.body.classList.add('electron-mode');
        document.getElementById('main-bg').style.display = 'none';
        window.electronAPI.resizeWindow('island');
      } else {
        document.getElementById('main-bg').style.display = '';
      }

      syncActiveCharacterUI();
      loadAPIConfigToUI();
      loadSettingsToUI();
    }, 600);
  }

  // ========== Dynamic Island Drag ==========
  function setupDynamicIsland() {
    const island = document.getElementById('dynamic-island');
    const avatarBtn = document.getElementById('island-avatar-btn');

    island.addEventListener('mousedown', startDrag);
    island.addEventListener('touchstart', startDragTouch, { passive: false });
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('touchmove', onDragTouch, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);

    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!hasMoved) toggleIslandExpand();
    });

    document.getElementById('btn-contacts').addEventListener('click', (e) => {
      e.stopPropagation();
      openContacts();
    });

    document.getElementById('btn-settings').addEventListener('click', (e) => {
      e.stopPropagation();
      openSettings();
    });

    document.getElementById('btn-fullscreen').addEventListener('click', (e) => {
      e.stopPropagation();
      enterFullscreen();
    });

    document.getElementById('btn-vision-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleVision();
    });

    // Phone mode
    document.getElementById('btn-phone-mode').addEventListener('click', (e) => {
      e.stopPropagation();
      enterPhoneMode();
    });

    // Mini reply send
    document.getElementById('island-reply-send').addEventListener('click', (e) => {
      e.stopPropagation();
      sendIslandReply();
    });

    // Mini reply close
    document.getElementById('island-reply-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeIslandReply();
    });

    // Enter to send in reply input
    document.getElementById('island-reply-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendIslandReply();
      }
    });
  }

  let dragStartX = 0;
  let dragStartY = 0;
  const DRAG_THRESHOLD = 5;
  let hasMoved = false;

  function startDrag(e) {
    const island = document.getElementById('dynamic-island');
    if (e.target.closest('#island-avatar-btn') || e.target.closest('.island-action-btn')) return;
    isDragging = true;
    hasMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = island.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    lastDragX = e.clientX;
    lastDragY = e.clientY;
    island.style.transition = 'none';
    island.classList.add('dragging');
  }

  function startDragTouch(e) {
    const island = document.getElementById('dynamic-island');
    if (e.target.closest('#island-avatar-btn') || e.target.closest('.island-action-btn')) return;
    const touch = e.touches[0];
    isDragging = true;
    hasMoved = false;
    dragStartX = touch.clientX;
    dragStartY = touch.clientY;
    const rect = island.getBoundingClientRect();
    dragOffsetX = touch.clientX - rect.left;
    dragOffsetY = touch.clientY - rect.top;
    lastDragX = touch.clientX;
    lastDragY = touch.clientY;
    island.style.transition = 'none';
    island.classList.add('dragging');
  }

  function onDrag(e) {
    if (!isDragging) return;
    if (Math.abs(e.clientX - dragStartX) > DRAG_THRESHOLD || Math.abs(e.clientY - dragStartY) > DRAG_THRESHOLD) hasMoved = true;
    moveIsland(e.clientX, e.clientY);
  }

  function onDragTouch(e) {
    if (!isDragging) return;
    e.preventDefault();
    const t = e.touches[0];
    if (Math.abs(t.clientX - dragStartX) > DRAG_THRESHOLD || Math.abs(t.clientY - dragStartY) > DRAG_THRESHOLD) hasMoved = true;
    moveIsland(t.clientX, t.clientY);
  }

  let lastDragX = 0;
  let lastDragY = 0;

  function moveIsland(cx, cy) {
    if (isElectron) {
      // Move the OS window itself
      const dx = cx - lastDragX;
      const dy = cy - lastDragY;
      lastDragX = cx;
      lastDragY = cy;
      if (dx !== 0 || dy !== 0) {
        window.electronAPI.moveWindow(dx, dy);
      }
    } else {
      const island = document.getElementById('dynamic-island');
      let x = Math.max(0, Math.min(cx - dragOffsetX, window.innerWidth - island.offsetWidth));
      let y = Math.max(0, Math.min(cy - dragOffsetY, window.innerHeight - island.offsetHeight));
      island.style.left = x + 'px';
      island.style.top = y + 'px';
      island.style.transform = 'none';
    }
  }

  function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    const island = document.getElementById('dynamic-island');
    island.classList.remove('dragging');
    island.style.transition = '';
    // Reset hasMoved after click events have fired (click fires after mouseup)
    setTimeout(() => { hasMoved = false; }, 0);
  }

  // ========== Island Expand ==========
  function toggleIslandExpand() {
    const island = document.getElementById('dynamic-island');
    const exp = document.getElementById('island-expanded');
    isExpanded = !isExpanded;
    if (isExpanded) {
      island.classList.add('expanded');
      exp.classList.remove('hidden');
      setTimeout(() => exp.classList.add('show'), 10);
    } else {
      exp.classList.remove('show');
      setTimeout(() => { exp.classList.add('hidden'); island.classList.remove('expanded'); }, 300);
    }
  }

  function collapseIsland() {
    if (isExpanded) toggleIslandExpand();
  }

  // ========== Multi-Bubble System (支持 [NEXT] 拆条, 最多3个堆叠) ==========
  const MAX_BUBBLES = 3;
  let activeBubbles = [];     // { el, timer }
  let bubbleQueue = [];       // 拆条队列
  let bubbleQueueTimer = null;
  let isChatting = false;     // 用户在聊天交互中

  function showBubble(text) {
    // 处理 [NEXT] 拆条
    const parts = text.split(/\[NEXT\]/i).map(s => s.trim()).filter(Boolean);

    if (parts.length <= 1) {
      showSingleBubble(parts[0] || text);
    } else {
      // 逐条显示，间隔 1.5~2.5 秒模拟打字节奏
      showSingleBubble(parts[0]);
      bubbleQueue = parts.slice(1);
      scheduleBubbleQueue();
    }
  }

  function scheduleBubbleQueue() {
    if (bubbleQueueTimer) clearTimeout(bubbleQueueTimer);
    if (bubbleQueue.length === 0) return;

    const delay = 1500 + Math.random() * 1000; // 1.5~2.5 秒
    bubbleQueueTimer = setTimeout(() => {
      const next = bubbleQueue.shift();
      if (next) {
        showSingleBubble(next);
        addMessageToChat('ai', next);
        scheduleBubbleQueue();
      }
    }, delay);
  }

  function showSingleBubble(text) {
    const container = document.getElementById('bubble-container');

    // Position container below the island
    const island = document.getElementById('dynamic-island');
    if (island) {
      const rect = island.getBoundingClientRect();
      container.style.top = (rect.bottom + 10) + 'px';
      container.style.left = (rect.left + rect.width / 2) + 'px';
    }

    // If at max, remove the oldest bubble immediately
    while (activeBubbles.length >= MAX_BUBBLES) {
      removeBubble(activeBubbles[0]);
    }

    // Remove reply button from all existing bubbles
    activeBubbles.forEach(b => {
      const btn = b.el.querySelector('.bubble-reply-btn');
      if (btn) btn.remove();
    });

    // Create new bubble element
    const el = document.createElement('div');
    el.className = 'bubble-item';
    el.innerHTML = `
      <span class="bubble-item-text">${escapeHtml(text)}</span>
      <button class="bubble-reply-btn" aria-label="Reply">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
        </svg>
      </button>
    `;

    // Reply button handler
    const replyBtn = el.querySelector('.bubble-reply-btn');
    replyBtn.addEventListener('click', () => {
      openIslandReply();
    });

    container.appendChild(el);

    // Trigger show animation
    requestAnimationFrame(() => {
      el.classList.add('show');
    });

    // Set independent fade-out timer
    const dur = (Store.getSettings().bubbleDuration || 8) * 1000;
    const timer = setTimeout(() => {
      if (!isChatting) {
        fadeOutBubble(bubbleObj);
      }
    }, dur);

    const bubbleObj = { el, timer };
    activeBubbles.push(bubbleObj);
  }

  function fadeOutBubble(bubbleObj) {
    const idx = activeBubbles.indexOf(bubbleObj);
    if (idx === -1) return;
    bubbleObj.el.classList.remove('show');
    bubbleObj.el.classList.add('fade-out');
    clearTimeout(bubbleObj.timer);
    setTimeout(() => {
      if (bubbleObj.el.parentNode) bubbleObj.el.remove();
      const i = activeBubbles.indexOf(bubbleObj);
      if (i !== -1) activeBubbles.splice(i, 1);
    }, 300);
  }

  function removeBubble(bubbleObj) {
    clearTimeout(bubbleObj.timer);
    if (bubbleObj.el.parentNode) bubbleObj.el.remove();
    const idx = activeBubbles.indexOf(bubbleObj);
    if (idx !== -1) activeBubbles.splice(idx, 1);
  }

  // System toast: simple status message (not a chat bubble)
  let systemToastTimer = null;
  function showSystemToast(text) {
    let toast = document.getElementById('system-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'system-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('show');
    if (systemToastTimer) clearTimeout(systemToastTimer);
    systemToastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

  function hideBubble() {
    // Clear all active bubbles
    [...activeBubbles].forEach(b => removeBubble(b));
    activeBubbles = [];
    if (bubbleQueueTimer) { clearTimeout(bubbleQueueTimer); bubbleQueueTimer = null; }
    bubbleQueue = [];
  }

  // ========== Island Reply (迷你回复框) ==========
  let msgBuffer = [];           // 短消息缓冲
  let msgBufferTimer = null;    // 缓冲计时器
  const MSG_BUFFER_DELAY = 15000; // 15 秒缓冲

  function openIslandReply() {
    isChatting = true;

    // 暂停 Vision：整个聊天期间都不截屏
    if (Vision.getStatus().active) {
      Vision.pause();
    }

    // 隐藏所有气泡，显示输入框
    hideBubble();

    const reply = document.getElementById('island-reply');
    reply.classList.remove('hidden');
    setTimeout(() => reply.classList.add('show'), 10);

    const input = document.getElementById('island-reply-input');
    input.value = '';
    input.focus();
  }

  function closeIslandReply() {
    const reply = document.getElementById('island-reply');
    reply.classList.remove('show');
    setTimeout(() => reply.classList.add('hidden'), 300);

    hideBubble();

    // 如果缓冲区里没有待发的消息，结束聊天状态，恢复 Vision
    if (msgBuffer.length === 0) {
      isChatting = false;
      if (Vision.getStatus().active) {
        Vision.resume();
      }
    }
    // 如果有缓冲消息，等缓冲计时器处理完后才恢复
  }

  async function sendIslandReply() {
    const input = document.getElementById('island-reply-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.focus(); // 保持输入框打开，让用户可以继续发

    addMessageToChat('user', text);

    // 加入缓冲区
    msgBuffer.push(text);

    // 重置缓冲计时器（每次发消息重新等 15 秒）
    if (msgBufferTimer) clearTimeout(msgBufferTimer);
    msgBufferTimer = setTimeout(() => {
      flushMsgBuffer();
    }, MSG_BUFFER_DELAY);
  }

  async function flushMsgBuffer() {
    if (msgBuffer.length === 0) return;

    // 把缓冲区的消息合成一条
    const combined = msgBuffer.join('\n');
    msgBuffer = [];
    msgBufferTimer = null;

    if (!API.isConfigured()) {
      showBubble('Connection not set up yet.');
      finishChatSession();
      return;
    }

    // 发给 AI（带屏幕上下文）
    const screenshot = Vision.getStatus().active ? Vision.getCurrentPreview() : null;
    const result = await API.chat(combined, screenshot);
    if (result && result.ok && result.text) {
      // 拆条处理：第一条记录到聊天+气泡，后续条由 showBubble 内部的队列处理
      const cleanText = result.text.replace(/\[SILENT\]/gi, '').trim();
      if (cleanText) {
        const firstPart = cleanText.split(/\[NEXT\]/i)[0].trim();
        if (firstPart) addMessageToChat('ai', firstPart);
        showBubble(cleanText);
      }
    } else {
      const errMsg = result?.error || 'Something went wrong.';
      showBubble(`(${errMsg})`);
    }

    // 发完后如果输入框已关闭，结束聊天状态
    const reply = document.getElementById('island-reply');
    if (reply.classList.contains('hidden') || !reply.classList.contains('show')) {
      finishChatSession();
    }
  }

  function finishChatSession() {
    isChatting = false;
    if (Vision.getStatus().active) {
      Vision.resume();
    }
  }

  // ========== Vision ==========
  let visionPreviewTimer = null;

  async function toggleVision() {
    const btn = document.getElementById('btn-vision-toggle');
    const status = Vision.getStatus();

    if (status.active) {
      Vision.stop();
      btn.classList.remove('active');
      updateVisionPreview();
      showSystemToast('已关闭屏幕共享');
    } else {
      const result = await Vision.start(onVisionFrame);
      if (result.ok) {
        btn.classList.add('active');
        startPreviewRefresh();
        showSystemToast('已开启屏幕共享');
      } else {
        const msg = result.reason === 'denied'
          ? '屏幕共享被拒绝了'
          : '当前环境不支持屏幕共享';
        showSystemToast(msg);
      }
    }
    collapseIsland();
  }

  async function onVisionFrame(base64, dynamicHint) {
    updateVisionPreview();
    if (!API.isConfigured() || API.isBusy()) return;
    if (!Store.getActiveCharacter()) return;
    if (isChatting) return;

    const result = await API.commentOnScreen(base64, dynamicHint);

    if (result && result.ok && result.silent) return;

    if (result && result.ok && result.text) {
      const cleanText = result.text.replace(/\[SILENT\]/gi, '').trim();
      if (!cleanText) return;
      // 第一条记录到聊天历史
      const firstPart = cleanText.split(/\[NEXT\]/i)[0].trim();
      if (firstPart) addMessageToChat('ai', firstPart);
      showBubble(cleanText);
      // 系统通知
      notifyUser(firstPart);
    }
  }

  function notifyUser(text) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
      return;
    }
    if (Notification.permission !== 'granted') return;
    const char = Store.getActiveCharacter();
    const title = char ? (char.nickname || char.name) : '数独2048';
    new Notification(title, { body: text, silent: false });
  }

  function updateVisionPreview() {
    const img = document.getElementById('vision-preview-img');
    const placeholder = document.getElementById('vision-preview-placeholder');
    if (!img || !placeholder) return;

    const status = Vision.getStatus();
    if (status.active) {
      const src = Vision.getCurrentPreview();
      if (src) {
        img.src = src;
        img.hidden = false;
        placeholder.hidden = true;
      }
    } else {
      img.hidden = true;
      img.src = '';
      placeholder.hidden = false;
    }
  }

  function startPreviewRefresh() {
    if (visionPreviewTimer) clearInterval(visionPreviewTimer);
    visionPreviewTimer = setInterval(() => {
      if (!Vision.getStatus().active) {
        clearInterval(visionPreviewTimer);
        visionPreviewTimer = null;
        updateVisionPreview();
        return;
      }
      updateVisionPreview();
    }, 3000);
  }

  // ========== Fetch Models (shared) ==========
  async function fetchAndPopulateModels(apiKey, baseURL, selectEl, btnEl) {
    if (!apiKey || !baseURL) {
      alert('Please fill in both API Key and Base URL first.');
      return;
    }

    btnEl.classList.add('loading');
    const savedModel = selectEl.value;

    const result = await API.fetchModels(apiKey, baseURL);

    btnEl.classList.remove('loading');

    if (!result.ok) {
      alert('Failed to fetch models: ' + result.error);
      return;
    }

    // Populate select
    selectEl.innerHTML = '';
    result.models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      selectEl.appendChild(opt);
    });
    selectEl.disabled = false;

    // Restore previous selection if still available
    if (savedModel && result.models.includes(savedModel)) {
      selectEl.value = savedModel;
    }
  }

  // ========== Overlay Helpers ==========
  let openOverlayCount = 0;

  function openOverlay(id) {
    const el = document.getElementById(id);
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('show'), 10);
    collapseIsland();

    openOverlayCount++;
    if (isElectron && openOverlayCount === 1) {
      window.electronAPI.resizeWindow('panel');
    }
  }

  function closeOverlay(id) {
    const el = document.getElementById(id);
    el.classList.remove('show');
    setTimeout(() => {
      el.classList.add('hidden');
      openOverlayCount = Math.max(0, openOverlayCount - 1);
      if (isElectron && openOverlayCount === 0) {
        window.electronAPI.resizeWindow('island');
      }
    }, 350);
  }

  // ========== Settings (API + General) ==========
  function setupSettings() {
    const overlay = document.getElementById('settings-overlay');
    document.getElementById('settings-close').addEventListener('click', () => closeOverlay('settings-overlay'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay('settings-overlay'); });
    document.getElementById('settings-save').addEventListener('click', saveAllSettings);

    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const t = tab.dataset.tab;
        document.querySelectorAll('.settings-tab').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('#settings-overlay .settings-panel').forEach(x => x.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + t).classList.add('active');
      });
    });

    // Profile avatar upload in settings
    document.getElementById('settings-profile-avatar-btn').addEventListener('click', () => {
      document.getElementById('settings-profile-avatar-file').click();
    });
    document.getElementById('settings-profile-avatar-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const size = Math.min(img.width, img.height, 256);
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d');
          const sx = (img.width - size) / 2, sy = (img.height - size) / 2;
          ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
          const base64 = canvas.toDataURL('image/jpeg', 0.8);
          const el = document.getElementById('settings-profile-avatar');
          el.style.backgroundImage = `url(${base64})`;
          el.innerHTML = '';
          el.dataset.avatar = base64;
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    // Data export/import in settings
    document.getElementById('settings-export-btn').addEventListener('click', () => {
      try {
        const data = Store.exportAllData();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sudoku2048-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        alert('数据导出成功！');
      } catch (err) {
        alert('导出失败: ' + err.message);
      }
    });
    document.getElementById('settings-import-btn').addEventListener('click', () => {
      document.getElementById('settings-import-file').click();
    });
    document.getElementById('settings-import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!confirm(`确定要导入数据吗？\n包含 ${data.characters?.length || 0} 个角色\n当前数据将被覆盖。`)) return;
        Store.importAllData(data);
        alert('数据导入成功！应用将重新加载。');
        location.reload();
      } catch (err) {
        alert('导入失败: ' + err.message);
      }
    });

    // Context count slider real-time display
    const ctxSlider = document.getElementById('input-context-count');
    if (ctxSlider) {
      ctxSlider.addEventListener('input', () => {
        const val = document.getElementById('context-count-value');
        if (val) val.textContent = ctxSlider.value;
      });
    }

    // Check update in settings
    document.getElementById('settings-check-update-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('settings-update-status');
      const btn = document.getElementById('settings-check-update-btn');
      if (!window.electronAPI) {
        statusEl.textContent = '仅支持桌面客户端更新';
        return;
      }
      btn.disabled = true;
      statusEl.textContent = '正在检查更新...';
      try {
        const result = await window.electronAPI.checkUpdate();
        if (!result.ok) {
          statusEl.textContent = '检查失败: ' + (result.error || '网络错误');
          btn.disabled = false;
          return;
        }
        if (result.upToDate) {
          statusEl.textContent = '已是最新版本 (v' + result.version + ')';
          btn.disabled = false;
          return;
        }
        statusEl.textContent = '发现新版本 v' + result.remoteVersion + '（当前 v' + result.localVersion + '），正在更新...';
        const updateResult = await window.electronAPI.doUpdate();
        if (updateResult.ok) {
          statusEl.textContent = '更新完成！已更新 ' + updateResult.updated + ' 个文件，请重启应用。';
          btn.textContent = '重启应用';
          btn.disabled = false;
          btn.onclick = () => location.reload();
        } else {
          statusEl.textContent = '更新失败: ' + (updateResult.error || '未知错误');
          btn.disabled = false;
        }
      } catch (err) {
        statusEl.textContent = '更新出错: ' + err.message;
        btn.disabled = false;
      }
    });

    // Fetch models button in settings
    document.getElementById('settings-fetch-models').addEventListener('click', () => {
      const key = document.getElementById('input-api-key').value.trim();
      const url = document.getElementById('input-base-url').value.trim();
      const select = document.getElementById('input-model-name');
      const btn = document.getElementById('settings-fetch-models');
      fetchAndPopulateModels(key, url, select, btn);
    });
  }

  function openSettings() {
    loadAPIConfigToUI();
    loadSettingsToUI();
    loadProfileToSettingsUI();
    updateVisionPreview();
    openOverlay('settings-overlay');
  }

  function loadProfileToSettingsUI() {
    const profile = Store.getUserProfile();
    const avatarEl = document.getElementById('settings-profile-avatar');
    if (profile.avatar) {
      avatarEl.style.backgroundImage = `url(${profile.avatar})`;
      avatarEl.innerHTML = '';
      avatarEl.dataset.avatar = profile.avatar;
    }
    document.getElementById('settings-profile-nickname').value = profile.nickname || '';
    document.getElementById('settings-profile-identity').value = profile.identity || '';
  }

  function saveAllSettings() {
    Store.saveAPIConfig({
      apiKey: document.getElementById('input-api-key').value.trim(),
      baseURL: document.getElementById('input-base-url').value.trim(),
      modelName: document.getElementById('input-model-name').value.trim()
    });
    Store.saveSettings({
      captureInterval: parseInt(document.getElementById('input-interval').value) || 20,
      privacyMode: document.getElementById('input-privacy').checked,
      dynamicFrequency: document.getElementById('input-dynamic-freq').checked,
      bubbleDuration: parseInt(document.getElementById('input-bubble-duration').value) || 5,
      contextCount: parseInt(document.getElementById('input-context-count').value) || 25
    });
    // Save profile
    const avatarEl = document.getElementById('settings-profile-avatar');
    Store.saveUserProfile({
      avatar: avatarEl.dataset.avatar || Store.getUserProfile().avatar || '',
      nickname: document.getElementById('settings-profile-nickname').value.trim(),
      identity: document.getElementById('settings-profile-identity').value.trim()
    });

    showSaveToast();
    closeOverlay('settings-overlay');
  }

  function loadAPIConfigToUI() {
    const c = Store.getAPIConfig();
    const k = document.getElementById('input-api-key');
    const u = document.getElementById('input-base-url');
    const m = document.getElementById('input-model-name');
    if (k) k.value = c.apiKey || '';
    if (u) u.value = c.baseURL || '';
    if (m) {
      // m is a <select> now
      if (c.modelName) {
        // If no options yet or saved model not in list, add it
        const hasOpt = Array.from(m.options).some(o => o.value === c.modelName);
        if (!hasOpt) {
          m.innerHTML = '';
          const opt = document.createElement('option');
          opt.value = c.modelName;
          opt.textContent = c.modelName;
          m.appendChild(opt);
        }
        m.value = c.modelName;
        m.disabled = false;
      }
    }
  }

  function loadSettingsToUI() {
    const s = Store.getSettings();
    const i = document.getElementById('input-interval');
    const p = document.getElementById('input-privacy');
    const d = document.getElementById('input-dynamic-freq');
    const b = document.getElementById('input-bubble-duration');
    const ctx = document.getElementById('input-context-count');
    const ctxVal = document.getElementById('context-count-value');
    if (i) i.value = s.captureInterval || 20;
    if (p) p.checked = s.privacyMode || false;
    if (d) d.checked = s.dynamicFrequency !== false;
    if (b) b.value = s.bubbleDuration || 5;
    if (ctx) { ctx.value = s.contextCount || 25; if (ctxVal) ctxVal.textContent = ctx.value; }
  }

  function showSaveToast() {
    const toast = document.getElementById('save-toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // ========== Contacts Panel ==========
  function setupContacts() {
    const overlay = document.getElementById('contacts-overlay');
    document.getElementById('contacts-close').addEventListener('click', () => closeOverlay('contacts-overlay'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay('contacts-overlay'); });
    document.getElementById('contacts-add-btn').addEventListener('click', () => openCharEdit(null));
  }

  function openContacts() {
    renderContactsList();
    openOverlay('contacts-overlay');
  }

  function renderContactsList() {
    const container = document.getElementById('contacts-list');
    const chars = Store.getCharacters();
    const activeId = Store.getActiveCharacterId();

    if (chars.length === 0) {
      container.innerHTML = `
        <div class="contacts-empty">
          <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
          <p>No companions yet.<br>Tap + to create your first one.</p>
        </div>`;
      return;
    }

    container.innerHTML = chars.map(c => {
      const isActive = c.id === activeId;
      const avatarContent = c.avatar
        ? ''
        : DEFAULT_AVATAR_SVG;
      const avatarStyle = c.avatar
        ? `background-image:url(${c.avatar})`
        : '';
      const preview = c.personality || c.background || 'No description';
      return `
        <div class="contact-card ${isActive ? 'active' : ''}" data-id="${c.id}">
          <div class="contact-avatar" style="${avatarStyle}">${avatarContent}</div>
          <div class="contact-info">
            <div class="contact-name">${escapeHtml(c.name)}</div>
            <div class="contact-preview">${escapeHtml(preview.slice(0, 50))}</div>
          </div>
          <div class="contact-actions">
            <button class="contact-action-btn" data-action="edit" data-id="${c.id}" aria-label="Edit">
              <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="contact-action-btn danger" data-action="delete" data-id="${c.id}" aria-label="Delete">
              <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>`;
    }).join('');

    // Bind events
    container.querySelectorAll('.contact-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.contact-action-btn')) return;
        const id = card.dataset.id;
        Store.setActiveCharacterId(id);
        syncActiveCharacterUI();
        renderContactsList();
      });
    });

    container.querySelectorAll('.contact-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'edit') openCharEdit(id);
        if (action === 'delete') {
          if (confirm('Delete this companion? Chat history will also be removed.')) {
            Store.deleteCharacter(id);
            syncActiveCharacterUI();
            renderContactsList();
          }
        }
      });
    });
  }

  // ========== Character Edit Modal ==========
  function setupCharEdit() {
    const overlay = document.getElementById('char-edit-overlay');
    document.getElementById('char-edit-close').addEventListener('click', () => closeOverlay('char-edit-overlay'));
    document.getElementById('char-edit-cancel').addEventListener('click', () => closeOverlay('char-edit-overlay'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay('char-edit-overlay'); });
    document.getElementById('char-edit-save').addEventListener('click', saveCharEdit);

    // Avatar upload
    document.getElementById('char-edit-avatar-btn').addEventListener('click', () => {
      document.getElementById('char-edit-file-input').click();
    });
    document.getElementById('char-edit-file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) return;
      if (file.size > 2 * 1024 * 1024) { alert('Image must be under 2MB'); return; }
      const reader = new FileReader();
      reader.onload = (ev) => {
        editingAvatarBase64 = ev.target.result;
        setEditAvatarPreview(editingAvatarBase64);
      };
      reader.readAsDataURL(file);
    });
  }

  function openCharEdit(charId) {
    editingCharId = charId;
    editingAvatarBase64 = '';

    const title = document.getElementById('char-edit-title');
    const nameInput = document.getElementById('char-edit-name');
    const nicknameInput = document.getElementById('char-edit-nickname');
    const bgInput = document.getElementById('char-edit-background');
    const personalityInput = document.getElementById('char-edit-personality');

    if (charId) {
      // Editing existing
      title.textContent = 'Edit Companion';
      const chars = Store.getCharacters();
      const c = chars.find(x => x.id === charId);
      if (!c) return;
      nameInput.value = c.name || '';
      nicknameInput.value = c.nickname || '';
      bgInput.value = c.background || '';
      personalityInput.value = c.personality || '';
      editingAvatarBase64 = c.avatar || '';
      setEditAvatarPreview(c.avatar);
    } else {
      // New
      title.textContent = 'New Companion';
      nameInput.value = '';
      nicknameInput.value = '';
      bgInput.value = '';
      personalityInput.value = '';
      editingAvatarBase64 = '';
      setEditAvatarPreview('');
    }

    // Reset file input
    document.getElementById('char-edit-file-input').value = '';
    openOverlay('char-edit-overlay');
  }

  function setEditAvatarPreview(base64) {
    const el = document.getElementById('char-edit-avatar-preview');
    if (base64) {
      el.style.backgroundImage = `url(${base64})`;
      el.innerHTML = '';
    } else {
      el.style.backgroundImage = '';
      el.innerHTML = DEFAULT_AVATAR_SVG;
    }
  }

  function saveCharEdit() {
    const data = {
      name: document.getElementById('char-edit-name').value.trim() || 'Companion',
      nickname: document.getElementById('char-edit-nickname').value.trim(),
      background: document.getElementById('char-edit-background').value.trim(),
      personality: document.getElementById('char-edit-personality').value.trim(),
      avatar: editingAvatarBase64
    };

    if (editingCharId) {
      Store.updateCharacter(editingCharId, data);
    } else {
      const newChar = Store.addCharacter(data);
      // Auto-select the new character
      Store.setActiveCharacterId(newChar.id);
    }

    syncActiveCharacterUI();
    renderContactsList();
    showSaveToast();
    closeOverlay('char-edit-overlay');

    // Refresh phone mode UI if active
    if (isPhoneMode) {
      renderPhoneChatList();
      syncPhoneProfile();
      // Refresh chatroom header if open and matches edited char
      if (phoneCharId) {
        const updatedChar = Store.getCharacters().find(c => c.id === phoneCharId);
        if (updatedChar) {
          document.getElementById('phone-chatroom-name').textContent = updatedChar.nickname || updatedChar.name;
          const avatarEl = document.getElementById('phone-chatroom-avatar');
          if (updatedChar.avatar) {
            avatarEl.style.backgroundImage = `url(${updatedChar.avatar})`;
            avatarEl.innerHTML = '';
          } else {
            avatarEl.style.backgroundImage = '';
            avatarEl.innerHTML = DEFAULT_AVATAR_SVG;
          }
        }
      }
    }
  }

  // ========== Sync Active Character to Island + Fullscreen ==========
  function syncActiveCharacterUI() {
    const char = Store.getActiveCharacter();
    const islandAvatar = document.getElementById('island-avatar');
    const fullscreenAvatar = document.getElementById('fullscreen-avatar');
    const fullscreenName = document.getElementById('fullscreen-char-name');

    const avatar = char ? char.avatar : '';
    const name = char ? char.name : 'Companion';

    [islandAvatar, fullscreenAvatar].forEach(el => {
      if (!el) return;
      if (avatar) {
        el.style.backgroundImage = `url(${avatar})`;
        el.innerHTML = '';
      } else {
        el.style.backgroundImage = '';
        el.innerHTML = DEFAULT_AVATAR_SVG;
      }
    });

    if (fullscreenName) fullscreenName.textContent = name;
  }

  // ========== Fullscreen Chat ==========
  function setupFullscreenMode() {
    document.getElementById('fullscreen-back').addEventListener('click', exitFullscreen);

    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
      });
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage();
        }
      });
    }

    const sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) sendBtn.addEventListener('click', sendChatMessage);

    // Sticker button in fullscreen chat
    const stickerBtn = document.getElementById('chat-sticker-btn');
    if (stickerBtn) stickerBtn.addEventListener('click', toggleChatStickerPanel);

    // Sticker tab switching
    document.querySelectorAll('.chat-sticker-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.chat-sticker-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        chatStickerActiveTab = tab.dataset.stickerTab;
        renderChatStickerGrid();
      });
    });

    // Text sticker create dialog
    document.getElementById('chat-text-sticker-cancel').addEventListener('click', () => {
      document.getElementById('chat-text-sticker-dialog').classList.add('hidden');
    });
    document.getElementById('chat-text-sticker-save').addEventListener('click', () => {
      const text = document.getElementById('chat-text-sticker-text').value.trim();
      const meaning = document.getElementById('chat-text-sticker-meaning').value.trim();
      if (!text || !meaning) return;
      Store.addSticker({ type: 'text', text, meaning });
      document.getElementById('chat-text-sticker-dialog').classList.add('hidden');
      renderChatStickerGrid();
    });

    // Image sticker create dialog
    document.getElementById('chat-image-sticker-cancel').addEventListener('click', () => {
      document.getElementById('chat-image-sticker-dialog').classList.add('hidden');
      chatPendingStickerBase64 = '';
    });
    document.getElementById('chat-image-sticker-save').addEventListener('click', () => {
      const meaning = document.getElementById('chat-image-sticker-meaning').value.trim();
      if (!chatPendingStickerBase64 || !meaning) return;
      Store.addSticker({ type: 'image', image: chatPendingStickerBase64, meaning });
      document.getElementById('chat-image-sticker-dialog').classList.add('hidden');
      chatPendingStickerBase64 = '';
      renderChatStickerGrid();
    });
    document.getElementById('chat-sticker-image-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const size = Math.min(img.width, img.height, 200);
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, size, size);
          chatPendingStickerBase64 = canvas.toDataURL('image/jpeg', 0.8);
          const preview = document.getElementById('chat-image-sticker-preview');
          preview.innerHTML = `<img src="${chatPendingStickerBase64}" style="width:100%;height:100%;object-fit:cover;">`;
          document.getElementById('chat-image-sticker-dialog').classList.remove('hidden');
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    // Image button in fullscreen chat (send image message)
    const imageBtn = document.getElementById('chat-image-btn');
    if (imageBtn) imageBtn.addEventListener('click', () => {
      document.getElementById('chat-image-file').click();
    });
    const imageFile = document.getElementById('chat-image-file');
    if (imageFile) imageFile.addEventListener('change', handleChatImageUpload);
  }

  let chatStickerActiveTab = 'text';
  let chatPendingStickerBase64 = '';

  function toggleChatStickerPanel() {
    const panel = document.getElementById('chat-sticker-panel');
    const isHidden = panel.classList.contains('hidden');
    // Hide dialogs when toggling
    document.getElementById('chat-text-sticker-dialog').classList.add('hidden');
    document.getElementById('chat-image-sticker-dialog').classList.add('hidden');
    if (isHidden) {
      renderChatStickerGrid();
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  }

  function renderChatStickerGrid() {
    const grid = document.getElementById('chat-sticker-grid');
    grid.innerHTML = '';
    const char = Store.getActiveCharacter();
    if (!char) return;
    const allStickers = Store.getStickers(char.id) || [];
    const stickers = allStickers.filter(s => s.type === chatStickerActiveTab);

    // Add "new" button first
    const addItem = document.createElement('div');
    addItem.className = 'sticker-item sticker-add';
    addItem.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;color:var(--text-muted);"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    addItem.addEventListener('click', () => {
      if (chatStickerActiveTab === 'text') {
        document.getElementById('chat-text-sticker-text').value = '';
        document.getElementById('chat-text-sticker-meaning').value = '';
        document.getElementById('chat-text-sticker-dialog').classList.remove('hidden');
      } else {
        document.getElementById('chat-sticker-image-file').click();
      }
    });
    grid.appendChild(addItem);

    stickers.forEach(s => {
      const item = document.createElement('div');
      item.className = 'sticker-item';
      if (s.type === 'image') {
        item.innerHTML = `<img src="${s.image || s.data}" alt="sticker">`;
      } else {
        item.innerHTML = `<div class="text-sticker">${escapeHtml(s.text)}</div>`;
      }
      item.addEventListener('click', () => {
        sendChatSticker(s);
        document.getElementById('chat-sticker-panel').classList.add('hidden');
      });
      grid.appendChild(item);
    });
  }

  function sendChatSticker(sticker) {
    if (!Store.getActiveCharacter()) return;
    if (sticker.type === 'image') {
      addMessageToChat('user', `[sticker:${sticker.data}]`);
    } else {
      addMessageToChat('user', `[textsticker:${sticker.text}]`);
    }
    // 告诉 AI 用户发了表情
    const desc = sticker.type === 'image'
      ? (sticker.meaning || '发了一个表情包')
      : sticker.text;
    chatMsgBuffer.push(`[用户发送了表情: ${desc}]`);
    if (chatMsgBufferTimer) clearTimeout(chatMsgBufferTimer);
    chatMsgBufferTimer = setTimeout(() => flushChatMsgBuffer(), MSG_BUFFER_DELAY);
  }

  function handleChatImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = () => {
      addMessageToChat('user', '[图片]');
      // 可以把 base64 存到聊天历史，或者直接作为描述发给 AI
      chatMsgBuffer.push('[用户发送了一张图片]');
      if (chatMsgBufferTimer) clearTimeout(chatMsgBufferTimer);
      chatMsgBufferTimer = setTimeout(() => flushChatMsgBuffer(), MSG_BUFFER_DELAY);
    };
    reader.readAsDataURL(file);
  }

  // 全屏聊天的消息缓冲
  let chatMsgBuffer = [];
  let chatMsgBufferTimer = null;

  async function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    const text = chatInput.value.trim();
    if (!text) return;
    addMessageToChat('user', text);
    chatInput.value = '';
    chatInput.style.height = 'auto';

    if (!API.isConfigured()) {
      addMessageToChat('ai', 'API is not configured yet. Go to Settings → API to set it up.');
      return;
    }
    if (!Store.getActiveCharacter()) {
      addMessageToChat('ai', 'No companion selected. Open Contacts to pick one.');
      return;
    }

    // 加入缓冲区，等 15 秒没新消息后打包发
    chatMsgBuffer.push(text);
    if (chatMsgBufferTimer) clearTimeout(chatMsgBufferTimer);
    chatMsgBufferTimer = setTimeout(() => {
      flushChatMsgBuffer();
    }, MSG_BUFFER_DELAY);
  }

  async function flushChatMsgBuffer() {
    if (chatMsgBuffer.length === 0) return;
    const combined = chatMsgBuffer.join('\n');
    chatMsgBuffer = [];
    chatMsgBufferTimer = null;

    const screenshot = Vision.getStatus().active ? Vision.getCurrentPreview() : null;
    const result = await API.chat(combined, screenshot);
    if (result && result.ok && result.text) {
      // 拆条：用 [NEXT] 分隔，逐条显示
      const parts = result.text.replace(/\[SILENT\]/gi, '').split(/\[NEXT\]/i).map(s => s.trim()).filter(Boolean);
      if (parts.length === 0) return;

      addMessageToChat('ai', parts[0]);
      // 后续条延迟逐条添加
      for (let i = 1; i < parts.length; i++) {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
        addMessageToChat('ai', parts[i]);
      }
    } else {
      const errMsg = result?.error || 'Something went wrong.';
      addMessageToChat('ai', `(Error: ${errMsg})`);
    }
  }

  function enterFullscreen() {
    if (!Store.getActiveCharacter()) {
      openContacts();
      return;
    }
    const island = document.getElementById('dynamic-island');
    const app = document.getElementById('fullscreen-app');
    island.classList.add('hidden-island');
    app.classList.remove('hidden');
    setTimeout(() => app.classList.add('show'), 10);
    isFullscreen = true;
    isChatting = true;
    collapseIsland();
    syncActiveCharacterUI();
    loadChatHistoryToUI();

    // 聊天期间暂停 Vision
    if (Vision.getStatus().active) {
      Vision.pause();
    }

    if (isElectron) {
      window.electronAPI.resizeWindow('panel');
    }
  }

  function exitFullscreen() {
    const island = document.getElementById('dynamic-island');
    const app = document.getElementById('fullscreen-app');
    app.classList.remove('show');
    setTimeout(() => {
      app.classList.add('hidden');
      island.classList.remove('hidden-island');
      if (isElectron) {
        window.electronAPI.resizeWindow('island');
      }
    }, 300);
    isFullscreen = false;
    isChatting = false;

    // 退出聊天，恢复 Vision
    if (Vision.getStatus().active) {
      Vision.resume();
    }
  }

  function loadChatHistoryToUI() {
    const container = document.getElementById('chat-messages');
    const history = Store.getChatHistory();
    container.innerHTML = '';

    if (history.length === 0) {
      container.innerHTML = '<div class="chat-empty"><svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><p>No conversations yet.<br>Once vision is on, your companion will start sharing their thoughts.</p></div>';
      return;
    }

    history.forEach(msg => {
      const div = document.createElement('div');
      div.className = `chat-msg ${msg.role}`;
      if (msg.id) div.dataset.msgId = msg.id;

      // Image sticker: [sticker:base64...]
      if (msg.content && msg.content.startsWith('[sticker:')) {
        const stickerImg = msg.content.match(/\[sticker:(.*?)\]/s)?.[1];
        if (stickerImg) {
          div.innerHTML = `
            <div class="chat-msg-sticker"><img src="${stickerImg}" alt="sticker"></div>
            <div class="chat-msg-time">${formatTime(msg.timestamp)}</div>
          `;
          if (msg.id) div.addEventListener('click', () => showMsgActions(msg, 'fullscreen'));
          container.appendChild(div);
          return;
        }
      }

      // Text sticker: [textsticker:文字内容]
      if (msg.content && msg.content.startsWith('[textsticker:')) {
        const textContent = msg.content.match(/\[textsticker:(.*?)\]/)?.[1];
        if (textContent) {
          div.innerHTML = `
            <div class="chat-msg-text-sticker">${escapeHtml(textContent)}</div>
            <div class="chat-msg-time">${formatTime(msg.timestamp)}</div>
          `;
          if (msg.id) div.addEventListener('click', () => showMsgActions(msg, 'fullscreen'));
          container.appendChild(div);
          return;
        }
      }

      div.innerHTML = `
        <div class="chat-msg-content">${escapeHtml(msg.content)}</div>
        <div class="chat-msg-time">${formatTime(msg.timestamp)}</div>
      `;
      if (msg.id) div.addEventListener('click', () => showMsgActions(msg, 'fullscreen'));
      container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
  }

  let isPhoneMode = false;
  let phoneCharId = null; // currently open chatroom character ID in phone mode

  function addMessageToChat(role, content) {
    Store.addChatMessage({ role, content });
    if (isFullscreen) loadChatHistoryToUI();
    if (isPhoneMode && phoneCharId === Store.getActiveCharacterId()) {
      loadPhoneChatMessages();
    }
    // 触发记忆总结检查（每 20 条消息自动总结一次）
    API.checkMemoryTrigger();
  }

  // ========== Message Action Menu (Edit / Delete) ==========
  let activeMsgActionMenu = null;

  function dismissMsgActions() {
    if (activeMsgActionMenu) {
      activeMsgActionMenu.remove();
      activeMsgActionMenu = null;
    }
  }

  function showMsgActions(msg, mode) {
    dismissMsgActions();

    const isSticker = msg.content.startsWith('[sticker:') || msg.content.startsWith('[textsticker:') || msg.content.startsWith('[image:');

    const menu = document.createElement('div');
    menu.className = 'msg-action-menu';
    menu.innerHTML = `
      ${!isSticker ? '<button class="msg-action-edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> 编辑</button>' : ''}
      <button class="msg-action-delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 删除</button>
    `;

    // Edit handler
    if (!isSticker) {
      menu.querySelector('.msg-action-edit').addEventListener('click', (e) => {
        e.stopPropagation();
        dismissMsgActions();
        showMsgEditDialog(msg, mode);
      });
    }

    // Delete handler
    menu.querySelector('.msg-action-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      dismissMsgActions();
      if (mode === 'phone') {
        Store.deleteChatMessage(msg.id, phoneCharId);
        loadPhoneChatMessages();
      } else {
        Store.deleteChatMessage(msg.id);
        loadChatHistoryToUI();
      }
    });

    document.body.appendChild(menu);
    activeMsgActionMenu = menu;

    // Dismiss on click outside
    setTimeout(() => {
      const dismiss = (e) => {
        if (!menu.contains(e.target)) {
          dismissMsgActions();
          document.removeEventListener('click', dismiss, true);
        }
      };
      document.addEventListener('click', dismiss, true);
    }, 10);
  }

  function showMsgEditDialog(msg, mode) {
    const overlay = document.createElement('div');
    overlay.className = 'msg-edit-overlay';
    overlay.innerHTML = `
      <div class="msg-edit-dialog">
        <div class="msg-edit-title">编辑消息</div>
        <textarea class="msg-edit-textarea">${escapeHtml(msg.content)}</textarea>
        <div class="msg-edit-actions">
          <button class="msg-edit-cancel">取消</button>
          <button class="msg-edit-save">保存</button>
        </div>
      </div>
    `;

    overlay.querySelector('.msg-edit-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('.msg-edit-save').addEventListener('click', () => {
      const newContent = overlay.querySelector('.msg-edit-textarea').value.trim();
      if (!newContent) return;
      if (mode === 'phone') {
        Store.updateChatMessage(msg.id, newContent, phoneCharId);
        loadPhoneChatMessages();
      } else {
        Store.updateChatMessage(msg.id, newContent);
        loadChatHistoryToUI();
      }
      overlay.remove();
    });

    document.body.appendChild(overlay);
    overlay.querySelector('.msg-edit-textarea').focus();
  }

  // ========== Utils ==========
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  // Restore vision button state on load
  function syncVisionButton() {
    const btn = document.getElementById('btn-vision-toggle');
    if (Vision.getStatus().active) {
      btn.classList.add('active');
      startPreviewRefresh();
    }
  }

  // ========== Phone Mode ==========
  let phoneMsgBuffer = [];
  let phoneMsgBufferTimer = null;
  let pendingStickerBase64 = '';

  function enterPhoneMode() {
    isPhoneMode = true;
    isChatting = true;
    collapseIsland();

    // Hide island + background, show phone
    document.getElementById('dynamic-island').classList.add('hidden-island');
    document.getElementById('main-bg').style.display = 'none';
    document.getElementById('phone-mode').classList.remove('hidden');

    if (isElectron) {
      window.electronAPI.resizeWindow('phone');
    }

    // Pause vision while in phone mode
    if (Vision.getStatus().active) {
      Vision.pause();
    }

    updatePhoneClock();
    renderPhoneChatList();
    syncPhoneProfile();
    setupPhoneEvents();
  }

  function exitPhoneMode() {
    isPhoneMode = false;
    isChatting = false;
    phoneCharId = null;

    document.getElementById('phone-mode').classList.add('hidden');
    document.getElementById('dynamic-island').classList.remove('hidden-island');

    // Close any open subpages
    document.getElementById('phone-chatroom').classList.add('hidden');
    document.getElementById('phone-sticker-manager').classList.add('hidden');
    document.getElementById('phone-sticker-dialog').classList.add('hidden');
    document.getElementById('phone-text-sticker-dialog').classList.add('hidden');
    document.getElementById('phone-sticker-panel').classList.add('hidden');
    document.getElementById('phone-chat-settings').classList.add('hidden');

    if (isElectron) {
      window.electronAPI.resizeWindow('island');
    }

    // Resume vision
    if (Vision.getStatus().active) {
      Vision.resume();
    }
  }

  // Phone clock
  function updatePhoneClock() {
    const el = document.getElementById('phone-time');
    if (el) {
      el.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    if (isPhoneMode) setTimeout(updatePhoneClock, 30000);
  }

  // Phone profile sync
  function syncPhoneProfile() {
    const userProfile = Store.getUserProfile();
    const nameEl = document.getElementById('phone-profile-name');
    const avatarEl = document.getElementById('phone-profile-avatar');
    if (userProfile.nickname) {
      nameEl.textContent = userProfile.nickname;
    } else {
      nameEl.textContent = '未设置昵称';
    }
    if (userProfile.avatar) {
      avatarEl.style.backgroundImage = `url(${userProfile.avatar})`;
      avatarEl.innerHTML = '';
    } else {
      avatarEl.style.backgroundImage = '';
      avatarEl.innerHTML = '<svg class="default-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></svg>';
    }

    // Vision badge
    const badge = document.getElementById('phone-vision-badge');
    if (badge) {
      const active = Vision.getStatus().active;
      badge.textContent = active ? '开' : '关';
      badge.classList.toggle('on', active);
    }
  }

  // Tab switching
  let phoneEventsReady = false;

  function setupPhoneEvents() {
    if (phoneEventsReady) return;
    phoneEventsReady = true;

    // Tab bar
    document.querySelectorAll('.phone-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.phone-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.phone-page').forEach(p => p.classList.remove('active'));
        document.getElementById('phone-page-' + tab).classList.add('active');

        // Close subpages when switching tabs
        document.getElementById('phone-chatroom').classList.add('hidden');
        document.getElementById('phone-sticker-panel').classList.add('hidden');
        document.getElementById('phone-sticker-manager').classList.add('hidden');
        document.getElementById('phone-chat-settings').classList.add('hidden');
        document.getElementById('phone-text-sticker-dialog').classList.add('hidden');
        document.getElementById('phone-user-profile').classList.add('hidden');
        phoneCharId = null;

        if (tab === 'messages') renderPhoneChatList();
        if (tab === 'profile') syncPhoneProfile();
      });
    });

    // Minimize button
    document.getElementById('phone-to-island').addEventListener('click', exitPhoneMode);

    // Chatroom back
    document.getElementById('phone-chatroom-back').addEventListener('click', () => {
      document.getElementById('phone-chatroom').classList.add('hidden');
      document.getElementById('phone-sticker-panel').classList.add('hidden');
      phoneCharId = null;
      renderPhoneChatList();
    });

    // Chatroom avatar → edit character
    document.getElementById('phone-chatroom-avatar').addEventListener('click', () => {
      if (phoneCharId) openCharEdit(phoneCharId);
    });

    // Chat send
    document.getElementById('phone-send-btn').addEventListener('click', phoneHandleSend);
    document.getElementById('phone-chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); phoneHandleSend(); }
    });

    // Image button
    document.getElementById('phone-image-btn').addEventListener('click', () => {
      document.getElementById('phone-image-file').click();
    });
    document.getElementById('phone-image-file').addEventListener('change', phoneHandleImageUpload);

    // Sticker button toggle
    document.getElementById('phone-sticker-btn').addEventListener('click', () => {
      const panel = document.getElementById('phone-sticker-panel');
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) renderPhoneStickerGrid();
    });

    // Sticker add from panel
    document.getElementById('phone-sticker-add').addEventListener('click', () => {
      document.getElementById('phone-sticker-panel').classList.add('hidden');
      openPhoneStickerManager();
    });

    // Profile menu items
    document.getElementById('phone-menu-companions').addEventListener('click', () => {
      exitPhoneMode();
      setTimeout(() => openContacts(), 350);
    });
    document.getElementById('phone-menu-stickers').addEventListener('click', openPhoneStickerManager);
    document.getElementById('phone-menu-vision').addEventListener('click', () => {
      toggleVision();
      setTimeout(syncPhoneProfile, 300);
    });
    document.getElementById('phone-menu-api').addEventListener('click', () => {
      exitPhoneMode();
      setTimeout(() => openSettings(), 350);
    });
    document.getElementById('phone-menu-general').addEventListener('click', () => {
      exitPhoneMode();
      setTimeout(() => openSettings(), 350);
    });

    // User profile settings
    document.getElementById('phone-menu-user-profile').addEventListener('click', () => {
      const profile = Store.getUserProfile();
      document.getElementById('user-profile-nickname').value = profile.nickname || '';
      document.getElementById('user-profile-identity').value = profile.identity || '';
      const avatarPreview = document.getElementById('user-profile-avatar-preview');
      if (profile.avatar) {
        avatarPreview.style.backgroundImage = `url(${profile.avatar})`;
        avatarPreview.style.backgroundSize = 'cover';
        avatarPreview.innerHTML = '';
      } else {
        avatarPreview.style.backgroundImage = '';
        avatarPreview.innerHTML = '<svg class="default-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;"><circle cx="12" cy="8" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></svg>';
      }
      document.getElementById('phone-user-profile').classList.remove('hidden');
    });
    document.getElementById('phone-user-profile-back').addEventListener('click', () => {
      document.getElementById('phone-user-profile').classList.add('hidden');
    });
    document.getElementById('user-profile-avatar-btn').addEventListener('click', () => {
      document.getElementById('user-profile-avatar-file').click();
    });
    document.getElementById('user-profile-avatar-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const size = Math.min(img.width, img.height, 256);
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const sx = (img.width - size) / 2;
          const sy = (img.height - size) / 2;
          ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
          const base64 = canvas.toDataURL('image/jpeg', 0.8);
          const preview = document.getElementById('user-profile-avatar-preview');
          preview.style.backgroundImage = `url(${base64})`;
          preview.style.backgroundSize = 'cover';
          preview.innerHTML = '';
          preview.dataset.avatar = base64;
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
    document.getElementById('user-profile-save').addEventListener('click', () => {
      const preview = document.getElementById('user-profile-avatar-preview');
      const profile = {
        avatar: preview.dataset.avatar || Store.getUserProfile().avatar || '',
        nickname: document.getElementById('user-profile-nickname').value.trim(),
        identity: document.getElementById('user-profile-identity').value.trim()
      };
      Store.saveUserProfile(profile);
      syncPhoneProfile();
      document.getElementById('phone-user-profile').classList.add('hidden');
      alert('个人设置已保存');
    });

    // Quit app
    document.getElementById('phone-menu-quit').addEventListener('click', () => {
      if (confirm('确定要退出应用吗？')) {
        if (isElectron && window.electronAPI.quitApp) {
          window.electronAPI.quitApp();
        } else {
          window.close();
        }
      }
    });

    // Export data
    document.getElementById('phone-menu-export').addEventListener('click', async () => {
      try {
        const data = Store.exportAllData();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sudoku2048-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        alert('数据导出成功！');
      } catch (err) {
        console.error('Export failed:', err);
        alert('导出失败: ' + err.message);
      }
    });

    // Import data
    document.getElementById('phone-menu-import').addEventListener('click', () => {
      document.getElementById('phone-import-file').click();
    });
    document.getElementById('phone-import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!confirm(`确定要导入数据吗？\n包含 ${data.characters?.length || 0} 个角色\n当前数据将被覆盖。`)) return;

        Store.importAllData(data);
        alert('数据导入成功！应用将重新加载。');
        location.reload();
      } catch (err) {
        console.error('Import failed:', err);
        alert('导入失败: ' + err.message);
      }
    });

    // Sticker manager
    document.getElementById('phone-sticker-manager-back').addEventListener('click', () => {
      document.getElementById('phone-sticker-manager').classList.add('hidden');
    });
    document.getElementById('phone-sticker-upload-btn').addEventListener('click', () => {
      document.getElementById('phone-sticker-file').click();
    });
    document.getElementById('phone-sticker-file').addEventListener('change', phoneHandleStickerUpload);

    // Sticker dialog (image)
    document.getElementById('phone-sticker-dialog-cancel').addEventListener('click', () => {
      document.getElementById('phone-sticker-dialog').classList.add('hidden');
      pendingStickerBase64 = '';
    });
    document.getElementById('phone-sticker-dialog-save').addEventListener('click', phoneHandleStickerSave);

    // Text sticker button (in sticker manager)
    document.getElementById('phone-text-sticker-btn').addEventListener('click', () => {
      document.getElementById('phone-text-sticker-text').value = '';
      document.getElementById('phone-text-sticker-meaning').value = '';
      document.getElementById('phone-text-sticker-dialog').classList.remove('hidden');
    });

    // Text sticker dialog
    document.getElementById('phone-text-sticker-dialog-cancel').addEventListener('click', () => {
      document.getElementById('phone-text-sticker-dialog').classList.add('hidden');
    });
    document.getElementById('phone-text-sticker-dialog-save').addEventListener('click', phoneHandleTextStickerSave);

    // Chat settings menu item
    document.getElementById('phone-menu-chat-settings').addEventListener('click', openPhoneChatSettings);

    // Chat settings back
    document.getElementById('phone-chat-settings-back').addEventListener('click', () => {
      document.getElementById('phone-chat-settings').classList.add('hidden');
    });

    // Chat settings: upload image sticker for selected char
    document.getElementById('phone-cs-upload-image').addEventListener('click', () => {
      document.getElementById('phone-cs-file').click();
    });
    document.getElementById('phone-cs-file').addEventListener('change', phoneCsHandleImageUpload);

    // Chat settings: add text sticker for selected char
    document.getElementById('phone-cs-add-text').addEventListener('click', () => {
      document.getElementById('phone-text-sticker-text').value = '';
      document.getElementById('phone-text-sticker-meaning').value = '';
      csTextStickerMode = true;
      document.getElementById('phone-text-sticker-dialog').classList.remove('hidden');
    });
  }

  // Render chat list
  function renderPhoneChatList() {
    const container = document.getElementById('phone-chat-list');
    const characters = Store.getCharacters();
    container.innerHTML = '';

    if (characters.length === 0) {
      container.innerHTML = '<div class="phone-empty-placeholder"><p>还没有角色，去"我的"里创建一个吧</p></div>';
      return;
    }

    characters.forEach(char => {
      const history = Store.getChatHistory(char.id);
      const lastMsg = history.length > 0 ? history[history.length - 1] : null;

      const item = document.createElement('div');
      item.className = 'phone-chat-item';
      item.innerHTML = `
        <div class="phone-chat-item-avatar" ${char.avatar ? `style="background-image:url(${char.avatar})"` : ''}>
          ${char.avatar ? '' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></svg>'}
        </div>
        <div class="phone-chat-item-body">
          <div class="phone-chat-item-top">
            <span class="phone-chat-item-name">${escapeHtml(char.nickname || char.name)}</span>
            <span class="phone-chat-item-time">${lastMsg ? formatTime(lastMsg.timestamp) : ''}</span>
          </div>
          <div class="phone-chat-item-preview">${lastMsg ? escapeHtml(lastMsg.content).substring(0, 40) : '暂无消息'}</div>
        </div>
      `;
      item.addEventListener('click', () => openPhoneChatroom(char));
      container.appendChild(item);
    });
  }

  // Open chatroom
  function openPhoneChatroom(char) {
    phoneCharId = char.id;

    // Set active character
    Store.setActiveCharacterId(char.id);
    syncActiveCharacterUI();

    // Update header
    document.getElementById('phone-chatroom-name').textContent = char.nickname || char.name;
    const avatarEl = document.getElementById('phone-chatroom-avatar');
    if (char.avatar) {
      avatarEl.style.backgroundImage = `url(${char.avatar})`;
      avatarEl.innerHTML = '';
    } else {
      avatarEl.style.backgroundImage = '';
      avatarEl.innerHTML = '<svg class="default-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></svg>';
    }

    loadPhoneChatMessages();
    document.getElementById('phone-chatroom').classList.remove('hidden');
    document.getElementById('phone-chat-input').focus();
  }

  // Avatar HTML helper
  function avatarHtml(char) {
    if (char?.avatar) {
      return `<div class="phone-msg-avatar" style="background-image:url(${char.avatar})"></div>`;
    }
    return `<div class="phone-msg-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></svg></div>`;
  }

  // Load phone chat messages
  function loadPhoneChatMessages() {
    const container = document.getElementById('phone-chat-messages');
    const history = Store.getChatHistory(phoneCharId);
    const char = Store.getCharacters().find(c => c.id === phoneCharId);
    container.innerHTML = '';

    if (history.length === 0) {
      container.innerHTML = '<div class="phone-empty-placeholder" style="padding:40px 0"><p>开始聊天吧</p></div>';
      return;
    }

    let lastTimeShown = 0;
    history.forEach(msg => {
      if (msg.timestamp - lastTimeShown > 300000) {
        const timeDiv = document.createElement('div');
        timeDiv.className = 'phone-msg-time';
        timeDiv.textContent = formatTime(msg.timestamp);
        container.appendChild(timeDiv);
        lastTimeShown = msg.timestamp;
      }

      const div = document.createElement('div');
      div.className = `phone-msg ${msg.role}`;
      if (msg.id) div.dataset.msgId = msg.id;

      // Image sticker: [sticker:base64...]
      if (msg.content && msg.content.startsWith('[sticker:')) {
        const stickerImg = msg.content.match(/\[sticker:(.*?)\]/)?.[1];
        if (stickerImg) {
          div.innerHTML = avatarHtml(char) + `<div class="phone-msg-sticker"><img src="${stickerImg}" alt="sticker"></div>`;
          if (msg.id) div.addEventListener('click', () => showMsgActions(msg, 'phone'));
          container.appendChild(div);
          return;
        }
      }

      // Text sticker: [textsticker:文字内容]
      if (msg.content && msg.content.startsWith('[textsticker:')) {
        const textContent = msg.content.match(/\[textsticker:(.*?)\]/)?.[1];
        if (textContent) {
          div.innerHTML = avatarHtml(char) + `<div class="phone-msg-text-sticker">${escapeHtml(textContent)}</div>`;
          if (msg.id) div.addEventListener('click', () => showMsgActions(msg, 'phone'));
          container.appendChild(div);
          return;
        }
      }

      // Image message: [image:base64...]
      if (msg.content && msg.content.startsWith('[image:')) {
        const imgSrc = msg.content.match(/\[image:(.*?)\]/)?.[1];
        if (imgSrc) {
          div.innerHTML = avatarHtml(char) + `<div class="phone-msg-image"><img src="${imgSrc}" alt="image"></div>`;
          if (msg.id) div.addEventListener('click', () => showMsgActions(msg, 'phone'));
          container.appendChild(div);
          return;
        }
      }

      div.innerHTML = avatarHtml(char) + `<div class="phone-msg-bubble">${escapeHtml(msg.content)}</div>`;
      if (msg.id) div.addEventListener('click', () => showMsgActions(msg, 'phone'));
      container.appendChild(div);
    });

    container.scrollTop = container.scrollHeight;
  }

  // Phone send message (with buffer)
  function phoneHandleSend() {
    const input = document.getElementById('phone-chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    addMessageToChat('user', text);

    phoneMsgBuffer.push(text);
    if (phoneMsgBufferTimer) clearTimeout(phoneMsgBufferTimer);
    phoneMsgBufferTimer = setTimeout(flushPhoneMsgBuffer, MSG_BUFFER_DELAY);
  }

  async function flushPhoneMsgBuffer() {
    if (phoneMsgBuffer.length === 0) return;
    const combined = phoneMsgBuffer.join('\n');
    phoneMsgBuffer = [];
    phoneMsgBufferTimer = null;

    if (!API.isConfigured()) {
      addMessageToChat('ai', '还没有配置 API 连接哦');
      return;
    }

    const screenshot = Vision.getStatus().active ? Vision.getCurrentPreview() : null;
    const result = await API.chat(combined, screenshot);
    if (result && result.ok && result.text) {
      await processAiReply(result.text);
    } else if (result) {
      addMessageToChat('ai', `(Error: ${result.error || 'Unknown'})`);
    }
  }

  // Phone image upload
  function phoneHandleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result;
      addMessageToChat('user', `[image:${base64}]`);

      if (!API.isConfigured()) {
        addMessageToChat('ai', '还没有配置 API 连接');
        return;
      }

      const result = await API.chatWithImage(base64, null, null);
      if (result && result.ok && result.text) {
        await processAiReply(result.text);
      }
    };
    reader.readAsDataURL(file);
  }

  // Sticker grid in chatroom
  function renderPhoneStickerGrid() {
    const grid = document.getElementById('phone-sticker-grid');
    const stickers = Store.getStickers();
    grid.innerHTML = '';

    stickers.forEach(s => {
      const cell = document.createElement('div');
      cell.className = 'phone-sticker-cell';
      if (s.type === 'text') {
        cell.innerHTML = `<div class="text-sticker-thumb">${escapeHtml(s.text)}</div>`;
      } else {
        cell.innerHTML = `<img src="${s.image}" alt="${escapeHtml(s.meaning)}">`;
      }
      cell.addEventListener('click', () => sendSticker(s));
      grid.appendChild(cell);
    });

    if (stickers.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:16px;font-size:13px">还没有表情包哦</div>';
    }
  }

  async function sendSticker(sticker) {
    document.getElementById('phone-sticker-panel').classList.add('hidden');

    if (sticker.type === 'text') {
      addMessageToChat('user', `[textsticker:${sticker.text}]`);
    } else {
      addMessageToChat('user', `[sticker:${sticker.image}]`);
    }

    if (!API.isConfigured()) return;

    const result = await API.chatWithSticker(sticker.meaning, null);
    if (result && result.ok && result.text) {
      processAiReply(result.text);
    }
  }

  // Sticker cooldown: skip N replies before allowing another sticker
  let stickerCooldown = 0;
  const STICKER_CHANCE = 0.3;       // 30% base probability
  const STICKER_COOLDOWN_MIN = 2;   // at least 2 replies between stickers

  // Centralized AI reply processor: dual-channel (text + sticker)
  async function processAiReply(text) {
    // Clean up any stray markers (safety)
    let cleaned = text.replace(/\[SILENT\]/gi, '').replace(/\[WANT_STICKER\]/gi, '');

    const parts = cleaned.split(/\[NEXT\]/i).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return;

    // Channel 1: output text messages
    const fullText = parts.join(' ');
    for (let i = 0; i < parts.length; i++) {
      addMessageToChat('ai', parts[i]);
      if (i < parts.length - 1) {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
      }
    }

    // Channel 2: frontend-driven sticker decision
    stickerCooldown--;
    const charId = Store.getActiveCharacterId();
    const stickers = charId ? Store.getStickers(charId) : [];
    if (stickers.length > 0 && stickerCooldown <= 0 && Math.random() < STICKER_CHANCE) {
      try {
        const stickerResult = await API.chooseStickerForReply(fullText);
        if (stickerResult && stickerResult.ok && stickerResult.sticker) {
          const s = stickerResult.sticker;
          await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
          if (s.type === 'text') {
            addMessageToChat('ai', `[textsticker:${s.text}]`);
          } else {
            addMessageToChat('ai', `[sticker:${s.image}]`);
          }
          stickerCooldown = STICKER_COOLDOWN_MIN + Math.floor(Math.random() * 3);
        }
      } catch (err) {
        console.error('Sticker channel error:', err);
      }
    }
  }

  // Sticker manager
  function openPhoneStickerManager() {
    renderPhoneStickerList();
    document.getElementById('phone-sticker-manager').classList.remove('hidden');
  }

  function renderPhoneStickerList() {
    const container = document.getElementById('phone-sticker-list');
    const stickers = Store.getStickers();
    container.innerHTML = '';

    stickers.forEach(s => {
      const item = document.createElement('div');
      item.className = 'phone-sticker-item';
      const thumb = s.type === 'text'
        ? `<div class="text-sticker-thumb">${escapeHtml(s.text)}</div>`
        : `<img src="${s.image}" alt="${escapeHtml(s.meaning)}">`;
      item.innerHTML = `
        ${thumb}
        <button class="phone-sticker-item-delete" data-id="${s.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="phone-sticker-item-label">${escapeHtml(s.meaning)}</div>
      `;
      item.querySelector('.phone-sticker-item-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        Store.deleteSticker(s.id);
        renderPhoneStickerList();
      });
      container.appendChild(item);
    });
  }

  function phoneHandleStickerUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = (ev) => {
      pendingStickerBase64 = ev.target.result;
      csStickerImageMode = false; // normal sticker manager path
      const preview = document.getElementById('phone-sticker-preview');
      preview.innerHTML = `<img src="${pendingStickerBase64}" alt="preview">`;
      document.getElementById('phone-sticker-meaning').value = '';
      document.getElementById('phone-sticker-dialog').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }

  function phoneHandleStickerSave() {
    const meaning = document.getElementById('phone-sticker-meaning').value.trim();
    if (!meaning || !pendingStickerBase64) return;

    const targetCharId = csStickerImageMode ? csSelectedCharId : null;
    Store.addSticker({ type: 'image', image: pendingStickerBase64, meaning }, targetCharId);
    pendingStickerBase64 = '';
    document.getElementById('phone-sticker-dialog').classList.add('hidden');

    if (csStickerImageMode) {
      csStickerImageMode = false;
      renderCsStickerList();
    } else {
      renderPhoneStickerList();
    }
  }

  // Text sticker save
  let csTextStickerMode = false; // true = saving from chat settings, false = from sticker manager
  let csSelectedCharId = null;   // selected char in chat settings

  function phoneHandleTextStickerSave() {
    const text = document.getElementById('phone-text-sticker-text').value.trim();
    const meaning = document.getElementById('phone-text-sticker-meaning').value.trim();
    if (!text || !meaning) return;

    const targetCharId = csTextStickerMode ? csSelectedCharId : null;
    Store.addSticker({ type: 'text', text, meaning }, targetCharId);

    document.getElementById('phone-text-sticker-dialog').classList.add('hidden');

    if (csTextStickerMode) {
      csTextStickerMode = false;
      renderCsStickerList();
    } else {
      renderPhoneStickerList();
    }
  }

  // ========== Chat Settings Page ==========
  function openPhoneChatSettings() {
    const chars = Store.getCharacters();
    const container = document.getElementById('phone-chat-settings-chars');
    container.innerHTML = '';

    if (chars.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:13px">还没有创建角色</div>';
      document.getElementById('phone-cs-char-name').textContent = '--';
      document.getElementById('phone-cs-sticker-list').innerHTML = '';
      document.getElementById('phone-chat-settings').classList.remove('hidden');
      return;
    }

    // Default to active character
    csSelectedCharId = Store.getActiveCharacterId() || chars[0].id;

    chars.forEach(c => {
      const pill = document.createElement('div');
      pill.className = 'phone-char-pill' + (c.id === csSelectedCharId ? ' active' : '');
      pill.innerHTML = `
        <div class="phone-char-pill-avatar" ${c.avatar ? `style="background-image:url(${c.avatar})"` : ''}></div>
        <span>${escapeHtml(c.nickname || c.name)}</span>
      `;
      pill.addEventListener('click', () => {
        csSelectedCharId = c.id;
        container.querySelectorAll('.phone-char-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        document.getElementById('phone-cs-char-name').textContent = c.nickname || c.name;
        document.getElementById('phone-cs-memory-title').textContent = c.nickname || c.name;
        renderCsStickerList();
        renderCsMemoryList();
      });
      container.appendChild(pill);
    });

    const activeChar = chars.find(c => c.id === csSelectedCharId);
    document.getElementById('phone-cs-char-name').textContent = activeChar ? (activeChar.nickname || activeChar.name) : '--';
    document.getElementById('phone-cs-memory-title').textContent = activeChar ? (activeChar.nickname || activeChar.name) : '--';
    renderCsStickerList();
    renderCsMemoryList();

    document.getElementById('phone-chat-settings').classList.remove('hidden');
  }

  function renderCsStickerList() {
    const container = document.getElementById('phone-cs-sticker-list');
    if (!csSelectedCharId) { container.innerHTML = ''; return; }
    const stickers = Store.getStickers(csSelectedCharId);
    container.innerHTML = '';

    if (stickers.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">暂无表情包</div>';
      return;
    }

    stickers.forEach(s => {
      const item = document.createElement('div');
      item.className = 'phone-cs-sticker-item';
      const thumb = s.type === 'text'
        ? `<div class="text-sticker-thumb">${escapeHtml(s.text)}</div>`
        : `<img src="${s.image}" alt="${escapeHtml(s.meaning)}">`;
      item.innerHTML = `
        ${thumb}
        <button class="cs-sticker-delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="cs-sticker-label">${escapeHtml(s.meaning)}</div>
      `;
      item.querySelector('.cs-sticker-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        Store.deleteSticker(s.id, csSelectedCharId);
        renderCsStickerList();
      });
      container.appendChild(item);
    });
  }

  function renderCsMemoryList() {
    const container = document.getElementById('phone-cs-memory-list');
    if (!csSelectedCharId) { container.innerHTML = ''; return; }
    const memories = Store.getMemories(csSelectedCharId);
    container.innerHTML = '';

    if (memories.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">暂无记忆，聊天满 20 条后会自动生成</div>';
      return;
    }

    const importanceLabels = ['', '⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'];

    memories.forEach(m => {
      const item = document.createElement('div');
      item.className = 'phone-cs-memory-item';
      item.innerHTML = `
        <div class="cs-memory-importance">${importanceLabels[m.importance] || '⭐⭐⭐'}</div>
        <div class="cs-memory-text" contenteditable="true">${escapeHtml(m.text)}</div>
        <button class="cs-memory-delete" title="删除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;

      // Edit on blur
      const textEl = item.querySelector('.cs-memory-text');
      textEl.addEventListener('blur', () => {
        const newText = textEl.textContent.trim();
        if (newText && newText !== m.text) {
          Store.updateMemory(m.id, { text: newText }, csSelectedCharId);
        }
      });

      // Delete
      item.querySelector('.cs-memory-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        Store.deleteMemory(m.id, csSelectedCharId);
        renderCsMemoryList();
      });

      container.appendChild(item);
    });
  }

  // Chat settings: image sticker upload for selected char
  function phoneCsHandleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = (ev) => {
      pendingStickerBase64 = ev.target.result;
      csTextStickerMode = false;
      // Reuse the image sticker dialog but save to csSelectedCharId
      const preview = document.getElementById('phone-sticker-preview');
      preview.innerHTML = `<img src="${pendingStickerBase64}" alt="preview">`;
      document.getElementById('phone-sticker-meaning').value = '';
      // Override save to use csSelectedCharId
      csStickerImageMode = true;
      document.getElementById('phone-sticker-dialog').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }

  let csStickerImageMode = false;

  return {
    init,
    showBubble,
    enterFullscreen,
    exitFullscreen,
    enterPhoneMode,
    exitPhoneMode,
    addMessageToChat,
    syncActiveCharacterUI,
    openSettings,
    openContacts,
    toggleVision
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  UI.init();
});
