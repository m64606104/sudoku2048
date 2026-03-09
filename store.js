/**
 * store.js - 本地存储模块
 * 纯 localStorage 存储，简单可靠
 * 使用 Base64 编码 + 简单混淆，防止明文暴露
 */

const Store = (() => {
  const PREFIX = 'vision_soul_';
  const SALT = 'VS2024#';

  // 简单混淆编码
  function encode(str) {
    try {
      return btoa(SALT + encodeURIComponent(str) + SALT);
    } catch (e) {
      console.error('编码失败:', e);
      return '';
    }
  }

  // 解码
  function decode(str) {
    try {
      const decoded = atob(str);
      const content = decoded.slice(SALT.length, -SALT.length);
      return decodeURIComponent(content);
    } catch (e) {
      console.error('解码失败:', e);
      return '';
    }
  }

  // 存储数据
  function save(key, value) {
    const data = typeof value === 'string' ? value : JSON.stringify(value);
    localStorage.setItem(PREFIX + key, encode(data));
  }

  // 读取数据
  function load(key) {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const decoded = decode(raw);
    try {
      return JSON.parse(decoded);
    } catch {
      return decoded;
    }
  }

  // 删除数据
  function remove(key) {
    localStorage.removeItem(PREFIX + key);
  }

  // 检查是否存在
  function has(key) {
    return localStorage.getItem(PREFIX + key) !== null;
  }

  // ========== API 配置 ==========
  function getAPIConfig() {
    return load('api_config') || {
      apiKey: '',
      baseURL: '',
      modelName: ''
    };
  }

  function saveAPIConfig(config) {
    save('api_config', config);
  }

  // ========== 角色列表（多角色） ==========
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function getCharacters() {
    return load('characters') || [];
  }

  function saveCharacters(list) {
    save('characters', list);
  }

  function getActiveCharacterId() {
    return load('active_character_id') || null;
  }

  function setActiveCharacterId(id) {
    save('active_character_id', id);
  }

  function getActiveCharacter() {
    const id = getActiveCharacterId();
    if (!id) return null;
    const list = getCharacters();
    return list.find(c => c.id === id) || null;
  }

  function addCharacter(char) {
    const list = getCharacters();
    const newChar = {
      id: generateId(),
      name: char.name || 'New Companion',
      avatar: char.avatar || '',
      background: char.background || '',
      personality: char.personality || '',
      nickname: char.nickname || '',
      createdAt: Date.now()
    };
    list.push(newChar);
    saveCharacters(list);
    if (list.length === 1) {
      setActiveCharacterId(newChar.id);
    }
    return newChar;
  }

  function updateCharacter(id, updates) {
    const list = getCharacters();
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...updates };
    saveCharacters(list);
    return list[idx];
  }

  function deleteCharacter(id) {
    let list = getCharacters();
    list = list.filter(c => c.id !== id);
    saveCharacters(list);
    remove('chat_' + id);
    remove('stickers_' + id);
    if (getActiveCharacterId() === id) {
      setActiveCharacterId(list.length > 0 ? list[0].id : null);
    }
  }

  // ========== 聊天记录（按角色隔离） ==========
  function getChatHistory(characterId) {
    const id = characterId || getActiveCharacterId();
    if (!id) return [];
    return load('chat_' + id) || [];
  }

  function addChatMessage(message, characterId) {
    const id = characterId || getActiveCharacterId();
    if (!id) return;
    const history = getChatHistory(id);
    history.push({
      ...message,
      timestamp: Date.now()
    });
    if (history.length > 200) {
      history.splice(0, history.length - 200);
    }
    save('chat_' + id, history);
  }

  function clearChatHistory(characterId) {
    const id = characterId || getActiveCharacterId();
    if (!id) return;
    save('chat_' + id, []);
  }

  // ========== AI 记忆 ==========
  const MAX_MEMORIES = 100;

  function getMemories(characterId) {
    const id = characterId || getActiveCharacterId();
    if (!id) return [];
    return load('memories_' + id) || [];
  }

  function saveMemories(memories, characterId) {
    const id = characterId || getActiveCharacterId();
    if (!id) return;
    save('memories_' + id, memories);
  }

  function addMemory(memory, characterId) {
    const id = characterId || getActiveCharacterId();
    if (!id) return;
    const memories = getMemories(id);
    memories.push({
      id: generateId(),
      text: memory.text,
      importance: memory.importance || 3,
      createdAt: Date.now()
    });
    // 按重要性降序排列
    memories.sort((a, b) => b.importance - a.importance);
    // 超出上限则删除最不重要的
    while (memories.length > MAX_MEMORIES) memories.pop();
    saveMemories(memories, id);
  }

  function updateMemory(memoryId, updates, characterId) {
    const id = characterId || getActiveCharacterId();
    if (!id) return;
    const memories = getMemories(id);
    const idx = memories.findIndex(m => m.id === memoryId);
    if (idx === -1) return;
    Object.assign(memories[idx], updates);
    memories.sort((a, b) => b.importance - a.importance);
    saveMemories(memories, id);
  }

  function deleteMemory(memoryId, characterId) {
    const id = characterId || getActiveCharacterId();
    if (!id) return;
    const memories = getMemories(id);
    const filtered = memories.filter(m => m.id !== memoryId);
    saveMemories(filtered, id);
  }

  function getMemoryCounter(characterId) {
    const id = characterId || getActiveCharacterId();
    if (!id) return 0;
    return load('memory_counter_' + id) || 0;
  }

  function setMemoryCounter(count, characterId) {
    const id = characterId || getActiveCharacterId();
    if (!id) return;
    save('memory_counter_' + id, count);
  }

  // ========== 行为记录 ==========
  function getBehaviorLog() {
    return load('behavior_log') || [];
  }

  function addBehavior(behavior) {
    const log = getBehaviorLog();
    log.push({
      ...behavior,
      timestamp: Date.now()
    });
    if (log.length > 500) {
      log.splice(0, log.length - 500);
    }
    save('behavior_log', log);
  }

  // ========== 表情包库（按角色存储） ==========
  function getStickers(charId) {
    if (!charId) charId = getActiveCharacterId();
    if (!charId) return [];
    // 迁移旧全局数据（一次性）
    const oldGlobal = load('stickers');
    if (Array.isArray(oldGlobal) && oldGlobal.length > 0) {
      save('stickers_' + charId, oldGlobal);
      remove('stickers');
    }
    return load('stickers_' + charId) || [];
  }

  function addSticker(sticker, charId) {
    if (!charId) charId = getActiveCharacterId();
    if (!charId) return [];
    const list = getStickers(charId);
    const entry = {
      id: generateId(),
      type: sticker.type || 'image',
      meaning: sticker.meaning,
      createdAt: Date.now()
    };
    if (sticker.type === 'text') {
      entry.text = sticker.text;
    } else {
      entry.image = sticker.image;
    }
    list.push(entry);
    save('stickers_' + charId, list);
    return list;
  }

  function deleteSticker(id, charId) {
    if (!charId) charId = getActiveCharacterId();
    if (!charId) return [];
    let list = getStickers(charId);
    list = list.filter(s => s.id !== id);
    save('stickers_' + charId, list);
    return list;
  }

  // ========== 用户身份 ==========
  function getUserProfile() {
    return load('user_profile') || {
      avatar: '',
      nickname: '',
      identity: ''
    };
  }

  function saveUserProfile(profile) {
    save('user_profile', profile);
  }

  // ========== 设置项 ==========
  function getSettings() {
    const defaults = {
      captureInterval: 20,
      privacyMode: false,
      dynamicFrequency: true,
      bubbleDuration: 5,
      contextCount: 25
    };
    const stored = load('settings');
    return stored ? { ...defaults, ...stored } : defaults;
  }

  function saveSettings(settings) {
    save('settings', settings);
  }

  // ========== 引导完成标记 ==========
  function isOnboarded() {
    return load('onboarded') === true;
  }

  function setOnboarded() {
    save('onboarded', true);
  }

  // ========== 数据导入导出 ==========
  function exportAllData() {
    const chars = getCharacters();
    const exportData = {
      version: 1,
      exportTime: Date.now(),
      apiConfig: getAPIConfig(),
      settings: getSettings(),
      activeCharacterId: getActiveCharacterId(),
      onboarded: isOnboarded(),
      userProfile: getUserProfile(),
      characters: chars,
      chatHistories: {},
      stickers: {}
    };

    for (const char of chars) {
      exportData.chatHistories[char.id] = getChatHistory(char.id);
      exportData.stickers[char.id] = getStickers(char.id);
    }

    return exportData;
  }

  function importAllData(data) {
    if (!data || data.version !== 1) {
      throw new Error('无效的备份文件格式');
    }

    if (data.apiConfig) saveAPIConfig(data.apiConfig);
    if (data.settings) saveSettings(data.settings);
    if (data.userProfile) saveUserProfile(data.userProfile);
    if (data.onboarded) setOnboarded();

    if (Array.isArray(data.characters)) {
      saveCharacters(data.characters);
    }

    if (data.activeCharacterId) {
      setActiveCharacterId(data.activeCharacterId);
    }

    if (data.chatHistories) {
      for (const [charId, messages] of Object.entries(data.chatHistories)) {
        if (Array.isArray(messages)) {
          save('chat_' + charId, messages);
        }
      }
    }

    if (data.stickers) {
      for (const [charId, stickers] of Object.entries(data.stickers)) {
        if (Array.isArray(stickers)) {
          save('stickers_' + charId, stickers);
        }
      }
    }

    return true;
  }

  return {
    save, load, remove, has,
    getAPIConfig, saveAPIConfig,
    getCharacters, addCharacter, updateCharacter, deleteCharacter,
    getActiveCharacterId, setActiveCharacterId, getActiveCharacter,
    getChatHistory, addChatMessage, clearChatHistory,
    getMemories, saveMemories, addMemory, updateMemory, deleteMemory,
    getMemoryCounter, setMemoryCounter,
    getBehaviorLog, addBehavior,
    getStickers, addSticker, deleteSticker,
    getUserProfile, saveUserProfile,
    getSettings, saveSettings,
    isOnboarded, setOnboarded,
    exportAllData, importAllData
  };
})();
