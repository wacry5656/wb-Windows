# 项目文件结构详解

## 项目目录树

```
wrong-question-assistant/
│
├── public/                          # 公共资源和 Electron 主进程
│   ├── index.html                  # HTML 入口模板
│   ├── electron.js                 # Electron 主进程文件
│   └── preload.js                  # Electron 预加载脚本
│
├── src/                            # React 应用源代码
│   ├── index.tsx                   # React 应用入口
│   ├── index.css                   # 全局样式
│   ├── App.tsx                     # 应用主组件（路由容器）
│   ├── App.css                     # 应用主样式
│   ├── react-app-env.d.ts         # TypeScript 环境定义
│   │
│   └── pages/                      # 页面组件目录
│       ├── HomePage.tsx             # 首页组件
│       ├── HomePage.css             # 首页样式
│       ├── QuestionListPage.tsx     # 错题列表页
│       ├── QuestionListPage.css     # 列表页样式
│       ├── QuestionDetailPage.tsx   # 错题详情页
│       ├── QuestionDetailPage.css   # 详情页样式
│       ├── ReviewPage.tsx           # 复习页面
│       └── ReviewPage.css           # 复习页样式
│
├── .gitignore                      # Git 忽略文件配置
├── .env.example                    # 环境变量示例
├── package.json                    # 项目配置和依赖
├── tsconfig.json                   # TypeScript 配置
├── README.md                       # 项目说明文档
└── STRUCTURE.md                    # 本文件
```

## 文件详细说明

### 根目录文件

#### `package.json`
- **作用**：项目配置文件，定义项目元信息、依赖包、npm 脚本等
- **重要字段**：
  - `main`: 指向 Electron 主进程文件
  - `homepage`: React 应用的默认路由
  - `scripts`: npm 命令脚本（dev、build 等）
  - `build`: Electron Builder 打包配置
  - `dependencies`: 生产依赖（React、React Router 等）
  - `devDependencies`: 开发依赖（TypeScript、Electron 等）

#### `tsconfig.json`
- **作用**：TypeScript 编译器配置
- **配置内容**：
  - 编译目标（ES2020）
  - JSX 转换方式
  - 严格模式开启
  - 路径别名（baseUrl）
  - 类型检查规则

#### `.gitignore`
- **作用**：指定 Git 忽略的文件和目录
- **包含内容**：node_modules、build、dist、IDE 配置等

#### `.env.example`
- **作用**：环境变量示例文件
- **用途**：让开发者了解需要配置哪些环境变量

#### `README.md`
- **作用**：项目说明文档
- **包含内容**：功能说明、快速开始、文件结构、使用指南等

### Public 目录（公共资源和 Electron 主进程）

#### `public/index.html`
- **作用**：HTML 页面模板
- **内容**：
  - Meta 标签（字符编码、视口配置等）
  - 页面标题和图标
  - React 应用挂载点（id="root"）
  - 全局样式

#### `public/electron.js`
- **作用**：Electron 主进程文件
- **功能**：
  - 创建应用窗口
  - 加载 React 应用或生成的 HTML
  - 处理应用生命周期（启动、关闭等）
  - 配置窗口大小和功能
- **执行环境**：Node.js 运行时

#### `public/preload.js`
- **作用**：Electron 预加载脚本
- **功能**：
  - 在主进程和渲染器进程间建立安全通信
  - 暴露受控的 API 给网页代码
  - 实现上下文隔离
- **目前状态**：预留扩展点，可用于后期添加 IPC 通信

### Src 目录（React 应用）

#### `src/index.tsx`
- **作用**：React 应用入口文件
- **功能**：
  - 导入 React 和 ReactDOM
  - 创建 React Root
  - 挂载 App 组件到 DOM

#### `src/index.css`
- **作用**：全局样式文件
- **内容**：
  - CSS 重置（margin、padding 清零）
  - 全局字体配置
  - 基础元素样式（a、button、input 等）

#### `src/App.tsx`
- **作用**：应用主组件，也是路由容器
- **功能**：
  - 定义应用整体结构（导航栏、内容区域）
  - 配置路由规则
  - 管理不同页面通用的状态（问题列表、选中问题等）
  - 处理页面间的通信
- **状态管理**：
  - `questions`: 所有错题数组
  - `selectedQuestion`: 当前选中的错题
  - 相关的增删改查 handler 函数

#### `src/App.css`
- **作用**：应用主样式
- **样式内容**：
  - 导航栏样式（.navbar）
  - 导航菜单样式（.nav-menu、.nav-item、.nav-link）
  - 主内容区域样式（.main-content）
  - 响应式布局

#### `src/react-app-env.d.ts`
- **作用**：TypeScript 环境定义文件
- **功能**：导入 react-scripts 的 TypeScript 定义，避免 TypeScript 错误

### Pages 目录（页面组件）

#### 首页 (`pages/HomePage.tsx` + `HomePage.css`)

**组件功能**：
- 上传错题图片
- 输入题目标题
- 选择学科分类
- 实时显示图片预览
- 保存错题到应用状态

**主要元素**：
- 表单区域（标题、分类、图片上传）
- 图片预览区域
- 使用提示区域
- 提交按钮

**关键功能**：
- `handleImageUpload`: 处理图片上传，转换为 Base64
- `handleSubmit`: 验证表单并保存错题

**样式特点**：
- 居中卡片布局
- 虚线边框的上传区域
- 简洁的表单样式

---

#### 错题列表页 (`pages/QuestionListPage.tsx` + `QuestionListPage.css`)

**组件功能**：
- 显示所有错题的网格卡片
- 搜索错题（按标题或笔记）
- 按学科筛选错题
- 删除错题
- 导航到详情页

**主要元素**：
- 搜索框
- 分类筛选按钮
- 错题卡片网格（包含图片、标题、分类、日期、复习次数）
- 空状态提示

**关键功能**：
- `filteredQuestions`: 根据搜索和筛选条件过滤问题
- `handleSelectQuestion`: 选中问题并导航到详情页
- `handleDeleteClick`: 删除问题（带确认）

**样式特点**：
- 响应式网格布局
- 卡片悬停效果
- 徽章标签（分类、日期）

---

#### 错题详情页 (`pages/QuestionDetailPage.tsx` + `QuestionDetailPage.css`)

**组件功能**：
- 显示错题的完整信息
- 编辑和查看解题笔记
- 标记错题为已复习
- 删除错题
- 返回列表

**主要元素**：
- 左侧：大图显示错题图片
- 右侧：
  - 题目标题和分类
  - 操作按钮（标记复习、删除）
  - 笔记编辑器（可编辑/只读模式）
  - 统计信息（复习次数、创建时间）

**关键功能**：
- `handleSaveNotes`: 保存笔记内容
- `handleMarkReviewed`: 增加复习次数
- `handleDelete`: 删除错题并返回列表
- 编辑模式和查看模式的切换

**样式特点**：
- 两栏布局（图片 + 信息）
- 响应式设计（小屏幕时堆叠）
- 笔记编辑器样式

---

#### 复习页 (`pages/ReviewPage.tsx` + `ReviewPage.css`)

**组件功能**：
- 批量复习错题
- 多种排序方式（最少复习、最新添加、按科目等）
- 进度追踪
- 快速跳转到任何题目
- 标记题目为已掌握

**主要元素**：
- 左侧：
  - 排序方式选择（下拉菜单）
  - 题目列表（可点击跳转）
  - 显示当前题的复习次数和分类
- 右侧：
  - 进度条
  - 题目卡片（完整显示）
    - 标题、分类、日期、复习次数
    - 题目图片
    - 笔记内容（如果有）
  - 操作按钮（上一题、已掌握、下一题）

**关键功能**：
- `sortedQuestions`: 根据排序方式排列题目
- `handleMarkReviewed`: 增加复习次数并前进
- `handleNext/handlePrevious`: 序列化导航
- `handleJumpTo`: 直接跳转到任意题目

**样式特点**：
- 左右两栏布局
- 进度条可视化
- 高亮当前题目
- 适应不同屏幕方向

## 数据流说明

### Question 数据结构

```typescript
interface Question {
  id: string;              // 唯一标识
  title: string;           // 题目标题
  image: string;           // Base64 编码的图片
  category: string;        // 学科分类
  createdAt: Date;         // 创建时间
  notes?: string;          // 解题笔记
  reviewCount?: number;    // 复习次数
}
```

### 状态管理流程

1. **App.tsx** 管理全局状态：
   - `questions`: 所有错题数组
   - `selectedQuestion`: 当前选中的错题

2. **信息流向**：
   ```
   HomePage (添加) → App.tsx (addQuestion) → 状态更新
         ↓
   QuestionListPage (显示列表) → 用户点击 → 选中并导航
         ↓
   QuestionDetailPage (显示详情、编辑) → 更新信息
         ↓
   ReviewPage (复习模式) → 增加复习次数
   ```

## 样式主题

- **主色调**：#2c3e50（深蓝灰）
- **辅助色**：
  - 蓝色：#1976d2（分类标签）
  - 紫色：#7b1fa2（日期标签）
  - 绿色：#4caf50（复习相关）
  - 红色：#d32f2f（删除操作）
- **背景色**：#f5f5f5（浅灰）
- **卡片背景**：#ffffff（白色）
- **边框色**：#ddd（浅灰）

## 开发建议

1. **添加新功能**：在对应页面组件中修改或添加新的 handler 函数
2. **修改样式**：编辑对应的 `.css` 文件，遵循现有的颜色和间距规范
3. **扩展功能**：
   - 数据库集成：在 App.tsx 中替换状态管理为数据库操作
   - AI 集成：在详情页或新的 AI 页面中添加 API 调用
   - 云同步：在 electron.js 中添加 IPC 通信处理

## 下一步建议

- [ ] 添加数据本地持久化（localStorage 或 SQLite）
- [ ] 集成 AI API 进行自动解答
- [ ] 添加数据导出功能（PDF、Excel）
- [ ] 实现打印功能
- [ ] 添加统计分析页面
- [ ] 支持数据备份和恢复
