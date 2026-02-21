# 📦 GitHub 订阅

GitHub 仓库订阅推送插件，监控 Commits / Issues / Pull Requests 并渲染图片推送到群聊。

## ✨ 功能特性

- 📡 **仓库订阅** - 监控指定仓库的 Commits、Issues、Pull Requests
- 👤 **用户关注** - 监控指定 GitHub 用户的活动动态
- 🖼️ **图片渲染** - 推送内容渲染为精美图片（依赖 Puppeteer 插件）
- 🎨 **主题切换** - 支持亮色/暗色主题
- 🔑 **Token 支持** - 配置 GitHub Token 提升 API 限额
- 🌐 **WebUI 配置** - 可视化管理订阅列表

## 📖 指令说明

默认指令前缀为 `gh`。

| 指令 | 说明 |
|------|------|
| `gh 帮助` | 显示帮助信息 |
| `gh 列表` | 查看当前群的订阅列表 |
| `gh 全部` | 查看所有订阅 |
| `gh 订阅 <owner/repo> [分支]` | 订阅仓库（主人） |
| `gh 取消 <owner/repo> [分支]` | 取消订阅（主人） |
| `gh 开启 <owner/repo> [分支]` | 开启订阅推送（主人） |
| `gh 关闭 <owner/repo> [分支]` | 关闭订阅推送（主人） |
| `gh 关注 <username>` | 关注 GitHub 用户（主人） |
| `gh 取关 <username>` | 取消关注用户（主人） |
| `gh 关注列表` | 查看用户关注列表 |
