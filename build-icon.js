/**
 * 生成应用图标（PNG）用于桌面快捷方式和打包
 * 运行：node build-icon.js
 */
const { createCanvas } = (() => {
  try { return require('canvas'); } catch(e) { return { createCanvas: null }; }
})();

// 如果没有 canvas 模块，用纯 JS 生成一个简单的 PNG
// 我们用内联 base64 的方式直接写一个图标文件
const fs = require('fs');
const path = require('path');

// 一个紫色渐变眼睛图标的 base64 PNG（512x512）
// 由于无法在 Node 里画 canvas，我们生成一个 SVG 然后提示用户
const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1a2e"/>
      <stop offset="100%" stop-color="#0c0c14"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7c6df5"/>
      <stop offset="100%" stop-color="#a78bfa"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="110" fill="url(#bg)"/>
  <g transform="translate(256,256)">
    <!-- Eye shape -->
    <ellipse rx="140" ry="80" fill="none" stroke="url(#glow)" stroke-width="12" opacity="0.9"/>
    <!-- Iris -->
    <circle r="50" fill="url(#glow)" opacity="0.85"/>
    <!-- Pupil -->
    <circle r="22" fill="#1a1a2e"/>
    <!-- Highlight -->
    <circle cx="-12" cy="-14" r="10" fill="white" opacity="0.7"/>
    <!-- Small sparkle -->
    <circle cx="18" cy="10" r="5" fill="white" opacity="0.4"/>
  </g>
  <!-- "VS" text -->
  <text x="256" y="430" text-anchor="middle" font-family="system-ui, sans-serif" font-size="48" font-weight="700" fill="#7c6df5" opacity="0.6">Vision Soul</text>
</svg>`;

fs.writeFileSync(path.join(__dirname, 'icon.svg'), svgIcon);
console.log('icon.svg created!');
console.log('To convert to .icns (Mac) or .ico (Windows), use an online converter or:');
console.log('  brew install librsvg && rsvg-convert -w 512 -h 512 icon.svg -o icon.png');
