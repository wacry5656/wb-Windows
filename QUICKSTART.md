# 快速开始指南

## 第一步：安装依赖

打开终端，进入项目目录，运行以下命令安装所有依赖包：

```bash
npm install
```

这个命令会根据 `package.json` 安装所有必需的包：
- React 和相关库
- TypeScript
- Electron
- 其他开发工具

## 第二步：启动开发环境

### 方式一：使用自动脚本（推荐）

```bash
npm run dev
```

这个命令会同时启动：
1. React 开发服务器（http://localhost:3000）
2. Electron 应用程序

Electron 会自动连接到 React 开发服务器，你可以看到实时的代码更新。

开发者工具会自动打开，可以在 Console 标签中查看日志。

### 方式二：手动启动两个服务

如果自动脚本有问题，可以手动启动：

**终端 1 - 启动 React 开发服务器：**
```bash
npm run react-start
```

等待服务器启动完成（会看到 "Compiled successfully!" 的提示）

**终端 2 - 启动 Electron 应用：**
```bash
npm run electron-start
```

## 第三步：开发和测试

### 修改代码

所有 TypeScript 和 CSS 文件修改会自动热重载：

1. **修改 React 组件**（src/ 目录下的文件）
   - 修改后，React 开发服务器会自动重新编译
   - Electron 会自动刷新显示新内容（大多数情况）

2. **修改 Electron 主进程**（public/electron.js）
   - 需要手动重启 Electron 应用
   - 在 Electron 窗口中按 Ctrl+Shift+R 刷新
   - 或者关闭应用重新运行 `npm run electron-start`

### 调试

Electron 开发者工具会自动打开，提供：
- **Elements 标签**：检查 DOM 结构和样式
- **Console 标签**：查看日志和错误信息
- **Source 标签**：设置断点调试
- **Network 标签**：查看网络请求

快捷键：
- `F12` 或 `Ctrl+Shift+I`：打开/关闭开发者工具
- `Ctrl+Shift+R`：强制刷新页面

## 第四步：测试主要功能

### 首页（HomePage）
- 点击上传区域或选择文件上传一张测试图片
- 输入题目标题（如 "直角三角形斜边计算"）
- 选择学科（如 "数学"）
- 点击"保存错题"按钮

### 错题列表（QuestionListPage）
- 点击导航栏"错题列表"
- 应该可以看到刚才保存的错题卡片
- 尝试在搜索框输入关键词
- 点击学科筛选按钮进行筛选

### 错题详情（QuestionDetailPage）
- 点击错题卡片进入详情页
- 点击"编辑笔记"按钮
- 输入一些解题思路
- 点击"保存笔记"

### 复习模式（ReviewPage）
- 点击导航栏"复习"
- 尝试不同的排序方式
- 点击"已掌握，下一题"增加复习次数
- 在左侧列表中点击其他题目快速跳转

## 项目结构速览

```
wrong-question-assistant/
├── public/                 # Electron 主文件和 HTML 模板
├── src/
│   ├── pages/             # 四个主要页面组件
│   ├── App.tsx            # 路由和主组件
│   └── index.tsx          # React 入口
├── package.json           # 依赖和脚本配置
└── README.md              # 详细说明文档
```

## 常见问题

### Q: 修改了代码但没有看到变化？
A: 尝试以下步骤：
1. 先确认终端中有否出现编译错误（看 React 或 TypeScript 的错误提示）
2. 如果修改的是 Electron 主程序（public/electron.js），需要手动重启（Ctrl+Shift+R 或重新运行 npm run electron-start）
3. 尝试关闭所有终端，重新运行 `npm run dev`

### Q: 启动时出现 "port 3000 already in use"？
A: 说明 3000 端口已被占用，解决方法：
1. 查找并关闭占用 3000 端口的进程
2. 或者修改 React 启动端口：`PORT=3001 npm run react-start`

### Q: Electron 窗口无法打开？
A: 检查终端输出的错误信息，常见原因：
1. React 服务器还未启动完成，等待 "Compiled successfully!" 消息
2. 防火墙阻止，尝试添加 Electron 到防火墙白名单
3. Node.js 版本过旧，需要 14.0.0 或更高

### Q: 图片上传后无法预览？
A: 这可能是浏览器支持问题
1. 尝试重新选择一个其他的图片文件
2. 检查浏览器控制台（F12 > Console）是否有错误信息
3. 确保选择的文件是有效的图片格式

## 当你完成功能开发时

### 构建生产版本

```bash
npm run electron-build
```

这会：
1. 构建 React 应用到 `build/` 目录
2. 使用 electron-builder 打包成可执行文件（.exe）
3. 输出文件在 `dist/` 目录中

### 分发应用

构建完成后，`dist/` 目录中的 `.exe` 文件可直接分发给用户使用。

## 下一步建议

- [ ] 集成数据存储（localStorage 或 SQLite）以持久化数据
- [ ] 添加 AI API 集成
- [ ] 美化 UI（自定义颜色、字体等）
- [ ] 添加更多功能（标签、笔记本等）
- [ ] 优化图片存储（而不是 Base64）

## 需要帮助？

参考以下文件获取更多信息：
- `README.md` - 项目总体说明
- `STRUCTURE.md` - 详细的文件结构和各页面说明
- `package.json` - 依赖和脚本配置
- `tsconfig.json` - TypeScript 配置

祝开发愉快！✨
