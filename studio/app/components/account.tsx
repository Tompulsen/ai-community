import {
  FormEvent,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AccountModelPricing } from "./account-model-pricing";
import { AccountWallet } from "./account-wallet";
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  Tags,
  Trash2,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import Locale from "../locales";
import {
  newApiClient,
  NewApiAutoGroups,
  NewApiError,
  NewApiGroup,
  NewApiLog,
  NewApiPage,
  NewApiSession,
  NewApiStatus,
  NewApiToken,
  NewApiTokenInput,
  setNewApiExpectedUser,
} from "../client/new-api";
import { Path } from "../constant";
import { IconButton } from "./button";
import { Checkbox, TextField } from "./form-controls";
import { EmptyState, LoadingState, PageHeader } from "./page-header";
import { Input, Modal, Select, showConfirm } from "./ui-lib";
import styles from "./account.module.scss";
import {
  refetchModels,
  refreshSelectedNewApiModels,
  useAccessStore,
} from "../store/access";
import { getLocalTokenId } from "../utils/local-workspace";
import { AutoGroupLabel } from "./auto-group-label";
import { loadTurnstile, type TurnstileApi } from "../utils/turnstile";
import { isLocalPreviewEnabled } from "../utils/local-preview-models";
import {
  getLocalAccountPreviewClient,
  localAccountPreview,
} from "../utils/local-account-preview";
import { LocalAccountForm } from "./local-account-form";

const PAGE_SIZE = 10;
const EMPTY_SESSION: NewApiSession = {
  authenticated: false,
  user: null,
  selectedTokenId: null,
};
const EMPTY_AUTO_GROUPS: NewApiAutoGroups = {
  supported: false,
  defaultGroups: [],
  maxCount: 0,
};

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : Locale.Account.RequestFailed;
}

function formatAmount(
  quota: number,
  status: NewApiStatus | null,
  maximumFractionDigits = 6,
) {
  if (!status) return "—";
  const value = quota / status.quotaPerUnit;
  return `${status.currencySymbol}${new Intl.NumberFormat(undefined, {
    maximumFractionDigits,
  }).format(value)}`;
}

function formatTime(timestamp: number) {
  return timestamp > 0
    ? new Date(timestamp * 1000).toLocaleString()
    : Locale.Account.Never;
}

function tokenState(token: NewApiToken) {
  if (token.status === 2) return Locale.Account.Disabled;
  if (
    token.status === 3 ||
    (token.expired_time > 0 && token.expired_time <= Date.now() / 1000)
  ) {
    return Locale.Account.Expired;
  }
  if (
    token.status === 4 ||
    (!token.unlimited_quota && token.remain_quota <= 0)
  ) {
    return Locale.Account.Exhausted;
  }
  return token.status === 1
    ? Locale.Account.Enabled
    : Locale.Account.Unavailable;
}

function canUseToken(token: NewApiToken) {
  return (
    token.status === 1 &&
    (token.expired_time <= 0 || token.expired_time > Date.now() / 1000) &&
    (token.unlimited_quota || token.remain_quota > 0)
  );
}

function TokenMoreActions({
  token,
  disabled,
  editDisabled,
  onEdit,
  onStatus,
  onDelete,
  onRefresh,
}: {
  token: NewApiToken;
  disabled: boolean;
  editDisabled: boolean;
  onEdit: () => void;
  onStatus: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const close = () => {
    if (ref.current) {
      ref.current.open = false;
      ref.current.querySelector("summary")?.focus();
    }
  };
  return (
    <details
      ref={ref}
      className={styles["token-more"]}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          event.currentTarget.open = false;
      }}
    >
      <summary
        role="button"
        aria-label={Locale.Account.MoreTokenActions}
        aria-disabled={disabled}
        title={Locale.Account.MoreTokenActions}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        <MoreHorizontal size={17} aria-hidden="true" />
      </summary>
      <div className={styles["token-menu"]}>
        <span className={styles.secondary}>#{token.id}</span>
        <IconButton
          className={styles.tokenMenuEdit}
          icon={<Pencil size={16} />}
          text={Locale.Account.EditToken}
          disabled={editDisabled}
          onClick={() => {
            close();
            onEdit();
          }}
        />
        <IconButton
          icon={<Power size={16} />}
          text={
            token.status === 1
              ? Locale.Account.DisableToken
              : Locale.Account.EnableToken
          }
          disabled={disabled}
          onClick={() => {
            close();
            onStatus();
          }}
        />
        <IconButton
          icon={<RefreshCw size={16} />}
          text={Locale.Account.RefreshTokens}
          disabled={disabled}
          onClick={() => {
            close();
            onRefresh();
          }}
        />
        <IconButton
          icon={<Trash2 size={16} />}
          text={Locale.Account.DeleteToken}
          disabled={disabled}
          className={styles["delete-action"]}
          onClick={() => {
            close();
            onDelete();
          }}
        />
      </div>
    </details>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div role="alert" className={styles.error}>
      <AlertCircle size={16} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function Pagination({
  page,
  total,
  busy,
  onChange,
}: {
  page: number;
  total: number;
  busy: boolean;
  onChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className={styles.pagination}>
      <span>{Locale.Account.PageCount(page, pageCount, total)}</span>
      <div className={styles.inline}>
        <IconButton
          icon={<ChevronLeft size={16} />}
          aria={Locale.Account.PreviousPage}
          title={Locale.Account.PreviousPage}
          disabled={busy || page <= 1}
          onClick={() => onChange(page - 1)}
          bordered
        />
        <IconButton
          icon={<ChevronRight size={16} />}
          aria={Locale.Account.NextPage}
          title={Locale.Account.NextPage}
          disabled={busy || page >= pageCount}
          onClick={() => onChange(page + 1)}
          bordered
        />
      </div>
    </div>
  );
}

function TurnstileWidget({
  siteKey,
  attempt,
  onToken,
}: {
  siteKey: string;
  attempt: number;
  onToken: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onToken);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(true);
  const [retry, setRetry] = useState(0);
  const [widgetSize, setWidgetSize] = useState<"flexible" | "compact">();
  callbackRef.current = onToken;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () =>
      setWidgetSize(container.clientWidth < 300 ? "compact" : "flexible");
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!widgetSize) return;
    let api: TurnstileApi | undefined;
    let widgetId: string | undefined;
    let timeout: number | undefined;
    let disposed = false;
    setError("");
    setPending(true);
    callbackRef.current("");
    const finishLoading = () => {
      if (disposed) return;
      window.clearTimeout(timeout);
      setPending(false);
      setError("");
    };
    const fail = (message: string) => {
      if (disposed) return;
      window.clearTimeout(timeout);
      callbackRef.current("");
      setPending(false);
      setError(message);
    };
    void loadTurnstile()
      .then((sdk) => {
        if (disposed || !containerRef.current) return;
        api = sdk;
        // Give the challenge its own deadline after the SDK has finished loading.
        timeout = window.setTimeout(
          () => fail(Locale.Account.ChallengeTimedOut),
          15000,
        );
        widgetId = sdk.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => {
            if (disposed) return;
            finishLoading();
            callbackRef.current(token);
          },
          "before-interactive-callback": finishLoading,
          "after-interactive-callback": finishLoading,
          "expired-callback": () => fail(Locale.Account.ChallengeExpired),
          "timeout-callback": () => fail(Locale.Account.ChallengeTimedOut),
          "error-callback": (code) => {
            if (disposed) return;
            console.warn("[Turnstile] Verification failed", code);
            fail(Locale.Account.ChallengeFailed);
          },
          theme: "auto",
          size: widgetSize,
        });
      })
      .catch(() => fail(Locale.Account.ChallengeFailed));
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      if (widgetId !== undefined) api?.remove(widgetId);
    };
  }, [siteKey, attempt, retry, widgetSize]);

  return (
    <div>
      <div className={styles.challengeContainer} aria-busy={pending}>
        <div
          ref={containerRef}
          className={styles.challenge}
          data-size={widgetSize}
        />
        {pending && (
          <div
            className={styles.challengeLoading}
            role="status"
            aria-live="polite"
          >
            {Locale.Account.ChallengeLoading}
          </div>
        )}
      </div>
      {error && (
        <>
          <ErrorNotice message={error} />
          <IconButton
            icon={<RefreshCw size={16} />}
            text={Locale.Account.RetryChallenge}
            onClick={() => {
              callbackRef.current("");
              setRetry((value) => value + 1);
            }}
            bordered
          />
        </>
      )}
    </div>
  );
}

export function TokenEditor({
  token,
  groups,
  autoGroups,
  status,
  userId,
  userGroup,
  initialGroup,
  blocked,
  onClose,
  onSaved,
  client = newApiClient,
}: {
  token: NewApiToken | null;
  groups: NewApiGroup[];
  autoGroups: NewApiAutoGroups;
  status: NewApiStatus;
  userId: number;
  userGroup: string;
  initialGroup?: string;
  blocked: boolean;
  onClose: () => void;
  onSaved: (input: NewApiTokenInput) => Promise<void>;
  client?: Pick<typeof newApiClient, "createToken" | "updateToken">;
}) {
  type GroupMode = "auto" | "inherit" | "single" | "multi";
  const multiAvailable =
    autoGroups.supported && groups.some((item) => item.id === "auto");
  const initialRoute =
    token?.group ?? initialGroup ?? (multiAvailable ? "auto" : "");
  const originalMode: GroupMode =
    initialRoute === "auto"
      ? token?.auto_groups?.length
        ? "multi"
        : "auto"
      : initialRoute
      ? "single"
      : "inherit";
  const availableGroups = groups.filter((item) => item.id !== "auto");
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(token?.name ?? "");
  const [groupMode, setGroupMode] = useState<GroupMode>(originalMode);
  const [modeChanged, setModeChanged] = useState(false);
  const [group, setGroup] = useState(
    originalMode === "single"
      ? initialRoute
      : availableGroups.find((item) => item.id === userGroup)?.id ??
          availableGroups[0]?.id ??
          "",
  );
  const [selectedGroups, setSelectedGroups] = useState<string[]>(
    originalMode === "multi" ? token?.auto_groups?.slice() ?? [] : [],
  );
  const useDefaultGroups = groupMode === "auto";
  const [groupSearch, setGroupSearch] = useState("");
  const [unlimited, setUnlimited] = useState(token?.unlimited_quota ?? true);
  const [quota, setQuota] = useState(
    String((token?.remain_quota ?? status.quotaPerUnit) / status.quotaPerUnit),
  );
  const [expiry, setExpiry] = useState(token ? "keep" : "never");
  const [limitModels, setLimitModels] = useState(
    token?.model_limits_enabled ?? false,
  );
  const [models, setModels] = useState(token?.model_limits ?? "");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  savingRef.current = saving;
  const [error, setError] = useState("");
  const selectedGroup = availableGroups.find((item) => item.id === group);
  const multiUnavailableMessage = autoGroups.supported
    ? Locale.Account.MultiGroupNotEnabled
    : Locale.Account.MultiGroupUnsupported;
  const search = groupSearch.trim().toLocaleLowerCase();
  const candidateGroups = availableGroups.filter(
    (item) =>
      !selectedGroups.includes(item.id) &&
      (!search ||
        `${item.id} ${item.name} ${item.description}`
          .toLocaleLowerCase()
          .includes(search)),
  );
  const selectedGroupItems = selectedGroups.map(
    (id) =>
      availableGroups.find((item) => item.id === id) ?? {
        id,
        name: id,
        ratio: "auto" as const,
        description: Locale.Account.GroupUnavailable,
      },
  );

  function changeGroupMode(next: GroupMode) {
    if (next === groupMode) return;
    setGroupMode(next);
    setModeChanged(true);
    setError("");
  }

  function moveGroup(index: number, offset: number) {
    setSelectedGroups((current) => {
      const next = current.slice();
      const target = index + offset;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || blocked) return;
    setError("");
    const rawQuota = Number(quota) * status.quotaPerUnit;
    const modelNames = [
      ...new Set(
        models
          .split(/[,\n]/)
          .map((model) => model.trim())
          .filter(Boolean),
      ),
    ];
    if (
      !name.trim() ||
      new TextEncoder().encode(name.trim()).length > 50 ||
      (groupMode === "single" &&
        !availableGroups.some((item) => item.id === group)) ||
      (!unlimited &&
        (!Number.isFinite(rawQuota) ||
          rawQuota < 0 ||
          rawQuota > Number.MAX_SAFE_INTEGER)) ||
      (limitModels && modelNames.length === 0)
    ) {
      setError(Locale.Account.InvalidToken);
      return;
    }
    if (
      (groupMode === "multi" || groupMode === "auto") &&
      (!multiAvailable ||
        (!useDefaultGroups &&
          (selectedGroups.length === 0 ||
            selectedGroups.length > autoGroups.maxCount ||
            selectedGroups.some(
              (id) => !availableGroups.some((item) => item.id === id),
            ))))
    ) {
      setError(
        multiAvailable
          ? Locale.Account.InvalidAutoGroups(autoGroups.maxCount)
          : multiUnavailableMessage,
      );
      return;
    }
    const input: NewApiTokenInput = {
      name: name.trim(),
      group:
        groupMode === "inherit"
          ? ""
          : groupMode === "multi" || groupMode === "auto"
          ? "auto"
          : group,
      expired_time:
        expiry === "keep"
          ? token!.expired_time
          : expiry === "never"
          ? -1
          : Math.floor(Date.now() / 1000) + Number(expiry) * 86400,
      remain_quota: unlimited
        ? Math.max(0, token?.remain_quota ?? 0)
        : Math.round(rawQuota),
      unlimited_quota: unlimited,
      model_limits_enabled: limitModels,
      model_limits: limitModels ? modelNames.join(",") : "",
      ...(token
        ? {
            allow_ips: token.allow_ips,
            cross_group_retry:
              token.group === "auto"
                ? (groupMode === "multi" || groupMode === "auto") &&
                  Boolean(token.cross_group_retry)
                : groupMode === "multi" || groupMode === "auto"
                ? false
                : token.cross_group_retry,
          }
        : groupMode === "multi" || groupMode === "auto"
        ? { cross_group_retry: false }
        : {}),
      auto_groups:
        groupMode === "multi" || groupMode === "auto"
          ? useDefaultGroups
            ? []
            : selectedGroups.slice()
          : token && !modeChanged
          ? token.auto_groups
          : [],
    };
    setSaving(true);
    try {
      if (token) await client.updateToken(token.id, input, userId);
      else await client.createToken(input, userId);
      await onSaved(input);
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const close = () => {
    if (!savingRef.current) onClose();
  };
  return createPortal(
    <div
      className="modal-mask"
      role="dialog"
      aria-modal="true"
      aria-label={token ? Locale.Account.EditToken : Locale.Account.CreateToken}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <Modal
        title={token ? Locale.Account.EditToken : Locale.Account.CreateToken}
        onClose={close}
        actions={[
          <IconButton
            key="cancel"
            icon={<X size={16} />}
            text={Locale.UI.Cancel}
            disabled={saving}
            onClick={close}
            bordered
          />,
          <IconButton
            key="save"
            icon={<Save size={16} />}
            text={saving ? Locale.Account.Saving : Locale.Account.Save}
            type="primary"
            disabled={
              saving ||
              blocked ||
              ((groupMode === "multi" || groupMode === "auto") &&
                !multiAvailable)
            }
            onClick={() => formRef.current?.requestSubmit()}
          />,
        ]}
      >
        <form
          ref={formRef}
          className={`${styles.form} ${styles.editor}`}
          onSubmit={submit}
          aria-busy={saving || blocked}
        >
          {error && <ErrorNotice message={error} />}
          <label className={styles.field}>
            <span>{Locale.Account.TokenName}</span>
            <TextField
              fullWidth
              autoFocus
              value={name}
              placeholder={Locale.Account.TokenNamePlaceholder}
              maxLength={50}
              required
              disabled={saving}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <fieldset className={styles["group-modes"]} disabled={saving}>
            <legend>{Locale.Account.GroupMode}</legend>
            <div className={styles["radio-options"]}>
              {(
                [
                  ["auto", <AutoGroupLabel key="auto" />],
                  ["inherit", Locale.Account.InheritGroup],
                  ["single", Locale.Account.SingleGroup],
                  ["multi", Locale.Account.MultiGroup],
                ] as const
              )
                .filter(
                  ([value]) =>
                    (value !== "inherit" || originalMode === "inherit") &&
                    ((value !== "auto" && value !== "multi") ||
                      multiAvailable ||
                      originalMode === value),
                )
                .map(([value, label]) => (
                  <label key={value} className={styles["checkbox-label"]}>
                    <input
                      type="radio"
                      name="token-group-mode"
                      value={value}
                      aria-label={
                        value === "auto"
                          ? `Auto ${Locale.Account.SystemDefault}`
                          : undefined
                      }
                      checked={groupMode === value}
                      disabled={
                        (value === "multi" || value === "auto") &&
                        !multiAvailable
                      }
                      onChange={() => changeGroupMode(value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
            </div>
          </fieldset>
          {groupMode === "inherit" && (
            <p className={styles.hint}>
              {Locale.Account.InheritGroupHint(userGroup)}
            </p>
          )}
          {groupMode === "single" && (
            <label className={styles.field}>
              <span>{Locale.Account.Group}</span>
              <Select
                value={group}
                aria-label={Locale.Account.Group}
                disabled={saving}
                onChange={(event) => setGroup(event.currentTarget.value)}
                required
                align="left"
              >
                {group &&
                  !availableGroups.some((item) => item.id === group) && (
                    <option value={group} disabled>
                      {group}
                    </option>
                  )}
                {availableGroups.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.ratio === "auto"
                      ? ` · ${Locale.Account.AutoRatio}`
                      : ` · ${item.ratio}x`}
                  </option>
                ))}
              </Select>
              {selectedGroup?.description && (
                <span className={styles.hint}>{selectedGroup.description}</span>
              )}
            </label>
          )}
          {(groupMode === "multi" || groupMode === "auto") && (
            <div className={styles["multi-groups"]}>
              {useDefaultGroups ? (
                <p className={styles.hint}>
                  {Locale.Account.DefaultGroupsHint(
                    autoGroups.defaultGroups
                      .map(
                        (id) =>
                          availableGroups.find((item) => item.id === id)
                            ?.name ?? id,
                      )
                      .join(" → ") || Locale.Account.DefaultGroupsManaged,
                  )}
                </p>
              ) : (
                <>
                  <TextField
                    type="search"
                    fullWidth
                    value={groupSearch}
                    aria-label={Locale.Account.SearchGroups}
                    placeholder={Locale.Account.SearchGroups}
                    disabled={saving || !multiAvailable}
                    onChange={(event) =>
                      setGroupSearch(event.currentTarget.value)
                    }
                  />
                  <div
                    className={styles["group-list"]}
                    aria-label={Locale.Account.MultiGroup}
                  >
                    {[...selectedGroupItems, ...candidateGroups].map(
                      (item, index) => {
                        const selected = index < selectedGroups.length;
                        const available = availableGroups.some(
                          (group) => group.id === item.id,
                        );
                        return (
                          <div className={styles["group-row"]} key={item.id}>
                            <label className={styles["group-option"]}>
                              <Checkbox
                                checked={selected}
                                aria-label={item.name}
                                disabled={
                                  saving ||
                                  !multiAvailable ||
                                  (!selected &&
                                    selectedGroups.length >=
                                      autoGroups.maxCount)
                                }
                                onChange={(event) => {
                                  const checked = event.currentTarget.checked;
                                  setError("");
                                  setSelectedGroups((current) =>
                                    checked
                                      ? [...current, item.id]
                                      : current.filter((id) => id !== item.id),
                                  );
                                }}
                              />
                              <span className={styles["group-details"]}>
                                <span className={styles["group-title"]}>
                                  <span>
                                    {selected && `${index + 1}. `}
                                    {item.name}
                                  </span>
                                  {available && (
                                    <span className={styles["group-ratio"]}>
                                      {item.ratio === "auto"
                                        ? Locale.Account.AutoRatio
                                        : `${item.ratio}x`}
                                    </span>
                                  )}
                                </span>
                                {item.description && (
                                  <span className={styles.hint}>
                                    {item.description}
                                  </span>
                                )}
                              </span>
                            </label>
                            {selected && (
                              <div className={styles["group-order"]}>
                                <IconButton
                                  icon={<ArrowUp size={15} />}
                                  aria={Locale.Account.MoveGroupUp(item.name)}
                                  title={Locale.Account.MoveGroupUp(item.name)}
                                  disabled={
                                    saving || !multiAvailable || index === 0
                                  }
                                  onClick={() => moveGroup(index, -1)}
                                />
                                <IconButton
                                  icon={<ArrowDown size={15} />}
                                  aria={Locale.Account.MoveGroupDown(item.name)}
                                  title={Locale.Account.MoveGroupDown(
                                    item.name,
                                  )}
                                  disabled={
                                    saving ||
                                    !multiAvailable ||
                                    index === selectedGroups.length - 1
                                  }
                                  onClick={() => moveGroup(index, 1)}
                                />
                              </div>
                            )}
                          </div>
                        );
                      },
                    )}
                    {candidateGroups.length === 0 &&
                      selectedGroups.length === 0 && (
                        <div className={styles["group-empty"]}>
                          {Locale.Account.NoMatchingGroups}
                        </div>
                      )}
                  </div>
                  <span className={styles.hint}>
                    {Locale.Account.SelectedGroupCount(
                      selectedGroups.length,
                      autoGroups.maxCount,
                    )}
                  </span>
                </>
              )}
              <p className={styles.hint}>
                {Locale.Account.MultiGroupRoutingHint}
              </p>
            </div>
          )}
          {token?.group === "auto" &&
            (groupMode === "multi" || groupMode === "auto") &&
            token.cross_group_retry && (
              <p className={styles.hint}>
                {Locale.Account.CrossGroupRetryPreserved}
              </p>
            )}
          <label className={styles["checkbox-label"]}>
            <Checkbox
              checked={unlimited}
              disabled={saving}
              onChange={(event) => setUnlimited(event.currentTarget.checked)}
            />
            <span>{Locale.Account.UnlimitedQuota}</span>
          </label>
          {!unlimited && (
            <label className={styles.field}>
              <span>
                {Locale.Account.RemainingQuota} ({status.currencySymbol})
              </span>
              <TextField
                type="number"
                fullWidth
                min={0}
                step="any"
                value={quota}
                required
                disabled={saving}
                onChange={(event) => setQuota(event.currentTarget.value)}
              />
            </label>
          )}
          <span className={styles.hint}>{Locale.Account.TokenQuotaHint}</span>
          <label className={styles.field}>
            <span>{Locale.Account.Expiry}</span>
            <Select
              value={expiry}
              aria-label={Locale.Account.Expiry}
              disabled={saving}
              onChange={(event) => setExpiry(event.currentTarget.value)}
              align="left"
            >
              {token && (
                <option key="keep" value="keep">
                  {Locale.Account.KeepExpiry(formatTime(token.expired_time))}
                </option>
              )}
              <option key="never" value="never">
                {Locale.Account.Never}
              </option>
              {[1, 7, 30, 90].map((days) => (
                <option key={days} value={days}>
                  {Locale.Account.ExpireInDays(days)}
                </option>
              ))}
            </Select>
          </label>
          <label className={styles["checkbox-label"]}>
            <Checkbox
              checked={limitModels}
              disabled={saving}
              onChange={(event) => setLimitModels(event.currentTarget.checked)}
            />
            <span>{Locale.Account.LimitModels}</span>
          </label>
          {limitModels && (
            <label className={styles.field}>
              <span>{Locale.Account.AllowedModels}</span>
              <Input
                value={models}
                rows={3}
                required
                disabled={saving}
                placeholder={Locale.Account.ModelsPlaceholder}
                onChange={(event) => setModels(event.currentTarget.value)}
              />
            </label>
          )}
        </form>
      </Modal>
    </div>,
    document.body,
  );
}

export function AccountPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const preview =
    isLocalPreviewEnabled() && searchParams.get("local-preview") === "account";
  const demo = preview ? getLocalAccountPreviewClient() : undefined;
  const client = demo ?? newApiClient;
  const [renderClient, setRenderClient] = useState<typeof client>();
  const [accountForm, setAccountForm] = useState<
    "profile" | "register" | "reset"
  >();
  const accountView = searchParams.get("view") || "keys";
  const accountRoute = `${pathname}?${searchParams}`;
  const currentAccountRoute = useRef(accountRoute);
  currentAccountRoute.current = accountRoute;
  const pricingView = pathname === Path.Pricing;
  const walletView = !pricingView && accountView === "wallet";
  const openWallet = () =>
    navigate(
      `${Path.Account}?view=wallet${preview ? "&local-preview=account" : ""}`,
    );
  const pricingModel = searchParams.get("model") || "";
  useEffect(() => {
    if (pathname === Path.Account && accountView === "pricing") {
      const next = new URLSearchParams(searchParams);
      next.delete("view");
      navigate(`${Path.Pricing}${next.size ? `?${next}` : ""}`, {
        replace: true,
      });
    }
  }, [pathname, accountView, searchParams, navigate]);
  const [status, setStatus] = useState<NewApiStatus | null>(null);
  const [session, setSession] = useState<NewApiSession>(EMPTY_SESSION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const passwordId = useId();
  const [code, setCode] = useState("");
  const [requires2fa, setRequires2fa] = useState(false);
  const [challengeToken, setChallengeToken] = useState("");
  const [challengeAttempt, setChallengeAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [groups, setGroups] = useState<NewApiGroup[]>([]);
  const [autoGroups, setAutoGroups] =
    useState<NewApiAutoGroups>(EMPTY_AUTO_GROUPS);
  const [groupsReady, setGroupsReady] = useState(false);
  const [tokens, setTokens] = useState<NewApiPage<NewApiToken> | null>(null);
  const [tokenPage, setTokenPage] = useState(1);
  const [tokensBusy, setTokensBusy] = useState(false);
  const [tokensError, setTokensError] = useState("");
  const [logs, setLogs] = useState<NewApiPage<NewApiLog> | null>(null);
  const [logPage, setLogPage] = useState(1);
  const [logsBusy, setLogsBusy] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [editor, setEditor] = useState<NewApiToken | null | undefined>();
  const loginRef = useRef<HTMLFormElement>(null);
  const sessionEpoch = useRef(0);
  const sessionRequest = useRef(0);
  const initializationRequest = useRef(0);
  const syncRequest = useRef(0);
  const syncingRead = useRef(false);
  const tokenRequest = useRef(0);
  const logRequest = useRef(0);
  const groupRequest = useRef(0);
  const currentUserId = useRef<number | null>(null);
  const tokenActionPending = useRef(false);
  const tokenActionLifetime = useRef(0);
  const authenticated = session.authenticated && !!session.user;
  const loginPreview =
    process.env.NODE_ENV === "development" &&
    !loading &&
    !authenticated &&
    (!status?.enabled || !status.configured);
  const userId = authenticated ? session.user!.id : null;
  const working = busy || syncing;

  const applySession = useCallback(
    (result: NewApiSession) => {
      const nextUserId = result.authenticated ? result.user?.id ?? null : null;
      if (nextUserId !== currentUserId.current) {
        tokenActionLifetime.current += 1;
        tokenActionPending.current = false;
        setBusy(false);
        sessionEpoch.current += 1;
        tokenRequest.current += 1;
        logRequest.current += 1;
        groupRequest.current += 1;
        currentUserId.current = nextUserId;
        setTokens(null);
        setLogs(null);
        setGroups([]);
        setAutoGroups(EMPTY_AUTO_GROUPS);
        setTokensError("");
        setLogsError("");
        setGroupsReady(false);
        setEditor(undefined);
        setTokenPage(1);
        setLogPage(1);
        setTokensBusy(false);
        setLogsBusy(false);
      }
      if (!preview) setNewApiExpectedUser(nextUserId);
      setSession(result);
    },
    [preview],
  );

  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof NewApiError && error.status === 401) {
        sessionEpoch.current += 1;
        applySession(EMPTY_SESSION);
      }
      return errorMessage(error);
    },
    [applySession],
  );

  const loadSession = useCallback(async () => {
    const epoch = sessionEpoch.current;
    const requestId = ++sessionRequest.current;
    const result = await client.session();
    if (
      epoch === sessionEpoch.current &&
      requestId === sessionRequest.current
    ) {
      applySession(result);
    }
    return result;
  }, [applySession, client]);

  const syncSession = useCallback(async () => {
    const requestId = ++syncRequest.current;
    sessionEpoch.current += 1;
    syncingRead.current = true;
    setSyncing(true);
    try {
      await loadSession();
    } catch (error) {
      if (requestId === syncRequest.current) setError(handleError(error));
    } finally {
      if (requestId === syncRequest.current) {
        syncingRead.current = false;
        setSyncing(false);
      }
    }
  }, [handleError, loadSession]);

  const initialize = useCallback(async () => {
    const initializationId = ++initializationRequest.current;
    sessionEpoch.current += 1;
    setLoading(true);
    setError("");
    let epoch = sessionEpoch.current;
    const requestId = ++sessionRequest.current;
    try {
      const [statusResult, sessionResult] = await Promise.allSettled([
        client.status(),
        client.session(true).then((result) => {
          if (
            result.authenticated &&
            epoch === sessionEpoch.current &&
            requestId === sessionRequest.current
          ) {
            applySession(result);
            epoch = sessionEpoch.current;
            setRenderClient(client);
            setLoading(false);
          }
          return result;
        }),
      ]);
      if (initializationId !== initializationRequest.current) return;
      if (statusResult.status === "rejected") throw statusResult.reason;
      const result = statusResult.value;
      setStatus(result);
      if (result.enabled && result.configured) {
        if (
          epoch === sessionEpoch.current &&
          requestId === sessionRequest.current
        ) {
          if (sessionResult.status === "rejected") throw sessionResult.reason;
          applySession(sessionResult.value);
        }
      } else {
        applySession(EMPTY_SESSION);
      }
    } catch (error) {
      if (initializationId === initializationRequest.current)
        setError(handleError(error));
    } finally {
      if (initializationId === initializationRequest.current) {
        setRenderClient(client);
        setLoading(false);
      }
    }
  }, [handleError, applySession, client]);

  const cancelInitialization = useCallback(() => {
    initializationRequest.current++;
    sessionRequest.current++;
    sessionEpoch.current++;
    tokenActionLifetime.current++;
    tokenActionPending.current = false;
  }, []);

  useEffect(() => {
    // Download the public SDK while account status/session requests are pending.
    if (!preview) void loadTurnstile().catch(() => {});
    void initialize();
    return cancelInitialization;
  }, [initialize, preview, cancelInitialization]);

  useEffect(() => {
    if (preview) return;
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    const synchronize = () => void syncSession();
    const onVisible = () => {
      if (!status?.enabled || !status.configured) return;
      if (document.visibilityState !== "visible") return;
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        if (!syncingRead.current) synchronize();
      }, 100);
    };
    window.addEventListener("focus", onVisible);
    window.addEventListener("new-api-session-changed", synchronize);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("new-api-session-changed", synchronize);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status?.enabled, status?.configured, syncSession, preview]);

  const loadTokens = useCallback(
    async (page: number, force = false) => {
      const requestId = ++tokenRequest.current;
      const userId = currentUserId.current;
      const epoch = sessionEpoch.current;
      setTokensBusy(true);
      setTokensError("");
      try {
        if (userId === null) return;
        const result = await client.tokens(page, PAGE_SIZE, userId, force);
        if (
          userId !== currentUserId.current ||
          epoch !== sessionEpoch.current ||
          requestId !== tokenRequest.current
        ) {
          return;
        }
        if (result.items.length === 0 && page > 1) {
          setTokenPage(page - 1);
          return;
        }
        setTokens(result);
      } catch (error) {
        if (
          userId === currentUserId.current &&
          epoch === sessionEpoch.current &&
          requestId === tokenRequest.current
        ) {
          setTokensError(handleError(error));
        }
      } finally {
        if (requestId === tokenRequest.current) setTokensBusy(false);
      }
    },
    [handleError, client],
  );

  const loadLogs = useCallback(
    async (page: number, force = false) => {
      const requestId = ++logRequest.current;
      const userId = currentUserId.current;
      const epoch = sessionEpoch.current;
      setLogsBusy(true);
      setLogsError("");
      try {
        if (userId === null) return;
        const result = await client.logs(page, PAGE_SIZE, userId, force);
        if (
          userId === currentUserId.current &&
          epoch === sessionEpoch.current &&
          requestId === logRequest.current
        ) {
          setLogs(result);
        }
      } catch (error) {
        if (
          userId === currentUserId.current &&
          epoch === sessionEpoch.current &&
          requestId === logRequest.current
        ) {
          setLogsError(handleError(error));
        }
      } finally {
        if (requestId === logRequest.current) setLogsBusy(false);
      }
    },
    [handleError, client],
  );

  useEffect(() => {
    if (
      renderClient === client &&
      userId !== null &&
      !syncing &&
      !pricingView &&
      !walletView
    )
      void loadTokens(tokenPage);
  }, [
    renderClient,
    client,
    userId,
    tokenPage,
    loadTokens,
    syncing,
    pricingView,
    walletView,
  ]);

  useEffect(() => {
    if (
      renderClient === client &&
      userId !== null &&
      !syncing &&
      !pricingView &&
      !walletView
    )
      void loadLogs(logPage);
  }, [
    renderClient,
    client,
    userId,
    logPage,
    loadLogs,
    syncing,
    pricingView,
    walletView,
  ]);

  const loadGroups = useCallback(
    async (force = false) => {
      const userId = currentUserId.current;
      const epoch = sessionEpoch.current;
      const requestId = ++groupRequest.current;
      setGroupsReady(false);
      try {
        if (userId === null) return;
        const [groups, autoGroups] = await Promise.all([
          client.groups(userId, force),
          client.autoGroups(userId, force),
        ]);
        if (
          userId === currentUserId.current &&
          epoch === sessionEpoch.current &&
          requestId === groupRequest.current
        ) {
          setGroups(groups);
          setAutoGroups(autoGroups);
          setGroupsReady(true);
        }
      } catch (error) {
        if (
          userId === currentUserId.current &&
          epoch === sessionEpoch.current &&
          requestId === groupRequest.current
        ) {
          setTokensError(handleError(error));
        }
      }
    },
    [handleError, client],
  );

  useEffect(() => {
    if (
      renderClient === client &&
      userId !== null &&
      !syncing &&
      !pricingView &&
      !walletView
    )
      void loadGroups();
  }, [
    renderClient,
    client,
    userId,
    loadGroups,
    syncing,
    pricingView,
    walletView,
  ]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (loginPreview) {
      setError(Locale.Account.PreviewOnly);
      return;
    }
    if (busy || syncing) return;
    if (!requires2fa && status?.turnstileSiteKey && !challengeToken) {
      setError(Locale.Account.ChallengeRequired);
      return;
    }
    setError("");
    setBusy(true);
    setPasswordVisible(false);
    sessionEpoch.current += 1;
    try {
      const result = requires2fa
        ? await client.login2fa(code.trim())
        : await client.login(
            username.trim(),
            password,
            challengeToken || undefined,
          );
      setPassword("");
      if ("requires2fa" in result) {
        setRequires2fa(true);
        setCode("");
      } else {
        applySession(result);
        setRequires2fa(false);
        setCode("");
        setTokenPage(1);
        setLogPage(1);
      }
    } catch (error) {
      setError(handleError(error));
      setChallengeAttempt((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (busy || syncing) return;
    setBusy(true);
    setError("");
    sessionEpoch.current += 1;
    try {
      if (userId === null) return;
      await client.logout(userId);
      applySession(EMPTY_SESSION);
      setPassword("");
      setCode("");
      setRequires2fa(false);
    } catch (error) {
      setError(handleError(error));
    } finally {
      setBusy(false);
    }
  }

  async function tokenAction(action: (userId: number) => Promise<unknown>) {
    if (busy || syncing || tokenActionPending.current) return false;
    if (userId === null || userId !== currentUserId.current) return false;
    const lifetime = tokenActionLifetime.current;
    const isCurrent = () =>
      lifetime === tokenActionLifetime.current &&
      userId === currentUserId.current;
    tokenActionPending.current = true;
    setBusy(true);
    setTokensError("");
    try {
      await action(userId);
      if (!isCurrent()) return false;
      if (preview) await Promise.all([loadTokens(tokenPage), loadSession()]);
      return isCurrent();
    } catch (error) {
      if (isCurrent()) setTokensError(handleError(error));
      return false;
    } finally {
      if (isCurrent()) {
        tokenActionPending.current = false;
        setBusy(false);
      }
    }
  }

  async function enterChatWithToken(token: NewApiToken) {
    if (!canUseToken(token)) return;
    const lifetime = tokenActionLifetime.current;
    const used = await tokenAction(async (userId) => {
      if (preview) {
        if (session.selectedTokenId !== token.id)
          await client.selectToken(token.id, userId);
        return;
      }
      const access = useAccessStore.getState();
      if (access.switchingToken)
        throw new Error(Locale.Settings.ModelSource.Switching);
      useAccessStore.setState({ switchingToken: true });
      try {
        if (getLocalTokenId() !== token.id) {
          await client.selectToken(token.id, userId);
          if (lifetime !== tokenActionLifetime.current) return;
          await refreshSelectedNewApiModels({ userId, tokenId: token.id });
        } else if (
          access.modelListStatus !== "ready" ||
          access.modelRefreshError
        ) {
          await refetchModels();
        }
        const models = useAccessStore.getState();
        if (models.modelListStatus !== "ready" || models.modelRefreshError)
          throw new Error(Locale.Settings.ModelSource.ModelsFailed);
      } finally {
        useAccessStore.setState({ switchingToken: false });
      }
    });
    if (
      used &&
      lifetime === tokenActionLifetime.current &&
      accountRoute === currentAccountRoute.current &&
      (preview || getLocalTokenId() === token.id)
    ) {
      navigate(preview ? `${Path.Chat}?local-preview=components` : Path.Chat);
    }
  }

  const refreshTokens = () =>
    Promise.all([loadTokens(tokenPage, true), loadGroups(true)]);

  const publicUrl = status?.publicUrl?.replace(/\/+$/, "") ?? "";
  const showAccountLinks = !!publicUrl || loginPreview;
  const handleAccountLink = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (loginPreview) {
      event.preventDefault();
      setError(Locale.Account.PreviewOnly);
    }
  };
  const user = session.user;
  const selectedToken = tokens?.items.find(
    (token) => token.id === session.selectedTokenId,
  );
  const accountNavigation = (
    <nav className={styles.accountViews} aria-label="账户内容">
      <button type="button" aria-pressed={walletView} onClick={openWallet}>
        <Wallet size={16} aria-hidden="true" />
        <span>充值与套餐</span>
      </button>
      <button
        type="button"
        aria-pressed={!pricingView && !walletView}
        onClick={() => {
          const next = new URLSearchParams(searchParams);
          next.set("view", "keys");
          setSearchParams(next);
        }}
      >
        <KeyRound size={16} aria-hidden="true" />
        <span>密钥与用量</span>
      </button>
    </nav>
  );

  return (
    <div
      className={`${styles.page} ${pricingView ? styles.pricingPage : ""}`}
      onClickCapture={
        preview
          ? (event) => {
              const link = (event.target as Element).closest<HTMLAnchorElement>(
                'a[href^="http"]',
              );
              if (link && !link.hasAttribute("data-local-preview-link")) {
                event.preventDefault();
                setAccountForm(
                  link.href.includes("/register")
                    ? "register"
                    : link.href.includes("/forgot-password")
                    ? "reset"
                    : "profile",
                );
              }
            }
          : undefined
      }
    >
      <PageHeader
        title={pricingView ? "模型价格" : Locale.Account.Title}
        icon={pricingView ? <Tags size={19} /> : <UserRound size={19} />}
        backPath={Path.Home}
        className={
          pricingView && authenticated ? styles.pricingHeader : undefined
        }
      />
      <div
        className={`${styles.body} ${!authenticated ? styles.loginBody : ""}`}
      >
        {preview && (
          <p className={styles.secondary} role="status">
            本地界面预览 · 以下账号、用量和价格均为模拟数据
          </p>
        )}
        {loading || renderClient !== client ? (
          <LoadingState />
        ) : !authenticated &&
          !loginPreview &&
          (!status?.enabled || !status.configured) ? (
          <>
            {error && <ErrorNotice message={error} />}
            <EmptyState
              icon={<UserRound size={32} />}
              text={Locale.Account.NotConfigured}
            />
            <div className={styles.actions}>
              <IconButton
                icon={<RefreshCw size={16} />}
                text={Locale.UI.Retry}
                onClick={() => void initialize()}
                bordered
              />
            </div>
          </>
        ) : !authenticated ? (
          <div className={styles.login}>
            <div className={styles.loginPanel}>
              <div className={styles.loginHeader}>
                <h2>{Locale.Account.LoginTitle}</h2>
              </div>
              {error && <ErrorNotice message={error} />}
              {!loginPreview && !status?.passwordLoginEnabled ? (
                <p className={styles.secondary}>
                  {Locale.Account.PasswordLoginDisabled}
                </p>
              ) : (
                <form
                  ref={loginRef}
                  className={styles.form}
                  onSubmit={login}
                  aria-busy={working}
                >
                  {requires2fa ? (
                    <label className={styles.field}>
                      <span>{Locale.Account.TwoFactorCode}</span>
                      <TextField
                        fullWidth
                        value={code}
                        onChange={(event) => setCode(event.currentTarget.value)}
                        autoComplete="one-time-code"
                        autoFocus
                        maxLength={32}
                        required
                        disabled={working}
                      />
                    </label>
                  ) : (
                    <>
                      <label className={styles.field}>
                        <span className={styles.loginFieldLabel}>
                          {Locale.Account.Username}
                        </span>
                        <div className={styles.loginInput}>
                          <span
                            className={styles.loginFieldIcon}
                            aria-hidden="true"
                          >
                            <UserRound size={17} />
                          </span>
                          <TextField
                            fullWidth
                            value={username}
                            onChange={(event) =>
                              setUsername(event.currentTarget.value)
                            }
                            placeholder={Locale.Account.UsernamePlaceholder}
                            autoComplete="username"
                            autoCapitalize="none"
                            spellCheck={false}
                            maxLength={128}
                            required
                            disabled={working}
                          />
                        </div>
                      </label>
                      <div className={styles.field}>
                        <div className={styles.loginFieldLabel}>
                          <label htmlFor={passwordId}>
                            {Locale.Account.Password}
                          </label>
                          {showAccountLinks && (
                            <a
                              className={styles.loginReset}
                              href={
                                loginPreview
                                  ? Path.Account
                                  : `${publicUrl}/forgot-password`
                              }
                              target={loginPreview ? undefined : "_blank"}
                              rel="noreferrer"
                              onClick={handleAccountLink}
                            >
                              {Locale.Account.ResetPassword}
                            </a>
                          )}
                        </div>
                        <div
                          className={`${styles.loginInput} ${styles.loginPassword}`}
                        >
                          <span
                            className={styles.loginFieldIcon}
                            aria-hidden="true"
                          >
                            <LockKeyhole size={17} />
                          </span>
                          <TextField
                            id={passwordId}
                            fullWidth
                            type={passwordVisible ? "text" : "password"}
                            value={password}
                            onChange={(event) =>
                              setPassword(event.currentTarget.value)
                            }
                            placeholder={Locale.Account.PasswordPlaceholder}
                            autoComplete="current-password"
                            maxLength={512}
                            required
                            disabled={working}
                          />
                          <IconButton
                            className={styles.loginPasswordToggle}
                            icon={
                              passwordVisible ? (
                                <EyeOff size={17} />
                              ) : (
                                <Eye size={17} />
                              )
                            }
                            aria={
                              passwordVisible
                                ? Locale.Account.HidePassword
                                : Locale.Account.ShowPassword
                            }
                            title={
                              passwordVisible
                                ? Locale.Account.HidePassword
                                : Locale.Account.ShowPassword
                            }
                            disabled={working}
                            onClick={() =>
                              setPasswordVisible((visible) => !visible)
                            }
                          />
                        </div>
                      </div>
                      {!loginPreview && status?.turnstileSiteKey && (
                        <TurnstileWidget
                          siteKey={status.turnstileSiteKey}
                          attempt={challengeAttempt}
                          onToken={setChallengeToken}
                        />
                      )}
                    </>
                  )}
                  <div className={styles.actions}>
                    {requires2fa && (
                      <IconButton
                        text={Locale.Account.BackToLogin}
                        icon={<ChevronLeft size={16} />}
                        disabled={working}
                        onClick={() => {
                          setRequires2fa(false);
                          setCode("");
                          setError("");
                        }}
                        bordered
                      />
                    )}
                    <IconButton
                      className={styles.loginSubmit}
                      icon={
                        requires2fa ? (
                          <ShieldCheck size={16} />
                        ) : (
                          <ArrowRight size={17} />
                        )
                      }
                      text={Locale.Account.Login}
                      busy={busy}
                      busyText={Locale.Account.LoggingIn}
                      type="primary"
                      disabled={
                        working ||
                        (!loginPreview &&
                          !requires2fa &&
                          !!status?.turnstileSiteKey &&
                          !challengeToken)
                      }
                      onClick={() => loginRef.current?.requestSubmit()}
                    />
                  </div>
                </form>
              )}
              {showAccountLinks && (
                <div className={styles.loginRegister}>
                  <span>{Locale.Account.NoAccount}</span>
                  <a
                    href={loginPreview ? Path.Account : `${publicUrl}/register`}
                    target={loginPreview ? undefined : "_blank"}
                    rel="noreferrer"
                    onClick={handleAccountLink}
                  >
                    {Locale.Account.Register}
                    <ChevronRight size={14} aria-hidden="true" />
                  </a>
                </div>
              )}
            </div>
            {loginPreview && (
              <p className={styles.loginPreviewNote}>
                <Eye size={14} aria-hidden="true" />
                <span>{Locale.Account.PreviewOnly}</span>
              </p>
            )}
          </div>
        ) : (
          <>
            {error && <ErrorNotice message={error} />}
            {error && !status && (
              <IconButton
                icon={<RefreshCw size={16} />}
                text="重新读取账号配置"
                onClick={() => void initialize()}
              />
            )}
            {!pricingView && (
              <section className={styles.summary}>
                <div className={styles.identity}>
                  <h2>{user!.display_name || user!.username}</h2>
                  <div className={styles.secondary}>
                    {user!.display_name &&
                      user!.display_name !== user!.username && (
                        <span>{user!.username} · </span>
                      )}
                    {Locale.Account.UserId}: {user!.id} · {Locale.Account.Group}
                    : {user!.group}
                  </div>
                </div>
                <dl className={styles.metrics}>
                  <div>
                    <dt>{Locale.Account.Balance}</dt>
                    <dd title={formatAmount(user!.quota, status)}>
                      {formatAmount(user!.quota, status, 4)}
                    </dd>
                  </div>
                  <div>
                    <dt>{Locale.Account.UsedQuota}</dt>
                    <dd title={formatAmount(user!.used_quota, status)}>
                      {formatAmount(user!.used_quota, status, 4)}
                    </dd>
                  </div>
                  <div>
                    <dt>{Locale.Account.RequestCount}</dt>
                    <dd>{user!.request_count.toLocaleString()}</dd>
                  </div>
                </dl>
                <div className={styles.summaryActions}>
                  <IconButton
                    icon={<RefreshCw size={16} />}
                    aria={Locale.Account.RefreshBalance}
                    title={Locale.Account.RefreshBalance}
                    disabled={working}
                    onClick={() =>
                      void loadSession().catch((error) =>
                        setError(handleError(error)),
                      )
                    }
                  />
                  <IconButton
                    icon={<LogOut size={16} />}
                    aria={Locale.Account.Logout}
                    title={Locale.Account.Logout}
                    disabled={working}
                    onClick={() => void logout()}
                  />
                </div>
              </section>
            )}

            {walletView ? (
              <AccountWallet
                key={`${preview ? "preview" : "live"}:${userId}`}
                userId={userId!}
                onRefreshBalance={loadSession}
                previewClient={demo}
                navigation={accountNavigation}
              />
            ) : pricingView ? (
              <AccountModelPricing
                key={userId!}
                userId={userId!}
                model={pricingModel}
                previewData={preview ? localAccountPreview.pricing : undefined}
              />
            ) : (
              <>
                <div className={styles.accountToolbar}>
                  {accountNavigation}
                  <div className={styles.toolbarActions}>
                    <IconButton
                      icon={<Plus size={16} />}
                      aria={Locale.Account.CreateToken}
                      title={Locale.Account.CreateToken}
                      disabled={working || !groupsReady || !status}
                      onClick={() => setEditor(null)}
                    />
                  </div>
                </div>
                <section
                  className={`${styles.section} ${styles.keySection}`}
                  aria-busy={tokensBusy || working}
                  aria-label={Locale.Account.MyTokens}
                >
                  {(!session.selectedTokenId || !selectedToken) && (
                    <div className={styles["active-token"]}>
                      <KeyRound size={15} aria-hidden="true" />
                      <span>
                        {session.selectedTokenId
                          ? Locale.Account.CurrentToken(
                              selectedToken?.name ??
                                `#${session.selectedTokenId}`,
                            )
                          : tokens?.total === 0
                          ? Locale.Account.FirstTokenHint
                          : Locale.Account.SelectTokenHint}
                      </span>
                    </div>
                  )}
                  {tokensError && <ErrorNotice message={tokensError} />}
                  {(tokensError || tokens?.items.length === 0) && (
                    <IconButton
                      icon={<RefreshCw size={16} />}
                      text={Locale.Account.RefreshTokens}
                      disabled={tokensBusy || working}
                      onClick={() => void refreshTokens()}
                    />
                  )}
                  {!tokens ? (
                    <div className={styles.empty}>
                      {tokensBusy ? Locale.UI.Loading : Locale.Account.NoTokens}
                    </div>
                  ) : tokens.items.length === 0 ? (
                    <div className={styles.empty}>
                      {Locale.Account.NoTokens}
                    </div>
                  ) : (
                    <div className={styles["token-list"]}>
                      {tokens.items.map((token) => {
                        const selected = session.selectedTokenId === token.id;
                        const available = canUseToken(token);
                        return (
                          <article
                            className={styles.token}
                            key={token.id}
                            data-token-id={token.id}
                          >
                            <button
                              type="button"
                              className={styles.tokenMain}
                              aria-label={`${
                                !available
                                  ? Locale.Account.MoreTokenActions
                                  : selected
                                  ? Locale.Account.StartChat
                                  : Locale.Account.UseForChat
                              } · ${token.name}`}
                              disabled={
                                working ||
                                tokensBusy ||
                                (selected &&
                                  available &&
                                  (!user || user.quota <= 0))
                              }
                              onClick={(event) => {
                                if (available) {
                                  void enterChatWithToken(token);
                                } else {
                                  const menu = event.currentTarget
                                    .closest("article")
                                    ?.querySelector("details");
                                  if (menu) {
                                    menu.open = true;
                                    menu.querySelector("summary")?.focus();
                                  }
                                }
                              }}
                            >
                              <div className={styles["token-header"]}>
                                <div className={styles["token-name"]}>
                                  <span className={styles["token-route"]}>
                                    {token.group ? (
                                      token.group === "auto" ? (
                                        token.auto_groups?.length ? (
                                          Locale.Account.MultiGroup
                                        ) : (
                                          <AutoGroupLabel />
                                        )
                                      ) : (
                                        groups.find(
                                          (item) => item.id === token.group,
                                        )?.name ?? token.group
                                      )
                                    ) : (
                                      Locale.Account.InheritedGroup(user!.group)
                                    )}
                                  </span>
                                  {(selected || !available) && (
                                    <span
                                      className={`${styles.status} ${
                                        selected && available
                                          ? styles.selected
                                          : ""
                                      }`}
                                    >
                                      {selected && available
                                        ? Locale.Account.Selected
                                        : tokenState(token)}
                                    </span>
                                  )}
                                </div>
                                <span className={styles["token-label"]}>
                                  {token.name}
                                </span>
                                {((token.group === "auto" &&
                                  !!token.auto_groups?.length) ||
                                  token.model_limits_enabled) && (
                                  <div className={styles.tokenDetails}>
                                    {token.group === "auto" &&
                                      !!token.auto_groups?.length && (
                                        <span>
                                          {token.auto_groups
                                            .map(
                                              (id) =>
                                                groups.find(
                                                  (item) => item.id === id,
                                                )?.name ?? id,
                                            )
                                            .join(" → ")}
                                        </span>
                                      )}
                                    {token.model_limits_enabled && (
                                      <span>
                                        {Locale.Account.AllowedModels}:{" "}
                                        {token.model_limits}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className={styles["token-quota"]}>
                                <span>
                                  <span>{Locale.Account.UsedQuota}</span>
                                  <span
                                    title={formatAmount(
                                      token.used_quota,
                                      status,
                                    )}
                                  >
                                    {formatAmount(token.used_quota, status, 4)}
                                  </span>
                                </span>
                                <span className={styles.quotaDetails}>
                                  <span>
                                    {token.unlimited_quota ? (
                                      Locale.Account.Unlimited
                                    ) : (
                                      <>
                                        {Locale.Account.RemainingQuota}:{" "}
                                        <span
                                          title={formatAmount(
                                            token.remain_quota,
                                            status,
                                          )}
                                        >
                                          {formatAmount(
                                            token.remain_quota,
                                            status,
                                            4,
                                          )}
                                        </span>
                                      </>
                                    )}
                                  </span>
                                  <span
                                    title={`${
                                      Locale.Account.Expiry
                                    }: ${formatTime(token.expired_time)}`}
                                  >
                                    {formatTime(token.expired_time)}
                                  </span>
                                </span>
                              </div>
                            </button>
                            <div className={styles["token-actions"]}>
                              <TokenMoreActions
                                token={token}
                                disabled={working}
                                editDisabled={
                                  working || !groupsReady || !status
                                }
                                onEdit={() => setEditor(token)}
                                onRefresh={() => void refreshTokens()}
                                onStatus={() =>
                                  void tokenAction((userId) =>
                                    client.setTokenStatus(
                                      token.id,
                                      token.status === 1 ? 2 : 1,
                                      userId,
                                    ),
                                  )
                                }
                                onDelete={() => {
                                  void (async () => {
                                    if (
                                      await showConfirm(
                                        Locale.Account.DeleteConfirm(
                                          token.name,
                                        ),
                                      )
                                    ) {
                                      await tokenAction((userId) =>
                                        client.deleteToken(token.id, userId),
                                      );
                                    }
                                  })();
                                }}
                              />
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  {tokens && (
                    <Pagination
                      page={tokenPage}
                      total={tokens.total}
                      busy={tokensBusy || working}
                      onChange={setTokenPage}
                    />
                  )}
                </section>

                <section className={styles.section} aria-busy={logsBusy}>
                  <div className={styles["section-header"]}>
                    <h3>
                      <Wallet size={18} aria-hidden="true" />
                      {Locale.Account.Usage}
                    </h3>
                    <IconButton
                      icon={<RefreshCw size={16} />}
                      aria={Locale.Account.RefreshUsage}
                      title={Locale.Account.RefreshUsage}
                      disabled={logsBusy || working}
                      onClick={() => void loadLogs(logPage, true)}
                      bordered
                    />
                  </div>
                  {logsError && <ErrorNotice message={logsError} />}
                  {!logs || logs.items.length === 0 ? (
                    <div className={styles.empty}>
                      {logsBusy ? Locale.UI.Loading : Locale.Account.NoLogs}
                    </div>
                  ) : (
                    <div className={styles["table-scroll"]}>
                      <table className={styles.logs}>
                        <thead>
                          <tr>
                            <th scope="col">{Locale.Account.Time}</th>
                            <th scope="col">{Locale.Account.Model}</th>
                            <th scope="col">{Locale.Account.TokenName}</th>
                            <th scope="col">{Locale.Account.InputOutput}</th>
                            <th scope="col">{Locale.Account.Cost}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {logs.items.map((log) => (
                            <tr key={log.id}>
                              <td>{formatTime(log.created_at)}</td>
                              <td>{log.model_name || "-"}</td>
                              <td>{log.token_name || "-"}</td>
                              <td>
                                {log.prompt_tokens.toLocaleString()} /{" "}
                                {log.completion_tokens.toLocaleString()}
                              </td>
                              <td>{formatAmount(log.quota, status)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {logs && (
                    <Pagination
                      page={logPage}
                      total={logs.total}
                      busy={logsBusy || working}
                      onChange={setLogPage}
                    />
                  )}
                </section>
              </>
            )}
            {editor !== undefined && status && (
              <TokenEditor
                token={editor}
                groups={groups}
                autoGroups={autoGroups}
                status={status}
                userId={userId!}
                userGroup={user!.group}
                blocked={syncing}
                client={client}
                onClose={() => setEditor(undefined)}
                onSaved={async () => {
                  const page = editor === null ? 1 : tokenPage;
                  setTokenPage(page);
                  await Promise.all([loadTokens(page, true), loadSession()]);
                }}
              />
            )}
          </>
        )}
      </div>
      {demo && renderClient === client && accountForm && (
        <LocalAccountForm
          mode={accountForm}
          client={demo}
          onClose={() => setAccountForm(undefined)}
          onSaved={loadSession}
        />
      )}
    </div>
  );
}
