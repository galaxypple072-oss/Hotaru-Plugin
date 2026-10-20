#!/usr/bin/env python3
"""Export clean standalone source trees, without copying Git history or assets."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROFILES = {
    'emilia': ('Emilia-X1-Plugin', 'Emilia X1', '爱蜜莉雅', 'emilia-x1'),
    'hotaru': ('Hotaru-Plugin', 'Hotaru V0.1', '汐见萤', 'hotaru-v0.1'),
}

def export(character, target):
    repository, model, chinese, model_id = PROFILES[character]
    if target.exists():
        raise ValueError(f'will not overwrite existing directory: {target}')
    with tempfile.TemporaryDirectory(prefix='agents-time-source-') as temp:
        result = subprocess.run(['python3', str(ROOT / 'scripts/build-character-release.py'), '--output', temp], check=True, capture_output=True, text=True)
        release = json.loads(result.stdout)
        with zipfile.ZipFile(release['zip']) as archive:
            prefix = Path(release['zip']).stem + '/package/'
            for item in archive.infolist():
                if item.filename.startswith(prefix) and not item.is_dir():
                    relative = Path(item.filename[len(prefix):])
                    if '..' in relative.parts:
                        raise ValueError('unsafe release path')
                    file = target / 'dsh-plugin' / relative
                    file.parent.mkdir(parents=True, exist_ok=True)
                    file.write_bytes(archive.read(item))
    metadata_file = target / 'dsh-plugin/package.json'
    metadata = json.loads(metadata_file.read_text())
    metadata['description'] = f'{model} ({chinese}) character plugin for DeepSeek Harness'
    metadata['agentsTime'] = {'character': character}
    metadata_file.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    (target / 'dsh-plugin/character-profile.js').write_text(f"// This source repository exposes {model}; shared internals retain compatibility.\nexport const CHARACTER_MODELS = Object.freeze([{json.dumps(model_id)}]);\n")
    if character == 'hotaru':
        (target / 'dsh-plugin/cordis.patch.yml').write_text("- insert:\n    - id: emilia-presence\n      name: '@emilia/companion-loop'\n    - id: emilia-model\n      name: '@emilia/companion-loop/model'\n")
    for directory, patterns in [('test', ['*.test.mjs']), ('distribution', ['Install.command', 'README.md'])]:
        (target / directory).mkdir(parents=True, exist_ok=True)
        for pattern in patterns:
            for file in sorted((ROOT / directory).glob(pattern)):
                shutil.copyfile(file, target / directory / file.name)
    (target / 'scripts').mkdir()
    for name in ['build-character-release.py', 'build-character-sources.py', 'build-music-wall.py']:
        shutil.copyfile(ROOT / 'scripts' / name, target / 'scripts' / name)
    # Desktop code is included, but no prepared model/texture/engine binaries.
    pet = target / 'pet-live2d-mac'
    pet.mkdir()
    for name in ['Live2DPet.swift', 'Info.plist', 'build-app.sh', 'package.json', 'pnpm-lock.yaml', 'index.html', 'main.js', 'live2d-pet.js', 'vite.config.js', 'import-hotaru.py']:
        shutil.copyfile(ROOT / 'pet-live2d-mac' / name, pet / name)
    resources = pet / 'public/assets'
    resources.mkdir(parents=True)
    (resources / 'README.md').write_text('本仓库仅包含桌宠源代码。请自行提供有权使用的 Live2D 模型、纹理与动作，以及兼容的 Cubism 引擎和许可证。不要提交训练素材、声音权重或第三方模型。原项目资源布局与导入方式见根目录说明。\n')
    original = (target / 'distribution/README.md').read_text()
    heading = original.split('\n\n', 2)[2]
    guide = f'# {model}（{chinese}）源码与安装\n\n本仓库默认只显示 **{model}** 入口。共用内核源码保留兼容实现，不代表同时启用另一个角色。\n\n' + heading
    guide = guide.replace('选择 **Emilia X1** 或 **Hotaru V0.1**', f'选择 **{model}**')
    guide = guide.replace('双角色', '角色')
    for name in ['distribution/README.md', 'dsh-plugin/README.md']:
        (target / name).write_text(guide)
    (target / 'README.md').write_text(f'''# {model} · {chinese}

DeepSeek Harness 的角色插件源码。默认模型入口为 `{model_id}`。

## 使用

1. 安装并登录 DSH 桌面版。
2. 在本仓库目录执行：

   ```sh
   "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add "$PWD/dsh-plugin"
   ```
3. 重启 DSH，选择 **Agents-Time → {model}**，在「设置 → 角色与桌宠」填入自己的 Qwen Character Key。

{'爱蜜莉雅支持工作/陪伴切换；工作模式沿用 DSH 的 DeepSeek 账号和工具。' if character == 'emilia' else '汐见萤提供陪伴聊天、记忆、音乐日记和 Mac Apple Music 歌单功能。'}

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
''')
    commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, check=True, text=True, capture_output=True).stdout.strip()
    (target / 'SOURCE-ORIGIN.md').write_text(f'# Source origin\n\nShared project: https://github.com/galaxypple072-oss/Emilia-X1\n\nBase commit: `{commit}` plus the current portable-distribution changes.\n\nProfile: `{model_id}`. This clean export starts new history and excludes original images, binaries, model weights, private data and local deployment notes.\n')
    (target / '.gitignore').write_text('/dist/\nnode_modules/\n.DS_Store\n__pycache__/\npet-live2d-mac/build/\npet-live2d-mac/dist/\npet-live2d-mac/public/assets/**\n!pet-live2d-mac/public/assets/README.md\ndsh-plugin/native/apple-music-ui\n*.sqlite*\n.env\n.env.*\n')
    (target / 'package.json').write_text(json.dumps({'name': repository.lower(), 'private': True, 'version': metadata['version'], 'scripts': {'test': 'node --test --test-timeout=30000 test/*.test.mjs', 'build:release': 'python3 scripts/build-character-release.py'}}, indent=2) + '\n')
    manifest = {file.relative_to(target).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(target.rglob('*')) if file.is_file()}
    (target / 'SOURCE-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'character': character, 'directory': str(target), 'files': len(manifest)}, ensure_ascii=False))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('character', choices=PROFILES)
    parser.add_argument('target', type=Path)
    args = parser.parse_args()
    export(args.character, args.target.resolve())
