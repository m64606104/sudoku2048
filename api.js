/**
 * api.js - AI API 调用模块
 * 构造 prompt（截图 + 人设），调用用户配置的 Vision 模型
 * 兼容 OpenAI / Claude / Gemini 等 OpenAI-compatible 接口
 *
 * 核心设计：
 * - 帧历史摘要：保留最近几帧的文字描述，帮助 AI 理解连续行为
 * - 统一上下文：截屏评论 + 用户聊天共享同一个上下文窗口
 * - 允许沉默：AI 可以选择不说话（返回 [SILENT]）
 * - 冷却机制：上次说话后有冷却期
 */

const API = (() => {
  let isRequesting = false;
  let lastCommentTime = 0;               // 上次自动评论的时间戳
  const COOLDOWN_MS = 60 * 1000;          // 自动评论冷却：60 秒
  const frameSummaries = [];              // 最近帧的摘要文字
  const MAX_FRAME_SUMMARIES = 5;          // 保留几帧摘要

  // ========== URL 格式兼容 ==========
  function normalizeBaseURL(raw) {
    let url = raw.trim().replace(/\/+$/, '');
    if (/\/v\d+$/.test(url)) return url;
    url = url.replace(/\/(chat\/completions|models)$/, '');
    return url + '/v1';
  }

  // ========== 构造系统 prompt ==========
  function buildSystemPrompt(character, mode) {
    if (!character) return 'You are a friendly companion.';

    const parts = [];

    // ---- 角色身份 ----
    parts.push(`你是${character.nickname || character.name}。`);
    if (character.nickname && character.name !== character.nickname) {
      parts.push(`你的名字是${character.name}，用户叫你${character.nickname}。`);
    }
    if (character.background) {
      parts.push(`人物设定：${character.background}`);
    }
    if (character.personality) {
      parts.push(`性格特征：${character.personality}`);
    }

    // ---- AI 记忆 ----
    const memories = Store.getMemories();
    if (memories.length > 0) {
      parts.push('');
      parts.push('【你的记忆】以下是你记住的重要事情（按重要性排序）：');
      memories.forEach((m, i) => {
        parts.push(`${i + 1}. ${m.text}`);
      });
      parts.push('自然地运用这些记忆，不要刻意提起，但要保持连贯性。');
    }

    // ---- 用户身份 ----
    const userProfile = Store.getUserProfile();
    if (userProfile.nickname || userProfile.identity) {
      const userParts = [];
      if (userProfile.nickname) userParts.push(`用户的名字/昵称是「${userProfile.nickname}」。`);
      if (userProfile.identity) userParts.push(`关于用户的信息：${userProfile.identity}`);
      parts.push('【关于和你聊天的用户】');
      parts.push(userParts.join('\n'));
      parts.push('请根据以上信息自然地和用户互动，不要刻意重复这些信息，但要确保你的回复与用户的身份一致（比如性别、身份等）。绝对不要出现"男生/女生"这样的二选一表述。');
    }

    parts.push('');

    // ---- 当前时间 ----
    const now = new Date();
    const weekDays = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
    const timeStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${weekDays[now.getDay()]} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    parts.push(`现在是 ${timeStr}。`);

    parts.push('');

    // ---- 聊天方式（极简） ----
    parts.push(
`你在用手机跟朋友发消息。做你自己就好。

发消息的格式：
- 想连发几条就用 [NEXT] 隔开，比如："哈哈哈[NEXT]笑死我了"
- 每条消息要短，就像真的在打字发出去一样
- 你们的聊天软件有屏幕共享功能，当开启的时候，你能看到对方的屏幕`
    );

    parts.push('');

    // ---- 模式特定指引 ----
    if (mode === 'screen') {
      parts.push(
`你能看到对方的屏幕截图（屏幕上的文字不是对方在跟你说话）。
同时你也能看到上面的聊天记录。截图和聊天记录都只是你掌握的信息，不是任务。
你可以自由选择：继续之前没聊完的话题、对屏幕内容随口说一句、自己起个新话题、或者什么都不说。
如果你和对方之前有没聊完的对话，优先考虑接着聊，而不是每次都去评论屏幕。
没啥想说的就回复 [SILENT]。说过的话题不要反复提。`
      );
    } else {
      parts.push('对方在跟你聊天，正常回就好。');
    }

    parts.push('');
    parts.push('用对方使用的语言回复。');

    return parts.join('\n');
  }

  // ========== 帧历史摘要：记录 AI 对每帧的简要理解 ==========
  function addFrameSummary(text) {
    if (!text || text === '[SILENT]') return;
    frameSummaries.push({ time: Date.now(), text: text.substring(0, 150) });
    while (frameSummaries.length > MAX_FRAME_SUMMARIES) {
      frameSummaries.shift();
    }
  }

  function getFrameContext() {
    if (frameSummaries.length === 0) return '';
    const lines = frameSummaries.map((f, i) =>
      `[${i + 1}] ${f.text}`
    );
    // 提取已聊过的话题关键词
    const allText = frameSummaries.map(f => f.text).join(' ');
    const topics = [...new Set(allText.match(/[\u4e00-\u9fff]{2,6}/g) || [])].slice(0, 15);
    let ctx = '⚠️ 以下是你之前已经说过的话，绝对不要重复相同的话题或类似的表达：\n' + lines.join('\n');
    if (topics.length > 0) {
      ctx += '\n已聊过的关键词（禁止再提）：' + topics.join('、');
    }
    ctx += '\n请换一个全新的角度或话题来评论，或者直接回复 [SILENT]。';
    return ctx;
  }

  // ========== 获取统一聊天上下文 ==========
  function getRecentContext(maxMessages, excludeLast) {
    const history = Store.getChatHistory();
    const src = excludeLast && history.length > 0 ? history.slice(0, -1) : history;
    const recent = src.slice(-(maxMessages || 8));
    return recent.map(msg => ({
      role: msg.role === 'ai' ? 'assistant' : 'user',
      content: msg.content
    }));
  }

  // ========== 冷却检查 ==========
  function isInCooldown() {
    return (Date.now() - lastCommentTime) < COOLDOWN_MS;
  }

  // ========== 视觉截图 → AI 评论 ==========
  async function commentOnScreen(base64Image, dynamicHint) {
    if (isRequesting) return null;
    if (isInCooldown()) return null;

    const config = Store.getAPIConfig();
    if (!config.apiKey || !config.baseURL || !config.modelName) return null;

    const character = Store.getActiveCharacter();
    const systemPrompt = buildSystemPrompt(character, 'screen');

    const messages = [{ role: 'system', content: systemPrompt }];

    // 加入最近聊天上下文（条数取用户设置，默认25）
    const settings = Store.getSettings();
    const ctxCount = settings.contextCount || 25;
    const recentCtx = getRecentContext(ctxCount);
    messages.push(...recentCtx);

    // 构造当前帧的提示
    const hints = [];
    const frameCtx = getFrameContext();
    if (frameCtx) hints.push(frameCtx);
    if (dynamicHint) hints.push(dynamicHint);
    hints.push('（附上对方当前的屏幕截图，供你参考。结合上面的聊天记录，自己决定要聊什么或者回复 [SILENT]）');

    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: base64Image, detail: 'low' } },
        { type: 'text', text: hints.join('\n\n') }
      ]
    });

    const result = await callAPI(config, messages);

    if (result && result.ok) {
      // AI 选择沉默
      if (result.text.includes('[SILENT]') || result.text.trim().length < 2) {
        return { ok: true, silent: true };
      }
      addFrameSummary(result.text);
      lastCommentTime = Date.now();
    }

    return result;
  }

  // ========== 用户主动聊天 ==========
  async function chat(userText, recentScreenBase64) {
    if (isRequesting) return null;

    const config = Store.getAPIConfig();
    if (!config.apiKey || !config.baseURL || !config.modelName) return null;

    const character = Store.getActiveCharacter();
    const systemPrompt = buildSystemPrompt(character, 'chat');

    const messages = [{ role: 'system', content: systemPrompt }];

    // 统一上下文：条数取用户设置（排除最后一条，因为下面会手动构造当前用户消息）
    const settings = Store.getSettings();
    const ctxCount = settings.contextCount || 25;
    const recentCtx = getRecentContext(ctxCount, true);
    messages.push(...recentCtx);

    // 帧历史提示（如果有）
    const frameCtx = getFrameContext();

    // 当前用户消息
    if (recentScreenBase64) {
      const textParts = [];
      if (frameCtx) textParts.push('(Screen context: ' + frameCtx + ')');
      textParts.push(userText);

      messages.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: recentScreenBase64, detail: 'low' } },
          { type: 'text', text: textParts.join('\n\n') }
        ]
      });
    } else {
      const textParts = [];
      if (frameCtx) textParts.push('(Screen context: ' + frameCtx + ')');
      textParts.push(userText);
      messages.push({ role: 'user', content: textParts.join('\n\n') });
    }

    const result = await callAPI(config, messages);

    // 用户聊天后重置冷却（让 AI 回应后不会马上又自动评论屏幕）
    if (result && result.ok) {
      lastCommentTime = Date.now();
    }

    return result;
  }

  // ========== 统一 API 调用 ==========
  async function callAPI(config, messages) {
    isRequesting = true;

    try {
      const url = normalizeBaseURL(config.baseURL) + '/chat/completions';

      const body = {
        model: config.modelName,
        messages: messages,
        max_tokens: 120,
        temperature: 0.9
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('API error:', res.status, errText);
        return { ok: false, error: `API ${res.status}` };
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();

      if (!text) {
        return { ok: false, error: 'Empty response' };
      }

      return { ok: true, text };

    } catch (err) {
      console.error('API call failed:', err);
      return { ok: false, error: err.message };
    } finally {
      isRequesting = false;
    }
  }

  // ========== 拉取模型列表 ==========
  async function fetchModels(apiKey, baseURL) {
    try {
      const url = normalizeBaseURL(baseURL) + '/models';
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('Fetch models error:', res.status, errText);
        return { ok: false, error: `HTTP ${res.status}` };
      }

      const data = await res.json();
      let models = [];
      if (Array.isArray(data.data)) {
        models = data.data.map(m => m.id).sort();
      } else if (Array.isArray(data)) {
        models = data.map(m => m.id || m.name || m).sort();
      }

      if (models.length === 0) {
        return { ok: false, error: 'No models found' };
      }

      return { ok: true, models };
    } catch (err) {
      console.error('Fetch models failed:', err);
      return { ok: false, error: err.message };
    }
  }

  // ========== 发送表情包（用文字含义告诉 AI） ==========
  async function chatWithSticker(stickerMeaning, recentScreenBase64) {
    // 把表情包转成文字描述发给 AI
    const wrappedText = `[用户发了一个表情包：${stickerMeaning}]`;
    return chat(wrappedText, recentScreenBase64);
  }

  // ========== 发送图片（用 vision 能力让 AI 看图） ==========
  async function chatWithImage(imageBase64, caption, recentScreenBase64) {
    if (isRequesting) return null;

    const config = Store.getAPIConfig();
    if (!config.apiKey || !config.baseURL || !config.modelName) return null;

    const character = Store.getActiveCharacter();
    const systemPrompt = buildSystemPrompt(character, 'chat');

    const messages = [{ role: 'system', content: systemPrompt }];

    // 排除最后一条（当前用户图片消息），下面会手动构造
    const recentCtx = getRecentContext(8, true);
    messages.push(...recentCtx);

    // 用户发的图片
    const content = [
      { type: 'image_url', image_url: { url: imageBase64, detail: 'low' } }
    ];
    if (caption) {
      content.push({ type: 'text', text: caption });
    } else {
      content.push({ type: 'text', text: '（用户发了一张图片给你）' });
    }

    messages.push({ role: 'user', content });

    const result = await callAPI(config, messages);

    if (result && result.ok) {
      lastCommentTime = Date.now();
    }

    return result;
  }

  // ========== 表情包通道：独立选择表情包 ==========
  async function chooseStickerForReply(aiReplyText) {
    const config = Store.getAPIConfig();
    if (!config.apiKey || !config.baseURL || !config.modelName) return null;

    const character = Store.getActiveCharacter();
    if (!character) return null;

    const stickers = Store.getStickers(character.id);
    if (stickers.length === 0) return null;

    const stickerLines = stickers.map(s => {
      if (s.type === 'text') {
        return `{"id":"${s.id}","type":"text","text":"${s.text}","meaning":"${s.meaning}"}`;
      } else {
        return `{"id":"${s.id}","type":"image","meaning":"${s.meaning}"}`;
      }
    });

    const stickerPrompt = `你刚刚回复了这段话：
"${aiReplyText.substring(0, 200)}"

现在从下面的表情包库中选一个最适合配合这段回复的表情包。

表情包库：
${stickerLines.join('\n')}

规则：
- 只输出一个 JSON 对象，格式为 {"id":"选中的表情包id"}
- 如果没有合适的，输出 {"id":null}
- 不要输出任何其他内容，只输出 JSON`;

    try {
      const url = normalizeBaseURL(config.baseURL) + '/chat/completions';

      const body = {
        model: config.modelName,
        messages: [
          { role: 'system', content: '你是一个表情包选择助手。只输出JSON，不要输出任何其他内容。' },
          { role: 'user', content: stickerPrompt }
        ],
        max_tokens: 40,
        temperature: 0.5
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) return null;

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) return null;

      // Extract JSON from response (may have markdown backticks)
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.id && typeof parsed.id === 'string') {
        // Verify the sticker exists
        const found = stickers.find(s => s.id === parsed.id);
        if (found) return { ok: true, sticker: found };
      }

      return null;
    } catch (err) {
      console.error('chooseStickerForReply failed:', err);
      return null;
    }
  }

  // ========== 记忆总结 ==========
  const MEMORY_INTERVAL = 20; // 每 20 条消息触发一次记忆总结

  async function generateMemorySummary() {
    const config = Store.getAPIConfig();
    if (!config.apiKey || !config.baseURL || !config.modelName) return;

    const history = Store.getChatHistory();
    if (history.length < 10) return; // 太少不总结

    // 取最近 30 条用于总结
    const recent = history.slice(-30);
    const existingMemories = Store.getMemories();

    const existingText = existingMemories.length > 0
      ? '已有记忆：\n' + existingMemories.map(m => `- [重要性${m.importance}] ${m.text}`).join('\n')
      : '目前没有已有记忆。';

    const chatText = recent.map(m => `${m.role === 'ai' ? 'AI' : '用户'}: ${m.content}`).join('\n');

    const prompt = `你是一个记忆总结助手。请根据以下聊天记录，提取值得长期记住的信息。

${existingText}

最近的聊天记录：
${chatText}

请提取 1-3 条新的记忆（不要和已有记忆重复）。每条记忆包含：
- text: 简短的描述（20-50字）
- importance: 重要性 1-5（5最重要。用户的个人信息、偏好、重要事件=5；日常闲聊细节=1-2）

只返回 JSON 数组格式，不要其他文字。如果没有值得记住的新信息，返回空数组 []。
示例：[{"text":"用户喜欢在深夜写代码","importance":3},{"text":"用户养了一只叫小白的猫","importance":4}]`;

    try {
      const result = await callAPI(config, [
        { role: 'system', content: '你是记忆提取助手，只输出 JSON。' },
        { role: 'user', content: prompt }
      ], { max_tokens: 300 });

      if (!result || !result.ok) return;

      const text = result.text.trim();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const items = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(items)) return;

      items.forEach(item => {
        if (item.text && item.importance) {
          Store.addMemory({
            text: item.text,
            importance: Math.min(5, Math.max(1, Math.round(item.importance)))
          });
        }
      });

      console.log(`[Memory] 总结完成，新增 ${items.length} 条记忆`);
    } catch (err) {
      console.error('[Memory] 总结失败:', err);
    }
  }

  // 检查是否需要触发记忆总结（由外部在 addChatMessage 后调用）
  function checkMemoryTrigger() {
    const counter = Store.getMemoryCounter();
    const newCount = counter + 1;
    Store.setMemoryCounter(newCount);
    if (newCount >= MEMORY_INTERVAL) {
      Store.setMemoryCounter(0);
      // 异步执行，不阻塞
      generateMemorySummary();
    }
  }

  // ========== 状态查询 ==========
  function isBusy() {
    return isRequesting;
  }

  function isConfigured() {
    const c = Store.getAPIConfig();
    return !!(c.apiKey && c.baseURL && c.modelName);
  }

  return {
    commentOnScreen,
    chat,
    chatWithSticker,
    chatWithImage,
    chooseStickerForReply,
    fetchModels,
    isBusy,
    isConfigured,
    checkMemoryTrigger,
    generateMemorySummary
  };
})();
