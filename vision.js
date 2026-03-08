/**
 * vision.js - 屏幕采样模块
 * Electron 模式：通过 desktopCapturer（无需授权）
 * 浏览器模式：通过 getDisplayMedia（需要用户授权）
 * 支持动态频率（屏幕无变化时跳过）和隐私模式
 */

const Vision = (() => {
  const isElectron = !!(window.electronAPI && window.electronAPI.isElectron);

  // 浏览器模式专用
  let stream = null;
  let videoEl = null;

  // 共用
  let canvas = null;
  let ctx = null;
  let timeoutId = null;        // 改用 setTimeout 实现随机间隔
  let isActive = false;
  let isPaused = false;         // 用户交互时暂停
  let lastFrameData = '';
  let lastCaptureBase64 = '';
  let onFrameCallback = null;

  // 连续帧变化追踪
  let recentChangeRates = [];   // 最近几帧的变化率
  const MAX_CHANGE_HISTORY = 5;

  const THUMB_WIDTH = 512;

  // ========== 启动 ==========
  async function start(onFrame) {
    if (isActive) return { ok: true };
    onFrameCallback = onFrame || null;

    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');

    if (isElectron) {
      // Electron 模式：直接通过主进程截屏，无需授权
      isActive = true;
      startInterval();
      return { ok: true };
    } else {
      // 浏览器模式：需要用户授权
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'never', frameRate: { ideal: 1, max: 5 } },
          audio: false
        });
      } catch (err) {
        console.warn('Screen capture denied or unavailable:', err.name);
        return { ok: false, reason: err.name === 'NotAllowedError' ? 'denied' : 'unavailable' };
      }

      videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.play();

      isActive = true;

      stream.getVideoTracks()[0].addEventListener('ended', () => { stop(); });

      startInterval();
      return { ok: true };
    }
  }

  // ========== 停止 ==========
  function stop() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl = null;
    }
    canvas = null;
    ctx = null;
    isActive = false;
    isPaused = false;
    lastFrameData = '';
    lastCaptureBase64 = '';
    recentChangeRates = [];
  }

  // ========== 暂停 / 恢复（用户交互时暂停） ==========
  function pause() {
    isPaused = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function resume() {
    isPaused = false;
    if (isActive) scheduleNext();
  }

  // ========== 随机间隔截帧 ==========
  function scheduleNext() {
    if (timeoutId) clearTimeout(timeoutId);
    if (!isActive || isPaused) return;

    // 随机间隔：30~90 秒（用户设置的间隔作为基准的下限）
    const settings = Store.getSettings();
    const baseMs = (settings.captureInterval || 30) * 1000;
    const minMs = Math.max(baseMs, 20000);       // 至少 20 秒
    const maxMs = Math.max(minMs * 3, 90000);     // 最大 3 倍或 90 秒
    const ms = minMs + Math.random() * (maxMs - minMs);

    timeoutId = setTimeout(async () => {
      if (!isActive || isPaused) return;

      const settings = Store.getSettings();
      if (settings.privacyMode) {
        scheduleNext();
        return;
      }

      await captureFrame();
      scheduleNext();
    }, ms);
  }

  function startInterval() {
    scheduleNext();
  }

  // ========== 单次截帧 ==========
  async function captureFrame() {
    let base64 = null;

    if (isElectron) {
      // Electron：通过主进程 IPC 截屏
      base64 = await window.electronAPI.captureScreen();
      if (!base64) return null;
      lastCaptureBase64 = base64;
    } else {
      // 浏览器：从 video 流截帧
      if (!videoEl || videoEl.readyState < 2) return null;
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      if (!vw || !vh) return null;

      const scale = THUMB_WIDTH / vw;
      const tw = THUMB_WIDTH;
      const th = Math.round(vh * scale);
      canvas.width = tw;
      canvas.height = th;
      ctx.drawImage(videoEl, 0, 0, tw, th);

      base64 = canvas.toDataURL('image/jpeg', 0.7);
      lastCaptureBase64 = base64;
    }

    // 计算与上一帧的变化率
    let changeRate = 1;
    if (lastFrameData) {
      changeRate = computeChangeRate(lastFrameData, base64);
      recentChangeRates.push(changeRate);
      while (recentChangeRates.length > MAX_CHANGE_HISTORY) {
        recentChangeRates.shift();
      }
    }

    // 动态频率：如果变化极小则跳过
    const settings = Store.getSettings();
    if (settings.dynamicFrequency && lastFrameData && changeRate < 0.02) {
      return null;
    }
    lastFrameData = base64;

    // 生成动态内容提示给 AI
    let dynamicHint = '';
    if (recentChangeRates.length >= 3) {
      const avgChange = recentChangeRates.reduce((a, b) => a + b, 0) / recentChangeRates.length;
      if (avgChange > 0.15) {
        dynamicHint = 'CONTEXT: The screen has been changing rapidly across recent captures — the user is likely watching a video, animation, or scrolling through content. Do NOT treat on-screen text as user input.';
      } else if (avgChange < 0.03) {
        dynamicHint = 'CONTEXT: The screen has barely changed recently — the user might be idle, reading, or AFK.';
      }
    }

    if (onFrameCallback) {
      onFrameCallback(base64, dynamicHint);
    }

    return base64;
  }

  // ========== 帧变化率计算 ==========
  function computeChangeRate(prev, curr) {
    const lenDiff = Math.abs(prev.length - curr.length) / Math.max(prev.length, 1);
    // 抽样多个位置比较
    let diffCount = 0;
    const samples = 10;
    for (let i = 0; i < samples; i++) {
      const pos = Math.floor((prev.length * (i + 1)) / (samples + 1));
      const sampleLen = 100;
      const s1 = prev.substring(pos, pos + sampleLen);
      const s2 = curr.substring(pos, pos + sampleLen);
      if (s1 !== s2) diffCount++;
    }
    return Math.max(lenDiff, diffCount / samples);
  }

  // ========== 简单变化检测 ==========
  function framesAreSimilar(prev, curr) {
    const lenDiff = Math.abs(prev.length - curr.length) / Math.max(prev.length, 1);
    if (lenDiff > 0.05) return false;

    const sampleStart = Math.floor(prev.length * 0.3);
    const sampleLen = 200;
    const s1 = prev.substring(sampleStart, sampleStart + sampleLen);
    const s2 = curr.substring(sampleStart, sampleStart + sampleLen);
    return s1 === s2;
  }

  // ========== 获取当前帧预览 ==========
  function getCurrentPreview() {
    if (!isActive) return '';

    if (isElectron) {
      return lastCaptureBase64 || '';
    }

    // 浏览器模式：实时从 video 取小图
    if (!videoEl || videoEl.readyState < 2) return lastCaptureBase64 || '';
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) return lastCaptureBase64 || '';

    const scale = 256 / vw;
    canvas.width = 256;
    canvas.height = Math.round(vh * scale);
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.5);
  }

  // ========== 更新截帧间隔 ==========
  function updateInterval() {
    if (isActive) startInterval();
  }

  // ========== 状态查询 ==========
  function getStatus() {
    return {
      active: isActive,
      hasStream: isElectron ? isActive : !!stream
    };
  }

  return {
    start,
    stop,
    pause,
    resume,
    captureFrame,
    getCurrentPreview,
    updateInterval,
    getStatus
  };
})();
