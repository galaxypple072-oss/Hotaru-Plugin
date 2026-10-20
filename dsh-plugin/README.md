# Hotaru V0.1（汐见萤）源码与安装

本仓库默认只显示 **Hotaru V0.1** 入口。共用内核源码保留兼容实现，不代表同时启用另一个角色。

## 安装到 Mac 的 DSH

1. 安装并登录 DeepSeek Harness 桌面版。先退出 DSH，解压此 ZIP，保留整个目录。
2. 在终端进入解压目录，先运行 `sh Install.command --check` 检查完整性和 DSH 路径。
3. 运行 `sh Install.command`，或双击 `Install.command`。安装器将代码复制到当前用户的 `~/Library/Application Support/Agents-Time/plugins/companion-loop/` 后注册到 DSH 的 desktop profile，解压目录之后可删除。
4. 重启 DSH，在模型列表的 **Agents-Time** 中选择 **Hotaru V0.1**。爱蜜莉雅支持工作/陪伴切换，汐见萤固定为陪伴对话。
5. 在「设置 → 角色与桌宠」配置**接收者自己的**阿里云百炼 Qwen Character Key 和对应地域接口。工作模式、记忆分析和音乐推荐使用接收者已登录的 DeepSeek 账号；API 用量由接收者承担。

DSH 提供 Node 运行环境，插件需要支持 `node:sqlite` 的 Node 22.19+。Apple Music 控制目前限 Mac，需要安装并登录「音乐」；首次系统提示时由用户授权自动化/辅助功能。原生音乐桥接按需编译，需要 Xcode Command Line Tools（可运行 `xcode-select --install` 安装）。没有这些可选能力仍可使用文字聊天。

安装 DSH 的位置不同：`DSH_APP="/其他位置/DeepSeek Harness.app" sh Install.command`。其他 profile 使用 `DSH_PROFILE=名称`；也可通过 `DSH_CLI=/绝对路径/dsh` 指定 CLI。安装脚本仅注册插件，不自动安装 DSH、修改系统权限或启动其他下载器。

## 默认可用与可选组件

| 能力 | 分发情况 |
| --- | --- |
| 角色文字聊天、会话模式、记忆、日记界面 | 包含代码；配置自己的账号/Key 后使用 |
| AI 找歌、真实 Apple Music 歌单、后台播放 | 包含 Mac 桥接；需自己的 Music 账户与系统权限 |
| 头像 | 默认使用原创字母图标；不包含角色原画 |
| TTS、角色口型 | 包含接口；需自行部署兼容 TTS 服务及有权使用的声音模型 |
| 钢琴生成 | 包含接口；需自行部署兼容钢琴服务及模型 |
| Live2D 桌宠 | 此包不含桌宠 App 或第三方模型；可连接自行准备的兼容 Emilia Live2D.app |
| RVC、导唱、翻唱成品 | 不包含训练素材、权重、导唱、伴奏或音频文件 |

这不是附带全部 AI 模型的离线整合包。没有可选音频服务时相关操作会说明缺少服务，不影响文字聊天。安装器不继承发送者的 API Key、聊天记录、长期记忆、Apple Music 账户或授权。

## 可选服务配置

将 `services.example.json` 按需复制到 `~/.dsh/emilia-loop/services.json`，填写接收者自己的本机路径后重启 DSH。不要将 API Key 写入该文件，Qwen Key 使用 DSH 设置页保存。

```json
{
  "ttsUrl": "http://127.0.0.1:9881",
  "pianoUrl": "http://127.0.0.1:9882",
  "pianoRuntime": null,
  "coversRoot": null,
  "petApp": null
}
```

- URL 仅接受本机服务的根地址，不带路径、账号或密码。TTS 实现 `GET /health`、`POST /v1/synthesize`，接收 `{ "text": "日语文本", "speakerId": "emilia 或 hotaru" }`，返回 WAV 音频。
- 钢琴服务实现 `GET /health`（`ready`）、`POST /v1/jobs`、`GET /v1/jobs/:id`（`status`）、`GET /v1/jobs/:id/audio`（WAV）、`DELETE /v1/jobs/:id`。任务包含 `prompt`、`seconds` 等字段。模型服务部署不由此安装器承担。
- `pianoRuntime` 为可选的已有运行目录绝对路径，需具有 `music-worker.py` 与 `stable-audio-3/optimized/mlx/.venv/bin/python`。不填时只连接已启动的服务，无法连接会提示配置；不会下载权重。
- `coversRoot` 为可选的已有翻唱目录；保留项目的两首既有导入布局。不要把未授权音频附在分发包中。
- `petApp` 可填兼容桌宠 App 的绝对路径；默认寻找当前用户或系统 Applications 下的 `Emilia Live2D.app`。本包不要求桌宠存在。
- 高级覆盖：`AGENTS_TIME_CONFIG` 指定配置文件；`AGENTS_TIME_TTS_URL`、`AGENTS_TIME_PIANO_URL`、`AGENTS_TIME_PIANO_RUNTIME`、`AGENTS_TIME_COVERS_ROOT`、`AGENTS_TIME_PET_APP` 可覆盖相应字段。GUI 启动的 DSH 通常不继承终端环境，因此优先使用 JSON 文件。

## 升级与卸载

升级时运行新版本安装脚本，注册仍使用同一插件名称；不会删除 `~/.dsh/emilia-loop/` 中的设置、记忆和日记。不要同时安装多个改名副本，它们会争用本机 37471 端口。

卸载时在 DSH 插件管理中移除 `@emilia/companion-loop` 并重启 DSH；确认不再引用后可以删除上面的 Agents-Time 安装目录。个人数据默认保留，删除个人数据须由本人另行决定。若手动修改了安装目录，安装器会拒绝覆盖该版本。

## 包内容与边界

`package/` 是可直接注册的 DSH 插件；`Install.command` 是可审阅的安装脚本；`SHA256SUMS` 用于发现下载或解压损坏。散列不是发行者签名，也不代替来源验证。该测试包没有 Apple Developer ID 签名或公证。

包内不包含第三方角色图片、Live2D 模型、声音权重、预训练音乐模型、音频成品、密钥、缓存、SQLite 或用户记录。角色名称和作品相关权利属于原权利人；不随此包转让。代码的进一步许可与公开发行条款由项目维护者决定。
