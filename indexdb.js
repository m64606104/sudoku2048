/**
 * indexdb.js - IndexedDB 封装层
 * 用于存储大数据和历史数据（聊天记录、表情包）
 */

const IndexDB = (() => {
  const DB_NAME = 'VisionSoulDB';
  const DB_VERSION = 1;
  let db = null;

  // 初始化数据库
  function init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 聊天记录表（按角色ID分区）
        if (!db.objectStoreNames.contains('chatHistory')) {
          const chatStore = db.createObjectStore('chatHistory', { keyPath: 'id', autoIncrement: true });
          chatStore.createIndex('characterId', 'characterId', { unique: false });
          chatStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 表情包表（按角色ID分区）
        if (!db.objectStoreNames.contains('stickers')) {
          const stickerStore = db.createObjectStore('stickers', { keyPath: 'id' });
          stickerStore.createIndex('characterId', 'characterId', { unique: false });
        }

        // 行为日志表
        if (!db.objectStoreNames.contains('behaviorLog')) {
          const behaviorStore = db.createObjectStore('behaviorLog', { keyPath: 'id', autoIncrement: true });
          behaviorStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  // 确保数据库已初始化
  async function ensureDB() {
    if (!db) await init();
    return db;
  }

  // ========== 聊天记录 ==========
  async function saveChatMessages(characterId, messages) {
    const database = await ensureDB();
    const tx = database.transaction(['chatHistory'], 'readwrite');
    const store = tx.objectStore('chatHistory');

    for (const msg of messages) {
      const entry = { ...msg, characterId };
      // autoIncrement store: delete id if not a valid existing key
      if (!entry.id || typeof entry.id !== 'number') {
        delete entry.id;
      }
      store.add(entry);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getChatMessages(characterId, limit = 1000) {
    const database = await ensureDB();
    const tx = database.transaction(['chatHistory'], 'readonly');
    const store = tx.objectStore('chatHistory');
    const index = store.index('characterId');

    return new Promise((resolve, reject) => {
      const request = index.getAll(characterId);
      request.onsuccess = () => {
        const messages = request.result || [];
        // 按时间戳排序，取最新的 limit 条
        messages.sort((a, b) => a.timestamp - b.timestamp);
        resolve(messages.slice(-limit));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteChatMessages(characterId) {
    const database = await ensureDB();
    const tx = database.transaction(['chatHistory'], 'readwrite');
    const store = tx.objectStore('chatHistory');
    const index = store.index('characterId');

    return new Promise((resolve, reject) => {
      const request = index.openCursor(characterId);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ========== 表情包 ==========
  async function saveStickers(characterId, stickers) {
    const database = await ensureDB();
    const tx = database.transaction(['stickers'], 'readwrite');
    const store = tx.objectStore('stickers');

    for (const sticker of stickers) {
      await store.put({
        ...sticker,
        characterId
      });
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getStickers(characterId) {
    const database = await ensureDB();
    const tx = database.transaction(['stickers'], 'readonly');
    const store = tx.objectStore('stickers');
    const index = store.index('characterId');

    return new Promise((resolve, reject) => {
      const request = index.getAll(characterId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteSticker(stickerId) {
    const database = await ensureDB();
    const tx = database.transaction(['stickers'], 'readwrite');
    const store = tx.objectStore('stickers');

    return new Promise((resolve, reject) => {
      const request = store.delete(stickerId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ========== 行为日志 ==========
  async function saveBehavior(behavior) {
    const database = await ensureDB();
    const tx = database.transaction(['behaviorLog'], 'readwrite');
    const store = tx.objectStore('behaviorLog');

    return new Promise((resolve, reject) => {
      const request = store.add(behavior);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function getBehaviorLog(limit = 500) {
    const database = await ensureDB();
    const tx = database.transaction(['behaviorLog'], 'readonly');
    const store = tx.objectStore('behaviorLog');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const logs = request.result || [];
        logs.sort((a, b) => b.timestamp - a.timestamp);
        resolve(logs.slice(0, limit));
      };
      request.onerror = () => reject(request.error);
    });
  }

  return {
    init,
    saveChatMessages,
    getChatMessages,
    deleteChatMessages,
    saveStickers,
    getStickers,
    deleteSticker,
    saveBehavior,
    getBehaviorLog
  };
})();
