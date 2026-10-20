# Hotaru V0.1 · 汐见萤

DeepSeek Harness 的角色插件源码。默认模型入口为 `hotaru-v0.1`。

## 使用

1. 安装并登录 DSH 桌面版。
2. 在本仓库目录执行：

   ```sh
   "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add "$PWD/dsh-plugin"
   ```
3. 重启 DSH，选择 **Agents-Time → Hotaru V0.1**，在「设置 → 角色与桌宠」填入自己的 Qwen Character Key。

汐见萤提供陪伴聊天、记忆、音乐日记和 Mac Apple Music 歌单功能。

完整配置和可选组件说明见 [安装指南](distribution/README.md)。本项目需要 DSH 的 Node 22.19+ 运行环境；开发测试使用 Node 24 与 Python 3.9+。

## 构建与测试

```sh
node --test --test-timeout=30000 test/*.test.mjs
python3 scripts/build-character-release.py
```

安装包输出到 `dist/characters/`，附可审阅的安装器与 SHA-256 校验。插件本身只使用 Node 内置模块，无需额外 npm 依赖；桌宠前端单独使用 `pet-live2d-mac/package.json` 的依赖。

## 源码结构

- `dsh-plugin/`：角色、记忆、语音接口、音乐日记、Mac 音乐桥接与 DSH 前端。
- `dsh-plugin/character-profile.js`：本仓库启用的角色入口。
- `pet-live2d-mac/`：可选 macOS 桌宠的 Swift/Web 前端源码，不附模型及引擎二进制。
- `distribution/`、`scripts/`、`test/`：安装器、可重复打包脚本、回归测试。

## 共用内核与资源边界

此仓库与另一角色仓库共享同一套内核实现，历史模型 ID、数据目录和 37471 端口保持兼容。两个单角色版本使用同一插件包名 `@emilia/companion-loop`，安装一个会替换另一个，**不要同时注册两个改名副本**。希望同时使用两者时，请使用[双角色原项目](https://github.com/galaxypple072-oss/Emilia-X1)的组合版本。

不包含个人聊天、记忆数据库、API Key、Apple Music 登录状态、原画、Live2D、声音训练素材/权重或翻唱成品。TTS、钢琴与桌宠均为可选外部能力；没有这些服务仍可使用文字聊天。角色名称与作品权利归原权利人；代码的进一步许可由维护者决定，仓库公开不等于附带第三方资产授权。

源码来自双角色项目的当前可分发版本，见 [来源记录](SOURCE-ORIGIN.md)。
