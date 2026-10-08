# cowagent-termux
把这次遇到的所有坑整理成一个安装脚本。脚本会自动处理 numpy、pydantic-core、cryptography、cffi 这些需要编译的包，优先用 Termux 预编译版。

保存脚本

```bash
cd ~/CowAgent
nano install.sh
```

粘贴以下内容（长按粘贴）：

```#!/data/data/com.termux/files/usr/bin/bash
# CowAgent Termux 一键安装脚本
# 自动处理编译类依赖，优先使用预编译包

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[*]${NC} $1"; }
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# ============================================================
# 1. 系统更新与基础依赖
# ============================================================
log "更新系统包..."
pkg update -y >/dev/null 2>&1 || warn "pkg update 有警告，继续"

log "安装基础编译工具链..."
pkg install -y \
    python python-pip \
    clang make cmake ninja binutils \
    libjpeg-turbo libpng freetype \
    openblas libxml2 libxslt \
    openssl libffi rust \
    git curl wget \
    termux-tools \
    >/dev/null 2>&1 || warn "部分工具安装失败，继续"

ok "基础工具链就绪"

# ============================================================
# 2. Termux 预编译包（关键：避免源码编译）
# ============================================================
log "安装预编译的科学计算和密码学包..."

# numpy：Termux 官方预编译，避免 20MB 源码编译
pkg install -y python-numpy 2>/dev/null && ok "numpy (预编译)" || warn "numpy 预编译失败"

# cryptography + cffi：Termux 官方预编译，避免 dlopen 符号错误
pkg install -y python-cryptography 2>/dev/null && ok "cryptography (预编译)" || warn "cryptography 预编译失败"
pkg install -y python-cffi 2>/dev/null && ok "cffi (预编译)" || warn "cffi 预编译失败"

# Pillow：图像处理，源码编译很慢
pkg install -y python-pillow 2>/dev/null && ok "pillow (预编译)" || warn "pillow 预编译失败"

# ============================================================
# 3. pydantic-core（关键坑：需要 Android 专用 wheel）
# ============================================================
log "处理 pydantic-core（Rust 编译包）..."

PIP_MIRROR="https://pypi.tuna.tsinghua.edu.cn/simple"
EUTALIX_INDEX="https://eutalix.github.io/android-pydantic-core/"

# 先卸载 pip 可能已装的源码版本
pip uninstall -y pydantic-core >/dev/null 2>&1 || true
pip uninstall -y pydantic >/dev/null 2>&1 || true

# 从 Eutalix 拉 Android 预编译 wheel
if pip install pydantic-core \
    --extra-index-url "$EUTALIX_INDEX" \
    --no-cache-dir 2>/dev/null; then
    ok "pydantic-core 安装成功"
else
    warn "Eutalix 源安装失败，尝试 Termux User Repository..."
    pip install pydantic-core \
        --extra-index-url https://termux-user-repository.github.io/pypi/ \
        --no-cache-dir || err "pydantic-core 安装失败，请手动处理"
fi

# 安装 pydantic 本体，跳过依赖检查避免触发 pydantic-core 重装
if pip install pydantic --no-deps --no-cache-dir -i "$PIP_MIRROR"; then
    ok "pydantic 安装成功（--no-deps 模式）"
else
    warn "pydantic 安装失败"
fi

# ============================================================
# 4. 升级 pip 基础工具
# ============================================================
log "升级 pip 和基础工具..."
pip install --upgrade pip setuptools wheel -i "$PIP_MIRROR" 2>/dev/null || warn "升级失败，继续"

# ============================================================
# 5. 处理 requirements.txt（可选：剔除不需要的 SDK）
# ============================================================
REQ_FILE="$PROJECT_DIR/requirements.txt"
if [ ! -f "$REQ_FILE" ]; then
    err "找不到 requirements.txt"
    exit 1
fi

# 备份原始文件
cp "$REQ_FILE" "$REQ_FILE.bak"

# 询问是否移除智谱 SDK（不需要的话避免 pydantic 冲突）
if grep -q "^zai-sdk" "$REQ_FILE"; then
    warn "检测到 zai-sdk（智谱 SDK）"
    read -p "是否移除 zai-sdk？(y/N): " REMOVE_ZAI
    if [[ "$REMOVE_ZAI" =~ ^[Yy]$ ]]; then
        sed -i '/^zai-sdk/d' "$REQ_FILE"
        ok "已移除 zai-sdk"
    fi
fi

# ============================================================
# 6. 安装项目依赖
# ============================================================
log "安装项目依赖（清华源）..."
if pip install -r "$REQ_FILE" \
    -i "$PIP_MIRROR" \
    --extra-index-url "$EUTALIX_INDEX" \
    --no-cache-dir; then
    ok "所有依赖安装完成"
else
    warn "部分依赖失败，尝试逐个装（跳过已装的预编译包）..."
    pip install -r "$REQ_FILE" \
        -i "$PIP_MIRROR" \
        --extra-index-url "$EUTALIX_INDEX" \
        --no-deps \
        --no-cache-dir || warn "仍有失败，请检查日志"
fi

# ============================================================
# 7. 验证关键包
# ============================================================
log "验证关键包..."
for pkg in numpy pydantic pydantic_core cryptography cffi PIL; do
    if python -c "import $pkg" 2>/dev/null; then
        VERSION=$(python -c "import $pkg; print(getattr($pkg, '__version__', 'OK'))" 2>/dev/null)
        ok "$pkg ($VERSION)"
    else
        err "$pkg 导入失败"
    fi
done

# ============================================================
# 8. 存储权限（用于导出文件到手机）
# ============================================================
log "配置存储权限..."
if [ ! -d "$HOME/storage" ]; then
    warn "未配置存储，请在弹出的权限请求中点『允许』"
    termux-setup-storage 2>/dev/null || warn "请手动运行 termux-setup-storage"
    sleep 2
fi

# ============================================================
# 完成
# ============================================================
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✅ 安装完成${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "启动项目："
echo "  cd $PROJECT_DIR"
echo "  python app.py"
echo ""
echo "Web 控制台："
echo "  http://127.0.0.1:9899"
echo ""
echo "备份当前环境："
echo "  pip freeze > requirements-lock.txt"
echo ""