# 当前项目结构说明

## 项目现状

这个版本已经完成基础重构，适合作为后续接入 AI API 的开发底座。

- 前端使用 `React + TypeScript`
- 桌面容器使用 `Electron`
- 路由改为 `HashRouter`，适配 Electron 生产环境
- 错题数据持久化到 `localStorage`
- 详情页支持按 `id` 直达
- 已预留 AI 分析展示区
- 已通过基础测试和前端构建
- 已生成桌面应用目录 `dist/win-unpacked/`

## 目录结构

```text
wrong-question-assistant/
├── build/                         # React 生产构建产物
├── dist/                          # Electron 打包输出
├── public/
│   ├── electron.js                # Electron 主进程入口
│   ├── index.html                 # React HTML 模板
│   └── preload.js                 # 预加载脚本，后续可扩展安全 API
├── src/
│   ├── pages/
│   │   ├── HomePage.tsx           # 首页：上传错题并预览图片
│   │   ├── HomePageV2.css         # 首页新版样式
│   │   ├── QuestionListPage.tsx   # 错题列表：搜索、筛选、分析状态概览
│   │   ├── QuestionListPageV2.css # 列表页新版样式
│   │   ├── QuestionDetailPage.tsx # 详情页：笔记、复习、AI 分析展示
│   │   ├── QuestionDetailPageV2.css
│   │   ├── ReviewPage.tsx         # 复习页：排序、切题、复习提醒
│   │   └── ReviewPageV2.css
│   ├── types/
│   │   └── question.ts            # 错题与 AI 分析的数据类型定义
│   ├── utils/
│   │   ├── demoAnalysis.ts        # 演示分析生成器，后续可替换为真实 API
│   │   └── questionStorage.ts     # 本地存储读写逻辑
│   ├── App.tsx                    # 应用入口、路由、全局状态与持久化
│   ├── App.css                    # 应用壳层与导航样式
│   ├── App.test.tsx               # 基础回归测试
│   ├── index.css                  # 全局样式变量与基础样式
│   ├── index.tsx                  # React 挂载入口
│   ├── react-app-env.d.ts         # CRA 类型声明
│   └── setupTests.ts              # 测试初始化
├── package.json                   # 脚本、依赖与 Electron Builder 配置
├── package-lock.json              # 依赖锁文件
├── QUICKSTART.md                  # 旧版快速开始文档
├── README.md                      # 旧版项目说明文档
├── STRUCTURE.md                   # 旧版结构说明
├── CURRENT_ARCHITECTURE.md        # 当前版本说明
└── tsconfig.json                  # TypeScript 配置
```

## 关键文件职责

### 应用层

- `src/App.tsx`
  - 持有全局错题状态
  - 负责新增、更新、删除错题
  - 将数据同步到本地存储
  - 提供页面路由

- `src/App.css`
  - 定义应用整体外壳
  - 包含导航栏和顶部概览区的样式

### 数据层

- `src/types/question.ts`
  - 定义 `Question`
  - 定义 `QuestionAnalysis`
  - 约束后续 AI 返回的数据结构

- `src/utils/questionStorage.ts`
  - 从 `localStorage` 读取错题
  - 将错题写回 `localStorage`
  - 处理基础数据校验

- `src/utils/demoAnalysis.ts`
  - 生成演示版 AI 分析结果
  - 当前用于测试详情页展示区
  - 后续可以直接替换成真实接口调用结果

### 页面层

- `src/pages/HomePage.tsx`
  - 上传图片
  - 输入标题和学科
  - 保存错题后跳转详情页

- `src/pages/QuestionListPage.tsx`
  - 展示所有错题
  - 搜索标题和笔记
  - 按学科筛选
  - 查看是否已有 AI 分析

- `src/pages/QuestionDetailPage.tsx`
  - 通过路由参数读取指定错题
  - 编辑笔记
  - 标记复习次数
  - 展示 AI 分析结果
  - 使用演示分析测试 AI 区域

- `src/pages/ReviewPage.tsx`
  - 进入复习流
  - 支持按复习次数、时间、学科、难度排序
  - 结合 AI 学习建议做复习提醒

### Electron 层

- `public/electron.js`
  - 创建桌面窗口
  - 区分开发环境与生产环境入口
  - 负责桌面应用生命周期

- `public/preload.js`
  - 当前只暴露空的安全桥
  - 后续可在这里扩展主进程通信能力

### 测试与验证

- `src/App.test.tsx`
  - 验证首页是否正常渲染
  - 验证详情页是否支持从本地存储直达

- `src/setupTests.ts`
  - 初始化测试环境

## 后续接入 AI API 的建议

优先把接口结果映射到以下字段：

- `difficulty`
- `commonMistakes`
- `knowledgePoints`
- `studyAdvice`
- `properSolution`

其中 `properSolution` 已预留，但当前界面不依赖它，因此你可以先接前四项。
