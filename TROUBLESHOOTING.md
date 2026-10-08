# CowAgent Termux 安装踩坑记录

在 Android Termux 上安装 CowAgent 遇到的所有坑及解决方案汇总。

---

## 坑 1：numpy 从源码编译，卡死或极慢

**现象**
```
Collecting numpy>=1.21
Downloading numpy-2.5.3.tar.gz (20.8 MB)
Installing build dependencies ...
```
卡在编译阶段，20MB 源码包在手机上编译可能几十分钟甚至失败。

**原因**
pip 从 PyPI 拉的是源码包（`.tar.gz`），需要在本地编译。

**解决**
用 Termux 官方预编译包：
```bash
pkg install python-numpy -y
```

装完后 pip 会复用系统包，不再触发编译。

---

## 坑 2：pydantic-core 触发 Rust 编译

**现象**
```
Collecting pydantic-core>=2.14.6
Downloading pydantic_core-2.46.5.tar.gz (472 kB)
Installing build dependencies ...
```

从源码编译 Rust 代码，手机极易内存不足失败。

**原因**
pydantic-core 是用 Rust 写的，PyPI 上没有 Android 平台的 wheel。

**解决**
使用 Eutalix 维护的 Android 专用 wheel 源：

```bash
pip install pydantic-core \
  --extra-index-url https://eutalix.github.io/android-pydantic-core/ \
  --no-cache-dir
```

备选源（Termux User Repository）：

```bash
pip install pydantic-core \
  --extra-index-url https://termux-user-repository.github.io/pypi/ \
  --no-cache-dir
```

---

## 坑 3：pydantic-core 版本冲突，pip 强制重新编译

**现象**
已手动装好 pydantic-core 2.49.0，但装 pydantic 2.13.5 时，pip 仍去下载 pydantic_core-2.46.5.tar.gz 编译。

**原因**
pydantic 2.13.5 的元数据里写死了 pydantic-core==2.46.5，pip 严格按精确版本解析，忽略已装的 2.49.0。

**解决**
让 pydantic 跳过依赖检查：

```bash
pip install pydantic==2.13.5 --no-deps
```

pydantic-core 在 2.x 系列内 API 稳定，2.49.0 向下兼容 2.46.5。

---

## 坑 4：zai-sdk（智谱）引发连锁编译

**现象**
requirements.txt 里的 zai-sdk>=0.2.3 引入 pydantic，进而引入 pydantic-core，触发上面两个坑。

**原因**
zai-sdk 依赖 pydantic，pydantic 依赖 pydantic-core。

**解决**
如果不用智谱 GLM，直接从 requirements.txt 删掉这行：

```bash
cd ~/CowAgent
sed -i '/^zai-sdk/d' requirements.txt
```

这样整条 pydantic 编译链都绕开了。

---

## 坑 5：cryptography 从源码编译，运行时 dlopen 符号错误

**现象**
```
Collecting cryptography
Downloading cryptography-50.0.2.tar.gz (880 kB)
Installing build dependencies ...
```

即使编译成功，运行时也可能报 dlopen failed: cannot locate symbol "PyLong_Type"。

**原因**
Termux 的 CPython 与普通 Linux 不同，PyLong_Type 等符号只在 libpython3.x.so 里，不在主程序里。pip 编译的 .so 期望符号在主程序，加载失败。

**解决**
用 Termux 官方打过补丁的预编译版：

```bash
pkg install python-cryptography python-cffi -y
```

Termux 包通过 patchelf --add-needed libpython 修复了符号问题。

---

## 坑 6：cffi 从源码编译

**现象**
装 python-cryptography 时，它的依赖 cffi 又从源码编译。

**解决**
```bash
pkg install python-cffi -y
```

---

## 坑 7：Pillow 从源码编译

**现象**
Pillow 编译需要 libjpeg、libpng、freetype 等一堆 C 库。

**解决**
```bash
pkg install python-pillow -y
```

---

## 坑 8：requirements.txt 路径找不到

**现象**
```
ERROR: Could not open requirements file: [Errno 2] No such file or directory: 'requirements.txt'
```

**原因**
Termux 新开会话后回到 ~ 目录，不在项目目录里。cd 只在当前会话有效。

**解决**
```bash
cd ~/CowAgent
pip install -r requirements.txt
```

或者一条命令搞定：

```bash
cd ~/CowAgent && pip install -r requirements.txt
```

---

## 坑 9：Python 命令大小写

**现象**
```
No command Python found, did you mean:
 Command python in package python
```

**原因**
Linux 区分大小写，Python ≠ python。

**解决**
```bash
python app.py
```

---

## 坑 10：找不到 ice.py

**现象**
```
python: can't open file '.../ice.py': [Errno 2] No such file or directory
```

**原因**
项目实际入口是 app.py，不是 ice.py。

**解决**
```bash
cd ~/CowAgent
python app.py
```

---

## 坑 11：localhost 在手机上打不开 Web 控制台

**现象**
日志显示 🌐 Local access: http://localhost:9899，但在手机浏览器打不开。

**解决**
改用 127.0.0.1：

```
http://127.0.0.1:9899
```

如需局域网访问，改配置 web_host: 0.0.0.0 并设置 web_password。

---

## 坑 12：Termux 无法写入 /sdcard

**现象**
```
cp: cannot create regular file '/sdcard/Download/xxx': Operation not permitted
```

**原因**
Termux 未获得存储权限。

**解决**
```bash
termux-setup-storage
```

手机会弹窗，点「允许」。然后：

```bash
cp 文件 ~/storage/downloads/
```

---

## 坑 13：git push 需要 Personal Access Token

**现象**
git push 提示输入密码，输 GitHub 登录密码失败。

**原因**
GitHub 已禁用密码认证，必须用 PAT。

**解决**

1. 打开 https://github.com/settings/tokens
2. 选 Tokens (classic) → Generate new token (classic)
3. 勾选 repo 权限
4. 生成后立即复制 ghp_xxxx...
5. git push 时用户名填 GitHub 用户名，密码粘贴 PAT

---

## 坑 14：GitHub sudo mode 二次验证

**现象**
```
We sent you a verification request on your GitHub Mobile app.
```

**解决**
打开 GitHub Mobile app，找到验证请求，把显示的验证码填到浏览器页面。

---

## 坑 15：SSH 推送配置

**现象**
HTTPS 推送每次要输 PAT，麻烦。

**解决**
改用 SSH 方式：

```bash
# 1. 生成密钥
ssh-keygen -t ed25519 -C "your@email.com"

# 2. 复制公钥
cat ~/.ssh/id_ed25519.pub

# 3. 添加到 GitHub：https://github.com/settings/keys
#    New SSH key → 粘贴 → Add

# 4. 修改 remote
git remote set-url origin git@github.com:用户名/仓库名.git

# 5. 推送
git push -u origin main
```

---

## 坑 16：仓库名末尾带横杠

**现象**
远程仓库名为 cowagent-termux-（结尾带横杠），不美观。

**解决**
GitHub 仓库名可随时改：Settings → General → Repository name → Rename。

改完后同步本地：

```bash
git remote set-url origin git@github.com:用户名/新仓库名.git
```

---

## 一键安装脚本

把以上所有坑都处理好的脚本见 install.sh，直接运行：

```bash
cd ~/CowAgent
bash install.sh
```

脚本会自动：

- 装齐编译工具链
- 用 pkg 装 numpy、cryptography、cffi、pillow 的预编译版
- 从 Eutalix 源装 pydantic-core 的 Android wheel
- 用 --no-deps 装 pydantic，避开版本冲突
- 提示是否移除 zai-sdk
- 最后验证关键包是否可导入

---

## 环境信息

- 设备：Android (arm64-v8a)
- Termux：F-Droid 版
- Python：3.14
- 关键预编译包：numpy 2.4.4、cryptography 50.0.2、pydantic-core 2.49.0
