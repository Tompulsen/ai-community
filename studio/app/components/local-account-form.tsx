"use client";

import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Save, X } from "lucide-react";
import type { LocalAccountPreviewClient } from "../utils/local-account-preview";
import { Modal } from "./ui-lib";
import { IconButton } from "./button";
import { TextField } from "./form-controls";
import styles from "./account.module.scss";

export function LocalAccountForm({
  mode,
  client,
  onClose,
  onSaved,
}: {
  mode: "profile" | "register" | "reset";
  client: LocalAccountPreviewClient;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const initial = client.profile();
  const [username, setUsername] = useState(
    mode === "profile" ? initial.username : "",
  );
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [email, setEmail] = useState(initial.email);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = {
    profile: "账号管理",
    register: "注册账号",
    reset: "找回密码",
  }[mode];
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "profile")
        await client.updateProfile({ username, displayName, email });
      else if (mode === "register") await client.register(username, password);
      else await client.resetPassword(email, password);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "模拟操作失败");
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <div
      className="modal-mask"
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (!busy && event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <Modal
        title={`${title} · 本地预览`}
        onClose={onClose}
        actions={[
          <IconButton
            key="cancel"
            text="取消"
            icon={<X size={16} />}
            onClick={onClose}
            disabled={busy}
          />,
        ]}
      >
        <form className={styles.form} onSubmit={save}>
          <p className={styles.secondary}>
            模拟数据仅保存在当前页面，刷新后恢复。
          </p>
          {error && <p role="alert">{error}</p>}
          {mode !== "reset" && (
            <label className={styles.field}>
              用户名
              <TextField
                fullWidth
                required
                value={username}
                onChange={(event) => setUsername(event.currentTarget.value)}
              />
            </label>
          )}
          {mode === "profile" && (
            <label className={styles.field}>
              显示名称
              <TextField
                fullWidth
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
              />
            </label>
          )}
          <label className={styles.field}>
            邮箱
            <TextField
              fullWidth
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </label>
          {mode !== "profile" && (
            <label className={styles.field}>
              {mode === "reset" ? "新密码" : "密码"}
              <TextField
                fullWidth
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                autoComplete="new-password"
              />
            </label>
          )}
          <button type="submit" disabled={busy} className={styles.topupEntry}>
            <Save size={16} aria-hidden="true" />
            {busy ? "正在保存…" : "保存"}
          </button>
        </form>
      </Modal>
    </div>,
    document.body,
  );
}
