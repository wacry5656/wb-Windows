# 错题助手 (Wrong Question Assistant)

一个基于 Electron + React + TypeScript 的桌面应用，帮助学生管理和复习错题。

## ✨ 功能特性

- 📸 **错题上传**：轻松上传错题图片并记录标题和学科分类
- 📋 **错题列表**：查看所有错题，支持按学科筛选和关键词搜索
- 📝 **详细笔记**：为每道错题添加解题思路和笔记
- ♻️ **复习模式**：智能复习系统，支持多种排序方式（最少复习优先、最新添加等）
- 📊 **学习统计**：跟踪每道题的复习次数

## 🚀 快速开始

### 环境要求

- Node.js >= 14.0.0
- npm 或 yarn

### 安装依赖

```bash
npm install
```

### 开发模式

同时启动 React 开发服务器和 Electron 应用：

```bash
npm run dev
```

或运行各部分分别启动：

```bash
# Terminal 1: 启动 React 开发服务器
npm run react-start

# Terminal 2: 启动 Electron（需要等 React 服务器启动完成）
npm run electron-start
```

### 构建应用

```bash
npm run electron-build
```

## 📁 项目结构

```
wrong-question-assistant/
├── public/
│   ├── index.html           # HTML 入口文件
│   ├── electron.js          # Electron 主进程
│   └── preload.js           # Electron 预加载脚本
├── src/
│   ├── App.tsx              # 应用主组件（包含路由）
│   ├── App.css              # 应用主样式
│   ├── index.tsx            # React 入口文件
│   ├── index.css            # 全局样式
│   └── pages/               # 页面组件
│       ├── HomePage.tsx      # 首页：上传错题
│       ├── HomePage.css
│       ├── QuestionListPage.tsx    # 错题列表页
│       ├── QuestionListPage.css
│       ├── QuestionDetailPage.tsx  # 错题详情页
│       ├── QuestionDetailPage.css
│       ├── ReviewPage.tsx    # 复习页
│       └── ReviewPage.css
├── package.json             # 项目配置和依赖
├── tsconfig.json            # TypeScript 配置
└── README.md                # 项目说明
```

## 📄 文件说明

### 核心配置文件

| 文件 | 说明 |
|------|------|
| `package.json` | npm 项目配置，定义依赖、脚本命令和 Electron 构建配置 |
| `tsconfig.json` | TypeScript 编译器配置 |
| `.gitignore` | Git 忽略文件列表 |

### Electron 文件

| 文件 | 说明 |
|------|------|
| `public/electron.js` | Electron 主进程，管理应用窗口和生命周期 |
| `public/preload.js` | Electron 预加载脚本，在主进程和渲染器间安全通信（预留扩展点） |

### React 文件

| 文件 | 说明 |
|------|------|
| `public/index.html` | HTML 模板文件 |
| `src/index.tsx` | React 应用入口，挂载 App 组件 |
| `src/index.css` | 全局样式和重置样式 |
| `src/App.tsx` | 主应用组件，包含路由和状态管理 |
| `src/App.css` | 应用主容器样式（导航栏、布局） |

### 页面组件

#### 首页 (`pages/HomePage.tsx`)
- **功能**：上传错题图片、输入题目标题、选择学科分类
- **特点**：实时图片预览、表单验证
- **状态管理**：标题、分类、图片预览

#### 错题列表页 (`pages/QuestionListPage.tsx`)
- **功能**：展示所有错题、搜索、按学科筛选
- **特点**：网格布局卡片显示、搜索和筛选功能
- **交互**：点击卡片进入详情页、删除错题

#### 错题详情页 (`pages/QuestionDetailPage.tsx`)
- **功能**：查看错题详情、编辑解题笔记、统计复习次数
- **特点**：左侧显示错题图片、右侧显示信息和笔记编辑器
- **交互**：编辑笔记、标记复习、删除错题

#### 复习页 (`pages/ReviewPage.tsx`)
- **功能**：按不同排序方式复习错题
- **特点**：支持最少复习优先、最新添加优先等多种排序
- **交互**：前后翻页、直接跳转到某道题、标记为已掌握

## 🎨 UI 设计

采用现代简洁设计：
- 蓝灰色主色调 (#2c3e50)
- 清晰的卡片布局
- 响应式设计，支持不同屏幕尺寸
- 平滑的过渡和交互动画

## 🔧 技术栈

- **前端框架**：React 18.2.0
- **路由**：React Router 6.10.0
- **开发语言**：TypeScript 4.9.5
- **桌面应用**：Electron (latest)
- **构建工具**：Electron Builder 24.1.1
- **开发工具**：React Scripts 5.0.1

## 📝 使用指南

### 添加错题

1. 在首页点击上传区域或选择图片文件
2. 输入题目标题和学科分类
3. 点击"保存错题"按钮

### 查看错题列表

1. 点击导航栏"错题列表"
2. 使用搜索框查找特定题目
3. 通过科目按钮筛选错题
4. 点击卡片查看详情

### 编辑笔记

1. 在详情页点击"编辑笔记"
2. 输入解题思路或笔记内容
3. 点击"保存笔记"

### 复习错题

1. 点击导航栏"复习"进入复习模式
2. 选择排序方式
3. 使用"已掌握，下一题"标记复习进度
4. 左侧列表可快速跳转

## 🚀 后续扩展

本项目目前不包含以下功能，可在后续版本添加：

- ❌ AI 智能解答（可调用 ChatGPT/Claude API）
- ❌ 数据库持久化（可集成 SQLite/MongoDB）
- ❌ 云同步功能（可使用 Firebase 等云服务）
- ❌ 打印导出功能
- ❌ 数据统计和分析

## 📄 License

ISC License

## 👨‍💻 开发提示

### 添加新页面

1. 在 `src/pages/` 下创建新的 `.tsx` 文件
2. 创建对应的 `.css` 样式文件
3. 在 `App.tsx` 中添加路由

### 修改样式

所有组件样式都在对应的 `.css` 文件中，支持修改配色、字体、布局等。

### 调试

运行 `npm run dev` 后，Electron 会自动打开开发者工具，可进行实时调试。

---

**祝学习愉快！** 📚✨
