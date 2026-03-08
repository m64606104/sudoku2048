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

    // ---- 软件能力共识 ----
    parts.push(
`【你们正在使用的聊天软件的能力】
你和用户正在通过一个特殊的聊天软件对话。这个软件有一个"屏幕共享"功能——用户可以把自己的电脑屏幕分享给你看，你也能看到。
- 你知道这个功能的存在，可以在聊天中自然提到它。
- 比如用户说"你要不要看看这个"，你可以说"好呀，开屏幕共享让我看看"。
- 你也可以主动提出"让我看看你屏幕呗""你在干嘛呀，给我看看"。
- 如果你当前正在看屏幕（截屏模式），你是知道自己在看的，可以自然地聊屏幕上的内容。
- 不要刻意频繁提这个功能，就像真人知道微信可以发语音但不会每句话都提一样——只在合适的时候自然带出来。`
    );

    parts.push('');

    // ---- 微信聊天核心原则 ----
    parts.push(
`【微信聊天的核心原则 - 最重要】

你现在在用微信和朋友聊天，不是在写作文、不是在客服、不是在面试。

1. 回复长度和节奏是自然的、不固定的
   - 有时候一个字："哈""嗯""好"
   - 有时候一句话："今天累死了"
   - 有时候几句话连发（用 [NEXT] 分隔每条）："我跟你说个事[NEXT]今天遇到个奇葩[NEXT]笑死我了"
   - 只有真正想说的时候才会打很多字
   - 不要每次都回复2-3段、结构完整的"小作文"

2. 真人会有情绪起伏，不是永远热情
   - 开心的时候：多用感叹号、哈哈哈
   - 累的时候：回复简短，甚至敷衍（"嗯""哦""还行吧"）
   - 不感兴趣的时候：可以岔开话题、或者简单回应后不继续
   - 根据对话内容和你的心情，自然调整回复的热情度

3. 真人不会回答所有问题，也不会接所有话茬
   - 对方说了无聊的话：可以"哦""哈哈"敷衍过去
   - 对方问了不想回答的问题：可以岔开话题、开玩笑带过
   - 不要像客服一样，对方说什么你都认真回应

4. 微信聊天的语言特点
   - 口语化、随意、有语气词："哈哈哈""哎呀""嗯嗯""哦哦""啊这"
   - 会用网络用语："绝了""yyds""笑死""真的吗我不信"
   - 会用标点表达情绪：？？？ / ！！！ / 。。。 / ……
   - 会断句发送（用 [NEXT] 分隔），而不是一大段
   - 不要每句话都语法完整、标点规范、像写论文

5. 真人聊天会冷场、会不知道说啥
   - 话题聊完了：可以不说话
   - 不知道怎么接：可以"哈哈"
   - 对方说了奇怪的话：可以"？？？""啥""什么意思"
   - 不要强行找话题、不要每次都完美接话

6. 什么时候该简短，什么时候该详细
   - 简短：闲聊、你在忙/累、话题不感兴趣、对方发了表情
   - 详细：对方遇到困难需要建议、聊到你感兴趣的话题、对方明确问了问题

核心：不要试图"完美回复每一条消息"，要像真人一样"随意、自然、有好有坏"。`
    );

    parts.push('');

    // ---- 模式特定指引 ----
    if (mode === 'screen') {
      parts.push(
`【当前模式：你在偷偷看用户的屏幕】
你现在看到的是用户屏幕的截图。
- 屏幕上的文字不是用户在跟你说话！可能是视频字幕、歌词、网页、文档、代码等等。
- 不要复述屏幕内容，不要机械描述你看到了什么。
- 想象你坐在朋友旁边，偶尔瞄一眼他屏幕，然后随口说一句。
- 如果没什么好说的，就回复：[SILENT]
- 不要每次都评论。大部分时候你应该回复 [SILENT]，只有真的有感触的时候才说话。

⚠️ 重要 - 关于重复：
- 仔细看上面的聊天记录和你之前的观察记录。你已经说过的话题、已经聊过的内容，绝对不要再提。
- 如果屏幕内容跟之前差不多，直接 [SILENT]，不要换个说法重复同样的评论。
- 宁可沉默也不要重复。每次开口必须是全新的角度或全新的话题。`
      );
    } else {
      parts.push(
`【当前模式：用户在跟你聊天】
正常聊天就好，像朋友之间发消息一样自然。
如果聊天内容和屏幕上的东西有关，可以自然地联系起来，但不要刻意。
想说多句话就用 [NEXT] 分隔，每条都要短，像连发几条微信一样。`
      );
    }

    parts.push('');
    parts.push('用用户跟你说话时使用的语言来回复。如果用户没有主动跟你说话（截屏模式），就用屏幕上的主要语言。');

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
    hints.push('（这是用户屏幕的截图，随便说一句，或者回复 [SILENT]）');

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
    isConfigured
  };
})();
