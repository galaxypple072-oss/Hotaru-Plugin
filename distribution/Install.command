#!/bin/sh
set -eu
release_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
check_only=false
case "${1:-}" in '') ;; --check) check_only=true ;; *) echo '用法：Install.command [--check]' >&2; exit 2 ;; esac
cd "$release_dir"
if ! shasum -a 256 -c SHA256SUMS > /dev/null; then
  echo '安装包校验失败，请重新解压原始分发包。' >&2; exit 1
fi
profile=${DSH_PROFILE:-desktop}
case "$profile" in ''|*[!a-zA-Z0-9_-]*) echo 'DSH_PROFILE 名称无效。' >&2; exit 2 ;; esac
dsh_cli=${DSH_CLI:-}
if [ -z "$dsh_cli" ]; then
  for app_dir in "${DSH_APP:-/Applications/DeepSeek Harness.app}" "$HOME/Applications/DeepSeek Harness.app"; do
    candidate="$app_dir/Contents/Resources/runtime/cli/bin/dsh"
    if [ -x "$candidate" ]; then dsh_cli=$candidate; break; fi
  done
fi
if [ -z "$dsh_cli" ] && command -v dsh >/dev/null 2>&1; then dsh_cli=$(command -v dsh); fi
if [ ! -x "$dsh_cli" ]; then
  echo '请先安装 DeepSeek Harness，或用 DSH_CLI 指定它的 dsh 可执行文件。' >&2; exit 1
fi
install_root=${AGENTS_TIME_INSTALL_ROOT:-$HOME/Library/Application Support/Agents-Time/plugins/companion-loop}
case "$install_root" in /*) ;; *) echo '安装目录必须使用绝对路径。' >&2; exit 2 ;; esac
package_hash=$(shasum -a 256 package/package.json | cut -c 1-12)
target="$install_root/__VERSION__-$package_hash"
if "$check_only"; then
  echo "校验通过：Emilia X1 + Hotaru V0.1 __VERSION__"
  echo "DSH profile: $profile"
  echo "安装位置：$target"
  echo '检查模式未安装插件、未读取凭据、未更改个人数据。'
  exit 0
fi
umask 077
mkdir -p "$install_root"
if [ -d "$target" ]; then
  diff -qr package "$target" >/dev/null || { echo '同版本安装目录已被修改，请保留后换一个 AGENTS_TIME_INSTALL_ROOT。' >&2; exit 1; }
else
  temporary=$(mktemp -d "$install_root/.install.XXXXXX")
  trap 'test -z "${temporary:-}" || rm -rf "$temporary"' EXIT HUP INT TERM
  cp -R package/. "$temporary/"
  mv "$temporary" "$target"
  temporary=
fi
"$dsh_cli" plugin --profile "$profile" add "$target"
echo '安装完成。请退出并重新打开 DSH，在模型列表中选择 Emilia X1 或 Hotaru V0.1。'
echo '首次陪伴聊天：在「设置 → 角色与桌宠」配置你自己的百炼 Qwen Key。'
echo '本安装不会导入其他人的聊天、记忆、音乐、模型或 API Key。'
