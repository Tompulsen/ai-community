import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Layers, RefreshCw } from "lucide-react";
import {
  newApiClient,
  getExpectedNewApiUserId,
  getCachedModelSource,
  type NewApiModelGroups,
  type NewApiSession,
} from "../client/new-api";
import {
  refetchModels,
  refreshNewApiModels,
  refreshSelectedNewApiModels,
  useAccessStore,
} from "../store/access";
import { getLocalTokenId } from "../utils/local-workspace";
import {
  preloadWorkspaceRoute,
  workspaceRoutePreloadHandlers,
} from "../utils/preload-workspace-routes";
import { Path } from "../constant";
import Locale from "../locales";
import styles from "./account-model-source.module.scss";
import { AutoGroupLabel } from "./auto-group-label";

type SourceData = {
  session: NewApiSession;
  modelGroups: NewApiModelGroups;
};

const LOCAL_PREVIEW_SOURCE: SourceData = {
  session: {
    authenticated: true,
    selectedTokenId: 0,
    user: {
      id: 0,
      username: "local-preview",
      display_name: "Local preview",
      quota: 0,
      used_quota: 0,
      request_count: 0,
      group: "default",
    },
  },
  modelGroups: {
    selectedGroup: "auto",
    selectedAutoGroups: [],
    groups: [
      { id: "auto", name: "Auto", ratio: "auto", description: "" },
      { id: "creative", name: "创作", ratio: 1.2, description: "" },
      { id: "quality", name: "高质量", ratio: 0.8, description: "" },
    ],
  },
};

export function AccountModelSource(props: {
  onGroupChange?: () => void;
  preview?: boolean;
}) {
  const text = Locale.Settings.ModelSource;
  const preview = props.preview === true;
  const [data, setData] = useState<SourceData | undefined>(() =>
    preview ? LOCAL_PREVIEW_SOURCE : getCachedModelSource(),
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(() =>
    preview ? false : !getCachedModelSource(),
  );
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const failedGroup = useRef<string>();
  const epoch = useRef(0);
  const selectorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const switching = useAccessStore((state) => state.switchingToken);
  const modelStatus = useAccessStore((state) => state.modelListStatus);
  const modelRefreshError = useAccessStore((state) => state.modelRefreshError);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const load = useCallback(async (force = false) => {
    const request = ++epoch.current;
    const cached = getCachedModelSource();
    setData(cached);
    setLoading(!cached);
    try {
      const userId = getExpectedNewApiUserId();
      const [session, prefetchedGroups] = await Promise.all([
        cached?.session ?? newApiClient.session(),
        userId === null ? undefined : newApiClient.modelGroups(userId, force),
      ]);
      if (request !== epoch.current) return;
      if (!session.authenticated || !session.user) {
        setData(undefined);
        setLoadError("");
        return;
      }
      const modelGroups =
        userId === session.user.id && prefetchedGroups
          ? prefetchedGroups
          : await newApiClient.modelGroups(session.user.id);
      if (request !== epoch.current) return;
      setData({ session, modelGroups });
      setLoadError("");
    } catch (error) {
      if (request === epoch.current)
        setLoadError(
          error instanceof Error ? error.message : Locale.Account.RequestFailed,
        );
    } finally {
      if (request === epoch.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (preview) return;
    const requestEpoch = epoch;
    void load();
    void refreshNewApiModels();
    const refresh = () => void load();
    window.addEventListener("new-api-session-changed", refresh);
    window.addEventListener("new-api-model-source-ready", refresh);
    return () => {
      requestEpoch.current++;
      window.removeEventListener("new-api-session-changed", refresh);
      window.removeEventListener("new-api-model-source-ready", refresh);
    };
  }, [load, preview]);

  async function switchGroup(group: string) {
    if (preview) {
      setData((current) =>
        current
          ? {
              ...current,
              modelGroups: {
                ...current.modelGroups,
                selectedGroup: group,
                selectedAutoGroups: [],
              },
            }
          : current,
      );
      setOpen(false);
      props.onGroupChange?.();
      return;
    }
    if (!data?.session.user || useAccessStore.getState().switchingToken) return;
    if (
      group === data.modelGroups.selectedGroup &&
      !(group === "auto" && data.modelGroups.selectedAutoGroups?.length) &&
      modelStatus === "ready"
    ) {
      setOpen(false);
      return;
    }
    setOpen(false);
    useAccessStore.setState({ switchingToken: true });
    setError("");
    failedGroup.current = group;
    try {
      const result = await newApiClient.selectModelGroup(
        group,
        data.session.user.id,
      );
      setData((current) =>
        current
          ? {
              ...current,
              session: {
                ...current.session,
                selectedTokenId: result.selectedTokenId,
              },
              modelGroups: {
                ...current.modelGroups,
                selectedGroup: group,
                selectedAutoGroups: [],
              },
            }
          : current,
      );
      failedGroup.current = undefined;
      setOpen(false);
      // A confirmed cached list is usable while its background check completes.
      const refreshed = refreshSelectedNewApiModels({
        userId: data.session.user.id,
        tokenId: result.selectedTokenId,
        group: result.group,
      });
      if (useAccessStore.getState().modelListStatus !== "ready")
        await refreshed;
      if (
        useAccessStore.getState().modelListStatus === "ready" &&
        getExpectedNewApiUserId() === data.session.user.id &&
        getLocalTokenId() === result.selectedTokenId
      )
        props.onGroupChange?.();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : Locale.Account.RequestFailed,
      );
      // An unsuccessful response can still have selected the key on the server.
      await refetchModels();
      await load();
    } finally {
      useAccessStore.setState({ switchingToken: false });
    }
  }

  const selectedGroup = data?.modelGroups.selectedGroup;
  const groupName = (id: string) =>
    data?.modelGroups.groups.find((group) => group.id === id)?.name || id;
  const groupLabel = (id: string) => {
    if (id === "auto") return <AutoGroupLabel />;
    const group = data?.modelGroups.groups.find((group) => group.id === id);
    return `${groupName(id)}${
      id !== "" &&
      typeof group?.ratio === "number" &&
      Number.isFinite(group.ratio)
        ? ` · ${group.ratio}x`
        : ""
    }`;
  };
  const busy = loading || switching;

  return (
    <div className={styles.source}>
      <div className={styles.row}>
        <div className={styles.selector} ref={selectorRef}>
          <button
            ref={triggerRef}
            type="button"
            className={styles.trigger}
            aria-label={text.Title}
            aria-expanded={open}
            aria-controls="model-source-options"
            disabled={busy}
            onClick={() => setOpen(!open)}
          >
            <Layers size={16} aria-hidden="true" />
            <span className={styles.label}>{text.Title}</span>
            <span>
              {switching
                ? text.Switching
                : loading
                ? text.Loading
                : selectedGroup
                ? selectedGroup === "auto" &&
                  data?.modelGroups.selectedAutoGroups?.length
                  ? Locale.Account.MultiGroup
                  : groupLabel(selectedGroup)
                : text.Choose}
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {open && (
            <div
              id="model-source-options"
              className={styles.options}
              role="group"
              aria-label={text.Title}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  triggerRef.current?.focus();
                }
              }}
            >
              {!data?.session.authenticated && (
                <p className={styles.notice}>{text.SignIn}</p>
              )}
              {data?.modelGroups.groups
                .filter((group) => group.id !== "")
                .sort((a, b) =>
                  a.id === "auto" ? -1 : b.id === "auto" ? 1 : 0,
                )
                .map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className={styles.option}
                    aria-label={
                      group.id === "auto"
                        ? `Auto ${Locale.Account.SystemDefault}`
                        : undefined
                    }
                    disabled={busy}
                    aria-pressed={
                      group.id === selectedGroup &&
                      !(
                        group.id === "auto" &&
                        data.modelGroups.selectedAutoGroups?.length
                      )
                    }
                    onClick={() => void switchGroup(group.id)}
                  >
                    <span>{groupLabel(group.id)}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
        <a
          href={`#${Path.Account}`}
          className={styles.manage}
          {...workspaceRoutePreloadHandlers(Path.Account)}
          onClick={() => void preloadWorkspaceRoute(Path.Account, "activation")}
        >
          <ExternalLink size={14} aria-hidden="true" />
          <span>{text.Manage}</span>
        </a>
      </div>
      {!preview &&
        (error ||
          loadError ||
          modelStatus === "error" ||
          modelRefreshError) && (
          <div role="alert" className={styles.notice}>
            <span>{error || loadError || text.ModelsFailed}</span>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (failedGroup.current !== undefined) {
                  await switchGroup(failedGroup.current);
                  return;
                }
                setError("");
                await load(true);
                await refreshNewApiModels(true);
              }}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {text.Retry}
            </button>
          </div>
        )}
    </div>
  );
}
